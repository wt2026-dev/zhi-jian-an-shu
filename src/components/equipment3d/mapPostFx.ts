// 地图层后处理：UnrealBloom 辉光 + 掉帧自动降级直渲。
// 与车间层 scene.ts 的 bloom 同一思路但更轻：地图只有少量高亮件，
// 因此开场用 60 帧采样，平均帧时超过 33ms（约 30fps）就永久退回直渲，
// 宁可少一层辉光，也不让下钻在大屏机上卡成幻灯片。
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

export interface MapPostFx {
  /** 当前是否仍在走 composer（false = 已降级直渲） */
  isBloomOn: () => boolean;
  render: () => void;
  setSize: (width: number, height: number) => void;
  dispose: () => void;
}

export interface MapPostFxOptions {
  strength?: number;
  radius?: number;
  threshold?: number;
  /** 采样帧数与降级的平均帧时阈值（ms） */
  probeFrames?: number;
  budgetMs?: number;
}

export function createMapPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  opts: MapPostFxOptions & { width: number; height: number }
): MapPostFx {
  const strength = opts.strength ?? 0.78;
  const radius = opts.radius ?? 0.6;
  // 阈值取 1.15：地形（受光后 <1）不发光，光柱与国界描边（颜色 ×2 以上）才溢出
  const threshold = opts.threshold ?? 1.15;
  const probeFrames = opts.probeFrames ?? 60;
  const budgetMs = opts.budgetMs ?? 33;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(opts.width, opts.height), strength, radius, threshold);
  composer.addPass(bloom);
  // OutputPass 收尾：composer 走 RT 时材质跳过色调映射，由它统一做色彩空间转换
  composer.addPass(new OutputPass());
  composer.setSize(opts.width, opts.height);

  let on = true;
  let probeLeft = probeFrames;
  let probeMs = 0;
  let last = 0;
  let reported = false;

  return {
    isBloomOn: () => on,
    render: () => {
      if (!on) {
        renderer.render(scene, camera);
        return;
      }
      const now = performance.now();
      if (last) probeMs += now - last;
      last = now;
      composer.render();
      probeLeft -= 1;
      if (probeLeft <= 0 && !reported) {
        reported = true;
        if (probeMs / probeFrames > budgetMs) {
          on = false;
          bloom.dispose();
          composer.dispose();
        }
      }
    },
    setSize: (width, height) => {
      bloom.setSize(width, height);
      composer.setSize(width, height);
    },
    dispose: () => {
      if (on) {
        bloom.dispose();
        composer.dispose();
      }
    },
  };
}
