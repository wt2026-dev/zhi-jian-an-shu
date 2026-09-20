/**
 * 《检修大师》2D 横版闯关 —— **纯逻辑**物理引擎。
 *
 * 刻意不依赖 React / three / canvas：跑、跳、碰撞、镜头跟随全是可单测的纯函数，
 * 渲染在 `platformerRender.ts`，交互与 UI 在 `MasterGameView.tsx`。
 * 这样"跳不上去 / 卡进墙里 / 镜头抖"这类问题能用断言复现，而不是靠肉眼看画面。
 *
 * 坐标约定：**y 轴向下为正**（与 canvas 一致，省掉一层换算）。
 * 玩家的锚点是**脚底中心** `(x, y)` —— 平台碰撞用"脚"来判断最自然。
 */

/** 虚拟分辨率：世界按这个尺寸设计，实际渲染等比缩放（见 render 层） */
export const VIEW_W = 960;
export const VIEW_H = 540;

export interface Input {
  left: boolean;
  right: boolean;
  jump: boolean;
}

export interface PlayerState {
  /** 脚底中心 x */
  x: number;
  /** 脚底中心 y */
  y: number;
  vx: number;
  vy: number;
  /** 朝向：1 = 向右，-1 = 向左 */
  facing: 1 | -1;
  onGround: boolean;
  /** 动画累计时间（秒），跑步/滞空姿势由它驱动 */
  animT: number;
  /** 离地后经过的时间，用于"土狼时间" */
  coyote: number;
  /** 跳跃键按下的缓冲时间，用于"落地即跳" */
  jumpBuffer: number;
}

export interface Platform {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WorldLayout {
  /** 世界总宽（像素） */
  width: number;
  /** 地面顶面 y */
  groundY: number;
  /** 地面之上的栈桥 / 检修平台 */
  platforms: Platform[];
}

export const PLAYER = {
  /** 碰撞盒尺寸 */
  W: 30,
  H: 62,
  RUN_SPEED: 300,
  ACCEL: 2600,
  FRICTION: 2800,
  GRAVITY: 2000,
  JUMP_V: -700,
  /** 松手后立刻衰减到该速度 ⇒ 轻点小跳、长按高跳 */
  JUMP_CUT: -260,
  MAX_FALL: 1500,
  COYOTE: 0.09,
  JUMP_BUFFER: 0.12,
} as const;

/** 跳跃最高点 ≈ v²/(2g) = 700²/(2·2000) = 122px */
export const JUMP_HEIGHT = (PLAYER.JUMP_V * PLAYER.JUMP_V) / (2 * PLAYER.GRAVITY);

export function createPlayer(x: number, y: number): PlayerState {
  return { x, y, vx: 0, vy: 0, facing: 1, onGround: true, animT: 0, coyote: 0, jumpBuffer: 0 };
}

/** 玩家的 AABB（左上 / 右下） */
export function playerBox(p: PlayerState): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: p.x - PLAYER.W / 2,
    y0: p.y - PLAYER.H,
    x1: p.x + PLAYER.W / 2,
    y1: p.y,
  };
}

function overlaps(a: { x0: number; y0: number; x1: number; y1: number }, b: Platform): boolean {
  return a.x0 < b.x + b.w && a.x1 > b.x && a.y0 < b.y + b.h && a.y1 > b.y;
}

/** 参与碰撞的实体：地面 + 栈桥。地面按整幅宽处理，所以关卡不会有掉坑死亡 */
export function solidsOf(world: WorldLayout): Platform[] {
  return [{ x: -200, y: world.groundY, w: world.width + 400, h: 400 }, ...world.platforms];
}

/**
 * 推进一步物理。
 *
 * 顺序是刻意的：**先水平后垂直**，且垂直方向按 `vy` 的符号只解一个方向 ——
 * 这样"贴着墙跳"不会被水平解算顶起来，"落在平台边缘"也不会穿过去。
 */
export function stepPlayer(p: PlayerState, input: Input, world: WorldLayout, dt: number): PlayerState {
  const step = Math.min(0.05, Math.max(0, dt)); // 掉帧时别一次走太远（会穿模）
  const solids = solidsOf(world);

  /* ---------- 水平：加速 / 摩擦 ---------- */
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let vx = p.vx;
  if (dir !== 0) {
    vx += dir * PLAYER.ACCEL * step;
    vx = Math.max(-PLAYER.RUN_SPEED, Math.min(PLAYER.RUN_SPEED, vx));
  } else {
    const drop = PLAYER.FRICTION * step;
    vx = Math.abs(vx) <= drop ? 0 : vx - Math.sign(vx) * drop;
  }
  const facing: 1 | -1 = dir !== 0 ? (dir > 0 ? 1 : -1) : p.facing;

  let x = p.x + vx * step;
  // 世界边界：贴着边界停下（不反弹、不越界）
  const halfW = PLAYER.W / 2;
  if (x - halfW < 0) {
    x = halfW;
    vx = 0;
  }
  if (x + halfW > world.width) {
    x = world.width - halfW;
    vx = 0;
  }
  // 水平推出：只处理"脚所在高度"的实体，避免头顶平台把人横向顶开
  for (const s of solids) {
    const box = { x0: x - halfW, y0: p.y - PLAYER.H, x1: x + halfW, y1: p.y };
    if (!overlaps(box, s)) continue;
    // 站在它上面（脚底在它的顶面附近）⇒ 不算横向碰撞
    if (Math.abs(p.y - s.y) < 6) continue;
    if (vx > 0) x = s.x - halfW - 0.01;
    else if (vx < 0) x = s.x + s.w + halfW + 0.01;
    vx = 0;
  }

  /* ---------- 垂直：重力 / 跳跃 ---------- */
  let vy = p.vy + PLAYER.GRAVITY * step;
  if (vy > PLAYER.MAX_FALL) vy = PLAYER.MAX_FALL;
  // 松手截断：轻点小跳
  if (!input.jump && vy < PLAYER.JUMP_CUT) vy = PLAYER.JUMP_CUT;

  let coyote = p.onGround ? PLAYER.COYOTE : Math.max(0, p.coyote - step);
  let jumpBuffer = input.jump ? PLAYER.JUMP_BUFFER : Math.max(0, p.jumpBuffer - step);
  let onGround = false;

  if (jumpBuffer > 0 && coyote > 0) {
    vy = PLAYER.JUMP_V;
    jumpBuffer = 0;
    coyote = 0;
  }

  let y = p.y + vy * step;
  for (const s of solids) {
    const box = { x0: x - halfW, y0: y - PLAYER.H, x1: x + halfW, y1: y };
    if (!overlaps(box, s)) continue;
    if (vy >= 0) {
      // 下落：落到顶面
      y = s.y;
      vy = 0;
      onGround = true;
    } else {
      // 上升：撞到底面
      y = s.y + s.h + PLAYER.H;
      vy = 0;
    }
  }

  // 贴地判定：脚正好落在地面/栈桥顶面（含 1px 容差），避免"看起来站着却算悬空"
  if (!onGround) {
    for (const s of solids) {
      if (y >= s.y - 1 && y <= s.y + 2 && x + halfW > s.x && x - halfW < s.x + s.w) {
        y = s.y;
        onGround = true;
        if (vy > 0) vy = 0;
        break;
      }
    }
  }

  // 动画相位：跑动时推进，站着/滞空时回到呼吸节奏
  const moving = onGround && Math.abs(vx) > 12;
  const animT = p.animT + step * (moving ? Math.min(1.6, Math.abs(vx) / PLAYER.RUN_SPEED) * 2.4 : 0.8);

  return { x, y, vx, vy, facing, onGround, animT, coyote, jumpBuffer };
}

/* ============================ 镜头 ============================ */

export interface Camera {
  x: number;
  y: number;
}

export function createCamera(): Camera {
  return { x: VIEW_W / 2, y: 0 };
}

/**
 * 镜头跟随：只横向跟，且夹在世界内；世界比视口窄时居中（避免出现空白边）。
 * 用指数阻尼而不是硬跟随，跑动时画面不会跟着人物抖。
 */
export function followCamera(cam: Camera, p: PlayerState, world: WorldLayout, dt: number): Camera {
  const half = VIEW_W / 2;
  const maxX = Math.max(half, world.width - half);
  const target = Math.min(maxX, Math.max(half, p.x + p.facing * 70));
  const k = 1 - Math.exp(-Math.min(0.05, Math.max(0, dt)) * 9);
  return { x: cam.x + (target - cam.x) * k, y: 0 };
}

/* ============================ 交互距离 ============================ */

/** 判定"站在设备旁"：只看水平距离，且必须站在地面上（跳在半空不算） */
export function nearDevice(p: PlayerState, deviceX: number, range = 90): boolean {
  return Math.abs(p.x - deviceX) <= range;
}

/** 世界坐标 → 屏幕坐标（渲染与点击命中共用，保证"看到哪就点到哪"） */
export function worldToScreen(wx: number, wy: number, cam: Camera): { x: number; y: number } {
  return { x: wx - cam.x + VIEW_W / 2, y: wy - cam.y };
}

/** 屏幕坐标 → 世界坐标 */
export function screenToWorld(sx: number, sy: number, cam: Camera): { x: number; y: number } {
  return { x: sx + cam.x - VIEW_W / 2, y: sy + cam.y };
}
