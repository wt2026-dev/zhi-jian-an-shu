// @vitest-environment jsdom
// 「拆解视图」的回归守卫（2026-10-16 口径第二次变更后的版本）。
//
// 口径：**在当前页面内切换主显示区域**。
//   点「拆解视图」→ 不新开窗口、不整页跳走；把中间那块显示 3D 设备模型的区域
//   换成拆解视图 HTML（同源 iframe，见 `ExplodedViewStage.tsx`）；
//   右上角「返回 3D 设备视图」退回。右侧面板与顶部工具栏保留不动。
//   没有宿主注册时（按钮被单独使用）才回退到 `window.open()` 新标签页。
//
// 为什么需要源码断言：这个功能的故障形态全是"静默"的 ——
//   · 按钮被删掉 → 界面上少一个东西，tsc/lint/build 全绿；
//   · 有人把 iframe 塞回**详情面板**里 → 编译也全绿，只有肉眼能看出挤成一条；
//   · 舞台被挪到面板**后面** → 拆解页把右侧面板整块盖住，看起来"面板没了"；
//   · 换设备时舞台不收起 → 右栏已是新设备、中间还停在旧设备的拆解页；
//   · 映射表指向不存在的 html → 舞台里是一块空白（比 404 更隐蔽）。
// 真机 CDP 能当场证明，但跑不到 CI；这里把结论钉成断言防回归。
import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  EXPLODED_VIEW_DIR,
  EXPLODED_VIEW_FILES,
  getExplodedViewUrl,
  hasExplodedView,
  openExplodedView,
  setExplodedViewHost,
} from '../src/components/equipment3d/explodedViewFiles';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const HUD = 'src/components/equipment3d/ProductionHUD.tsx';
const SCENE = 'src/components/equipment3d/EquipmentScene.tsx';
const BTN = 'src/components/equipment3d/ExplodedViewButton.tsx';
const STAGE = 'src/components/equipment3d/ExplodedViewStage.tsx';
const MAP = 'src/components/equipment3d/explodedViewFiles.ts';

/** 出现次数：区分"漏改一处"和"改过头" */
const count = (src: string, needle: string): number => src.split(needle).length - 1;

describe('拆解视图 · 映射表', () => {
  it('10 台设备各有一条映射，且每个被引用的 HTML 都真的在 public/exploded/ 里', () => {
    const entries = Object.entries(EXPLODED_VIEW_FILES);
    expect(entries).toHaveLength(10);
    for (const [deviceId, file] of entries) {
      expect(deviceId, `映射键 ${deviceId} 不像设备 ID`).toMatch(/^eq-\d+$/);
      const abs = path.join(ROOT, 'public', EXPLODED_VIEW_DIR, file);
      // 缺失时舞台里是一片空白（生产上还会被 SPA 兜底成首页）—— 比"打不开"更难查
      expect(fs.existsSync(abs), `public/exploded/${file} 不存在（${deviceId} 会打开到 404）`).toBe(true);
    }
  });

  it('解析函数：命中返回同源 URL，未命中/空值返回 null', () => {
    expect(getExplodedViewUrl('eq-105')).toBe('/exploded/pump_exploded.html');
    expect(getExplodedViewUrl('eq-999')).toBeNull();
    expect(getExplodedViewUrl(null)).toBeNull();
    expect(getExplodedViewUrl(undefined)).toBeNull();
    expect(getExplodedViewUrl('')).toBeNull();
  });

  it('hasExplodedView 与 getExplodedViewUrl 口径一致（按钮可用性判据）', () => {
    expect(hasExplodedView('eq-115')).toBe(true);
    expect(hasExplodedView('eq-101')).toBe(false); // 台账里有这台，但没有拆解图
    expect(hasExplodedView(null)).toBe(false);
  });
});

describe('拆解视图 · 宿主接管与兜底', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // 宿主是模块级单例：每个用例后必须复位，否则会污染后面的用例
    setExplodedViewHost(null);
  });

  it('★ 有宿主时：交给宿主页内显示，**不开新标签页**', () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const host = vi.fn(() => true);
    setExplodedViewHost(host);

    expect(openExplodedView('eq-105')).toBe(true);
    expect(host).toHaveBeenCalledWith('eq-105');
    expect(open, '有宿主时不应该再开新标签页').not.toHaveBeenCalled();
  });

  it('宿主拒收（返回 false）时回退到新标签页', () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    setExplodedViewHost(() => false);

    expect(openExplodedView('eq-105')).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe('/exploded/pump_exploded.html');
  });

  it('注销宿主（传 null）后回到新标签页兜底，带 _blank 与 noopener', () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    setExplodedViewHost(() => true);
    setExplodedViewHost(null);

    expect(openExplodedView('eq-105')).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    const [url, target, features] = open.mock.calls[0];
    expect(url).toBe('/exploded/pump_exploded.html');
    expect(target).toBe('_blank');
    expect(features).toContain('noopener');
    expect(features).toContain('noreferrer');
  });

  it('没有拆解图的设备：返回 false，**既不交给宿主也不开新标签页**', () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const host = vi.fn(() => true);
    setExplodedViewHost(host);

    expect(openExplodedView('eq-101')).toBe(false);
    expect(openExplodedView(null)).toBe(false);
    expect(host).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});

describe('拆解视图 · iframe 只允许出现在「舞台」里', () => {
  it('两块详情面板里都没有 <iframe>，也没有已废弃的 ExplodedViewFrame', () => {
    for (const rel of [HUD, SCENE]) {
      const src = read(rel);
      expect(src, `${rel} 里又出现了 iframe（iframe 只属于 ExplodedViewStage）`).not.toContain('<iframe');
      expect(src, `${rel} 里又引用了已删除的 ExplodedViewFrame`).not.toContain('ExplodedViewFrame');
      expect(src, `${rel} 里残留了旧的 exploded 标签页 key`).not.toContain("'exploded'");
    }
    expect(fs.existsSync(path.join(ROOT, 'src/components/equipment3d/ExplodedViewFrame.tsx'))).toBe(false);
  });

  it('两块详情面板都挂了「打开拆解视图」按钮，且各只有一处', () => {
    for (const rel of [HUD, SCENE]) {
      const src = read(rel);
      expect(src, `${rel} 没引入 ExplodedViewButton`).toContain("from './ExplodedViewButton'");
      expect(count(src, '<ExplodedViewButton'), `${rel} 的按钮挂载点数量不对`).toBe(1);
      // 传的是当前选中设备，不是写死的 ID
      expect(src).toMatch(/<ExplodedViewButton\s+deviceId=\{(?:selected\.id|selectedId)\}/);
    }
  });
});

describe('拆解视图 · 页内舞台', () => {
  it('舞台是独立组件：同源 iframe + 右上角「返回 3D 设备视图」', () => {
    expect(fs.existsSync(path.join(ROOT, STAGE)), 'ExplodedViewStage.tsx 不见了').toBe(true);
    const src = read(STAGE);
    expect(src, '舞台必须挂 iframe').toContain('<iframe');
    expect(src).toContain('data-testid="equipment3d-exploded-iframe"');
    expect(src).toContain('data-testid="equipment3d-exploded-back"');
    expect(src).toContain('返回 3D 设备视图');
    expect(src).toContain('data-testid="equipment3d-exploded-stage"');
    // src 必须来自映射表，不能就地拼路径（否则漏改一处映射就静默 404）
    expect(src).toContain('getExplodedViewUrl(deviceId)');
    expect(src).toContain('src={url}');
  });

  it('舞台沙箱：允许脚本与同源（拆解页自带 three.js、要用自己的 localStorage/WebGL）', () => {
    const src = read(STAGE);
    // 只看 sandbox 属性本身的值 —— 注释里提到过 allow-top-navigation（"不给它"），
    // 拿整份源码做 not.toContain 会被自己的注释误伤。
    const sandbox = src.match(/sandbox="([^"]*)"/)?.[1] ?? '';
    expect(sandbox, '舞台没写 sandbox 属性').not.toBe('');
    expect(sandbox).toContain('allow-scripts');
    // 去掉 allow-same-origin 会让拆解页降级成 opaque origin 直接白屏
    expect(sandbox).toContain('allow-same-origin');
    // 不允许把整个应用导航走
    expect(sandbox, 'sandbox 里不许出现 allow-top-navigation').not.toContain('allow-top-navigation');
  });

  it('★ 舞台挂载点必须**晚于** 3D 画布、且由 EquipmentScene 持有开关状态', () => {
    const src = read(SCENE);
    expect(src).toContain("from './ExplodedViewStage'");
    expect(src).toContain('<ExplodedViewStage');
    // 层序：canvas 在前、舞台在后 ⇒ 舞台盖住 3D 画面；后面的 HUD / 侧栏又盖在舞台之上
    const hostAt = src.indexOf('data-testid="equipment3d-host"');
    const stageAt = src.indexOf('<ExplodedViewStage');
    expect(hostAt).toBeGreaterThan(-1);
    expect(stageAt, '舞台挂载点不在 3D 画布之后（会被 canvas 盖住）').toBeGreaterThan(hostAt);
    // 开关状态由本组件持有
    expect(src).toMatch(/const \[explodedHtmlDeviceId, setExplodedHtmlDeviceId\] = useState<string \| null>\(null\)/);
    // 舞台内缩：给右侧面板 / HUD 顶部浮片让位（否则会把面板压住）
    expect(src).toContain('const explodedStageInset');
    expect(src).toContain('className={explodedStageInset}');
  });

  it('★ 拆解视图占满整个中间主区域不留边（inset-0），右侧详情面板与大屏HUD在激活时隐藏', () => {
    const src = read(SCENE);
    expect(src).toContain("const explodedStageInset = 'inset-0'");
    expect(src, '大屏 HUD 在拆解视图激活时需隐藏').toContain("explodedHtmlDeviceId ? 'hidden' : 'contents'");
    expect(src, '侧栏在拆解视图激活时需隐藏').toContain("panelOpen && !explodedHtmlDeviceId");
  });

  it('★ 换设备 / 清选中时自动收起舞台（否则右栏与中间显示的不是同一台）', () => {
    const src = read(SCENE);
    expect(src).toContain('if (selectedId !== explodedHtmlDeviceId) setExplodedHtmlDeviceId(null);');
  });

  it('★ 舞台自己负责定位：背板铺满主区域、内容列最大化占满', () => {
    const src = read(STAGE);
    expect(src, '背板铺满主区域').toContain('absolute inset-0 bg-slate-950');
    expect(src, '内容列自带 absolute inset-0').toContain('absolute inset-0 flex flex-col overflow-hidden ${className}');
    expect(src).toContain('data-testid="equipment3d-exploded-panel"');
    expect(src).toContain("className = 'inset-0'");
  });

  it('★ 背板必须是舞台的第一层（内容列在它里面），否则等于没铺', () => {
    const src = read(STAGE);
    const backdropAt = src.indexOf('data-testid="equipment3d-exploded-stage"');
    const panelAt = src.indexOf('data-testid="equipment3d-exploded-panel"');
    const iframeAt = src.indexOf('<iframe');
    expect(backdropAt).toBeGreaterThan(-1);
    expect(panelAt, '内容列不在背板之后 —— 结构被改平了').toBeGreaterThan(backdropAt);
    expect(iframeAt, 'iframe 不在内容列之后').toBeGreaterThan(panelAt);
  });

  it('★ 嵌入时隐藏拆解页自带的「← 返回拆解总览」（外壳已给了返回按钮）', () => {
    const src = read(STAGE);
    // 那 9 份静态页在 </body> 前被统一注入了一个 position:fixed 的 <a href="exploded_index.html">。
    // 单独打开时它是必要的返回路径 ⇒ **不能去改那 9 份 HTML**，只能从父页面往同源 iframe 里注入。
    expect(src, '没有注入样式去隐藏自带返回入口').toContain("a[href=\"exploded_index.html\"]");
    expect(src).toContain('EMBED_STYLE_ID');
    expect(src, '没有按文案兜底（href 变了就漏）').toContain('返回拆解总览');
    // 注入必须挂在 iframe 的 load 上，否则样式加不进已经加载完的文档
    // （2026-10-17 F2 起 onLoad 同时安装「工单联动 iframe 桥」，见 handleIframeLoad）
    expect(src, 'hideBuiltinBackLink 没有挂到 iframe 的 onLoad 上').toContain('onLoad={handleIframeLoad}');
    expect(src, 'iframe 桥没有挂在同一个 load 节点上').toContain('installIframeBridge(frame');
    // 注入失败（跨源/未就绪）必须静默跳过，不能把宿主搞崩
    expect(src).toContain('if (!doc?.head) return;');
  });

  it('EquipmentScene 注册/注销「页内打开」宿主', () => {
    const src = read(SCENE);
    expect(src).toContain("from './explodedViewFiles'");
    expect(src).toContain('setExplodedViewHost(');
    expect(src).toContain('return () => setExplodedViewHost(null);');
    expect(src).toContain('if (!hasExplodedView(deviceId)) return false;');
    expect(src).toContain('setExplodedHtmlDeviceId(deviceId);');
  });
});

describe('拆解视图 · 按钮组件', () => {
  it('点击走 openExplodedView（而不是自建 <a>/iframe）', () => {
    const src = read(BTN);
    expect(src).toContain('openExplodedView(deviceId)');
    expect(src).toContain('hasExplodedView(deviceId)');
    expect(src).not.toContain('<iframe');
  });

  it('无拆解图时按钮置灰并说明原因，而不是被藏掉', () => {
    const src = read(BTN);
    expect(src).toContain('disabled={!available}');
    expect(src).toContain('该设备暂未生成拆解视图');
    // 可探测性：真机验收靠这个 testid 找按钮
    expect(src).toContain('data-testid="equipment3d-open-exploded"');
    expect(src).toContain('data-available={available ?');
  });

  it('★ 按钮文案/图标不得再暗示"新标签页"（口径已改为页内切换）', () => {
    const src = read(BTN);
    // 悬停提示与实际行为不一致时，用户会以为功能坏了 —— 2026-10-16 那次
    // "点了没反应"的误判里就有这一条（tooltip 还写着"在新标签页打开"）。
    expect(src, '按钮 title 还在承诺新标签页，但点击其实是页内切换').not.toMatch(/在新标签页/);
    expect(src, '按钮还在用 ExternalLink 图标（暗示跳出当前页）').not.toContain('ExternalLink');
    expect(src, '按钮没有写明"当前页面"的页内语义').toContain('在当前页面查看');
  });

  it('named + default 双导出', () => {
    const src = read(BTN);
    expect(src).toMatch(/export function ExplodedViewButton/);
    expect(src).toContain('export default ExplodedViewButton');
  });

  it('映射表模块暴露"解析 + 可用性 + 宿主注册 + 打开"', () => {
    const src = read(MAP);
    expect(src).toContain('export function openExplodedView');
    expect(src).toContain('export function hasExplodedView');
    expect(src).toContain('export function setExplodedViewHost');
    expect(src).not.toContain('frame-src');
  });
});

describe('拆解视图 · BOM 物料清单滚动与显示防回归', () => {
  it('10 份拆解静态页所有 overflow-y-auto 容器必须带 min-h-0，防止 flexbox 高度撑大卡死滚动', () => {
    for (const file of Object.values(EXPLODED_VIEW_FILES)) {
      const abs = path.join(ROOT, 'public', EXPLODED_VIEW_DIR, file);
      const html = fs.readFileSync(abs, 'utf8');
      const matches = html.match(/class="[^"]*overflow-y-auto[^"]*"/g) || [];
      expect(matches.length, `${file} 中未找到 overflow-y-auto 容器`).toBeGreaterThan(0);
      for (const m of matches) {
        expect(m, `${file} 中的滚动容器缺少 min-h-0: ${m}`).toContain('min-h-0');
      }
    }
  });

  it('10 份拆解静态页均配置了显式滚动条样式与宽度', () => {
    for (const file of Object.values(EXPLODED_VIEW_FILES)) {
      const abs = path.join(ROOT, 'public', EXPLODED_VIEW_DIR, file);
      const html = fs.readFileSync(abs, 'utf8');
      expect(html, `${file} 缺少 scrollbar-width 样式`).toContain('scrollbar-width: thin');
      expect(html, `${file} 缺少 webkit-scrollbar 8px 宽度`).toContain('width: 8px');
    }
  });

  it('舞台不应渲染独立的"设备拆解视图"标题栏，只保留右上角返回按钮', () => {
    const src = read(STAGE);
    expect(src).not.toContain('<span className="text-[11px] font-bold text-cyan-100 shrink-0">设备拆解视图</span>');
    expect(src).toContain('data-testid="equipment3d-exploded-back"');
  });
});

describe('维修步骤指引 · iframe 桥洞洞（F3）', () => {
  const GUIDE = 'src/components/equipment3d/MaintenanceStepGuidePanel.tsx';
  const SVC = 'src/server/services/partHistoryService.ts';

  it('★ 拆解舞台持有步骤状态与"点步骤 → 高亮 + 动画"的宿主动作', () => {
    const src = read(STAGE);
    expect(src).toContain("from './MaintenanceStepGuidePanel'");
    expect(src).toContain('<MaintenanceStepGuidePanel');
    // 宿主动作：高亮 + 页面原生动画（不许宿主自己模拟 transform）
    expect(src).toContain('startExplodeAnimation');
    expect(src).toContain('tryHighlightPart');
    expect(src, '必须复用 iframe 桥的高亮路径').toContain('guideActiveStep');
  });

  it('★ 拆解动画只走页面原生入口：A 族 setExplodeTarget+setPlayingState，B 族点页面播放按钮', () => {
    const src = read(STAGE);
    expect(src).toContain('setExplodeTarget');
    expect(src).toContain('setPlayingState');
    expect(src).toContain('#btn-play-explode');
    // 页面原生 API 之外不允许对 three 场景做变换
    expect(src).not.toContain('explodeProgress = ');
  });

  it('★ 宿主主动定位要静默桥的上报回路（不被"自动选中"顶开历史面板）', () => {
    const src = read(STAGE);
    expect(src).toContain('suppressReportRef');
    expect(src).toContain('quietHostAction');
  });

  it('★ 步骤数据是真实工单的 resolutionSteps，绝不退回硬编码默认步骤', () => {
    const svc = read(SVC);
    // 服务端切分真实文本（也许空 → 前端如实展示）
    expect(svc).toContain('parseOrderSteps');
    expect(svc).toContain('resolutionSteps');
    const guide = read(GUIDE);
    const stage = read(STAGE);
    // 指引面板/舞台绝不能真正调用/导入 3D 验修流程卡里的演示兜底（那是假数据面）
    expect(guide, '步骤指引面板调用了 getDefaultProcedures（演示兜底 = 假数据）').not.toMatch(/getDefaultProcedures\s*\(/);
    expect(stage, '拆解舞台调用了 getDefaultProcedures（演示兜底 = 假数据）').not.toMatch(/getDefaultProcedures\s*\(/);
    expect(guide).not.toContain("from '../workOrders/RepairStepCard'");
    expect(stage).not.toContain("from './RepairStepCard'");
    // 空态必须如实说明"没填步骤"，给用户正确预期
    expect(guide).toContain('还没有填写标准作业步骤');
  });

  it('测试面板的可交互面：步骤行、定位按钮、完成提示的 testid 契约', () => {
    const src = read(GUIDE);
    expect(src).toContain('data-testid="equipment3d-step-guide-panel"');
    expect(src).toContain("data-testid={`equipment3d-step-guide-step-${step.index}`}");
    // 每步的"定位零件"按钮与"未匹配"如实态
    expect(src).toContain('equipment3d-step-guide-part-');
    expect(src).toContain('未匹配到具体零件');
    // 全部完成 → 自动提交"完工上报"提示（转待验收，不绕过质检）
    expect(src).toContain('已自动提交完工上报');
    expect(src).toContain('待验收');
    // 折叠态
    expect(src).toContain('equipment3d-step-guide-collapsed');
  });
});

/**
 * 2026-10-20 实测故障：拆解视图整块打不开，页面里只剩一块黑画布。
 * 根因不在本仓代码，而在**依赖公网 CDN**：`cdn.jsdelivr.net` 在本机直连解析不到、
 * 走代理也被掐（ERR_CONNECTION_RESET），于是 `THREE.OrbitControls` 是 undefined，
 * 拆解页主脚本在 `new THREE.OrbitControls(...)` 这一行整体抛断 —— 灯光、零件几何、
 * BOM 表格、渲染循环一行都没执行。tsc / build / 接口全绿，只有肉眼能看出来。
 *
 * 所以这里钉三件事：three 系资源必须同源本地加载；调用 OrbitControls 的页面必须真的
 * 引到它；任何一份页面重新长出公网 three.js CDN 都算回归。
 */
describe('拆解视图 · three.js 必须同源本地加载（禁止公网 CDN）', () => {
  const VENDOR_DIR = path.join(ROOT, 'public', EXPLODED_VIEW_DIR, 'vendor');

  it('本地 three 资源在位且非空壳（OrbitControls 必须真的定义构造函数）', () => {
    const three = path.join(VENDOR_DIR, 'three.min.js');
    const orbit = path.join(VENDOR_DIR, 'OrbitControls.js');
    expect(fs.existsSync(three), 'public/exploded/vendor/three.min.js 缺失').toBe(true);
    expect(fs.existsSync(orbit), 'public/exploded/vendor/OrbitControls.js 缺失').toBe(true);
    // r128 压缩版约 600KB；小于 100KB 就是被换成了占位/错误页
    expect(fs.statSync(three).size).toBeGreaterThan(100_000);
    expect(fs.readFileSync(orbit, 'utf8')).toContain('THREE.OrbitControls');
  });

  it('10 份页面一律用相对路径引本地 three.min.js，且不再出现公网 three CDN', () => {
    for (const file of Object.values(EXPLODED_VIEW_FILES)) {
      const html = read(path.join('public', EXPLODED_VIEW_DIR, file));
      expect(html, `${file} 未改为本地 vendor/three.min.js`).toContain('src="vendor/three.min.js"');
      expect(html, `${file} 又引回了公网 three.js CDN`).not.toMatch(
        /src="https?:\/\/[^"]*(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)[^"]*three[^"]*"/
      );
    }
  });

  it('调用 new THREE.OrbitControls 的页面必须引到 OrbitControls.js（漏一个 = 该页整块黑屏）', () => {
    const callers: string[] = [];
    for (const file of Object.values(EXPLODED_VIEW_FILES)) {
      const html = read(path.join('public', EXPLODED_VIEW_DIR, file));
      if (!html.includes('new THREE.OrbitControls')) continue;
      callers.push(file);
      expect(html, `${file} 用了 OrbitControls 却没加载 vendor/OrbitControls.js`).toContain(
        'src="vendor/OrbitControls.js"'
      );
    }
    expect(callers.sort()).toEqual(
      [
        'compressor_exploded.html',
        'machining_center_exploded.html',
        'motor_exploded.html',
        'pump_exploded.html',
        'robot_exploded_v2.html',
      ].sort()
    );
  });
});
