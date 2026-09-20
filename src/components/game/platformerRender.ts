/**
 * 《检修大师》2D 横版闯关 —— canvas 2D 渲染层（**纯程序化美术，零新增素材**）。
 *
 * 风格口径：**角色与场景是 2D 卡通，但配色沿用工业科技蓝**（深蓝底 + 青色发光描边），
 * 与数字孪生大屏一致 —— 不是糖果色卡通，也不是 3D 场景。
 *
 * 所有坐标都按虚拟分辨率 960×540 画，缩放交给 canvas 的 `setTransform`（见 MasterGameView），
 * 因此这里不需要知道真实画布多大。
 */
import {
  PLAYER,
  VIEW_H,
  VIEW_W,
  type Camera,
  type Platform,
  type PlayerState,
  type WorldLayout,
} from './platformerEngine';
import type { LevelKind } from './masterLevels';

/** 设备在画面上的状态（与 3D 版口径一致：已通关绿 / 可挑战黄 / 未解锁红） */
export type DeviceVisualState = 'cleared' | 'current' | 'locked';

export interface DeviceVisual {
  equipmentId: string;
  name: string;
  x: number;
  state: DeviceVisualState;
  alarming: boolean;
  /** 是否是"当前可交互目标"（画脉冲圈 + 提示） */
  active: boolean;
  /** 已通关则显示评级 */
  grade: string | null;
}

export interface PartVisual {
  key: string;
  label: string;
  /** 相对设备中心的偏移（虚拟像素） */
  dx: number;
  dy: number;
  /** 已点开（读数已揭示） */
  revealed: boolean;
  /** 是否是本次要找的根因（仅在揭示后才有意义） */
  culprit: boolean;
}

export interface SceneState {
  world: WorldLayout;
  player: PlayerState;
  camera: Camera;
  devices: DeviceVisual[];
  kind: LevelKind;
  /** 秒，用于所有周期性动画（警灯、脉冲圈、箭头） */
  now: number;
  /** 教学关箭头指向的世界 x；null = 不画 */
  arrowTo: number | null;
  /** 解谜关：围绕当前设备的部位热点 */
  parts: PartVisual[];
  /** 鼠标悬停的部位 key（画高亮） */
  hoverPart: string | null;
  /** 设备被点开检修后，隐藏"点击检修"提示 */
  deviceOpen: boolean;
  /** 结算/暂停时冻结画面（只停动画，不改变构图） */
  paused: boolean;
}

/* ============================ 调色板 ============================ */

const C = {
  skyTop: '#0a1a30',
  skyBottom: '#17395c',
  farWall: '#12314b',
  farPanel: '#1d4763',
  pipe: '#225c80',
  pipeGlow: '#48a6cc',
  floor: '#16293d',
  floorTop: '#1f4058',
  floorEdge: '#3fe0f0',
  plat: '#21506e',
  platEdge: '#5eead4',
  beam: '#102639',
  machine: '#1b3d57',
  machineDark: '#132c41',
  hazard: '#e0a12a',
  cleared: '#34d399',
  current: '#fbbf24',
  locked: '#f87171',
  ink: '#0b1220',
  suit: '#2563eb',
  suitDark: '#1d4ed8',
  skin: '#f0c19a',
  helmet: '#facc15',
  helmetDark: '#eab308',
  boot: '#1f2937',
  white: '#e6f4ff',
} as const;

/** 设备状态 → 主色 */
export function stateColor(s: DeviceVisualState): string {
  return s === 'cleared' ? C.cleared : s === 'current' ? C.current : C.locked;
}

/* ============================ 入口 ============================ */

export function renderScene(ctx: CanvasRenderingContext2D, s: SceneState): void {
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  drawSky(ctx, s);
  drawParallax(ctx, s);
  drawMidMachines(ctx, s);
  drawFloor(ctx, s);
  for (const p of s.world.platforms) drawPlatform(ctx, p, s);
  for (const d of s.devices) drawDevice(ctx, d, s);
  drawParts(ctx, s);
  drawPlayer(ctx, s);
  drawOverlay(ctx, s);
}

/* ============================ 背景 ============================ */

function drawSky(ctx: CanvasRenderingContext2D, s: SceneState): void {
  const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, C.skyTop);
  g.addColorStop(0.62, C.skyBottom);
  g.addColorStop(1, C.skyTop);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // 地平线附近的一层暖光：让"车间深处有灯"的感觉出来，而不是一片死黑
  const gy = s.world.groundY;
  const halo = ctx.createRadialGradient(VIEW_W / 2, gy - 40, 20, VIEW_W / 2, gy - 40, 620);
  halo.addColorStop(0, 'rgba(72,166,204,0.22)');
  halo.addColorStop(1, 'transparent');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

/** 视差背景：远处的厂房墙面、窗格、管道、储罐与行车。按 camera.x 的 0.25 倍平移 */
function drawParallax(ctx: CanvasRenderingContext2D, s: SceneState): void {
  const off = -s.camera.x * 0.25;
  ctx.save();
  ctx.translate(off, 0);

  // 远处厂房墙面
  ctx.fillStyle = C.farWall;
  ctx.fillRect(-200, 110, 3600, 280);
  // 墙面顶部的桁架暗带
  ctx.fillStyle = C.beam;
  ctx.fillRect(-200, 110, 3600, 14);

  // 窗格（发光小方块）：高处的采光窗，白天也亮着
  for (let i = 0; i < 120; i++) {
    const x = -180 + i * 62;
    const y = 146 + ((i * 37) % 3) * 54;
    ctx.fillStyle = 'rgba(72,166,204,0.22)';
    ctx.fillRect(x, y, 36, 28);
    ctx.fillStyle = 'rgba(186,240,255,0.16)';
    ctx.fillRect(x + 3, y + 3, 30, 10);
  }

  // 墙面分隔柱（有亮面，才有体积感）
  for (let i = 0; i < 40; i++) {
    const x = -200 + i * 200;
    ctx.fillStyle = C.farPanel;
    ctx.fillRect(x, 110, 14, 280);
    ctx.fillStyle = 'rgba(94,234,212,0.10)';
    ctx.fillRect(x, 110, 3, 280);
  }

  // 横向主管道 + 高光
  ctx.strokeStyle = C.pipe;
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.moveTo(-200, 210);
  ctx.lineTo(3400, 210);
  ctx.stroke();
  ctx.strokeStyle = C.pipeGlow;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-200, 203);
  ctx.lineTo(3400, 203);
  ctx.stroke();

  // 立式储罐
  for (let i = 0; i < 16; i++) {
    const x = 100 + i * 210;
    ctx.fillStyle = C.pipe;
    ctx.beginPath();
    ctx.ellipse(x, 300, 36, 48, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(72,166,204,0.35)';
    ctx.beginPath();
    ctx.ellipse(x - 10, 292, 12, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(94,234,212,0.30)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, 300, 36, 48, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 吊车轨道 + 行车小车
  ctx.fillStyle = C.beam;
  ctx.fillRect(-200, 88, 3600, 14);
  ctx.fillStyle = C.farPanel;
  for (let i = 0; i < 24; i++) {
    const x = i * 260;
    ctx.fillRect(x, 84, 46, 22);
    ctx.fillRect(x + 18, 100, 8, 26);
  }

  ctx.restore();
}

/**
 * 中景设备层：贴着地平线摆一排"别的机组"（柜体 + 指示灯 + 管道弯头）。
 * 视差 0.55，比背景快、比前景慢；整体压暗，只负责把车间的纵深填出来，
 * 不与真正可挑战的设备（亮度更高、有铭牌与状态色）抢注意力。
 */
function drawMidMachines(ctx: CanvasRenderingContext2D, s: SceneState): void {
  const off = -s.camera.x * 0.55;
  const gy = s.world.groundY;
  ctx.save();
  ctx.translate(off, 0);
  ctx.globalAlpha = 0.85;

  for (let i = 0; i < 26; i++) {
    const x = -120 + i * 190;
    const h = 54 + ((i * 53) % 4) * 14;
    const w = 74 + ((i * 29) % 3) * 16;
    const top = gy - h;

    // 机组柜体
    ctx.fillStyle = C.machineDark;
    ctx.fillRect(x, top, w, h);
    ctx.fillStyle = C.machine;
    ctx.fillRect(x + 3, top + 3, w - 6, h - 6);
    // 顶部散热格栅
    ctx.fillStyle = 'rgba(11,18,32,0.55)';
    for (let k = 0; k < 3; k++) ctx.fillRect(x + 8, top + 8 + k * 6, w - 16, 3);
    // 侧面管道弯头
    ctx.strokeStyle = C.pipe;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(x + w - 12, top + 10);
    ctx.lineTo(x + w + 16, top + 10);
    ctx.lineTo(x + w + 16, gy - 8);
    ctx.stroke();
    // 运行指示灯（绿灯呼吸 + 偶尔一个黄灯）
    const on = 0.45 + 0.35 * Math.sin(s.now * 2.2 + i);
    ctx.fillStyle = i % 5 === 3 ? `rgba(251,191,36,${on})` : `rgba(52,211,153,${on})`;
    ctx.beginPath();
    ctx.arc(x + 14, top + h - 14, 3.6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawFloor(ctx: CanvasRenderingContext2D, s: SceneState): void {
  const gy = s.world.groundY;
  const h = VIEW_H - gy;

  // 地坪本体 + 近处渐暗（有纵深）
  const g = ctx.createLinearGradient(0, gy, 0, VIEW_H);
  g.addColorStop(0, C.floorTop);
  g.addColorStop(0.35, C.floor);
  g.addColorStop(1, '#0d1b2b');
  ctx.fillStyle = g;
  ctx.fillRect(0, gy, VIEW_W, h);

  // 发光地平线
  ctx.strokeStyle = C.floorEdge;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(0, gy);
  ctx.lineTo(VIEW_W, gy);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // 地砖缝（跟着镜头走，产生移动感）
  ctx.strokeStyle = 'rgba(63,224,240,0.16)';
  ctx.lineWidth = 1;
  const step = 80;
  const start = Math.floor((s.camera.x - VIEW_W / 2) / step) * step;
  for (let x = start; x < start + VIEW_W + step; x += step) {
    const sx = x - s.camera.x + VIEW_W / 2;
    ctx.beginPath();
    ctx.moveTo(sx, gy);
    ctx.lineTo(sx - 34, VIEW_H);
    ctx.stroke();
  }

  // 黄黑警示带：贴着地平线，一眼就认出是车间地面
  const bandH = 6;
  const stripe = 22;
  const bandStart = Math.floor((s.camera.x - VIEW_W / 2) / stripe) * stripe;
  for (let x = bandStart; x < bandStart + VIEW_W + stripe; x += stripe) {
    const sx = x - s.camera.x + VIEW_W / 2;
    const k = Math.round((x - bandStart) / stripe) % 2;
    ctx.fillStyle = k === 0 ? 'rgba(224,161,42,0.55)' : 'rgba(11,18,32,0.55)';
    ctx.fillRect(sx, gy + 2, stripe, bandH);
  }
}

function drawPlatform(ctx: CanvasRenderingContext2D, p: Platform, s: SceneState): void {
  const x = p.x - s.camera.x + VIEW_W / 2;
  if (x + p.w < -40 || x > VIEW_W + 40) return;

  // 支腿（带斜撑，像真的检修平台）
  ctx.fillStyle = C.beam;
  const legH = s.world.groundY - p.y - p.h;
  ctx.fillRect(x + 10, p.y + p.h, 9, legH);
  ctx.fillRect(x + p.w - 19, p.y + p.h, 9, legH);
  ctx.strokeStyle = 'rgba(34,92,128,0.85)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x + 14, p.y + p.h + 6);
  ctx.lineTo(x + p.w - 14, p.y + p.h + Math.min(legH - 6, 54));
  ctx.moveTo(x + p.w - 14, p.y + p.h + 6);
  ctx.lineTo(x + 14, p.y + p.h + Math.min(legH - 6, 54));
  ctx.stroke();

  // 桥面（上亮下暗，有厚度）
  ctx.fillStyle = C.plat;
  ctx.fillRect(x, p.y, p.w, p.h);
  ctx.fillStyle = 'rgba(94,234,212,0.18)';
  ctx.fillRect(x, p.y, p.w, 4);
  ctx.fillStyle = 'rgba(8,16,28,0.5)';
  ctx.fillRect(x, p.y + p.h - 4, p.w, 4);

  // 桥面高光边
  ctx.strokeStyle = C.platEdge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, p.y + 1);
  ctx.lineTo(x + p.w, p.y + 1);
  ctx.stroke();

  // 护栏（双横杆 + 立杆）
  ctx.strokeStyle = 'rgba(94,234,212,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 4, p.y - 22);
  ctx.lineTo(x + p.w - 4, p.y - 22);
  ctx.moveTo(x + 4, p.y - 11);
  ctx.lineTo(x + p.w - 4, p.y - 11);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= 4; i++) {
    const lx = x + 4 + ((p.w - 8) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(lx, p.y - 22);
    ctx.lineTo(lx, p.y);
    ctx.stroke();
  }
}

/* ============================ 设备 ============================ */

function drawDevice(ctx: CanvasRenderingContext2D, d: DeviceVisual, s: SceneState): void {
  const sx = d.x - s.camera.x + VIEW_W / 2;
  if (sx < -160 || sx > VIEW_W + 160) return;
  const gy = s.world.groundY;
  const col = stateColor(d.state);
  const w = 104;
  const h = 120;
  const x = sx - w / 2;
  const y = gy - h;

  // 接地光晕
  const glow = ctx.createRadialGradient(sx, gy, 4, sx, gy, 92);
  glow.addColorStop(0, `${col}55`);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(sx, gy, 92, 22, 0, 0, Math.PI * 2);
  ctx.fill();

  // 机身
  ctx.fillStyle = '#152a3f';
  ctx.strokeStyle = col;
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.stroke();

  // 顶部管道与表盘
  ctx.fillStyle = '#1d3b55';
  roundRect(ctx, sx - 16, y - 26, 32, 26, 4);
  ctx.fill();
  ctx.stroke();

  // 表盘（指针随报警摆动）
  const dialR = 15;
  ctx.beginPath();
  ctx.arc(sx, y + 34, dialR, 0, Math.PI * 2);
  ctx.fillStyle = '#0b1a29';
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const needle = d.alarming ? -0.7 + Math.sin(s.now * 6) * 0.35 : -0.35;
  ctx.beginPath();
  ctx.moveTo(sx, y + 34);
  ctx.lineTo(sx + Math.sin(needle) * (dialR - 3), y + 34 - Math.cos(needle) * (dialR - 3));
  ctx.strokeStyle = col;
  ctx.lineWidth = 2;
  ctx.stroke();

  // 散热栅格
  ctx.strokeStyle = 'rgba(148,163,184,0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(x + 14, y + 64 + i * 11);
    ctx.lineTo(x + w - 14, y + 64 + i * 11);
    ctx.stroke();
  }

  // 警灯
  if (d.alarming) {
    const on = Math.sin(s.now * 7) > 0;
    ctx.fillStyle = on ? '#ef4444' : '#7f1d1d';
    ctx.beginPath();
    ctx.arc(sx, y - 34, 7, 0, Math.PI * 2);
    ctx.fill();
    if (on) {
      const r = ctx.createRadialGradient(sx, y - 34, 2, sx, y - 34, 46);
      r.addColorStop(0, 'rgba(239,68,68,0.5)');
      r.addColorStop(1, 'transparent');
      ctx.fillStyle = r;
      ctx.beginPath();
      ctx.arc(sx, y - 34, 46, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 名称牌
  const label = d.name.length > 12 ? `${d.name.slice(0, 12)}…` : d.name;
  ctx.font = '13px "Microsoft YaHei", system-ui, sans-serif';
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(8,18,32,0.82)';
  roundRect(ctx, sx - tw / 2 - 8, y - 66, tw + 16, 22, 5);
  ctx.fill();
  ctx.strokeStyle = `${col}66`;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = C.white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, sx, y - 54);

  // 状态徽标 / 通关评级
  const badge = d.grade ?? (d.state === 'cleared' ? '✓' : d.state === 'locked' ? '锁' : '!');
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(sx + w / 2 + 12, y - 6, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.ink;
  ctx.font = 'bold 12px "Microsoft YaHei", system-ui, sans-serif';
  ctx.fillText(badge, sx + w / 2 + 12, y - 5);

  // 可交互脉冲圈
  if (d.active && !s.deviceOpen) {
    const pulse = (s.now * 1.6) % 1;
    ctx.strokeStyle = col;
    ctx.globalAlpha = 1 - pulse;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(sx, gy - 2, 40 + pulse * 66, 12 + pulse * 20, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // 提示气泡
    ctx.font = 'bold 14px "Microsoft YaHei", system-ui, sans-serif';
    const tip = '点击检修';
    const bw = ctx.measureText(tip).width + 22;
    ctx.fillStyle = 'rgba(8,18,32,0.92)';
    roundRect(ctx, sx - bw / 2, y - 104, bw, 26, 6);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.fillText(tip, sx, y - 90);
  }
}

/* ============================ 部位热点（解谜关） ============================ */

function drawParts(ctx: CanvasRenderingContext2D, s: SceneState): void {
  if (!s.parts.length) return;
  const d = s.devices.find((v) => v.active) ?? s.devices[0];
  if (!d) return;
  const sx = d.x - s.camera.x + VIEW_W / 2;
  const y = s.world.groundY - 120;
  for (const p of s.parts) {
    const px = sx + p.dx;
    const py = y + p.dy;
    const hovered = s.hoverPart === p.key;
    const col = p.revealed ? (p.culprit ? C.locked : C.cleared) : C.current;
    ctx.beginPath();
    ctx.arc(px, py, hovered ? 10 : 7, 0, Math.PI * 2);
    ctx.fillStyle = p.revealed ? col : 'rgba(251,191,36,0.25)';
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = hovered ? 3 : 2;
    ctx.stroke();
    if (hovered || p.revealed) {
      ctx.font = '12px "Microsoft YaHei", system-ui, sans-serif';
      const tw = ctx.measureText(p.label).width;
      ctx.fillStyle = 'rgba(8,18,32,0.9)';
      roundRect(ctx, px - tw / 2 - 7, py - 34, tw + 14, 20, 5);
      ctx.fill();
      ctx.strokeStyle = `${col}88`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.label, px, py - 24);
    }
  }
}

/* ============================ 角色 ============================ */

/** 两段式肢体：髋/肩 → 关节 → 末端。角度从"竖直向下"起算，正方向 = 画面右侧 */
function limb(
  ctx: CanvasRenderingContext2D,
  hx: number,
  hy: number,
  l1: number,
  l2: number,
  a1: number,
  a2: number,
  w: number,
  color: string
): { x: number; y: number } {
  const kx = hx + Math.sin(a1) * l1;
  const ky = hy + Math.cos(a1) * l1;
  const ex = kx + Math.sin(a1 + a2) * l2;
  const ey = ky + Math.cos(a1 + a2) * l2;
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(kx, ky);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  return { x: ex, y: ey };
}

/**
 * 2D 卡通工程师：安全帽 + 工装 + 工具包。
 * 跑步是**程序化**的（两段式大腿/小腿 + 反相摆臂），相位来自 `player.animT`；
 * 滞空时换成"收腿 + 举手"的跳跃姿势。
 */
function drawPlayer(ctx: CanvasRenderingContext2D, s: SceneState): void {
  const p = s.player;
  const sx = p.x - s.camera.x + VIEW_W / 2;
  const sy = p.y; // 脚底
  const f = p.facing;

  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(f, 1); // 朝向：整体镜像，省掉每个零件算两遍

  // 影子
  ctx.save();
  ctx.scale(f, 1); // 抵消镜像，影子本身是椭圆无所谓
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 20, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const air = !p.onGround;
  const phase = p.animT * 9;
  const swing = air ? 0 : Math.sin(phase);

  const hipY = -28;
  const shoulderY = -50;

  // ---- 后腿 / 后臂（先画，产生前后层次）
  const backLeg = air ? { a1: -0.5, a2: 0.9 } : { a1: -swing * 0.85, a2: 0.35 + 0.55 * Math.max(0, -swing) };
  limb(ctx, -3, hipY, 15, 15, backLeg.a1, backLeg.a2, 9, C.suitDark);
  const backArm = air ? { a1: -2.2, a2: -0.4 } : { a1: swing * 0.8, a2: 0.45 };
  limb(ctx, -2, shoulderY, 12, 12, backArm.a1, backArm.a2, 7, C.suitDark);

  // ---- 躯干
  ctx.fillStyle = C.suit;
  roundRect(ctx, -11, shoulderY - 4, 22, hipY - shoulderY + 12, 7);
  ctx.fill();
  // 反光条
  ctx.fillStyle = 'rgba(226,244,255,0.75)';
  ctx.fillRect(-11, shoulderY + 12, 22, 3);
  ctx.fillRect(-11, shoulderY + 19, 22, 2);

  // 工具包（背在身后）
  ctx.fillStyle = '#78350f';
  roundRect(ctx, -17, shoulderY + 2, 8, 16, 3);
  ctx.fill();

  // ---- 前腿 / 前臂
  const frontLeg = air ? { a1: 0.7, a2: 0.75 } : { a1: swing * 0.85, a2: 0.35 + 0.55 * Math.max(0, swing) };
  const foot = limb(ctx, 3, hipY, 15, 15, frontLeg.a1, frontLeg.a2, 9, C.suit);
  const hand = limb(ctx, 2, shoulderY, 12, 12, air ? 2.4 : -swing * 0.8, air ? 0.5 : 0.45, 7, C.suit);

  // 工靴
  ctx.fillStyle = C.boot;
  ctx.beginPath();
  ctx.ellipse(foot.x, foot.y + 2, 8, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // 手（握扳手）
  ctx.fillStyle = C.skin;
  ctx.beginPath();
  ctx.arc(hand.x, hand.y, 4, 0, Math.PI * 2);
  ctx.fill();
  if (!air) {
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(hand.x, hand.y);
    ctx.lineTo(hand.x + 9, hand.y - 5);
    ctx.stroke();
  }

  // ---- 头（侧脸）+ 安全帽
  const headY = shoulderY - 14;
  ctx.fillStyle = C.skin;
  ctx.beginPath();
  ctx.arc(1, headY, 9.5, 0, Math.PI * 2);
  ctx.fill();
  // 鼻梁（侧脸轮廓）
  ctx.beginPath();
  ctx.moveTo(9, headY - 1);
  ctx.lineTo(13, headY + 3);
  ctx.lineTo(9, headY + 5);
  ctx.closePath();
  ctx.fill();
  // 眼睛
  ctx.fillStyle = C.ink;
  ctx.beginPath();
  ctx.arc(6, headY - 1, 1.6, 0, Math.PI * 2);
  ctx.fill();
  // 安全帽
  ctx.fillStyle = C.helmet;
  ctx.beginPath();
  ctx.arc(1, headY - 3, 10.5, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.helmetDark;
  ctx.fillRect(1, headY - 5, 16, 3.5); // 帽檐
  ctx.fillStyle = C.helmet;
  ctx.beginPath();
  ctx.arc(1, headY - 5, 10.5, Math.PI, Math.PI * 2);
  ctx.fill();
  // 帽顶加强筋
  ctx.strokeStyle = C.helmetDark;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(1, headY - 14);
  ctx.lineTo(1, headY - 6);
  ctx.stroke();

  ctx.restore();

  // 跳跃尾迹（滞空时给一点速度感）
  if (air && p.vy < -120) {
    ctx.strokeStyle = 'rgba(34,211,238,0.5)';
    ctx.lineWidth = 2;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(sx - 10, sy - 6 - i * 9);
      ctx.lineTo(sx - 10 + 12, sy - 6 - i * 9);
      ctx.stroke();
    }
  }
}

/* ============================ 覆盖层（箭头 / 提示） ============================ */

function drawOverlay(ctx: CanvasRenderingContext2D, s: SceneState): void {
  // 教学关箭头：指向前方目标，浮动 + 呼吸
  if (s.arrowTo !== null) {
    const dx = s.arrowTo - s.player.x;
    if (Math.abs(dx) > 110) {
      const dir = dx > 0 ? 1 : -1;
      const baseX = dir > 0 ? VIEW_W - 118 : 118;
      const bob = Math.sin(s.now * 3) * 7;
      ctx.save();
      ctx.translate(baseX + dir * bob, 118);
      ctx.fillStyle = C.current;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(dir * 26, 0);
      ctx.lineTo(-dir * 14, -20);
      ctx.lineTo(-dir * 14, 20);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
      ctx.font = 'bold 14px "Microsoft YaHei", system-ui, sans-serif';
      ctx.fillStyle = C.current;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(dir > 0 ? '目标在右边 →' : '← 目标在左边', baseX, 156);
    }
  }

  // 暂停 / 结算时压一层暗幕，突出 DOM 面板
  if (s.paused) {
    ctx.fillStyle = 'rgba(4,10,20,0.62)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}

/* ============================ 工具 ============================ */

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** 供命中测试用：设备在屏幕上的可点矩形（比机身略大，好点） */
export function deviceHitBox(d: DeviceVisual, cam: Camera, groundY: number): { x0: number; y0: number; x1: number; y1: number } {
  const sx = d.x - cam.x + VIEW_W / 2;
  return { x0: sx - 62, y0: groundY - 160, x1: sx + 62, y1: groundY + 4 };
}

/** 部位热点的屏幕坐标（命中测试与绘制共用，避免"看到的位置和点到的不一致"） */
export function partScreenPos(d: DeviceVisual, p: PartVisual, cam: Camera, groundY: number): { x: number; y: number } {
  const sx = d.x - cam.x + VIEW_W / 2;
  return { x: sx + p.dx, y: groundY - 120 + p.dy };
}

/** 角色在屏幕上的位置（HUD 用不到，但验收探针要用它判断"人跑到哪了"） */
export function playerScreenPos(p: PlayerState, cam: Camera): { x: number; y: number } {
  return { x: p.x - cam.x + VIEW_W / 2, y: p.y };
}

export const PLAYER_BOX = { w: PLAYER.W, h: PLAYER.H };
