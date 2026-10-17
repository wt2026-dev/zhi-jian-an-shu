/**
 * Part A 验收脚本 —— 全局限流误伤修复（429 假掉线）的端到端验证。
 *
 * 背景：/api/v1/* 共用一个「每 IP 每分钟」计数器。一次页面加载会打出十余个接口，
 * 演示时快速切页/连续刷新可在 60 秒内逼近旧阈值 240，触发 429；
 * 一旦命中 /auth/me（会话恢复探针），前端会误判未登录而弹回登录页 ——
 * 现象与崩溃无法区分，且 60 秒后自动恢复。
 *
 * 本脚本验证四件事：
 *   1) 连续 12 次整页刷新（F5）：不出现 429，不被打回登录页
 *   2) 快速菜单切换（6 个页签 × 4 轮）：不出现 429
 *   3) /auth/me 豁免：单页刷新期间该接口不计入全局配额
 *   4) 登录防爆破未被削弱：连续输错密码仍会锁定 IP
 *      —— 注意：该步会把演示 IP 锁定 15 分钟，所以放在最后；
 *         跑完请重启服务（内存态）以清除锁定。
 *
 * 零第三方依赖：Node 22 内置 WebSocket + fetch，直接驱动 CDP。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const PORT = Number(process.env.CDP_PORT || 9351);
const USER = process.env.DEMO_USER || 'admin';
const PASS = process.env.DEMO_PASS || 'Admin@2026#Demo';
const OUT_DIR = process.env.OUT_DIR || path.resolve('docs/ratelimit-shots');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const cands = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    (process.env.LOCALAPPDATA || '') + '/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ];
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  throw new Error('未找到 Chrome/Edge');
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.pageErrors = [];
    /** 观测到的全部 HTTP 响应状态（含 429 计数） */
    this.responses = [];
    this.listeners = new Map();
  }
  open() {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('CDP 连接超时')), 20000);
      this.ws.addEventListener('open', () => { clearTimeout(t); resolve(); });
      this.ws.addEventListener('error', () => { clearTimeout(t); reject(new Error('CDP 连接失败')); });
      this.ws.addEventListener('message', (ev) => this.#on(ev.data));
    });
  }
  #on(raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.id != null) {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message));
      else p.resolve(m.result);
      return;
    }
    if (m.method === 'Network.responseReceived') {
      const r = m.params?.response;
      if (r) this.responses.push({ url: r.url, status: r.status, type: m.params.type });
    } else if (m.method === 'Runtime.consoleAPICalled') {
      const type = m.params?.type;
      if (type === 'error' || type === 'warning') {
        this.consoleErrors.push({ level: type, text: (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ') });
      }
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params?.exceptionDetails;
      this.pageErrors.push({ text: d?.exception?.description || d?.text || 'unknown' });
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params?.entry;
      if (e && (e.level === 'error' || e.level === 'warning')) this.consoleErrors.push({ level: e.level, text: `${e.text} ${e.url || ''}`.trim() });
    }
    const fns = this.listeners.get(m.method);
    if (fns) for (const fn of fns) fn(m.params);
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP 超时 ${method}`)); } }, 60000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  }
  async waitFor(expression, { timeout = 30000, interval = 250, label = expression } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try { if (await this.eval(expression)) return true; } catch {}
      await sleep(interval);
    }
    throw new Error(`等待超时 (${label})`);
  }
  async screenshot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }
  close() { try { this.ws.close(); } catch {} }
  /** 自某个下标起新增的响应 */
  since(n) { return this.responses.slice(n); }
}

const LOGIN_JS = (user, pass) => `(() => {
  const u = document.querySelector('form input[type="text"]');
  const p = document.querySelector('form input[type="password"]');
  if (!u || !p) return 'no-form';
  const set = (el, v) => {
    const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value');
    d.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set(u, ${JSON.stringify(user)});
  set(p, ${JSON.stringify(pass)});
  const btn = [...document.querySelectorAll('button')].find((b) => /登录|登 录/.test(b.textContent));
  if (!btn) return 'no-button';
  btn.click();
  return 'submitted';
})()`;

const DISMISS_JS = `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '跳过'); if (b) { b.click(); return 'skipped'; } return null; })()`;

/** 应用外壳已就绪（侧边栏存在）＝ 没有被踢回登录页 */
const SHELL_READY = `!!document.querySelector('#nav-tab-equipment_3d') && !document.querySelector('form input[type="password"]')`;
const ON_LOGIN = `!!document.querySelector('form input[type="password"]')`;

/** 快速切换的页签（均为 src/components/layout/navConfig.ts 里真实存在的 id） */
const NAV_TABS = [
  '#nav-tab-equipment_3d',
  '#nav-tab-equipments',
  '#nav-tab-cockpit',
  '#nav-tab-dashboard',
  '#nav-tab-work_orders',
  '#nav-tab-health',
  '#nav-tab-inspections',
  '#nav-tab-dispatch',
];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));
  const child = spawn(chrome, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1600,1000',
    'about:blank',
  ], { stdio: 'ignore' });

  let cdp = null;
  const result = {
    ok: false,
    baseUrl: BASE_URL,
    startedAt: new Date().toISOString(),
    refreshes: [],
    navSwitching: null,
    authMe: null,
    bruteForce: null,
  };

  try {
    let target = null;
    for (let i = 0; i < 60; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        const page = list.find((t) => t.type === 'page');
        if (page) { target = page; break; }
      } catch {}
      await sleep(500);
    }
    if (!target) throw new Error('未能连接调试端口');

    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

    // ---- 首次登录 ----
    await cdp.send('Page.navigate', { url: BASE_URL });
    await sleep(2500);
    if (await cdp.eval(ON_LOGIN)) {
      result.firstLogin = await cdp.eval(LOGIN_JS(USER, PASS));
      await sleep(3000);
    }
    await cdp.eval(DISMISS_JS);
    await cdp.waitFor(SHELL_READY, { timeout: 40000, label: '首次进入应用外壳' });

    // ---- 步骤 1：连续 12 次整页刷新 ----
    // 每轮都记录：是否被打回登录页、本轮新增的 429 数量、/auth/me 的响应状态
    const REFRESHES = 12;
    for (let i = 1; i <= REFRESHES; i++) {
      const mark = cdp.responses.length;
      const t0 = Date.now();
      await cdp.send('Page.reload', { ignoreCache: false });
      // 等应用外壳或登录页出现
      await cdp.waitFor(`${SHELL_READY} || ${ON_LOGIN}`, { timeout: 45000, label: `第 ${i} 次刷新后页面就绪` });
      const bounced = await cdp.eval(ON_LOGIN);
      if (!bounced) {
        // 确认真正进入外壳（而非停在登录页）
        try { await cdp.waitFor(SHELL_READY, { timeout: 25000, label: `第 ${i} 次刷新后外壳就绪` }); } catch {}
      }
      await cdp.eval(DISMISS_JS);
      await sleep(900);
      const added = cdp.since(mark);
      const r429 = added.filter((r) => r.status === 429);
      const meCalls = added.filter((r) => /\/api\/v1\/auth\/me/.test(r.url));
      result.refreshes.push({
        round: i,
        ms: Date.now() - t0,
        bouncedToLogin: bounced,
        apiRequests: added.filter((r) => r.type === 'Fetch' || r.type === 'XHR').length,
        count429: r429.length,
        urls429: r429.map((r) => r.url),
        authMeStatuses: meCalls.map((r) => r.status),
      });
      if (bounced) {
        // 若被踢回登录页，重新登录以便继续（并把这一轮如实记录为失败）
        await cdp.eval(LOGIN_JS(USER, PASS));
        await sleep(2600);
        await cdp.eval(DISMISS_JS);
        await cdp.waitFor(SHELL_READY, { timeout: 30000, label: `第 ${i} 轮补登录` });
      }
    }
    const refreshFile = path.join(OUT_DIR, 'after-12-refreshes.png');
    await cdp.screenshot(refreshFile);
    result.refreshShot = refreshFile;

    // ---- 步骤 2：快速菜单切换（6 个页签 × 4 轮，间隔 350ms） ----
    const navMark = cdp.responses.length;
    const navErrors = [];
    for (let round = 0; round < 4; round++) {
      for (const sel of NAV_TABS) {
        const ok = await cdp.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
        if (!ok) navErrors.push(sel);
        await sleep(350);
      }
    }
    await sleep(2500);
    const navAdded = cdp.since(navMark);
    result.navSwitching = {
      rounds: 4,
      tabsPerRound: NAV_TABS.length,
      missingTabs: navErrors,
      apiRequests: navAdded.filter((r) => r.type === 'Fetch' || r.type === 'XHR').length,
      count429: navAdded.filter((r) => r.status === 429).length,
      urls429: navAdded.filter((r) => r.status === 429).map((r) => r.url),
      bouncedToLogin: await cdp.eval(ON_LOGIN),
    };
    const navFile = path.join(OUT_DIR, 'after-rapid-nav.png');
    await cdp.screenshot(navFile);
    result.navShot = navFile;

    // ---- 步骤 3：/auth/me 豁免的直接验证 ----
    // 直接连打 300 次 /auth/me（远超旧的 240 阈值），必须全部 200。
    // 同时对照：同一 IP 下非豁免接口仍会正常计数（这里只读响应头，不制造 429）。
    result.authMe = await cdp.eval(`(async () => {
      const codes = {};
      for (let i = 0; i < 300; i++) {
        const r = await fetch('/api/v1/auth/me', { credentials: 'include' });
        codes[r.status] = (codes[r.status] || 0) + 1;
      }
      const probe = await fetch('/api/v1/equipments', { credentials: 'include' });
      return {
        me: codes,
        meTotal: Object.values(codes).reduce((a, b) => a + b, 0),
        meAll200: codes['200'] === 300,
        otherStatus: probe.status,
        otherRemaining: probe.headers.get('X-RateLimit-Remaining'),
        otherLimit: probe.headers.get('X-RateLimit-Limit'),
      };
    })()`);

    // ---- 步骤 4：登录防爆破未被削弱（放最后：会锁定 IP 15 分钟） ----
    // 直接打登录接口（同源 fetch，IP 与前面完全一致），不再走 UI：
    // 会话现在能跨刷新保持，所以"重新打开页面会看到登录页"这个前提已不成立。
    result.bruteForce = await cdp.eval(`(async () => {
      const out = [];
      for (let i = 1; i <= 6; i++) {
        const r = await fetch('/api/v1/auth/login', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'admin', password: 'wrong-password-' + i }),
        });
        let code = null, remaining = null;
        try { const j = await r.json(); code = j.code || null; remaining = j.remainingSeconds ?? null; } catch {}
        out.push({ attempt: i, status: r.status, code, remainingSeconds: remaining });
      }
      return out;
    })()`);
    const attempts = result.bruteForce || [];
    result.bruteForceSummary = {
      attempts,
      locked: attempts.some((x) => x.status === 429 && x.code === 'IP_LOCKED'),
      lockedAtAttempt: (attempts.find((x) => x.status === 429) || {}).attempt ?? null,
      firstFiveRejected: attempts.slice(0, 5).every((x) => x.status === 401),
    };
    const bfFile = path.join(OUT_DIR, 'brute-force-locked.png');
    await cdp.screenshot(bfFile);
    result.bruteForceShot = bfFile;

    result.newPageErrors = cdp.pageErrors;
    // 控制台噪声分类：只有"既非预期、也非本脚本故意制造"的条目才算失败。
    //   - favicon / report-only CSP 提示：既有噪声
    //   - 未登录时 /auth/me 的 401：应用的会话探测，正确行为
    //   - 步骤 4 故意用错误密码登录产生的 401 / 429：验证手段本身，不是缺陷
    const PREEXISTING = [/favicon/i, /upgrade-insecure-requests/i, /401 \(Unauthorized\).*\/api\/v1\/auth\/me/i];
    const HARNESS_INDUCED = [
      /401 \(Unauthorized\).*\/api\/v1\/auth\/login/i,
      /429 \(Too Many Requests\).*\/api\/v1\/auth\/login/i,
      /GL Driver Message.*ReadPixels/i,
      /GPU stall due to ReadPixels/i,
      /Canvas2D: Multiple readback operations/i,
    ];
    const all = cdp.consoleErrors;
    const isPre = (e) => PREEXISTING.some((re) => re.test(e.text));
    const isHarness = (e) => !isPre(e) && HARNESS_INDUCED.some((re) => re.test(e.text));
    result.errors = {
      preExisting: all.filter(isPre),
      harnessInduced: all.filter(isHarness),
      real: all.filter((e) => !isPre(e) && !isHarness(e)),
    };
    result.finishedAt = new Date().toISOString();

    const no429 =
      result.refreshes.every((r) => r.count429 === 0) && result.navSwitching.count429 === 0;
    const noBounce = result.refreshes.every((r) => !r.bouncedToLogin) && !result.navSwitching.bouncedToLogin;
    result.summary = {
      no429,
      noBounce,
      authMeExempt: result.authMe?.meAll200 === true,
      bruteForceStillLocks: result.bruteForceSummary?.locked === true,
      bruteForceFirstFiveRejected: result.bruteForceSummary?.firstFiveRejected === true,
      noPageErrors: result.newPageErrors.length === 0,
      // 关键量化：12 次刷新累计的接口请求数。旧阈值 240 在此必然被击穿，
      // 新阈值 600 与 /auth/me 豁免共同保证不出现 429。
      totalApiRequestsAcrossRefreshes: result.refreshes.reduce((a, r) => a + r.apiRequests, 0),
      total429AcrossRefreshes: result.refreshes.reduce((a, r) => a + r.count429, 0),
    };
    result.ok =
      no429 &&
      noBounce &&
      result.summary.authMeExempt &&
      result.summary.bruteForceStillLocks &&
      result.summary.bruteForceFirstFiveRejected &&
      result.newPageErrors.length === 0 &&
      result.errors.real.length === 0;
  } catch (e) {
    result.fatal = e.message;
    if (cdp) {
      result.newPageErrors = cdp.pageErrors;
      try { result.bodyText = (await cdp.eval('document.body.innerText')).slice(0, 400); } catch {}
    }
  } finally {
    cdp?.close();
    try { child.kill(); } catch {}
    await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }

  fs.writeFileSync(path.join(OUT_DIR, 'ratelimit-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exitCode = 1;
});
