// 大屏地图共享几何工具（全国层 / 城市层共用）。
// 风格基调与 equipment3d/scene.ts standard 预设一致：深色科技蓝 + 状态色语义光柱。
// 本层的"地形感"是程序化起伏（stylized relief），只服务视觉识读，不代表真实高程数据。
import * as THREE from "three";
import { pillarPaletteOf } from "./mapStyle";

export const MAP_BG = 0x0b1220;

/** HDR 增益：bloom 阈值以上的亮度才会发光，这里把发光件推到 >1 */
const GAIN_CORE = 2.1;
const GAIN_EDGE = 2.4;

/** 等距圆柱投影：lng/lat → 地面平面坐标（x 东，-z 北，等距俯视） */
export function projectLngLat(lng: number, lat: number, center: [number, number] = [104, 37], scale = 1): [number, number] {
  return [(lng - center[0]) * scale, -(lat - center[1]) * scale];
}

/* ---------- 确定性噪声（无随机种子，两次加载完全一致） ---------- */

function hash2(x: number, y: number): number {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return v - Math.floor(v);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 值噪声：整数格点取哈希，格内双线性 + smoothstep */
function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  const u = smooth(xf);
  const v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** 分形叠加（4 阶），输出 0-1 */
function fbm(x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.05;
  }
  return norm > 0 ? sum / norm : 0;
}

/* ---------- 程序化起伏场 ---------- */

export interface ReliefField {
  /** 世界坐标 (x,z) 处的高程（已含起伏振幅） */
  heightAt: (x: number, z: number) => number;
  /** 该点是否落在轮廓多边形内（含岛屿等分离环，奇偶规则） */
  inside: (x: number, z: number) => boolean;
  bbox: { minX: number; maxX: number; minZ: number; maxZ: number };
  maxRelief: number;
  dispose: () => void;
}

/**
 * 由轮廓环构建起伏场：
 * - 高频 fbm 噪声负责"地形纹理"，宏观西高东低倾斜负责中国地势骨架；
 * - 环外高度归零，且距轮廓边界一定范围内收敛到 0，不会出现悬浮碎块；
 * - 噪声频率与收敛半径都按 bbox 归一化取值，全国层与省级层同一套参数语义。
 */
export function createReliefField(
  rings: [number, number][][],
  opts: { center?: [number, number]; scale?: number; relief?: number; frequency?: number } = {}
): ReliefField {
  const center = opts.center ?? [104, 37];
  const scale = opts.scale ?? 1;
  const relief = opts.relief ?? 1.1;
  const frequency = opts.frequency ?? 6.5;

  const poly: { x: number; z: number }[][] = rings.map((ring) =>
    ring.map(([lng, lat]) => {
      const [x, z] = projectLngLat(lng, lat, center, scale);
      return { x, z };
    })
  );

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const ring of poly) {
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
  }
  if (!Number.isFinite(minX)) {
    minX = maxX = minZ = maxZ = 0;
  }
  const spanX = Math.max(1e-3, maxX - minX);
  const spanZ = Math.max(1e-3, maxZ - minZ);

  const inside = (x: number, z: number): boolean => {
    let hit = false;
    for (const ring of poly) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i];
        const b = ring[j];
        if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z + 1e-9) + a.x) hit = !hit;
      }
    }
    return hit;
  };

  // 轮廓顶点分桶，供「距边界多远」近邻查询（3×3 邻格覆盖收敛半径即可）
  const cellNorm = 0.05;
  const cellX = Math.max(1e-4, cellNorm * spanX);
  const cellZ = Math.max(1e-4, cellNorm * spanZ);
  const bucketKey = (ix: number, iy: number) => ix * 1000003 + iy;
  const buckets = new Map<number, { x: number; z: number }[]>();
  for (const ring of poly) {
    for (const p of ring) {
      const k = bucketKey(Math.floor(p.x / cellX), Math.floor(p.z / cellZ));
      const arr = buckets.get(k);
      if (arr) arr.push(p);
      else buckets.set(k, [p]);
    }
  }

  const edgeDistance = (x: number, z: number): number => {
    const gx = Math.floor(x / cellX);
    const gz = Math.floor(z / cellZ);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = buckets.get(bucketKey(gx + dx, gz + dz));
        if (!bucket) continue;
        for (const p of bucket) {
          const d2 = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
          if (d2 < best) best = d2;
        }
      }
    }
    return best === Infinity ? 0 : Math.sqrt(best);
  };

  const falloffRef = cellNorm * Math.min(spanX, spanZ) * 1.8;

  const heightAt = (x: number, z: number): number => {
    if (!inside(x, z)) return 0;
    const u = (x - minX) / spanX;
    const v = (z - minZ) / spanZ;
    const n = fbm(u * frequency + 11.3, v * frequency * 1.35 + 4.7, 4);
    const ridge = Math.pow(fbm(u * frequency * 0.42 + 1.9, v * frequency * 0.55 + 8.1, 3), 1.4);
    // 贴边界一侧收敛成平原：像被海岸线裁出的台地，同时消除锯齿边缘的高频噪声
    const falloff = Math.min(1, edgeDistance(x, z) / falloffRef);
    // 西高东低：u=0（最西）取 1，u=1（最东）取 0
    const westHigh = Math.max(0, 1 - u);
    return relief * (0.6 * ridge + 0.32 * (n - 0.5) + 0.5 * westHigh * ridge) * falloff;
  };

  return { heightAt, inside, bbox: { minX, maxX, minZ, maxZ }, maxRelief: relief, dispose: () => buckets.clear() };
}

/* ---------- 地形面（受光 + 起伏 + 裁剪到轮廓内） ---------- */

export interface TerrainFill {
  group: THREE.Group;
  dispose: () => void;
}

/**
 * 轮廓内的起伏地形面：三角化网格按"三角形重心在轮廓内"裁剪，
 * 低多边形平面着色 + 顶点色（谷深蓝 / 脊亮青），叠加细噪声纹理出"卫星图"颗粒感。
 */
export function buildTerrainFill(
  rings: [number, number][][],
  opts: { center?: [number, number]; scale?: number; relief?: number; segX?: number; segZ?: number; colorLow?: number; colorHigh?: number }
): TerrainFill {
  const relief = createReliefField(rings, opts);
  const { minX, maxX, minZ, maxZ } = relief.bbox;
  const segX = opts.segX ?? 190;
  const segZ = opts.segZ ?? 150;
  const pad = 1;
  const width = maxX - minX + pad * 2;
  const depth = maxZ - minZ + pad * 2;
  const plane = new THREE.PlaneGeometry(width, depth, segX, segZ);
  plane.rotateX(-Math.PI / 2);
  const pos = plane.attributes.position as THREE.BufferAttribute;
  const low = new THREE.Color(opts.colorLow ?? 0x10233c);
  const high = new THREE.Color(opts.colorHigh ?? 0x2f6d8f);
  const ridge = new THREE.Color(0x4fd7e8);
  const colors: number[] = [];
  const tmp = new THREE.Color();
  let maxH = 1e-3;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + (minX + maxX) / 2;
    const z = pos.getZ(i) + (minZ + maxZ) / 2;
    const h = relief.heightAt(x, z);
    pos.setY(i, h);
    if (h > maxH) maxH = h;
  }
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, pos.getY(i) / (maxH * 1.05)));
    tmp.copy(low).lerp(high, Math.pow(t, 0.7));
    if (t > 0.72) tmp.lerp(ridge, (t - 0.72) / 0.28);
    colors.push(tmp.r, tmp.g, tmp.b);
  }
  plane.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  plane.computeVertexNormals();

  // 只保留重心落在轮廓内的三角形：与源平面共用顶点缓冲、换一份索引，
  // 地图边缘因此被"裁"成国界形状。不能用 toNonIndexed —— 那会让 keep 里的
  // 顶点编号在展平后的缓冲里错位，裁出满是豁口的地形。
  const srcIndex = plane.index;
  const keep: number[] = [];
  if (srcIndex) {
    for (let i = 0; i < srcIndex.count; i += 3) {
      const a = srcIndex.getX(i);
      const b = srcIndex.getX(i + 1);
      const c = srcIndex.getX(i + 2);
      const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3 + (minX + maxX) / 2;
      const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3 + (minZ + maxZ) / 2;
      if (relief.inside(cx, cz)) keep.push(a, b, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", plane.attributes.position);
  geo.setAttribute("uv", plane.attributes.uv);
  geo.setAttribute("color", plane.attributes.color);
  geo.setIndex(keep.length > 0 ? keep : null);
  geo.computeVertexNormals();

  const grain = makeTerrainGrainTexture();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: grain,
    roughness: 0.92,
    metalness: 0.08,
    flatShading: true,
    emissive: new THREE.Color(0x0a1a2e),
    emissiveIntensity: 1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);

  // 底座暗板 + 侧壁：给地图一点"厚度"，避免地形边缘像纸片
  const plateShape = buildPlateShape(rings, opts);
  const plateGeo = plateShape ? new THREE.ExtrudeGeometry(plateShape, { depth: 1.15, bevelEnabled: false, curveSegments: 1 }) : null;
  const plate = new THREE.Mesh(
    plateGeo ?? new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({ color: 0x091728, roughness: 1, metalness: 0, transparent: true, opacity: 0.96 })
  );
  if (plateGeo) plate.rotation.x = -Math.PI / 2;
  plate.position.y = -1.12;

  const group = new THREE.Group();
  group.add(plate, mesh);
  return {
    group,
    dispose: () => {
      geo.dispose();
      plane.dispose();
      mat.dispose();
      grain.dispose();
      plateGeo?.dispose();
      (plate.material as THREE.Material).dispose();
      relief.dispose();
    },
  };
}

function buildPlateShape(rings: [number, number][][], opts: { center?: [number, number]; scale?: number }): THREE.Shape | null {
  const main = rings.reduce<[number, number][]>((best, r) => (r.length > best.length ? r : best), []);
  if (main.length < 3) return null;
  const shape = new THREE.Shape();
  main.forEach(([lng, lat], i) => {
    const [x, z] = projectLngLat(lng, lat, opts.center, opts.scale);
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  return shape;
}

/** 细颗粒纹理：噪声底 + 极淡等高线，让地形读起来像卫星图而非纯色块 */
function makeTerrainGrainTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x * 0.09, y * 0.09, 3);
      const band = 0.92 + 0.16 * n + (Math.sin((x + y * 1.7) * 0.35) > 0.985 ? 0.22 : 0);
      const i = (y * size + x) * 4;
      img.data[i] = Math.round(255 * Math.min(1, band));
      img.data[i + 1] = Math.round(255 * Math.min(1, band));
      img.data[i + 2] = Math.round(255 * Math.min(1, band));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 12);
  return tex;
}

/* ---------- 发光描边 / 轮廓线 ---------- */

/** 边界环 → LineSegments（闭合折线段对），可选贴地起伏 */
export function buildBorderLines(
  rings: [number, number][][],
  opts: {
    color: number;
    opacity: number;
    center?: [number, number];
    scale?: number;
    /** 传入起伏场则描边贴合地形（发光国界），不传则为平面线 */
    relief?: ReliefField;
    y?: number;
    /** 每条边细分密度，保证长线也贴着地形走 */
    subdivide?: number;
    additive?: boolean;
    gain?: number;
  }
): THREE.LineSegments {
  const positions: number[] = [];
  const y0 = opts.y ?? 0.01;
  const sub = Math.max(1, opts.subdivide ?? 1);
  const at = (x: number, z: number) => (opts.relief ? y0 + opts.relief.heightAt(x, z) : y0);
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, z1] = projectLngLat(ring[i][0], ring[i][1], opts.center, opts.scale);
      const [x2, z2] = projectLngLat(ring[i + 1][0], ring[i + 1][1], opts.center, opts.scale);
      for (let s = 0; s < sub; s++) {
        const t0 = s / sub;
        const t1 = (s + 1) / sub;
        const ax = x1 + (x2 - x1) * t0;
        const az = z1 + (z2 - z1) * t0;
        const bx = x1 + (x2 - x1) * t1;
        const bz = z1 + (z2 - z1) * t1;
        positions.push(ax, at(ax, az), az, bx, at(bx, bz), bz);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const color = new THREE.Color(opts.color);
  if (opts.gain) color.multiplyScalar(opts.gain);
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: opts.opacity,
    toneMapped: false,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: false,
  });
  return new THREE.LineSegments(geo, mat);
}

/** 国界发光描边：主线 + 一圈宽衰减辉光线，Bloom 下形成视频里的蓝色霓虹边 */
export function buildGlowingBorder(
  rings: [number, number][][],
  opts: { center?: [number, number]; scale?: number; relief?: ReliefField; color?: number }
): THREE.Group {
  const color = opts.color ?? 0x36d3f0;
  const { center, scale, relief } = opts;
  const group = new THREE.Group();
  const halo = buildBorderLines(rings, {
    color,
    opacity: 0.3,
    center,
    scale,
    relief,
    y: relief ? 0.1 : 0.56,
    subdivide: 3,
    additive: true,
    gain: 1.15,
  });
  const core = buildBorderLines(rings, {
    color,
    opacity: 0.95,
    center,
    scale,
    relief,
    y: relief ? 0.18 : 0.62,
    subdivide: 3,
    additive: true,
    gain: GAIN_EDGE,
  });
  group.add(halo, core);
  return group;
}

/* ---------- 标注 ---------- */

/**
 * 地图文字标注（城市名 / 厂区名）：无底板、带深色描边，
 * 与 HUD 字体口径一致；plant=true（真实接入厂区）时用亮青并加粗。
 */
export function makeMapLabel(text: string, opts: { plant?: boolean; sub?: string; size?: number } = {}): THREE.Sprite {
  const size = opts.size ?? 40;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = `${opts.plant ? 700 : 500} ${size}px 'Microsoft YaHei', sans-serif`;
  const subFont = `400 ${Math.round(size * 0.62)}px 'Microsoft YaHei', sans-serif`;
  ctx.font = font;
  const wMain = ctx.measureText(text).width;
  ctx.font = subFont;
  const wSub = opts.sub ? ctx.measureText(opts.sub).width : 0;
  const padX = 14;
  const padY = 10;
  const lineH = size * 1.28;
  canvas.width = Math.ceil(Math.max(wMain, wSub) + padX * 2);
  canvas.height = Math.ceil(lineH * (opts.sub ? 2 : 1) + padY * 2);
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.font = font;
  // 深色描边保证在亮地形上也读得清（统一描边风格）
  ctx.strokeStyle = "rgba(4,10,20,0.92)";
  ctx.lineWidth = 6;
  ctx.strokeText(text, padX, padY);
  ctx.fillStyle = opts.plant ? "#a5f3fc" : "rgba(219,239,255,0.9)";
  ctx.fillText(text, padX, padY);
  if (opts.sub) {
    ctx.font = subFont;
    ctx.strokeStyle = "rgba(4,10,20,0.85)";
    ctx.lineWidth = 5;
    ctx.strokeText(opts.sub, padX, padY + lineH);
    ctx.fillStyle = "rgba(148,197,233,0.85)";
    ctx.fillText(opts.sub, padX, padY + lineH);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(canvas.width * 0.032, canvas.height * 0.032, 1);
  return sprite;
}

/** 画布文字精灵（工厂标签），可选状态色点 */
export function makeTextSprite(title: string, sub?: string, accent = "#67e8f9", dotColor?: string): THREE.Sprite {
  const pad = 18;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const fontTitle = "600 34px 'Microsoft YaHei', sans-serif";
  const fontSub = "400 24px 'Microsoft YaHei', sans-serif";
  ctx.font = fontTitle;
  const wTitle = ctx.measureText(title).width;
  ctx.font = fontSub;
  const subText = dotColor ? `  ${sub ?? ""}` : sub ?? "";
  const wSub = ctx.measureText(subText).width;
  const w = Math.ceil(Math.max(wTitle, wSub) + pad * 2);
  const h = sub ? 96 : 58;
  canvas.width = w;
  canvas.height = h;
  ctx.fillStyle = "rgba(6,14,28,0.78)";
  ctx.strokeStyle = "rgba(34,211,238,0.55)";
  ctx.lineWidth = 2;
  const r = 10;
  ctx.beginPath();
  ctx.moveTo(r, 1);
  ctx.arcTo(w - 1, 1, w - 1, h - 1, r);
  ctx.arcTo(w - 1, h - 1, 1, h - 1, r);
  ctx.arcTo(1, h - 1, 1, 1, r);
  ctx.arcTo(1, 1, w - 1, 1, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.font = fontTitle;
  ctx.fillStyle = accent;
  ctx.textBaseline = "top";
  ctx.fillText(title, pad, 10);
  if (sub) {
    if (dotColor) {
      ctx.fillStyle = dotColor;
      ctx.beginPath();
      ctx.arc(pad + 10, 66, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = fontSub;
    ctx.fillStyle = "rgba(203,213,225,0.92)";
    ctx.fillText(subText, pad, 52);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(w * 0.03, h * 0.03, 1);
  return sprite;
}

/* ---------- 贴图工具 ---------- */

/** 径向渐变辉光贴图（光柱底座光晕 / 顶部球共用） */
export function makeGlowTexture(inner = "rgba(255,255,255,0.95)", outer = "rgba(255,255,255,0)"): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.35, "rgba(255,255,255,0.42)");
  grad.addColorStop(1, outer);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 竖向渐变贴图（光柱柱身）：flipY=false → 画布首行即圆柱底边，
 * 因此从上往下画"实→虚"，柱体底部最亮、顶部散开消失。
 */
function makePillarGradientTexture(): THREE.CanvasTexture {
  const w = 8;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.12, "rgba(255,255,255,0.86)");
  grad.addColorStop(0.62, "rgba(255,255,255,0.3)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let sharedPillarGradient: THREE.CanvasTexture | null = null;
function pillarGradientTexture(): THREE.CanvasTexture {
  if (!sharedPillarGradient) sharedPillarGradient = makePillarGradientTexture();
  return sharedPillarGradient;
}

/** 深色科技蓝纵向渐变 + 顶部光晕，作为 scene.background（避免透明画布与 CSS 底之间出现断层） */
export function makeSkyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#16294a");
  grad.addColorStop(0.45, "#0d1c33");
  grad.addColorStop(1, "#070f1e");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------- 灯光 ---------- */

/** 地图层布光：半球光给地形底色，主平行光沿视线偏上打亮起伏（与车间层 standard 预设同调） */
export function addMapLights(scene: THREE.Scene): { dispose: () => void } {
  const hemi = new THREE.HemisphereLight(0x4d7fb5, 0x081223, 1.15);
  const key = new THREE.DirectionalLight(0xbfe4ff, 1.5);
  key.position.set(-18, 34, 26);
  const rim = new THREE.DirectionalLight(0x2b6f9e, 0.7);
  rim.position.set(22, 14, -20);
  scene.add(hemi, key, rim);
  return {
    dispose: () => {
      scene.remove(hemi, key, rim);
      hemi.dispose();
      key.dispose();
      rim.dispose();
    },
  };
}

/* ---------- 流动光点 ---------- */

export interface FlowDots {
  group: THREE.Group;
  update: (dt: number) => void;
  dispose: () => void;
}

/** 移动光点流（人车流动画：地图区域内匀速巡游的发光小点） */
export function createFlowDots(
  count: number,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  color = 0x67e8f9
): FlowDots {
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.16, 8, 6);
  const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const dots: { mesh: THREE.Mesh; target: THREE.Vector2; speed: number }[] = [];
  const pick = () => new THREE.Vector2(bounds.minX + Math.random() * (bounds.maxX - bounds.minX), bounds.minZ + Math.random() * (bounds.maxZ - bounds.minZ));
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(geo, mat);
    const start = pick();
    mesh.position.set(start.x, 0.85, start.y);
    group.add(mesh);
    dots.push({ mesh, target: pick(), speed: 4 + Math.random() * 5 });
  }
  return {
    group,
    update: (dt: number) => {
      for (const d of dots) {
        const dx = d.target.x - d.mesh.position.x;
        const dz = d.target.y - d.mesh.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.6) {
          d.target = pick();
          continue;
        }
        d.mesh.position.x += (dx / dist) * d.speed * dt;
        d.mesh.position.z += (dz / dist) * d.speed * dt;
      }
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
      group.clear();
    },
  };
}

/* ---------- 厂区光柱 ---------- */

export interface LightPillar {
  group: THREE.Group;
  hitMesh: THREE.Mesh;
  /** 呼吸动画；elapsed 为场景累计秒数 */
  update: (elapsed: number) => void;
  setHovered: (hovered: boolean) => void;
  /** 下钻时其余光柱淡出（0-1） */
  setFade: (alpha: number) => void;
  dispose: () => void;
}

/**
 * 状态化发光光柱：柱身竖向渐变（按状态着色，核心亮度 ×GAIN 供 bloom 取光）
 * + 底座圆形光晕 + 外扩涟漪环 + 顶部能量球，2.6s 呼吸脉冲。
 * status 经 pillarPaletteOf 落到青/橙/红三色，未登记状态按正常处理。
 * 加色件一律 fog:false：否则雾色会被叠加进高光，远处光柱发灰发白。
 */
export function createLightPillar(opts: { height: number; radius: number; status?: string; seedPhase?: number; ripples?: number }): LightPillar {
  const palette = pillarPaletteOf(opts.status);
  const { height, radius } = opts;
  const seed = opts.seedPhase ?? 0;
  const group = new THREE.Group();

  const coreMat = new THREE.MeshBasicMaterial({
    map: pillarGradientTexture(),
    color: new THREE.Color(palette.core).multiplyScalar(GAIN_CORE),
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
  });
  const coreGeo = new THREE.CylinderGeometry(radius * 0.18, radius * 0.95, height, 14, 1, true);
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.position.y = height / 2;

  const flareMat = new THREE.MeshBasicMaterial({
    map: pillarGradientTexture(),
    color: new THREE.Color(palette.tip).multiplyScalar(1.15),
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
  });
  const flareGeo = new THREE.CylinderGeometry(radius * 0.5, radius * 1.9, height * 0.92, 14, 1, true);
  const flare = new THREE.Mesh(flareGeo, flareMat);
  flare.position.y = (height * 0.92) / 2;

  // 顶部能量球 + 光晕
  const orbGeo = new THREE.SphereGeometry(radius * 0.62, 16, 12);
  const orbMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(palette.tip).multiplyScalar(GAIN_CORE),
    toneMapped: false,
    transparent: true,
    opacity: 0.98,
    fog: false,
  });
  const orb = new THREE.Mesh(orbGeo, orbMat);
  orb.position.y = height;
  const glowTex = makeGlowTexture();
  const orbHaloMat = new THREE.SpriteMaterial({
    map: glowTex,
    color: palette.core,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  const orbHalo = new THREE.Sprite(orbHaloMat);
  orbHalo.scale.set(radius * 5.2, radius * 5.2, 1);
  orbHalo.position.y = height;

  // 底座圆形光晕（贴地圆盘，非 sprite，从俯视看是正圆）
  const discGeo = new THREE.CircleGeometry(radius * 5.4, 40);
  const discMat = new THREE.MeshBasicMaterial({
    map: glowTex,
    color: new THREE.Color(palette.core).multiplyScalar(1.6),
    transparent: true,
    opacity: 0.62,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.05;

  // 涟漪环：从底座向外扩散并淡出，错相位避免同频闪
  const rippleCount = Math.max(0, opts.ripples ?? 2);
  const rippleGeo = new THREE.RingGeometry(radius * 1.05, radius * 1.45, 44);
  const ripples: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; phase: number }[] = [];
  for (let i = 0; i < rippleCount; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.core).multiplyScalar(1.5),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(rippleGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.06;
    group.add(mesh);
    ripples.push({ mesh, mat, phase: i / Math.max(1, rippleCount) });
  }

  const hitGeo = new THREE.CylinderGeometry(radius * 2.2, radius * 2.2, height + radius * 3, 8);
  // colorWrite:false 而非 visible:false：旧版 three 拾取会跳过不可见对象
  const hitMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const hitMesh = new THREE.Mesh(hitGeo, hitMat);
  hitMesh.position.y = (height + radius * 3) / 2;

  group.add(core, flare, orb, orbHalo, disc, hitMesh);

  let hovered = false;
  let fade = 1;

  const setHovered = (next: boolean) => {
    hovered = next;
    discMat.opacity = (next ? 0.92 : 0.62) * fade;
    flareMat.opacity = (next ? 0.48 : 0.3) * fade;
    group.scale.set(next ? 1.06 : 1, next ? 1.06 : 1, next ? 1.06 : 1);
  };
  const setFade = (alpha: number) => {
    fade = Math.min(1, Math.max(0, alpha));
    coreMat.opacity = 0.95 * fade;
    discMat.opacity = (hovered ? 0.92 : 0.62) * fade;
    orbMat.opacity = 0.98 * fade;
    orbHaloMat.opacity = 0.55 * fade;
    flareMat.opacity = (hovered ? 0.48 : 0.3) * fade;
    hitMesh.visible = fade > 0.05;
  };

  const update = (elapsed: number) => {
    const t = elapsed + seed;
    // 2.6s 呼吸：柱身细度、底座光晕、顶部球同步慢明暗
    const wave = 0.5 - 0.5 * Math.cos((t * Math.PI * 2) / 2.6);
    core.scale.set(1 + 0.09 * wave, 1, 1 + 0.09 * wave);
    coreMat.opacity = (0.78 + 0.26 * wave + (hovered ? 0.14 : 0)) * fade;
    orb.scale.setScalar(0.86 + 0.22 * wave);
    orbHalo.scale.setScalar(radius * 5.2 * (0.9 + 0.24 * wave));
    orbHaloMat.opacity = (0.4 + 0.28 * wave) * fade;
    disc.scale.setScalar(0.94 + 0.1 * wave);
    for (const r of ripples) {
      const p = ((t * 0.42 + r.phase) % 1 + 1) % 1;
      const s = 0.8 + p * 3.4;
      r.mesh.scale.set(s, s, 1);
      r.mat.opacity = (hovered ? 0.62 : 0.42) * (1 - p) * fade;
    }
  };

  const dispose = () => {
    coreGeo.dispose();
    flareGeo.dispose();
    orbGeo.dispose();
    discGeo.dispose();
    rippleGeo.dispose();
    hitGeo.dispose();
    glowTex.dispose();
    coreMat.dispose();
    flareMat.dispose();
    orbMat.dispose();
    orbHaloMat.dispose();
    discMat.dispose();
    hitMat.dispose();
    for (const r of ripples) r.mat.dispose();
  };

  return { group, hitMesh, update, setHovered, setFade, dispose };
}

/** 深色网格地面（与 scene.ts 深色风格统一） */
export function buildMapGround(size: number): THREE.GridHelper {
  const grid = new THREE.GridHelper(size, Math.round(size / 4), 0x1e3a5f, 0x142741);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.28;
  return grid;
}

/** 运行状态 → 色点颜色（与车间层状态色一致） */
export function statusDotColor(status: string): string {
  if (status === "running") return "#34d399";
  if (status === "fault") return "#f87171";
  if (status === "overhauling" || status === "maintenance" || status === "warning") return "#fbbf24";
  return "#60a5fa";
}

export function statusLabel(status: string): string {
  if (status === "running") return "运行中";
  if (status === "fault") return "故障";
  if (status === "overhauling") return "检修中";
  if (status === "maintenance") return "维护中";
  if (status === "warning") return "预警";
  if (status === "standby") return "备用";
  return status;
}
