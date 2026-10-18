/**
 * DigitalHumanGLB.tsx —— 写实工业风 3D 数字人 React 组件（GLB / Mixamo 骨骼）
 *
 * 职责：Three.js 场景初始化 / GLB 模型加载 / 渲染循环 / Mixamo 骨骼动画驱动 / 语音合成
 * 对外暴露 speak / stop / setSpeaking / setPersona 四个方法（与 DigitalHumanVRM / DigitalHuman3D 同构，
 * 可直接替换使用）。
 *
 * 模型：public/models/engineer/china_engineer.glb（中国男性工程师，腾讯混元3D 图生3D 生成，
 * 浅灰短袖+深蓝背带工装，~75MB 静态模型——无骨骼无动画，先解决"中国人脸"问题，
 * 绑骨/动画后续再补。）
 *
 * 历史：原先指向 asian_worker.glb，但该文件早已损坏（2.3KB，内容是 Sketchfab 网页 HTML，
 * 见 ATTRIBUTION.md 警告），GLTFLoader 解析失败后整个数字人降级成程序化安全帽小人。
 * 这里切到仓库里唯一完好的写实 GLB。
 *
 * 动画说明：
 *  - 待机：呼吸（Spine2 缩放）+ 头部微动 + 手臂自然微摆（程序化，Mixamo 骨骼名）；
 *  - 说话：播放内置 Armature|beszed 说话动画（头/肩/手臂律动）+ 程序化节律点头；
 *    （旧 asian_worker 的顶点级口型绑定按其厘米制顶点坐标写死，对本模型米制坐标
 *    安全跳过——setupMouthAnimation 命中 0 顶点后返回 null，不影响渲染。）
 *  - 站立朝向：由 ROTATE_Y 常量统一控制，默认正对相机；
 *  - 尺寸归一：统一归一化为 1.75m 标准身高。
 */

import React, { useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { speakChinese, cancelSpeech, primeSpeech, voiceGenderFor } from './speech';

// ─── Public interface (与 DigitalHumanVRM 同构) ──────────────────────────

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

// ─── Persona → model mapping ─────────────────────────────────────────────

// 当前数字人模型：中国工程师（腾讯混元3D 图生3D 生成）。
// 注意：这是静态模型（无骨骼/无动画），BONE 查找全部返回 null，
// 呼吸/头动/手臂摆动等程序化动画对它自动 no-op——模型站在网格上即可。
// 后续绑骨/换带骨骼模型时再切回带骨骼的 GLB。
const CHINA_ENGINEER_GLB = '/models/engineer/china_engineer.glb';

const PERSONA_MODEL: Record<string, string> = {
  zhang: CHINA_ENGINEER_GLB,
  li: CHINA_ENGINEER_GLB,
  zhi: CHINA_ENGINEER_GLB,
};

// ─── worker_talk.glb 实际骨骼映射（Mixamo 骨骼体系）──────────────────────
// Three.js GLTFLoader 在解析带有冒号的骨骼名（如 mixamorig:Hips_01）时会去除冒号。
// 这里使用清洗后的标准名，并通过 findBone 辅助函数保证双向兼容。
// 编号以本模型 JSON chunk 实际节点表为准：左臂 _08~_11，右臂 _19~_22。

export const BONE = {
  hips: 'mixamorigHips_01',
  spine: 'mixamorigSpine_02',
  spine1: 'mixamorigSpine1_03',
  spine2: 'mixamorigSpine2_04',
  neck: 'mixamorigNeck_05',
  head: 'mixamorigHead_06',
  headTop: 'mixamorigHeadTop_End_07',
  lShoulder: 'mixamorigLeftShoulder_08',
  lArm: 'mixamorigLeftArm_09',
  lForeArm: 'mixamorigLeftForeArm_010',
  lHand: 'mixamorigLeftHand_011',
  rShoulder: 'mixamorigRightShoulder_019',
  rArm: 'mixamorigRightArm_020',
  rForeArm: 'mixamorigRightForeArm_021',
  rHand: 'mixamorigRightHand_022',
} as const;

/** 稳健骨骼查找：双向兼容带冒号（mixamorig:Hips_01）与清洗后（mixamorigHips_01）格式 */
export function findBone(root: THREE.Object3D, name: string): THREE.Object3D | null {
  if (!root) return null;
  let b = root.getObjectByName(name);
  if (b) return b;
  if (name.startsWith('mixamorig') && !name.startsWith('mixamorig:')) {
    const colonName = name.replace(/^mixamorig/, 'mixamorig:');
    b = root.getObjectByName(colonName);
    if (b) return b;
  }
  if (name.includes(':')) {
    const noColonName = name.replace(/:/g, '');
    b = root.getObjectByName(noColonName);
    if (b) return b;
  }
  return null;
}

/** 探查并向浏览器控制台打印模型的骨骼与网格层级树 */
function printBoneHierarchy(root: THREE.Object3D) {
  const lines: string[] = [];
  const dump = (obj: THREE.Object3D, depth: number) => {
    const indent = '  '.repeat(depth);
    const tag = (obj as any).isBone
      ? '🦴 [Bone]'
      : (obj as any).isSkinnedMesh
      ? '🎭 [SkinnedMesh]'
      : (obj as any).isMesh
      ? '📦 [Mesh]'
      : `[${obj.type}]`;
    lines.push(`${indent}${tag} ${obj.name || '(unnamed)'}`);
    for (const child of obj.children) {
      dump(child, depth + 1);
    }
  };
  dump(root, 0);

  // eslint-disable-next-line no-console
  console.groupCollapsed('[worker_talk.glb] 骨骼层级与节点树');
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
  // eslint-disable-next-line no-console
  console.log('[worker_talk.glb] 实际关键骨骼对应关系:', {
    hips: findBone(root, BONE.hips)?.name ?? '未找到',
    spine: findBone(root, BONE.spine)?.name ?? '未找到',
    neck: findBone(root, BONE.neck)?.name ?? '未找到',
    head: findBone(root, BONE.head)?.name ?? '未找到',
    leftArm: findBone(root, BONE.lArm)?.name ?? '未找到',
    rightArm: findBone(root, BONE.rArm)?.name ?? '未找到',
  });
  // eslint-disable-next-line no-console
  console.groupEnd();
}

// ─── 动画状态 ─────────────────────────────────────────────────────────────

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

// ─── 程序化嘴部（口型）绑定 ───────────────────────────────────────────────
// 本模型 worker_talk.glb 为米制写实人体（身高 ~1.75m，头部 Y≈1.4~1.74），
// 下面的顶点筛选范围（Y∈[135,138.8]）是旧 asian_worker.glb 的厘米制坐标，
// 对本模型命中 0 个顶点 → setupMouthAnimation 安全返回 null（try/catch 已兜底）。
// 说话口型由内置 Armature|beszed 动画本身的头肩律动承担，不影响渲染。

interface MouthRig {
  faceMesh: THREE.SkinnedMesh;
  faceIdx: number[];
  faceWeights: number[];
  faceBase: Float32Array;

  teethMesh: THREE.SkinnedMesh | null;
  teethIdx: number[];
  teethBase: Float32Array | null;

  tongueMesh: THREE.SkinnedMesh | null;
  tongueIdx: number[];
  tongueBase: Float32Array | null;
}

function setupMouthAnimation(root: THREE.Group): MouthRig | null {
  try {
    let faceMesh: THREE.SkinnedMesh | null = null;
    let teethMesh: THREE.SkinnedMesh | null = null;
    let tongueMesh: THREE.SkinnedMesh | null = null;

    root.traverse((o) => {
      if (!(o instanceof THREE.SkinnedMesh)) return;
      const n = (o.name || '').toLowerCase();
      const matNames = Array.isArray(o.material)
        ? o.material.map((m) => (m?.name || '').toLowerCase()).join(' ')
        : (o.material?.name || '').toLowerCase();
      const combo = n + ' ' + matNames;

      if (combo.includes('muscle') || combo.includes('high-poly') || o.name === 'Object_94') {
        faceMesh = o;
      } else if (combo.includes('teeth') || o.name === 'Object_92') {
        teethMesh = o;
      } else if (combo.includes('tongue') || o.name === 'Object_88') {
        tongueMesh = o;
      }
    });

    // 兜底：若未按名字命中 faceMesh，选取顶点数最多的 SkinnedMesh
    if (!faceMesh) {
      let maxCount = 0;
      root.traverse((o) => {
        if (o instanceof THREE.SkinnedMesh && o.geometry?.attributes?.position) {
          const count = o.geometry.attributes.position.count;
          if (count > maxCount) {
            maxCount = count;
            faceMesh = o;
          }
        }
      });
    }

    if (!faceMesh) return null;

    const fPos = faceMesh.geometry.attributes.position;
    const faceIdx: number[] = [];
    const faceWeights: number[] = [];

    // 下唇与下巴顶点范围（几何坐标系中 Y ∈ [135.0, 138.8], Z > 11.5, |X| < 2.5）
    for (let i = 0; i < fPos.count; i++) {
      const x = fPos.getX(i);
      const y = fPos.getY(i);
      const z = fPos.getZ(i);
      if (Math.abs(x) < 2.5 && y >= 135.0 && y <= 138.8 && z > 11.5) {
        const xDist = Math.abs(x) / 2.5; // 0..1
        const yDist = (y - 135.0) / (138.8 - 135.0); // 0 下巴底部 .. 1 下唇边缘
        const zDist = Math.max(0, Math.min(1, (z - 11.5) / 3.0));
        // 权重：下唇中心最大，向嘴角和下巴自然递减
        const w = Math.pow(1 - xDist, 1.5) * (0.3 + 0.7 * yDist) * zDist;
        if (w > 0.05) {
          faceIdx.push(i);
          faceWeights.push(w);
        }
      }
    }

    if (faceIdx.length < 10) return null;
    const faceBase = new Float32Array(fPos.array);

    // 下牙顶点索引（Y < 137.8 为下齿）
    let teethIdx: number[] = [];
    let teethBase: Float32Array | null = null;
    if (teethMesh) {
      const tPos = teethMesh.geometry.attributes.position;
      teethBase = new Float32Array(tPos.array);
      for (let i = 0; i < tPos.count; i++) {
        if (tPos.getY(i) < 137.8) {
          teethIdx.push(i);
        }
      }
    }

    // 舌头顶点索引
    let tongueIdx: number[] = [];
    let tongueBase: Float32Array | null = null;
    if (tongueMesh) {
      const tgPos = tongueMesh.geometry.attributes.position;
      tongueBase = new Float32Array(tgPos.array);
      for (let i = 0; i < tgPos.count; i++) {
        tongueIdx.push(i);
      }
    }

    return {
      faceMesh,
      faceIdx,
      faceWeights,
      faceBase,
      teethMesh,
      teethIdx,
      teethBase,
      tongueMesh,
      tongueIdx,
      tongueBase,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[DigitalHumanGLB] 口型绑定初始化异常:', err);
    return null;
  }
}

// ─── 尺寸、朝向与相机构图常量 ─────────────────────────────────────────────

// 相机半身构图（聚焦写实人脸与上半身手势）
const CAM_POS = new THREE.Vector3(0, 1.24, 1.72);
const CAM_TARGET = new THREE.Vector3(0, 1.18, 0);
const FOV = 38;

// 目标身高（米）：归一化为 1.75m 真实工业人像标准
const TARGET_HEIGHT = 1.75;

// 模型水平旋转偏角（弧度）：0 保持默认正对相机；可调整此常量
const ROTATE_Y = 0;

// 说话动画候选名（仅播放匹配的说话/手势动画，过滤死亡倒地动作）
const SPEAK_CLIP_NAME = 'Armature|beszed';

// ─── Component ────────────────────────────────────────────────────────────

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
      cancelSpeak: (() => void) | null;
    } | null>(null);

    // ── Load GLB model ──────────────────────────────────────────────────────

    const loadGLB = useCallback((url: string, ctx: NonNullable<typeof sceneRef.current>): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        const loader = new GLTFLoader();
        // EXT_meshopt_compression：模型经 gltf-transform meshopt 压缩（78MB→8.5MB），需解码器
        loader.setMeshoptDecoder(MeshoptDecoder);
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

          // 0. 朝向修正：模型已经是站立的，不需要额外旋转
          // if (url.includes('china_engineer')) {
          //   root.rotation.x = Math.PI / 2;
          // }

          // 1. 模型尺寸归一化：按身高缩放至 1.75m
          const box = new THREE.Box3().setFromObject(root);
          const size = box.getSize(new THREE.Vector3());
          const h = size.y;
          if (Number.isFinite(h) && h > 0.01 && Math.abs(h - TARGET_HEIGHT) > 0.02) {
            root.scale.setScalar(TARGET_HEIGHT / h);
            root.updateMatrixWorld(true);
          }

          // 2. 位置调整：脚底置于 y=0 平面，水平 X/Z 轴居中
          const box2 = new THREE.Box3().setFromObject(root);
          const min2 = box2.min;
          const center2 = box2.getCenter(new THREE.Vector3());
          root.position.y -= min2.y;
          root.position.x -= center2.x;
          if (Number.isFinite(center2.z) && Math.abs(center2.z) < 5) {
            root.position.z -= center2.z;
          }

          // 3. 模型朝向调整：正对相机
          root.rotation.y = ROTATE_Y;
          root.updateMatrixWorld(true);

          // 4. 打印新模型骨骼层级与映射关系
          try {
            printBoneHierarchy(root);
          } catch {}

          // 5. 动画混音器：仅当找到合法说话/手势动画时才播放，过滤无关动作
          let mixer: THREE.AnimationMixer | null = null;
          let speakAction: THREE.AnimationAction | null = null;
          if (gltf.animations && gltf.animations.length > 0) {
            const talkClip = gltf.animations.find((a) => {
              const cn = (a.name || '').toLowerCase();
              return cn === SPEAK_CLIP_NAME.toLowerCase() || cn.includes('talk') || cn.includes('speak') || cn.includes('beszed');
            });
            if (talkClip) {
              mixer = new THREE.AnimationMixer(root);
              speakAction = mixer.clipAction(talkClip);
              speakAction.setLoop(THREE.LoopRepeat, Infinity);
              speakAction.setEffectiveWeight(0);
              speakAction.clampWhenFinished = true;
            }
          }
          ctx.mixer = mixer;
          ctx.speakAction = speakAction;

          // 6. 程序化口型绑定
          try {
            ctx.mouth = setupMouthAnimation(root);
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[DigitalHumanGLB] 口型绑定失败:', e);
            ctx.mouth = null;
          }

          // 7. 材质保持写实双面渲染
          root.traverse((o) => {
            if (o instanceof THREE.Mesh) {
              const mats = Array.isArray(o.material) ? o.material : [o.material];
              mats.forEach((m) => {
                if (m) {
                  m.side = THREE.DoubleSide;
                  m.needsUpdate = true;
                }
              });
            }
          });

          // 调试钩子
          (window as any).__dhScene = root;
          ctx.root = root;
          ctx.anim = freshAnimState();
          resolve();
        }).catch((err) => {
          if (!ctx.disposed) reject(err);
        });
      });
    }, []);

    // ── Scene lifecycle ─────────────────────────────────────────────────────

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

      // 灯光配置
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
        cancelSpeak: null as (() => void) | null,
      };
      sceneRef.current = ctx;

      const modelUrl = PERSONA_MODEL[personaId] || PERSONA_MODEL.zhang;
      loadGLB(modelUrl, ctx).catch((err) => {
        if (!ctx.disposed) {
          // eslint-disable-next-line no-console
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

        // 动画混音器推进（若有说话动画动作）
        if (ctx.mixer) {
          ctx.mixer.update(dt / 1000);
          if (ctx.speakAction) {
            const target = a.speaking ? 1 : 0;
            a.speakWeight += (target - a.speakWeight) * 0.1;
            ctx.speakAction.setEffectiveWeight(a.speakWeight);
            if (a.speakWeight > 0.01) ctx.speakAction.play();
            else ctx.speakAction.stop();
          }
        }

        // ── 待机：胸腔呼吸（Spine2 细微缩放）──
        const breathPhase = (t * Math.PI * 2) / 4000;
        const spine2 = findBone(root, BONE.spine2);
        if (spine2) {
          const bs = 1 + 0.012 * Math.sin(breathPhase);
          spine2.scale.set(bs, bs, bs);
        }

        // ── 待机：头部自然微动 ──
        const head = findBone(root, BONE.head);
        if (head && !a.speaking) {
          head.rotation.y = 0.03 * Math.sin((t * Math.PI * 2) / 7000) + 0.02 * Math.sin((t * Math.PI * 2) / 11000);
          head.rotation.z = 0.012 * Math.sin((t * Math.PI * 2) / 5000);
        }

        // ── 待机：手臂自然微摆 ──
        if (!a.speaking) {
          const swingT = t / 1000;
          const swingZ = 0.05 * Math.sin(swingT * 1.8 + a.phaseL);
          const lArm = findBone(root, BONE.lArm);
          const rArm = findBone(root, BONE.rArm);
          if (lArm) lArm.rotation.z = 0.1 + swingZ;
          if (rArm) rArm.rotation.z = -0.1 - swingZ;
          const lFore = findBone(root, BONE.lForeArm);
          const rFore = findBone(root, BONE.rForeArm);
          if (lFore) lFore.rotation.x = -0.1;
          if (rFore) rFore.rotation.x = -0.1;
        }

        // ── 说话：节律性轻点头 ──
        if (a.nodProgress >= 0 && head) {
          a.nodProgress += dt / 400;
          if (a.nodProgress >= 1) {
            a.nodProgress = -1;
            head.rotation.x = 0;
          } else {
            head.rotation.x = a.nodDir * 0.05 * Math.sin(a.nodProgress * Math.PI);
          }
        }

        // ── 说话：程序化嘴部开合与联动形变 ──
        const mouth = ctx.mouth;
        if (mouth) {
          const target = a.speaking ? 1 : 0;
          a.mouthOpen += (target - a.mouthOpen) * 0.15;
          if (a.mouthOpen > 0.002) {
            const sec = t / 1000;
            // 真实说话时口型节奏：主频约 2.9Hz + 辅频 5Hz 震荡
            const rhythm = 0.5 + 0.3 * Math.sin(sec * 18.2) + 0.2 * Math.sin(sec * 31.4 + 1.3);
            const deltaY = 0.42 * a.mouthOpen * rhythm;
            const deltaZ = 0.06 * a.mouthOpen * rhythm;

            // 1. 面部下唇与下巴形变
            const fPos = mouth.faceMesh.geometry.attributes.position;
            const fArr = fPos.array as Float32Array;
            for (let k = 0; k < mouth.faceIdx.length; k++) {
              const vi = mouth.faceIdx[k] * 3;
              const w = mouth.faceWeights[k];
              fArr[vi + 1] = mouth.faceBase[vi + 1] - deltaY * w;
              fArr[vi + 2] = mouth.faceBase[vi + 2] + deltaZ * w;
            }
            fPos.needsUpdate = true;

            // 2. 下齿联动下移
            if (mouth.teethMesh && mouth.teethBase) {
              const tPos = mouth.teethMesh.geometry.attributes.position;
              const tArr = tPos.array as Float32Array;
              const teethDelta = deltaY * 0.8;
              for (let k = 0; k < mouth.teethIdx.length; k++) {
                const vi = mouth.teethIdx[k] * 3;
                tArr[vi + 1] = mouth.teethBase[vi + 1] - teethDelta;
              }
              tPos.needsUpdate = true;
            }

            // 3. 舌头联动微移
            if (mouth.tongueMesh && mouth.tongueBase) {
              const tgPos = mouth.tongueMesh.geometry.attributes.position;
              const tgArr = tgPos.array as Float32Array;
              const tgDelta = deltaY * 0.5;
              for (let k = 0; k < mouth.tongueIdx.length; k++) {
                const vi = mouth.tongueIdx[k] * 3;
                tgArr[vi + 1] = mouth.tongueBase[vi + 1] - tgDelta;
              }
              tgPos.needsUpdate = true;
            }
          } else if (a.mouthOpen !== 0) {
            // 完全闭合时精确恢复原始顶点
            const fPos = mouth.faceMesh.geometry.attributes.position;
            const fArr = fPos.array as Float32Array;
            for (let k = 0; k < mouth.faceIdx.length; k++) {
              const vi = mouth.faceIdx[k] * 3;
              fArr[vi + 1] = mouth.faceBase[vi + 1];
              fArr[vi + 2] = mouth.faceBase[vi + 2];
            }
            fPos.needsUpdate = true;

            if (mouth.teethMesh && mouth.teethBase) {
              const tPos = mouth.teethMesh.geometry.attributes.position;
              const tArr = tPos.array as Float32Array;
              for (let k = 0; k < mouth.teethIdx.length; k++) {
                const vi = mouth.teethIdx[k] * 3;
                tArr[vi + 1] = mouth.teethBase[vi + 1];
              }
              tPos.needsUpdate = true;
            }

            if (mouth.tongueMesh && mouth.tongueBase) {
              const tgPos = mouth.tongueMesh.geometry.attributes.position;
              const tgArr = tgPos.array as Float32Array;
              for (let k = 0; k < mouth.tongueIdx.length; k++) {
                const vi = mouth.tongueIdx[k] * 3;
                tgArr[vi + 1] = mouth.tongueBase[vi + 1];
              }
              tgPos.needsUpdate = true;
            }
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
        try {
          ctx.cancelSpeak?.();
        } catch {}

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

    // ── Sync personaId ───────────────────────────────────────────────────────
    useEffect(() => {
      const ctx = sceneRef.current;
      if (!ctx || ctx.disposed || ctx.personaId === personaId) return;
      ctx.personaId = personaId;
      const modelUrl = PERSONA_MODEL[personaId] || PERSONA_MODEL.zhang;
      loadGLB(modelUrl, ctx).catch((err) => {
        if (!ctx.disposed) {
          // eslint-disable-next-line no-console
          console.warn('[DigitalHumanGLB] 切换人设模型失败:', err);
          onErrorRef.current?.(err);
        }
      });
    }, [personaId, loadGLB]);

    // ── Sync isSpeaking prop ─────────────────────────────────────────────────
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

    // ── Imperative handle ───────────────────────────────────────────────────

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

          const startT = Date.now();
          const estMs = Math.min(Math.max(clean.length * 150, 2500), 9000);

          try {
            ctx.cancelSpeak?.();
          } catch {}

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

          primeSpeech();
          const handle = speakChinese(clean, {
            gender: voiceGenderFor(ctx.personaId),
            onEnd: () => {
              if (ctx && !ctx.disposed) ctx.cancelSpeak = null;
            },
          });
          ctx.cancelSpeak = handle.cancel;

          return new Promise<boolean>((resolve) => {
            handle.promise
              .then((spoken) => release(spoken, resolve))
              .catch(() => release(false, resolve));
          });
        },

        stop: () => {
          const ctx = sceneRef.current;
          try {
            ctx?.cancelSpeak?.();
          } catch {}
          if (ctx) ctx.cancelSpeak = null;
          cancelSpeech();
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
              // eslint-disable-next-line no-console
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
