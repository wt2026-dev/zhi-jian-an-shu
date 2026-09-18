/**
 * DigitalHumanGLB.tsx — 写实工业风 3D 数字人 React 组件（GLB / Mixamo 骨骼）
 *
 * 职责：Three.js 场景初始化 / GLB 模型加载 / 渲染循环 / Mixamo 骨骼动画驱动 / 语音合成
 * 对外暴露 speak / stop / setSpeaking / setPersona 四个方法（与 DigitalHumanVRM / DigitalHuman3D 同构，
 * 可直接替换使用）。
 *
 * 模型来源：Sketchfab 免费模型 "Worker talk animation"（作者 honved444，CC-BY-4.0 许可，可商用，须署名）。
 *  - 模型页：https://sketchfab.com/3d-models/worker-talk-animation-620e27e5126f40d080c5d4bffab9eedb
 *  - 许可：https://creativecommons.org/licenses/by/4.0/（署名：Worker talk animation by honved444, CC BY 4.0）
 *  - 本地文件：public/models/engineer/worker_talk.glb（10.4MB，1k 纹理）
 * 形象：写实向 3D 男性工人（蓝工装背带裤 + 白短袖 + 工装鞋，PBR 材质，62k 三角面），非动漫。
 *
 * 动画说明：
 *  - 说话动画 "Armature|beszed"（内置 Mixamo 骨骼动画，驱动头部 + 双臂 + 手指手势），说话时循环播放；
 *  - 待机：呼吸（Spine2 缩放）+ 头部微动 + 手臂自然微摆（程序化，Mixamo 骨骼名）；
 *  - 站立朝向：Mixamo 角色默认面向 +Z，直接面向相机；若导出朝向不同可调整 ROTATE_Y 常量。
 *
 * 依赖：three@0.186.0（项目已装），无需 VRM 插件。
 */

import React, { useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PERSONA_CONFIGS } from './EngineerModel';

// ─── Public interface (与 DigitalHumanVRM 同构) ────────────────────

export interface DigitalHumanGLBHandle {
  speak: (text: string) => Promise<boolean>;
  stop: () => void;
  setSpeaking: (v: boolean) => void;
  setPersona: (id: string) => void;
}

interface DigitalHumanGLBProps {
  personaId: string;
  isSpeaking?: boolean;
  className?: string;
  onError?: (error: any) => void;
}

// ─── Persona → model mapping（形象统一，徽章颜色区分人设）────────────

const PERSONA_MODEL: Record<string, string> = {
  zhang: '/models/engineer/worker_talk.glb',
  li: '/models/engineer/worker_talk.glb',
  zhi: '/models/engineer/worker_talk.glb',
};

// ─── Mixamo 骨骼名（GLB 实际导出的命名，见模型骨架检查）──────────────
// 注意：three 的 GLTFLoader 会移除骨骼名中的冒号 ":"，因此这里使用 loader 实际生成的名字
// （GLB 原始名 mixamorig:Hips_01 → 运行时 mixamorigHips_01）。

const BONE = {
  hips: 'mixamorigHips_01',
  spine: 'mixamorigSpine_02',
  spine1: 'mixamorigSpine1_03',
  spine2: 'mixamorigSpine2_04',
  neck: 'mixamorigNeck_05',
  head: 'mixamorigHead_06',
  lShoulder: 'mixamorigLeftShoulder_08',
  lArm: 'mixamorigLeftArm_09',
  lForeArm: 'mixamorigLeftForeArm_010',
  lHand: 'mixamorigLeftHand_011',
  rShoulder: 'mixamorigRightShoulder_019',
  rArm: 'mixamorigRightArm_020',
  rForeArm: 'mixamorigRightForeArm_021',
  rHand: 'mixamorigRightHand_022',
} as const;

// ─── 动画状态（mutable，不走 React state）──────────────────────────

interface AnimState {
  speaking: boolean;
  /* nod */
  nodProgress: number;
  nodDir: number;
  /* arm idle swing phase offsets */
  phaseL: number;
  phaseR: number;
  /* speak action weight */
  speakWeight: number;
  /* procedural mouth-open envelope (0..1) */
  mouthOpen: number;
}

function freshAnimState(): AnimState {
  return {
    speaking: false,
    nodProgress: -1,
    nodDir: 1,
    phaseL: Math.random() * Math.PI * 2,
    phaseR: Math.random() * Math.PI * 2,
    speakWeight: 0,
    mouthOpen: 0,
  };
}

// ─── 程序化嘴部（口型）绑定 ─────────────────────────────────────────
// 模型无 Jaw 骨骼 / 无 morph targets（GLB 检查确认），说话动画只驱动
// 头部 + 手势。这里在运行时对头部网格嘴部条带顶点做程序化开合变形，
// 让"说话"有真实口型效果：
//  - 嘴部条带（Head 骨骼局部坐标）：y ∈ (0.030, 0.086)（嘴缝→下巴）、
//    z > 0.052（前脸）、Head 权重 > 0.3，约 1000 个顶点；
//  - 渐变权重：嘴缝处 1.0 平滑衰减到下巴处 0.35，避免撕裂；
//  - 说话时顶点沿 -y（张口）与 +z（下唇前突）位移，峰值约 20mm。

interface MouthRig {
  mesh: THREE.SkinnedMesh;
  idx: number[];
  w: number[];
  base: Float32Array;
}

/** 口型参数（Head 局部米制坐标，模型已归一化） */
const MOUTH = {
  yMin: 0.03,
  yMax: 0.086,
  zMin: 0.052,
  headWeightMin: 0.3,
  openPeak: 0.06, // 最大张口位移（米）：0.032 在半身构图下肉眼仍难辨，放大到 60mm 保证可见
} as const;

function setupMouthAnimation(root: THREE.Group): MouthRig | null {
  const headBone = root.getObjectByName(BONE.head);
  if (!headBone) return null;

  // 找嘴部条带：对每个蒙皮网格，统计"Head 局部 y∈[0.03,0.086] 且 z>0.052 且
  // Head 权重>0.3"的顶点数，取最多者（脸网格约 1000+ 个，其他网格极少/为 0）。
  // 注意：GLTFLoader 解析本 GLB 时会把"默认对象"（20802 顶点）的 JOINTS 全部
  // 输出为 Head 索引，仅按"Head 权重顶点数"选择会误选它；直接以嘴部条带候选
  // 数为准，天然区分脸网格与其他网格。
  root.updateMatrixWorld(true);
  const invHead = headBone.matrixWorld.clone().invert();

  let bestMesh: THREE.SkinnedMesh | null = null;
  let bestIdx: number[] = [];
  let bestW: number[] = [];
  let bestBase: Float32Array | null = null;

  root.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh) || !o.skeleton) return;
    const skeleton = o.skeleton;
    const headIdx = skeleton.bones.findIndex((b) => b.name === BONE.head);
    if (headIdx < 0) return;
    const geo = o.geometry;
    const wAttr = geo.attributes.skinWeight;
    const jAttr = geo.attributes.skinIndex;
    const posAttr = geo.attributes.position;
    if (!wAttr || !jAttr || !posAttr) return;

    const idx: number[] = [];
    const w: number[] = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < posAttr.count; i++) {
      let wHead = 0;
      const js = [jAttr.getX(i), jAttr.getY(i), jAttr.getZ(i), jAttr.getW(i)];
      const ws = [wAttr.getX(i), wAttr.getY(i), wAttr.getZ(i), wAttr.getW(i)];
      for (let k = 0; k < 4; k++) {
        if (Math.round(js[k]) === headIdx) wHead = Math.max(wHead, ws[k]);
      }
      if (wHead > MOUTH.headWeightMin) {
        v.fromBufferAttribute(posAttr, i).applyMatrix4(invHead);
        if (v.y > MOUTH.yMin && v.y < MOUTH.yMax && v.z > MOUTH.zMin) {
          const u = (v.y - MOUTH.yMin) / (MOUTH.yMax - MOUTH.yMin); // 0 下巴 .. 1 嘴缝
          idx.push(i);
          w.push(0.35 + 0.65 * u * u);
        }
      }
    }
    if (idx.length > bestIdx.length) {
      bestIdx = idx;
      bestW = w;
      bestMesh = o;
      bestBase = new Float32Array(posAttr.array);
    }
  });

  if (!bestMesh || bestIdx.length < 100) return null;

  const base = bestBase as Float32Array;
  return { mesh: bestMesh, idx: bestIdx, w: bestW, base };
}

// ─── Constants ────────────────────────────────────────────────────

// 相机半身构图（聚焦面部与说话手势）
const CAM_POS = new THREE.Vector3(0, 1.24, 1.72);
const CAM_TARGET = new THREE.Vector3(0, 1.18, 0);
const FOV = 38;

// 目标身高（米）：无论模型原始单位（米/厘米）都归一到 1.75m 工业人像比例
const TARGET_HEIGHT = 1.75;

// 说话动画名（GLB 内置，匈牙利语 beszéd = 说话）
const SPEAK_CLIP_NAME = 'Armature|beszed';

// ─── Component ────────────────────────────────────────────────────

export const DigitalHumanGLB = forwardRef<DigitalHumanGLBHandle, DigitalHumanGLBProps>(
  ({ personaId, isSpeaking = false, className = '', onError }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;

    const sceneRef = useRef<{
      renderer: THREE.WebGLRenderer;
      scene: THREE.Scene;
      camera: THREE.PerspectiveCamera;
      root: THREE.Group | null;
      mixer: THREE.AnimationMixer | null;
      speakAction: THREE.AnimationAction | null;
      mouth: MouthRig | null;
      grid: THREE.GridHelper;
      animId: number;
      anim: AnimState;
      lastTime: number;
      disposed: boolean;
      personaId: string;
    } | null>(null);

    // ── Load GLB model ──────────────────────────────────────────

    const loadGLB = useCallback((url: string, ctx: NonNullable<typeof sceneRef.current>): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.loadAsync(url).then((gltf) => {
          if (ctx.disposed) {
            gltf.scene.traverse((o) => {
              if (o instanceof THREE.Mesh) {
                o.geometry?.dispose();
                const mats = Array.isArray(o.material) ? o.material : [o.material];
                mats.forEach((m) => m?.dispose());
              }
            });
            resolve();
            return;
          }

          const root = gltf.scene;

          // 替换旧模型
          if (ctx.root) {
            ctx.scene.remove(ctx.root);
            ctx.root.traverse((o) => {
              if (o instanceof THREE.Mesh) {
                o.geometry?.dispose();
                const mats = Array.isArray(o.material) ? o.material : [o.material];
                mats.forEach((m) => m?.dispose());
              }
            });
          }
          ctx.scene.add(root);

          // 归一化：统一到 1.75m（Sketchfab GLB 或为厘米单位，双保险）
          const box = new THREE.Box3().setFromObject(root);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          const h = size.y;
          if (Number.isFinite(h) && h > 0.01 && Math.abs(h - TARGET_HEIGHT) > 0.05) {
            root.scale.setScalar(TARGET_HEIGHT / h);
            root.updateMatrixWorld(true);
          }
          // 脚底归零 + x/z 居中
          const box2 = new THREE.Box3().setFromObject(root);
          const min2 = box2.min;
          const center2 = box2.getCenter(new THREE.Vector3());
          root.position.y -= min2.y;
          root.position.x -= center2.x;
          if (Number.isFinite(center2.z) && Math.abs(center2.z) < 5) {
            root.position.z -= center2.z;
          }

          // 动画混音器 + 说话动画
          let mixer: THREE.AnimationMixer | null = null;
          let speakAction: THREE.AnimationAction | null = null;
          if (gltf.animations && gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(root);
            const clip =
              gltf.animations.find((a) => a.name === SPEAK_CLIP_NAME) || gltf.animations[0];
            speakAction = mixer.clipAction(clip);
            speakAction.setLoop(THREE.LoopRepeat, Infinity);
            speakAction.setEffectiveWeight(0);
            speakAction.clampWhenFinished = true;
          }
          ctx.mixer = mixer;
          ctx.speakAction = speakAction;

          // 程序化口型绑定（模型无 Jaw/morph，说话时驱动嘴部条带顶点开合）
          try {
            ctx.mouth = setupMouthAnimation(root);
          } catch (e) {
            console.warn('[DigitalHumanGLB] 口型绑定失败:', e);
            ctx.mouth = null;
          }

          ctx.root = root;
          ctx.anim = freshAnimState();
          resolve();
        }).catch((err) => {
          if (!ctx.disposed) reject(err);
        });
      });
    }, []);

    // ── Scene lifecycle ─────────────────────────────────────────

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setClearColor(0x000000, 0);

      const w = container.clientWidth || 262;
      const h = container.clientHeight || 262;
      renderer.setSize(w, h);
      container.appendChild(renderer.domElement);

      const camera = new THREE.PerspectiveCamera(FOV, w / h, 0.1, 100);
      camera.position.copy(CAM_POS);
      camera.lookAt(CAM_TARGET);

      const scene = new THREE.Scene();

      // 工业风虚拟工厂透明网格地板
      const grid = new THREE.GridHelper(8, 20, 0x0ea5e9, 0x334155);
      grid.position.set(0, 0, 0);
      if (Array.isArray(grid.material)) {
        grid.material.forEach((m) => {
          m.transparent = true;
          m.opacity = 0.28;
          m.depthWrite = false;
        });
      } else {
        grid.material.transparent = true;
        grid.material.opacity = 0.28;
        grid.material.depthWrite = false;
      }
      scene.add(grid);

      // 灯光（工业科技风，同 VRM 版）
      const mainLight = new THREE.DirectionalLight(0xf0f6ff, 1.65);
      mainLight.position.set(2.2, 3.2, 3.5);
      scene.add(mainLight);
      const fillLight = new THREE.DirectionalLight(0x67e8f9, 0.6);
      fillLight.position.set(1.6, 0.8, 2.2);
      scene.add(fillLight);
      const rimLight = new THREE.DirectionalLight(0x8ec5ff, 0.85);
      rimLight.position.set(-2.5, 1.6, -2.8);
      scene.add(rimLight);
      const ambientLight = new THREE.AmbientLight(0xdbe4ee, 0.42);
      scene.add(ambientLight);

      const anim = freshAnimState();

      const ctx = {
        renderer,
        scene,
        camera,
        root: null as THREE.Group | null,
        mixer: null as THREE.AnimationMixer | null,
        speakAction: null as THREE.AnimationAction | null,
        mouth: null as MouthRig | null,
        grid,
        animId: 0,
        anim,
        lastTime: performance.now(),
        disposed: false,
        personaId,
      };
      sceneRef.current = ctx;

      const modelUrl = PERSONA_MODEL[personaId] || PERSONA_MODEL.zhang;
      loadGLB(modelUrl, ctx).catch((err) => {
        if (!ctx.disposed) {
          console.warn('[DigitalHumanGLB] 模型加载失败:', err);
          onErrorRef.current?.(err);
        }
      });

      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            renderer.setSize(width, height);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
          }
        }
      });
      ro.observe(container);

      const tick = (now: number) => {
        if (ctx.disposed) return;
        ctx.animId = requestAnimationFrame(tick);

        const dt = Math.min(now - ctx.lastTime, 100);
        ctx.lastTime = now;
        const t = now;

        const { root, anim: a } = ctx;
        if (!root) {
          renderer.render(scene, camera);
          return;
        }

        // 动画混音器推进（说话动画）
        if (ctx.mixer) {
          ctx.mixer.update(dt / 1000);
          // 说话权重平滑（0 ↔ 1）
          if (ctx.speakAction) {
            const target = a.speaking ? 1 : 0;
            a.speakWeight += (target - a.speakWeight) * 0.1;
            ctx.speakAction.setEffectiveWeight(a.speakWeight);
            if (a.speakWeight > 0.01) ctx.speakAction.play();
            else ctx.speakAction.stop();
          }
        }

        const findBone = (name: string): THREE.Object3D | null =>
          root.getObjectByName(name) || null;

        // ── 待机：呼吸（Spine2 缩放）──
        const breathPhase = (t * Math.PI * 2) / 4000;
        const spine2 = findBone(BONE.spine2);
        if (spine2) {
          const bs = 1 + 0.012 * Math.sin(breathPhase);
          spine2.scale.set(bs, bs, bs);
        }

        // ── 待机：头部微动（说话动画也驱动头部，这里仅待机叠加轻微活体感）──
        const head = findBone(BONE.head);
        if (head && !a.speaking) {
          head.rotation.y = 0.03 * Math.sin((t * Math.PI * 2) / 7000) + 0.02 * Math.sin((t * Math.PI * 2) / 11000);
          head.rotation.z = 0.012 * Math.sin((t * Math.PI * 2) / 5000);
        }

        // ── 待机：手臂自然微摆（说话时交给 beszed 手势动画，避免叠加冲突）──
        if (!a.speaking) {
          const swingT = t / 1000;
          const swingZ = 0.05 * Math.sin(swingT * 1.8 + a.phaseL);
          const lArm = findBone(BONE.lArm);
          const rArm = findBone(BONE.rArm);
          if (lArm) lArm.rotation.z = 0.1 + swingZ;
          if (rArm) rArm.rotation.z = -0.1 - swingZ;
          const lFore = findBone(BONE.lForeArm);
          const rFore = findBone(BONE.rForeArm);
          if (lFore) lFore.rotation.x = -0.1;
          if (rFore) rFore.rotation.x = -0.1;
        }

        // ── 说话：头部轻点头（在 beszed 基础上叠加轻微点头）──
        if (a.nodProgress >= 0 && head) {
          a.nodProgress += dt / 400;
          if (a.nodProgress >= 1) {
            a.nodProgress = -1;
            head.rotation.x = 0;
          } else {
            head.rotation.x = a.nodDir * 0.05 * Math.sin(a.nodProgress * Math.PI);
          }
        }

        // ── 说话：程序化口型（嘴部条带顶点开合）──
        const mouth = ctx.mouth;
        if (mouth) {
          const target = a.speaking ? 1 : 0;
          a.mouthOpen += (target - a.mouthOpen) * 0.08;
          const posAttr = mouth.mesh.geometry.attributes.position;
          const arr = posAttr.array as Float32Array;
          if (a.mouthOpen > 0.002) {
            // 2.9Hz + 4.9Hz 双正弦叠加（口型节奏），峰值 ~20mm
            const sec = t / 1000;
            const open =
              MOUTH.openPeak *
              a.mouthOpen *
              (0.5 + 0.3 * Math.sin(sec * 18.2) + 0.2 * Math.sin(sec * 31.4 + 1.3));
            for (let i = 0; i < mouth.idx.length; i++) {
              const vi = mouth.idx[i] * 3;
              const w = mouth.w[i];
              arr[vi + 1] = mouth.base[vi + 1] - open * w;
              arr[vi + 2] = mouth.base[vi + 2] + open * 0.4 * w;
            }
            posAttr.needsUpdate = true;
          } else if (a.mouthOpen !== 0) {
            // 完全闭合时恢复原始顶点
            for (let i = 0; i < mouth.idx.length; i++) {
              const vi = mouth.idx[i] * 3;
              arr[vi + 1] = mouth.base[vi + 1];
              arr[vi + 2] = mouth.base[vi + 2];
            }
            posAttr.needsUpdate = true;
            a.mouthOpen = 0;
          }
        }

        renderer.render(scene, camera);
      };

      ctx.animId = requestAnimationFrame(tick);

      return () => {
        ctx.disposed = true;
        cancelAnimationFrame(ctx.animId);
        ro.disconnect();

        if (ctx.mixer) {
          ctx.mixer.stopAllAction();
          ctx.mixer = null;
        }
        if (ctx.root) {
          ctx.scene.remove(ctx.root);
          ctx.root.traverse((o) => {
            if (o instanceof THREE.Mesh) {
              o.geometry?.dispose();
              const mats = Array.isArray(o.material) ? o.material : [o.material];
              mats.forEach((m) => m?.dispose());
            }
          });
          ctx.root = null;
        }
        if (ctx.grid) {
          ctx.scene.remove(ctx.grid);
          ctx.grid.geometry?.dispose();
          if (Array.isArray(ctx.grid.material)) {
            ctx.grid.material.forEach((m) => m.dispose());
          } else {
            ctx.grid.material?.dispose();
          }
        }

        scene.clear();
        renderer.dispose();
        if (renderer.domElement.parentElement) {
          renderer.domElement.parentElement.removeChild(renderer.domElement);
        }
        sceneRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Sync personaId → badge color（形象统一，徽章颜色区分）──
    useEffect(() => {
      const ctx = sceneRef.current;
      if (!ctx || ctx.disposed || ctx.personaId === personaId) return;
      ctx.personaId = personaId;
      const modelUrl = PERSONA_MODEL[personaId] || PERSONA_MODEL.zhang;
      loadGLB(modelUrl, ctx).catch((err) => {
        if (!ctx.disposed) {
          console.warn('[DigitalHumanGLB] 切换人设模型失败:', err);
          onErrorRef.current?.(err);
        }
      });
    }, [personaId, loadGLB]);

    // ── Sync isSpeaking prop ──
    useEffect(() => {
      const ctx = sceneRef.current;
      if (ctx) {
        const wasSpeak = ctx.anim.speaking;
        ctx.anim.speaking = isSpeaking;
        if (isSpeaking && !wasSpeak) {
          ctx.anim.nodProgress = 0;
          ctx.anim.nodDir = 1;
        } else if (!isSpeaking && wasSpeak) {
          ctx.anim.nodProgress = 0;
          ctx.anim.nodDir = -1;
        }
      }
    }, [isSpeaking]);

    // ── Imperative handle ──────────────────────────────────────

    const triggerNod = useCallback((dir: number) => {
      const ctx = sceneRef.current;
      if (ctx) {
        ctx.anim.nodProgress = 0;
        ctx.anim.nodDir = dir;
      }
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        speak: async (text: string): Promise<boolean> => {
          const ctx = sceneRef.current;
          if (!ctx || ctx.disposed) return false;

          const clean = text
            .replace(/[#*`_~>[\]()!-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (!clean) return false;

          const excerpt = clean.length > 280 ? clean.slice(0, 280) : clean;

          // 视觉播报时长（口型/手势）：至少 2.5s，按文本长度最多 9s。
          // 即使系统 TTS 无语音（onerror 立即触发 / speechSynthesis 不可用），
          // 也保持说话状态到估算时长，保证"嘴巴在动"的视觉完整。
          const startT = Date.now();
          const estMs = Math.min(Math.max(excerpt.length * 150, 2500), 9000);

          ctx.anim.speaking = true;
          triggerNod(1);

          const release = (ok: boolean, resolve: (v: boolean) => void) => {
            const remain = estMs - (Date.now() - startT);
            window.setTimeout(() => {
              if (ctx && !ctx.disposed) {
                ctx.anim.speaking = false;
                triggerNod(-1);
              }
              resolve(ok);
            }, Math.max(0, remain));
          };

          if (typeof window !== 'undefined' && window.speechSynthesis) {
            return new Promise<boolean>((resolve) => {
              const utterance = new SpeechSynthesisUtterance(excerpt);
              utterance.lang = 'zh-CN';
              utterance.rate = 1.0;
              utterance.pitch = 1.0;

              let settled = false;
              const finish = (ok: boolean) => {
                if (settled) return;
                settled = true;
                release(ok, resolve);
              };
              utterance.onend = () => finish(true);
              utterance.onerror = () => finish(false);
              try {
                window.speechSynthesis.speak(utterance);
              } catch {
                finish(false);
              }
              // 硬兜底：TTS 卡死（onend/onerror 都不触发）时也按时长结束
              window.setTimeout(() => finish(false), estMs + 3000);
            });
          }

          return new Promise<boolean>((resolve) => release(true, resolve));
        },

        stop: () => {
          if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.cancel();
          }
          const ctx = sceneRef.current;
          if (ctx && !ctx.disposed) {
            ctx.anim.speaking = false;
          }
        },

        setSpeaking: (v: boolean) => {
          const ctx = sceneRef.current;
          if (ctx && !ctx.disposed) {
            const was = ctx.anim.speaking;
            ctx.anim.speaking = v;
            if (v && !was) triggerNod(1);
            if (!v && was) triggerNod(-1);
          }
        },

        setPersona: (id: string) => {
          const ctx = sceneRef.current;
          if (!ctx || ctx.disposed || ctx.personaId === id) return;
          const modelUrl = PERSONA_MODEL[id] || PERSONA_MODEL.zhang;
          ctx.personaId = id;
          loadGLB(modelUrl, ctx).catch((err) => {
            if (!ctx.disposed) {
              console.warn('[DigitalHumanGLB] setPersona 模型加载失败:', err);
            }
          });
        },
      }),
      [loadGLB, triggerNod],
    );

    return (
      <div
        ref={containerRef}
        className={className}
        style={{ width: '100%', height: '100%' }}
      />
    );
  },
);

DigitalHumanGLB.displayName = 'DigitalHumanGLB';
