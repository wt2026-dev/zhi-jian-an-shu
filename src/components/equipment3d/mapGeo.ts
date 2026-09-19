// 大屏地图共享几何工具（全国层 / 城市层共用）。
// 风格基调与 equipment3d/scene.ts standard 预设一致：深色科技蓝（sky 0x0b1220）。
import * as THREE from "three";

export const MAP_BG = 0x0b1220;

/** 等距圆柱投影：lng/lat → 地面平面坐标（x 东，-z 北，等距俯视） */
export function projectLngLat(lng: number, lat: number, center: [number, number] = [104, 37], scale = 1): [number, number] {
  return [(lng - center[0]) * scale, -(lat - center[1]) * scale];
}

/** 边界环 → LineSegments（闭合折线段对） */
export function buildBorderLines(
  rings: [number, number][][],
  opts: { color: number; opacity: number; center?: [number, number]; scale?: number }
): THREE.LineSegments {
  const positions: number[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, z1] = projectLngLat(ring[i][0], ring[i][1], opts.center, opts.scale);
      const [x2, z2] = projectLngLat(ring[i + 1][0], ring[i + 1][1], opts.center, opts.scale);
      positions.push(x1, 0.01, z1, x2, 0.01, z2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color: opts.color, transparent: true, opacity: opts.opacity, toneMapped: false });
  return new THREE.LineSegments(geo, mat);
}

/** 填充环 → 立体台地（ExtrudeGeometry 挤出厚度，侧壁深色，形成地形起伏感） */
export function buildFillMesh(
  rings: [number, number][][],
  opts: { color: number; opacity: number; center?: [number, number]; scale?: number; depth?: number }
): THREE.Group {
  const group = new THREE.Group();
  const depth = opts.depth ?? 0.5;
  const topMat = new THREE.MeshBasicMaterial({ color: opts.color, transparent: true, opacity: opts.opacity, side: THREE.DoubleSide, depthWrite: true, toneMapped: false });
  const sideMat = new THREE.MeshBasicMaterial({ color: 0x091728, transparent: true, opacity: 0.95, toneMapped: false });
  for (const ring of rings) {
    const shape = new THREE.Shape();
    ring.forEach(([lng, lat], i) => {
      const [x, z] = projectLngLat(lng, lat, opts.center, opts.scale);
      // 平面内 y 取 -z（Shape 在 XY 平面构建，随后绕 X 轴 -90° 旋转落回 XZ 地面）
      if (i === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    });
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    const mesh = new THREE.Mesh(geo, [topMat, sideMat]);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0;
    group.add(mesh);
  }
  return group;
}

/** 画布文字精灵（工厂标签 / 建筑标签），可选状态色点 */
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
  // 底板
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

/** 径向渐变辉光贴图（光柱底座光晕 / 精致发光效果共用） */
export function makeGlowTexture(inner = "rgba(103,232,249,0.85)", outer = "rgba(34,211,238,0)"): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.45, "rgba(56,189,248,0.35)");
  grad.addColorStop(1, outer);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 移动光点流（人车流动画：地图区域内匀速巡游的发光小点） */
export interface FlowDots {
  group: THREE.Group;
  update: (dt: number) => void;
  dispose: () => void;
}

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

export interface LightPillar {
  group: THREE.Group;
  hitMesh: THREE.Mesh;
  update: (elapsed: number) => void;
  setHovered: (hovered: boolean) => void;
  dispose: () => void;
}

/**
 * 厂区光柱：蓝紫渐变尖峰（顶紫 #a855f7 → 底青蓝 #38bdf8，toneMapped:false）
 * + 顶部发光球（缓慢旋转）+ 底座光环；2s 呼吸脉冲（scale 1.0→1.15→1.0）。
 */
export function createLightPillar(opts: { height: number; radius: number; accent?: number }): LightPillar {
  const { height, radius } = opts;
  const accent = opts.accent ?? 0x67e8f9;
  const group = new THREE.Group();

  const geo = new THREE.CylinderGeometry(radius * 0.12, radius, height, 10, 1, true);
  const pos = geo.attributes.position;
  const colors: number[] = [];
  const bottom = new THREE.Color(0x38bdf8);
  const top = new THREE.Color(0xa855f7);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + height / 2) / height; // 0 底 → 1 顶
    tmp.copy(bottom).lerp(top, t);
    colors.push(tmp.r, tmp.g, tmp.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const pillarMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const pillar = new THREE.Mesh(geo, pillarMat);
  pillar.position.y = height / 2;
  group.add(pillar);

  // 顶部发光球（核心 + 光晕，缓慢旋转由材质偏移模拟，这里整体自转）
  const orbGeo = new THREE.SphereGeometry(radius * 0.85, 16, 12);
  const orbMat = new THREE.MeshBasicMaterial({ color: accent, toneMapped: false, transparent: true, opacity: 0.95 });
  const orb = new THREE.Mesh(orbGeo, orbMat);
  orb.position.y = height + radius * 0.6;
  const haloGeo = new THREE.SphereGeometry(radius * 1.7, 16, 12);
  const haloMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, toneMapped: false, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.copy(orb.position);
  group.add(orb, halo);

  // 底座光环
  const ringGeo = new THREE.RingGeometry(radius * 1.1, radius * 2.2, 40);
  const ringMat = new THREE.MeshBasicMaterial({ color: accent, toneMapped: false, transparent: true, opacity: 0.4, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const baseRing = new THREE.Mesh(ringGeo, ringMat);
  baseRing.rotation.x = -Math.PI / 2;
  baseRing.position.y = 0.02;
  group.add(baseRing);

  // 底座辉光贴片（径向渐变 sprite，精致发光效果）
  const glowTex = makeGlowTexture();
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.set(radius * 7, radius * 7, 1);
  glow.position.y = 0.35;
  group.add(glow);

  // 拾取用透明柱（比可见柱粗，hover 命中稳定）。
  // 注意：不用 visible:false —— 部分 three 版本拾取会跳过不可见对象；
  // colorWrite:false 同样零渲染但 100% 参与 raycast。
  const hitGeo = new THREE.CylinderGeometry(radius * 2.4, radius * 2.4, height + radius * 2, 8);
  const hitMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const hitMesh = new THREE.Mesh(hitGeo, hitMat);
  hitMesh.position.y = (height + radius * 2) / 2;
  group.add(hitMesh);

  const setHovered = (hovered: boolean) => {
    pillarMat.opacity = hovered ? 1.0 : 0.85;
    haloMat.opacity = hovered ? 0.5 : 0.28;
    baseRing.scale.setScalar(hovered ? 1.25 : 1);
  };

  const update = (elapsed: number) => {
    // 2s 呼吸脉冲
    const breathe = 1 + 0.075 * (1 - Math.cos((elapsed * Math.PI * 2) / 2));
    pillar.scale.set(breathe, 1, breathe);
    halo.scale.setScalar(1 + 0.12 * (1 - Math.cos((elapsed * Math.PI * 2) / 2)));
    orb.rotation.y = elapsed * 0.6;
    baseRing.rotation.z = elapsed * 0.3;
  };

  const dispose = () => {
    geo.dispose();
    pillarMat.dispose();
    orbGeo.dispose();
    orbMat.dispose();
    haloGeo.dispose();
    haloMat.dispose();
    ringGeo.dispose();
    ringMat.dispose();
    hitGeo.dispose();
    hitMat.dispose();
  };

  return { group, hitMesh, update, setHovered, dispose };
}

/** 深色网格地面（与 scene.ts 深色风格统一） */
export function buildMapGround(size: number): THREE.GridHelper {
  const grid = new THREE.GridHelper(size, Math.round(size / 4), 0x1e3a5f, 0x142741);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.35;
  return grid;
}

export interface DampedOrbit {
  /** 期望视角（写入后 update() 指数阻尼收敛 → 俯冲/拉远过渡） */
  target: { theta: number; phi: number; radius: number; tx: number; ty: number; tz: number };
  current: { theta: number; phi: number; radius: number };
  update: (dt: number) => void;
  dispose: () => void;
}

/**
 * 指数阻尼轨道相机（与 scene.ts update() 的 k = 1-exp(-dt*k) 同一数学形式）。
 * 新层挂载时把 current 抬到高空、target 设为取景值，即得到“俯冲拉近”开场。
 */
export function createDampedOrbit(
  camera: THREE.PerspectiveCamera,
  dom: HTMLElement,
  initial: { theta: number; phi: number; radius: number; targetY?: number; damping?: number; enableDrag?: boolean; minRadius?: number; maxRadius?: number }
): DampedOrbit {
  const target = { theta: initial.theta, phi: initial.phi, radius: initial.radius, tx: 0, ty: initial.targetY ?? 0, tz: 0 };
  const current = { theta: initial.theta, phi: initial.phi, radius: initial.radius };
  const damping = initial.damping ?? 2.2;
  const minRadius = initial.minRadius ?? 8;
  const maxRadius = initial.maxRadius ?? 160;
  const dom2 = dom as any;
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    target.radius = Math.min(maxRadius, Math.max(minRadius, target.radius * (e.deltaY > 0 ? 1.08 : 0.92)));
  };
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging || initial.enableDrag === false) return;
    target.theta -= (e.clientX - lastX) * 0.005;
    target.phi = Math.min(1.35, Math.max(0.15, target.phi - (e.clientY - lastY) * 0.004));
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onUp = () => {
    dragging = false;
  };
  dom.addEventListener("wheel", onWheel, { passive: false });
  dom.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  return {
    target,
    current,
    update: (dt: number) => {
      const k = 1 - Math.exp(-dt * damping);
      current.theta += (target.theta - current.theta) * k;
      current.phi += (target.phi - current.phi) * k;
      current.radius += (target.radius - current.radius) * k;
      camera.position.set(
        target.tx + current.radius * Math.sin(current.phi) * Math.sin(current.theta),
        target.ty + current.radius * Math.cos(current.phi),
        target.tz + current.radius * Math.sin(current.phi) * Math.cos(current.theta)
      );
      camera.lookAt(target.tx, target.ty, target.tz);
    },
    dispose: () => {
      dom.removeEventListener("wheel", onWheel);
      dom.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      void dom2;
    },
  };
}

/** 运行状态 → 色点颜色（与车间层状态色一致） */
export function statusDotColor(status: string): string {
  if (status === "running") return "#34d399";
  if (status === "fault") return "#f87171";
  if (status === "overhauling" || status === "maintenance") return "#fbbf24";
  return "#60a5fa";
}

export function statusLabel(status: string): string {
  if (status === "running") return "运行中";
  if (status === "fault") return "故障";
  if (status === "overhauling") return "检修中";
  if (status === "maintenance") return "维护中";
  if (status === "standby") return "备用";
  return status;
}
