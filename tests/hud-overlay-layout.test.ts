// 厂区总览大屏浮层布局守卫（第二轮几何口径 + 第三轮"减法"口径）。
//
// 为什么用源码断言而不是截图 diff：内置浏览器面板在验收时段始终 hidden，
// requestAnimationFrame 不触发 → 3D 视口连挂载都做不到，任何像素级验收都拿不到。
// （2026-09-22 更新：hidden 页面里 **DOM 几何**其实量得到——getBoundingClientRect 不依赖
//  rAF，把外壳容器临时改宽就能按 1440/1920 逐档量重叠与间距，本轮数值就是这么定下来的；
//  拿不到的仍然只有 WebGL 画布像素。所以这里的 class 断言是"第二道闸"：
//  真机量一次 → 把结论钉成字符串，防回归。）
// 但这些全是"确定的几何/格式/重复文案"问题，能在 class 与字符串上钉死：
//   ① 顶部只有一条 HUD 栏：外层工具栏在 `.industrial-workspace` 之上，HUD 栏停在
//      工作区内 top-5（=20px，2026-09-22 从 top-2→top-4→top-5 一路量出来的：外壳面包屑
//      药丸底边在画布 45px，工具栏单行 46px，top-4 只有 18px 缝，不到验收的 20px）；
//      两侧面板统一让到 top-[70px]（HUD 栏底边 61 + 9 缝），7 处一个不少
//      —— 少一处就是有一栏压到了大屏上；
//   ② 图例压在底部 KPI 卡片上 → 图例停靠位改由调用方给，厂区层让开右侧指标面板一整列，
//      并且厂区层默认折叠（整屏文字量的大头就是这 7 行）；
//   ③ 80.92307692307692% 这类原始浮点撑破卡片 → 所有百分比一律 toFixed(1)；
//   ④ 底部三块卡片高矮不一、间距 8px → 统一 min-h-[90px] + gap-4 + items-stretch；
//   ⑤ 第三轮：同一个数不许说三遍、同一个标题不许套三层（见文件末尾三条断言）。
// 浏览器可用后应补真机截图，本文件只保证这些不变量不回归。
import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const hud = () => fs.readFileSync(path.join(ROOT, 'src/components/equipment3d/ProductionHUD.tsx'), 'utf8');
const css = () => fs.readFileSync(path.join(ROOT, 'src/components/equipment3d/equipment-industrial.css'), 'utf8');
const legendPath = path.join(ROOT, 'src/components/equipment3d/SceneLegend.tsx');
const legend = () => fs.readFileSync(legendPath, 'utf8');
const scene = () => fs.readFileSync(path.join(ROOT, 'src/components/equipment3d/EquipmentScene.tsx'), 'utf8');
/**
 * ⚠️ 图例组件是并行会话（会话 A）的新文件，EquipmentScene 里的挂载点也还在对方
 * 未提交的 hunk 中。干净签出 HEAD 时这两处都不存在，整组断言只能跳过而不是删掉——
 * 对方一提交，这四条立刻生效成为真联锁守卫（跳过数会在 vitest 输出里显式报出）。
 */
const legendWired = fs.existsSync(legendPath) && scene().includes('<SceneLegend');

/** 出现次数（用来把"漏改一处"和"改过头"区分开） */
const count = (src: string, needle: string): number => src.split(needle).length - 1;
/**
 * 只取 L1 厂区大屏那一段源码（两条段标记注释之间）。
 * 三层共用一个组件，L2/L3 的详情面板里本来就该出现「异常 N」这类读数，
 * 全文断言会把它们误判成重复；按层切片才是"同一层内不重复"的口径。
 */
const l1 = (): string => {
  const src = hud();
  const a = src.indexOf('===== L1 厂区');
  const b = src.indexOf('===== L2 车间');
  expect(a, 'L1 段标记注释被删了？按段切片的断言依赖它').toBeGreaterThan(-1);
  expect(b, 'L2 段标记注释被删了？').toBeGreaterThan(a);
  return src.slice(a, b);
};

describe('顶部一条栏 + 两侧面板的纵向分工', () => {
  it('HUD 顶栏降级为两颗半透明浮片（top-5，各自绝对定位），不再有整行实心板与同色延伸带', () => {
    const hudSrc = hud();
    expect(hudSrc).toContain('absolute top-5 left-3');
    expect(hudSrc).toContain('absolute top-5 right-3');
    expect(hudSrc).not.toContain('left-3 right-3');
    expect(hudSrc).not.toContain('hud-main-header');
    expect(count(css(), 'hud-main-header')).toBe(0);
  });

  it('两侧面板统一让到 top-[70px]（HUD 栏底边 61 之下），7 处一处不漏', () => {
    const src = hud();
    expect(count(src, 'top-[70px]')).toBe(7);
    expect(src).not.toContain('top-[56px]'); // 栏抬到 20px 之后，56 会与栏底边叠 6px
    expect(src).not.toContain('top-14 bottom-3');
    expect(src).not.toContain('top-14 px-1.5');
    expect(src).not.toContain('top-14 flex flex-col');
  });

  it('面板最大高度按顶部起点算，底部留白维持 64px', () => {
    const src = hud();
    expect(count(src, 'max-h-[calc(100%-134px)]')).toBe(2);
  });
});

/* ============== 顶部路径条的归位（09-22 两轮 + 09-23 两轮反馈） ==============
   第一轮「没有变化啊」：药丸 absolute left-1/2 top-3 浮在整块画布上，而工具栏横向铺满
   同一行——控件只要长过中线就会被压住（「可视化图层」被盖成「可视化图」）→ 让出车道。
   第二轮「还是有中间空了一块」：车道若是个固定 248px 的深色块，反而在工具栏正中留下
   约 900px 空洞 → 车道改 flex-1 吃掉两簇之间全部余量，实测宽度喂给药丸。
   第三轮「太拥挤了 / 不好看」：width 撑满车道 ⇒ 一条大半空的黑盒子；而且顶部同时有两条
   面包屑（地图轴浮在工具栏正中、厂区轴挤在大屏栏左侧）、当前层级名写两遍、大标题写两遍、
   帧率说两遍 ⇒ 两条面包屑合并成一条、大屏栏去掉重复标题与面包屑、三颗同款下拉并成一颗。
   第四轮（本轮，实测量出来的回归）：药丸改成 max-width 按内容收拢之后，它仍是**绝对定位**
   浮在工具栏上 —— 五级链路（全国 › 市 › 厂区 › 车间 › 单设备）在 1024px 折成 3 行，
   比工具栏高出 39px，直接压进大屏栏；而 flex-1 车道那条也并不是真居中（左右两簇实测
   353 / 181 不等宽，整条偏右约 100px）。⇒ 路径条搬进工具栏的**正常文档流**：
   折行只让工具栏自己长高、工作区整体下移，「压住大屏栏」从结构上不再可能；
   工具栏改 grid 1fr·auto·1fr，两条侧轨同宽 ⇒ 路径条恒等于画布水平正中。
   测量脚本与数据：scratch/ 下的 DOM 强制宽度扫描（getBoundingClientRect 不依赖 rAF）。 */
describe('顶部一条路径条：搬进工具栏正常流 + grid 钉住正中', () => {
  const shellSrc = () => fs.readFileSync(path.join(ROOT, 'src/components/equipment3d/DrilldownShell.tsx'), 'utf8');
  const trailSrc = () => fs.readFileSync(path.join(ROOT, 'src/components/equipment3d/DrillTrail.tsx'), 'utf8');

  it('路径条是共享组件，两条轴各传一次节点（不再互相 import，避免壳 ⇄ 厂区层循环引用）', () => {
    expect(trailSrc()).toContain('export interface DrillCrumbNode');
    expect(trailSrc()).toContain('data-testid="equipment3d-drill-trail"');
    expect(trailSrc()).toContain('data-testid="equipment3d-trail-exit"');
    // 内容收拢 + 居中 + 允许折行（折行时自己长高，绝不越界）
    expect(trailSrc()).toContain('min-w-0 flex-wrap items-center justify-center');
    expect(shellSrc()).toContain('from "./DrillTrail"');
    expect(scene()).toContain("from './DrillTrail'");
  });

  it('厂区层在画布上时，壳不再绝对定位叠第二条；否则（全国 / 城市层）由壳钉在水平正中', () => {
    const shell = shellSrc();
    expect(shell).toContain('const showsFactory = visibleLevels.includes("factory")');
    expect(shell).toContain('{!showsFactory && (');
    expect(shell).toContain('absolute left-1/2 top-3 z-40 max-w-[calc(100%-24px)] -translate-x-1/2');
    // 地图轴三级作为 props 交给厂区层，由它接上车间 / 单设备两级
    expect(shell).toContain('mapTrail={mapTrail}');
  });

  it('工具栏 grid 1fr·auto·1fr：路径条真居中，折行只发生在本侧', () => {
    const src = scene();
    expect(src).toContain('equipment-industrial-header grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]');
    expect(src).toContain('data-testid="equipment3d-crumb-lane"');
    expect(src).toContain('<DrillTrail nodes={drillTrail} />');
    // 独立挂载（测试里 <Equipment3DView />）没有节点时整格不渲染，不留空药丸盒
    expect(src).toContain('{drillTrail.length > 0 && (');
    // 上一版靠 JS 量车道宽度写 CSS 变量喂给药丸；搬进正常流后这套机器全删
    expect(src).not.toContain('crumbLaneRef');
    expect(src).not.toContain('publishCrumbLane');
    expect(src).not.toContain('--dd-crumb-w');
    expect(shellSrc()).not.toContain('--dd-crumb-w');
  });

  it('大屏栏不再自带面包屑：只留一句层级模式说明', () => {
    const hudSrc = hud();
    expect(hudSrc).not.toContain('onExitIsolation');
    expect(hudSrc).not.toContain("onLevelChange?.('factory')");
    expect(hudSrc).not.toContain('activeBuildingName');
    expect(hudSrc).toContain("'厂区总览态势' : level === 'workshop' ? '车间现场' : '单台设备聚焦'");
    // 车间 / 单设备两级改由路径条给出（含退出聚焦的 ×）
    const src = scene();
    expect(src).toContain("key: 'workshop'");
    expect(src).toContain("key: 'device'");
  });

  it('两簇各自 wrap + min-w-0，谁也不 flex-1（轨道宽度由 grid 决定）', () => {
    const src = scene();
    expect(count(src, 'flex min-w-0 flex-wrap items-center')).toBe(2);
    expect(src).not.toContain('equipment-industrial-header flex flex-wrap');
    expect(src).not.toContain('flex flex-1 min-w-0 flex-wrap items-center');
  });

  it('三颗同款下拉并成一颗「视图设置」（图层 / 渲染 / 统计三段），右侧簇瘦下来', () => {
    const src = scene();
    const rightZone = src.slice(src.indexOf('equipment3d-crumb-lane'), src.indexOf('===== 主区域'));
    expect(rightZone).toContain('<summary>视图设置</summary>');
    // 不再有三颗并排的下拉：整个工具栏只有一处 industrial-render-settings
    expect(count(src, 'className="industrial-render-settings"')).toBe(1);
    expect(rightZone).not.toContain('<summary>渲染统计</summary>');
    expect(rightZone).not.toContain('<summary>可视化图层</summary>');
    expect(rightZone).not.toContain('<summary>渲染设置</summary>');
    // 三段都在弹层里，图层开关的 testid 原样保留（EquipmentSceneLayers 靠它找开关）
    expect(rightZone).toContain('data-testid="equipment3d-layer-switches"');
    expect(rightZone).toContain('data-testid="equipment3d-view-settings"');
    for (const label of ['可视化图层', '渲染预设与画质', '渲染统计']) {
      expect(rightZone).toContain(`text-cyan-300/90">${label}</div>`);
    }
  });

  it('全国/城市两层的卡片起点按药丸实测底边反推：66 = 45 + 20', () => {
    const ms = fs.readFileSync(path.join(ROOT, 'src/components/equipment3d/mapStyle.ts'), 'utf8');
    expect(ms).toContain('export const HUD_TOP_BAND = 66;');
  });

  it('重建中徽章停在 HUD 顶栏之下（原来 top-3 会在重建时压住顶栏大标题）', () => {
    expect(scene()).toContain('absolute top-[68px] left-1/2 -translate-x-1/2');
    expect(scene()).not.toContain('absolute top-3 left-1/2 -translate-x-1/2 inline-flex');
  });
});

describe('图层图例的停靠', () => {
  const itLegend = it.skipIf(!legendWired);

  itLegend('宽度收窄到 220px', () => {
    expect(legend()).toMatch(/const LEGEND_WIDTH = 220/);
  });

  itLegend('组件内不写死 bottom，停靠位全部交给调用方', () => {
    const src = legend();
    expect(src).not.toMatch(/className=\{`pointer-events-auto absolute bottom/);
    // 内联 style 只写背景与宽度；bottom 只能来自 className
    expect(src).toContain("style={{ background: 'rgba(15, 23, 42, 0.85)', width: LEGEND_WIDTH }}");
    expect(src).toContain("className = 'left-3 bottom-3'");
  });

  itLegend('厂区层停在右下（让开整条右侧指标面板），车间/聚焦层仍在左侧菜单右边', () => {
    const src = scene();
    expect(src).toContain("'right-[262px] bottom-20'");
    expect(src).toContain("'left-[262px] bottom-3'");
    expect(src).toContain("'left-3 bottom-3'");
  });

  itLegend('厂区层默认折叠，车间 / 聚焦层默认展开（切换层级时重挂载，折叠态按层各自生效）', () => {
    const src = scene();
    expect(src).toContain("key={level === 'factory' ? 'factory' : 'detail'}");
    expect(src).toContain("defaultCollapsed={level === 'factory'}");
    // 组件侧默认值仍是"展开"，折叠只由调用方按层级决定
    expect(legend()).toContain('defaultCollapsed = false');
  });

  itLegend('自动避让只会往上抬，不会把图例拽到停靠位以下', () => {
    expect(legend()).toMatch(/Math\.max\(dockBottomPx\(\), need\)/);
  });
});

describe('数字格式与假数兜底', () => {
  it('环形表盘：算不出写「未接入」，算得出保留 1 位小数', () => {
    const src = hud();
    expect(src).not.toContain('{percent}%');
    expect(src).toContain('{percent.toFixed(1)}%');
    expect(src).not.toContain('>98.5%<');
  });

  it('底部可动率柱状图的数值与名称各自成行，容器高度容得下三行', () => {
    const src = hud();
    expect(src).toContain('{proc.rate.toFixed(1)}%');
    expect(src).toContain('h-[56px]');
    expect(src).not.toContain('h-10 pt-1 font-mono text-[7px]');
  });
});

describe('底部三块 KPI 卡片', () => {
  it('等高（min-h-[90px]）+ 16px 间距 + 居中对齐', () => {
    const src = hud();
    expect(count(src, 'min-h-[90px]')).toBe(3);
    expect(src).toContain('flex flex-wrap items-stretch justify-center gap-4');
  });

  it('卡片内数字字号统一为 10px（9px 及以下在 1080p 投影上读不出）', () => {
    const src = hud();
    expect(src).not.toContain('text-[7px] hud-tabular-nums text-slate-300');
    expect(src).not.toContain('space-y-1 text-[8px] font-mono pt-1');
    expect(src).not.toContain('text-[7px] text-slate-400 font-mono');
    expect(src).toContain('space-y-1 text-[10px] font-mono pt-1');
  });
});

/* ============================ 第三轮：减法 ============================ */

describe('标题不套三层', () => {
  it('中文大标题全项目只写一次（在工具栏左侧）；大屏栏那条重复标题已删', () => {
    const src = hud();
    // 2026-09-23 用户「太拥挤了」：大屏栏正中那条发光「工业设备 · 数字孪生」与工具栏左侧
    // 同句重复，删掉大屏栏那条 —— 标题的唯一落点改到 EquipmentScene。
    expect(count(src, '工业设备 · 数字孪生')).toBe(0);
    expect(count(scene(), '工业设备 · 数字孪生')).toBe(1);
    expect(src).not.toContain('DIGITAL TWIN WORKSHOP HUD');
    expect(src).not.toContain('DIGITAL TWIN · 实时联动');
    // 层级名仍在大屏栏左侧，但只写"在哪一层"这一件事：设备名归下钻路径条，不在这里重复
    expect(count(src, '厂区总览态势')).toBe(1);
    expect(src).toContain('data-testid="equipment3d-level-label"');
    expect(src).not.toContain('selected?.name ?? \'设备聚焦\'');
  });
});

describe('同一个数不说三遍（L1 段内）', () => {
  it('异常计数：右栏一个大字，分区行只在有异常时补一句', () => {
    const src = l1();
    // 全局异常大字唯一
    expect(count(src, '{faultDevices.length}')).toBe(1);
    // 分区 / 车间行：abnormalCount > 0 才渲染
    expect(count(src, 'abnormalCount > 0')).toBe(2);
    // 「运行异常数 … 项」与「异常 a / 共 b 台」这类第二、第三种说法不再存在
    expect(src).not.toContain('运行异常数');
    expect(src).not.toContain('共 {activeZone.deviceCount}');
    // 底部那格改成纯构成，不再自带一个计数标题
    expect(src).toContain('异常类别构成');
    expect(src).not.toContain('异常台数构成');
  });

  it('良品率与可动率各自只有一处落点', () => {
    const src = l1();
    // 良率只出现在分区成绩卡（未选中分区时不凭空给一个"厂区均值"）
    expect(count(src, '生产良品率')).toBe(1);
    // 综合可动率并进底部卡片标题，右栏不再有第二张进度条卡
    expect(src).toContain('综合 {runningRate.toFixed(1)}%');
    expect(count(src, 'runningRate.toFixed(1)')).toBe(1);
    expect(src).not.toContain('>设备运行率<');
  });

  it('分区厂房清单只落一处：左栏分区卡（每个分区一行一厂房 +「进入 ›」）', () => {
    const src = l1();
    // 2026-09-22 按旧版截图把清单从"点中之后的右侧成绩卡"挪回左栏 ——
    // 左栏能一眼看全所有分区的厂房，成绩卡再列一遍就是同一个清单说两遍。
    expect(count(src, 'buildingNames.map')).toBe(1);
    expect(src).not.toContain('产值未接入');
  });
});
