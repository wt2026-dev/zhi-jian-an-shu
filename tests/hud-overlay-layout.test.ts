// 厂区总览大屏浮层布局守卫（第二轮布局返工的验收口径）。
//
// 为什么用源码断言而不是截图 diff：内置浏览器面板在验收时段始终 hidden，
// requestAnimationFrame 不触发 → 3D 视口连挂载都做不到，任何像素级验收都拿不到。
// 但这一轮的四个问题全部是"确定的几何/格式"问题，能在 class 组合上钉死：
//   ① 顶部两条栏贴在一起 → 面包屑栏必须从 top-14 起，两侧面板必须再让到 top-[110px]；
//   ② 图例压在底部 KPI 卡片上 → 图例停靠位改由调用方给，厂区层让开右侧指标面板一整列；
//   ③ 80.92307692307692% 这类原始浮点撑破卡片 → 所有百分比一律 toFixed(1)；
//   ④ 底部三块卡片高矮不一、间距 8px → 统一 min-h-[90px] + gap-4 + items-stretch。
// 浏览器可用后应补真机截图，本文件只保证这些不变量不回归。
import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const hud = () => fs.readFileSync(path.join(ROOT, 'src/components/equipment3d/ProductionHUD.tsx'), 'utf8');
const legend = () => fs.readFileSync(path.join(ROOT, 'src/components/equipment3d/SceneLegend.tsx'), 'utf8');
const scene = () => fs.readFileSync(path.join(ROOT, 'src/components/equipment3d/EquipmentScene.tsx'), 'utf8');

/** 出现次数（用来把"漏改一处"和"改过头"区分开） */
const count = (src: string, needle: string): number => src.split(needle).length - 1;

describe('顶部两条栏的纵向分工', () => {
  it('HUD 面包屑栏下移到 top-14，不再贴着外层工具栏', () => {
    expect(hud()).toContain('absolute top-14 left-3 right-3');
    expect(hud()).not.toContain('absolute top-2 left-3 right-3');
  });

  it('两侧面板统一让到 top-[110px]（面包屑 56 + 42 高 + 12 间距）', () => {
    const src = hud();
    expect(count(src, 'top-[110px]')).toBe(7);
    // 除了面包屑栏本身，不该再有第二处 top-14 的侧栏
    expect(count(src, 'top-14 left-3 right-3')).toBe(1);
    expect(src).not.toContain('top-14 bottom-3');
    expect(src).not.toContain('top-14 px-1.5');
    expect(src).not.toContain('top-14 flex flex-col');
  });

  it('面板最大高度按新的顶部起点重算，底部留白维持 74px', () => {
    const src = hud();
    expect(src).not.toContain('max-h-[calc(100%-130px)]');
    expect(count(src, 'max-h-[calc(100%-184px)]')).toBe(2);
  });
});

describe('图层图例的停靠', () => {
  it('宽度收窄到 220px', () => {
    expect(legend()).toMatch(/const LEGEND_WIDTH = 220/);
  });

  it('组件内不写死 bottom，停靠位全部交给调用方', () => {
    const src = legend();
    expect(src).not.toMatch(/className=\{`pointer-events-auto absolute bottom/);
    // 内联 style 只写背景与宽度；bottom 只能来自 className
    expect(src).toContain("style={{ background: 'rgba(15, 23, 42, 0.85)', width: LEGEND_WIDTH }}");
    expect(src).toContain("className = 'left-3 bottom-3'");
  });

  it('厂区层停在右下（让开整条右侧指标面板），车间/聚焦层仍在左侧菜单右边', () => {
    const src = scene();
    expect(src).toContain("'right-[262px] bottom-20'");
    expect(src).toContain("'left-[262px] bottom-3'");
    expect(src).toContain("'left-3 bottom-3'");
  });

  it('自动避让只会往上抬，不会把图例拽到停靠位以下', () => {
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

  it('卡片内数字字号统一为 9px', () => {
    const src = hud();
    expect(src).not.toContain('text-[7px] hud-tabular-nums text-slate-300');
    expect(src).not.toContain('space-y-1 text-[8px] font-mono pt-1');
  });
});
