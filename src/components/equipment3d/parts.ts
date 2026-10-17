/**
 * 零件几何库 —— 设备建模的「词汇表」。
 *
 * 为什么单独抽出这一层：
 *   参考生成器（中国程序化城市生成器）里，每座城市是一份「配方」，
 *   但配方只允许使用有限的一组体块词汇（box / roof / podium / spire…），
 *   正因如此不同城市才能共用同一套 InstancedMesh 批渲染。
 *   本项目要做的「16 台设备每台都有自己的特征」面临同样的取舍：
 *   如果每台设备各写一套独立建模代码，16 台就是 16 套几何体，
 *   既无法批量提交，也让「哪些零件是共用的」变得不可知。
 *
 *   因此把「词汇」与「配方」分开：
 *     parts.ts          —— 本文件：几何体构造器 + 着色角色 + 动画规格
 *     deviceProfiles.ts —— 16 份配方：只负责挑选词汇、摆位、配色
 *     equipment.ts      —— 按「零件(几何体 + 着色角色)」跨设备合并为 InstancedMesh
 *
 *   这样 16 台设备彼此不同，但共用的零件（底座、法兰、电机、指示灯…）
 *   仍然只提交一次 drawcall。
 */

import * as THREE from 'three';

/* ========================= 着色角色 ========================= */

/**
 * 零件的着色角色，决定它用哪种材质、以及颜色从哪来。
 *
 * status / glow / livery 三种是 per-instance 颜色：
 *   status —— 由后端真实健康状态决定（正常绿 / 预警黄 / 故障红…）
 *   glow   —— 由状态决定的指示灯发光色
 *   livery —— 由设备配方固定的「专属涂装色」，与状态无关
 *             （这正是「每台设备一眼可辨」的关键：状态会变，涂装不会）
 */
export type TintRole =
  | 'status'
  | 'glow'
  | 'livery'
  | 'livery2'
  | 'steel'
  | 'dark'
  | 'accent'
  | 'copper'
  | 'glass'
  | 'white';

/** 需要 per-instance 颜色的角色。 */
export const PER_INSTANCE_TINTS: ReadonlySet<TintRole> = new Set<TintRole>(['status', 'glow', 'livery', 'livery2']);

/* ========================= 状态动画 ========================= */

/**
 * 零件动画角色 —— 全部由设备真实 status 驱动，不做随机播放。
 *
 *   spin  旋转件（轴 / 风扇 / 联轴器）—— 仅 running 态
 *   blink 指示灯脉动 —— warning 态黄灯闪烁、fault/critical 红灯脉冲
 *   shake 部件抖动 —— 仅 fault / critical 态
 *   slide 往复（活塞 / 滑块）—— running 态
 */
export type AnimKind = 'spin' | 'blink' | 'shake' | 'slide';

export interface AnimSpec {
  kind: AnimKind;
  /** spin / slide 的旋转或位移轴（零件几何体自身坐标系） */
  axis?: 'x' | 'y' | 'z';
  /** spin 角速度 rad/s；slide 往复频率 Hz */
  speed?: number;
  /** shake 振幅（米） */
  amp?: number;
  /** 相位偏移，避免 16 台设备完全同步抖动/闪烁 */
  phase?: number;
}

/* ========================= 配方零件 ========================= */

export interface RecipePart {
  /** 零件名。同名零件在统计与调试时便于定位 */
  key: string;
  geo: THREE.BufferGeometry;
  pos: [number, number, number];
  rot?: [number, number, number];
  tint: TintRole;
  /** 需要的最低细节档（0 最简 / 2 最丰富） */
  detailMin?: number;
  cast?: boolean;
  anim?: AnimSpec;
}

export interface PartInit {
  rot?: [number, number, number];
  detailMin?: number;
  cast?: boolean;
  anim?: AnimSpec;
}

export function makeParts() {
  const parts: RecipePart[] = [];
  const push = (
    key: string,
    geo: THREE.BufferGeometry,
    pos: [number, number, number],
    tint: TintRole,
    init: PartInit = {}
  ) => {
    parts.push({ key, geo, pos, tint, rot: init.rot, detailMin: init.detailMin ?? 0, cast: init.cast ?? true, anim: init.anim });
  };
  return { parts, push };
}

/* ========================= 几何缓存 =========================
 * 与参考实现 buildings.js 同款做法：零件几何体按 key 缓存并打上
 * userData.shared，disposeGroup 会跳过它们 —— 否则第二次重建时会把
 * 复用的几何体释放掉，导致画面变成一片空白。
 */
const GEO_CACHE = new Map<string, THREE.BufferGeometry>();

function cachedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = GEO_CACHE.get(key);
  if (!g) {
    g = make();
    g.userData.shared = true;
    GEO_CACHE.set(key, g);
  }
  return g;
}

export function geoCacheSize(): number {
  return GEO_CACHE.size;
}

export const HALF_PI = Math.PI / 2;

/* ========================= 几何 LOD =========================
 * 由场景构建前 setGeoLod(detail) 注入。流畅档把圆柱/球/环分段数减半，
 * 并让 pushImpeller 少几片叶片 —— 三角面必须随档位明显下降。
 */
let _geoLod = 2;

export function setGeoLod(detail: number): void {
  _geoLod = detail < 0 ? 0 : detail > 2 ? 2 : detail | 0;
}

export function geoLod(): number {
  return _geoLod;
}

/** 按当前档位收缩分段数：流畅约 50%，均衡约 75%，精细保持原值。 */
export function lodSeg(n: number, floor = 6): number {
  const k = _geoLod <= 0 ? 0.5 : _geoLod === 1 ? 0.75 : 1;
  const fl = _geoLod <= 0 ? Math.min(floor, 6) : floor;
  return Math.max(fl, Math.round(n * k));
}

/* ---- 基础体块 ---- */

/** 中心在原点的长方体。 */
export const box = (w: number, h: number, d: number) =>
  cachedGeo(`b:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));

/** 底面在 y=0 的长方体 —— 便于绕关节旋转（机器人手臂 / 立柱）。 */
export const boxY = (w: number, h: number, d: number) =>
  cachedGeo(`by:${w}:${h}:${d}`, () => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    return g;
  });

/** 轴向沿 Y、中心在原点的圆柱（可给上下不同半径，用于锥形封头）。 */
export const cyl = (rt: number, rb: number, h: number, seg = 16) => {
  const s = lodSeg(seg);
  return cachedGeo(`c:${rt}:${rb}:${h}:${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
};

/** 轴向沿 Y、底面在 y=0 的等径圆柱。 */
export const cylY = (r: number, h: number, seg = 12) => {
  const s = lodSeg(seg);
  return cachedGeo(`cy:${r}:${h}:${s}`, () => {
    const g = new THREE.CylinderGeometry(r, r, h, s);
    g.translate(0, h / 2, 0);
    return g;
  });
};

/** 轴向沿 X、中心在原点的圆柱 —— 卧式轴 / 蜗壳 / 机座的主力几何。 */
export const cylX = (r: number, h: number, seg = 16) => {
  const s = lodSeg(seg);
  return cachedGeo(`cx:${r}:${h}:${s}`, () => {
    const g = new THREE.CylinderGeometry(r, r, h, s);
    g.rotateZ(HALF_PI);
    return g;
  });
};

/** 轴向沿 Z、中心在原点的圆柱。 */
export const cylZ = (r: number, h: number, seg = 14) => {
  const s = lodSeg(seg);
  return cachedGeo(`cz:${r}:${h}:${s}`, () => {
    const g = new THREE.CylinderGeometry(r, r, h, s);
    g.rotateX(HALF_PI);
    return g;
  });
};

/** 球。 */
export const sph = (r: number, seg = 14) => {
  const s = lodSeg(seg, 6);
  const hSeg = _geoLod <= 0 ? 4 : Math.max(6, Math.round(s / 2));
  return cachedGeo(`s:${r}:${s}:${hSeg}`, () => new THREE.SphereGeometry(r, s, hSeg));
};

/** 半球封头（罐体 / 换热器），凸面朝 +Y。 */
export const dome = (r: number, seg = 20) => {
  const s = lodSeg(seg, 6);
  const hSeg = _geoLod <= 0 ? 4 : Math.max(5, Math.round(s / 2.5));
  return cachedGeo(`d:${r}:${s}:${hSeg}`, () =>
    new THREE.SphereGeometry(r, s, hSeg, 0, Math.PI * 2, 0, Math.PI / 2)
  );
};

/** 圆锥（刀柄 / 料斗）。 */
export const cone = (r: number, h: number, seg = 12) => {
  const s = lodSeg(seg);
  return cachedGeo(`k:${r}:${h}:${s}`, () => new THREE.ConeGeometry(r, h, s));
};

/** 水平圆环（地面光环）。 */
export const ring = (inner: number, outer: number, seg = 30) => {
  const s = _geoLod <= 0 ? 16 : lodSeg(seg, 12);
  return cachedGeo(`r:${inner}:${outer}:${s}`, () => {
    const g = new THREE.RingGeometry(inner, outer, s);
    g.rotateX(-HALF_PI);
    return g;
  });
};

/**
 * 圆环体 —— 联轴器护罩 / 手轮 / 箍带。
 * 默认轴向为 Z，配方里用 rot 转到需要的方向。
 */
export const torus = (r: number, tube: number, seg = 16, tubeSeg = 8) => {
  const s = lodSeg(seg, 8);
  const ts = _geoLod <= 0 ? 4 : lodSeg(tubeSeg, 5);
  return cachedGeo(`t:${r}:${tube}:${s}:${ts}`, () => new THREE.TorusGeometry(r, tube, ts, s));
};

/** 底部在 y=0 的圆锥（料斗 / 刀库伞盘）。 */
export const coneY = (r: number, h: number, seg = 12) => {
  const s = lodSeg(seg);
  return cachedGeo(`ky:${r}:${h}:${s}`, () => {
    const g = new THREE.ConeGeometry(r, h, s);
    g.translate(0, h / 2, 0);
    return g;
  });
};

/* ========================= 可辨识旋转件 ========================= */

/** makeParts() 返回的 push 函数签名（供下面的旋转件构造器复用）。 */
export type PushFn = (
  key: string,
  geo: THREE.BufferGeometry,
  pos: [number, number, number],
  tint: TintRole,
  init?: PartInit
) => void;

/**
 * 可辨识旋转件：轮毂 + 绕轴均布的叶片。
 *
 * 为什么不能只让一个圆柱自转 —— 这是踩过的坑：
 * 圆柱绕**自身轴**旋转在视觉上是完全对称的。侧表面法线绕轴旋转不变，
 * 着色也就逐像素不变，于是"动画在跑，但肉眼完全看不出来"。
 * 早期实现里所有 spin 零件都是裸 `cylX`，等于 running 态下什么都没有发生。
 *
 * 因此旋转件必须带**非对称特征**（叶片 / 键 / 螺栓），转动才可见：
 * 叶片沿径向伸出，旋转时轮廓与高光同时变化，一眼可辨。
 * 所有叶片共用同一块 box 几何体与同一 tint，批处理后只多 1 个 drawcall。
 */
export function pushImpeller(
  push: PushFn,
  key: string,
  radius: number,
  thickness: number,
  pos: [number, number, number],
  tint: TintRole,
  anim: AnimSpec,
  blades = 6,
  extra: PartInit = {}
): void {
  push(`${key}Hub`, cylX(radius * 0.36, thickness * 1.25, 12), pos, tint, { ...extra, anim });
  const d = radius * 0.5;
  const nBlades = _geoLod <= 0 ? Math.min(3, blades) : blades;
  for (let i = 0; i < nBlades; i++) {
    const a = (i / blades) * Math.PI * 2;
    // 叶片局部 +Z 经 rot=[a,0,0] 旋转后指向径向 (0, -sin a, cos a)，故偏移取同向。
    // 长度 0.8r 居中于 0.5r 处 → 径向覆盖 0.1r~0.9r，与原来整块圆盘的外径基本一致。
    push(
      `${key}Blade${i}`,
      box(thickness * 0.95, radius * 0.24, radius * 0.8),
      [pos[0], pos[1] - Math.sin(a) * d, pos[2] + Math.cos(a) * d],
      tint,
      { ...extra, rot: [a, 0, 0], cast: false, anim }
    );
  }
}

/**
 * 轴 / 联轴器上的可辨识标记（键、凸块、对轮齿）。
 *
 * 轴本身是圆柱，自转不可见；加两个偏心凸块后，"在转"一眼可辨，
 * 也更像真实的联轴器对轮。
 */
export function pushShaftKey(
  push: PushFn,
  key: string,
  radius: number,
  thickness: number,
  pos: [number, number, number],
  tint: TintRole,
  anim: AnimSpec,
  keys = 2,
  extra: PartInit = {}
): void {
  push(`${key}Core`, cylX(radius, thickness, 12), pos, tint, { ...extra, anim });
  for (let i = 0; i < keys; i++) {
    const a = (i / keys) * Math.PI * 2;
    push(
      `${key}Key${i}`,
      box(thickness * 0.85, radius * 0.62, radius * 0.62),
      [pos[0], pos[1] - Math.sin(a) * radius * 0.86, pos[2] + Math.cos(a) * radius * 0.86],
      tint,
      { ...extra, rot: [a, 0, 0], cast: false, anim }
    );
  }
}

/* ========================= 工具函数 ========================= */

/** 三角面计数：索引几何取 index.count，非索引取顶点数，再除以 3。 */
export function geoTriangles(geo: THREE.BufferGeometry): number {
  const n = geo.index ? geo.index.count : geo.attributes.position.count;
  return Math.floor(n / 3);
}

/**
 * 由配方零件表反推包围盒（米，局部坐标系，底面 y=0）。
 *
 * 为什么不用「原型包围盒」：16 台设备各有各的轮廓，
 * 5# 多级泵是细长筒体、9# 龙门是又高又宽的框式结构，
 * 用统一的原型尺寸会让特写取景要么贴太近要么离太远。
 */
export function recipeBounds(parts: RecipePart[]): { w: number; h: number; d: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);

  for (const p of parts) {
    if (!p.geo.boundingBox) p.geo.computeBoundingBox();
    const bb = p.geo.boundingBox;
    if (!bb) continue;
    q.setFromEuler(e.set(p.rot?.[0] ?? 0, p.rot?.[1] ?? 0, p.rot?.[2] ?? 0));
    m.compose(pos.set(p.pos[0], p.pos[1], p.pos[2]), q, one);
    // 变换后的 8 个角点
    for (const sx of [bb.min.x, bb.max.x]) {
      for (const sy of [bb.min.y, bb.max.y]) {
        for (const sz of [bb.min.z, bb.max.z]) {
          v.set(sx, sy, sz).applyMatrix4(m);
          if (v.x < minX) minX = v.x;
          if (v.x > maxX) maxX = v.x;
          if (v.y < minY) minY = v.y;
          if (v.y > maxY) maxY = v.y;
          if (v.z < minZ) minZ = v.z;
          if (v.z > maxZ) maxZ = v.z;
        }
      }
    }
  }
  if (!Number.isFinite(minX)) return { w: 3, h: 2.5, d: 2 };
  return {
    w: Math.max(0.6, maxX - minX),
    h: Math.max(0.6, maxY - Math.min(0, minY)),
    d: Math.max(0.6, maxZ - minZ),
  };
}

/**
 * 工业管道带金属手轮截止阀门组件
 */
export function pushPipeValve(
  push: PushFn,
  key: string,
  pos: [number, number, number],
  axis: 'x' | 'y' | 'z' = 'x',
  valveColor: 'accent' | 'livery' = 'accent',
  size = 0.28
): void {
  const bodyGeo = axis === 'x' ? cylX(size * 1.15, size * 1.4, 10) : axis === 'y' ? cylY(size * 1.15, size * 1.4, 10) : cyl(size * 1.15, size * 1.15, size * 1.4, 10);
  push(`${key}ValveBody`, bodyGeo, pos, 'steel');
  if (axis === 'x') {
    push(`${key}Flange1`, cylX(size * 1.45, 0.08, 12), [pos[0] - size * 0.7, pos[1], pos[2]], 'dark');
    push(`${key}Flange2`, cylX(size * 1.45, 0.08, 12), [pos[0] + size * 0.7, pos[1], pos[2]], 'dark');
  } else if (axis === 'z') {
    push(`${key}Flange1`, cylZ(size * 1.45, 0.08, 12), [pos[0], pos[1], pos[2] - size * 0.7], 'dark');
    push(`${key}Flange2`, cylZ(size * 1.45, 0.08, 12), [pos[0], pos[1], pos[2] + size * 0.7], 'dark');
  }
  push(`${key}Stem`, cylY(size * 0.22, size * 1.3, 8), [pos[0], pos[1] + size * 0.65, pos[2]], 'steel');
  push(`${key}Handwheel`, torus(size * 0.85, size * 0.12, 14, 8), [pos[0], pos[1] + size * 1.3, pos[2]], valveColor, {
    rot: [HALF_PI, 0, 0],
  });
  push(`${key}Spoke1`, box(size * 1.7, size * 0.06, size * 0.14), [pos[0], pos[1] + size * 1.3, pos[2]], valveColor);
  push(`${key}Spoke2`, box(size * 0.14, size * 0.06, size * 1.7), [pos[0], pos[1] + size * 1.3, pos[2]], valveColor);
}

/**
 * 指针式金属压力表/真空表组件
 */
export function pushPressureGauge(
  push: PushFn,
  key: string,
  pos: [number, number, number],
  facing: '+z' | '-z' | '+x' | '-x' = '+z',
  radius = 0.22
): void {
  push(`${key}Stem`, cylY(radius * 0.25, radius * 1.2, 8), [pos[0], pos[1] - radius * 0.6, pos[2]], 'copper');
  const caseRot: [number, number, number] = facing === '+z' || facing === '-z' ? [HALF_PI, 0, 0] : [0, 0, HALF_PI];
  push(`${key}Case`, cyl(radius, radius, 0.12, 16), pos, 'steel', { rot: caseRot });
  const dialOffset: [number, number, number] =
    facing === '+z' ? [pos[0], pos[1], pos[2] + 0.065] :
    facing === '-z' ? [pos[0], pos[1], pos[2] - 0.065] :
    facing === '+x' ? [pos[0] + 0.065, pos[1], pos[2]] :
    [pos[0] - 0.065, pos[1], pos[2]];
  push(`${key}Dial`, cyl(radius * 0.88, radius * 0.88, 0.02, 16), dialOffset, 'white', { rot: caseRot });
  push(`${key}Needle`, box(radius * 0.08, radius * 0.72, 0.02), [dialOffset[0], dialOffset[1] + radius * 0.24, dialOffset[2] + (facing === '+z' ? 0.015 : -0.015)], 'dark');
}

/**
 * 设备数控操作触摸屏与控制电箱组件
 */
export function pushControlScreen(
  push: PushFn,
  key: string,
  pos: [number, number, number],
  facing: '+z' | '-z' | '+x' | '-x' = '+z',
  width = 0.68,
  height = 0.46
): void {
  push(`${key}Box`, box(width * 1.1, height * 1.1, 0.16), pos, 'dark');
  const screenOffset: [number, number, number] =
    facing === '+z' ? [pos[0], pos[1], pos[2] + 0.09] :
    facing === '-z' ? [pos[0], pos[1], pos[2] - 0.09] :
    facing === '+x' ? [pos[0] + 0.09, pos[1], pos[2]] :
    [pos[0] - 0.09, pos[1], pos[2]];
  push(`${key}Frame`, box(width * 1.02, height * 1.02, 0.03), screenOffset, 'steel');
  const displayOffset: [number, number, number] =
    facing === '+z' ? [pos[0], pos[1], pos[2] + 0.105] :
    facing === '-z' ? [pos[0], pos[1], pos[2] - 0.105] :
    facing === '+x' ? [pos[0] + 0.105, pos[1], pos[2]] :
    [pos[0] - 0.105, pos[1], pos[2]];
  push(`${key}Screen`, box(width * 0.88, height * 0.82, 0.01), displayOffset, 'accent');
  const eStopPos: [number, number, number] =
    facing === '+z' ? [pos[0] + width * 0.42, pos[1] - height * 0.38, pos[2] + 0.11] :
    [pos[0] - width * 0.42, pos[1] - height * 0.38, pos[2] - 0.11];
  push(`${key}EStop`, cyl(0.06, 0.06, 0.06, 10), eStopPos, 'status', { rot: [HALF_PI, 0, 0] });
}

