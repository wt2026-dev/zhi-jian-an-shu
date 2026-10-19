import React, { useRef, useEffect, useCallback, useState } from 'react';
import * as THREE from 'three';

/* ─── 颜色常量：明亮钛晶全息（Titanium Hologram · Solar-Punk Precision） ─── */
const C = {
  // 空间底色与工业漫射天光
  sky: 0xf3f6fa,
  fog: 0xe6edf5,
  ground: 0xe8eef5,
  gridLine: 0xb8c9dc,
  gridSub: 0xd6e2ee,

  // 工业建筑与车间结构（高质感钛白、精密航空合金、石板蓝）
  building: 0xffffff,
  buildingLight: 0xf1f5f9,
  buildingAccent: 0xe2e8f0,
  buildingEdge: 0x94a3b8,
  roof: 0x475569,
  tank: 0xdae4ef,
  tankRing: 0x94a3b8,
  pipe: 0x94a3b8,

  // 科技流光与指示发光体（高饱和霓虹在白底上形成清晰聚焦）
  accent: 0x0284c7,       // 天青科技蓝
  accentGlow: 0x00b4d8,   // 电光天青
  warm: 0xf59e0b,         // 晨曦金/琥珀工艺流
  hot: 0xef4444,          // 告警能量红
  cool: 0x06b6d4,         // 冷却介质
  emissive: 0x0284c7,     // 探针发光体
};

/* ─── 工厂布局数据 ─── */
interface BuildingDef {
  x: number; z: number; w: number; h: number; d: number;
  color?: number; roof?: boolean; chimney?: boolean;
}
interface TankDef { x: number; z: number; r: number; h: number; }
interface PipeNode { x: number; z: number; }
interface PipeRoute { points: PipeNode[]; color: number; speed: number; }

const BUILDINGS: BuildingDef[] = [
  { x: -6, z: -3, w: 5, h: 3.5, d: 4, chimney: true },
  { x: 2, z: -4, w: 4, h: 2.8, d: 3.5, color: C.buildingLight },
  { x: -3, z: 4, w: 6, h: 2.2, d: 3, roof: true },
  { x: 5, z: 2, w: 3.5, h: 4, d: 3, chimney: true, color: C.buildingLight },
  { x: -8, z: 3, w: 3, h: 2, d: 2.5 },
  { x: 8, z: -2, w: 2.5, h: 3, d: 2 },
  { x: 0, z: 0, w: 3, h: 1.8, d: 2.5, color: C.buildingAccent },
  { x: -1, z: -6, w: 4, h: 2.5, d: 3, roof: true, color: 0x64748b },
  { x: 6, z: -5, w: 3, h: 2, d: 2.5 },
  { x: -6, z: -7, w: 3.5, h: 1.8, d: 2 },
];

const TANKS: TankDef[] = [
  { x: -9, z: -1, r: 1.2, h: 3 },
  { x: -9, z: 1.5, r: 1, h: 2.5 },
  { x: 9, z: 1, r: 1.1, h: 2.8 },
  { x: 3, z: 5, r: 1.5, h: 3.5 },
  { x: -4, z: -5.5, r: 0.8, h: 2 },
];

const PIPE_ROUTES: PipeRoute[] = [
  { points: [{ x: -6, z: -1 }, { x: -3, z: -1 }, { x: 0, z: 0 }], color: C.warm, speed: 1.2 },
  { points: [{ x: 2, z: -2.5 }, { x: 2, z: 0 }, { x: 5, z: 2 }], color: C.cool, speed: 0.8 },
  { points: [{ x: 0, z: 0 }, { x: 3, z: 3 }, { x: 5, z: 2 }], color: C.accent, speed: 1.5 },
  { points: [{ x: -3, z: 4 }, { x: 0, z: 4 }, { x: 3, z: 5 }], color: C.warm, speed: 1.0 },
  { points: [{ x: -8, z: 3 }, { x: -6, z: 3 }, { x: -3, z: 4 }], color: C.cool, speed: 0.6 },
];

export interface Anchor3D {
  id: string;
  worldPos: [number, number, number];
  label: string;
  /** 沙盘选中态：锚点外圈显示青色描边环（仅影响孪生页锚点，不动主场景） */
  selected?: boolean;
}

/** 厂房顶部悬浮数据立牌（名称 / 设备数 / 健康分来自真实台账，缺测显示 "—"） */
export interface TwinDataSign {
  name: string;
  deviceCount: number | null;
  healthScore: number | null;
}

/* ─── 加法细节：Canvas 贴图工具（SSR / 单测无 document 时返回 null，调用方跳过） ─── */

function makeDotTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const S = 64;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(34,211,238,1)');
  g.addColorStop(0.45, 'rgba(34,211,238,0.9)');
  g.addColorStop(0.7, 'rgba(34,211,238,0.25)');
  g.addColorStop(1, 'rgba(34,211,238,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRingTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const S = 64;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.strokeStyle = 'rgba(34,211,238,0.95)';
  ctx.lineWidth = 5;
  ctx.shadowColor = 'rgba(34,211,238,0.8)';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 8, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 车道线贴花：透明底 + 白色虚线中线 + 两侧细边线（沿 U 重复）。 */
function makeLaneTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const W = 128;
  const H = 64;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(100,116,139,0.30)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(0, 2, W, 3);
  ctx.fillRect(0, H - 5, W, 3);
  ctx.fillStyle = 'rgba(226,232,240,0.95)';
  for (let i = 0; i < 2; i++) ctx.fillRect(i * 64 + 12, H / 2 - 2, 40, 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** 厂区出入口标识（浅色卡片风格，与明亮沙盘同语言）。 */
function makeGateTexture(text: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const W = 128;
  const H = 64;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = 'rgba(2,132,199,0.85)';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 4;
  ctx.strokeRect(3, 3, W - 6, H - 6);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 28px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 数据立牌：厂房名 + 设备数 + 健康分（缺测显示 "—"，绝不编数据）。 */
function makeSignTexture(name: string, deviceCount: number | null, healthScore: number | null): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const W = 256;
  const H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(2,132,199,0.8)';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, W - 4, H - 4);
  const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 26px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.fillText(clip(name, 8), W / 2, 40);
  ctx.fillStyle = '#0284c7';
  ctx.font = '600 22px "Microsoft YaHei", sans-serif';
  ctx.fillText(`设备 ${deviceCount ?? '—'} 台`, W / 2, 76);
  ctx.fillStyle = '#475569';
  ctx.fillText(`健康分 ${healthScore ?? '未评估'}`, W / 2, 106);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 立牌落位：取既有 BUILDINGS 中体量最大的三栋（0# 主厂房 / 2# 大跨 / 3# 高炉车间），纯加法不改布局 */
const SIGN_BUILDING_IDX = [0, 2, 3];

interface TwinScene3DProps {
  anchors?: Anchor3D[];
  onAnchorProject?: (screen: { x: number; y: number; visible: boolean }[]) => void;
  /** 厂房顶部数据立牌（≤3 块，落位在既有主厂房上，不移动任何现有建筑） */
  dataSigns?: TwinDataSign[];
  className?: string;
}

const EMPTY_ANCHORS: Anchor3D[] = [];
const EMPTY_SIGNS: TwinDataSign[] = [];

export const TwinScene3D: React.FC<TwinScene3DProps> = ({ anchors = EMPTY_ANCHORS, onAnchorProject, dataSigns = EMPTY_SIGNS, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const stateRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    clock: THREE.Clock;
    flowLines: THREE.Line[];
    flowParticles: THREE.Points[];
    anchorSprites: THREE.Sprite[];
    mouseDown: boolean;
    mouse: { x: number; y: number };
    rotY: number;
    rotX: number;
    targetRotY: number;
    targetRotX: number;
    distance: number;
    targetDistance: number;
    autoRotate: boolean;
    lastInteract: number;
    /* 加法细节：锚点描边环 / 数据立牌 / 悬停拾取 */
    anchorRings: Map<string, THREE.Sprite>;
    dataSignSprites: THREE.Sprite[];
    raycaster: THREE.Raycaster;
    pointer: THREE.Vector2;
    dotTex: THREE.CanvasTexture | null;
    ringTex: THREE.CanvasTexture | null;
  } | null>(null);

  /* ─── 初始化场景 ─── */
  const init = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const w = container.clientWidth;
    const h = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(C.sky);
    scene.fog = new THREE.FogExp2(C.fog, 0.015);

    // Camera
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 200);
    camera.position.set(18, 14, 18);
    camera.lookAt(0, 1, 0);

    // Renderer
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);
    canvasRef.current = canvas;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    // Lights
    // 1. 全局柔和漫射环境天光
    const ambient = new THREE.AmbientLight(0xf0f4f8, 0.85);
    scene.add(ambient);

    // 2. 主日光（形成柔和接触阴影，使浅色模型具有立体感）
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.3);
    dirLight.position.set(14, 20, 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    dirLight.shadow.bias = -0.0004;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 60;
    dirLight.shadow.camera.left = -22;
    dirLight.shadow.camera.right = 22;
    dirLight.shadow.camera.top = 22;
    dirLight.shadow.camera.bottom = -22;
    scene.add(dirLight);

    // 3. 科技天青轮廓光（Rim Light）：为建筑物边缘打出微妙的蓝青高光
    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.5);
    rimLight.position.set(-10, 12, -8);
    scene.add(rimLight);

    // 4. 辅助补光：避免背面死黑
    const fillLight = new THREE.DirectionalLight(0x94a3b8, 0.25);
    fillLight.position.set(-8, 6, 8);
    scene.add(fillLight);

    // 5. 核心科技发光点
    const pointLight1 = new THREE.PointLight(C.accent, 0.9, 18);
    pointLight1.position.set(0, 4, 0);
    scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(C.warm, 0.6, 14);
    pointLight2.position.set(-6, 3, -3);
    scene.add(pointLight2);

    // Ground: 钛晶微反射地面
    const groundGeo = new THREE.PlaneGeometry(60, 60);
    const groundMat = new THREE.MeshStandardMaterial({
      color: C.ground,
      roughness: 0.65,
      metalness: 0.15,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    scene.add(ground);

    // Grid: 钛晶精密坐标网格
    const gridHelper = new THREE.GridHelper(60, 60, C.gridLine, C.gridSub);
    gridHelper.material.opacity = 0.55;
    gridHelper.material.transparent = true;
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // 加法细节：车道线贴花 + 出入口标识（铺在既有网格之上，不动网格与建筑）
    const laneTexBase = makeLaneTexture();
    if (laneTexBase) {
      const lanes: Array<{ x: number; z: number; len: number; rotY: number }> = [
        { x: 0, z: 7.2, len: 26, rotY: 0 },
        { x: 11.5, z: 0, len: 22, rotY: Math.PI / 2 },
        { x: -1, z: -9, len: 22, rotY: 0 },
      ];
      for (const ln of lanes) {
        const tex = laneTexBase.clone();
        tex.needsUpdate = true;
        tex.repeat.set(Math.max(4, Math.round(ln.len / 3)), 1);
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.8 });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(ln.len, 1.5), mat);
        mesh.rotation.order = 'YXZ';
        mesh.rotation.y = ln.rotY;
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(ln.x, 0.02, ln.z);
        scene.add(mesh);
      }
      laneTexBase.dispose();
    }
    for (const gate of [
      { text: '入口', x: -12.2, z: 7.2 },
      { text: '出口', x: 11.5, z: 10.4 },
    ]) {
      const tex = makeGateTexture(gate.text);
      if (!tex) continue;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.9 });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(gate.x, 0.03, gate.z);
      scene.add(mesh);
    }

    // Buildings: 纯净钛白金属 + 细致科技线框
    const buildingMat = new THREE.MeshStandardMaterial({
      color: C.building,
      roughness: 0.4,
      metalness: 0.1,
    });
    const buildingMat2 = new THREE.MeshStandardMaterial({
      color: C.buildingLight,
      roughness: 0.35,
      metalness: 0.15,
    });
    const windowMat = new THREE.MeshStandardMaterial({
      color: C.accent,
      emissive: C.accent,
      emissiveIntensity: 0.45,
      roughness: 0.2,
      metalness: 0.3,
    });
    const edgeLineMat = new THREE.LineBasicMaterial({
      color: C.buildingEdge,
      transparent: true,
      opacity: 0.45,
    });

    BUILDINGS.forEach((b) => {
      const mat = b.color
        ? new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.4, metalness: 0.15 })
        : (Math.random() > 0.5 ? buildingMat : buildingMat2);
      const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(b.x, b.h / 2, b.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);

      // 科技全息结构边缘（在白底中凸显精密建筑结构）
      const edges = new THREE.EdgesGeometry(geo);
      const line = new THREE.LineSegments(edges, edgeLineMat);
      mesh.add(line);

      // Roof detail
      if (b.roof) {
        const roofGeo = new THREE.BoxGeometry(b.w + 0.2, 0.15, b.d + 0.2);
        const roofMat = new THREE.MeshStandardMaterial({ color: C.roof, roughness: 0.5, metalness: 0.25 });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.set(b.x, b.h + 0.075, b.z);
        roof.castShadow = true;
        scene.add(roof);
      }

      // Windows (emissive strips)
      const winCount = Math.floor(b.w / 1.2);
      for (let i = 0; i < winCount; i++) {
        const winGeo = new THREE.BoxGeometry(0.4, 0.3, 0.05);
        const win = new THREE.Mesh(winGeo, windowMat);
        win.position.set(b.x - b.w / 2 + 0.8 + i * 1.2, b.h * 0.6, b.z + b.d / 2 + 0.03);
        scene.add(win);
      }

      // 加法细节：较高厂房补第二排灯窗（同一 windowMat，仅增数量/位置）
      if (b.h >= 2.6) {
        for (let i = 0; i < winCount; i++) {
          const winGeo = new THREE.BoxGeometry(0.4, 0.3, 0.05);
          const win = new THREE.Mesh(winGeo, windowMat);
          win.position.set(b.x - b.w / 2 + 0.8 + i * 1.2, b.h * 0.3, b.z + b.d / 2 + 0.03);
          scene.add(win);
        }
      }

      // 加法细节：坡屋顶上的采光天窗格
      if (b.roof) {
        const skyCount = Math.max(1, Math.floor(b.w / 2.2));
        const skyGeo = new THREE.BoxGeometry(0.55, 0.08, 0.55);
        for (let i = 0; i < skyCount; i++) {
          const sky = new THREE.Mesh(skyGeo, windowMat);
          sky.position.set(b.x - b.w / 2 + ((i + 0.5) * b.w) / skyCount, b.h + 0.19, b.z);
          scene.add(sky);
        }
      }

      // Chimney
      if (b.chimney) {
        const chimGeo = new THREE.CylinderGeometry(0.25, 0.35, 3, 8);
        const chimMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.5, metalness: 0.3 });
        const chim = new THREE.Mesh(chimGeo, chimMat);
        chim.position.set(b.x + b.w * 0.3, b.h + 1.5, b.z);
        chim.castShadow = true;
        scene.add(chim);

        // Chimney cap
        const capGeo = new THREE.CylinderGeometry(0.35, 0.25, 0.2, 8);
        const cap = new THREE.Mesh(capGeo, chimMat);
        cap.position.set(b.x + b.w * 0.3, b.h + 3.1, b.z);
        scene.add(cap);

        // Chimney glow
        const glowGeo = new THREE.SphereGeometry(0.3, 8, 8);
        const glowMat = new THREE.MeshStandardMaterial({ color: C.hot, emissive: C.hot, emissiveIntensity: 0.7, transparent: true, opacity: 0.75 });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.position.set(b.x + b.w * 0.3, b.h + 3.2, b.z);
        scene.add(glow);
      }

      // Window lights (emissive strips on sides)
      const sideWinCount = Math.floor(b.d / 1.5);
      for (let i = 0; i < sideWinCount; i++) {
        const winGeo = new THREE.BoxGeometry(0.05, 0.3, 0.4);
        const win = new THREE.Mesh(winGeo, windowMat);
        win.position.set(b.x + b.w / 2 + 0.03, b.h * 0.6, b.z - b.d / 2 + 0.8 + i * 1.5);
        scene.add(win);
      }
    });

    // Tanks: 哑光钛合金储罐 + 金属箍环
    TANKS.forEach((t) => {
      const tankGeo = new THREE.CylinderGeometry(t.r, t.r, t.h, 16);
      const tankMat = new THREE.MeshStandardMaterial({ color: C.tank, roughness: 0.35, metalness: 0.3 });
      const tank = new THREE.Mesh(tankGeo, tankMat);
      tank.position.set(t.x, t.h / 2, t.z);
      tank.castShadow = true;
      tank.receiveShadow = true;
      scene.add(tank);

      // Tank dome top
      const domeGeo = new THREE.SphereGeometry(t.r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      const dome = new THREE.Mesh(domeGeo, tankMat);
      dome.position.set(t.x, t.h, t.z);
      scene.add(dome);

      // Tank rings
      for (let i = 1; i < 4; i++) {
        const ringGeo = new THREE.TorusGeometry(t.r + 0.02, 0.04, 8, 24);
        const ringMat = new THREE.MeshStandardMaterial({ color: 0x667788, roughness: 0.5, metalness: 0.5 });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.set(t.x, t.h * i * 0.25, t.z);
        ring.rotation.x = Math.PI / 2;
        scene.add(ring);
      }
    });

    // Pipes (static geometry)
    PIPE_ROUTES.forEach((route) => {
      const points = route.points.map((p) => new THREE.Vector3(p.x, 1.2, p.z));
      const curve = new THREE.CatmullRomCurve3(points);
      const tubeGeo = new THREE.TubeGeometry(curve, 20, 0.08, 6, false);
      const tubeMat = new THREE.MeshStandardMaterial({ color: C.pipe, roughness: 0.5, metalness: 0.4 });
      const tube = new THREE.Mesh(tubeGeo, tubeMat);
      tube.castShadow = true;
      scene.add(tube);
    });

    // Flow particles
    const flowLines: THREE.Line[] = [];
    const flowParticles: THREE.Points[] = [];

    PIPE_ROUTES.forEach((route) => {
      const points = route.points.map((p) => new THREE.Vector3(p.x, 1.3, p.z));
      const curve = new THREE.CatmullRomCurve3(points);

      // Particle geometry along the path
      const particleCount = 30;
      const positions = new Float32Array(particleCount * 3);
      const particleGeo = new THREE.BufferGeometry();
      particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const particleMat = new THREE.PointsMaterial({
        color: route.color,
        size: 0.16,
        transparent: true,
        opacity: 0.95,
        blending: THREE.NormalBlending,
        depthWrite: false,
      });

      const particles = new THREE.Points(particleGeo, particleMat);
      particles.userData = { curve, speed: route.speed, count: particleCount };
      scene.add(particles);
      flowParticles.push(particles);
    });

    // Equipment markers (floating diamonds)
    const markerMat = new THREE.MeshStandardMaterial({
      color: C.emissive,
      emissive: C.emissive,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.85,
    });

    // Add some ambient equipment markers at key positions
    const markerPositions = [
      new THREE.Vector3(-6, 2.5, -3),
      new THREE.Vector3(2, 2, -4),
      new THREE.Vector3(5, 3, 2),
      new THREE.Vector3(-3, 1.8, 4),
      new THREE.Vector3(0, 1.5, 0),
    ];

    markerPositions.forEach((pos) => {
      const geo = new THREE.OctahedronGeometry(0.15, 0);
      const marker = new THREE.Mesh(geo, markerMat.clone());
      marker.position.copy(pos);
      scene.add(marker);
    });

    const anchorSprites: THREE.Sprite[] = [];

    stateRef.current = {
      scene, camera, renderer, clock: new THREE.Clock(),
      flowLines, flowParticles, anchorSprites,
      mouseDown: false, mouse: { x: 0, y: 0 },
      rotY: Math.PI / 4, rotX: 0.5,
      targetRotY: Math.PI / 4, targetRotX: 0.5,
      distance: 25, targetDistance: 25,
      autoRotate: true, lastInteract: 0,
      anchorRings: new Map(),
      dataSignSprites: [],
      raycaster: new THREE.Raycaster(),
      pointer: new THREE.Vector2(99, 99),
      dotTex: makeDotTexture(),
      ringTex: makeRingTexture(),
    };
  }, []);

  /* ─── 动画循环 ─── */
  // 投影会触发父组件更新；回调变化不能重启 WebGL 场景或动画循环。
  const onAnchorProjectRef = useRef(onAnchorProject);
  useEffect(() => {
    onAnchorProjectRef.current = onAnchorProject;
  }, [onAnchorProject]);
  const projectFrameRef = useRef(0);
  const animate = useCallback(() => {
    const s = stateRef.current;
    if (!s) return;

    const elapsed = s.clock.getElapsedTime();
    const delta = s.clock.getDelta();

    // Auto-rotate
    if (s.autoRotate && Date.now() - s.lastInteract > 3000) {
      s.targetRotY += 0.001;
    }

    // Smooth camera
    s.rotY += (s.targetRotY - s.rotY) * 0.05;
    s.rotX += (s.targetRotX - s.rotX) * 0.05;
    s.distance += (s.targetDistance - s.distance) * 0.05;

    const camX = s.distance * Math.sin(s.rotY) * Math.cos(s.rotX);
    const camY = s.distance * Math.sin(s.rotX) + 5;
    const camZ = s.distance * Math.cos(s.rotY) * Math.cos(s.rotX);
    s.camera.position.set(camX, Math.max(camY, 3), camZ);
    s.camera.lookAt(0, 1.5, 0);

    // Animate flow particles
    s.flowParticles.forEach((pts) => {
      const { curve, speed, count } = pts.userData as { curve: THREE.CatmullRomCurve3; speed: number; count: number };
      const posAttr = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < count; i++) {
        const t = ((elapsed * speed * 0.15 + i / count) % 1 + 1) % 1;
        const point = curve.getPoint(t);
        posAttr.setXYZ(i, point.x, point.y, point.z);
      }
      posAttr.needsUpdate = true;
    });

    // Animate anchor sprites (pulse) —— 加法：悬停锚点放大 1.6 倍
    if (s.anchorSprites.length) {
      s.raycaster.setFromCamera(s.pointer, s.camera);
      const hit = s.raycaster.intersectObjects(s.anchorSprites, false)[0]?.object ?? null;
      for (const sp of s.anchorSprites) sp.userData.hover = sp === hit;
    }
    s.anchorSprites.forEach((sprite) => {
      const scale = (0.3 + Math.sin(elapsed * 2 + sprite.position.x) * 0.1) * (sprite.userData.hover ? 1.6 : 1);
      sprite.scale.set(scale, scale, scale);
      (sprite.material as THREE.SpriteMaterial).opacity = 0.6 + Math.sin(elapsed * 3) * 0.3;
    });

    // 加法细节：选中描边环微脉冲 + 数据立牌按相机距离淡入淡出
    s.anchorRings.forEach((ring) => {
      if (!ring.visible) return;
      const rs = 0.62 + Math.sin(elapsed * 2.4) * 0.05;
      ring.scale.set(rs, rs, 1);
    });
    for (const sp of s.dataSignSprites) {
      const d = s.camera.position.distanceTo(sp.position);
      const op = Math.max(0.12, Math.min(0.95, (48 - d) / 16));
      (sp.material as THREE.SpriteMaterial).opacity = op;
      sp.visible = op > 0.05;
    }

    // Animate equipment markers
    s.scene.children.forEach((child) => {
      if (child instanceof THREE.Mesh && child.geometry instanceof THREE.OctahedronGeometry) {
        child.rotation.y = elapsed * 0.5;
        child.position.y += Math.sin(elapsed * 2 + child.position.x) * 0.001;
      }
    });

    // Project anchors to screen（节流：60fps 渲染循环 → 6fps 回调，消除父组件高频重渲染）
    projectFrameRef.current += 1;
    const project = onAnchorProjectRef.current;
    if (project && s.anchorSprites.length > 0 && projectFrameRef.current % 10 === 0) {
      const projected = s.anchorSprites.map((sprite) => {
        const screenPos = sprite.position.clone().project(s.camera);
        return {
          x: (screenPos.x * 0.5 + 0.5) * 100,
          y: (-screenPos.y * 0.5 + 0.5) * 100,
          visible: screenPos.z < 1,
        };
      });
      project(projected);
    }

    s.renderer.render(s.scene, s.camera);
    rafRef.current = requestAnimationFrame(animate);
  }, []);

  /* ─── 鼠标/触摸控制 ─── */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onPointerDown = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s) return;
      s.mouseDown = true;
      s.mouse = { x: e.clientX, y: e.clientY };
      s.autoRotate = false;
      s.lastInteract = Date.now();
    };

    const onPointerMove = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s) return;
      // 加法细节：非拖拽时也跟踪指针，供锚点悬停放大拾取
      const rect = container.getBoundingClientRect();
      s.pointer.set(
        ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
      );
      if (!s.mouseDown) return;
      const dx = e.clientX - s.mouse.x;
      const dy = e.clientY - s.mouse.y;
      s.targetRotY -= dx * 0.005;
      s.targetRotX = Math.max(0.1, Math.min(1.2, s.targetRotX + dy * 0.005));
      s.mouse = { x: e.clientX, y: e.clientY };
      s.lastInteract = Date.now();
    };

    const onPointerUp = () => {
      const s = stateRef.current;
      if (s) s.mouseDown = false;
    };

    const onWheel = (e: WheelEvent) => {
      const s = stateRef.current;
      if (!s) return;
      e.preventDefault();
      s.targetDistance = Math.max(10, Math.min(40, s.targetDistance + e.deltaY * 0.02));
      s.lastInteract = Date.now();
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointerleave', onPointerUp);
    container.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointerleave', onPointerUp);
      container.removeEventListener('wheel', onWheel);
    };
  }, []);

  /* ─── Resize ─── */
  useEffect(() => {
    const onResize = () => {
      const container = containerRef.current;
      const s = stateRef.current;
      if (!container || !s) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      s.camera.aspect = w / h;
      s.camera.updateProjectionMatrix();
      s.renderer.setSize(w, h);
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /* ─── 生命周期 ─── */
  useEffect(() => {
    init();
    const s = stateRef.current;
    const canvas = canvasRef.current;
    projectFrameRef.current = 0;
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafRef.current);
      if (s) {
        s.renderer.dispose();
        const geometries = new Set<THREE.BufferGeometry>();
        const materials = new Set<THREE.Material>();
        s.scene.traverse((child) => {
          if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Points) {
            geometries.add(child.geometry);
            const list = Array.isArray(child.material) ? child.material : [child.material];
            list.forEach((material) => materials.add(material));
          } else if (child instanceof THREE.Sprite) {
            // Sprite 几何体由 Three.js 共享，仅释放实例材质。
            materials.add(child.material);
          }
        });
        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
      }
      // React 卸载时可能先清空容器 ref，清理必须使用本次挂载的画布。
      canvas?.remove();
      canvasRef.current = null;
      stateRef.current = null;
    };
  }, [init, animate]);

  /* ─── 锚点同步：场景初始化后按 ID 更新，保持输入顺序供投影使用 ─── */
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    const previous = new Map(s.anchorSprites.map((sprite) => [sprite.userData.anchorId, sprite]));
    s.anchorSprites = anchors.map((anchor) => {
      let sprite = previous.get(anchor.id);
      if (sprite) {
        previous.delete(anchor.id);
      } else {
        // 锚点样式统一为主场景语言：青色发光圆点（0x22d3ee，仅改孪生页锚点材质）
        sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: s.dotTex ?? undefined,
          color: s.dotTex ? 0xffffff : 0x22d3ee,
          transparent: true,
          opacity: 0.85,
          blending: THREE.NormalBlending,
          depthWrite: false,
          toneMapped: false,
        }));
        sprite.scale.set(0.4, 0.4, 0.4);
        sprite.userData = { anchorId: anchor.id, hover: false };
        s.scene.add(sprite);
      }
      sprite.position.set(...anchor.worldPos);
      // 选中描边环：与主场景 selectionRing 同色系
      let ring = s.anchorRings.get(anchor.id);
      if (anchor.selected && s.ringTex) {
        if (!ring) {
          ring = new THREE.Sprite(new THREE.SpriteMaterial({
            map: s.ringTex,
            transparent: true,
            depthWrite: false,
            toneMapped: false,
          }));
          ring.scale.set(0.62, 0.62, 1);
          s.scene.add(ring);
          s.anchorRings.set(anchor.id, ring);
        }
        ring.visible = true;
        ring.position.set(...anchor.worldPos);
      } else if (ring) {
        ring.visible = false;
      }
      return sprite;
    });
    previous.forEach((sprite) => {
      s.scene.remove(sprite);
      sprite.material.dispose();
    });
    // 已消失锚点：连带清理描边环
    for (const [id, ring] of s.anchorRings) {
      if (!anchors.some((a) => a.id === id)) {
        s.scene.remove(ring);
        ring.material.dispose();
        s.anchorRings.delete(id);
      }
    }
  }, [anchors]);

  /* ─── 数据立牌（加法层）：台账变化时重建厂房顶部悬浮 Sprite ─── */
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    for (const sp of s.dataSignSprites) {
      s.scene.remove(sp);
      sp.material.map?.dispose();
      sp.material.dispose();
    }
    s.dataSignSprites = dataSigns
      .slice(0, SIGN_BUILDING_IDX.length)
      .map((d, i) => {
        const tex = makeSignTexture(d.name, d.deviceCount, d.healthScore);
        if (!tex) return null;
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        }));
        sp.scale.set(3.4, 1.7, 1);
        const b = BUILDINGS[SIGN_BUILDING_IDX[i]];
        sp.position.set(b.x, b.h + 2.6 + i * 0.15, b.z);
        s.scene.add(sp);
        return sp;
      })
      .filter((x): x is THREE.Sprite => x !== null);
  }, [dataSigns]);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full absolute inset-0 ${className ?? ''}`}
      style={{ touchAction: 'none' }}
    />
  );
};

export default TwinScene3D;
