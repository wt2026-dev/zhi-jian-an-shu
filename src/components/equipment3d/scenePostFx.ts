/**
 * 场景后期处理域（自 scene.ts 机械切出，纯移动不改行为）。
 *
 * 内聚在此：UnrealBloom 泛光链的建立与销毁、软件渲染检测（SwiftShader/llvmpipe
 * 回退直渲）、均衡档 bloom 减半、两阶段渲染开销探测（护栏③：composer 期掉帧
 * 超 30% 先降强度、复测仍超标拆链回直渲）。
 *
 * 场景对象（renderer/scene/camera/container）仍归 EquipmentScene 所有，
 * 构造时传入引用；画质档由调用方每次显式传入（applyPostProcessing(quality)）。
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { QualityKey } from './styles';

export class ScenePostFx {
  /* ---- 后处理辉光（UnrealBloom）----
   * high：全分辨率 bloom；medium：bloom 渲染目标减半；low / 软件渲染：不建 composer，直渲。
   * 阈值经实测定为 1.6（线性 HDR 域，见 applyPostProcessing 注释），
   * 让泛光只落在高亮爆点（扫描环、粒子、发光件）上，地面网格与暗部保持干净。 */
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private composerQuality: QualityKey | null = null;
  /* 护栏③探测态：phase=direct 时强制直渲采基线帧时，phase=bloom 走 composer。 */
  private bloomProbe: { phase: 'direct' | 'bloom'; direct: number[]; bloom: number[] } | null = null;
  private bloomStrengthCut = false;


  constructor(
    private container: HTMLElement,
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
  ) {}

  /* ========================= 后处理辉光 ========================= */

  /**
   * 软件渲染检测：SwiftShader/llvmpipe 下 bloom 的 mip 链每帧要几百毫秒
   * （本项目 PMREM 在软渲染下就有前科），检测到即整体回退直渲。
   */
  isSoftwareRenderer(): boolean {
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      return /swiftshader|llvmpipe|software|basic render/i.test(name);
    } catch {
      return false;
    }
  }

  /** 按画质档创建/重建 bloom 链；low 档与软件渲染保持直渲。幂等，可在 build() 里放心调。 */
  applyPostProcessing(quality: QualityKey): void {
    const want = quality !== 'low' && !this.isSoftwareRenderer();
    if (!want) {
      this.disposeComposer();
      return;
    }
    if (this.composer && this.composerQuality === quality) return;
    this.disposeComposer();
    const w = Math.max(1, this.container.clientWidth || 1);
    const h = Math.max(1, this.container.clientHeight || 1);
    const pr = this.renderer.getPixelRatio();
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    // ⚠️ threshold 实测取 1.6 而非资料常见的 0.8~0.9：RenderPass 输出到 HalfFloat RT，
    // bloom 工作在**色调映射前的线性 HDR 域**，本项目白色机身（0xe9eef3 + sun1.2 + 环境 0.68）
    // 线性亮度 ≈1.2~1.5，0.85 时整机糊成白团（截图对比见 scratch/bloom-th-*.png）。
    // 1.6 只放过高光爆点、加性混合的扫描环/粒子/发光件，地面网格与暗部保持干净。
    const bloom = new UnrealBloomPass(new THREE.Vector2(w * pr, h * pr), 0.55, 0.4, 1.6);
    composer.addPass(bloom);
    // OutputPass 放最后：RenderPass 渲染到 RT 时材质跳过色调映射，由它统一做
    // ACES 曝光 + sRGB 输出，一次完成、不重复。
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.bloomPass = bloom;
    this.composerQuality = quality;
    this.syncComposerSize();
    this.startBloomProbe();
  }

  syncComposerSize(): void {
    if (!this.composer) return;
    const w = Math.max(1, this.container.clientWidth || 1);
    const h = Math.max(1, this.container.clientHeight || 1);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    // 均衡档 bloom 分辨率减半（性能护栏①）：composer.setSize 刚把 bloom 重置为
    // 全尺寸，这里再传一半的有效像素尺寸（UnrealBloomPass 内部还会再 /2 建 mip）。
    if (this.bloomPass && this.composerQuality === 'medium') {
      const pr = this.renderer.getPixelRatio();
      this.bloomPass.setSize(Math.round((w * pr) / 2), Math.round((h * pr) / 2));
    }
  }

  /** 渲一帧：composer 在位且探测期处于 bloom 阶段走后处理链，否则直渲。 */
  renderFrame(): void {
    const useComposer = this.composer !== null && (!this.bloomProbe || this.bloomProbe.phase === 'bloom');
    if (useComposer) this.composer!.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** 每次新建 bloom 链都跑一轮两阶段探测（各 30 帧），量化 bloom 的相对开销。 */
  private startBloomProbe(): void {
    this.bloomProbe = { phase: 'direct', direct: [], bloom: [] };
  }

  /**
   * 性能护栏③：比较两阶段的平均"渲染调用耗时"。composer 期超过直渲期 1/0.7 倍
   * （即 FPS 掉 30% 以上）→ 第一步 bloom 强度减半 + threshold 上调一档并复测；
   * 复测仍超标 → 拆掉整链回直渲。"不允许好看但卡"。
   */
  sampleBloomProbe(renderMs: number): void {
    const p = this.bloomProbe;
    if (!p) return;
    if (!this.composer || !this.bloomPass) {
      this.bloomProbe = null;
      return;
    }
    if (p.phase === 'direct') {
      p.direct.push(renderMs);
      if (p.direct.length >= 30) p.phase = 'bloom';
      return;
    }
    p.bloom.push(renderMs);
    if (p.bloom.length < 30) return;
    this.bloomProbe = null;
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const tDirect = Math.max(0.5, avg(p.direct));
    if (avg(p.bloom) <= tDirect / 0.7) return;
    if (!this.bloomStrengthCut) {
      this.bloomStrengthCut = true;
      this.bloomPass.strength *= 0.5;
      this.bloomPass.threshold += 0.4;
      this.startBloomProbe();
    } else {
      this.disposeComposer();
    }
  }

  disposeComposer(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bloomPass = null;
    this.composerQuality = null;
    this.bloomProbe = null;
  }
}
