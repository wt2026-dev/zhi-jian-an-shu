/**
 * DigitalHuman3D.tsx — 自研 3D 数字人 React 场景组件
 *
 * 职责：Three.js 场景初始化 / 渲染循环 / 动画驱动 / 语音合成 + 口型
 * 对外只暴露 speak / stop / setSpeaking / setPersona 四个方法。
 *
 * 依赖：three@0.186.0（项目已装）、./EngineerModel（同目录程序化模型构建器）
 */

import React, { useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import * as THREE from 'three';
import {
  buildEngineerModel,
  disposeEngineerModel,
  type EngineerModelResult,
} from './EngineerModel';

// ─── Public interface ─────────────────────────────────────────────

export interface DigitalHuman3DHandle {
  speak: (text: string) => Promise<boolean>;
  stop: () => void;
  setSpeaking: (v: boolean) => void;
  setPersona: (id: string) => void;
}

interface DigitalHuman3DProps {
  personaId: string;
  isSpeaking?: boolean;
  className?: string;
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
  jawTarget: number;        // target scaleY for jaw
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
    jawTarget: 0.15,
    jawCycle: 0,
    armLerp: 0,
  };
}

// ─── Constants ────────────────────────────────────────────────────

/**
 * 机位口径（改这里必须同步三处：`tests/digital-human-engineer-model.test.ts` 的 CAMERA_AT
 * 拿这条视线求交，判断帽壳/刘海/镜框有没有糊住眉眼；`scratch/dh-preview.mjs` 用它拍验收照）。
 *
 * 原来 (0, 0.60, 3.45) 是"半身像"机位 —— 那时候模型只做到腰带（−0.575），
 * 取景框正好卡在腰带下沿，投出来就是一截蓝色方块，用户说的"方块身子"有一半来自这里。
 * 现在补齐了下半身（髋 −0.63 / 膝 −1.48 / 鞋底线 −2.58，含帽包围盒 1.606 ~ −2.58）。
 *
 * 7.1 那一版是按**视线中心平面**算的，而帽子前沿 z≈0.71 比该平面近 10%，投影更靠外，
 * 截图实测帽顶落在 −8.8px（被上沿切掉）。这里改用 PerspectiveCamera 逐点投影反解：
 * 画面 262×322 下帽顶 +13px、鞋尖距下沿 +44px（声波条要 42px），人体占画面高 83%。
 * 相机仍压在髋—膝之间平视（俯角 ≈4°）：仰拍把安全帽顶出画面，俯拍把腿压成半截人。
 */
const CAM_POS = new THREE.Vector3(0, -0.24, 7.9);
const CAM_TARGET = new THREE.Vector3(0, -0.74, 0);
const FOV = 39;

// Arm rest / speaking rotations
// 0.15 → 0.09：手臂加长到 1.6（肩峰→腕）之后，再保持 0.15 的外撇角，
// 手会甩到髋外 0.2 处，整个人像端着两只胳膊；收一点才垂得贴身体。
const ARM_REST_Z = 0.09;
const ARM_REST_X = -0.06;
const ARM_SPEAK_Z = 0.2;
const ARM_SPEAK_X = -0.11;

// ─── Component ────────────────────────────────────────────────────

export const DigitalHuman3D = forwardRef<DigitalHuman3DHandle, DigitalHuman3DProps>(
  ({ personaId, isSpeaking = false, className = '' }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);

    // Mutable refs for Three.js objects (not React state to avoid re-renders)
    const sceneRef = useRef<{
      renderer: THREE.WebGLRenderer;
      scene: THREE.Scene;
      camera: THREE.PerspectiveCamera;
      model: EngineerModelResult;
      animId: number;
      anim: AnimState;
      lastTime: number;
      disposed: boolean;
      personaId: string;
    } | null>(null);

    // ── Rebuild model (persona switch) ──────────────────────────

    const rebuildModel = useCallback((newPersonaId: string) => {
      const ctx = sceneRef.current;
      if (!ctx || ctx.disposed) return;

      // Remove & dispose old model
      if (ctx.model) {
        ctx.scene.remove(ctx.model.group);
        disposeEngineerModel(ctx.model);
      }

      // Build new
      const model = buildEngineerModel(newPersonaId);
      ctx.scene.add(model.group);
      ctx.model = model;
      ctx.personaId = newPersonaId;
      // Reset animation state
      ctx.anim = freshAnimState();
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

      // --- Lights ---
      // 主光（温暖日光）
      const mainLight = new THREE.DirectionalLight(0xfff4e2, 1.35);
      mainLight.position.set(2, 3, 4);
      scene.add(mainLight);

      // 环境光（明亮底光）：补到 0.62，下半身（深藏蓝裤子）原本只靠顶光，糊成一团黑
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.62);
      scene.add(ambientLight);

      // 晨曦金轮廓光（勾勒安全帽与肩甲边缘）
      //
      // ⚠ 强度从 0.85 降到 0.4：这盏琥珀轮廓光直接打在白帽上，
      // 张工的白安全帽（0xf0f0f0）被染成黄色 —— 用户反馈的"黄色方块头"，
      // 一半来自这里，另一半来自当时模型根本没有下半身。
      // 保留暖轮廓光是为了和品牌色一致，但要低到"描边"而不是"换色"。
      const rimLight = new THREE.DirectionalLight(0xe8a33d, 0.4);
      rimLight.position.set(-2.5, 2.5, -2.5);
      scene.add(rimLight);

      // 天青色辅助反光（工业科技感）：从侧前方补，不让裤腿和靴子正面陷入死黑
      const fillLight = new THREE.DirectionalLight(0x06b6d4, 0.35);
      fillLight.position.set(2.5, 0.2, 2.5);
      scene.add(fillLight);

      // --- Model ---
      const model = buildEngineerModel(personaId);
      scene.add(model.group);

      // --- Animation state ---
      const anim = freshAnimState();

      const ctx = {
        renderer,
        scene,
        camera,
        model,
        animId: 0,
        anim,
        lastTime: performance.now(),
        disposed: false,
        personaId,
      };
      sceneRef.current = ctx;

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

        const { model: m, anim: a } = ctx;
        if (!m) return;

        // ── A. Idle: Breathing ──
        const breathPhase = (t * Math.PI * 2) / 4000;
        m.torsoGroup.scale.y = 1.0 + 0.015 * Math.sin(breathPhase);
        m.torsoGroup.scale.x = 1.0 + 0.005 * Math.sin(breathPhase);
        m.torsoGroup.scale.z = 1.0 + 0.003 * Math.sin(breathPhase);

        // ── A. Idle: Head micro-motion ──
        const headYaw = 0.02 * Math.sin((t * Math.PI * 2) / 7000);
        m.headGroup.rotation.y = headYaw;

        // ── A. Idle: Blink ──
        if (a.blinkProgress < 0) {
          // Not blinking — count down
          a.blinkCountdown -= dt;
          if (a.blinkCountdown <= 0) {
            a.blinkProgress = 0;
          }
        } else {
          // Blinking
          a.blinkProgress += dt / 150; // 150ms blink duration
          if (a.blinkProgress >= 1) {
            // Blink done
            a.blinkProgress = -1;
            a.blinkCountdown = 2500 + Math.random() * 2000;
            m.leftEye.scale.y = 1;
            m.rightEye.scale.y = 1;
          } else {
            // Sin half-wave: 0→1→0 mapped to open→closed→open
            const squish = 1 - Math.pow(Math.sin(a.blinkProgress * Math.PI), 0.5) * 0.92;
            m.leftEye.scale.y = squish;
            m.rightEye.scale.y = squish;
          }
        }

        // ── B. Speaking: Jaw / lip sync ──
        if (a.speaking) {
          a.jawCycle -= dt;
          if (a.jawCycle <= 0) {
            a.jawTarget = 0.3 + Math.random() * 0.6; // 0.3 ~ 0.9
            a.jawCycle = 200 + Math.random() * 150;   // 200~350ms
          }
          m.jaw.scale.y += (a.jawTarget - m.jaw.scale.y) * 0.25;
        } else {
          // Close mouth smoothly
          m.jaw.scale.y += (0.15 - m.jaw.scale.y) * 0.1;
        }

        // ── B. Speaking: Head nod ──
        if (a.nodProgress >= 0) {
          a.nodProgress += dt / 400; // 400ms nod duration
          if (a.nodProgress >= 1) {
            a.nodProgress = -1;
            m.headGroup.rotation.x = 0;
          } else {
            // Sin wave nod: 0→peak→0
            m.headGroup.rotation.x = a.nodDir * 0.05 * Math.sin(a.nodProgress * Math.PI);
          }
        }

        // ── B. Speaking: Arm gesture ──
        const armTargetZ = a.speaking ? ARM_SPEAK_Z : ARM_REST_Z;
        const armTargetX = a.speaking ? ARM_SPEAK_X : ARM_REST_X;
        const lerpSpeed = 0.05;

        m.leftArm.rotation.z += (armTargetZ - m.leftArm.rotation.z) * lerpSpeed;
        m.leftArm.rotation.x += (armTargetX - m.leftArm.rotation.x) * lerpSpeed;
        m.rightArm.rotation.z += (-armTargetZ - m.rightArm.rotation.z) * lerpSpeed;
        m.rightArm.rotation.x += (armTargetX - m.rightArm.rotation.x) * lerpSpeed;

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
        if (ctx.model) {
          ctx.scene.remove(ctx.model.group);
          disposeEngineerModel(ctx.model);
        }

        // Dispose lights (no special cleanup needed)
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

    // ── Sync personaId prop → model rebuild ──
    useEffect(() => {
      const ctx = sceneRef.current;
      if (ctx && ctx.personaId !== personaId) {
        rebuildModel(personaId);
      }
    }, [personaId, rebuildModel]);

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
          rebuildModel(id);
        },
      }),
      [rebuildModel, triggerNod],
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

DigitalHuman3D.displayName = 'DigitalHuman3D';
