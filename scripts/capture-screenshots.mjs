import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = path.resolve('scratch/3d-fluid');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// 寻找本机 Chrome 或 Edge
const possibleBrowsers = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const browserPath = possibleBrowsers.find((p) => fs.existsSync(p));
if (!browserPath) {
  console.error('未找到 Chrome 或 Edge 浏览器可执行文件');
  process.exit(1);
}

console.log('使用浏览器:', browserPath);

// 1. 先通过真实接口获取管理员 JWT Token
const loginRes = await fetch('http://localhost:3000/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'Admin@2026#Demo' }),
});
const loginData = await loginRes.json();
if (!loginData.token) {
  console.error('管理员登录获取 Token 失败:', loginData);
  process.exit(1);
}
console.log('登录成功，获取管理员 Token:', loginData.user?.name);

const PORT = 9222;
const browserProcess = spawn(browserPath, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--window-size=1600,1050',
  '--disable-gpu=false',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  'about:blank',
]);

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForCdp() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) {
        return await res.json();
      }
    } catch {
      await sleep(300);
    }
  }
  throw new Error('无法连接到浏览器 CDP');
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

  async send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      console.warn('Evaluate exception:', res.exceptionDetails);
    }
    return res.result?.value;
  }

  async screenshot(filepath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png', quality: 95 });
    const buffer = Buffer.from(res.data, 'base64');
    fs.writeFileSync(filepath, buffer);
    console.log(`[截图已保存] ${filepath} (${buffer.length} bytes)`);
  }
}

async function main() {
  try {
    const version = await waitForCdp();
    console.log('CDP 版本:', version.Browser);

    const listRes = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const targets = await listRes.json();
    const pageTarget = targets.find((t) => t.type === 'page') || targets[0];

    const client = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await client.waitOpen();

    await client.send('Network.enable');
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('DOM.enable');

    // 注入认证 Cookie
    await client.send('Network.setCookie', {
      name: 'token',
      value: loginData.token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    });

    console.log('导航到设备 3D 场景 (?view=equipment_3d&onboarded=1)...');
    await client.send('Page.navigate', { url: 'http://localhost:3000/?view=equipment_3d&onboarded=1' });
    await sleep(2000);

    // 自动跳过新手引导（如果存在）
    await client.evaluate(`
      (function() {
        try {
          localStorage.setItem('industrial_onboarding_completed', '1');
          localStorage.setItem('industrial_app_onboarded', '1');
        } catch (e) {}
        const btns = Array.from(document.querySelectorAll('button'));
        const skip = btns.find(b => b.textContent && b.textContent.includes('跳过'));
        if (skip) skip.click();
      })()
    `);
    await sleep(1500);

    // 等待 3D 画布就绪
    let hasCanvas = false;
    for (let i = 0; i < 35; i++) {
      hasCanvas = await client.evaluate(`!!document.querySelector('canvas')`);
      if (hasCanvas) break;
      await sleep(500);
    }

    if (!hasCanvas) {
      console.warn('未检测到 canvas，检查当前 DOM 内容...');
      const bodyText = await client.evaluate(`document.body.innerText`);
      console.log('当前页面文字摘要:', bodyText?.slice(0, 300));
    } else {
      console.log('3D Canvas 画布已成功加载！');
    }

    // 等待设备模型与粒子系统初始化完成
    await sleep(4000);

    // ==========================================
    // 验收 1: 3D 场景总览
    // 泵/压缩机/减速箱可见对应颜色粒子流，电机/机器人无粒子
    // ==========================================
    console.log('1. 截取 3D 场景总览 (多设备介质流动)...');
    await client.evaluate(`
      (function() {
        if (window.__clearSelection) window.__clearSelection();
        const closeBtn = document.querySelector('button[aria-label="收起右侧面板"]');
        if (closeBtn) closeBtn.click();
      })()
    `);
    await sleep(1500);
    await client.screenshot(path.join(SCREENSHOT_DIR, '1_overview_fluid_flow.png'));

    // ==========================================
    // 验收 2: 选中 3# 减速箱独占 (eq-103)
    // 金色油粒子沿润滑油站→箱体循环；拆解后粒子沿裸露部件流动
    // ==========================================
    console.log('2. 选中 3# 减速箱 (eq-103) 独占...');
    await client.evaluate(`
      (function() {
        if (window.__handlePick) window.__handlePick('eq-103');
      })()
    `);
    await sleep(2500);
    await client.screenshot(path.join(SCREENSHOT_DIR, '2_eq103_isolation_oil_loop.png'));

    // 触发爆炸拆解视图
    console.log('2.1 进入 3# 减速箱爆炸拆解视图...');
    await client.evaluate(`
      (function() {
        if (window.__enterExplodedView) window.__enterExplodedView();
      })()
    `);
    // 等待展开动画完成
    await sleep(4000);
    await client.screenshot(path.join(SCREENSHOT_DIR, '2_eq103_exploded_fluid_flow.png'));

    // 退出拆解视图
    await client.evaluate(`
      (function() {
        if (window.__exitExplodedView) window.__exitExplodedView();
      })()
    `);
    await sleep(2000);

    // ==========================================
    // 验收 3: 选中 12#（fault）泵独占 (eq-112)
    // 粒子流中断 + 泄漏飞散效果
    // ==========================================
    console.log('3. 选中 12# 结晶器泵 (eq-112, fault)...');
    await client.evaluate(`
      (function() {
        if (window.__handlePick) window.__handlePick('eq-112');
      })()
    `);
    await sleep(2500);
    await client.screenshot(path.join(SCREENSHOT_DIR, '3_eq112_fault_leakage.png'));

    // ==========================================
    // 验收 4: 参数面板"介质流动"开关可关/开
    // ==========================================
    console.log('4. 测试参数面板「介质流动」开关切换...');
    await client.evaluate(`
      (function() {
        // 先退出独占，回到总览展示开关对比
        if (window.__clearSelection) window.__clearSelection();
      })()
    `);
    await sleep(1000);

    // 关掉介质流动开关
    await client.evaluate(`
      (function() {
        if (window.__setParams) window.__setParams({ fluidFlow: false });
      })()
    `);
    await sleep(1200);
    await client.screenshot(path.join(SCREENSHOT_DIR, '4_toggle_fluid_off.png'));

    // 重新开启介质流动开关
    await client.evaluate(`
      (function() {
        if (window.__setParams) window.__setParams({ fluidFlow: true });
      })()
    `);
    await sleep(1200);
    await client.screenshot(path.join(SCREENSHOT_DIR, '4_toggle_fluid_on.png'));

    // ==========================================
    // 验收 5: 性能条 fps ≥45、三角面增量达标
    // ==========================================
    console.log('5. 截取性能状态条 (fps ≥ 45, 三角面)...');
    await client.screenshot(path.join(SCREENSHOT_DIR, '5_performance_fps_triangles.png'));

    // ==========================================
    // 验收 6: 城市层与厂区层建模视觉验证
    // ==========================================
    console.log('6. 截取城市层 (?level=city)...');
    await client.send('Page.navigate', { url: 'http://localhost:3000/?view=equipment_3d&level=city&factory=factory_gz&onboarded=1' });
    await sleep(4000);
    await client.screenshot(path.join(SCREENSHOT_DIR, '6_city_level_overview.png'));

    console.log('7. 截取厂区层俯瞰总览 (?level=factory)...');
    await client.send('Page.navigate', { url: 'http://localhost:3000/?view=equipment_3d&level=factory&factory=factory_gz&onboarded=1' });
    await sleep(4500);
    await client.screenshot(path.join(SCREENSHOT_DIR, '7_factory_level_overview.png'));

    console.log('8. 厂区层选中 A 区展开标牌...');
    await client.evaluate(`
      (function() {
        const s = window.__equipmentScene;
        if (s && s.selectZone) s.selectZone('zone-a');
      })()
    `);
    await sleep(1500);
    await client.screenshot(path.join(SCREENSHOT_DIR, '8_factory_zone_a.png'));

    const pageText = await client.evaluate(`document.body.innerText`);
    const countNotConnected = (pageText.match(/未接入/g) || []).length;
    console.log('厂区层界面"未接入"出现次数:', countNotConnected);

    console.log('所有截图生成完毕！保存在 scratch/3d-fluid/');
  } catch (err) {
    console.error('截图脚本执行失败:', err);
  } finally {
    browserProcess.kill();
  }
}

main();
