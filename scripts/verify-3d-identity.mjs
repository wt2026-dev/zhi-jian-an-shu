#!/usr/bin/env node
/**
 * 3D 场景「剪影差异化 + 单设备独占模式」验收脚本（零第三方依赖）。
 *
 * 为什么不用 __e3d 注入钩子：本轮要求「不留调试代码」，因此改为**纯 DOM 驱动** ——
 * 性能指标从顶栏 data-metric 芯片读，交互走真实控件（下拉框 / 页签 / 按钮）。
 * 这也更接近评审的真实操作路径。
 *
 * 用法：
 *   node scripts/verify-3d-identity.mjs                # 全量验收 + 截图
 *   node scripts/verify-3d-identity.mjs --measure-only # 只测性能，不截图
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = process.env.E3D_BASE || 'http://127.0.0.1:3000';
const USER = process.env.E3D_USER || 'admin';
const PASS = process.env.E3D_PASS || 'Admin@2026#Demo';
// 可用 E3D_OUT 改写输出目录：跑**改造前基线**时（E3D_BASE 指向旧构建）
// 必须另开目录，否则会把已验收的 verify-result.json / 截图覆盖掉。
const OUT_DIR = path.resolve(process.env.E3D_OUT || 'scratch/3d-identity');
// 同理，E3D_SHOT_DIR 可改写截图目录：docs/equipment3d-shots 里放的是 Phase-1 已验收的交付截图，
// 跑回归（尤其是 Phase-2 视觉重构之后）必须另开目录，否则一旦渲染没就绪截出白图就把好证据覆盖了。
const SHOT_DIR = path.resolve(process.env.E3D_SHOT_DIR || 'docs/equipment3d-shots');
const PORT = Number(process.env.CDP_PORT || 9335);
const MEASURE_ONLY = process.argv.includes('--measure-only');

/** 16 台设备的 id（验收要求逐台出一张独占截图）。 */
const ALL_DEVICE_IDS = Array.from({ length: 16 }, (_, i) => `eq-${101 + i}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const cands = [
    path.join(os.homedir(), '.agent-browser', 'browsers', 'chrome-153.0.8010.36', 'chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error('找不到 Chrome');
}

async function fetchJson(url, init) {
  const r = await fetch(url, init);
  return r.json();
}

/* ---------------- 极简 CDP 客户端 ---------------- */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时: ${method}`));
        }
      }, 60000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(`页面异常: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`);
    }
    return r.result?.value;
  }
  async waitFor(expr, timeout = 20000, step = 400) {
    const t0 = Date.now();
    for (;;) {
      try {
        if (await this.eval(expr)) return true;
      } catch {
        /* 页面可能正在重载 */
      }
      if (Date.now() - t0 > timeout) return false;
      await sleep(step);
    }
  }
  async shot(file, clip, scale = 1) {
    const params = { format: 'png', captureBeyondViewport: false };
    if (clip) params.clip = { ...clip, scale };
    const r = await this.send('Page.captureScreenshot', params);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
}

/* ---------------- 页面内读取性能指标 ---------------- */
const METRICS_JS = `(() => {
  const read = (m) => {
    const el = document.querySelector('[data-metric="' + m + '"]');
    return el ? el.textContent.trim() : null;
  };
  const num = (s) => {
    if (s == null) return null;
    const m = String(s).replace(/,/g, '').match(/-?\\d+(?:\\.\\d+)?/);
    return m ? Number(m[0]) : null;
  };
  return {
    devices: num(read('devices')),
    faults: num(read('faults')),
    triangles: num(read('triangles')),
    fps: num(read('fps')),
    buildMs: num(read('buildMs')),
    drawCalls: num(read('drawCalls')),
    animated: num(read('animated')),
    raw: {
      devices: read('devices'), triangles: read('triangles'),
      fps: read('fps'), buildMs: read('buildMs'),
      drawCalls: read('drawCalls'), animated: read('animated'),
    },
  };
})()`;

/** 3D 画布在页面里的实际矩形（用于裁剪放大截图）。 */
const CANVAS_RECT_JS = `(() => {
  const c = document.querySelector('[data-testid="equipment3d-host"] canvas');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return null;
  return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
})()`;

const SELECT_DEVICE_JS = (id) => `(() => {
  const sel = document.querySelector('[data-testid="equipment3d-device-select"]');
  if (!sel) return 'no-select';
  const opt = Array.from(sel.options).find((o) => o.value === ${JSON.stringify(id)});
  if (!opt) return 'no-option';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(sel, ${JSON.stringify(id)});
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`;

const RIGHT_TAB_JS = (tab) => `(() => {
  const el = document.querySelector('[data-testid="equipment3d-tab-${tab}"]');
  if (!el) return 'no-tab';
  el.click();
  return 'ok';
})()`;

const ISOLATION_EXIT_JS = `(() => {
  const el = document.querySelector('[data-testid="equipment3d-isolation-exit"]');
  if (!el) return 'no-button';
  el.click();
  return 'ok';
})()`;

/* ---------------- 主流程 ---------------- */
async function main() {
  const result = { ok: false, steps: [], metrics: {}, checks: {}, errors: { console: [], page: [] } };
  const chrome = findChrome();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3d-id-'));
  // 默认 headless + SwiftShader（纯 CPU 软件光栅化，无 GPU 的机器也能跑）。
  // 设 E3D_GPU=1 则改用**有头 + D3D11 真显卡**：无头模式拿不到 GPU，
  // 帧率会被软件光栅化锁在 20 fps 左右，那不是代码问题、但也测不出真实帧率。
  const USE_GPU = process.env.E3D_GPU === '1';
  const glFlags = USE_GPU
    ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  const proc = spawn(
    chrome,
    [
      ...(USE_GPU ? ['--window-position=0,0'] : ['--headless=new']),
      `--remote-debugging-port=${PORT}`,
      '--remote-allow-origins=*',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      ...glFlags,
      '--window-size=1440,900',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let cdp;
  try {
    // 等 devtools 端口
    let targets = null;
    for (let i = 0; i < 40; i++) {
      try {
        targets = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
        if (targets?.length) break;
      } catch {
        /* 还没起来 */
      }
      await sleep(400);
    }
    if (!targets?.length) throw new Error('Chrome devtools 端口未就绪');
    const page = targets.find((t) => t.type === 'page') ?? targets[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    cdp = new Cdp(ws);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');

    /* ---- 1. 打开应用 + 登录 ---- */
    // 注意：首次访问会弹出「欢迎使用工业设备智能检修系统」引导卡片，
    // 它**盖在 3D 画布上方**，不关掉的话每张截图都是同一张欢迎卡
    // （这个坑踩过一次：18 张截图 md5 完全一致，全是欢迎卡）。
    // 引导由 localStorage.onboarded_v2 或 ?onboarded=1 关闭，两条路都走一遍。
    await cdp.send('Page.navigate', { url: `${BASE}/?view=equipment_3d&onboarded=1` });
    // 固定 sleep 在这里是个坑：Vite dev 对某个视图是"首次请求才现场编译"，冷启时页面会白几秒，
    // 此时既没有登录表单也没有 main，脚本会把"白页"误判成"已登录"（needLogin=false）而跳过登录，
    // 随后既点不到导航项、也拿不到 canvas，最后报"未能进入 3D 视图"——看起来像功能坏了，其实是脚本跑早了。
    // 改成轮询等首屏真正出现（登录表单 或 main 二者之一）。
    // 注意：本文件的 waitFor 不会自动包 !!()，表达式必须自己返回布尔值——
    // 直接写 `document.querySelector(...) || document.querySelector(...)` 会返回 DOM 节点，
    // 经 returnByValue 序列化成 undefined，于是永远等不到、白白超时。
    const painted = await cdp.waitFor(
      `!!(document.querySelector('form input[type="password"]') || document.querySelector('main'))`,
      60000
    );
    if (!painted) throw new Error('首屏始终未渲染（登录表单与 main 都没出现）');
    await cdp.eval(`(() => {
      try { localStorage.setItem('onboarded_v2', '1'); } catch {}
      const skip = Array.from(document.querySelectorAll('button'))
        .find((b) => (b.textContent || '').trim() === '跳过');
      if (skip) skip.click();
      return 'ok';
    })()`);
    await sleep(600);

    // 真实登录表单（不是绕过）
    const needLogin = await cdp.eval(`!!document.querySelector('form input[type="text"]')`);
    if (needLogin) {
      await cdp.eval(`(() => {
        const set = (el, v) => {
          const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          s.call(el, v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const form = document.querySelector('form');
        const u = form.querySelector('input[type="text"]');
        const p = form.querySelector('input[type="password"]');
        if (u) set(u, ${JSON.stringify(USER)});
        if (p) set(p, ${JSON.stringify(PASS)});
        const btn = form.querySelector('button[type="submit"]');
        if (btn) btn.click();
        return 'submitted';
      })()`);
      // 等登录真正落地（会话是内存态，必须等 main 出来再往下走）
      const okMain = await cdp.waitFor(`!!document.querySelector('main')`, 30000);
      if (!okMain) throw new Error('登录后 main 未出现');
      await sleep(1500);
    }
    result.steps.push({ step: 'login', result: needLogin ? 'submitted' : 'session-already-active' });

    /* ---- 2. 进入 3D 视图 ---- */
    const hasHost = await cdp.waitFor(`!!document.querySelector('[data-testid="equipment3d-host"] canvas')`, 40000);
    if (!hasHost) {
      // 可能需要点导航；侧边栏分组会折叠，先把折叠的分组展开再找
      for (let attempt = 0; attempt < 10; attempt++) {
        const clicked = await cdp.eval(`(() => {
          const el = document.querySelector('#nav-tab-equipment_3d, [data-nav="equipment_3d"]');
          if (el) { el.click(); return 'byId'; }
          const headers = Array.from(document.querySelectorAll('button,[role="button"]'))
            .filter((x) => /^(综合看板|智能 ?AI|设备资产|检修作业|安全合规|知识中心|系统管理)$/.test((x.textContent || '').trim()));
          for (const h of headers) {
            if (h.getAttribute('aria-expanded') === 'false') h.click();
          }
          const el2 = document.querySelector('#nav-tab-equipment_3d, [data-nav="equipment_3d"]');
          if (el2) { el2.click(); return 'byId'; }
          return 'notfound';
        })()`);
        if (clicked === 'byId' && (await cdp.waitFor(`!!document.querySelector('[data-testid="equipment3d-host"] canvas')`, 8000))) break;
        await sleep(500);
      }
    }
    const hostReady = await cdp.eval(`!!document.querySelector('[data-testid="equipment3d-host"] canvas')`);
    result.steps.push({ step: 'enter-3d', result: hostReady ? 'ok' : 'FAILED' });
    if (!hostReady) throw new Error('未能进入 3D 视图');

    // 等首帧 + 统计稳定
    await sleep(4000);

    /* ---- 2b. 记录实际光栅化后端 ----
     * 帧率数字必须带上"是谁在画"才有意义：无头 Chrome 走 SwiftShader
     * 纯 CPU 软件光栅化，帧率会被环境锁死，不能当成代码性能问题。 */
    result.gpu = await cdp.eval(`(() => {
      try {
        const c = document.querySelector('[data-testid="equipment3d-host"] canvas');
        if (!c) return { error: 'no-canvas' };
        const gl = c.getContext('webgl2') || c.getContext('webgl');
        if (!gl) return { error: 'no-gl' };
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return {
          backend: ${USE_GPU} ? 'headed-gpu' : 'headless-swiftshader',
          renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
          vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        };
      } catch (e) {
        return { error: String(e) };
      }
    })()`);
    result.steps.push({ step: 'gpu-info', result: result.gpu });

    /* ---- 3. 三档画质性能 ---- */
    for (const q of ['low', 'medium', 'high']) {
      const clicked = await cdp.eval(`(() => {
        const el = document.querySelector('[data-quality="${q}"]');
        if (!el) return 'no-btn';
        el.click();
        return 'ok';
      })()`);
      await sleep(3500); // 等防抖重建 + 统计刷新
      await cdp.eval(RIGHT_TAB_JS('params'));
      await sleep(700);
      const m = await cdp.eval(METRICS_JS);
      result.metrics[q] = { ...m, clicked };
      result.steps.push({ step: `quality-${q}`, result: clicked, metrics: m.raw });
    }

    /* ---- 3b. 流畅档再测一遍（热态）----
     * 页面刚加载完的第一次重建夹着 JIT / 模块预热，buildMs 会明显偏高：
     * 同一档实测在 14~77ms 之间波动，拿首次读数去卡 ≤80ms 门限是不公平的。
     * 先切到均衡再切回流畅，拿到的才是热态下的真实重建耗时。 */
    await cdp.eval(`(() => {
      const el = document.querySelector('[data-quality="medium"]');
      if (el) el.click();
      return 'ok';
    })()`);
    await sleep(3200);
    await cdp.eval(`(() => {
      const el = document.querySelector('[data-quality="low"]');
      if (el) el.click();
      return 'ok';
    })()`);
    await sleep(3500);
    await cdp.eval(RIGHT_TAB_JS('params'));
    await sleep(700);
    const lowWarm = await cdp.eval(METRICS_JS);
    result.metrics.lowWarm = lowWarm;
    result.steps.push({ step: 'quality-low-warm', result: 'ok', metrics: lowWarm.raw });

    /* ---- 4. 独占模式 ---- */
    await cdp.eval(RIGHT_TAB_JS('params'));
    await sleep(400);
    const selRes = await cdp.eval(SELECT_DEVICE_JS('eq-103'));
    await sleep(3500);
    const isoState = await cdp.eval(`(() => ({
      exitBtn: !!document.querySelector('[data-testid="equipment3d-isolation-exit"]'),
      selectValue: document.querySelector('[data-testid="equipment3d-device-select"]')?.value ?? null,
      analysisTab: !!document.querySelector('[data-testid="equipment3d-tab-analysis"]'),
    }))()`);
    const isoMetrics = await cdp.eval(METRICS_JS);
    result.metrics.isolated = isoMetrics;
    result.steps.push({ step: 'isolation-enter', result: selRes, state: isoState, metrics: isoMetrics.raw });

    /* ---- 4b. 独占模式在精细 / 流畅两档各测一遍 ----
     * 验收要求「总览模式与独占模式都测一遍」；门限（≤25k 三角面 / ≤250 drawcall /
     * ≤80ms）是对流畅档提的，但精细档也要给出数据。
     * 顺带验证：**连切两次画质都不会把用户踢出独占模式**（重建后要能自愈）。 */
    const clickQuality = (q) =>
      cdp.eval(`(() => {
        const el = document.querySelector('[data-quality="${q}"]');
        if (!el) return 'no-btn';
        el.click();
        return 'ok';
      })()`);
    const isoHighClick = await clickQuality('high');
    await sleep(3500);
    const isoHighMetrics = await cdp.eval(METRICS_JS);
    result.metrics.isolatedHigh = { ...isoHighMetrics, clicked: isoHighClick };
    const isoLowClick = await clickQuality('low');
    await sleep(3500);
    const isoLowMetrics = await cdp.eval(METRICS_JS);
    const isoStillIsolated = await cdp.eval(
      `!!document.querySelector('[data-testid="equipment3d-isolation-exit"]')`
    );
    result.metrics.isolatedLow = { ...isoLowMetrics, clicked: isoLowClick, stillIsolated: isoStillIsolated };
    result.steps.push({
      step: 'isolation-tier-switch',
      high: isoHighClick,
      low: isoLowClick,
      stillIsolated: isoStillIsolated,
      metrics: isoLowMetrics.raw,
    });

    // 拆解视图证据（--measure-only 时不跑，判定时按 null 处理）
    let expMetrics = { devices: null };
    let expState = {};
    let expFolded = { devices: null };

    if (!MEASURE_ONLY) {
      // 截图统一用**精细档**：剪影零件最全（流畅档会按 detailMin 砍掉小零件）。
      await cdp.eval(`(() => {
        const el = document.querySelector('[data-quality="high"]');
        if (el) el.click();
        return 'ok';
      })()`);
      await sleep(3800);

      // 截图前再确认一次引导卡没挡住画面，挡住就关掉并如实记录。
      const modalState = await cdp.eval(`(() => {
        const skip = Array.from(document.querySelectorAll('button'))
          .find((b) => (b.textContent || '').trim() === '跳过');
        if (skip) skip.click();
        const h = Array.from(document.querySelectorAll('h3'))
          .find((x) => /欢迎使用工业设备智能检修系统/.test(x.textContent || ''));
        return { welcomeVisible: !!h, dismissed: !!skip };
      })()`);
      result.welcomeModal = modalState;
      await sleep(800);

      await cdp.shot(path.join(OUT_DIR, 'isolated-eq-103.png'));

      // 逐台独占截图：每张都要求"屏幕上真的只剩 1 台"，
      // 否则那张图不能算「独占模式」的证据。
      for (const id of ALL_DEVICE_IDS) {
        await cdp.eval(SELECT_DEVICE_JS(id));
        await sleep(2400);
        const m = await cdp.eval(METRICS_JS);
        await cdp.shot(path.join(OUT_DIR, `${id}.png`));
        // 再出一张**只裁画布区域**的放大图：全 UI 截图里左右浮层会压住设备，
        // 剪影差异光看全图不好判断。裁图是剪影差异最直接的证据。
        const rect = await cdp.eval(CANVAS_RECT_JS);
        if (rect) await cdp.shot(path.join(OUT_DIR, 'canvas', `${id}.png`), rect, 1.5);
        const oneOnly = m.devices === 1;
        if (!oneOnly) result.shotsNotIsolated = (result.shotsNotIsolated ?? []).concat(id);
        result.steps.push({ step: `shot-${id}`, result: oneOnly ? 'ok' : 'NOT-ISOLATED', devices: m.devices });
      }

      /* ---- 4c. 独占 + 拆解视图（验收第 5 条：拆解后画面仍只有这一台） ---- */
      await cdp.eval(SELECT_DEVICE_JS('eq-103'));
      await sleep(2400);
      const expToggle = await cdp.eval(`(() => {
        const el = document.querySelector('[data-testid="equipment3d-exploded-toggle"]');
        if (!el) return 'no-btn';
        el.click();
        return 'ok';
      })()`);
      await sleep(3400);
      expState = await cdp.eval(`(() => ({
        toggleLabel: document.querySelector('[data-testid="equipment3d-exploded-toggle"]')?.textContent?.trim() ?? null,
        exitBtn: !!document.querySelector('[data-testid="equipment3d-isolation-exit"]'),
      }))()`);
      expMetrics = await cdp.eval(METRICS_JS);
      await cdp.shot(path.join(OUT_DIR, 'isolated-eq-103-exploded.png'));
      // 再点一次合拢复原
      const expFold = await cdp.eval(`(() => {
        const el = document.querySelector('[data-testid="equipment3d-exploded-toggle"]');
        if (!el) return 'no-btn';
        el.click();
        return 'ok';
      })()`);
      await sleep(3400);
      expFolded = await cdp.eval(METRICS_JS);
      result.metrics.explodedInIsolation = { ...expMetrics, toggle: expToggle, state: expState };
      result.metrics.explodedFolded = expFolded;
      result.steps.push({
        step: 'isolation-exploded',
        result: expToggle,
        fold: expFold,
        state: expState,
        metrics: expMetrics.raw,
        foldedDevices: expFolded.devices,
      });
    }

    /* ---- 5. 返回总览 ---- */
    const exitRes = await cdp.eval(ISOLATION_EXIT_JS);
    await sleep(3200);
    const backMetrics = await cdp.eval(METRICS_JS);
    result.metrics.overviewAfterExit = backMetrics;
    result.steps.push({ step: 'isolation-exit', result: exitRes, metrics: backMetrics.raw });

    if (!MEASURE_ONLY) {
      await cdp.eval(RIGHT_TAB_JS('params'));
      await sleep(600);
      await cdp.shot(path.join(SHOT_DIR, 'identity-overview.png'));
      // 总览默认取景较远（"环境"视角预设要装下整个厂房），全图上看不清铭牌与剪影。
      // 再出一张只裁画布、放大 2 倍的版本 —— 16 台同框且剪影/编号可辨。
      const ovRect = await cdp.eval(CANVAS_RECT_JS);
      if (ovRect) await cdp.shot(path.join(OUT_DIR, 'overview-canvas.png'), ovRect, 2);

      // 再补一张"等轴"视角的总览：默认"环境"预设是给看厂房体量用的，
      // 设备在其中偏小；等轴预设离设备更近，是核对 16 台剪影差异更合适的机位。
      await cdp.eval(`(() => {
        const el = document.querySelector('[data-view="iso"]');
        if (!el) return 'no-btn';
        el.click();
        return 'ok';
      })()`);
      await sleep(3000);
      await cdp.shot(path.join(SHOT_DIR, 'identity-overview-iso.png'));
      const isoRect = await cdp.eval(CANVAS_RECT_JS);
      if (isoRect) await cdp.shot(path.join(OUT_DIR, 'overview-iso-canvas.png'), isoRect, 2);
    }

    /* ---- 6. 控制台错误 ---- */
    for (const ev of cdp.events) {
      if (ev.method === 'Runtime.exceptionThrown') {
        result.errors.page.push(ev.params?.exceptionDetails?.text ?? 'unknown');
      }
      if (ev.method === 'Runtime.consoleAPICalled' && ev.params?.type === 'error') {
        const txt = (ev.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
        result.errors.console.push(txt);
      }
    }

    /* ---- 7. 判定 ---- */
    const low = result.metrics.low ?? {};
    // 门限用"热态"读数判定（见 3b）；没有热态读数时退回首次读数。
    const gate = result.metrics.lowWarm ?? low;
    const isoLow = result.metrics.isolatedLow ?? {};
    result.checks = {
      entered3D: hostReady === true,
      sixteenDevices: gate.devices === 16,
      // 画质分档真实生效：三档三角面必须递减
      qualityTiersDiffer:
        typeof low.triangles === 'number' &&
        typeof result.metrics.medium?.triangles === 'number' &&
        typeof result.metrics.high?.triangles === 'number' &&
        low.triangles < result.metrics.medium.triangles &&
        result.metrics.medium.triangles <= result.metrics.high.triangles,
      lowTriangles: typeof gate.triangles === 'number' && gate.triangles <= 25000,
      lowDrawCalls: typeof gate.drawCalls === 'number' && gate.drawCalls <= 250,
      lowBuildMs: typeof gate.buildMs === 'number' && gate.buildMs <= 80,
      isolationEntered: isoState.exitBtn === true,
      isolationExitWorks: exitRes === 'ok',
      // 独占必须真的只剩 1 台（性能条如实反映，不是只改了个状态变量）
      isolationShowsOneDevice: isoMetrics.devices === 1,
      isolationLighterThanOverview:
        typeof isoMetrics.triangles === 'number' &&
        typeof isoMetrics.drawCalls === 'number' &&
        isoMetrics.triangles < result.metrics.high.triangles &&
        isoMetrics.drawCalls < result.metrics.high.drawCalls,
      // 独占模式在验收档位下也必须过门限
      isolatedLowTriangles: typeof isoLow.triangles === 'number' && isoLow.triangles <= 25000,
      isolatedLowDrawCalls: typeof isoLow.drawCalls === 'number' && isoLow.drawCalls <= 250,
      isolatedLowBuildMs: typeof isoLow.buildMs === 'number' && isoLow.buildMs <= 80,
      isolatedLowOneDevice: isoLow.devices === 1,
      // 精细档下的独占同样只能剩 1 台，且必须比精细档总览更轻
      isolatedHighOneDevice: result.metrics.isolatedHigh?.devices === 1,
      isolatedHighLighterThanOverview:
        typeof result.metrics.isolatedHigh?.triangles === 'number' &&
        result.metrics.isolatedHigh.triangles < result.metrics.high.triangles,
      // 切画质触发重建后，独占状态必须自愈而不是被踢回总览
      isolationSurvivesQualitySwitch: isoStillIsolated === true,
      // 验收第 5 条：独占下进入拆解视图，展开/合拢都正常，且画面仍只有这一台
      // （--measure-only 不跑截图流程，故这两项只在全量验收时判定）
      ...(MEASURE_ONLY
        ? {}
        : {
            explodedInIsolation:
              expMetrics.devices === 1 &&
              typeof expState.toggleLabel === 'string' &&
              expState.toggleLabel.includes('退出拆解'),
            explodedFoldsBack: expFolded.devices === 1,
          }),
      overviewRestored: backMetrics.devices === 16,
      noPageErrors: result.errors.page.length === 0,
    };
    result.ok = Object.values(result.checks).every(Boolean);

    /* ---- 8. 截图自检：16 张独占图必须**互不相同** ----
     * 踩过的坑：引导卡盖在画布上，18 张截图 md5 完全一致，
     * 文件都在、数量也对，却是同一张图 —— 光看"生成了没有"发现不了。
     * 这里用哈希兜底，防止交付一堆假证据。 */
    if (!MEASURE_ONLY) {
      const hashes = ALL_DEVICE_IDS.map((id) => {
        const f = path.join(OUT_DIR, `${id}.png`);
        return fs.existsSync(f) ? crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex') : null;
      });
      const uniq = new Set(hashes.filter(Boolean)).size;
      result.shotHashes = { unique: uniq, total: ALL_DEVICE_IDS.length, missing: hashes.filter((h) => !h).length };
      result.checks.allShotsDistinct = uniq === ALL_DEVICE_IDS.length;
      result.checks.welcomeModalDismissed = result.welcomeModal?.welcomeVisible === false;
      result.ok = Object.values(result.checks).every(Boolean);
    }
  } catch (err) {
    result.fatal = err instanceof Error ? err.message : String(err);
  } finally {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'verify-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main();
