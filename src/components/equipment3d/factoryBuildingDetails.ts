/**
 * 厂房外观细节（几何层：只画，不算业务数值）。
 *
 * 目标：厂区俯瞰层的厂房不再是"同一个盒子复制五份"。按 factoryBuildingTypes
 * 解析出的角色，落成四种可直接辨识的工业建筑：
 *   - 平顶（动力站房）    —— 高体量 + 多烟囱 + 三层高侧窗 + 屋面的通风管廊；
 *   - 双坡（重型车间）    —— 带屋脊的斜坡屋面、宽大门洞、门廊钢架与黄色行车；
 *   - 锯齿（标准轻钢）    —— 规整密窗带 + 锯齿形采光跨（玻璃朝同一向）；
 *   - 四坡（仓储/办公）   —— 矮体量、单坡四水屋顶、开洞少。
 *
 * 性能口径：窗带与烟囱这类重复体一律走 InstancedMesh（共享几何 + 共享材质），
 * 一栋楼的几十扇窗 = 2 个 Draw Call。所有材质与几何都由调用方的共享资源表提供，
 * 本模块不 new 任何材质，避免厂区层材质数随楼栋线性膨胀。
 */

import * as THREE from 'three';
import type { BuildingType } from './factoryBuildingTypes';

export interface BuildingDecorGeo {
  /** 1×1×1 通用盒体（靠 scale 复用） */
  box: THREE.BufferGeometry;
  /** 1×0.25×1 扁条（檐口 / 标线） */
  strip: THREE.BufferGeometry;
  /** r=1、h=1 圆柱（烟囱、管道、轮） */
  cylinder: THREE.BufferGeometry;
  /** r=1、h=1 的四棱锥（四坡屋顶） */
  pyramid: THREE.BufferGeometry;
}

export interface BuildingDecorMats {
  roof: THREE.Material;
  roofAlt: THREE.Material;
  glass: THREE.Material;
  windowFrame: THREE.Material;
  trussSteel: THREE.Material;
  crane: THREE.Material;
  chimneyLight: THREE.Material;
  chimneyBand: THREE.Material;
  duct: THREE.Material;
}

export interface BuildingDecorKit {
  geo: BuildingDecorGeo;
  mat: BuildingDecorMats;
  shadows: boolean;
  /** 与 scene.ts 的 LOD 口径一致：0 = 远景裁剪，细节体只在 detail>=1 时生成 */
  detail: number;
}

/** 一栋厂房的落位尺寸与朝向（与 PlacedBuilding 的几何字段同形）。 */
export interface BuildingShape {
  w: number;
  h: number;
  d: number;
  /** +1 = 主立面朝 +Z，-1 = 朝 -Z（面向主干道） */
  facingSign: 1 | -1;
}

const HALF_SQRT2 = Math.SQRT2;

function applyDummy(
  dummy: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  rx = 0,
  ry = 0,
  rz = 0
): THREE.Matrix4 {
  dummy.position.set(x, y, z);
  dummy.rotation.set(rx, ry, rz);
  dummy.scale.set(sx, sy, sz);
  dummy.updateMatrix();
  return dummy.matrix.clone();
}

/** 用一组矩阵批量落一个 InstancedMesh（共享几何 + 共享材质）。 */
function addInstanced(
  g: THREE.Group,
  kit: BuildingDecorKit,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  matrices: THREE.Matrix4[],
  name: string
): THREE.InstancedMesh | null {
  if (!matrices.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, matrices.length);
  for (let i = 0; i < matrices.length; i++) im.setMatrixAt(i, matrices[i]);
  im.instanceMatrix.needsUpdate = true;
  im.name = name;
  im.castShadow = kit.shadows;
  im.receiveShadow = kit.shadows;
  g.add(im);
  return im;
}

/* ==================== 屋顶形式 ==================== */

/** 各屋顶形式的举高（米），会顶高厂房总高，供热力面/标牌避让。 */
export function roofRise(type: BuildingType, shape: BuildingShape): number {
  if (type.roofStyle === 'gable') return Math.min(4.6, shape.d * 0.17);
  if (type.roofStyle === 'hip') return Math.min(3.6, Math.min(shape.w, shape.d) * 0.14);
  if (type.roofStyle === 'sawtooth') return 2.4;
  return 0;
}

/**
 * 生成屋顶结构。平顶沿用调用方原有的女儿墙 + 采光天窗，这里只补坡屋面形式，
 * 返回屋面举高供调用方抬高其他贴附体。
 */
export function buildRoofStructure(
  g: THREE.Group,
  shape: BuildingShape,
  type: BuildingType,
  kit: BuildingDecorKit
): { rise: number; meshes: number } {
  const rise = roofRise(type, shape);
  if (!rise || kit.detail < 1) return { rise: 0, meshes: 0 };
  const { w, d, h } = shape;
  const dummy = new THREE.Object3D();
  const matrices: THREE.Matrix4[] = [];

  if (type.roofStyle === 'gable') {
    // 屋脊沿面宽方向（X），两侧坡面向 ±Z 下落
    const slope = Math.hypot(d / 2, rise);
    const angle = Math.atan2(rise, d / 2);
    const t = 0.42;
    matrices.push(
      applyDummy(dummy, 0, h + rise / 2, d / 4, w * 1.04, t, slope, -angle, 0, 0),
      applyDummy(dummy, 0, h + rise / 2, -d / 4, w * 1.04, t, slope, angle, 0, 0),
      // 屋脊压顶
      applyDummy(dummy, 0, h + rise + 0.1, 0, w * 1.05, 0.5, 0.9, 0, 0, 0)
    );
    // 山墙封头（三角形用四棱锥压扁近似）
    for (const sx of [-1, 1]) {
      matrices.push(
        applyDummy(
          dummy,
          sx * (w / 2),
          h + rise / 2,
          0,
          0.35,
          rise,
          d,
          0,
          0,
          sx > 0 ? -Math.PI / 4 : Math.PI / 4
        )
      );
    }
    addInstanced(g, kit, kit.geo.box, kit.mat.roof, matrices, 'roofGable');
    return { rise, meshes: 1 };
  }

  if (type.roofStyle === 'hip') {
    // 四棱锥底面为正方形（外接圆半径 1），按 w/d 非等比缩放并转 45° 对齐轴线
    const m = applyDummy(
      dummy,
      0,
      h + rise / 2 + 0.1,
      0,
      (w * 1.04) / HALF_SQRT2,
      rise,
      (d * 1.04) / HALF_SQRT2,
      0,
      Math.PI / 4,
      0
    );
    addInstanced(g, kit, kit.geo.pyramid, kit.mat.roof, [m], 'roofHip');
    const ridge = applyDummy(dummy, 0, h + rise + 0.18, 0, w * 0.42, 0.3, 0.6, 0, 0, 0);
    addInstanced(g, kit, kit.geo.box, kit.mat.roofAlt, [ridge], 'roofHipRidge');
    return { rise, meshes: 2 };
  }

  // 锯齿形采光带：跨间沿 X 均分，垂直玻璃面统一朝主立面反向（迎风采光）
  const bays = Math.max(2, type.sawtoothBays);
  const bayW = (w * 0.98) / bays;
  const cx0 = -w * 0.49 + bayW / 2;
  const slope = Math.hypot(bayW, rise);
  const angle = Math.atan2(rise, bayW);
  for (let i = 0; i < bays; i++) {
    const cx = cx0 + i * bayW;
    matrices.push(
      applyDummy(dummy, cx, h + rise / 2, 0, 0.34, slope, d * 0.99, Math.PI / 2 - angle, 0, 0)
    );
  }
  addInstanced(g, kit, kit.geo.box, kit.mat.roof, matrices, 'roofSawthoofPitch');

  const glazing: THREE.Matrix4[] = [];
  for (let i = 0; i < bays; i++) {
    const cx = cx0 + i * bayW;
    glazing.push(
      applyDummy(dummy, cx - bayW / 2 + 0.2, h + rise / 2, 0, 0.16, rise * 0.92, d * 0.94, 0, 0, 0)
    );
  }
  addInstanced(g, kit, kit.geo.box, kit.mat.glass, glazing, 'roofSawtoothGlazing');
  return { rise, meshes: 2 };
}

/* ==================== 窗带（InstancedMesh） ==================== */

/**
 * 规整窗带：cols × rows 的网格，两侧立面都排布；主立面门洞上方留空。
 * 返回窗格数，供调用方做预算断言。
 */
export function buildWindowBand(
  g: THREE.Group,
  shape: BuildingShape,
  type: BuildingType,
  kit: BuildingDecorKit
): { panes: number; draws: number } {
  const { w, h, d, facingSign } = shape;
  const cols = Math.max(3, type.windowCols);
  const rows = Math.max(1, type.windowRows);
  const step = (w * 0.82) / cols;
  const paneW = step * 0.66;
  const paneH = Math.min(1.55, (h * 0.5) / rows);
  const doorHalf = type.doorWidth / 2 + 0.9;

  const dummy = new THREE.Object3D();
  const glass: THREE.Matrix4[] = [];
  const frames: THREE.Matrix4[] = [];

  for (const side of [1, -1]) {
    const sz = side * (d / 2 + 0.08);
    const isFront = side === facingSign;
    for (let row = 0; row < rows; row++) {
      // 窗层自下而上均匀分布；单层的仓储类落在墙体中段
      const t = rows === 1 ? 0.52 : 0.3 + (row / (rows - 1)) * 0.42;
      const wy = h * t;
      for (let col = 0; col < cols; col++) {
        const wx = -w * 0.41 + col * step + step / 2;
        if (isFront && row === 0 && Math.abs(wx) < doorHalf) continue;
        glass.push(applyDummy(dummy, wx, wy, sz, paneW, paneH, 0.2, 0, 0, 0));
        frames.push(
          applyDummy(
            dummy,
            wx,
            wy,
            sz - side * 0.05,
            paneW + 0.2,
            paneH + 0.2,
            0.12,
            0,
            0,
            0
          )
        );
      }
    }
  }
  addInstanced(g, kit, kit.geo.box, kit.mat.glass, glass, 'windowGlass');
  addInstanced(g, kit, kit.geo.box, kit.mat.windowFrame, frames, 'windowFrames');
  return { panes: glass.length, draws: glass.length ? 2 : 0 };
}

/* ==================== 烟囱群与通风管廊 ==================== */

/** 主烟囱（红白安全色分段）+ 屋面排气管廊。数量由角色决定，不做视觉噪声堆砌。 */
export function buildStacks(
  g: THREE.Group,
  shape: BuildingShape,
  type: BuildingType,
  kit: BuildingDecorKit
): { stacks: number; draws: number } {
  const n = type.chimneys;
  if (!n || kit.detail < 1) return { stacks: 0, draws: 0 };
  const { w, h, d } = shape;
  const dummy = new THREE.Object3D();
  const shafts: THREE.Matrix4[] = [];
  const bands: THREE.Matrix4[] = [];
  const caps: THREE.Matrix4[] = [];
  const segs = 3;
  const chimneyH = 9.5 + (type.role === 'power' ? 3.5 : 0);

  for (let i = 0; i < n; i++) {
    // 沿面宽方向均布，靠后侧屋面，避免压住主立面
    const cx = n === 1 ? -w * 0.22 : -w * 0.32 + (i * (w * 0.64)) / (n - 1);
    const cz = -d * 0.26;
    const r = type.role === 'power' ? 1.15 : 0.95;
    shafts.push(applyDummy(dummy, cx, h + chimneyH / 2, cz, r, chimneyH, r, 0, 0, 0));
    for (let s = 0; s < segs; s++) {
      const by = h + chimneyH * (0.28 + s * 0.24);
      bands.push(applyDummy(dummy, cx, by, cz, r * 1.05, chimneyH * 0.09, r * 1.05, 0, 0, 0));
    }
    caps.push(applyDummy(dummy, cx, h + chimneyH + 0.22, cz, r * 1.35, 0.45, r * 1.35, 0, 0, 0));
  }
  let draws = 0;
  draws += addInstanced(g, kit, kit.geo.cylinder, kit.mat.chimneyLight, shafts, 'stackShafts') ? 1 : 0;
  draws += addInstanced(g, kit, kit.geo.cylinder, kit.mat.chimneyBand, bands, 'stackBands') ? 1 : 0;
  draws += addInstanced(g, kit, kit.geo.cylinder, kit.mat.chimneyLight, caps, 'stackCaps') ? 1 : 0;

  // 屋面通风管廊：沿面宽的横向总管 + 两根立管（动力/重型才有工艺管道）
  if (type.role === 'power' || type.role === 'heavy') {
    const ducts: THREE.Matrix4[] = [
      applyDummy(dummy, 0, h + 1.6, -d * 0.14, w * 0.62, 0.5, 0.5, 0, 0, Math.PI / 2),
      applyDummy(dummy, -w * 0.28, h + 1.0, -d * 0.14, 0.5, 1.6, 0.5, 0, 0, 0),
      applyDummy(dummy, w * 0.02, h + 2.6, -d * 0.14, 0.42, 2.6, 0.42, 0, 0, 0),
    ];
    draws += addInstanced(g, kit, kit.geo.cylinder, kit.mat.duct, ducts, 'roofDucts') ? 1 : 0;
  }
  return { stacks: n, draws };
}

/* ==================== 重型车间：宽门洞 + 门廊钢架 + 行车 ==================== */

/**
 * 门廊钢架与桥式行车（吊车）。行车放在门廊之下 —— 从空中俯视才能一眼认出
 * "这栋是能干重活的跨间"，藏在墙体里等于没画。
 */
export function buildCranePortal(
  g: THREE.Group,
  shape: BuildingShape,
  type: BuildingType,
  kit: BuildingDecorKit
): { draws: number } {
  if (!type.craneBay || kit.detail < 1) return { draws: 0 };
  const { w, h, d, facingSign } = shape;
  const half = type.doorWidth / 2 + 1.6;
  const dummy = new THREE.Object3D();
  const zPortal = facingSign * (d / 2 + 2.2);
  const beamY = Math.min(h * 0.92, h - 0.6);

  const columns: THREE.Matrix4[] = [];
  for (const sx of [-half, half]) {
    columns.push(applyDummy(dummy, sx, beamY / 2, zPortal, 0.55, beamY, 0.55, 0, 0, 0));
    // 斜撑
    columns.push(
      applyDummy(dummy, sx * 0.82, beamY * 0.36, zPortal, 0.28, beamY * 0.55, 0.28, 0, 0, sx > 0 ? -0.5 : 0.5)
    );
  }
  let draws = 0;
  draws += addInstanced(g, kit, kit.geo.box, kit.mat.trussSteel, columns, 'portalColumns') ? 1 : 0;

  const beams: THREE.Matrix4[] = [
    // 行车主梁（横跨门洞，黄色）
    applyDummy(dummy, 0, beamY, zPortal, type.doorWidth + 3.6, 0.8, 0.9, 0, 0, 0),
    // 钢连系梁
    applyDummy(dummy, 0, beamY + 1.15, zPortal, type.doorWidth + 3.6, 0.32, 0.42, 0, 0, 0),
  ];
  draws += addInstanced(g, kit, kit.geo.box, kit.mat.crane, beams, 'craneGirder') ? 1 : 0;

  const trolley: THREE.Matrix4[] = [
    applyDummy(dummy, -type.doorWidth * 0.14, beamY - 0.75, zPortal, 1.6, 0.9, 1.7, 0, 0, 0),
    // 吊索 + 吊钩
    applyDummy(dummy, -type.doorWidth * 0.14, beamY - 2.1, zPortal, 0.14, 2.0, 0.14, 0, 0, 0),
    applyDummy(dummy, -type.doorWidth * 0.14, beamY - 3.2, zPortal, 0.9, 0.5, 0.9, 0, 0, 0),
  ];
  draws += addInstanced(g, kit, kit.geo.box, kit.mat.crane, trolley, 'craneTrolley') ? 1 : 0;

  // 地面行车轨道（两条延伸到场地的钢轨）
  const rails: THREE.Matrix4[] = [];
  for (const sx of [-half, half]) {
    rails.push(
      applyDummy(dummy, sx, 0.09, zPortal + facingSign * 6, 0.45, 0.18, 12, 0, 0, 0)
    );
  }
  draws += addInstanced(g, kit, kit.geo.box, kit.mat.trussSteel, rails, 'craneRails') ? 1 : 0;

  // 门廊顶（雨篷式压檐，让门洞在俯瞰角度下有明暗层次）
  const soffit = applyDummy(dummy, 0, beamY + 1.6, zPortal, type.doorWidth + 4.4, 0.3, 4.4, 0, 0, 0);
  draws += addInstanced(g, kit, kit.geo.box, kit.mat.roofAlt, [soffit], 'portalSoffit') ? 1 : 0;

  // 体量提示：跨度越大，屋顶越该有吊车梁外显的牛腿
  const brackets: THREE.Matrix4[] = [];
  for (const sx of [-w * 0.28, 0, w * 0.28]) {
    brackets.push(applyDummy(dummy, sx, h - 1.2, facingSign * (d / 2 + 0.25), 1.1, 0.5, 0.5, 0, 0, 0));
  }
  draws += addInstanced(g, kit, kit.geo.box, kit.mat.trussSteel, brackets, 'craneBrackets') ? 1 : 0;

  return { draws };
}

/* ==================== 汇总统计（供预算断言） ==================== */

export interface BuildingDecorSummary {
  rise: number;
  windowPanes: number;
  stacks: number;
  draws: number;
}

/** 一次性生成屋顶 + 窗带 + 烟囱/管廊 + 行车门廊，返回统计供守卫测试。 */
export function decorateBuilding(
  g: THREE.Group,
  shape: BuildingShape,
  type: BuildingType,
  kit: BuildingDecorKit
): BuildingDecorSummary {
  const roof = buildRoofStructure(g, shape, type, kit);
  const windows = buildWindowBand(g, shape, type, kit);
  const stacks = buildStacks(g, shape, type, kit);
  const crane = buildCranePortal(g, shape, type, kit);
  return {
    rise: roof.rise,
    windowPanes: windows.panes,
    stacks: stacks.stacks,
    draws: roof.meshes + windows.draws + stacks.draws + crane.draws,
  };
}
