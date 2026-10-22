/**
 * 设备材质与号牌域（自 equipment.ts 机械切出，纯移动不改行为）。
 *
 * 内聚在此：预设 → 材质集（喷漆件/深色件/铜件/玻璃…）、per-instance 着色的
 * 材质取用（materialFor）、七段数码管号牌几何（SEVEN_SEG + 缓存）与号牌共用材质。
 */
import * as THREE from 'three';
import type { ScenePreset } from './styles';
import { box, type TintRole } from './parts';

/* ========================= 材质 ========================= */

interface MatSet {
  /** 走 per-instance 颜色的喷漆件（status / livery / livery2 共用） */
  instanced: THREE.MeshStandardMaterial;
  /** 走 per-instance 颜色的自发光指示灯 */
  glow: THREE.MeshBasicMaterial;
  /** 走 per-instance 颜色的半透明光柱 / 光环 */
  halo: THREE.MeshBasicMaterial;
  steel: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  copper: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
  all: THREE.Material[];
}

export function buildMaterials(preset: ScenePreset): MatSet {
  const pal = preset.palette;
  const instanced = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.72 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const halo = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.34,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const steel = new THREE.MeshStandardMaterial({ color: pal.steel, roughness: 0.32, metalness: 0.82 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24282f, roughness: 0.28, metalness: 0.85 });
  const accent = new THREE.MeshStandardMaterial({ color: pal.accent, roughness: 0.36, metalness: 0.55 });
  const copper = new THREE.MeshStandardMaterial({ color: 0xb5773c, roughness: 0.32, metalness: 0.88 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0xbfd8e6,
    roughness: 0.12,
    metalness: 0.05,
    transparent: true,
    opacity: 0.26,
    side: THREE.DoubleSide,
  });
  const white = new THREE.MeshStandardMaterial({ color: 0xe9eef3, roughness: 0.38, metalness: 0.4 });
  const all = [instanced, glow, halo, steel, dark, accent, copper, glass, white];
  return { instanced, glow, halo, steel, dark, accent, copper, glass, white, all };
}

export function materialFor(set: MatSet, tint: TintRole): THREE.Material {
  switch (tint) {
    case 'status':
    case 'livery':
    case 'livery2':
      return set.instanced;
    case 'glow':
      return set.glow;
    case 'steel':
      return set.steel;
    case 'dark':
      return set.dark;
    case 'accent':
      return set.accent;
    case 'copper':
      return set.copper;
    case 'glass':
      return set.glass;
    case 'white':
      return set.white;
    default:
      return set.steel;
  }
}

/* ========================= 铭牌 ========================= */

/**
 * 设备铭牌 —— **纯几何**，不含任何字体或贴图资源。
 *
 * 为什么铭牌对本次改造很关键：16 台设备外形各异，但在远景/俯视下
 * 「哪个是 3#、哪个是 5#」仍需一眼可读；铭牌是最直接的锚点。
 *
 * 为什么不用 canvas 文字贴图（旧实现）：任务书明确写了「字体/贴图资源禁用」，
 * 而 `ctx.font` + `fillText` + `CanvasTexture` 恰好同时用到了字体与贴图。
 * 现改为「livery2 色板 + 细长方块拼出的七段数字」：
 *   - 零字体、零贴图，全部由 box 几何构成；
 *   - 七段笔画比同高度的文字笔画粗得多，远景下反而更清楚；
 *   - 板色与字色烘焙成顶点色、合并进同一块几何体 → 仍是 1 mesh/台，
 *     drawcall 与改造前持平（不增加），三角面约 +180/台。
 */

/** 七段数码管字模：位序 a(上横) b(右上竖) c(右下竖) d(下横) e(左下竖) f(左上竖) g(中横)。 */
const SEVEN_SEG: Record<string, number> = {
  '0': 0b0111111,
  '1': 0b0000110,
  '2': 0b1011011,
  '3': 0b1001111,
  '4': 0b1100110,
  '5': 0b1101101,
  '6': 0b1111101,
  '7': 0b0000111,
  '8': 0b1111111,
  '9': 0b1101111,
};

/** 铭牌几何缓存：16 台编号固定，几何体全局只建一次（与旧实现的贴图缓存同理）。 */
const PLATE_GEO_CACHE = new Map<string, THREE.BufferGeometry>();

/**
 * 全场合共用一个铭牌材质。
 * 顶点色承载「板色 + 字色」，所以不需要 16 份材质，也不会增加 drawcall。
 * 该材质是模块级常驻对象（与 GEO_CACHE 同类），**不参与 mats.all 的释放**。
 */
export const PLATE_MAT = new THREE.MeshBasicMaterial({
  vertexColors: true,
  toneMapped: false,
  side: THREE.DoubleSide,
});

/**
 * Emit the same box triangles directly: nameplates need position/color only.
 * Avoid constructing, translating and de-indexing a full normal/UV geometry
 * for every seven-segment stroke. The unit box remains in the shared cache.
 */
function mergeColoredBoxes(items: Array<{ w: number; h: number; d: number; x?: number; y?: number; z?: number; c: number }>): THREE.BufferGeometry {
  const unit = box(1, 1, 1);
  const vertices = unit.attributes.position;
  const index = unit.index!;
  const pos = new Float32Array(items.length * index.count * 3);
  const col = new Float32Array(pos.length);
  const color = new THREE.Color();
  let o = 0;
  for (const it of items) {
    color.setHex(it.c, THREE.SRGBColorSpace);
    for (let i = 0; i < index.count; i++) {
      const v = index.getX(i);
      // Match BoxGeometry's Float32 dimensions before its translation.
      pos[o] = Math.fround(vertices.getX(v) * it.w) + (it.x ?? 0);
      pos[o + 1] = Math.fround(vertices.getY(v) * it.h) + (it.y ?? 0);
      pos[o + 2] = Math.fround(vertices.getZ(v) * it.d) + (it.z ?? 0);
      col[o] = color.r;
      col[o + 1] = color.g;
      col[o + 2] = color.b;
      o += 3;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.userData.shared = true;
  return geo;
}

/** 生成一块序号铭牌：livery2 色板 + 白色七段数字（数字个数 = seq.length）。 */
function makePlateGeometry(seq: string, livery2: number): THREE.BufferGeometry {
  const boardH = 0.36;
  const dh = boardH * 0.74; // 数字高度
  const dw = dh * 0.6; // 数字宽度
  const gap = dw * 0.32;
  const t = dh * 0.15; // 笔画粗细
  const n = Math.max(1, seq.length);
  const contentW = n * dw + (n - 1) * gap;
  const boardW = contentW + boardH * 0.5;
  const boardD = 0.05;

  const items: Parameters<typeof mergeColoredBoxes>[0] = [
    { w: boardW, h: boardH, d: boardD, c: livery2 },
  ];

  const z = boardD / 2 + 0.01; // 数字浮在板面之上，避免与板面 z-fighting
  const hh = dh / 2;
  const hw = dw / 2;
  const vLen = Math.max(0.01, hh - 1.5 * t); // 竖段长度
  const vTopY = (t / 2 + (hh - t)) / 2;
  const vBotY = -vTopY;
  let x = -contentW / 2 + dw / 2;

  for (const ch of seq) {
    const mask = SEVEN_SEG[ch];
    if (mask !== undefined) {
      const put = (w: number, h: number, px: number, py: number) => {
        if (w <= 0 || h <= 0) return;
        items.push({ w, h, d: 0.02, x: x + px, y: py, z, c: 0xffffff });
      };
      if (mask & 1) put(dw, t, 0, hh - t / 2); // a 上横
      if (mask & 2) put(t, vLen, hw - t / 2, vTopY); // b 右上竖
      if (mask & 4) put(t, vLen, hw - t / 2, vBotY); // c 右下竖
      if (mask & 8) put(dw, t, 0, -hh + t / 2); // d 下横
      if (mask & 16) put(t, vLen, -hw + t / 2, vBotY); // e 左下竖
      if (mask & 32) put(t, vLen, -hw + t / 2, vTopY); // f 左上竖
      if (mask & 64) put(dw, t, 0, 0); // g 中横
    }
    x += dw + gap;
  }
  return mergeColoredBoxes(items);
}

export function cachedPlateGeometry(seq: string, livery2: number): THREE.BufferGeometry {
  const key = `${seq}|${livery2}`;
  let g = PLATE_GEO_CACHE.get(key);
  if (!g) {
    g = makePlateGeometry(seq, livery2);
    PLATE_GEO_CACHE.set(key, g);
  }
  return g;
}

/** 从设备编号取尾部序号（`EQ-2024-PUMP-01` → `01`），取不到则退回 id 尾部数字。 */
export function plateSeq(code: string, fallbackId: string): string {
  const m = /(\d{1,2})\s*$/.exec(code);
  if (m) return m[1];
  const m2 = /(\d+)\s*$/.exec(fallbackId);
  return m2 ? m2[1] : '';
}
