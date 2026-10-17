#!/usr/bin/env node
/**
 * 通用"打开一个 URL 并截图"工具（零第三方依赖）。
 *
 * 用途：给参考生成器等外部页面留证，便于与本项目移植后的实现做视觉比对。
 *   node scripts/shot-url.mjs <url> <out.png> [waitMs] [--wait-expr "<js>"]
 *
 * 依赖：Node 18+（全局 fetch / WebSocket，Node 22 已内置）。
 * 说明：只读打开页面，不修改任何东西。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [url, out, waitMsRaw, ...rest] = process.argv.slice(2);
if (!url || !out) {
  console.error('用法: node scripts/shot-url.mjs <url> <out.png> [waitMs] [--wait-expr "<js>"]');
  process.exit(2);
}
const waitMs = Number(waitMsRaw || 4000);
const waitExprIdx = rest.indexOf('--wait-expr');
const waitExpr = waitExprIdx >= 0 ? rest[waitExprIdx + 1] : null;
const PORT = Number(process.env.CDP_PORT || 9334);

const CHROME_CANDIDATES = [
  path.join(os.homedir(), '.agent-browser', 'browsers', 'chrome-153.0.8010.36', 'chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
];
const CHROME = process.env.CHROME_PATH || CHROME_CANDIDATES.find((p) => p && fs.existsSync(p));
if (!CHROME) {
  console.error('未找到 Chrome，请设置 CHROME_PATH');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.pending = new Map();
    this.consoleErrors = [];
  }
  open() {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('CDP 连接超时')), 20000);
      this.ws.addEventListener('open', () => {
        clearTimeout(t);
        resolve();
      });
      this.ws.addEventListener('error', () => {
        clearTimeout(t);
        reject(new Error('CDP 连接失败'));
      });
      this.ws.addEventListener('message', (ev) => {
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (m.id != null) {
          const p = this.pending.get(m.id);
          if (!p) return;
          this.pending.delete(m.id);
          if (m.error) p.reject(new Error(m.error.message));
          else p.resolve(m.result);
          return;
        }
        if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params?.type)) {
          this.consoleErrors.push({
            level: m.params.type,
            text: (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' '),
          });
        } else if (m.method === 'Runtime.exceptionThrown') {
          this.consoleErrors.push({
            level: 'pageerror',
            text: m.params?.exceptionDetails?.exception?.description || 'unknown',
          });
        } else if (m.method === 'Log.entryAdded') {
          const e = m.params?.entry;
          if (e && ['error', 'warning'].includes(e.level)) {
            this.consoleErrors.push({ level: e.level, text: `${e.text} ${e.url || ''}`.trim() });
          }
        }
      });
    });
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(`页面求值异常: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    }
    return r.result?.value;
  }
  async waitFor(expr, { timeout = 30000, label = expr } = {}) {
    const t0 = Date.now();
    for (;;) {
      if (await this.eval(`!!(${expr})`)) return true;
      if (Date.now() - t0 > timeout) throw new Error(`等待超时 (${label})`);
      await sleep(300);
    }
  }
  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

const chromeLog = [];
let chrome;
let cdp;

function cleanup() {
  cdp?.close();
  try {
    chrome?.kill();
  } catch {
    /* ignore */
  }
}

async function main() {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-url-'));
  chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      '--remote-allow-origins=*',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1680,980',
      `--user-data-dir=${userDir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  chrome.stderr.on('data', (d) => chromeLog.push(String(d)));
  chrome.stdout.on('data', (d) => chromeLog.push(String(d)));

  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) break;
    } catch {
      /* retry */
    }
    await sleep(300);
  }

  let target = null;
  for (let i = 0; i < 40; i++) {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (target) break;
    await sleep(300);
  }
  if (!target) throw new Error('未找到可调试页面');

  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.navigate', { url });

  if (waitExpr) await cdp.waitFor(waitExpr, { timeout: 45000, label: waitExpr });
  await sleep(waitMs);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));

  const info = await cdp.eval(`(() => {
    const c = document.querySelector('canvas');
    const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
    const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return {
      title: document.title,
      canvas: c ? [c.width, c.height] : null,
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
      bodyLen: (document.body.innerText || '').length,
    };
  })()`);

  const real = cdp.consoleErrors.filter((e) => !/favicon|Download the React DevTools/i.test(e.text));
  console.log(JSON.stringify({ url, out, info, consoleCount: real.length, console: real.slice(0, 10) }, null, 2));
}

main()
  .catch((e) => {
    console.error('FATAL', e.message);
    console.error(chromeLog.join('').slice(-1500));
    process.exitCode = 1;
  })
  .finally(cleanup);
