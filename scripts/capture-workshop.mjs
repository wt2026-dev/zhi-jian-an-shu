import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = path.resolve('scratch/workshop-inspect');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const possibleBrowsers = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = possibleBrowsers.find((p) => fs.existsSync(p));
if (!browserPath) {
  console.error('Browser executable not found');
  process.exit(1);
}

const loginRes = await fetch('http://localhost:3000/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'Admin@2026#Demo' }),
});
const loginData = await loginRes.json();
if (!loginData.token) {
  console.error('Login failed:', loginData);
  process.exit(1);
}

const PORT = 9225;
const browserProcess = spawn(browserPath, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--window-size=1600,1050',
  '--disable-gpu=false',
  '--use-gl=angle',
  '--use-angle=d3d11',
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--no-sandbox',
  'about:blank',
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForCdp() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch {}
    await sleep(300);
  }
  throw new Error('CDP timeout');
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.pending = new Map();

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.pending.has(data.id)) {
        const { resolve, reject } = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) reject(data.error);
        else resolve(data.result);
      }
    };
  }

  async waitOpen() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const curId = this.id++;
      this.pending.set(curId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: curId, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result?.value;
  }

  async screenshot(filepath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png', quality: 95 });
    const buffer = Buffer.from(res.data, 'base64');
    fs.writeFileSync(filepath, buffer);
    console.log(`[Screenshot saved] ${filepath} (${buffer.length} bytes)`);
  }
}

try {
  await waitForCdp();
  const listRes = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const targets = await listRes.json();
  const pageTarget = targets.find((t) => t.type === 'page') || targets[0];

  const client = new CdpClient(pageTarget.webSocketDebuggerUrl);
  await client.waitOpen();

  await client.send('Network.enable');
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('DOM.enable');

  await client.send('Network.setCookie', {
    name: 'token',
    value: loginData.token,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  });

  // 1. 直达厂区层
  console.log('Navigating to factory level with factory_gz...');
  await client.send('Page.navigate', {
    url: 'http://localhost:3000/?view=equipment_3d&level=factory&factory=factory_gz&onboarded=1',
  });
  await sleep(2500);

  await client.evaluate(`
    (function() {
      try {
        localStorage.setItem('auth_token', ${JSON.stringify(loginData.token)});
        localStorage.setItem('auth_user', ${JSON.stringify(JSON.stringify(loginData.user))});
        localStorage.setItem('industrial_onboarding_completed', '1');
        localStorage.setItem('industrial_app_onboarded', '1');
      } catch (e) {}
    })()
  `);
  await sleep(1000);

  // 等待 3D 画布就绪
  for (let i = 0; i < 35; i++) {
    const hasCanvas = await client.evaluate(`!!document.querySelector('canvas')`);
    if (hasCanvas) break;
    await sleep(500);
  }
  await sleep(3500);

  // 截取厂区层
  await client.screenshot(path.join(SCREENSHOT_DIR, 'step1_factory_level.png'));

  // 2. 点击进入车间层
  console.log('Entering workshop level...');
  const entered = await client.evaluate(`
    (function() {
      const btns = Array.from(document.querySelectorAll('button'));
      // 优先找卡片上的 "进入" 按钮，或者面包屑里的 "车间" 按钮
      const enterBtn = btns.find(b => b.textContent && (b.textContent.trim() === '进入' || b.textContent.includes('生产车间') || b.textContent.includes('机加车间')));
      if (enterBtn) {
        enterBtn.click();
        return enterBtn.textContent.trim();
      }
      return null;
    })()
  `);
  console.log('Clicked enter button:', entered);
  await sleep(4000);

  // 截取车间层全景（包括落地大窗、天花板大吊扇、红色横幅、工位、安全通道、巡检工程师）
  console.log('Capturing step2_workshop_level.png...');
  await client.screenshot(path.join(SCREENSHOT_DIR, 'step2_workshop_level.png'));

  // 3. 聚焦到 1 号离心泵 (eq-101)
  console.log('Focusing on eq-101 via window.__handlePick...');
  await client.evaluate(`
    (function() {
      if (window.__handlePick) window.__handlePick('eq-101');
    })()
  `);
  await sleep(3500);
  console.log('Capturing step3_eq101_focus.png...');
  await client.screenshot(path.join(SCREENSHOT_DIR, 'step3_eq101_focus.png'));

  // 4. 聚焦到 12 号故障泵 (eq-112)，查看故障报警红灯高频闪烁与工艺细节
  console.log('Focusing on eq-112 via window.__handlePick...');
  await client.evaluate(`
    (function() {
      if (window.__handlePick) window.__handlePick('eq-112');
    })()
  `);
  await sleep(3500);
  console.log('Capturing step4_eq112_fault_focus.png...');
  await client.screenshot(path.join(SCREENSHOT_DIR, 'step4_eq112_fault_focus.png'));

  console.log('Workshop workflow verification finished successfully.');
} catch (err) {
  console.error('Error in capture:', err);
} finally {
  browserProcess.kill();
}
