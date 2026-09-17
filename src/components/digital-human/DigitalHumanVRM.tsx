/**
 * DigitalHumanVRM.tsx — VRM 日式动漫 3D 数字人 React 组件
 *
 * 职责：Three.js 场景初始化 / VRM 模型加载 / 渲染循环 / 动画驱动 / 语音合成 + 口型
 * 对外只暴露 speak / stop / setSpeaking / setPersona 四个方法（与 DigitalHuman3D 同构，
 * 可直接替换使用）。
 *
 * 模型来源：VRoid Studio 官方示例模型（AvatarSample A/B/C，日式动漫风格），
 * 经 npm 包 virtual-avatar 分发获取，许可遵循 VRoid 官方示例模型许可（可免费使用/修改，
 * 详见 https://vroid.com/studio 与包内 LICENSE 说明）。模型文件位于 public/models/，
 * 运行时走本地静态资源，无外网依赖。
 *
 * 依赖：three@0.186.0、@pixiv/three-vrm@3.5.5（项目已装）。
 *
 * 动画说明：
 *  - 眨眼：VRM BlendShape（Blink）
 *  - 口型：VRM BlendShape（Aa / Ih / Oh 交替，speaking 时随机张合）
 *  - 点头/头动：Humanoid Head 骨骼
 *  - 手臂手势：Humanoid 上臂骨骼（说话姿态微抬，左右对称）
 *  - 呼吸：Spine 骨骼缩放
 */

import React, { useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, VRMHumanBoneName } from '@pixiv/three-vrm';
import type { VRM } from '@pixiv/three-vrm';

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
}

// ─── Persona → VRM model mapping ──────────────────────────────────

const PERSONA_MODEL: Record<string, string> = {
  zhang: '/models/AvatarSample_A.vrm',
  li: '/models/AvatarSample_B.vrm',
  zhi: '/models/AvatarSample_C.vrm',
};

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
  jawShape: 'Aa' | 'Ih' | 'Oh'; // current mouth shape
  jawCycle: number;         // ms countdown for next jaw target change
  /* arm restore */
  armLerp: number;          // 0 = rest, 1 = speaking pose
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
    jawShape: 'Aa',
    jawCycle: 0,
    armLerp: 0,
  };
}

// ─── Constants ────────────────────────────────────────────────────

// VRM 模型原点在脚底（y=0），相机对准上半身——完整展现自然下垂的手臂与面部
const CAM_POS = new THREE.Vector3(0, 1.25, 2.05);
const CAM_TARGET = new THREE.Vector3(0, 1.18, 0);
const FOV = 40;

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

// ─── BlendShape helper (compatible with VRM 0.x & 1.0) ─────────────

function setExpression(
  vrm: VRM,
  name0x: string,
  name1x: string,
  value: number,
): void {
  const anyVrm = vrm as unknown as {
    expressionManager?: { setValue?: (k: string, v: number) => void; update?: () => void };
    blendShapeProxy?: { setValue?: (k: string, v: number) => void; update?: () => void };
  };
  const em = anyVrm.expressionManager;
  if (em && typeof em.setValue === 'function') {
    em.setValue(name1x, value);
    if (typeof em.update === 'function') em.update();
    return;
  }
  const bsp = anyVrm.blendShapeProxy;
  if (bsp && typeof bsp.setValue === 'function') {
    bsp.setValue(name0x, value);
    if (typeof bsp.update === 'function') bsp.update();
  }
}

// ─── Component ────────────────────────────────────────────────────

export const DigitalHumanVRM = forwardRef<DigitalHumanVRMHandle, DigitalHumanVRMProps>(
  ({ personaId, isSpeaking = false, className = '' }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);

    // Mutable refs for Three.js objects (not React state to avoid re-renders)
    const sceneRef = useRef<{
      renderer: THREE.WebGLRenderer;
      scene: THREE.Scene;
      camera: THREE.PerspectiveCamera;
      vrm: VRM | null;
      animId: number;
      anim: AnimState;
      lastTime: number;
      disposed: boolean;
      personaId: string;
    } | null>(null);

    // ── Load VRM model (async) ──────────────────────────────────

    const loadVRM = useCallback((url: string, ctx: NonNullable<typeof sceneRef.current>): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));
        loader.loadAsync(url).then((gltf) => {
          if (ctx.disposed) {
            // Component unmounted while loading — dispose what we got
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
            ctx.scene.remove(ctx.vrm.scene);
            VRMUtils.deepDispose(ctx.vrm.scene);
          }
          ctx.scene.add(vrm.scene);

          // VRM 0.x 模型默认面向 -Z（背对镜头），转 180° 面向 +Z
          if (vrm.meta?.metaVersion === '0') {
            VRMUtils.rotateVRM0(vrm);
          }
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

          ctx.vrm = vrm;
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

      // --- Lights (动漫风格：主光 + 天光 + 冷色补光) ---
      const mainLight = new THREE.DirectionalLight(0xfff4e2, 1.5);
      mainLight.position.set(2, 3, 4);
      scene.add(mainLight);

      const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
      scene.add(ambientLight);

      const rimLight = new THREE.DirectionalLight(0x8ec5ff, 0.8);
      rimLight.position.set(-2.5, 1.5, -3);
      scene.add(rimLight);

      const fillLight = new THREE.DirectionalLight(0xffd9a8, 0.45);
      fillLight.position.set(1.5, 0.6, 2.5);
      scene.add(fillLight);

      // --- Animation state ---
      const anim = freshAnimState();

      const ctx = {
        renderer,
        scene,
        camera,
        vrm: null as VRM | null,
        animId: 0,
        anim,
        lastTime: performance.now(),
        disposed: false,
        personaId,
      };
      sceneRef.current = ctx;

      // --- Load initial model ---
      const modelUrl = PERSONA_MODEL[personaId] || PERSONA_MODEL.zhang;
      loadVRM(modelUrl, ctx).catch((err) => {
        if (!ctx.disposed) {
          console.warn('[DigitalHumanVRM] 模型加载失败:', err);
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
            setExpression(vrm, 'Blink', 'blink', 0);
          } else {
            const squish = Math.pow(Math.sin(a.blinkProgress * Math.PI), 0.5);
            setExpression(vrm, 'Blink', 'blink', squish);
          }
        }

        // ── B. Speaking: Jaw / lip sync (BlendShape) ──
        if (a.speaking) {
          a.jawCycle -= dt;
          if (a.jawCycle <= 0) {
            a.jawTarget = 0.35 + Math.random() * 0.65; // 0.35 ~ 1.0
            a.jawCycle = 180 + Math.random() * 140;     // 180~320ms
            const shapes: Array<'Aa' | 'Ih' | 'Oh'> = ['Aa', 'Ih', 'Oh'];
            a.jawShape = shapes[Math.floor(Math.random() * shapes.length)];
          }
          a.jawWeight += (a.jawTarget - a.jawWeight) * 0.3;
        } else {
          a.jawWeight += (0 - a.jawWeight) * 0.12;
        }
        // Apply mouth shape weights (clear siblings then set active)
        setExpression(vrm, 'Aa', 'aa', a.jawShape === 'Aa' ? a.jawWeight : 0);
        setExpression(vrm, 'Ih', 'ih', a.jawShape === 'Ih' ? a.jawWeight : 0);
        setExpression(vrm, 'Oh', 'oh', a.jawShape === 'Oh' ? a.jawWeight : 0);

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
        // 待机微摆：缓慢晃动（约 0.35 Hz，幅度 ~4°），手臂不僵硬
        const idleSwingZ = 0.07 * Math.sin(swingT * 2.2);
        const idleSwingX = 0.05 * Math.sin(swingT * 1.6 + 1.2);
        // 说话摆动：较快节奏（约 1 Hz，幅度 ~8°），配合口型节奏
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
        cancelAnimationFrame(ctx.animId);
        ro.disconnect();

        // Dispose model
        if (ctx.vrm) {
          ctx.scene.remove(ctx.vrm.scene);
          
          VRMUtils.deepDispose(ctx.vrm.scene);
          ctx.vrm = null;
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
      const modelUrl = PERSONA_MODEL[personaId] || PERSONA_MODEL.zhang;
      ctx.personaId = personaId;
      loadVRM(modelUrl, ctx).catch((err) => {
        if (!ctx.disposed) {
          console.warn('[DigitalHumanVRM] 切换人设模型失败:', err);
        }
      });
    }, [personaId, loadVRM]);

    // ── Sync isSpeaking prop → animation state ──
    useEffect(() => {
      const ctx = sceneRef.current;
      if (ctx) {
        const wasSpeak = ctx.anim.speaking;
        ctx.anim.speaking = isSpeaking;
        // Trigger nod on transition
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

          // Clean markdown syntax
          const clean = text
            .replace(/[#*`_~>[\]()!-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (!clean) return false;

          const excerpt = clean.length > 280 ? clean.slice(0, 280) : clean;

          // Start speaking animation
          ctx.anim.speaking = true;
          triggerNod(1);

          // speechSynthesis available?
          if (typeof window !== 'undefined' && window.speechSynthesis) {
            return new Promise<boolean>((resolve) => {
              const utterance = new SpeechSynthesisUtterance(excerpt);
              utterance.lang = 'zh-CN';
              utterance.rate = 1.0;
              utterance.pitch = 1.0;

              utterance.onend = () => {
                if (ctx && !ctx.disposed) {
                  ctx.anim.speaking = false;
                  triggerNod(-1);
                }
                resolve(true);
              };

              utterance.onerror = () => {
                if (ctx && !ctx.disposed) {
                  ctx.anim.speaking = false;
                }
                resolve(false);
              };

              window.speechSynthesis.speak(utterance);
            });
          }

          // Fallback: jaw animation only for ~3 seconds
          return new Promise<boolean>((resolve) => {
            setTimeout(() => {
              if (ctx && !ctx.disposed) {
                ctx.anim.speaking = false;
                triggerNod(-1);
              }
              resolve(true);
            }, Math.min(excerpt.length * 120, 8000)); // ~120ms per char, max 8s
          });
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
          loadVRM(modelUrl, ctx).catch((err) => {
            if (!ctx.disposed) {
              console.warn('[DigitalHumanVRM] setPersona 模型加载失败:', err);
            }
          });
        },
      }),
      [loadVRM, triggerNod],
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
