/**
 * 16 台设备的「专属配方」。
 *
 * 设计目标（来自验收要求）：
 *   「16 个设备应该每一个都做得很具体，就像城市生成器里每个城市有它的特征一样，
 *     每台设备也有它自己的特征。不要 16 台设备一锅端。」
 *
 * 与参考生成器的对应关系：
 *   城市生成器里每座城市 = 一份完整配方（体量组合 + 屋顶形制 + 地标 + 配色），
 *   切换预设时整座城市一眼可辨。这里把「城市」换成「设备」：
 *   每台设备有自己的本体几何组合、专属涂装色带、铭牌编号、关键零件与状态动画。
 *
 * 与「原型」的关系：
 *   旧实现按 8 类原型建模，同原型的 2 台设备长得一模一样。
 *   现在原型只作为**未知设备兜底**（台账出现新设备时仍能渲染），
 *   已知的 16 台一律走本文件的配方。
 *
 * 配色约定（重要，决定了「状态色」与「涂装色」谁主谁次）：
 *   - 设备「本体」一律用 status 着色 —— 健康状态必须永远是第一眼信息；
 *   - 「涂装色 livery」用在色带 / 护罩 / 端盖 / 附件上 —— 它不随状态变化，
 *     因此"把设备从故障改成正常"之后，你仍然认得出这是哪一台。
 *   台账里点名了涂装颜色的设备（4# 蓝色涂装、7# 灰蓝色箱体、10# 橘色机械臂、
 *   15# 白色大臂），其涂装色落在这些附件上，本体仍保持状态着色。
 */

import { HALF_PI, box, boxY, cone, coneY, cyl, cylX, cylY, cylZ, dome, makeParts, pushImpeller, pushShaftKey, sph, torus, type RecipePart } from './parts';
import type { PrototypeKey } from './equipment';

export interface DeviceRecipe {
  /** 台账设备 id（eq-101 … eq-116） */
  id: string;
  /** 台账设备编号，用于 3D 铭牌与面板 */
  code: string;
  /** 一句话辨识特征（面板与验收文档使用） */
  signature: string;
  /** 专属辨识特征清单 —— 直接对应任务台账，禁改 */
  features: string[];
  /** 专属涂装主色（与健康状态无关） */
  livery: number;
  /** 专属涂装副色（护罩 / 标记 / 装饰） */
  livery2?: number;
  /** 兜底原型（未知设备回退、原型统计与标签） */
  proto: PrototypeKey;
  /** 该设备在旧原型体系下的显示名，面板用 */
  protoLabel: string;
  build: () => RecipePart[];
}

/* ========================= 介质类型映射 =========================
 * 介质类型按设备类别严格映射：
 *  - 泵类（eq-101/105/112）：水介质，蓝色粒子
 *  - 空压机/制冷机（eq-102/106/113）：空气/制冷剂，浅青色粒子
 *  - 减速箱（eq-103/107）：润滑油，金色粒子
 *  - 换热器（eq-111/116）：水介质，蓝色粒子
 *  - 电机/机器人/加工中心（eq-104/108/114/109/110/115）：无介质流动，严禁画粒子
 */
export type FluidMedium = 'water' | 'air' | 'oil';

export interface DeviceFluidInfo {
  medium: FluidMedium;
  label: string;
  color: number;
  description: string;
}

export const DEVICE_FLUID_TYPES: Record<string, DeviceFluidInfo> = {
  'eq-101': { medium: 'water', label: '冷却水', color: 0x38bdf8, description: '主循环冷却水' },
  'eq-102': { medium: 'air', label: '压缩空气', color: 0x67e8f9, description: '工艺压缩空气' },
  'eq-103': { medium: 'oil', label: '润滑油', color: 0xfbbf24, description: '齿轮箱润滑油' },
  'eq-105': { medium: 'water', label: '给水', color: 0x38bdf8, description: '锅炉高压给水' },
  'eq-106': { medium: 'air', label: '工艺空气', color: 0x67e8f9, description: '离心压缩空气' },
  'eq-107': { medium: 'oil', label: '润滑油', color: 0xfbbf24, description: '减速机润滑油' },
  'eq-111': { medium: 'water', label: '冷却水', color: 0x38bdf8, description: '板式换热循环水' },
  'eq-112': { medium: 'water', label: '循环水', color: 0x38bdf8, description: '结晶器循环水' },
  'eq-113': { medium: 'air', label: '制冷剂', color: 0x67e8f9, description: '机组制冷介质' },
  'eq-116': { medium: 'water', label: '相变热管工质', color: 0x38bdf8, description: '热管相变工质水' },
};

/* ================================================================
 * eq-101 1#离心主循环给水泵 —— 立式管道泵（蜗壳 + 顶部电机）
 * ================================================================ */
function buildEq101(): RecipePart[] {
  const { parts, push } = makeParts();
  // 加高台架 —— "吊脚楼"式：设备整体架高，塔身向上生长
  push('pad', box(2.7, 0.34, 2.3), [0, 0.17, 0], 'steel');
  for (let i = 0; i < 4; i++) {
    push(`foot${i}`, box(0.42, 0.3, 0.42), [i < 2 ? -1.0 : 1.0, 0.15, i % 2 ? -0.85 : 0.85], 'dark', { detailMin: 1 });
  }
  push('pedestal', cylY(0.88, 0.72, 16), [0, 0.34, 0], 'steel');
  // 蜗壳泵体（立式，轴向竖直）
  push('volute', cylY(1.02, 1.3, 18), [0, 1.06, 0], 'status');
  push('voluteRim', cylY(1.12, 0.18, 18), [0, 2.27, 0], 'livery', { detailMin: 1, cast: false });
  // 进出口：**竖直大弯管** —— 先沿塔身竖直上升，到顶再水平外伸。
  // 这是与 12# 横卧泵形成强对比的关键：竖直走向把整台设备拉成"高 > 宽"的塔。
  for (const sx of [-1, 1] as const) {
    const k = sx < 0 ? 'S' : 'D';
    push(`riser${k}`, cylY(0.3, 2.9, 12), [sx * 1.0, 2.36, 0], 'steel');
    push(`elbow${k}`, cylX(0.26, 0.45, 12), [sx * 1.2, 5.26, 0], 'steel');
    push(`flange${k}`, cylX(0.36, 0.12, 12), [sx * 1.48, 5.26, 0], 'dark');
  }
  // 红色联轴器护罩（立在泵体与电机之间）
  push('coupling', cylY(0.48, 0.44, 14), [0, 2.45, 0], 'livery2');
  push('couplingRib', box(0.12, 0.4, 0.8), [0.28, 2.67, 0], 'livery2', { detailMin: 1, cast: false });
  // 顶部电机（塔尖）
  push('motor', cylY(0.64, 2.1, 18), [0, 2.89, 0], 'steel');
  push('motorFin', box(1.34, 1.1, 1.34), [0, 3.5, 0], 'dark', { detailMin: 2, cast: false });
  push('motorCap', cyl(0.66, 0.44, 0.3, 18), [0, 4.99, 0], 'dark');
  push('lamp', sph(0.16, 10), [0, 5.46, 0], 'glow', { cast: false, anim: { kind: 'blink' } });
  return parts;
}

/* ================================================================
 * eq-102 2#无油螺杆空压机主机 —— 方形隔音箱体（内置螺杆转子可见）
 * ================================================================ */
function buildEq102(): RecipePart[] {
  const { parts, push } = makeParts();
  push('skid', box(4.4, 0.4, 2.4), [0, 0.2, 0], 'steel');
  for (let i = 0; i < 4; i++) {
    push(`foot${i}`, box(0.4, 0.28, 0.4), [i < 2 ? -1.8 : 1.8, 0.14, i % 2 ? -0.9 : 0.9], 'dark', { detailMin: 1 });
  }
  // 方形隔音箱体：正面敞开（+z），箱体骨架由 5 块板组成
  push('shellL', box(0.14, 2.5, 2.0), [-1.72, 1.65, 0], 'status');
  push('shellR', box(0.14, 2.5, 2.0), [1.72, 1.65, 0], 'status');
  push('shellB', box(3.58, 2.5, 0.14), [0, 1.65, -0.93], 'status');
  push('shellTop', box(3.58, 0.14, 2.0), [0, 2.83, 0], 'status');
  push('shellBot', box(3.58, 0.16, 2.0), [0, 0.48, 0], 'status');
  push('trim', box(3.66, 0.2, 2.08), [0, 0.62, 0], 'livery', { detailMin: 1, cast: false });
  // 顶部散热格栅
  for (let i = 0; i < 7; i++) {
    push(`grille${i}`, box(3.2, 0.09, 0.16), [0, 2.95, -0.82 + i * 0.28], 'dark', { detailMin: 1, cast: false });
  }
  // 侧面进风百叶（正面敞开处，透过缝隙能看见内部螺杆转子）
  for (let i = 0; i < 6; i++) {
    push(`louver${i}`, box(3.3, 0.18, 0.1), [0, 0.82 + i * 0.33, 0.96], 'dark', { detailMin: 1, cast: false });
  }
  // 内置螺杆轮廓（一对转子，透过百叶缝隙可见）
  // 用带键的轴而不是裸圆柱：圆柱自转不可见，螺杆转子必须能看出"在转"。
  pushShaftKey(push, 'rotorA', 0.4, 2.4, [0, 1.68, 0], 'dark', { kind: 'spin', axis: 'x', speed: 3.4 }, 2);
  pushShaftKey(push, 'rotorB', 0.4, 2.4, [0, 1.68, 0.52], 'dark', { kind: 'spin', axis: 'x', speed: -3.4, phase: 0.5 }, 2);
  // 进出气管 + 电控面板
  push('pipeIn', cylY(0.34, 0.8, 14), [1.15, 2.9, 0], 'steel');
  push('pipeOut', cylY(0.3, 0.8, 14), [-1.15, 2.9, 0], 'steel');
  push('panel', box(0.16, 1.15, 1.05), [1.86, 1.6, 0], 'accent', { detailMin: 1 });
  push('lamp', sph(0.17, 12), [0, 3.28, 0], 'glow', { cast: false, anim: { kind: 'blink' } });
  return parts;
}

/* ================================================================
 * eq-103 3#轧机行星减速箱 —— 大型箱体 + 对轮联轴器 + 独立润滑油站
 * ================================================================ */
function buildEq103(): RecipePart[] {
  const { parts, push } = makeParts();
  push('base', box(5.4, 0.5, 2.8), [0, 0.25, 0], 'steel');
  // 重型地脚
  for (let i = 0; i < 4; i++) {
    push(`foot${i}`, box(0.9, 0.52, 0.9), [i < 2 ? -2.1 : 2.1, 0.24, i % 2 ? -1.0 : 1.0], 'dark');
  }
  // 大型箱体（critical 时整体抖动 —— 状态动画由 status 驱动，见 equipment.ts animActive）
  push('housing', box(3.0, 2.3, 2.4), [0, 1.65, 0], 'status', { anim: { kind: 'shake', amp: 0.05, speed: 9 } });
  push('ribA', box(0.2, 2.3, 2.46), [-0.8, 1.65, 0], 'livery', { detailMin: 1, cast: false });
  push('ribB', box(0.2, 2.3, 2.46), [0.8, 1.65, 0], 'livery', { detailMin: 1, cast: false });
  push('topCap', box(2.0, 0.3, 2.0), [0, 2.95, 0], 'dark');
  push('inShaft', cylX(0.4, 1.6, 16), [-2.4, 1.9, 0], 'dark');
  push('inFlange', cylX(0.86, 0.2, 16), [-3.05, 1.9, 0], 'dark');
  // 输入轴振动标记（专属：故障时抖动最明显的位置）
  push('vibMark', box(0.5, 0.12, 0.12), [-3.05, 2.52, 0], 'livery2', { cast: false });
  push('outShaft', cylX(0.6, 1.7, 16), [2.3, 1.5, 0], 'dark');
  // 对轮联轴器
  push('coupling', torus(0.75, 0.22, 16, 8), [3.1, 1.5, 0], 'livery2', { rot: [0, HALF_PI, 0] });
  // 独立润滑油站：油罐**加高成烟囱状竖罐** —— 专属特征，
  // 成为全场最高点之一，与 7# 的"矮箱 + 大圆盘"形成强对比。
  push('oilSkid', box(1.5, 0.3, 1.4), [2.4, 0.15, 1.7], 'steel');
  push('oilTank', cylY(0.5, 4.2, 16), [2.4, 0.3, 1.7], 'livery');
  push('oilDome', dome(0.5, 16), [2.4, 4.5, 1.7], 'livery', { detailMin: 1 });
  // 罐身加强箍（让竖罐有尺度感，不至于像一根光溜溜的柱子）
  for (let i = 0; i < 3; i++) {
    push(`oilBand${i}`, cylY(0.56, 0.12, 16), [2.4, 1.2 + i * 1.2, 1.7], 'livery2', { detailMin: 1, cast: false });
  }
  push('oilPipeA', cylZ(0.09, 1.9, 8), [1.55, 1.0, 0.85], 'copper', { detailMin: 1, cast: false });
  push('oilPipeB', cylY(0.09, 3.6, 8), [1.55, 1.0, 0.85], 'copper', { detailMin: 1, cast: false });
  push('gauge', cylX(0.16, 0.3, 10), [1.7, 4.05, 1.0], 'copper', { detailMin: 2, cast: false });
  // 红色脉冲灯（故障/紧急时快闪）
  push('lamp', sph(0.17, 12), [0, 3.2, 0], 'glow', { cast: false, anim: { kind: 'blink' } });
  return parts;
}

/* ================================================================
 * eq-104 4#10kV主电机 —— 大型圆柱机壳 + 散热翅片环 + 顶部接线盒
 * ================================================================ */
function buildEq104(): RecipePart[] {
  const { parts, push } = makeParts();
  // 矮胖敦实：加高加宽的底座台架 + 短而粗的机壳，整体「宽 > 高」，厚重感像压路机。
  // 与 8#（细长高铁车厢）、14#（L 形立式风机柜）形成三种完全不同的电机剪影。
  push('rail', box(5.2, 0.36, 2.9), [0, 0.18, 0], 'steel');
  push('plinth', box(2.6, 0.7, 2.3), [0, 0.71, 0], 'steel');
  for (let i = 0; i < 4; i++) {
    push(`foot${i}`, box(0.62, 0.44, 0.62), [i < 2 ? -1.9 : 1.9, 0.22, i % 2 ? -1.0 : 1.0], 'dark', { detailMin: 1 });
  }
  // 大直径短机身（半径 1.5、长仅 2.9 —— 又矮又胖）
  push('frame', cylX(1.5, 2.9, 22), [0, 2.56, 0], 'status');
  // 粗翅片环（蓝色涂装的辨识特征；环间能看见本体状态色）
  for (let i = 0; i < 6; i++) {
    push(`fin${i}`, cylX(1.68, 0.22, 22), [-1.15 + i * 0.46, 2.56, 0], 'livery', { detailMin: 1, cast: false });
  }
  push('capA', cylX(1.42, 0.42, 22), [-1.66, 2.56, 0], 'dark');
  push('capB', cylX(1.42, 0.42, 22), [1.66, 2.56, 0], 'dark');
  push('bearingA', cylX(0.64, 0.3, 14), [-1.98, 2.56, 0], 'copper', { detailMin: 1 });
  push('bearingB', cylX(0.64, 0.3, 14), [1.98, 2.56, 0], 'copper', { detailMin: 1 });
  // 冷却风扇（正常态旋转）+ 轴端键（让自转肉眼可见）
  pushImpeller(push, 'fan', 0.95, 0.5, [-2.4, 2.56, 0], 'dark', { kind: 'spin', axis: 'x', speed: 7.5 }, 6);
  pushShaftKey(push, 'shaft', 0.34, 1.6, [2.3, 2.56, 0], 'dark', { kind: 'spin', axis: 'x', speed: 4.2 }, 2);
  // 顶部大接线盒（蓝色涂装）—— 体量放大以强化"敦实"
  push('termBox', box(1.5, 0.78, 1.5), [0, 4.45, 0], 'livery');
  push('termLid', box(1.62, 0.14, 1.62), [0, 4.91, 0], 'dark', { detailMin: 1 });
  push('lamp', sph(0.17, 12), [0, 5.2, 0], 'glow', { cast: false, anim: { kind: 'blink' } });
  return parts;
}

/* ================================================================
 * eq-105 5#多级锅炉给水泵 —— 8 级泵壳串联长筒体（全场唯一）
 * ================================================================ */
function buildEq105(): RecipePart[] {
  const { parts, push } = makeParts();
  push('skid', box(7.4, 0.4, 1.7), [0, 0.2, 0], 'steel');
  for (let i = 0; i < 4; i++) {
    push(`foot${i}`, box(0.42, 0.3, 0.42), [i < 2 ? -3.1 : 3.1, 0.15, i % 2 ? -0.6 : 0.6], 'dark', { detailMin: 1 });
  }
  // 8 级泵壳串联（全场唯一的细长多级筒体）
  for (let i = 0; i < 8; i++) {
    const x = -2.8 + i * 0.7;
    push(`stage${i}`, cylX(0.72, 0.64, 20), [x, 1.5, 0], 'status');
    push(`stageBand${i}`, cylX(0.79, 0.11, 20), [x + 0.32, 1.5, 0], 'livery', { detailMin: 1, cast: false });
  }
  // 中间支架
  for (let i = 0; i < 3; i++) {
    push(`support${i}`, box(0.32, 1.14, 1.36), [-1.9 + i * 1.9, 0.95, 0], 'steel', { detailMin: 1 });
  }
  // 两端管路
  push('inPipe', cylX(0.5, 1.0, 16), [-3.75, 1.5, 0], 'steel');
  push('inFlange', cylX(0.68, 0.16, 16), [-4.32, 1.5, 0], 'dark');
  push('outPipe', cylX(0.44, 1.0, 16), [3.8, 1.5, 0], 'steel');
  push('outFlange', cylX(0.62, 0.16, 16), [4.37, 1.5, 0], 'dark');
  // 联轴器：running 态下带键旋转（8 级泵由右端电机驱动，联轴器是可见的转动件）
  pushShaftKey(push, 'coupling', 0.4, 0.5, [2.5, 1.5, 0], 'livery2', { kind: 'spin', axis: 'x', speed: 5.2 }, 2, {
    detailMin: 1,
  });
  push('motor', cylX(0.78, 1.8, 20), [3.42, 1.5, 0], 'steel');
  push('lamp', sph(0.17, 12), [0, 2.6, 0], 'glow', { cast: false, anim: { kind: 'blink' } });
  return parts;
}

/* ================================================================
 * eq-106 6#工艺空压机 —— 水平剖分离心蜗壳 + 进气导叶 + 大直径进排气管
 * ================================================================ */
function buildEq106(): RecipePart[] {
  const { parts, push } = makeParts();
  push('base', box(5.2, 0.42, 2.6), [0, 0.21, 0], 'steel');
  push('pedestalA', box(1.2, 1.05, 2.2), [-1.5, 0.94, 0], 'steel');
  push('pedestalB', box(1.2, 1.05, 2.2), [1.6, 0.94, 0], 'steel');
  // 蜗壳 + 水平剖分面（专属特征：剖分面清晰可见）
  push('volute', cylX(1.35, 0.95, 24), [0, 2.15, 0], 'status');
  push('splitFace', box(2.85, 0.12, 2.94), [0, 2.15, 0], 'livery', { detailMin: 1, cast: false });
  // 进气导叶
  push('inletCone', cylX(0.86, 1.0, 20), [-1.6, 2.15, 0], 'steel');
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    push(`vane${i}`, box(0.1, 0.62, 0.1), [-2.12, 2.15 + Math.sin(a) * 0.42, Math.cos(a) * 0.42], 'dark', {
      rot: [a, 0, 0],
      detailMin: 2,
      cast: false,
    });
  }
  push('inPipe', cylX(1.0, 0.95, 20), [-2.85, 2.15, 0], 'steel');
  push('inFlange', cylX(1.18, 0.16, 20), [-3.4, 2.15, 0], 'dark');
  // 大直径排气管（向上）
  push('outPipe', cylY(0.7, 2.3, 20), [0.85, 3.0, 0], 'steel');
  push('outFlange', cyl(0.9, 0.9, 0.14, 20), [0.85, 5.35, 0], 'dark');
  // 轴承箱
  push('bearingBox', box(1.05, 0.95, 0.95), [2.5, 2.15, 0], 'dark');
  pushShaftKey(push, 'shaft', 0.3, 2.7, [1.9, 2.15, 0], 'dark', { kind: 'spin', axis: 'x', speed: 5 }, 2);
  push('lamp', sph(0.17, 12), [2.5, 2.85, 0], 'glow', { cast: false, anim: { kind: 'blink' } });
  return parts;
}

/* ================================================================
 * eq-107 7#卷取减速机 —— 灰蓝色箱体 + 输出轴端大法兰
 * ================================================================ */
function buildEq107(): RecipePart[] {
  const { parts, push } = makeParts();
  // 矮箱 + 大圆盘：箱体刻意压低压长，输出端法兰放大成直径远超箱高的圆盘。
  // 与 3#（高箱 + 烟囱状油罐）形成"一矮一高"的强对比剪影。
  push('bed', box(4.2, 0.28, 2.1), [0, 0.14, 0], 'steel');
  push('body', box(2.9, 1.5, 2.0), [0, 1.18, 0], 'status');
  // 灰蓝色箱体面板（专属涂装：正面 + 顶盖）
  push('panelFront', box(2.94, 1.34, 0.1), [0, 1.18, 1.02], 'livery', { detailMin: 1, cast: false });
  push('cover', box(3.0, 0.22, 2.1), [0, 2.04, 0], 'livery', { detailMin: 1 });
  push('ribA', box(0.18, 1.5, 2.06), [-0.75, 1.18, 0], 'livery', { detailMin: 2, cast: false });
  push('ribB', box(0.18, 1.5, 2.06), [0.75, 1.18, 0], 'livery', { detailMin: 2, cast: false });
  push('hShaft', cylX(0.3, 1.1, 12), [-1.9, 1.18, 0], 'dark');
  pushShaftKey(push, 'outShaft', 0.46, 1.4, [1.9, 1.18, 0], 'dark', { kind: 'spin', axis: 'x', speed: 2.6 }, 2);
  // 输出轴端大圆盘（专属特征：直径 1.8 ≈ 箱体高度的 1.2 倍，剪影上非常抢眼）。
  // 轴心 y=1.18、半径 0.9 → 圆盘最低点 0.28 恰好落在床身顶面，**不会切进床身**。
  push('bigFlange', cylX(0.9, 0.3, 18), [2.62, 1.18, 0], 'dark');
  push('flangeHub', cylX(0.42, 0.34, 14), [2.9, 1.18, 0], 'dark', { detailMin: 1 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    push(`bolt${i}`, cylX(0.09, 0.36, 8), [2.66, 1.18 + Math.sin(a) * 0.64, Math.cos(a) * 0.64], 'dark', {
      detailMin: 2,
      cast: false,
    });
  }
  push('sight', cylX(0.15, 0.3, 10), [1.1, 2.26, 0], 'copper', { detailMin: 2, cast: false });
  push('lamp', sph(0.17, 12), [0, 2.32, 0], 'glow', { cast: false, anim: { kind: 'blink' } });
  return parts;
}

/* ================================================================
 * eq-108 8#同步电机 —— 主机圆柱 + 尾部励磁机小圆柱 + 冷却风罩
 * ================================================================ */
function buildEq108(): RecipePart[] {
  const { parts, push } = makeParts();
  // 细长（"高铁车厢"）：机身半径压到 0.82、拉长到 4.0，长径比 > 2，
  // 与 4#（矮胖）、14#（L 形）三种电机剪影互不相同。
  push('rail', box(6.4, 0.28, 1.9), [0, 0.14, 0], 'steel');
  for (let i = 0; i < 4; i++) {
    push(`foot${i}`, box(0.46, 0.34, 0.46), [i < 2 ? -2.3 : 2.3, 0.45, i % 2 ? -0.72 : 0.72], 'dark', { detailMin: 1 });
  }
  push('frame', cylX(0.82, 4.0, 20), [0, 1.6, 0], 'status');
  push('capA', cylX(0.78, 0.36, 20), [-2.18, 1.6, 0], 'dark');
  push('capB', cylX(0.78, 0.36, 20), [2.18, 1.6, 0], 'dark');
  // 尾部励磁机：鼓包放大到直径落差肉眼可见（0.78 → 0.66 的台阶 + 独立端盖）
  push('exciter', cylX(0.66, 1.1, 18), [2.91, 1.6, 0], 'livery');
  push('exciterStep', cylX(0.8, 0.16, 18), [2.42, 1.6, 0], 'livery2', { detailMin: 1, cast: false });
  push('exciterCap', cylX(0.56, 0.22, 18), [3.57, 1.6, 0], 'dark', { detailMin: 1 });
  pushShaftKey(push, 'exciterShaft', 0.18, 0.5, [3.86, 1.6, 0], 'dark', { kind: 'spin', axis: 'x', speed: 6 }, 2, {
    detailMin: 1,
  });
  // 冷却风罩（前端）
  push('coolHood', cylX(0.72, 0.6, 18), [-2.6, 1.6, 0], 'dark');
  push('coolFin', box(0.1, 1.3, 1.3), [-2.94, 1.6, 0], 'dark', { detailMin: 2, cast: false });
  // 机身上方**外置冷却风道长管**（专属特征：把剪影拉成"车厢顶"的轮廓）
  push('coolDuct', cylX(0.26, 3.9, 12), [0, 2.74, 0], 'steel');
  for (let i = 0; i < 3; i++) {
    push(`ductBracket${i}`, box(0.22, 0.34, 0.42), [-1.4 + i * 1.4, 2.44, 0], 'dark', { detailMin: 1, cast: false });
  }
  // 状态灯坐在风道**顶面之上**（风道顶 y=3.00），避免与风道圆柱互相穿插。
  push('lamp', sph(0.17, 12), [0, 3.18, 0], 'glow', { cast: false, anim: { kind: 'blink' } });
  return parts;
}

/* ================================================================
 * eq-109 9#龙门加工中心 —— 龙门架（双立柱 + 横梁）+ 可动主轴头 + 刀库（全场唯一龙门）
 * ================================================================ */
function buildEq109(): RecipePart[] {
  const { parts, push } = makeParts();
  push('bed', box(5.4, 0.52, 3.2), [0, 0.26, 0], 'steel');
  push('bedRib', box(5.4, 0.3, 3.28), [0, 0.67, 0], 'dark', { detailMin: 1, cast: false });
  push('table', box(3.2, 0.36, 2.0), [0, 1.0, 0.4], 'status');
  for (let i = 0; i < 5; i++) {
    push(`tslot${i}`, box(3.0, 0.07, 0.13), [0, 1.22, -0.32 + i * 0.36], 'dark', { detailMin: 2, cast: false });
  }
  // 龙门架：双立柱 + 横梁（专属特征，全场唯一）
  push('columnL', box(0.66, 2.6, 0.78), [-1.6, 2.02, -0.98], 'status');
  push('columnR', box(0.66, 2.6, 0.78), [1.6, 2.02, -0.98], 'status');
  push('gantry', box(3.9, 0.62, 0.8), [0, 3.32, -0.98], 'livery');
  push('gantryRail', box(3.7, 0.1, 0.2), [0, 2.98, -0.62], 'dark', { detailMin: 1, cast: false });
  // 可动主轴头（沿横梁往复）
  push('ram', box(0.86, 1.75, 0.86), [0, 2.4, -0.98], 'dark', { anim: { kind: 'slide', axis: 'x', speed: 0.22 } });
  push('spindle', cylY(0.28, 0.75, 14), [0, 1.32, -0.98], 'copper');
  push('tool', coneY(0.16, 0.55, 10), [0, 0.62, -0.98], 'dark', { detailMin: 1 });
  // 刀库（伞盘式，专属特征）
  push('magazineBase', cylY(0.34, 1.5, 12), [2.6, 0.52, 0.4], 'dark');
  push('magazine', coneY(1.05, 0.5, 20), [2.6, 1.9, 0.4], 'livery');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    push(`tool${i}`, cone(0.11, 0.44, 8), [2.6 + Math.cos(a) * 0.78, 1.86, 0.4 + Math.sin(a) * 0.78], 'copper', {
      rot: [Math.PI, 0, 0],
      detailMin: 1,
      cast: false,
    });
  }
  push('guard', box(3.9, 0.12, 2.4), [0, 3.72, -0.5], 'glass', { detailMin: 1, cast: false });
  push('panel', box(0.16, 1.4, 1.1), [2.8, 2.0, 1.1], 'accent', { detailMin: 1 });
  push('lamp', sph(0.17, 12), [-2.6, 3.5, 0], 'glow', { cast: false, anim: { kind: 'blink' } });
  return parts;
}

/* ================================================================
 * eq-110 10#搬运机器人 —— 橘色六关节机械臂（KUKA 配色）
 * ================================================================ */
function armTip(base: [number, number], angle: number, len: number): [number, number] {
  return [base[0] - Math.sin(angle) * len, base[1] + Math.cos(angle) * len];
}

function buildEq110(): RecipePart[] {
  const { parts, push } = makeParts();
  push('pad', box(2.0, 0.36, 2.0), [0, 0.18, 0], 'steel');
  push('base', cylY(0.98, 0.95, 20), [0, 0.36, 0], 'livery');
  push('baseTrim', cylY(1.04, 0.18, 20), [0, 1.2, 0], 'dark', { detailMin: 1, cast: false });
  push('waist', cylY(0.74, 0.62, 18), [0, 1.31, 0], 'status');
  push('lamp', sph(0.17, 12), [0, 1.35, 1.0], 'glow', { cast: false, anim: { kind: 'blink' } });

  const shoulder: [number, number] = [0, 1.98];
  push('shoulder', cylX(0.46, 0.88, 16), [0, 1.98, 0], 'livery');

  const a1 = -0.3;
  const L1 = 1.75;
  const elbow = armTip(shoulder, a1, L1);
  push('arm1', boxY(0.62, L1, 0.72), [shoulder[0], shoulder[1], 0], 'livery', { rot: [0, 0, a1] });
  push('elbow', cylX(0.4, 0.7, 16), [elbow[0], elbow[1], 0], 'livery');

  const a2 = 0.62;
  const L2 = 1.3;
  const wrist = armTip(elbow, a2, L2);
  push('arm2', boxY(0.48, L2, 0.56), [elbow[0], elbow[1], 0], 'livery', { rot: [0, 0, a2] });
  // 腕部回转关节：与 15# 码垛机器人同样带键，running 态下回转可见
  pushShaftKey(push, 'wrist', 0.32, 0.54, [wrist[0], wrist[1], 0], 'livery', { kind: 'spin', axis: 'x', speed: 3.2 }, 2);
  // 末端抓手（与 15# 的吸盘明显不同：两指夹爪）
  push('toolBase', box(0.5, 0.34, 0.48), [wrist[0] - 0.38, wrist[1] - 0.38, 0], 'dark', { rot: [0, 0, a2] });
  push('fingerL', box(0.12, 0.52, 0.14), [wrist[0] - 0.7, wrist[1] - 0.86, 0.16], 'dark', { rot: [0, 0, a2] });
  push('fingerR', box(0.12, 0.52, 0.14), [wrist[0] - 0.7, wrist[1] - 0.86, -0.16], 'dark', { rot: [0, 0, a2] });
  return parts;
}

/* ================================================================
 * eq-111 11#板式换热器 —— 矩形板片组（多层夹紧）+ 四角接管 + 框架
 * ================================================================ */
function buildEq111(): RecipePart[] {
  const { parts, push } = makeParts();
  push('frame', box(3.4, 0.4, 1.9), [0, 0.2, 0], 'steel');
  push('columnL', box(0.24, 2.9, 0.3), [-1.55, 1.85, -0.72], 'livery');
  push('columnR', box(0.24, 2.9, 0.3), [1.55, 1.85, -0.72], 'livery');
  push('columnL2', box(0.24, 2.9, 0.3), [-1.55, 1.85, 0.72], 'livery');
  push('columnR2', box(0.24, 2.9, 0.3), [1.55, 1.85, 0.72], 'livery');
  push('topBeam', box(3.4, 0.24, 0.32), [0, 3.2, -0.72], 'livery', { detailMin: 1 });
  // 板片组：多层夹紧（专属特征）
  for (let i = 0; i < 11; i++) {
    push(`plate${i}`, box(0.09, 2.35, 1.5), [-0.72 + i * 0.145, 1.85, 0], i % 2 ? 'status' : 'steel', { detailMin: 1, cast: false });
  }
  push('plateEnd', box(0.2, 2.45, 1.6), [0.95, 1.85, 0], 'dark');
  push('plateHead', box(0.22, 2.45, 1.6), [-0.86, 1.85, 0], 'dark');
  // 四角接管
  const pts: Array<[number, number]> = [
    [-1.2, -0.62],
    [-1.2, 0.62],
    [0.7, -0.62],
    [0.7, 0.62],
  ];
  for (let i = 0; i < 4; i++) {
    push(`nozzle${i}`, cylZ(0.24, 0.75, 14), [pts[i][0], 2.5, pts[i][1] + 0.62], 'steel', { detailMin: 1 });
    push(`nozzleFlange${i}`, cylZ(0.36, 0.12, 14), [pts[i][0], 2.5, pts[i][1] + 0.98], 'dark', { detailMin: 2, cast: false });
  }
  push('tieRodA', cylX(0.07, 2.3, 6), [0, 3.05, -0.62], 'dark', { detailMin: 2, cast: false });
  push('tieRodB', cylX(0.07, 2.3, 6), [0, 3.05, 0.62], 'dark', { detailMin: 2, cast: false });
  push('lamp', sph(0.17, 12), [0, 3.42, 0], 'glow', { cast: false, anim: { kind: 'blink' } });
  return parts;
}

/* ================================================================
 * eq-112 12#结晶器泵 —— 端吸泵 + 电机（fault：红色高亮 + 泵体异常抖动）
 * ================================================================ */
function buildEq112(): RecipePart[] {
  const { parts, push } = makeParts();
  // L 形（**横卧短粗 + 顶部出水管单柱上冲**）：
  // 刻意做成 1# 立式管道泵"竖塔"的**镜像反面**——
  //   1# ：高 5.6 > 宽 3.0，双竖管 + 立式泵体，像"烟囱/吊脚楼"；
  //   12#：宽 5.7 > 高 4.5，矮胖蜗壳 + 单根上冲出水管，像"矮墩 + 单高柱"。
  // 两台泵并排时一眼可分：一个竖着长、一个横着躺。
  push('base', box(4.8, 0.4, 2.0), [0.1, 0.2, 0], 'steel');
  for (let i = 0; i < 4; i++) {
    push(`foot${i}`, box(0.46, 0.3, 0.46), [i < 2 ? -1.75 : 1.85, 0.15, i % 2 ? -0.72 : 0.72], 'dark', { detailMin: 1 });
  }
  // 蜗壳：短而粗的**大圆盘**（半径 1.18，大于机身），端吸泵的标志性外形。
  // 故障态 → 整体异常抖动（状态驱动的动画，非随机）。
  push('casing', cylX(1.18, 0.92, 20), [-1.0, 1.5, 0], 'status', { anim: { kind: 'shake', amp: 0.055, speed: 11 } });
  push('voluteRim', cylX(1.28, 0.16, 20), [-1.0, 1.5, 0], 'livery', { detailMin: 1, cast: false });
  // 吸入口：**轴向水平向左**（端吸 = 端面吸入）
  push('suction', cylX(0.58, 0.85, 16), [-2.05, 1.5, 0], 'steel');
  push('flangeS', cylX(0.74, 0.16, 16), [-2.5, 1.5, 0], 'dark');
  // 排出口：从蜗壳顶部**垂直上冲**（L 的竖边）。单根粗管，比 1# 的双细竖管更"墩"。
  // 注意：cylY 的定位点是**管底**（几何体底面贴在 pos.y），不是管心。
  push('dischargeElbow', cylY(0.56, 0.24, 14), [-1.0, 2.4, 0], 'dark', { detailMin: 1, cast: false });
  push('discharge', cylY(0.46, 2.0, 14), [-1.0, 2.5, 0], 'steel');
  push('flangeD', cylY(0.62, 0.14, 14), [-1.0, 4.5, 0], 'dark');
  push('bearingHousing', box(0.62, 0.9, 0.9), [0.35, 1.5, 0], 'dark', { detailMin: 1 });
  push('coupling', cylX(0.42, 0.6, 16), [1.05, 1.5, 0], 'livery2', { detailMin: 1 });
  push('motor', cylX(0.76, 1.6, 20), [2.05, 1.5, 0], 'steel');
  push('motorCap', cylX(0.78, 0.26, 20), [2.95, 1.5, 0], 'dark', { detailMin: 1 });
  push('lamp', sph(0.17, 12), [0, 2.2, 0], 'glow', { cast: false, anim: { kind: 'blink' } });
  return parts;
}

/* ================================================================
 * eq-113 13#制冷压缩机组 —— 螺杆主机 + 圆筒油分离器 + 冷凝器 + 管路
 * ================================================================ */
function buildEq113(): RecipePart[] {
  const { parts, push } = makeParts();
  push('skid', box(5.0, 0.42, 2.4), [0, 0.21, 0], 'steel');
  push('screw', cylX(0.78, 2.1, 20), [-1.3, 1.5, 0], 'status');
  push('screwCap', cylX(0.8, 0.24, 20), [-2.5, 1.5, 0], 'livery', { detailMin: 1 });
  pushShaftKey(push, 'screwShaft', 0.26, 1.2, [0.2, 1.5, 0], 'dark', { kind: 'spin', axis: 'x', speed: 5.2 }, 2);
  // 圆筒油分离器（竖直圆筒，专属特征）
  push('separator', cylY(0.62, 2.5, 20), [1.2, 0.42, -0.55], 'livery');
  push('separatorTop', dome(0.62, 20), [1.2, 2.92, -0.55], 'livery', { detailMin: 1 });
  push('separatorSkirt', cylY(0.68, 0.16, 20), [1.2, 0.42, -0.55], 'dark', { detailMin: 2, cast: false });
  // 冷凝器（卧式，带端盖）
  push('condenser', cylX(0.66, 2.6, 20), [0.4, 0.95, 0.85], 'steel');
  push('condCapA', cylX(0.68, 0.2, 20), [-1.0, 0.95, 0.85], 'dark', { detailMin: 1 });
  push('condCapB', cylX(0.68, 0.2, 20), [1.8, 0.95, 0.85], 'dark', { detailMin: 1 });
  for (let i = 0; i < 6; i++) {
    push(`condFin${i}`, cylX(0.74, 0.09, 20), [-0.6 + i * 0.42, 0.95, 0.85], 'livery', { detailMin: 1, cast: false });
  }
  // 管路
  push('pipeA', cylY(0.12, 1.5, 10), [-0.35, 1.5, -0.4], 'copper', { detailMin: 1, cast: false });
  push('pipeB', cylZ(0.12, 1.1, 10), [1.2, 2.4, -0.2], 'copper', { detailMin: 1, cast: false });
  push('pipeC', cylY(0.12, 1.3, 10), [1.2, 2.9, 0.3], 'copper', { detailMin: 1, cast: false });
  push('panel', box(0.16, 1.2, 1.0), [-2.5, 1.3, 0.7], 'accent', { detailMin: 1 });
  push('lamp', sph(0.17, 12), [0, 2.5, 0], 'glow', { cast: false, anim: { kind: 'blink' } });
  return parts;
}

/* ================================================================
 * eq-114 14#备用电机 —— 变频电机 + 独立冷却风扇罩（standby：静止灰）
 * ================================================================ */
function buildEq114(): RecipePart[] {
  const { parts, push } = makeParts();
  // L 形：卧式机身 + 尾部**立式风机柜**（正方体箱 + 顶部排风口）。
  // 冷却风扇罩从"与机身等径的圆筒"改成独立立柜，剪影变成明显的 L，
  // 与 4#（矮胖）、8#（细长）三台电机各不相同。
  push('rail', box(4.6, 0.3, 2.0), [0, 0.15, 0], 'steel');
  for (let i = 0; i < 4; i++) {
    push(`foot${i}`, box(0.5, 0.38, 0.5), [i < 2 ? -1.7 : 1.7, 0.46, i % 2 ? -0.78 : 0.78], 'dark', { detailMin: 1 });
  }
  push('frame', cylX(0.9, 2.2, 20), [1.0, 1.6, 0], 'status');
  for (let i = 0; i < 4; i++) {
    push(`fin${i}`, cylX(0.97, 0.1, 20), [0.35 + i * 0.46, 1.6, 0], 'livery', { detailMin: 1, cast: false });
  }
  push('capA', cylX(0.86, 0.34, 20), [-0.12, 1.6, 0], 'dark');
  push('capB', cylX(0.86, 0.34, 20), [2.12, 1.6, 0], 'dark');
  push('shaft', cylX(0.27, 1.2, 12), [2.7, 1.6, 0], 'dark');
  // 立式风机柜（专属特征）：**柜底 y=0.30 正好坐在底架顶面**（底架 0~0.30），
  // 不沉进底架；柜顶 3.30，明显高过机身（机身顶 2.50），构成 L 的竖边。
  push('fanCabinet', box(1.7, 3.0, 1.8), [-1.35, 1.8, 0], 'livery');
  push('cabinetTrim', box(1.78, 0.16, 1.88), [-1.35, 3.24, 0], 'livery2', { detailMin: 1, cast: false });
  // 顶部排风口（百叶）
  for (let i = 0; i < 3; i++) {
    push(`vent${i}`, box(1.5, 0.09, 0.28), [-1.35, 3.4, -0.5 + i * 0.5], 'dark', { detailMin: 1, cast: false });
  }
  push('cabinetDoor', box(0.08, 2.2, 1.2), [-0.48, 1.75, 0], 'livery2', { detailMin: 2, cast: false });
  pushImpeller(push, 'fan', 0.58, 0.34, [-0.38, 1.8, 0], 'dark', { kind: 'spin', axis: 'x', speed: 6 }, 6);
  push('termBox', box(0.9, 0.6, 1.0), [1.0, 2.5, 0], 'livery', { detailMin: 1 });
  // 状态灯：与其余 15 台一致。待机态 blink 不激活（静止），
  // 但状态一旦变为预警/故障，这盏灯就该闪 —— 不能因为"当前是待机"就不装灯。
  // 位置贴在排风口顶面（3.45）之上，避免悬空。
  push('lamp', sph(0.17, 12), [-1.35, 3.62, 0], 'glow', { cast: false, anim: { kind: 'blink' } });
  return parts;
}

/* ================================================================
 * eq-115 15#码垛机器人 —— 白色大臂 + 平行四边形连杆 + 末端吸盘抓手
 * ================================================================ */
function buildEq115(): RecipePart[] {
  const { parts, push } = makeParts();
  push('pad', box(2.4, 0.4, 2.4), [0, 0.2, 0], 'steel');
  push('base', cylY(1.05, 0.8, 20), [0, 0.4, 0], 'livery');
  push('baseRing', cylY(1.12, 0.2, 20), [0, 1.1, 0], 'livery2', { detailMin: 1, cast: false });
  push('waist', cylY(0.8, 0.6, 18), [0, 1.2, 0], 'livery');
  push('lamp', sph(0.17, 12), [0, 1.35, 1.1], 'glow', { cast: false, anim: { kind: 'blink' } });

  // 白色大臂（竖直主臂，专属特征）
  const shoulder: [number, number] = [0, 1.8];
  push('shoulder', cylX(0.42, 0.9, 16), [0, 1.8, 0], 'livery2');
  push('upperArm', boxY(0.5, 2.5, 0.6), [0, 1.8, 0], 'livery');
  // 平行四边形连杆（专属特征：两段平行拉杆 + 摇臂）
  push('linkA', boxY(0.22, 2.1, 0.24), [-0.62, 1.9, 0], 'livery', { detailMin: 1 });
  push('linkB', boxY(0.22, 2.1, 0.24), [-0.62, 1.9, 0.42], 'livery', { detailMin: 1 });
  push('rocker', box(0.5, 0.28, 0.9), [-0.62, 4.0, 0.2], 'livery2', { detailMin: 1 });

  const elbow: [number, number] = [0, 4.3];
  push('elbow', cylX(0.36, 0.66, 14), [elbow[0], elbow[1], 0], 'livery2');
  const wrist: [number, number] = [1.35, 4.3];
  push('foreArm', boxY(1.45, 0.44, 0.5), [elbow[0], elbow[1], 0], 'livery', { rot: [0, 0, -HALF_PI] });
  // 腕部回转关节：running 态下带键回转（码垛机器人取放件时腕部在转），
  // 键块让"在转"可见 —— 裸圆柱自转是看不出来的。
  pushShaftKey(push, 'wrist', 0.3, 0.5, [wrist[0], wrist[1], 0], 'livery2', { kind: 'spin', axis: 'x', speed: 3.6 }, 2);
  // 末端吸盘抓手（与 10# 的两指夹爪明显不同：吸盘阵列）
  push('toolPlate', box(0.5, 0.26, 1.0), [wrist[0] + 0.32, wrist[1], 0], 'livery2', { detailMin: 1 });
  for (let i = 0; i < 4; i++) {
    push(`cup${i}`, cylY(0.17, 0.3, 10), [wrist[0] + 0.32, wrist[1] - 0.42, i < 2 ? -0.36 : 0.36], 'dark', {
      detailMin: 1,
      cast: false,
    });
  }
  return parts;
}

/* ================================================================
 * eq-116 16#热管换热器 —— 竖直热管束阵列 + 箱体 + 风道
 * ================================================================ */
function buildEq116(): RecipePart[] {
  const { parts, push } = makeParts();
  push('frame', box(4.6, 0.42, 2.6), [0, 0.21, 0], 'steel');
  push('casing', box(4.2, 1.5, 2.2), [0, 1.17, 0], 'status');
  push('casingTrim', box(4.26, 0.18, 2.26), [0, 1.85, 0], 'livery', { detailMin: 1, cast: false });
  // 竖直热管束阵列（专属特征：成排竖直细管）
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 9; c++) {
      push(`tube${r}_${c}`, cylY(0.14, 1.9, 10), [-1.76 + c * 0.44, 1.92, r ? -0.5 : 0.5], 'livery', {
        detailMin: 1,
        cast: false,
      });
      push(`tubeCap${r}_${c}`, sph(0.15, 10), [-1.76 + c * 0.44, 3.84, r ? -0.5 : 0.5], 'copper', {
        detailMin: 2,
        cast: false,
      });
    }
  }
  push('topHeader', box(4.0, 0.22, 1.6), [0, 3.62, 0], 'dark', { detailMin: 1 });
  // 风道
  push('ductA', box(1.4, 1.1, 0.9), [-2.5, 1.5, 0], 'dark', { detailMin: 1 });
  push('ductB', cylX(0.5, 1.2, 16), [-3.4, 1.5, 0], 'steel', { detailMin: 1 });
  push('ductFlange', cylX(0.64, 0.14, 16), [-4.0, 1.5, 0], 'dark', { detailMin: 2, cast: false });
  pushImpeller(push, 'fan', 0.42, 0.3, [-3.5, 1.5, 0], 'dark', { kind: 'spin', axis: 'x', speed: 6.5 }, 6);
  push('lamp', sph(0.17, 12), [0, 4.0, 0], 'glow', { cast: false, anim: { kind: 'blink' } });
  return parts;
}

/* ================================================================
 * 配方表 —— 键为台账设备 id
 * ================================================================ */
export const DEVICE_RECIPES: Record<string, DeviceRecipe> = {
  'eq-101': {
    id: 'eq-101',
    code: 'EQ-2024-PUMP-01',
    signature: '立式管道泵：蜗壳泵体 + 顶部电机 + 红色联轴器护罩',
    features: ['蜗壳泵体', '顶部电机', '红色联轴器护罩', '进出口法兰', '底座', '黄色警示带'],
    livery: 0xf2b705,
    livery2: 0xd0342c,
    proto: 'pump',
    protoLabel: '离心泵组',
    build: buildEq101,
  },
  'eq-102': {
    id: 'eq-102',
    code: 'EQ-2024-COMP-02',
    signature: '方形隔音箱体：顶部散热格栅 + 侧面进风百叶 + 可见螺杆转子',
    features: ['方形隔音箱体', '顶部散热格栅', '侧面进风百叶', '内置螺杆轮廓', '绿色运行灯'],
    livery: 0x18a999,
    proto: 'compressor',
    protoLabel: '压缩机组',
    build: buildEq102,
  },
  'eq-103': {
    id: 'eq-103',
    code: 'EQ-2024-GEAR-03',
    signature: '大型减速箱：对轮联轴器 + 独立润滑油站（油罐 + 管路）',
    features: ['大型箱体', '对轮联轴器', '独立润滑油站(油罐+管路)', '重型地脚', '红色脉冲灯', '输入轴振动标记'],
    livery: 0x9b2f5f,
    livery2: 0xd94f2b,
    proto: 'gearbox',
    protoLabel: '齿轮箱',
    build: buildEq103,
  },
  'eq-104': {
    id: 'eq-104',
    code: 'EQ-2024-MOTOR-04',
    signature: '大型圆柱机壳：散热翅片环 + 顶部接线盒（蓝色涂装）',
    features: ['大型圆柱机壳', '散热翅片环', '顶部接线盒', '轴承端盖', '蓝色涂装'],
    livery: 0x2563eb,
    proto: 'motor',
    protoLabel: '大型电机',
    build: buildEq104,
  },
  'eq-105': {
    id: 'eq-105',
    code: 'EQ-2024-PUMP-05',
    signature: '8 级泵壳串联长筒体（全场唯一）+ 两端管路 + 中间支架',
    features: ['8 级泵壳串联长筒体(全场唯一)', '两端管路', '中间支架'],
    livery: 0x0e7490,
    livery2: 0x155e75,
    proto: 'pump',
    protoLabel: '离心泵组',
    build: buildEq105,
  },
  'eq-106': {
    id: 'eq-106',
    code: 'EQ-2024-COMP-06',
    signature: '水平剖分离心蜗壳 + 进气导叶 + 大直径进排气管',
    features: ['水平剖分离心蜗壳', '进气导叶', '大直径进排气管', '轴承箱'],
    livery: 0x7c3aed,
    proto: 'compressor',
    protoLabel: '压缩机组',
    build: buildEq106,
  },
  'eq-107': {
    id: 'eq-107',
    code: 'EQ-2024-REDU-07',
    signature: '灰蓝色箱体 + 输出轴端大法兰 + 底座',
    features: ['灰蓝色箱体', '输出轴端大法兰', '底座'],
    livery: 0x64748b,
    proto: 'reducer',
    protoLabel: '减速机',
    build: buildEq107,
  },
  'eq-108': {
    id: 'eq-108',
    code: 'EQ-2024-MOTOR-08',
    signature: '同步电机：主机圆柱 + 尾部励磁机小圆柱 + 冷却风罩',
    features: ['主机圆柱', '尾部励磁机小圆柱', '冷却风罩'],
    livery: 0x0f766e,
    proto: 'motor',
    protoLabel: '大型电机',
    build: buildEq108,
  },
  'eq-109': {
    id: 'eq-109',
    code: 'EQ-2024-CNC-09',
    signature: '龙门架（双立柱 + 横梁）+ 可动主轴头 + 刀库（全场唯一龙门）',
    features: ['龙门架(双立柱+横梁)', '可动主轴头', '刀库(全场唯一龙门)'],
    livery: 0x334155,
    proto: 'cnc',
    protoLabel: '数控机床',
    build: buildEq109,
  },
  'eq-110': {
    id: 'eq-110',
    code: 'EQ-2024-ROBOT-10',
    signature: '橘色六关节机械臂 + 基座 + 两指夹爪（KUKA 配色）',
    features: ['橘色六关节机械臂', '基座', '末端抓手(KUKA 配色)'],
    livery: 0xf97316,
    livery2: 0x1f2937,
    proto: 'robot',
    protoLabel: '工业机器人',
    build: buildEq110,
  },
  'eq-111': {
    id: 'eq-111',
    code: 'EQ-2024-HEX-11',
    signature: '矩形板片组（多层夹紧）+ 四角接管 + 框架',
    features: ['矩形板片组(多层夹紧)', '四角接管', '框架'],
    livery: 0xca8a04,
    proto: 'exchanger',
    protoLabel: '换热容器',
    build: buildEq111,
  },
  'eq-112': {
    id: 'eq-112',
    code: 'EQ-2024-PUMP-12',
    signature: '端吸泵 + 电机；故障红色高亮 + 泵体异常抖动',
    features: ['端吸泵', '电机', 'fault 红色高亮', '泵体异常抖动'],
    livery: 0xdc2626,
    livery2: 0x111827,
    proto: 'pump',
    protoLabel: '离心泵组',
    build: buildEq112,
  },
  'eq-113': {
    id: 'eq-113',
    code: 'EQ-2024-COMP-13',
    signature: '螺杆主机 + 圆筒油分离器 + 冷凝器 + 管路',
    features: ['螺杆主机', '圆筒油分离器', '冷凝器', '管路'],
    livery: 0x0891b2,
    proto: 'compressor',
    protoLabel: '压缩机组',
    build: buildEq113,
  },
  'eq-114': {
    id: 'eq-114',
    code: 'EQ-2024-MOTOR-14',
    signature: '变频电机 + 独立冷却风扇罩；待机灰色静止',
    features: ['变频电机', '独立冷却风扇罩', 'standby 灰色静止'],
    livery: 0x94a3b8,
    proto: 'motor',
    protoLabel: '大型电机',
    build: buildEq114,
  },
  'eq-115': {
    id: 'eq-115',
    code: 'EQ-2024-ROBOT-15',
    signature: '白色大臂 + 平行四边形连杆 + 末端吸盘抓手（与 10# 明显不同）',
    features: ['白色大臂', '平行四边形连杆', '末端吸盘抓手(与 10# 明显不同)'],
    livery: 0xf1f5f9,
    livery2: 0x1e293b,
    proto: 'robot',
    protoLabel: '工业机器人',
    build: buildEq115,
  },
  'eq-116': {
    id: 'eq-116',
    code: 'EQ-2024-HEX-16',
    signature: '竖直热管束阵列 + 箱体 + 风道',
    features: ['竖直热管束阵列', '箱体', '风道'],
    livery: 0xb45309,
    proto: 'exchanger',
    protoLabel: '换热容器',
    build: buildEq116,
  },
};

export const RECIPE_IDS = Object.keys(DEVICE_RECIPES);

/** 按设备 id 取配方；未知设备返回 null（由调用方回退到原型建造器）。 */
export function recipeFor(device: { id?: string }): DeviceRecipe | null {
  const id = device?.id;
  if (!id) return null;
  return DEVICE_RECIPES[id] ?? null;
}
