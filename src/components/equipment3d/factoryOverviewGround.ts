/**
 * 厂区总览 —— 道路与绿化域（自 FactoryOverview 类机械切出，纯移动不改行为）。
 *
 * 内聚在此：中央十字主干道 + 外环道路 + 中心虚线 + 斑马线 + 路缘石（buildRoads）、
 * 草坪地块与行道树（buildGreenery）、道路中心虚线纹理（makeDashTexture）。
 *
 * 类方法 → 自由函数：原 this 依赖（场景根组 / 园区范围 / 共享材质与几何 / 阴影开关 /
 * 随机源 / 纹理回收表）收拢为 GroundCtx 上下文，由宿主在调用点组装。
 */
import * as THREE from 'three';

export interface GroundCtx {
  /** 场景根组（所有道路 / 绿化网格挂这里） */
  group: THREE.Group;
  /** 园区半幅尺寸（宿主 extent getter 的产出） */
  extent: { halfX: number; halfZ: number };
  /** 阴影开关（FactoryOverviewOptions.shadows） */
  shadows: boolean;
  /** 行道树尺寸抖动随机源 */
  rng: () => number;
  /** 纹理回收表（宿主 dispose 时统一释放） */
  ownedTextures: THREE.Texture[];
  road: THREE.MeshStandardMaterial;
  curb: THREE.MeshStandardMaterial;
  lawn: THREE.MeshStandardMaterial;
  foliage: THREE.MeshStandardMaterial;
  trunk: THREE.MeshStandardMaterial;
  cone: THREE.ConeGeometry;
  cylinder: THREE.CylinderGeometry;
}

/** 主干道中心虚线纹理（64×16 canvas，与渲染器无关，可独立构造）。 */
export function makeDashTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 16;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, 64, 16);
  ctx.fillStyle = 'rgba(226,232,240,0.75)';
  ctx.fillRect(0, 6, 34, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/** 中央十字主干道 + 外环道路（园区平面图的"路网"骨架）。 */
export function buildRoads(ctx: GroundCtx): void {
  const { group, extent, shadows, road, curb } = ctx;
  const { halfX, halfZ } = extent;
  const ROAD_W = 16;

  const addRoad = (w: number, d: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), road);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.01, z);
    m.receiveShadow = shadows;
    group.add(m);
  };

  // 十字主干道：横轴分隔南北分区，纵轴分隔东西分区
  addRoad(halfX * 2.2, ROAD_W, 0, 0);
  addRoad(ROAD_W, halfZ * 2.2, 0, 0);

  // 外环路（四段）
  const ringW = 11;
  addRoad(halfX * 1.82, ringW, 0, -halfZ * 0.93);
  addRoad(halfX * 1.82, ringW, 0, halfZ * 0.93);
  addRoad(ringW, halfZ * 1.82, -halfX * 0.93, 0);
  addRoad(ringW, halfZ * 1.82, halfX * 0.93, 0);

  // 主干道中心虚线
  const dash = makeDashTexture();
  if (dash) {
    ctx.ownedTextures.push(dash);
    dash.repeat.set(halfX / 6, 1);
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(halfX * 2.2, 0.9),
      new THREE.MeshBasicMaterial({ map: dash, transparent: true, depthWrite: false, toneMapped: false })
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.03, 0);
    line.renderOrder = 2;
    group.add(line);

    const dash2 = dash.clone();
    dash2.needsUpdate = true;
    dash2.repeat.set(1, halfZ / 6);
    ctx.ownedTextures.push(dash2);
    const line2 = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, halfZ * 2.2),
      new THREE.MeshBasicMaterial({ map: dash2, transparent: true, depthWrite: false, toneMapped: false })
    );
    line2.rotation.x = -Math.PI / 2;
    line2.position.set(0, 0.03, 0);
    line2.renderOrder = 2;
    group.add(line2);
  }

  // 斑马线（人行横道条纹，增加路口工业规范感）
  const zebraGeo = new THREE.PlaneGeometry(0.8, 5.2);
  const zebraMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
  const addZebraCross = (cx: number, cz: number, isVertical: boolean) => {
    const zGroup = new THREE.Group();
    zGroup.position.set(cx, 0.04, cz);
    const count = 7;
    const step = 1.6;
    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) / 2) * step;
      const stripe = new THREE.Mesh(zebraGeo, zebraMat);
      stripe.rotation.x = -Math.PI / 2;
      if (isVertical) {
        stripe.rotation.z = Math.PI / 2;
        stripe.position.set(0, 0, offset);
      } else {
        stripe.position.set(offset, 0, 0);
      }
      zGroup.add(stripe);
    }
    group.add(zGroup);
  };

  addZebraCross(0, 18, false);
  addZebraCross(0, -18, false);
  addZebraCross(18, 0, true);
  addZebraCross(-18, 0, true);

  // 道路路缘石（低矮路边石）
  const curbGeoH = new THREE.BoxGeometry(halfX * 2.2, 0.12, 0.35);
  const curbGeoV = new THREE.BoxGeometry(0.35, 0.12, halfZ * 2.2);
  for (const sign of [-1, 1]) {
    const curbH = new THREE.Mesh(curbGeoH, curb);
    curbH.position.set(0, 0.06, sign * (ROAD_W / 2 + 0.18));
    group.add(curbH);

    const curbV = new THREE.Mesh(curbGeoV, curb);
    curbV.position.set(sign * (ROAD_W / 2 + 0.18), 0.06, 0);
    group.add(curbV);
  }
}

/** 地面绿化带与景观树木（科技风深绿低多边形）。 */
export function buildGreenery(ctx: GroundCtx): void {
  const { group, extent, shadows, rng, lawn, foliage, trunk } = ctx;
  const { halfX, halfZ } = extent;
  const treeGeo = ctx.cone;
  const trunkGeo = ctx.cylinder;

  const addTree = (x: number, z: number, scale = 1) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);

    const trunkMesh = new THREE.Mesh(trunkGeo, trunk);
    trunkMesh.scale.set(0.35 * scale, 1.4 * scale, 0.35 * scale);
    trunkMesh.position.y = 0.7 * scale;
    trunkMesh.castShadow = shadows;
    g.add(trunkMesh);

    const crown1 = new THREE.Mesh(treeGeo, foliage);
    crown1.scale.set(1.4 * scale, 2.2 * scale, 1.4 * scale);
    crown1.position.y = 2.0 * scale;
    crown1.castShadow = shadows;
    g.add(crown1);

    const crown2 = new THREE.Mesh(treeGeo, foliage);
    crown2.scale.set(1.0 * scale, 1.8 * scale, 1.0 * scale);
    crown2.position.y = 3.0 * scale;
    crown2.castShadow = shadows;
    g.add(crown2);

    group.add(g);
  };

  // 园区绿化草坪地块（铺于道路外侧与地块周边）
  const lawnPositions = [
    { x: -halfX * 0.48, z: -halfZ * 0.48, w: halfX * 0.72, d: halfZ * 0.68 },
    { x: halfX * 0.48, z: -halfZ * 0.48, w: halfX * 0.72, d: halfZ * 0.68 },
    { x: -halfX * 0.48, z: halfZ * 0.48, w: halfX * 0.72, d: halfZ * 0.68 },
    { x: halfX * 0.48, z: halfZ * 0.48, w: halfX * 0.72, d: halfZ * 0.68 },
  ];

  for (const lp of lawnPositions) {
    const lawnMesh = new THREE.Mesh(new THREE.PlaneGeometry(lp.w, lp.d), lawn);
    lawnMesh.rotation.x = -Math.PI / 2;
    lawnMesh.position.set(lp.x, 0.02, lp.z);
    lawnMesh.receiveShadow = shadows;
    group.add(lawnMesh);
  }

  // 沿主干道路缘与草坪边缘种植行道树
  const treeCoords = [
    [-12, -26], [-12, -42], [-12, -58], [12, -26], [12, -42], [12, -58],
    [-12, 26], [-12, 42], [-12, 58], [12, 26], [12, 42], [12, 58],
    [-28, -12], [-48, -12], [-68, -12], [-28, 12], [-48, 12], [-68, 12],
    [28, -12], [48, -12], [68, -12], [28, 12], [48, 12], [68, 12],
  ];

  for (const [tx, tz] of treeCoords) {
    if (Math.abs(tx) < halfX && Math.abs(tz) < halfZ) {
      addTree(tx, tz, 0.9 + rng() * 0.35);
    }
  }
}
