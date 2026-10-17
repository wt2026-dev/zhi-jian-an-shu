#!/usr/bin/env node
/**
 * 「明亮次世代游戏感（Bright Game-HUD）」前端视觉重构 —— 验收取证脚本（零第三方依赖）。
 *
 * 做三件事：
 *   1. 真实登录（走真实登录表单，不绕过鉴权），逐个打开被改造的视图并截图；
 *   2. 对关键设计令牌做**计算样式探针**（背板层、磨砂卡、金边胶囊、声波仪、呼吸动画…），
 *      把"看起来对不对"变成可复核的数值，而不是只看一张图；
 *   3. 收集控制台报错，确保改造没有引入运行时异常。
 *
 * 用法：
 *   node scripts/verify-ui-hud.mjs
 * 环境变量：
 *   UI_BASE  默认 http://127.0.0.1:3000      （改造后的 dev server）
 *   UI_OUT   默认 scratch/ui-hud              （截图输出目录）
 *   UI_TAG   默认 after                       （文件名前缀；跑旧产物基线时传 before）
 *   UI_STRICT 默认 1                          （=1 时对"改造后应成立"的探针做硬断言）
 *   UI_GPU=1                                 启用真实 GPU（d3d11）而非 SwiftShader
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.UI_BASE || 'http://127.0.0.1:3000';
const OUT = process.env.UI_OUT || 'scratch/ui-hud';
const TAG = process.env.UI_TAG || 'after';
const STRICT = (process.env.UI_STRICT ?? '1') === '1';
const USER = process.env.UI_USER || 'admin';
const PASS = process.env.UI_PASS || 'Admin@2026#Demo';
const PORT = Number(process.env.UI_CDP_PORT || 9351);

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

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.logs = [];
    ws.addEventListener('message', (ev) => {
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
        this.logs.push({
          level: m.params.type,
          text: (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' '),
        });
      } else if (m.method === 'Runtime.exceptionThrown') {
        this.logs.push({
          level: 'pageerror',
          text: m.params?.exceptionDetails?.exception?.description || 'unknown',
        });
      }
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
  async waitFor(expr, timeout = 30000) {
    const t0 = Date.now();
    for (;;) {
      try {
        if (await this.eval(`!!(${expr})`)) return true;
      } catch {
        /* 导航中，忽略 */
      }
      if (Date.now() - t0 > timeout) return false;
      await sleep(300);
    }
  }
}

/** 在页面里跑的通用探针：把关键类的计算样式抓回来 */
const PROBE = `(() => {
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const pick = (el, keys) => {
    const s = cs(el);
    if (!s) return null;
    const o = {};
    for (const k of keys) o[k] = s[k];
    return o;
  };
  const q = (sel) => document.querySelector(sel);
  const bodyCS = cs(document.body);

  // 页面级外壳：历史上用不透明 bg-[#f8fafc] 把背板盖死
  const shell = Array.from(document.querySelectorAll('div'))
    .find((d) => typeof d.className === 'string' && d.className.includes('bg-[#f8fafc]'));

  const hud = q('.hud-card');
  const glass = q('.glass-card');
  const chip = q('.chip-gold');
  const ped = q('.hud-pedestal');
  const wave = q('[class*="wave-bar-"]');

  // 立绘包装层：带 mask + 呼吸动画的那一层
  const portrait = ped ? ped.parentElement.querySelector('[style*="digital-human-breath"]') : null;

  return {
    bodyBgImage: bodyCS.backgroundImage,
    bodyBgAttachment: bodyCS.backgroundAttachment,
    bodyBgColor: bodyCS.backgroundColor,
    shellFound: !!shell,
    shellBg: shell ? cs(shell).backgroundColor : null,
    hudCard: hud ? pick(hud, ['backdropFilter', 'borderRadius', 'boxShadow']) : null,
    glassCard: glass ? pick(glass, ['backdropFilter', 'borderRadius']) : null,
    chipGold: chip ? pick(chip, ['borderRadius', 'backgroundImage', 'display']) : null,
    pedestal: !!ped,
    pedestalShadow: ped ? cs(ped).boxShadow : null,
    portrait: portrait
      ? { maskImage: cs(portrait).maskImage || cs(portrait).webkitMaskImage, animationName: cs(portrait).animationName }
      : null,
    waveBars: document.querySelectorAll('[class*="wave-bar-"]').length,
    canvas3d: (() => {
      const c = document.querySelector('canvas');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), bufW: c.width, bufH: c.height };
    })(),
    waveformHud: (() => {
      const w = document.querySelector('[data-testid="waveform-hud"]');
      if (!w) return null;
      return { bars: Number(w.getAttribute('data-bars') || 0), active: w.getAttribute('data-active') === '1' };
    })(),
    pulseRings: document.querySelectorAll('.pulse-ring').length,
    fxParticles: document.querySelectorAll('.fx-particles').length,
    fxHex: document.querySelectorAll('.fx-hex').length,
    shadowScale: (() => {
      const r = cs(document.documentElement);
      return {
        lg: r.getPropertyValue('--shadow-lg').trim(),
        '2xl': r.getPropertyValue('--shadow-2xl').trim(),
        gold: r.getPropertyValue('--gold').trim(),
        glassBg: r.getPropertyValue('--glass-bg').trim(),
      };
    })(),
  };
})()`;

/** 全屏遮罩探针：取最上层"可见且不透明"的 .fixed.inset-0 全屏遮罩，判断它是明亮薄纱还是近黑死黑。
    判定用"合成到白底后的感知亮度"：遮罩是盖在明亮页面上的，用户看到的就是这个合成结果。
    为什么不用正则抠颜色数字：Tailwind v4 的 `color-mix(in oklab, …)` 在 Chrome 下计算值直接是
    `oklab(0 0 0 / 0.8)`（实测旧版 bg-black/80 就是这个），正则匹配 rgb() 会漏判成"不黑"——
    这正是第一版取证失败的真正原因。交给 canvas 解析，格式无关。 */
const MODAL_PROBE = `(() => {
  const all = Array.from(document.querySelectorAll('.fixed.inset-0'));
  const visible = all.filter((el) => {
    const r = el.getBoundingClientRect();
    const a = getComputedStyle(el).backgroundColor;
    return r.width > 100 && r.height > 100 && !/rgba?\\(0, 0, 0, 0\\)|oklab\\(0 0 0 \\/ 0\\)/.test(a);
  });
  const ov = visible[visible.length - 1];
  if (!ov) return { found: false, candidateCount: all.length };
  const cs = getComputedStyle(ov);

  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const ctx = cv.getContext('2d');
  const composite = (base) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = cs.backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const lum = (c) => Math.round(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]);
  let overWhite = null;
  let overBlack = null;
  try {
    overWhite = composite('#ffffff');
    overBlack = composite('#000000');
  } catch {
    /* 解析不了就留 null */
  }
  const whiteLum = overWhite ? lum(overWhite) : null;
  return {
    found: true,
    candidateCount: all.length,
    className: String(ov.className).slice(0, 140),
    bg: cs.backgroundColor,
    backdropFilter: cs.backdropFilter,
    overWhite: overWhite ? 'rgb(' + overWhite.join(', ') + ')' : null,
    overBlack: overBlack ? 'rgb(' + overBlack.join(', ') + ')' : null,
    luminance: whiteLum,
    isDark: whiteLum == null ? null : whiteLum < 80,
  };
})()`;

/** 滚动帧率探针（默认关闭，需 UI_FPS=1 显式开启）。
    为什么默认关闭：headless Chrome 下 requestAnimationFrame 基本不产出帧
    （实测 2 秒内只有 0~4 帧），得到的 fps 完全没有意义，贸然写进报告等于造假。
    真机帧率请用带 GPU 的 3D 验收脚本 scripts/verify-3d-identity.mjs 测量。 */
const FPS_PROBE = `(async () => {
  const scroller = document.querySelector('main');
  if (!scroller) return null;
  const frames = [];
  let last = performance.now();
  let stop = false;
  const tick = (t) => { frames.push(t - last); last = t; if (!stop) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const t0 = performance.now();
  const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  let dir = 1, pos = 0;
  while (performance.now() - t0 < 2000) {
    pos += dir * 30;
    if (pos > maxScroll) { pos = maxScroll; dir = -1; }
    if (pos < 0) { pos = 0; dir = 1; }
    scroller.scrollTop = pos;
    await new Promise((r) => setTimeout(r, 16));
  }
  stop = true;
  await new Promise((r) => setTimeout(r, 80));
  const d = frames.slice(3);
  const sorted = [...d].sort((a, b) => a - b);
  const avg = d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0;
  return {
    fps: avg > 0 ? Math.round(1000 / avg) : 0,
    frames: d.length,
    p95FrameMs: sorted.length ? Math.round(sorted[Math.floor(sorted.length * 0.95)]) : 0,
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
  };
})()`;

const VIEWS = [
  { key: 'dashboard', label: '总览看板', ready: 'main', wait: 4200 },
  { key: 'cockpit', label: '驾驶舱', ready: 'main', wait: 5200 },
  { key: 'ai_assistant', label: 'AI 助手', ready: 'main', wait: 6000 },
  { key: 'equipments', label: '设备档案', ready: 'main', wait: 4200 },
  { key: 'equipment_3d', label: '3D场景', ready: 'main', wait: 7000 },
];

async function main() {
  const outDir = path.resolve(OUT);
  fs.mkdirSync(outDir, { recursive: true });
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-hud-'));

  const args = [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--window-size=1680,1000',
    '--hide-scrollbars',
    `--user-data-dir=${userDir}`,
    'about:blank',
  ];
  if (process.env.UI_GPU === '1') args.push('--use-angle=d3d11');
  else args.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');

  const chrome = spawn(CHROME, args, { stdio: 'ignore' });
  const result = { tag: TAG, base: BASE, steps: [], views: [], consoleErrors: [], ok: true };
  let cdp;

  try {
    let targets = null;
    for (let i = 0; i < 40; i++) {
      try {
        targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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

    /* ---- 登录（走真实表单） ----
       坑 1：Vite dev 首次请求要现场编译，页面会空白数秒；
             若此时去查登录表单会误判为"已登录"，后面全是空页（踩过一次）。
       坑 2：本系统登录会话只在内存里，localStorage 为空，整页刷新即掉登录。 */
    await cdp.send('Page.navigate', { url: `${BASE}/?view=dashboard&onboarded=1` });

    let firstPaint = null;
    for (let i = 0; i < 120; i++) {
      try {
        firstPaint = await cdp.eval(`(() => ({
          hasForm: !!document.querySelector('form input[type="password"]'),
          hasMain: !!document.querySelector('main'),
          textLen: (document.body.innerText || '').length,
        }))()`);
      } catch {
        firstPaint = null;
      }
      if (firstPaint && (firstPaint.hasForm || firstPaint.hasMain)) break;
      await sleep(500);
    }
    if (!firstPaint || (!firstPaint.hasForm && !firstPaint.hasMain)) {
      throw new Error(`首屏始终未渲染（textLen=${firstPaint?.textLen ?? 'n/a'}）`);
    }

    await cdp.eval(`(() => {
      try { localStorage.setItem('onboarded_v2', '1'); } catch {}
      const skip = Array.from(document.querySelectorAll('button'))
        .find((b) => (b.textContent || '').trim() === '跳过');
      if (skip) skip.click();
      return 'ok';
    })()`);
    await sleep(500);

    let needLogin = firstPaint.hasForm;
    if (!needLogin) {
      needLogin = await cdp.eval(`!!document.querySelector('form input[type="password"]')`);
    }
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
      const loggedIn = await cdp.waitFor(`document.querySelector('main')`, 40000);
      if (!loggedIn) {
        const txt = await cdp.eval(`(document.body.innerText||'').slice(0,300)`);
        throw new Error(`登录后仍未出现主界面。页面文本: ${txt}`);
      }
    }
    result.steps.push({ step: 'login', result: needLogin ? 'submitted' : 'session-already-active' });

    /* ---- 逐视图截图 + 探针 ----
       重要：本系统的登录会话只存在内存里（登录后 localStorage 仍为空），
       所以每次 Page.navigate 全量刷新都会掉回登录页（这个坑踩过一次：4 张截图全是登录页）。
       因此登录后一律走 SPA 内导航（点侧边栏 #nav-tab-<key>），不再整页刷新。
       侧边栏存在「折叠 / 分组收起」两种状态，导航项会时有时无，
       故带重试 + 先展开分组头再重试（踩过一次：cockpit 直接 notfound 中止）。 */
    const clickNav = async (key, label) => {
      for (let attempt = 0; attempt < 14; attempt++) {
        let r = 'notfound';
        try {
          r = await cdp.eval(`(() => {
            const byId = document.getElementById('nav-tab-' + ${JSON.stringify(key)});
            if (byId) { byId.click(); return 'byId'; }
            let expanded = false;
            const headers = Array.from(document.querySelectorAll('button,[role="button"]'))
              .filter((x) => /^(综合看板|智能 ?AI|设备资产|检修作业|安全合规|知识中心|系统管理)$/.test((x.textContent || '').trim()));
            for (const h of headers) {
              if (h.getAttribute('aria-expanded') === 'false') { h.click(); expanded = true; }
            }
            const el = Array.from(document.querySelectorAll('button,a'))
              .find((x) => (x.textContent || '').trim() === ${JSON.stringify(label)});
            if (el) { el.click(); return 'byText'; }
            return expanded ? 'expanded' : 'notfound';
          })()`);
        } catch {
          r = 'notfound';
        }
        if (r === 'byId' || r === 'byText') return r;
        await sleep(450);
      }
      return 'notfound';
    };

    for (const v of VIEWS) {
      const clicked = await clickNav(v.key, v.label);
      if (clicked === 'notfound') throw new Error(`侧边栏未找到导航项: ${v.key} / ${v.label}`);
      await cdp.waitFor(`document.querySelector('main')`, 30000);
      await sleep(v.wait);

      // AI 助手：3D SDK 走外网 CDN，若不可达会 10s 后降级 2D；主动点"跳过"以稳定拿到 2D 立绘
      if (v.key === 'ai_assistant') {
        await cdp.eval(`(() => {
          const b = Array.from(document.querySelectorAll('button'))
            .find((x) => /跳过加载直接使用\\s*2D/.test(x.textContent || ''));
          if (b) b.click();
          return !!b;
        })()`);
        await cdp.waitFor(`document.querySelector('.hud-pedestal')`, 20000);
        await sleep(1500);
      }

      const probe = await cdp.eval(PROBE);
      let fps = null;
      if (process.env.UI_FPS === '1') {
        try {
          fps = await cdp.eval(FPS_PROBE);
        } catch {
          fps = null;
        }
      }
      const metrics = await cdp.send('Page.getLayoutMetrics');
      const cs2 = metrics.cssContentSize || metrics.contentSize;
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: cs2.width, height: Math.min(cs2.height, 4200), scale: 1 },
      });
      const file = path.join(outDir, `${TAG}-${v.key}.png`);
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));

      result.views.push({ key: v.key, label: v.label, navVia: clicked, file, contentHeight: cs2.height, probe, fps });
    }

    /* ---- 附加：全屏遮罩取证 ----
       本轮把 bg-black/80、bg-slate-900/40 这类近黑遮罩统一改成了明亮磨砂薄纱。
       这是全局性改动，必须单独取一张弹窗证据，否则"改坏了"不会被发现。

       取证点选两个，因为它们的"改造前"完全不同 —— 这一点是实测出来的，不是想当然：
         A. bg-black/80（工单详情抽屉）：旧产物 CSS 里**没有** [class*=bg-black] 兜底，
            所以旧版就是真·近黑 rgba(0,0,0,.8)，亮度 0 —— 这才是"死黑压抑"的真正来源，
            也是本项断言真正有区分度的那一条。
         B. bg-slate-900/40（驾驶舱 KPI 下钻抽屉）：旧产物 CSS 里已有
            `[class*=bg-slate-900],[class*=bg-slate-850],[class*=bg-slate-800]{background-color:#fff!important}`，
            所以旧版这些遮罩**早已是纯白**，本轮只是换成更贴合玻璃质感的明亮薄纱
            （白 → rgba(230,239,250,.62)+blur）。这条前后都通过，不具区分度，仅作留证。

       为什么不再用列表页的"查看台账"按钮：上一版把取证放在遍历的最后一个视图（3D 场景）上，
       那个视图根本没有该按钮，于是 candidateCount 恒为 0、拿不到任何遮罩证据 ——
       断言失败但其实是脚本自己没点开。 */
    const SCRIM_TARGETS = [
      {
        name: 'black',
        navKey: 'work_orders',
        navLabel: '检修工单',
        desc: '工单详情抽屉（bg-black/80，旧版为真·近黑 rgba(0,0,0,.8)）',
        click: `(() => {
          const re = /WO-\\d{8}-\\d+/;
          const leaf = Array.from(document.querySelectorAll('span,div'))
            .find((el) => el.children.length === 0 && re.test(el.textContent || ''));
          if (!leaf) return null;
          let n = leaf;
          while (n && n !== document.body) {
            if (/cursor-pointer/.test(String(n.className))) {
              n.click();
              return (leaf.textContent || '').trim().slice(0, 30);
            }
            n = n.parentElement;
          }
          return null;
        })()`,
      },
      {
        name: 'slate',
        navKey: 'cockpit',
        navLabel: '驾驶舱',
        desc: '驾驶舱 KPI 下钻抽屉（bg-slate-900/40，旧版已被兜底成纯白）',
        click: `(() => {
          const re = /在线设备\\s*\\/\\s*总台数|累计工单\\s*\\/\\s*完工|点检任务完成率|在控隐患闭环/;
          const b = Array.from(document.querySelectorAll('button'))
            .find((x) => re.test((x.textContent || '').replace(/\\s+/g, ' ')));
          if (!b) return null;
          b.click();
          return (b.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
        })()`,
      },
    ];

    result.scrims = [];
    for (const t of SCRIM_TARGETS) {
      const rec = { name: t.name, desc: t.desc };
      try {
        await clickNav(t.navKey, t.navLabel);
        await cdp.waitFor(`document.querySelector('main')`, 20000);
        await sleep(2200);
        const opened = await cdp.eval(t.click);
        rec.opened = opened;
        if (!opened) {
          rec.probe = { found: false, candidateCount: 0, reason: '未找到触发元素' };
          result.scrims.push(rec);
          continue;
        }
        // 弹窗有进场动画，轮询等它真的挂载再测量，否则会测到"还没出现的遮罩"
        for (let i = 0; i < 12; i++) {
          await sleep(250);
          const n = await cdp.eval(`document.querySelectorAll('.fixed.inset-0').length`);
          if (n > 0) break;
        }
        rec.probe = await cdp.eval(MODAL_PROBE);
        const metrics2 = await cdp.send('Page.getLayoutMetrics');
        const cs3 = metrics2.cssContentSize || metrics2.contentSize;
        const shot2 = await cdp.send('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: cs3.width, height: Math.min(cs3.height, 4200), scale: 1 },
        });
        const f2 = path.join(outDir, `${TAG}-modal-${t.name}.png`);
        fs.writeFileSync(f2, Buffer.from(shot2.data, 'base64'));
        rec.file = f2;
      } catch (e) {
        rec.error = String(e?.message || e);
      }
      result.scrims.push(rec);
    }
    result.modal = result.scrims.find((s) => s.name === 'black') || result.scrims[0];

    /* ---- 断言：改造后应成立的项 ---- */
    const dashboard = result.views.find((x) => x.key === 'dashboard')?.probe || {};
    const ai = result.views.find((x) => x.key === 'ai_assistant')?.probe || {};
    const d3 = result.views.find((x) => x.key === 'equipment_3d')?.probe || {};

    // 截图去重自检：各视图截图若完全一致，说明截到的是同一个错误页（Phase-1 踩过这个坑）
    const hashes = result.views.map((v) => crypto.createHash('md5').update(fs.readFileSync(v.file)).digest('hex'));
    result.shotHashes = { total: hashes.length, unique: new Set(hashes).size };
    const allShotsDistinct = new Set(hashes).size === hashes.length;

    const checks = [
      ['背景背板：body 有多层渐变网格（非单色死白）', /radial-gradient/.test(dashboard.bodyBgImage || '')],
      ['背景背板：background-attachment 含 fixed（滚动时层次稳定）', /fixed/.test(dashboard.bodyBgAttachment || '')],
      ['页面外壳已放行背板：bg-[#f8fafc] 计算背景为透明', dashboard.shellFound && /rgba\(0, 0, 0, 0\)|transparent/.test(dashboard.shellBg || '')],
      ['阴影阶梯令牌已生效（--shadow-2xl 非空）', !!dashboard.shadowScale?.['2xl']],
      ['晨曦金令牌已注入（--gold = #E8A33D）', dashboard.shadowScale?.gold === '#E8A33D'],
      ['磨砂玻璃卡：.glass-card 带 backdrop-filter blur', /blur/.test(dashboard.glassCard?.backdropFilter || '')],
      ['AI 助手：数字人剧场舞台存在（.hud-pedestal）', !!ai.pedestal],
      ['AI 助手：立绘呼吸动画已生效（digital-human-breath）', /digital-human-breath/.test(ai.portrait?.animationName || '')],
      ['AI 助手：立绘底部渐隐融入（mask-image 生效）', /linear-gradient/.test(ai.portrait?.maskImage || '')],
      ['AI 助手：金色胶囊芯片存在且为胶囊圆角', (ai.chipGold?.borderRadius || '') === '999px'],
      ['AI 助手：金色/天青声波仪已挂载（>=10 根波形柱）', (ai.waveformHud?.bars || 0) >= 10],
      ['AI 助手：同心圆呼吸脉冲地标（>=3 环）', (ai.pulseRings || 0) >= 3],
      ['AI 助手：晨曦微光粒子层存在', (ai.fxParticles || 0) >= 1],
      ['AI 助手：微晶六边形全息底网存在', (ai.fxHex || 0) >= 1],
      ['全屏遮罩：bg-black/80 近黑遮罩已改为明亮薄纱（旧版为真·近黑，有区分度）',
        (() => {
          const s = result.scrims?.find((x) => x.name === 'black');
          return !!s?.probe?.found && s.probe.isDark === false && (s.probe.luminance ?? 0) >= 200;
        })()],
      ['全屏遮罩：bg-slate-900/40 已为明亮薄纱（旧版被兜底成纯白，无区分度）',
        (() => {
          const s = result.scrims?.find((x) => x.name === 'slate');
          return !!s?.probe?.found && s.probe.isDark === false && (s.probe.luminance ?? 0) >= 200;
        })()],
      ['3D 场景：canvas 正常挂载且有尺寸（视觉重构未破坏 3D 视图）', (d3.canvas3d?.w || 0) > 200 && (d3.canvas3d?.h || 0) > 200],
      ['各视图截图互不相同（未截到同一张错误页）', allShotsDistinct],
    ];
    result.checks = checks.map(([name, pass]) => ({ name, pass: !!pass }));

    // 沙箱内无外网，魔珐星云 3D CDN 必然不可达并降级 2D——这是设计内的保底路径，不算异常
    const real = cdp.logs.filter(
      (e) => !/favicon|React DevTools|Download the React|XingYun 3D|XmovAvatar/i.test(e.text)
    );
    result.consoleErrors = real.slice(0, 12);

    if (STRICT) {
      const failed = result.checks.filter((c) => !c.pass);
      result.ok = failed.length === 0 && real.length === 0;
    }
  } finally {
    try {
      cdp?.ws.close();
    } catch {
      /* ignore */
    }
    try {
      chrome.kill();
    } catch {
      /* ignore */
    }
  }

  const reportFile = path.join(outDir, `${TAG}-report.json`);
  fs.writeFileSync(reportFile, JSON.stringify(result, null, 2));

  console.log(`\n=== ${TAG.toUpperCase()} @ ${BASE} ===`);
  for (const v of result.views) console.log(`  截图 ${v.label.padEnd(8)} -> ${v.file}  (h=${v.contentHeight})`);
  console.log('\n--- 滚动帧率（同后端横向对比用，非真机值） ---');
  for (const v of result.views) {
    const f = v.fps;
    console.log(
      `  ${v.label.padEnd(8)} fps=${f ? String(f.fps).padStart(3) : ' n/a'}  p95帧=${f ? String(f.p95FrameMs).padStart(3) : 'n/a'}ms  可滚动高度=${f ? f.scrollHeight - f.clientHeight : 'n/a'}px`
    );
  }
  if (result.checks) {
    console.log('\n--- 探针断言 ---');
    for (const c of result.checks) console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}`);
  }
  console.log(`\n控制台异常 ${result.consoleErrors.length} 条`);
  for (const e of result.consoleErrors) console.log(`  [${e.level}] ${e.text.slice(0, 160)}`);
  if (result.shotHashes) console.log(`\n截图去重: ${result.shotHashes.unique}/${result.shotHashes.total} 张互不相同`);
  for (const s of result.scrims || []) {
    const p = s.probe || {};
    console.log(
      `遮罩取证[${s.name}] ${s.file || s.error || '(未截图)'}\n` +
        `          ${s.desc}\n` +
        `          触发=${s.opened ? JSON.stringify(s.opened) : '未找到'}\n` +
        `          bg=${p.bg || 'n/a'}  blur=${p.backdropFilter || 'n/a'}\n` +
        `          合成白底=${p.overWhite || 'n/a'}  合成黑底=${p.overBlack || 'n/a'}\n` +
        `          感知亮度(白底)=${p.luminance ?? 'n/a'}  近黑=${p.isDark}  候选=${p.candidateCount}`
    );
  }
  console.log(`\n报告: ${reportFile}\nok = ${result.ok}`);

  process.exitCode = result.ok ? 0 : 1;
}

main().catch((e) => {
  console.error('FATAL', e?.stack || e?.message || e);
  process.exitCode = 1;
});
