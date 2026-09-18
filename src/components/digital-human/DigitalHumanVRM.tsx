/**
 * DigitalHumanVRM.tsx — VRM 3D 数字人 React 组件（三人设差异化 · 工业风装备）
 *
 * 职责：Three.js 场景初始化 / VRM 模型加载 / 渲染循环 / 程序化动画 / 中文语音合成
 * 对外暴露 speak / stop / setSpeaking / setPersona 四个方法（与 DigitalHumanGLB 同构，
 * 可直接替换使用）。
 *
 * ── 三人设差异化（本文件的核心变更）────────────────────────────────
 * 三个 VRoid 官方示例模型是三个不同的角色，按人设一一映射：
 *   张工 → AvatarSample_A.vrm   李工 → AvatarSample_B.vrm   小智 → AvatarSample_C.vrm
 * 再通过 `industrialGear.ts` 程序化挂上**安全帽 + 反光背心 + 发光胸章**
 * （张工蓝 / 李工绿 / 小智青），保证三个人一眼可辨且贴合工业检修场景。
 *
 * ── 模型来源与许可 ───────────────────────────────────────────────
 * VRoid Studio 官方示例模型（AvatarSample A/B/C）。模型内嵌许可证
 * （`vrm.meta.licenseUrl` → hub.vroid.com/license）明确：
 *   corporate_commercial_use = allow、modification = allow、credit = unnecessary
 * 即**可商用、可修改、无需署名**。模型文件位于 public/models/，运行时走本地静态资源，无外网依赖。
 *
 * ── 依赖 ────────────────────────────────────────────────────────
 * three@0.186.0、@pixiv/three-vrm@3.5.5（项目已装）。
 * 三个模型均为 VRM 0.x：54 骨骼、表情 A/I/U/E/O + Blink（three-vrm 会内部映射为
 * VRM 1.0 的 aa/ih/oh/blink 预设名，所以 setValue 用 1.0 名字即可）。
 * 模型**不含内置动画**，所有动作均为程序化生成。
 *
 * ── 动画说明 ────────────────────────────────────────────────────
 *  - 眨眼：VRM BlendShape（Blink）
 *  - 口型：VRM BlendShape（aa / ih / oh 交替），由**真实语音事件**驱动开合
 *  - 点头/头动：Humanoid Head 骨骼
 *  - 手臂手势：Humanoid 上臂骨骼（说话姿态微抬，左右对称）
 *  - 呼吸：Spine 骨骼缩放
 */

import React, { useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, VRMHumanBoneName } from '@pixiv/three-vrm';
import type { VRM } from '@pixiv/three-vrm';
import { attachIndustrialGear, detachIndustrialGear } from './industrialGear';
import { speakChinese, cancelSpeech, primeSpeech, voiceGenderFor } from './speech';

// ─── Public interface ─────────────────────────────────────────────

export interface DigitalHumanVRMHandle {
  speak: (text: string) => Promise<boolean>;
  stop: () => void;
  setSpeaking: (v: boolean) => void;
  setPersona: (id: string) => void;
}

interface DigitalHumanVRMProps {
  personaId: string;
  isSpeaking?: boolean;
  className?: string;
  onError?: (error: any) => void;
  /** 真实发声状态回传（供上层统一"播报中"UI，避免各处状态不一致） */
  onSpeakingChange?: (speaking: boolean) => void;
  /** 模型加载完成回调（含实测尺寸，便于验收/单测） */
  onReady?: (info: {
    personaId: string;
    torsoLen: number;
    headTopY: number;
    headRadius: number;
    torsoHalfDepth: number;
  }) => void;
}

// ─── Persona → VRM model mapping（三人设 = 三个不同角色）─────────────

export const PERSONA_MODEL: Record<string, string> = {
  zhang: '/models/AvatarSample_A.vrm',
  li: '/models/AvatarSample_B.vrm',
  zhi: '/models/AvatarSample_C.vrm',
};

/** 人设 → 中文音色性别倾向（定义在 speech.ts，与 DIGITAL_PERSONAS.gender 对齐） */

export function modelUrlFor(personaId: string): string {
  return PERSONA_MODEL[personaId] || PERSONA_MODEL.zhang;
}

// ─── Animation state (mutable, not React state) ───────────────────

interface AnimState {
  speaking: boolean;
  /* blink */
  blinkCountdown: number;   // ms until next blink
  blinkProgress: number;    // -1 = idle, 0..1 = blinking
  /* nod */
  nodProgress: number;      // -1 = idle, 0..1 = nodding
  nodDir: number;           // +1 or -1
  /* jaw */
  jawWeight: number;        // current mouth open weight 0..1
  jawTarget: number;        // target mouth open weight
  jawShape: 'aa' | 'ih' | 'oh'; // current mouth shape（VRM 1.0 预设名）
  jawCycle: number;         // ms countdown for next jaw target change
  /* speech-driven mouth boost（真实语音 boundary 事件累积，随帧衰减） */
  speechPulse: number;
}

function freshAnimState(): AnimState {
  return {
    speaking: false,
    blinkCountdown: 2500 + Math.random() * 2000,
    blinkProgress: -1,
    nodProgress: -1,
    nodDir: 1,
    jawWeight: 0,
    jawTarget: 0,
    jawShape: 'aa',
    jawCycle: 0,
    speechPulse: 0,
  };
}

// ─── Constants ────────────────────────────────────────────────────

// 相机微调至腰部以上半身构图（聚焦面部表情、呼吸胸腔与说话手势）
const CAM_POS = new THREE.Vector3(0, 1.22, 1.68);
const CAM_TARGET = new THREE.Vector3(0, 1.16, 0);
const FOV = 38;

// VRM 绑定姿势是 T-pose（手臂水平平伸，rot.z = 0）。
// 自然站姿下垂：大臂下垂至体侧（约 72° / 1.26 rad），避免穿模；手肘微曲，双手自然垂于身侧。
// 说话状态：双手小幅前抬微动（约 62° / 1.08 rad），动作自然得体，绝不高举双臂。
const LEFT_ARM_REST_Z = 1.26;    // 左大臂待机：自然下垂（体侧微外展）
const RIGHT_ARM_REST_Z = -1.26;  // 右大臂待机：对称下垂
const ARM_REST_X = 0.08;         // 大臂自然微前倾

const LEFT_ARM_SPEAK_Z = 1.08;   // 说话时：左大臂微抬约 10°
const RIGHT_ARM_SPEAK_Z = -1.08; // 说话时：右大臂微抬
const ARM_SPEAK_X = 0.18;        // 说话时：大臂前探

function applyNaturalPose(vrm: VRM): void {
  const hum = vrm.humanoid;
  if (!hum) return;
  const lUpper = hum.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm);
  const rUpper = hum.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm);
  const lLower = hum.getNormalizedBoneNode(VRMHumanBoneName.LeftLowerArm);
  const rLower = hum.getNormalizedBoneNode(VRMHumanBoneName.RightLowerArm);
  const lHand = hum.getNormalizedBoneNode(VRMHumanBoneName.LeftHand);
  const rHand = hum.getNormalizedBoneNode(VRMHumanBoneName.RightHand);
  if (lUpper) lUpper.rotation.set(ARM_REST_X, 0, LEFT_ARM_REST_Z);
  if (rUpper) rUpper.rotation.set(ARM_REST_X, 0, RIGHT_ARM_REST_Z);
  if (lLower) lLower.rotation.set(-0.16, 0, 0.12);  // 手肘微弯放松向前
  if (rLower) rLower.rotation.set(-0.16, 0, -0.12);
  if (lHand) lHand.rotation.set(0, 0, 0);  // 手掌放松下垂
  if (rHand) rHand.rotation.set(0, 0, 0);
}

// ─── Expression helper（统一走 VRM 1.0 预设名，three-vrm 内部映射 0.x）──

function setExpression(vrm: VRM, name: string, value: number): void {
  const em = vrm.expressionManager;
  if (!em) return;
  try {
    em.setValue(name, value);
  } catch {
    /* 某些模型可能缺该预设，忽略即可 */
  }
}

// ─── Component ────────────────────────────────────────────────────

export const DigitalHumanVRM = forwardRef<DigitalHumanVRMHandle, DigitalHumanVRMProps>(
  ({ personaId, isSpeaking = false, className = '', onError, onSpeakingChange, onReady }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;
    const onSpeakingChangeRef = useRef(onSpeakingChange);
    onSpeakingChangeRef.current = onSpeakingChange;
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;

    // Mutable refs for Three.js objects (not React state to avoid re-renders)
    const sceneRef = useRef<{
      renderer: THREE.WebGLRenderer;
      scene: THREE.Scene;
      camera: THREE.PerspectiveCamera;
      vrm: VRM | null;
      grid: THREE.GridHelper;
      animId: number;
      anim: AnimState;
      lastTime: number;
      disposed: boolean;
      personaId: string;
      loadSeq: number;
      /** 当前朗读句柄的取消函数（切换/打断时调用） */
      cancelSpeak: (() => void) | null;
    } | null>(null);

    /** 统一维护"真实发声状态"，同时回传上层 */
    const setSpeakingState = useCallback((v: boolean) => {
      const ctx = sceneRef.current;
      if (ctx && !ctx.disposed) {
        const was = ctx.anim.speaking;
        ctx.anim.speaking = v;
        if (v && !was) {
          ctx.anim.nodProgress = 0;
          ctx.anim.nodDir = 1;
        } else if (!v && was) {
          ctx.anim.nodProgress = 0;
          ctx.anim.nodDir = -1;
        }
      }
      onSpeakingChangeRef.current?.(v);
    }, []);

    // ── Load VRM model (async) ──────────────────────────────────

    const loadVRM = useCallback((url: string, ctx: NonNullable<typeof sceneRef.current>): Promise<void> => {
      const seq = ++ctx.loadSeq;
      return new Promise<void>((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));
        loader.loadAsync(url).then((gltf) => {
          // 组件已卸载 / 期间又切换了人设 → 丢弃这次结果，避免"旧模型覆盖新模型"
          if (ctx.disposed || seq !== ctx.loadSeq) {
            VRMUtils.deepDispose(gltf.scene);
            resolve();
            return;
          }
          const vrm = gltf.userData.vrm as VRM | undefined;
          if (!vrm) {
            VRMUtils.deepDispose(gltf.scene);
            reject(new Error('模型未包含 VRM 数据: ' + url));
            return;
          }
          // Replace old model
          if (ctx.vrm) {
            detachIndustrialGear(ctx.vrm.scene);
            ctx.scene.remove(ctx.vrm.scene);
            VRMUtils.deepDispose(ctx.vrm.scene);
          }
          ctx.scene.add(vrm.scene);

          // VRM 0.x 模型默认面向 -Z（背对镜头），转 180° 面向 +Z。
          // rotateVRM0 内部自带 metaVersion === '0' 守卫，对 VRM1 是空操作。
          VRMUtils.rotateVRM0(vrm);
          // T-pose 绑定姿势 → 自然站姿（手臂下垂，不再平伸）
          applyNaturalPose(vrm);

          // 自动对齐：无论模型原点在脚底还是重心，都把脚底归到 y=0，
          // 避免模型悬空（"飞起来"）。x/z 方向居中。
          const box = new THREE.Box3().setFromObject(vrm.scene);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          if (Number.isFinite(size.y) && size.y > 0.01) {
            vrm.scene.position.y -= box.min.y;
          }
          if (Number.isFinite(center.x) && Math.abs(center.x) < 5) {
            vrm.scene.position.x -= center.x;
          }
          if (Number.isFinite(center.z) && Math.abs(center.z) < 5) {
            vrm.scene.position.z -= center.z;
          }

          // 人设专属工业装备（安全帽 / 反光背心 / 发光胸章）
          let measurement = null;
          try {
            measurement = attachIndustrialGear(vrm, ctx.personaId);
            // 诊断出口：验收脚本可读取实测的头/躯干尺寸，确认"尺寸是量出来的"
            if (typeof window !== 'undefined') {
              (window as unknown as { __digitalHumanGear?: unknown }).__digitalHumanGear = measurement;
            }
          } catch (e) {
            console.warn('[DigitalHumanVRM] 工业装备装配失败（不影响人物渲染）:', e);
          }

          ctx.vrm = vrm;
          ctx.anim = freshAnimState();
          // 语音音色需要音色表就绪，加载完成时顺手预热
          primeSpeech();
          if (measurement) {
            onReadyRef.current?.({
              personaId: ctx.personaId,
              torsoLen: measurement.torsoLen,
              headTopY: measurement.head.topY,
              headRadius: measurement.head.radius,
              torsoHalfDepth: measurement.torso.halfDepth,
            });
          }
          resolve();
        }).catch((err) => {
          if (!ctx.disposed && seq === ctx.loadSeq) reject(err);
        });
      });
    }, []);

    // ── Scene lifecycle ─────────────────────────────────────────

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      // StrictMode 双挂载幂等：先清掉容器里的残留 canvas
      container.querySelectorAll('canvas').forEach((c) => c.remove());

      // --- Renderer ---
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

      // --- Camera ---
      const camera = new THREE.PerspectiveCamera(FOV, w / h, 0.1, 100);
      camera.position.copy(CAM_POS);
      camera.lookAt(CAM_TARGET);

      // --- Scene ---
      const scene = new THREE.Scene();

      // --- 工业风虚拟工厂透明网格地板 ---
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

      // --- Lights (工业科技风：主光冷白 5000K + 补光偏青 + 轮廓光 + 低饱和度环境光) ---
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
        vrm: null as VRM | null,
        grid,
        animId: 0,
        anim,
        lastTime: performance.now(),
        disposed: false,
        personaId,
        loadSeq: 0,
        cancelSpeak: null as (() => void) | null,
      };
      sceneRef.current = ctx;

      // --- Load initial model ---
      loadVRM(modelUrlFor(personaId), ctx).catch((err) => {
        if (!ctx.disposed) {
          console.warn('[DigitalHumanVRM] 模型加载失败:', err);
          onErrorRef.current?.(err);
        }
      });

      // --- Resize observer ---
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

      // --- rAF animation loop ---
      const tick = (now: number) => {
        if (ctx.disposed) return;
        ctx.animId = requestAnimationFrame(tick);

        const dt = Math.min(now - ctx.lastTime, 100); // cap delta to avoid jumps
        ctx.lastTime = now;
        const t = now; // absolute time for periodic functions

        const { vrm, anim: a } = ctx;
        if (!vrm) {
          // Model still loading — render empty (transparent) frame
          renderer.render(scene, camera);
          return;
        }

        // three-vrm requires per-frame update
        vrm.update(dt / 1000);

        // ── A. Idle: Breathing (Spine) ──
        const breathPhase = (t * Math.PI * 2) / 4000;
        const spine = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Spine);
        if (spine) {
          const bs = 1 + 0.012 * Math.sin(breathPhase);
          spine.scale.set(bs, bs, bs);
        }

        // ── A. Idle: Head micro-motion ──
        const head = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);
        if (head) {
          head.rotation.y = 0.035 * Math.sin((t * Math.PI * 2) / 7000) + 0.02 * Math.sin((t * Math.PI * 2) / 11000);
          head.rotation.z = 0.015 * Math.sin((t * Math.PI * 2) / 5000);
        }

        // ── A. Idle: Blink (BlendShape) ──
        if (a.blinkProgress < 0) {
          a.blinkCountdown -= dt;
          if (a.blinkCountdown <= 0) a.blinkProgress = 0;
        } else {
          a.blinkProgress += dt / 150; // 150ms blink duration
          if (a.blinkProgress >= 1) {
            a.blinkProgress = -1;
            a.blinkCountdown = 2500 + Math.random() * 2000;
            setExpression(vrm, 'blink', 0);
          } else {
            const squish = Math.pow(Math.sin(a.blinkProgress * Math.PI), 0.5);
            setExpression(vrm, 'blink', squish);
          }
        }

        // ── B. Speaking: Jaw / lip sync (BlendShape) ──
        // 口型由**真实语音事件**驱动：speak() 里 onStart 置位、onEnd 复位，
        // onBoundary 每次累加 speechPulse 让嘴型跟随真实语句节奏跳动。
        if (a.speaking) {
          a.jawCycle -= dt;
          if (a.jawCycle <= 0) {
            a.jawTarget = 0.35 + Math.random() * 0.65; // 0.35 ~ 1.0
            a.jawCycle = 180 + Math.random() * 140;     // 180~320ms
            const shapes: Array<'aa' | 'ih' | 'oh'> = ['aa', 'ih', 'oh'];
            a.jawShape = shapes[Math.floor(Math.random() * shapes.length)];
          }
          a.jawWeight += (a.jawTarget - a.jawWeight) * 0.3;
        } else {
          a.jawWeight += (0 - a.jawWeight) * 0.12;
        }
        // speechPulse 随帧衰减，叠加到当前口型上（boundary 越密集，嘴动越明显）
        a.speechPulse = Math.max(0, a.speechPulse - dt / 420);
        const jawOut = Math.min(1, a.jawWeight + a.speechPulse * 0.45);
        setExpression(vrm, 'aa', a.jawShape === 'aa' ? jawOut : 0);
        setExpression(vrm, 'ih', a.jawShape === 'ih' ? jawOut : 0);
        setExpression(vrm, 'oh', a.jawShape === 'oh' ? jawOut : 0);

        // ── B. Speaking: Head nod ──
        if (a.nodProgress >= 0) {
          a.nodProgress += dt / 400; // 400ms nod duration
          if (a.nodProgress >= 1) {
            a.nodProgress = -1;
            if (head) head.rotation.x = 0;
          } else if (head) {
            head.rotation.x = a.nodDir * 0.06 * Math.sin(a.nodProgress * Math.PI);
          }
        }

        // ── B. Speaking / Idle: Arm gesture（正弦微摆 + 平滑插值，双手始终有自然动感）──
        const swingT = t / 1000;
        const idleSwingZ = 0.07 * Math.sin(swingT * 2.2);
        const idleSwingX = 0.05 * Math.sin(swingT * 1.6 + 1.2);
        const speakSwingZ = a.speaking ? 0.14 * Math.sin(swingT * 6.0) : 0;
        const speakSwingX = a.speaking ? 0.1 * Math.sin(swingT * 4.6) : 0;

        const targetArmZ_L = (a.speaking ? LEFT_ARM_SPEAK_Z : LEFT_ARM_REST_Z) + idleSwingZ + speakSwingZ;
        const targetArmZ_R = (a.speaking ? RIGHT_ARM_SPEAK_Z : RIGHT_ARM_REST_Z) - idleSwingZ - speakSwingZ;
        const targetArmX = (a.speaking ? ARM_SPEAK_X : ARM_REST_X) + idleSwingX + speakSwingX;
        const targetElbowX = a.speaking ? -0.26 : -0.16;
        const lerpSpeed = 0.08;

        const leftArm = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm);
        const rightArm = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm);
        const leftLower = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.LeftLowerArm);
        const rightLower = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.RightLowerArm);

        if (leftArm) {
          leftArm.rotation.z += (targetArmZ_L - leftArm.rotation.z) * lerpSpeed;
          leftArm.rotation.x += (targetArmX - leftArm.rotation.x) * lerpSpeed;
        }
        if (rightArm) {
          rightArm.rotation.z += (targetArmZ_R - rightArm.rotation.z) * lerpSpeed;
          rightArm.rotation.x += (targetArmX - rightArm.rotation.x) * lerpSpeed;
        }
        if (leftLower) {
          leftLower.rotation.x += (targetElbowX - leftLower.rotation.x) * lerpSpeed;
          leftLower.rotation.z += (0.12 - leftLower.rotation.z) * lerpSpeed;
        }
        if (rightLower) {
          rightLower.rotation.x += (targetElbowX - rightLower.rotation.x) * lerpSpeed;
          rightLower.rotation.z += (-0.12 - rightLower.rotation.z) * lerpSpeed;
        }

        // ── Render ──
        renderer.render(scene, camera);
      };

      ctx.animId = requestAnimationFrame(tick);

      // --- Cleanup ---
      return () => {
        ctx.disposed = true;
        ctx.loadSeq++; // 让在途加载结果作废
        cancelAnimationFrame(ctx.animId);
        ro.disconnect();
        try {
          ctx.cancelSpeak?.();
        } catch {}

        // Dispose model
        if (ctx.vrm) {
          detachIndustrialGear(ctx.vrm.scene);
          ctx.scene.remove(ctx.vrm.scene);
          VRMUtils.deepDispose(ctx.vrm.scene);
          ctx.vrm = null;
        }

        // Dispose grid helper
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

        // Dispose renderer
        renderer.dispose();
        if (renderer.domElement.parentElement) {
          renderer.domElement.parentElement.removeChild(renderer.domElement);
        }

        sceneRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // mount once

    // ── Sync personaId prop → model reload ──
    useEffect(() => {
      const ctx = sceneRef.current;
      if (!ctx || ctx.disposed || ctx.personaId === personaId) return;
      ctx.personaId = personaId;
      loadVRM(modelUrlFor(personaId), ctx).catch((err) => {
        if (!ctx.disposed) {
          console.warn('[DigitalHumanVRM] 切换人设模型失败:', err);
          onErrorRef.current?.(err);
        }
      });
    }, [personaId, loadVRM]);

    // ── Sync isSpeaking prop → animation state ──
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

          // 打断上一次朗读（含视觉状态复位）
          try {
            ctx.cancelSpeak?.();
          } catch {}

          const handle = speakChinese(text, {
            gender: voiceGenderFor(ctx.personaId),
            rate: 1.0,
            pitch: 1.0,
            onStart: () => setSpeakingState(true),
            onBoundary: () => {
              const c = sceneRef.current;
              if (c && !c.disposed) c.anim.speechPulse = Math.min(1.2, c.anim.speechPulse + 0.55);
            },
            onEnd: () => {
              const c = sceneRef.current;
              if (c && !c.disposed) c.cancelSpeak = null;
              setSpeakingState(false);
            },
          });

          if (!handle || typeof handle.promise?.then !== 'function') {
            return false;
          }
          ctx.cancelSpeak = handle.cancel;
          return handle.promise;
        },

        stop: () => {
          const ctx = sceneRef.current;
          try {
            ctx?.cancelSpeak?.();
          } catch {}
          if (ctx) ctx.cancelSpeak = null;
          cancelSpeech();
          setSpeakingState(false);
        },

        setSpeaking: (v: boolean) => setSpeakingState(v),

        setPersona: (id: string) => {
          const ctx = sceneRef.current;
          if (!ctx || ctx.disposed || ctx.personaId === id) return;
          ctx.personaId = id;
          loadVRM(modelUrlFor(id), ctx).catch((err) => {
            if (!ctx.disposed) {
              console.warn('[DigitalHumanVRM] setPersona 模型加载失败:', err);
            }
          });
        },
      }),
      [loadVRM, triggerNod, setSpeakingState],
    );

    // ── Render ─────────────────────────────────────────────────

    return (
      <div
        ref={containerRef}
        className={className}
        style={{ width: '100%', height: '100%' }}
      />
    );
  },
);

DigitalHumanVRM.displayName = 'DigitalHumanVRM';

export default DigitalHumanVRM;
