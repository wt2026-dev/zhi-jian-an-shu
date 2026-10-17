// 地图层共用 three.js 舞台（全国层 / 城市层同一条代码路径 → 灯光、材质、后处理天然一致）。
// 职责：地形起伏 + 发光描边 + 状态光柱 + 文字标注 + 相机（阻尼取景 / 2s 俯冲下钻）+ bloom。
// React 侧只管真实数据与 HUD 面板，本文件不读任何接口。
import * as THREE from "three";
import { DIVE_MS, easeInOutCubic } from "./mapStyle";
import {
  addMapLights,
  buildGlowingBorder,
  buildMapGround,
  buildTerrainFill,
  createFlowDots,
  createLightPillar,
  createReliefField,
  makeMapLabel,
  makeSkyTexture,
  projectLngLat,
  type LightPillar,
  type ReliefField,
} from "./mapGeo";
import { createMapPostFx } from "./mapPostFx";

export interface MapMarkerSpec {
  key: string;
  lng: number;
  lat: number;
  status: string;
  height: number;
  radius: number;
  /** 光柱旁的名称标签（不传则只出光柱，hover 卡片承担详情） */
  label?: string;
  /** 标签副标题，如「设备 18 台 · 预警 15」 */
  sub?: string;
}

export interface MapLabelSpec {
  text: string;
  lng: number;
  lat: number;
  plant?: boolean;
}

export interface MapCameraSpec {
  /** 开场高空 */
  lift: { radius: number; phi: number };
  /** 落位取景 */
  frame: { radius: number; phi: number };
  minRadius: number;
  maxRadius: number;
  /** 俯冲下钻落点半径 */
  diveRadius: number;
}

export interface MapSceneOptions {
  host: HTMLElement;
  fillRings: [number, number][][];
  lineRings: [number, number][][];
  center: [number, number];
  scale: number;
  relief: { height: number; frequency?: number; segX?: number; segZ?: number };
  camera: MapCameraSpec;
  flowBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /**
   * 传入即启用"按内容包围盒自适应落位取景"：camera.frame.radius 被忽略，
   * 半径由 insets 圈出的 HUD 安全区反解出来（地图撑满两栏之间，不再留大片深蓝）。
   */
  frameFit?: {
    /** 浮层占位（像素）：地图只填剩下的中间区域 */
    insets: { left: number; right: number; top: number; bottom: number };
    /** 光柱顶之上还要再容纳的高度（柱顶名称标签），世界单位 */
    heightAbove: number;
    /** 目标占比，默认 0.9 */
    fill?: number;
  };
  onHover: (key: string | null, ndc: { x: number; y: number }) => void;
  onPick: (key: string) => void;
}

interface MarkerEntry {
  spec: MapMarkerSpec;
  pillar: LightPillar;
  label?: THREE.Sprite;
  x: number;
  z: number;
}

interface CamState {
  theta: number;
  phi: number;
  radius: number;
  tx: number;
  ty: number;
  tz: number;
}

export interface MapSceneHandle {
  setMarkers: (specs: MapMarkerSpec[]) => void;
  setLabels: (specs: MapLabelSpec[]) => void;
  /** 2s easeInOutCubic 俯冲到指定点位，其余光柱与标注淡出；onEnd 在过渡末尾触发 */
  diveTo: (key: string, onEnd: () => void) => void;
  isDiving: () => boolean;
  dispose: () => void;
}

const copy = (c: CamState): CamState => ({ ...c });

/* ==================== 落位取景：按内容包围盒反解相机半径 ==================== */

export interface FitPoint {
  x: number;
  y: number;
  z: number;
}

export interface FrameFitSpec {
  /** 需要落在 HUD 安全区内的世界坐标点（轮廓角点 + 光柱顶） */
  points: FitPoint[];
  /** 落位极角（弧度），与 camera.frame.phi 同一个值 */
  phi: number;
  /** 垂直视场角（度） */
  fovDeg: number;
  /** 画布像素尺寸 */
  width: number;
  height: number;
  /** 浮层占位（像素）：地图要填的是剩下的中间矩形 */
  insets: { left: number; right: number; top: number; bottom: number };
  /** 目标占比（安全区的 92%），默认 0.92 */
  fill?: number;
}

/**
 * 反解"地图正好填满两栏之间安全区"的相机半径。
 *
 * 为什么不用包围球：省界是宽而扁的形状，球半径由最长的那条对角线决定，
 * 按它取景会把地图缩到安全区的一半 —— 正是原来上下左右一大片深蓝空白的成因。
 * 这里直接投影每个关键点：相机在 (0, R·cosφ, R·sinφ) 看向原点时，
 * 点的屏幕偏移与 R 无关、深度随 R 线性增长，所以"最挤的点占比"对 R 单调递减，
 * 二分即可收敛。DOM-free、确定性，可单测。
 */
export function fitFrameRadius(s: FrameFitSpec): number {
  const fill = Math.min(0.98, Math.max(0.35, s.fill ?? 0.9));
  const safeW = Math.max(80, s.width - s.insets.left - s.insets.right);
  const safeH = Math.max(80, s.height - s.insets.top - s.insets.bottom);
  const tanV = Math.tan((s.fovDeg * Math.PI) / 360);
  const tanH = tanV * (s.width / s.height);
  // 关键点允许落到画布 NDC 的哪条边上（安全区占画布的比例 × 目标占比）
  const limitX = (safeW / s.width) * fill;
  const limitY = (safeH / s.height) * fill;
  const sinP = Math.sin(s.phi);
  const cosP = Math.cos(s.phi);

  const worst = (r: number) => {
    let m = 0;
    for (const p of s.points) {
      const depth = r - p.y * cosP - p.z * sinP;
      if (depth <= 0.2) return Number.POSITIVE_INFINITY;
      m = Math.max(
        m,
        Math.abs(p.x) / (depth * tanH * limitX),
        Math.abs(p.y * sinP - p.z * cosP) / (depth * tanV * limitY)
      );
    }
    return m;
  };

  let lo = 0.5;
  let hi = 4;
  while (worst(hi) > 1 && hi < 20000) {
    lo = hi;
    hi *= 2;
  }
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (worst(mid) > 1) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * 取景关键点：轮廓包围盒的 8 个角（含地表厚度）+ 每根光柱的柱顶（含标签余量）。
 *
 * 为什么柱顶不跟着包围盒一起算：省界包围盒的角大多落在海里或邻省，
 * 而厂区集中在城市一带 —— 把"最远那个角上也立着一根最高光柱"当成约束，
 * 等于凭空为不存在的柱子留出半个屏幕，地图就被相机顶远了。
 */
export function buildFitPoints(
  box: { halfX: number; halfZ: number; groundTop: number },
  content: { x: number; z: number; top: number }[],
  labelAbove: number
): FitPoint[] {
  const pts: FitPoint[] = [];
  for (const x of [-box.halfX, box.halfX]) {
    for (const z of [-box.halfZ, box.halfZ]) {
      pts.push({ x, y: 0, z }, { x, y: box.groundTop, z });
    }
  }
  for (const c of content) pts.push({ x: c.x, y: c.top + labelAbove, z: c.z });
  return pts;
}

/**
 * 由 relief 包围盒 + 当前光柱反解落位取景（半径 + 注视点）。
 *
 * 注视点取陆面包围盒中心而不是世界原点：投影中心与轮廓中心本来就常常差半个身位
 * （全国层 z 向偏 2.4、省层偏 1.3），按原点取景等于承认这块地图是歪的，
 * 相机只能拉远把偏移一起装进画面 —— 换到中心就省出这一圈空白。
 */
function autoFrame(
  fit: NonNullable<MapSceneOptions["frameFit"]>,
  bbox: { minX: number; maxX: number; minZ: number; maxZ: number },
  reliefHeight: number,
  content: { x: number; z: number; top: number }[],
  width: number,
  height: number,
  phi: number,
  fovDeg: number
): { radius: number; tx: number; tz: number } {
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cz = (bbox.minZ + bbox.maxZ) / 2;
  // 光柱顶点同样换算到注视点坐标系（fitFrameRadius 假设相机看向原点）
  const shifted = content.map((c) => ({ x: c.x - cx, z: c.z - cz, top: c.top }));
  return {
    // buildTerrainFill 的 pad=1：地形面比轮廓四周各宽 1 个世界单位，一起算进去
    radius: fitFrameRadius({
      points: buildFitPoints(
        { halfX: (bbox.maxX - bbox.minX) / 2 + 1, halfZ: (bbox.maxZ - bbox.minZ) / 2 + 1, groundTop: reliefHeight },
        shifted,
        fit.heightAbove
      ),
      phi,
      fovDeg,
      width,
      height,
      insets: fit.insets,
      fill: fit.fill,
    }),
    tx: cx,
    tz: cz,
  };
}

export function createMapScene(opts: MapSceneOptions): MapSceneHandle {
  const { host, center, scale } = opts;
  const w0 = host.clientWidth || 900;
  const h0 = host.clientHeight || 600;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w0, h0);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const sky = makeSkyTexture();
  scene.background = sky;
  scene.fog = new THREE.FogExp2(0x0c1a30, 0.0068);
  const camera = new THREE.PerspectiveCamera(55, w0 / h0, 0.1, 620);

  const lights = addMapLights(scene);
  const ground = buildMapGround(170);
  scene.add(ground);

  const reliefOpts = { center, scale, relief: opts.relief.height, frequency: opts.relief.frequency };
  const terrain = buildTerrainFill(opts.fillRings, { ...reliefOpts, segX: opts.relief.segX, segZ: opts.relief.segZ });
  const relief: ReliefField = createReliefField(opts.fillRings, reliefOpts);
  const border = buildGlowingBorder(opts.lineRings, { center, scale, relief });
  scene.add(terrain.group, border);

  const flow = createFlowDots(12, opts.flowBounds);
  scene.add(flow.group);

  // 光柱、厂区标签、地理标签分组管理：下钻淡出与重建互不牵连
  const markerGroup = new THREE.Group();
  const markerLabelGroup = new THREE.Group();
  const geoLabelGroup = new THREE.Group();
  scene.add(markerGroup, markerLabelGroup, geoLabelGroup);

  /* ---- 相机状态：阻尼取景 + 脚本化俯冲共用一份 view ---- */
  /**
   * 落位半径：传了 frameFit 就按"轮廓包围盒 + 光柱顶 + HUD 安全区"反解（地图撑满两栏之间），
   * 没传则沿用调用方写死的 camera.frame.radius。窗口尺寸或光柱变化时重算（见 onResize / setMarkers）。
   */
  /** 光柱顶点（世界坐标），由 setMarkers 刷新；空数组表示点位还没到 */
  let fitContent: { x: number; z: number; top: number }[] = [];
  const clampFrame = (r: number) => Math.min(opts.camera.maxRadius, Math.max(opts.camera.minRadius, r));
  /** 落位取景：反解不出（没传 frameFit / 画布还没尺寸）时退回调用方写死的 frame 参数 */
  const frameFitNow = () => {
    const fit = opts.frameFit;
    const w = host.clientWidth || w0;
    const h = host.clientHeight || h0;
    if (!fit || w <= 0 || h <= 0) return { radius: opts.camera.frame.radius, tx: 0, tz: 0 };
    const a = autoFrame(fit, relief.bbox, opts.relief.height, fitContent, w, h, opts.camera.frame.phi, camera.fov);
    return { radius: clampFrame(a.radius), tx: a.tx, tz: a.tz };
  };
  /** 自动取景：把 want（以及未开始的落位动画目标）拉到反解出来的读数 */
  const refitFrame = () => {
    if (!opts.frameFit || userAdjusted) return;
    const f = frameFitNow();
    want.radius = f.radius;
    want.tx = f.tx;
    want.tz = f.tz;
    if (tween.active && !tween.fadeOthers) {
      tween.to.radius = f.radius;
      tween.to.tx = f.tx;
      tween.to.tz = f.tz;
    }
  };
  const view: CamState = { theta: 0, phi: opts.camera.lift.phi, radius: opts.camera.lift.radius, tx: 0, ty: 0, tz: 0 };
  const firstFrame = frameFitNow();
  const want: CamState = copy(view);
  want.phi = opts.camera.frame.phi;
  want.radius = firstFrame.radius;
  want.tx = firstFrame.tx;
  want.tz = firstFrame.tz;
  const tween = {
    from: copy(view),
    to: { theta: 0, phi: opts.camera.frame.phi, radius: want.radius, tx: want.tx, ty: 0, tz: want.tz },
    start: performance.now(),
    duration: DIVE_MS,
    fadeOthers: false,
    onEnd: null as (() => void) | null,
    active: true,
  };
  let diveKey: string | null = null;
  /** 用户滚过滚轮 / 拖过视角后不再自动重取景，避免把人家的手动调整顶掉 */
  let userAdjusted = false;

  const applyCamera = () => {
    const sp = Math.sin(view.phi);
    camera.position.set(
      view.tx + view.radius * sp * Math.sin(view.theta),
      view.ty + view.radius * Math.cos(view.phi),
      view.tz + view.radius * sp * Math.cos(view.theta)
    );
    camera.lookAt(view.tx, view.ty, view.tz);
  };

  const dom = renderer.domElement;
  const onWheel = (e: WheelEvent) => {
    if (tween.active) return;
    e.preventDefault();
    userAdjusted = true;
    want.radius = Math.min(opts.camera.maxRadius, Math.max(opts.camera.minRadius, want.radius * (e.deltaY > 0 ? 1.08 : 0.92)));
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
  const onDragMove = (e: PointerEvent) => {
    if (!dragging || tween.active) return;
    // 转视角后 phi 不再是落位角，自动取景的投影假设失效 —— 交还给用户
    userAdjusted = true;
    want.theta -= (e.clientX - lastX) * 0.005;
    want.phi = Math.min(1.3, Math.max(0.18, want.phi - (e.clientY - lastY) * 0.004));
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onUp = () => {
    dragging = false;
  };
  dom.addEventListener("wheel", onWheel, { passive: false });
  dom.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", onUp);

  /* ---- hover / pick ---- */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerDirty = false;
  let downAt = 0;
  let downXY = [0, 0];
  let markers: MarkerEntry[] = [];
  let hovered: MarkerEntry | null = null;
  const onPointerMove = (e: PointerEvent) => {
    const rect = dom.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    pointerDirty = true;
  };
  const onPointerDown = (e: PointerEvent) => {
    downAt = performance.now();
    downXY = [e.clientX, e.clientY];
  };
  const onPointerUp = (e: PointerEvent) => {
    const dx = e.clientX - downXY[0];
    const dy = e.clientY - downXY[1];
    const tapped = performance.now() - downAt < 600 && dx * dx + dy * dy < 36;
    if (tapped && hovered && !tween.active) opts.onPick(hovered.spec.key);
  };
  dom.addEventListener("pointermove", onPointerMove);
  dom.addEventListener("pointerdown", onPointerDown);
  dom.addEventListener("pointerup", onPointerUp);

  const clearSprites = (group: THREE.Group) => {
    for (const child of [...group.children]) {
      group.remove(child);
      const sprite = child as THREE.Sprite;
      sprite.material?.map?.dispose?.();
      sprite.material?.dispose?.();
    }
  };

  const setMarkers = (specs: MapMarkerSpec[]) => {
    for (const m of markers) {
      markerGroup.remove(m.pillar.group);
      m.pillar.dispose();
    }
    clearSprites(markerLabelGroup);
    fitContent = [];
    markers = specs.map((spec) => {
      const [x, z] = projectLngLat(spec.lng, spec.lat, center, scale);
      const groundY = relief.heightAt(x, z);
      const pillar = createLightPillar({
        height: spec.height,
        radius: spec.radius,
        status: spec.status,
        seedPhase: (x * 0.37 + z * 0.61) % 2.6,
      });
      pillar.group.position.set(x, groundY + 0.02, z);
      markerGroup.add(pillar.group);
      let label: THREE.Sprite | undefined;
      if (spec.label) {
        label = makeMapLabel(spec.label, { plant: true, sub: spec.sub, size: 34 });
        label.position.set(x, groundY + spec.height + spec.radius * 1.4, z);
        markerLabelGroup.add(label);
      }
      // 柱顶（有标签时按标签锚点）计入取景约束，光柱多的城市不会被顶出安全区
      fitContent.push({ x, z, top: groundY + spec.height + (spec.label ? spec.radius * 1.4 : 0) });
      return { spec, pillar, label, x, z };
    });
    hovered = null;
    refitFrame();
  };

  /** 地理标注（主要城市名）：与光柱标签分开管理，重建时不牵连厂区 */
  const setLabels = (specs: MapLabelSpec[]) => {
    clearSprites(geoLabelGroup);
    for (const spec of specs) {
      const [x, z] = projectLngLat(spec.lng, spec.lat, center, scale);
      const sprite = makeMapLabel(spec.text, { plant: spec.plant, size: spec.plant ? 40 : 36 });
      sprite.position.set(x, relief.heightAt(x, z) + 1.2, z);
      geoLabelGroup.add(sprite);
    }
  };

  const diveTo = (key: string, onEnd: () => void) => {
    const target = markers.find((m) => m.spec.key === key);
    if (!target) {
      onEnd();
      return;
    }
    diveKey = key;
    tween.from = copy(view);
    tween.to = {
      theta: view.theta,
      phi: 0.24,
      radius: opts.camera.diveRadius,
      tx: target.x,
      ty: relief.heightAt(target.x, target.z),
      tz: target.z,
    };
    tween.start = performance.now();
    tween.duration = DIVE_MS;
    tween.fadeOthers = true;
    tween.onEnd = onEnd;
    tween.active = true;
    hovered?.pillar.setHovered(false);
    hovered = null;
    opts.onHover(null, { x: 0, y: 0 });
  };

  let raf = 0;
  let disposed = false;
  const clock = new THREE.Clock();
  const postFx = createMapPostFx(renderer, scene, camera, { width: w0, height: h0 });

  const tick = () => {
    if (disposed) return;
    const dt = Math.min(clock.getDelta(), 0.1);
    const elapsed = clock.elapsedTime;

    if (tween.active) {
      const t = Math.min(1, (performance.now() - tween.start) / tween.duration);
      const e = easeInOutCubic(t);
      const mix = (a: number, b: number) => a + (b - a) * e;
      view.theta = mix(tween.from.theta, tween.to.theta);
      view.phi = mix(tween.from.phi, tween.to.phi);
      view.radius = mix(tween.from.radius, tween.to.radius);
      view.tx = mix(tween.from.tx, tween.to.tx);
      view.ty = mix(tween.from.ty, tween.to.ty);
      view.tz = mix(tween.from.tz, tween.to.tz);
      if (tween.fadeOthers) {
        for (const m of markers) {
          const alpha = m.spec.key === diveKey ? 1 : 1 - 0.92 * e;
          m.pillar.setFade(alpha);
          if (m.label) m.label.material.opacity = alpha;
        }
        for (const child of geoLabelGroup.children) (child as THREE.Sprite).material.opacity = 1 - 0.9 * e;
        (ground.material as THREE.Material).opacity = 0.28 * (1 - 0.8 * e);
        terrain.group.scale.setScalar(1 + 0.08 * e);
        border.scale.setScalar(1 + 0.08 * e);
        flow.group.visible = e < 0.85;
      }
      if (t >= 1) {
        tween.active = false;
        want.theta = view.theta;
        want.phi = view.phi;
        want.radius = view.radius;
        want.tx = view.tx;
        want.ty = view.ty;
        want.tz = view.tz;
        const done = tween.onEnd;
        tween.onEnd = null;
        done?.();
      }
    } else {
      const k = 1 - Math.exp(-dt * 2.1);
      view.theta += (want.theta - view.theta) * k;
      view.phi += (want.phi - view.phi) * k;
      view.radius += (want.radius - view.radius) * k;
      view.tx += (want.tx - view.tx) * k;
      view.ty += (want.ty - view.ty) * k;
      view.tz += (want.tz - view.tz) * k;
    }
    applyCamera();

    for (const m of markers) m.pillar.update(elapsed);
    flow.update(dt);

    if (pointerDirty && !tween.active) {
      pointerDirty = false;
      raycaster.setFromCamera(pointer, camera);
      const hitMeshes = markers.map((m) => m.pillar.hitMesh);
      const hit = hitMeshes.length ? raycaster.intersectObjects(hitMeshes, false)[0]?.object : undefined;
      const entry = hit ? markers.find((m) => m.pillar.hitMesh === hit) ?? null : null;
      if (entry !== hovered) {
        hovered?.pillar.setHovered(false);
        hovered = entry;
        if (entry) {
          entry.pillar.setHovered(true);
          opts.onHover(entry.spec.key, { x: pointer.x, y: pointer.y });
        } else {
          opts.onHover(null, { x: pointer.x, y: pointer.y });
        }
      } else if (entry) {
        opts.onHover(entry.spec.key, { x: pointer.x, y: pointer.y });
      }
    }

    postFx.render();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const onResize = () => {
    if (!host.clientWidth || !host.clientHeight) return;
    camera.aspect = host.clientWidth / host.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(host.clientWidth, host.clientHeight);
    postFx.setSize(host.clientWidth, host.clientHeight);
    // 安全区随窗口变了，落位半径要跟着重算（入场动画途中也改目标值）
    refitFrame();
  };
  const ro = new ResizeObserver(onResize);
  ro.observe(host);

  const disposeLines = (root: THREE.Object3D) => {
    root.traverse((o) => {
      const line = o as THREE.LineSegments;
      line.geometry?.dispose?.();
      const mat = line.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose?.();
    });
  };

  return {
    setMarkers,
    setLabels,
    diveTo,
    isDiving: () => tween.active,
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      dom.removeEventListener("wheel", onWheel);
      dom.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onDragMove);
      window.removeEventListener("pointerup", onUp);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointerup", onPointerUp);
      for (const m of markers) m.pillar.dispose();
      markers = [];
      clearSprites(markerLabelGroup);
      clearSprites(geoLabelGroup);
      flow.dispose();
      terrain.dispose();
      relief.dispose();
      disposeLines(border);
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      lights.dispose();
      postFx.dispose();
      scene.background = null;
      sky.dispose();
      renderer.dispose();
      host.querySelectorAll("canvas").forEach((c) => c.remove());
    },
  };
}
