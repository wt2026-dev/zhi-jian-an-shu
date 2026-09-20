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
  const view: CamState = { theta: 0, phi: opts.camera.lift.phi, radius: opts.camera.lift.radius, tx: 0, ty: 0, tz: 0 };
  const want: CamState = copy(view);
  want.phi = opts.camera.frame.phi;
  want.radius = opts.camera.frame.radius;
  const tween = {
    from: copy(view),
    to: { theta: 0, phi: opts.camera.frame.phi, radius: opts.camera.frame.radius, tx: 0, ty: 0, tz: 0 },
    start: performance.now(),
    duration: DIVE_MS,
    fadeOthers: false,
    onEnd: null as (() => void) | null,
    active: true,
  };
  let diveKey: string | null = null;

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
      return { spec, pillar, label, x, z };
    });
    hovered = null;
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
