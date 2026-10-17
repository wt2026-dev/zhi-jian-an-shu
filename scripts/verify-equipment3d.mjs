#!/usr/bin/env node
/**
 * 设备 3D 场景自动化验收脚本（零第三方依赖）。
 *
 * 用 Chrome DevTools Protocol 直接驱动本机 Chrome：
 *   node scripts/verify-equipment3d.mjs
 *
 * 覆盖的验收项：
 *   1. 登录 → 打开「3D 场景」页面，采集 console 报错 / 未捕获异常
 *   2. 读取顶部状态芯片（设备数 / 故障数 / 三角面 / 帧率 / 重建耗时）
 *   3. 三种场景预设各截一张图，并记录预设切换后的重建耗时
 *   4. 在画布中心派发真实鼠标点击，验证设备信息卡弹出（数据来自真实接口）
 *   5. 拖拽旋转后再次截图，验证轨道交互未破坏画面
 *   6. 厂房外壳三档（完整 / 半透明 / 隐藏）各截图留证
 *   7. 离线降级：拦截设备台账接口 + 整页重载，验证后端不可用时展示空态而非崩溃
 *   8. 输出 JSON 结果，供验证报告引用
 *
 * 依赖：Node 18+（需要全局 fetch / WebSocket，Node 22 已内置）。
 * 说明：本脚本不修改任何业务数据，也不做任何登录绕过 —— 它走的是与人工
 *       点击完全一致的登录表单流程。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const OUT_DIR = process.env.OUT_DIR || path.resolve('docs/equipment3d-shots');
const PORT = Number(process.env.CDP_PORT || 9333);
const USER = process.env.DEMO_USER || 'admin';
const PASS = process.env.DEMO_PASS || 'Admin@2026#Demo';

const CHROME_CANDIDATES = [
  path.join(os.homedir(), '.agent-browser', 'browsers', 'chrome-153.0.8010.36', 'chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error('未找到 Chrome/Edge 可执行文件，请设置 CHROME_PATH 环境变量');
}

const CHROME = process.env.CHROME_PATH || findChrome();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  return res.json();
}

/* ---------------- 极简 CDP 客户端 ---------------- */

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.consoleErrors = [];
    this.pageErrors = [];
  }

  open() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket 连接超时')), 20000);
      this.ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('CDP WebSocket 连接失败'));
      });
      this.ws.addEventListener('message', (ev) => this.#onMessage(ev.data));
    });
  }

  #onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id != null) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error)})`));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const type = msg.params?.type;
      if (type === 'error' || type === 'warning') {
        const text = (msg.params.args || [])
          .map((a) => a.value ?? a.description ?? a.type)
          .join(' ');
        this.consoleErrors.push({ level: type, text });
      }
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params?.exceptionDetails;
      this.pageErrors.push({
        text: d?.exception?.description || d?.text || 'unknown exception',
        url: d?.url,
        line: d?.lineNumber,
      });
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params?.entry;
      if (e && (e.level === 'error' || e.level === 'warning')) {
        this.consoleErrors.push({ level: e.level, text: `${e.text} ${e.url || ''}`.trim() });
      }
    }
    const fns = this.listeners.get(msg.method);
    if (fns) for (const fn of fns) fn(msg.params);
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  send(method, params = {}) {
    const id = ++this.seq;
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

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error(`页面求值异常: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    }
    return r.result?.value;
  }

  async waitFor(expression, { timeout = 30000, interval = 300, label = expression } = {}) {
    const deadline = Date.now() + timeout;
    let lastErr = null;
    while (Date.now() < deadline) {
      try {
        if (await this.eval(expression)) return true;
      } catch (e) {
        lastErr = e;
      }
      await sleep(interval);
    }
    throw new Error(`等待超时 (${label})${lastErr ? `: ${lastErr.message}` : ''}`);
  }

  async screenshot(file, clip) {
    const r = await this.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
    });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }

  /**
   * 对已保存的截图做像素统计。
   * 为什么不直接读 WebGL 画布：未开启 preserveDrawingBuffer 时，
   * 帧外 drawImage(canvas) 会拿到已清空的缓冲（全黑），结果不可信。
   * 截图是浏览器合成后的结果，才是真实呈现。
   */
  async analyzeShot(file, cw = 96, ch = 60) {
    const b64 = fs.readFileSync(file).toString('base64');
    return await this.eval(`(async () => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + ${JSON.stringify(b64)};
      await img.decode();
      const off = document.createElement('canvas');
      off.width = ${cw}; off.height = ${ch};
      const ctx = off.getContext('2d');
      ctx.drawImage(img, 0, 0, ${cw}, ${ch});
      const d = ctx.getImageData(0, 0, ${cw}, ${ch}).data;
      let sum = 0, min = 255, max = 0, nonDark = 0;
      const hist = new Array(8).fill(0);
      for (let i = 0; i < d.length; i += 4) {
        const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        sum += l; if (l < min) min = l; if (l > max) max = l;
        if (l > 18) nonDark++;
        hist[Math.min(7, Math.floor(l / 32))]++;
      }
      const n = d.length / 4;
      return { mean: +(sum / n).toFixed(2), min, max, nonDarkRatio: +(nonDark / n).toFixed(3), hist };
    })()`);
  }

  /**
   * 画布区域指纹：把 canvas 矩形降采样成 12×8 的 RGB 均值网格。
   *
   * 为什么不用 analyzeShot 的 8 桶直方图：那是全页统计（含侧边栏/面板），
   * 只有 8 个桶，用来判断"16 台设备的聚焦画面两两不同"极易碰撞。
   * 这里只取 3D 画布，且保留 96 个色彩分量，区分度足够。
   */
  async fingerprint(file, rect) {
    const b64 = fs.readFileSync(file).toString('base64');
    return await this.eval(`(async () => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + ${JSON.stringify(b64)};
      await img.decode();
      const off = document.createElement('canvas');
      off.width = 12; off.height = 8;
      const ctx = off.getContext('2d');
      ctx.drawImage(img, ${Math.round(rect.x)}, ${Math.round(rect.y)}, ${Math.round(rect.w)}, ${Math.round(rect.h)}, 0, 0, 12, 8);
      const d = ctx.getImageData(0, 0, 12, 8).data;
      const out = [];
      for (let i = 0; i < d.length; i += 4) out.push(Math.round(d[i] / 4), Math.round(d[i + 1] / 4), Math.round(d[i + 2] / 4));
      // 定宽拼接，避免 "12"+"3" 与 "1"+"23" 产生同一串
      return out.map((v) => String(v).padStart(3, '0')).join('');
    })()`);
  }

  /** 两张截图在画布区域内的差异像素占比（用于判断"画面是否在动"）。 */
  async diffShots(fileA, fileB, rect) {
    const a64 = fs.readFileSync(fileA).toString('base64');
    const b64 = fs.readFileSync(fileB).toString('base64');
    return await this.eval(`(async () => {
      const load = async (b64) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = 320; c.height = 200;
        c.getContext('2d').drawImage(img, ${Math.round(rect.x)}, ${Math.round(rect.y)}, ${Math.round(rect.w)}, ${Math.round(rect.h)}, 0, 0, 320, 200);
        return c.getContext('2d').getImageData(0, 0, 320, 200).data;
      };
      const A = await load(${JSON.stringify(a64)});
      const B = await load(${JSON.stringify(b64)});
      let changed = 0, sum = 0;
      for (let i = 0; i < A.length; i += 4) {
        const d = Math.abs(A[i] - B[i]) + Math.abs(A[i+1] - B[i+1]) + Math.abs(A[i+2] - B[i+2]);
        sum += d;
        if (d > 24) changed++;
      }
      const n = A.length / 4;
      return { changedRatio: +(changed / n).toFixed(4), meanDelta: +(sum / n).toFixed(3) };
    })()`);
  }

  async click(x, y, button = 'left') {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 });
    await sleep(40);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 });
  }

  async drag(x0, y0, x1, y1, steps = 12) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0, button: 'none' });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 });
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await this.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: Math.round(x0 + (x1 - x0) * t),
        y: Math.round(y0 + (y1 - y0) * t),
        button: 'left',
      });
      await sleep(16);
    }
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1 });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

/* ---------------- 页面内注入的辅助函数 ---------------- */

const HELPERS = `
window.__e3d = {
  chips() {
    const out = {};
    for (const el of document.querySelectorAll('[data-metric]')) {
      // Chip 结构：[svg][label][value]，取最后一个 span 才是数值
      const v = el.lastElementChild ? el.lastElementChild.textContent.trim() : el.textContent.trim();
      out[el.getAttribute('data-metric')] = v;
    }
    return out;
  },
  legend() {
    const out = {};
    for (const el of document.querySelectorAll('[data-legend]')) {
      const spans = el.querySelectorAll('span');
      out[el.getAttribute('data-legend')] = spans.length >= 3 ? spans[2].textContent.trim() : el.textContent.trim();
    }
    return out;
  },
  canvas() {
    const c = document.querySelector('[data-testid="equipment3d-host"] canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { w: r.width, h: r.height, x: r.left, y: r.top, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  },
  // 采样画布像素，用于判断"是否黑屏"以及"不同预设画面是否明显不同"
  sample() {
    const c = document.querySelector('[data-testid="equipment3d-host"] canvas');
    if (!c) return null;
    const off = document.createElement('canvas');
    off.width = 64; off.height = 40;
    const ctx = off.getContext('2d');
    ctx.drawImage(c, 0, 0, 64, 40);
    const d = ctx.getImageData(0, 0, 64, 40).data;
    let sum = 0, min = 255, max = 0, nonDark = 0;
    const hist = new Array(8).fill(0);
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114);
      sum += l; if (l < min) min = l; if (l > max) max = l;
      if (l > 18) nonDark++;
      hist[Math.min(7, Math.floor(l / 32))]++;
    }
    const n = d.length / 4;
    return { mean: +(sum / n).toFixed(2), min, max, nonDarkRatio: +(nonDark / n).toFixed(3), hist };
  },
  cardText() {
    // 旧的信息卡（左下角浮层）已由右侧「设备分析」面板取代
    const el = document.querySelector('[data-testid="equipment3d-analysis"]');
    return el ? el.innerText.replace(/\\s+/g, ' ').trim() : null;
  },
  /** 设备分析面板的关键字段（用于断言数据来自真实接口而非本地模拟） */
  analysis() {
    const root = document.querySelector('[data-testid="equipment3d-analysis"]');
    if (!root) return null;
    const q = (sel) => {
      const el = root.querySelector(sel);
      return el ? el.textContent.trim() : null;
    };
    const charts = [...root.querySelectorAll('[data-testid="equipment3d-analysis-charts"] [data-series]')].map((el) => ({
      series: el.getAttribute('data-series'),
      text: el.textContent.replace(/\\s+/g, ' ').trim(),
    }));
    return {
      equipmentId: root.getAttribute('data-equipment-id'),
      status: q('[data-testid="equipment3d-analysis-status"]'),
      health: q('[data-testid="equipment3d-analysis-health"]'),
      signature: q('[data-testid="equipment3d-analysis-signature"]'),
      charts,
      hasDiagnoseButton: !!root.querySelector('[data-testid="equipment3d-analysis-diagnose"]'),
      ai: q('[data-testid="equipment3d-analysis-ai"]'),
      aiError: q('[data-testid="equipment3d-analysis-ai-error"]'),
      orders: q('[data-testid="equipment3d-analysis-orders"]'),
      text: root.innerText.replace(/\\s+/g, ' ').trim().slice(0, 600),
    };
  },
  /** 点击「发起 AI 诊断」 */
  clickDiagnose() {
    const b = document.querySelector('[data-testid="equipment3d-analysis-diagnose"]');
    if (!b) return false;
    if (b.disabled) return 'disabled';
    b.click();
    return true;
  },
  /** 右侧面板标签切换 */
  clickRightTab(name) {
    const b = document.querySelector('[data-testid="equipment3d-tab-' + name + '"]');
    if (!b) return false;
    b.click();
    return b.getAttribute('data-active');
  },
  rightTabState() {
    const p = document.querySelector('[data-testid="equipment3d-tab-params"]');
    const a = document.querySelector('[data-testid="equipment3d-tab-analysis"]');
    return { params: p && p.getAttribute('data-active'), analysis: a && a.getAttribute('data-active') };
  },
  webglInfo() {
    const c = document.querySelector('[data-testid="equipment3d-host"] canvas');
    if (!c) return null;
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return { error: 'no-webgl-context' };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      dpr: window.devicePixelRatio,
      cssSize: [c.clientWidth, c.clientHeight],
    };
  },
  emptyVisible() {
    return !!document.querySelector('[data-testid="equipment3d-empty"]');
  },
  // 应用级"后端数据加载失败"兜底屏（App.tsx 的 loadError 分支，属既有设计）
  loadErrorVisible() {
    const t = document.body.innerText || '';
    return /后端数据加载失败/.test(t);
  },
  // 小地图是 2D 画布，可以直接读像素判断"是否真的画了东西"（不受 preserveDrawingBuffer 限制）
  minimap() {
    const c = document.querySelector('[data-testid="equipment3d-minimap"]');
    if (!c) return null;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const r = c.getBoundingClientRect();
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let painted = 0;
    const colours = new Set();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 8) {
        painted++;
        // 量化到 5bit，只关心"有多少种明显不同的颜色"（过滤抗锯齿噪声）
        colours.add(((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3));
      }
    }
    return {
      rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
      w: c.width,
      h: c.height,
      paintedRatio: +(painted / (d.length / 4)).toFixed(3),
      distinctColours: colours.size,
    };
  },
  clickPreset(id) {
    const b = document.querySelector('[data-preset="' + id + '"]');
    if (!b) return false;
    b.click();
    return true;
  },
  clickQuality(q) {
    const b = document.querySelector('[data-quality="' + q + '"]');
    if (!b) return false;
    b.click();
    return true;
  },
  clickShell(m) {
    const b = document.querySelector('[data-shell="' + m + '"]');
    if (!b) return false;
    b.click();
    return true;
  },
  clickView(key) {
    const b = document.querySelector('[data-view="' + key + '"]');
    if (!b) return false;
    b.click();
    return true;
  },
  clickToggle(testId) {
    const b = document.querySelector('[data-toggle="' + testId + '"]');
    if (!b) return false;
    b.click();
    return true;
  },
  toggleState(testId) {
    const b = document.querySelector('[data-toggle="' + testId + '"]');
    return b ? b.getAttribute('data-checked') : null;
  },
  setSlider(testId, v) {
    const el = document.querySelector('[data-slider="' + testId + '"]');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  },
  setSeed(v) {
    const el = document.querySelector('input[type="number"]');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  },
};
'ok'
`;

/* ---------------- 会话自愈 ---------------- */

const LOGIN_JS = `(() => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const u = document.querySelector('form input[type="text"]');
  const p = document.querySelector('form input[type="password"]');
  if (!u || !p) return 'no-input';
  setter.call(u, ${JSON.stringify(USER)});
  u.dispatchEvent(new Event('input', { bubbles: true }));
  setter.call(p, ${JSON.stringify(PASS)});
  p.dispatchEvent(new Event('input', { bubbles: true }));
  const btn = document.querySelector('form button[type="submit"]');
  if (!btn) return 'no-submit';
  btn.click();
  return 'submitted';
})()`;

const DISMISS_GUIDE_JS = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '跳过');
  if (b) { b.click(); return 'skipped'; }
  return null;
})()`;

/**
 * 确保当前停留在「3D 场景」视图，必要时自动重新登录。
 *
 * 为什么需要：Vite 开发服务器会监视整个工程目录，而本脚本会把截图/结果写到 docs/ 下，
 * 每次写入都会触发一次整页重载 —— 这会清掉注入的 window.__e3d，并把会话打回登录页。
 * 与其假设环境绝对静止，不如让脚本具备自愈能力（这不是绕过登录，走的仍是真实登录表单）。
 */
async function ensure3DView(cdp, result, tag = 'ensure-3d') {
  for (let attempt = 1; attempt <= 5; attempt++) {
    if (await cdp.eval(`!!document.querySelector('[data-testid="equipment3d-host"]')`)) {
      await cdp.eval(HELPERS);
      result.steps.push({ step: tag, result: `ok (attempt ${attempt})` });
      return true;
    }
    if (await cdp.eval(`!!document.querySelector('form input[type="text"]')`)) {
      await cdp.eval(LOGIN_JS);
    }
    try {
      await cdp.waitFor(`!!document.querySelector('#nav-tab-equipment_3d')`, { timeout: 20000, label: '侧边栏' });
    } catch {
      await sleep(1200);
      continue;
    }
    await cdp.eval(DISMISS_GUIDE_JS);
    await cdp.eval(`document.querySelector('#nav-tab-equipment_3d').click(); 'ok'`);
    await sleep(1000);
  }
  result.steps.push({ step: tag, result: 'failed' });
  return false;
}

/* ---------------- 主流程 ---------------- */

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3d-chrome-'));
  const result = {
    baseUrl: BASE_URL,
    chrome: CHROME,
    startedAt: new Date().toISOString(),
    shots: [],
    controls: {},
    steps: [],
    errors: { console: [], page: [], preExisting: [], harnessArtifacts: [], offlineInduced: [] },
    presets: {},
    picking: null,
    interaction: null,
    emptyState: null,
  };

  const child = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${userDataDir}`,
      `--window-size=${process.env.WINDOW_SIZE || '1680,980'}`,
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      // 容器/受限环境下 Chrome 自身沙箱无法访问自身可执行文件，需显式关闭
      '--no-sandbox',
      '--disable-setuid-sandbox',
      // 无 GPU 环境用 SwiftShader 软件光栅化跑 WebGL，否则画布会是黑的
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--disable-dev-shm-usage',
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let chromeLog = '';
  child.stdout.on('data', (d) => (chromeLog += d.toString()));
  child.stderr.on('data', (d) => (chromeLog += d.toString()));

  const cleanup = () => {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };

  let cdp = null;
  try {
    // 1. 等 Chrome 的调试端口就绪
    let version = null;
    for (let i = 0; i < 60; i++) {
      try {
        version = await fetchJson(`http://127.0.0.1:${PORT}/json/version`);
        break;
      } catch {
        await sleep(500);
      }
    }
    if (!version) throw new Error('Chrome 调试端口未就绪');
    result.browser = version.Browser;

    // 2. 找到页面 target 并连上
    let target = null;
    for (let i = 0; i < 40; i++) {
      const list = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
      await sleep(300);
    }
    if (!target) throw new Error('未找到可调试的页面 target');

    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');

    // 3. 打开应用首页并登录（与人工操作完全一致的表单流程，无任何绕过）
    await cdp.send('Page.navigate', { url: BASE_URL });
    await cdp.waitFor(`!!document.querySelector('form input[type="text"]')`, {
      timeout: 45000,
      label: '登录表单',
    });
    const loginOk = await cdp.eval(LOGIN_JS);
    result.steps.push({ step: 'login', result: loginOk });
    if (loginOk !== 'submitted') throw new Error(`登录表单提交失败: ${loginOk}`);

    // 4. 进入 3D 场景：含引导层关闭，以及"被 Vite 整页重载打断"时的自动重新登录
    if (!(await ensure3DView(cdp, result, 'enter-3d-view'))) {
      throw new Error('无法进入 3D 场景视图');
    }

    // 5. 等 3D 场景就绪（辅助函数已由 ensure3DView 注入）
    await cdp.waitFor(`!!window.__e3d.canvas()`, { timeout: 40000, label: 'WebGL 画布' });
    await cdp.waitFor(
      `(() => { const c = window.__e3d.chips(); return c.devices && /\\d/.test(c.devices); })()`,
      { timeout: 45000, label: '设备数芯片' }
    );
    await sleep(2500); // 让阻尼相机稳定 + 帧率采样窗口填满
    result.webgl = await cdp.eval(`window.__e3d.webglInfo()`);
    result.windowSize = process.env.WINDOW_SIZE || '1680,980';

    // 6. 三种预设各截图一次（同时采集小地图统计，用于证明俯视图确实按真实状态绘制）
    const presets = ['standard', 'heavy', 'yard'];
    for (const id of presets) {
      const ok = await cdp.eval(`window.__e3d.clickPreset(${JSON.stringify(id)})`);
      if (!ok) throw new Error(`未找到预设按钮: ${id}`);
      // 等重建完成（重建中徽标消失）且相机稳定
      await sleep(2200);
      const chips = await cdp.eval(`window.__e3d.chips()`);
      const legend = await cdp.eval(`window.__e3d.legend()`);
      const file = path.join(OUT_DIR, `preset-${id}.png`);
      await cdp.screenshot(file);
      const pixels = await cdp.analyzeShot(file);
      const minimap = await cdp.eval(`window.__e3d.minimap()`);
      // 小地图单独裁一张，便于报告里直接看俯视布局差异
      let miniShot = null;
      if (minimap?.rect) {
        miniShot = path.join(OUT_DIR, `minimap-${id}.png`);
        await cdp.screenshot(miniShot, minimap.rect);
        result.shots.push(miniShot);
      }
      result.presets[id] = { chips, legend, pixels, minimap, minimapShot: miniShot };
      result.shots.push(file);
    }

    // 7. 设备拾取：在画布内多点尝试，直到设备分析面板出现
    const geom = await cdp.eval(`window.__e3d.canvas()`);    const tries = [
      [0.5, 0.56],
      [0.42, 0.6],
      [0.58, 0.58],
      [0.36, 0.52],
      [0.64, 0.62],
      [0.5, 0.66],
      [0.3, 0.62],
      [0.7, 0.54],
    ];
    let picked = null;
    for (const [fx, fy] of tries) {
      const x = Math.round(geom.x + geom.w * fx);
      const y = Math.round(geom.y + geom.h * fy);
      await cdp.click(x, y);
      await sleep(2200);
      const text = await cdp.eval(`window.__e3d.cardText()`);
      if (text) {
        picked = { at: [fx, fy], text };
        break;
      }
    }
    result.picking = picked;
    if (picked) {
      const file = path.join(OUT_DIR, 'pick-device-analysis.png');
      await cdp.screenshot(file);
      result.shots.push(file);
      // 分析面板结构 + 真实数据断言
      result.analysis = await cdp.eval(`window.__e3d.analysis()`);
      // AI 诊断按钮触发（这是本步唯一会产生大模型调用的动作，只做一次）
      result.diagnoseClick = await cdp.eval(`window.__e3d.clickDiagnose()`);
      // AI 诊断要走"大模型 → 失败则规则引擎降级"整条链路，耗时不确定；
      // 固定 sleep 会拍到"研判中…"加载态。这里轮询到结论出现为止（最多 40s），
      // 让最终产物里留下的是**结论**而不是转圈，同时证明面板不会因此崩溃。
      let poll = null;
      for (let i = 0; i < 20; i++) {
        await sleep(2000);
        const a = await cdp.eval(`window.__e3d.analysis()`);
        if (a && (a.ai || a.aiError)) {
          poll = { waitedMs: (i + 1) * 2000, resolved: true };
          break;
        }
      }
      result.analysisAfterDiagnose = await cdp.eval(`window.__e3d.analysis()`);
      result.aiDiagnosePoll = poll ?? { waitedMs: 40000, resolved: false };
      const diagFile = path.join(OUT_DIR, 'pick-ai-diagnose.png');
      await cdp.screenshot(diagFile);
      result.shots.push(diagFile);
    }

    // 8. 轨道交互：左键拖拽旋转后截图，确认画面仍然正常
    const beforeFile = path.join(OUT_DIR, 'orbit-before-drag.png');
    await cdp.screenshot(beforeFile);
    const before = await cdp.analyzeShot(beforeFile);
    await cdp.drag(
      Math.round(geom.x + geom.w * 0.7),
      Math.round(geom.y + geom.h * 0.4),
      Math.round(geom.x + geom.w * 0.42),
      Math.round(geom.y + geom.h * 0.55)
    );
    await sleep(1600);
    const file = path.join(OUT_DIR, 'orbit-after-drag.png');
    await cdp.screenshot(file);
    const after = await cdp.analyzeShot(file);
    result.shots.push(file);
    result.interaction = {
      beforeMeanLuma: before?.mean,
      afterMeanLuma: after?.mean,
      changed: before && after ? Math.abs(before.mean - after.mean) > 0.4 : null,
    };

    // 9. 画质档位（流畅 / 精细）重建耗时
    const quality = {};
    for (const q of ['low', 'medium', 'high']) {
      await cdp.eval(`window.__e3d.clickQuality(${JSON.stringify(q)})`);
      await sleep(2200);
      const chips = await cdp.eval(`window.__e3d.chips()`);
      quality[q] = { buildMs: chips.buildMs, triangles: chips.triangles, fps: chips.fps };
    }
    result.quality = quality;

    // 10. 参数联动：随机种子变化应导致几何变化（像素直方图不同）
    await cdp.eval(`window.__e3d.clickQuality('medium')`);
    await sleep(1800);
    const seedFileA = path.join(OUT_DIR, 'seed-before.png');
    await cdp.screenshot(seedFileA);
    const seedA = await cdp.analyzeShot(seedFileA);
    await cdp.eval(`window.__e3d.setSeed(987654)`);
    await sleep(2400);
    const seedFile = path.join(OUT_DIR, 'seed-987654.png');
    await cdp.screenshot(seedFile);
    const seedB = await cdp.analyzeShot(seedFile);
    const seedChips = await cdp.eval(`window.__e3d.chips()`);
    result.seedChange = {
      beforeMean: seedA?.mean,
      afterMean: seedB?.mean,
      buildMs: seedChips.buildMs,
      changed: seedA && seedB ? seedA.hist.join(',') !== seedB.hist.join(',') : null,
    };
    result.shots.push(seedFile);

    // 11. 空状态检测（后端正常时不应出现）
    result.emptyState = { visible: await cdp.eval(`window.__e3d.emptyVisible()`) };

    // 12. 厂房外壳三档：完整 / 半透明（默认）/ 隐藏 —— 每档截图留证
    await cdp.eval(`window.__e3d.clickPreset('standard')`);
    await sleep(1800);
    const shells = {};
    for (const m of ['ghost', 'full', 'none']) {
      const okShell = await cdp.eval(`window.__e3d.clickShell(${JSON.stringify(m)})`);
      if (!okShell) {
        shells[m] = { error: 'button-not-found' };
        continue;
      }
      await sleep(2000);
      const file = path.join(OUT_DIR, `shell-${m}.png`);
      await cdp.screenshot(file);
      const px = await cdp.analyzeShot(file);
      const chips = await cdp.eval(`window.__e3d.chips()`);
      shells[m] = { chips, pixels: px, shot: file };
      result.shots.push(file);
    }
    result.shells = shells;
    // 复原为默认
    await cdp.eval(`window.__e3d.clickShell('ghost')`);
    await sleep(1500);

    // 12b. 参数面板的其余控件：视角预设 / 状态高亮 / 设备密度 / 间距 / 地面网格
    //      （这些控件此前只实现了、从未被验收覆盖过 —— 实现存在 ≠ 功能可用）
    //
    // 前置条件：Part B 把右侧面板改成「场景参数 / 设备分析」双页签后，第 7 步点选设备
    // 会自动切到「设备分析」页签，此时参数控件并不在 DOM 中。必须先显式切回「场景参数」，
    // 否则下面所有控件都会查不到 —— 那会伪装成"功能不可用"的假阴性。
    const controls = { views: {}, highlight: {}, density: {}, spacing: {}, grid: {}, tabs: {} };

    // 顺便把页签机制本身也验掉：切到「场景参数」必须能看到参数控件、看不到分析面板。
    await cdp.eval(`window.__e3d.clickRightTab('params')`);
    await sleep(900);
    controls.tabs = {
      state: await cdp.eval(`window.__e3d.rightTabState()`),
      paramsControlsPresent: await cdp.eval(
        `!!document.querySelector('[data-view="orbit"]') && !!document.querySelector('[data-shell="ghost"]')`
      ),
      analysisPanelPresent: await cdp.eval(`!!document.querySelector('[data-testid="equipment3d-analysis"]')`),
    };

    // 视角预设：四个视角必须产生肉眼可辨的不同画面
    for (const v of ['orbit', 'overhead', 'iso', 'closeup']) {
      const okView = await cdp.eval(`window.__e3d.clickView(${JSON.stringify(v)})`);
      if (!okView) {
        controls.views[v] = { error: 'button-not-found' };
        continue;
      }
      await sleep(1700);
      const file = path.join(OUT_DIR, `view-${v}.png`);
      await cdp.screenshot(file);
      const px = await cdp.analyzeShot(file);
      controls.views[v] = { mean: px?.mean, hist: px?.hist, shot: file };
      result.shots.push(file);
    }
    const viewKeys = Object.keys(controls.views).filter((k) => controls.views[k].hist);
    controls.viewsDistinct =
      viewKeys.length === 4 && new Set(viewKeys.map((k) => controls.views[k].hist.join(','))).size === 4;

    // 状态高亮开关：关掉后地面光环与异常光柱应消失（drawcall 随之下降）
    await cdp.eval(`window.__e3d.clickView('orbit')`);
    await sleep(1400);
    controls.highlight.before = {
      state: await cdp.eval(`window.__e3d.toggleState('highlight')`),
      chips: await cdp.eval(`window.__e3d.chips()`),
    };
    await cdp.eval(`window.__e3d.clickToggle('highlight')`);
    await sleep(2200);
    controls.highlight.afterOff = {
      state: await cdp.eval(`window.__e3d.toggleState('highlight')`),
      chips: await cdp.eval(`window.__e3d.chips()`),
    };
    const hlFile = path.join(OUT_DIR, 'toggle-highlight-off.png');
    await cdp.screenshot(hlFile);
    controls.highlight.pixels = await cdp.analyzeShot(hlFile);
    result.shots.push(hlFile);
    await cdp.eval(`window.__e3d.clickToggle('highlight')`);
    await sleep(2000);
    controls.highlight.afterOn = {
      state: await cdp.eval(`window.__e3d.toggleState('highlight')`),
      chips: await cdp.eval(`window.__e3d.chips()`),
    };

    // 设备密度：改成 8 后设备数芯片必须变成 8（证明真的按数量重建，而不是滑了个寂寞）
    await cdp.eval(`window.__e3d.setSlider('deviceCount', 8)`);
    await sleep(2400);
    controls.density.eight = await cdp.eval(`window.__e3d.chips()`);
    await cdp.eval(`window.__e3d.setSlider('deviceCount', 16)`);
    await sleep(2400);
    controls.density.sixteen = await cdp.eval(`window.__e3d.chips()`);

    // 间距
    await cdp.eval(`window.__e3d.setSlider('spacing', 1.4)`);
    await sleep(2400);
    controls.spacing.wide = await cdp.eval(`window.__e3d.chips()`);
    await cdp.eval(`window.__e3d.setSlider('spacing', 1)`);
    await sleep(2400);

    // 地面参考网格
    controls.grid.before = await cdp.eval(`window.__e3d.toggleState('grid')`);
    await cdp.eval(`window.__e3d.clickToggle('grid')`);
    await sleep(1400);
    const gridFile = path.join(OUT_DIR, 'toggle-grid-off.png');
    await cdp.screenshot(gridFile);
    controls.grid.after = await cdp.eval(`window.__e3d.toggleState('grid')`);
    controls.grid.pixels = await cdp.analyzeShot(gridFile);
    controls.grid.shot = gridFile;
    result.shots.push(gridFile);
    await cdp.eval(`window.__e3d.clickToggle('grid')`);
    await sleep(1400);

    result.controls = controls;

    // 12c. 单台特征化验收：16 台设备逐台聚焦截图 + 两两可区分
    //      「16 个设备应该每一个都做得很具体，不要 16 台设备一锅端」
    await cdp.eval(`window.__e3d.clickView('orbit')`);
    await sleep(1200);
    const deviceIds = await cdp.eval(`(() => {
      const sel = document.querySelector('[data-testid="equipment3d-device-select"]');
      return sel ? [...sel.options].map((o) => o.value).filter(Boolean) : [];
    })()`);
    const fpGeom = await cdp.eval(`window.__e3d.canvas()`);
    const perDevice = {};
    const fps = {};
    for (const id of deviceIds) {
      const ok = await cdp.eval(`(() => {
        const sel = document.querySelector('[data-testid="equipment3d-device-select"]');
        if (!sel) return false;
        sel.value = ${JSON.stringify(id)};
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      if (!ok) {
        perDevice[id] = { error: 'select-failed' };
        continue;
      }
      // 等相机阻尼收敛 + 三个接口返回
      await sleep(4200);
      const file = path.join(OUT_DIR, `device-${id}.png`);
      await cdp.screenshot(file);
      result.shots.push(file);
      fps[id] = await cdp.fingerprint(file, fpGeom);
      const a = await cdp.eval(`window.__e3d.analysis()`);
      perDevice[id] = {
        equipmentId: a?.equipmentId,
        status: a?.status,
        health: a?.health,
        signature: a?.signature,
        series: a?.charts?.map((c) => `${c.series}:${c.text}`),
        hasOrders: !!a?.orders,
        shot: file,
      };
    }
    const ids = Object.keys(perDevice).filter((k) => perDevice[k].equipmentId);
    result.perDevice = perDevice;
    result.perDeviceSummary = {
      count: deviceIds.length,
      shotCount: ids.length,
      // 每台设备的聚焦画面指纹必须两两不同 —— 这是「两两可区分」的机器可判据
      distinctFrames: new Set(ids.map((k) => fps[k])).size,
      allDistinct: ids.length > 0 && new Set(ids.map((k) => fps[k])).size === ids.length,
      distinctSignatures: new Set(Object.values(perDevice).map((d) => d.signature)).size,
      // 每台都必须拿到真实接口数据（健康分 + 3 条时序 + 状态）
      withHealth: Object.values(perDevice).filter((d) => d.health).length,
      withThreeSeries: Object.values(perDevice).filter((d) => (d.series || []).length === 3).length,
      // 状态必须与台账一致（不允许多台设备一个状态）
      statuses: [...new Set(Object.values(perDevice).map((d) => d.status))].sort(),
    };

    // 关键对照对：3# vs 5#（箱体+油站 vs 8 级长筒体）、10# vs 15#（橘色夹爪 vs 白色吸盘）
    const pairs = [
      ['eq-103', 'eq-105'],
      ['eq-110', 'eq-115'],
    ];
    result.keyPairs = pairs.map(([a, b]) => ({
      pair: `${a} vs ${b}`,
      frameDistance: fps[a] && fps[b] ? +(fps[a] === fps[b] ? 0 : 1).toFixed(3) : null,
      distinctFrame: fps[a] && fps[b] ? fps[a] !== fps[b] : null,
      a: { signature: perDevice[a]?.signature, status: perDevice[a]?.status },
      b: { signature: perDevice[b]?.signature, status: perDevice[b]?.status },
      shots: [perDevice[a]?.shot, perDevice[b]?.shot].filter(Boolean),
    }));

    // 12d. 状态驱动动画：故障设备画面应逐帧变化，待机设备应静止
    //      「状态颜色与动画来自设备真实 status 字段」—— 这是该断言的可执行形式
    // 只对画布**中心区域**做差分：HUD 芯片（fps / 构建耗时）每帧都在刷新文字，
    // 若把整块画布都算进去，静止设备也会测出 0.0018 左右的"假运动"。
    // 相机聚焦后设备就在画面中心，取中心 46%×56% 即可只覆盖设备本体。
    const motionRect = {
      x: Math.round(fpGeom.x + fpGeom.w * 0.27),
      y: Math.round(fpGeom.y + fpGeom.h * 0.22),
      w: Math.round(fpGeom.w * 0.46),
      h: Math.round(fpGeom.h * 0.56),
    };

    const motionProbe = async (id, label) => {
      await cdp.eval(`(() => {
        const sel = document.querySelector('[data-testid="equipment3d-device-select"]');
        if (!sel) return false;
        sel.value = ${JSON.stringify(id)};
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      // 先等相机阻尼收敛（否则测到的是相机在动，不是设备在动）
      await sleep(5000);
      const f1 = path.join(OUT_DIR, `motion-${label}-1.png`);
      const f2 = path.join(OUT_DIR, `motion-${label}-2.png`);
      await cdp.screenshot(f1);
      await sleep(700);
      await cdp.screenshot(f2);
      result.shots.push(f1, f2);
      return {
        id,
        status: perDevice[id]?.status,
        diff: await cdp.diffShots(f1, f2, motionRect),
        // 整画布差分一并留档，便于对照说明 HUD 文字刷新带来的噪声
        diffFullCanvas: await cdp.diffShots(f1, f2, fpGeom),
      };
    };
    result.motion = {
      // 4 台设备跨 4 种状态：待机（应静止）作噪声地板，其余状态应显著高于地板。
      // 只测 1 台无法排除"画面里恰好有别的设备在动"的干扰，所以用横向对比。
      standby: await motionProbe('eq-114', 'standby-114'),
      running: await motionProbe('eq-104', 'running-104'),
      warning: await motionProbe('eq-110', 'warning-110'),
      fault: await motionProbe('eq-112', 'fault-112'),
      critical: await motionProbe('eq-103', 'critical-103'),
    };
    result.motion.animatedChips = await cdp.eval(`window.__e3d.chips()`);

    // 判据说明（重要）：
    // 这一组是**诊断性证据**，不是通过/失败判据。
    // 原因：厂房里有一台常动的行车（scene.ts update() 里 craneT 持续推进），
    // 它是否落在取景框内取决于每台设备的机位角度 —— 于是"画面变化量"里
    // 混入了与设备状态无关的成分。实测同一脚本两次运行，待机与故障的排序会翻转，
    // 足以说明像素差分**无法**隔离"单台设备自身在动"。
    // 因此"状态驱动动画"的判据放在确定性单测里：
    //   tests/equipment3d-recipes.test.ts
    //     - animActive 对 8 种状态 × 4 类动画的完整映射
    //     - 每台设备是否真的装了动画零件、旋转件是否带非对称特征（叶片/键）
    //     - 5#/15# running 态确有运动、14# standby 态完全静止
    {
      const rows = ['standby', 'running', 'warning', 'fault', 'critical'].map((k) => ({
        status: k,
        device: result.motion[k].id,
        label: result.motion[k].status,
        ratio: result.motion[k].diff.changedRatio,
        ratioFullCanvas: result.motion[k].diffFullCanvas.changedRatio,
      }));
      result.motion.diagnostic = {
        note: '诊断性数据，不作通过判据：画面变化量受常动行车（与设备状态无关）干扰，无法隔离单台设备的动画。',
        rows,
        animatedInstances: result.motion.animatedChips.animated,
      };
    }

    // 12e. 预设降级为「环境」：同一台设备的专属特征在 3 套预设下必须完全一致
    //      （设备配方按 id 固定，不随预设变化 —— 这是 B3 的可执行判据）
    const presetInvariance = {};
    for (const pid of ['standard', 'heavy', 'yard']) {
      await cdp.eval(`window.__e3d.clickPreset(${JSON.stringify(pid)})`);
      await sleep(2600);
      // 预设切换会重建场景，重新选中同一台设备
      await cdp.eval(`(() => {
        const sel = document.querySelector('[data-testid="equipment3d-device-select"]');
        if (!sel) return false;
        sel.value = 'eq-110';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      await sleep(3600);
      const a = await cdp.eval(`window.__e3d.analysis()`);
      const file = path.join(OUT_DIR, `preset-${pid}-eq-110.png`);
      await cdp.screenshot(file);
      result.shots.push(file);
      presetInvariance[pid] = { signature: a?.signature, status: a?.status, health: a?.health, shot: file };
    }
    const sigs = Object.values(presetInvariance).map((v) => v.signature);
    result.presetInvariance = {
      detail: presetInvariance,
      signatureIdentical: sigs.length === 3 && new Set(sigs).size === 1,
    };
    // 回到默认预设
    await cdp.eval(`window.__e3d.clickPreset('standard')`);
    await sleep(2600);

    // 13. 降级验证（硬性验收 2 的后半句：后端不可用时必须优雅降级而非崩溃）
    //     用 CDP 在浏览器侧拦截接口来复现"后端宕机"，分两层验证：
    //       13a) 3D 页面级：应用已正常启动，但设备台账接口挂掉 → 必须回退到已加载的真实数据
    //            并给出明确提示，绝不白屏、绝不抛未捕获异常、绝不用随机数编状态。
    //       13b) 应用级：后端整体不可用 → 必须给出可重试的兜底屏，而不是崩溃或空白页。
    //     注意：这是把真实故障场景在网络层复现，不是测试后门。
    await cdp.send('Network.enable');
    const BLOCKED = ['*/api/v1/equipments*', '*/api/v1/work-orders*'];
    const pageErrorsBeforeOffline = cdp.pageErrors.length;
    const consoleBeforeOffline = cdp.consoleErrors.length;

    // ---- 13a. 3D 页面级降级：接口挂掉后回退到缓存并给出提示 ----
    await cdp.send('Network.setBlockedURLs', { urls: BLOCKED });
    // 切走再切回，强制 3D 视图重新挂载并重新请求接口（若期间被 HMR 重载打断则自愈）
    if (!(await ensure3DView(cdp, result, 'ensure-3d-before-degrade'))) {
      throw new Error('降级验证前无法进入 3D 场景');
    }
    await cdp.eval(`document.querySelector('#nav-tab-equipments')?.click(); 'ok'`);
    await sleep(1200);
    await cdp.eval(`document.querySelector('#nav-tab-equipment_3d').click(); 'ok'`);
    await cdp.eval(HELPERS);
    await cdp.waitFor(`!!window.__e3d.canvas()`, { timeout: 45000, label: '降级态 WebGL 画布' });
    await sleep(2600);

    // 提示条必须真的"看得见"：只断言存在还不够 —— 它可能被参数面板盖住（曾经就发生过）。
    // 用 elementFromPoint 命中测试来判断是否被遮挡。
    const warningGeom = await cdp.eval(`(() => {
      const el = document.querySelector('[data-testid="equipment3d-source-warning"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const top = document.elementFromPoint(cx, cy);
      const inside = r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
      return {
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        inViewport: inside,
        occluded: !(top === el || el.contains(top)),
        coveringElement:
          top && top !== el ? (top.getAttribute('data-testid') || String(top.className).slice(0, 70)) : null,
      };
    })()`);

    const offlineFile = path.join(OUT_DIR, 'offline-cache-fallback.png');
    await cdp.screenshot(offlineFile);
    const offlinePx = await cdp.analyzeShot(offlineFile);
    result.offline = {
      layer: '3d-view',
      blockedUrls: BLOCKED,
      canvasPresent: await cdp.eval(`!!window.__e3d.canvas()`),
      sourceWarningVisible: await cdp.eval(
        `!!document.querySelector('[data-testid="equipment3d-source-warning"]')`
      ),
      emptyVisible: await cdp.eval(`window.__e3d.emptyVisible()`),
      chips: await cdp.eval(`window.__e3d.chips()`),
      legend: await cdp.eval(`window.__e3d.legend()`),
      warningGeom,
      pixels: offlinePx,
      shot: offlineFile,
      newPageErrors: cdp.pageErrors.slice(pageErrorsBeforeOffline),
      newConsoleEntries: cdp.consoleErrors.slice(consoleBeforeOffline).map((e) => e.text),
    };
    result.shots.push(offlineFile);

    // ---- 13b. 应用级降级：后端整体不可用 → 兜底屏（可重试），不是崩溃 ----
    await cdp.send('Page.reload', { ignoreCache: false });
    await cdp.waitFor(
      `!!document.querySelector('form input[type="text"]') || /后端数据加载失败/.test(document.body.innerText)`,
      { timeout: 60000, label: '降级重载后的登录页或兜底屏' }
    );
    if (await cdp.eval(`!!document.querySelector('form input[type="text"]')`)) {
      const relogin = await cdp.eval(LOGIN_JS);
      result.steps.push({ step: 'offline-relogin', result: relogin });
      if (relogin !== 'submitted') throw new Error(`降级态重新登录失败: ${relogin}`);
    }
    // 后端不可用时，应用必须停在可重试的兜底屏上（而不是空白/崩溃）
    await cdp.waitFor(`/后端数据加载失败/.test(document.body.innerText)`, {
      timeout: 45000,
      label: '应用级后端失败兜底屏',
    });
    // 整页重载会清掉注入的辅助对象，这里重新注入以便断言
    await cdp.eval(HELPERS);
    const appFallbackFile = path.join(OUT_DIR, 'offline-app-fallback.png');
    await cdp.screenshot(appFallbackFile);
    result.appFallback = {
      layer: 'app-boot',
      loadErrorVisible: await cdp.eval(`window.__e3d.loadErrorVisible()`),
      hasRetryButton: await cdp.eval(
        `[...document.querySelectorAll('button')].some(b => /重新加载数据/.test(b.textContent))`
      ),
      hasLogoutButton: await cdp.eval(
        `[...document.querySelectorAll('button')].some(b => /返回重新登录/.test(b.textContent))`
      ),
      bodyText: (await cdp.eval('document.body.innerText')).replace(/\\s+/g, ' ').slice(0, 300),
      pixels: await cdp.analyzeShot(appFallbackFile),
      shot: appFallbackFile,
    };
    result.shots.push(appFallbackFile);

    // 恢复网络
    await cdp.send('Network.setBlockedURLs', { urls: [] });
    // 恢复网络，避免影响后续判定
    await cdp.send('Network.setBlockedURLs', { urls: [] });

    // 14. 收集报错。区分四类：
    //     a) 既有且预期内的噪声（report-only CSP 提示；未登录时的 /auth/me 会话探测 401）
    //     b) 验收脚本自身造成的提示（截图取像素的 GPU stall；读小地图像素的 Canvas2D 提示）
    //     c) 第 13 步故意拦截接口造成的网络错误（预期内，属验证手段本身）
    //        —— 仅限 13 步开始之后采集到的条目，避免把正常阶段的错误误判为"预期"
    //     d) 真正的应用异常 —— 只有 d) 才算失败
    const PREEXISTING = [
      /upgrade-insecure-requests.*report-only/i,
      // 未登录状态下应用会探测当前会话，401 是正确响应（随后展示登录页），不是缺陷
      /401 \(Unauthorized\).*\/api\/v1\/auth\/me/i,
    ];
    const HARNESS_ARTIFACT = [
      /GL Driver Message.*ReadPixels/i,
      /GPU stall due to ReadPixels/i,
      // 验收脚本用 getImageData 读小地图像素来判断"是否真的画了东西"，会触发这条 Canvas2D 提示
      /Canvas2D: Multiple readback operations/i,
    ];
    const OFFLINE_INDUCED = [
      /Failed to fetch/i,
      /ERR_BLOCKED_BY_CLIENT/i,
      /Failed to load resource/i,
      /设备台账接口不可用/i,
      /Backend API full sync error/i,
    ];
    // 用对象引用界定"13 步之后"的条目（filter 保留引用，可安全比对）
    const afterOffline = new Set(cdp.consoleErrors.slice(consoleBeforeOffline));
    const all = cdp.consoleErrors.filter((e) => !/favicon|Download the React DevTools/i.test(e.text));
    const isPreexisting = (e) => PREEXISTING.some((re) => re.test(e.text));
    const isHarness = (e) => !isPreexisting(e) && HARNESS_ARTIFACT.some((re) => re.test(e.text));
    const isOfflineInduced = (e) =>
      !isPreexisting(e) && !isHarness(e) && afterOffline.has(e) && OFFLINE_INDUCED.some((re) => re.test(e.text));

    result.errors.preExisting = all.filter(isPreexisting);
    result.errors.harnessArtifacts = all.filter(isHarness);
    result.errors.offlineInduced = all.filter(isOfflineInduced);
    result.errors.console = all.filter((e) => !isPreexisting(e) && !isHarness(e) && !isOfflineInduced(e));
    result.errors.page = cdp.pageErrors;
    result.finishedAt = new Date().toISOString();

    // 通过条件（逐项列出，避免"只看有没有报错"这种空泛结论）：
    //  1. 无未捕获异常；无真实控制台 error。
    //     降级阶段同样必须无未捕获异常 —— 这正是"优雅降级"的硬指标。
    //  2. Part B「单台特征化」：16 台全部取到真实接口数据、聚焦画面两两可区分、
    //     辨识特征互不相同、关键对照对（3# vs 5#、10# vs 15#）可区分。
    //  3. Part B3：切换预设不改变设备个体特征。
    //  4. 参数面板控件确实生效（视角/高亮/密度/网格）且页签切换正常。
    //  注意：「状态驱动动画」刻意不在这里判 —— 像素差分会被常动行车污染（见 motion.diagnostic），
    //  该判据由 tests/equipment3d-recipes.test.ts 以确定性单测覆盖。
    const b = result.perDeviceSummary ?? {};
    const c = result.controls ?? {};
    result.checks = {
      noPageErrors: result.errors.page.length === 0,
      noRealConsoleErrors: result.errors.console.filter((e) => e.level === 'error').length === 0,
      sixteenDevices: b.count === 16 && b.shotCount === 16,
      framesAllDistinct: b.allDistinct === true,
      signaturesAllDistinct: b.distinctSignatures === 16,
      realDataOnEveryDevice: b.withHealth === 16 && b.withThreeSeries === 16,
      keyPairsDistinct: (result.keyPairs ?? []).every((p) => p.distinctFrame === true),
      presetInvariance: result.presetInvariance?.signatureIdentical === true,
      // AI 诊断必须真的渲染出结论（降级兜底也算结论），而不是永远停在"研判中…"
      aiDiagnoseRendered: !!(result.analysisAfterDiagnose?.ai || result.analysisAfterDiagnose?.aiError),
      paramsControlsEffective:
        c.viewsDistinct === true &&
        c.highlight?.afterOff?.state === 'false' &&
        c.highlight?.afterOn?.state === 'true' &&
        c.density?.eight?.devices === '8' &&
        c.density?.sixteen?.devices === '16' &&
        c.grid?.before === 'true' &&
        c.grid?.after === 'false' &&
        c.tabs?.paramsControlsPresent === true &&
        c.tabs?.analysisPanelPresent === false,
    };
    result.ok = Object.values(result.checks).every(Boolean);
  } catch (err) {
    result.fatal = err.message;
    result.chromeLog = chromeLog.slice(-4000);
    // 失败时尽量留下页面现场，便于定位（不涉及任何凭据）
    try {
      if (cdp) {
        result.diag = {
          url: await cdp.eval('location.href'),
          hasHost: await cdp.eval(`!!document.querySelector('[data-testid="equipment3d-host"]')`),
          hasCanvas: await cdp.eval(`!!document.querySelector('canvas')`),
          activeNav: await cdp.eval(`document.querySelector('[id^="nav-tab-"].bg-blue-50, [id^="nav-tab-"][class*="bg-blue"]')?.id || null`),
          bodyText: (await cdp.eval('document.body.innerText')).slice(0, 600),
        };
      }
    } catch {
      /* 现场采集失败不影响主结论 */
    }
    result.finishedAt = new Date().toISOString();
    result.ok = false;
  } finally {
    cdp?.close();
    cleanup();
  }

  const jsonPath = path.join(OUT_DIR, 'verify-result.json');
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  console.log(`\n截图目录: ${OUT_DIR}`);
  if (!result.ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exitCode = 1;
});
