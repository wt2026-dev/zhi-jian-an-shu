import React, { useRef, useEffect, useCallback, useState } from 'react';
import * as THREE from 'three';

/* ─── 颜色常量 ─── */
const C = {
  ground: 0x1a2332,
  gridLine: 0x1e3a5f,
  building: 0x2a3f5f,
  buildingLight: 0x3d5a80,
  tank: 0x4a6fa5,
  pipe: 0x557799,
  accent: 0x00b4d8,
  warm: 0xf4a261,
  hot: 0xe76f51,
  cool: 0x48cae4,
  sky: 0x0d1b2a,
  fog: 0x0a1628,
  emissive: 0x00e5ff,
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
  { x: 0, z: 0, w: 3, h: 1.8, d: 2.5, color: 0x3a506b },
  { x: -1, z: -6, w: 4, h: 2.5, d: 3, roof: true, color: 0x4a6741 },
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
}

interface TwinScene3DProps {
  anchors?: Anchor3D[];
  onAnchorProject?: (screen: { x: number; y: number; visible: boolean }[]) => void;
  className?: string;
}

const EMPTY_ANCHORS: Anchor3D[] = [];

export const TwinScene3D: React.FC<TwinScene3DProps> = ({ anchors = EMPTY_ANCHORS, onAnchorProject, className }) => {
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
    scene.fog = new THREE.FogExp2(C.fog, 0.018);

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

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    // Lights
    const ambient = new THREE.AmbientLight(0x334466, 0.6);
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffeedd, 1.2);
    dirLight.position.set(10, 15, 8);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 50;
    dirLight.shadow.camera.left = -20;
    dirLight.shadow.camera.right = 20;
    dirLight.shadow.camera.top = 20;
    dirLight.shadow.camera.bottom = -20;
    scene.add(dirLight);

    const rimLight = new THREE.DirectionalLight(0x4488cc, 0.4);
    rimLight.position.set(-8, 10, -6);
    scene.add(rimLight);

    const pointLight1 = new THREE.PointLight(C.accent, 0.8, 20);
    pointLight1.position.set(0, 4, 0);
    scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(C.warm, 0.5, 15);
    pointLight2.position.set(-6, 3, -3);
    scene.add(pointLight2);

    // Ground
    const groundGeo = new THREE.PlaneGeometry(60, 60);
    const groundMat = new THREE.MeshStandardMaterial({
      color: C.ground,
      roughness: 0.9,
      metalness: 0.1,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    scene.add(ground);

    // Grid
    const gridHelper = new THREE.GridHelper(60, 60, C.gridLine, C.gridLine);
    gridHelper.material.opacity = 0.15;
    gridHelper.material.transparent = true;
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // Buildings
    const buildingMat = new THREE.MeshStandardMaterial({ color: C.building, roughness: 0.7, metalness: 0.2 });
    const buildingMat2 = new THREE.MeshStandardMaterial({ color: C.buildingLight, roughness: 0.6, metalness: 0.3 });
    const windowMat = new THREE.MeshStandardMaterial({ color: C.accent, emissive: C.accent, emissiveIntensity: 0.3, roughness: 0.3, metalness: 0.5 });

    BUILDINGS.forEach((b) => {
      const mat = b.color ? new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.7, metalness: 0.2 }) : (Math.random() > 0.5 ? buildingMat : buildingMat2);
      const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(b.x, b.h / 2, b.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);

      // Roof detail
      if (b.roof) {
        const roofGeo = new THREE.BoxGeometry(b.w + 0.2, 0.15, b.d + 0.2);
        const roofMat = new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.5, metalness: 0.4 });
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

      // Chimney
      if (b.chimney) {
        const chimGeo = new THREE.CylinderGeometry(0.25, 0.35, 3, 8);
        const chimMat = new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.6, metalness: 0.3 });
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
        const glowMat = new THREE.MeshStandardMaterial({ color: C.hot, emissive: C.hot, emissiveIntensity: 0.6, transparent: true, opacity: 0.7 });
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

    // Tanks
    TANKS.forEach((t) => {
      const tankGeo = new THREE.CylinderGeometry(t.r, t.r, t.h, 16);
      const tankMat = new THREE.MeshStandardMaterial({ color: C.tank, roughness: 0.4, metalness: 0.6 });
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
        size: 0.12,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
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

    // Animate anchor sprites (pulse)
    s.anchorSprites.forEach((sprite) => {
      const scale = 0.3 + Math.sin(elapsed * 2 + sprite.position.x) * 0.1;
      sprite.scale.set(scale, scale, scale);
      (sprite.material as THREE.SpriteMaterial).opacity = 0.6 + Math.sin(elapsed * 3) * 0.3;
    });

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
      if (!s || !s.mouseDown) return;
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
        sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          color: C.emissive,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
        }));
        sprite.scale.set(0.4, 0.4, 0.4);
        sprite.userData = { anchorId: anchor.id };
        s.scene.add(sprite);
      }
      sprite.position.set(...anchor.worldPos);
      return sprite;
    });
    previous.forEach((sprite) => {
      s.scene.remove(sprite);
      sprite.material.dispose();
    });
  }, [anchors]);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full absolute inset-0 ${className ?? ''}`}
      style={{ touchAction: 'none' }}
    />
  );
};

export default TwinScene3D;
