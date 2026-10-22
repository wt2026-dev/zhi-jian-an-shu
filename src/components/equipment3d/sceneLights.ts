/**
 * 场景光照域（自 scene.ts 机械切出，纯移动不改行为）。
 *
 * 内聚在此：三光源体系（环境光/半球光/平行光）+ 天花板补光/窗光、天空球、
 * PMREM 环境贴图生成与缓存（envKey/skyKey/shadowKey 只随预设变化重算）。
 * 场景对象仍归 EquipmentScene 所有，构造时传入 scene 引用。
 */
import * as THREE from 'three';
import type { SceneLevel } from './scene';
import type { ScenePreset } from './styles';

export class SceneLights {
  /** @internal 由 EquipmentScene 跨域直读（阴影配置/氛围光调光），纯移动期间保持字段语义 */ public sun: THREE.DirectionalLight | null = null;
  /** @internal 由 EquipmentScene 跨域直读（阴影配置/氛围光调光），纯移动期间保持字段语义 */ public hemi: THREE.HemisphereLight | null = null;
  /** @internal 由 EquipmentScene 跨域直读（阴影配置/氛围光调光），纯移动期间保持字段语义 */ public ambient: THREE.AmbientLight | null = null;
  /** @internal 由 EquipmentScene 跨域直读（阴影配置/氛围光调光），纯移动期间保持字段语义 */ public ceilingLight: THREE.DirectionalLight | null = null;
  /** @internal 由 EquipmentScene 跨域直读（阴影配置/氛围光调光），纯移动期间保持字段语义 */ public windowSun: THREE.DirectionalLight | null = null;
  /** @internal 由 EquipmentScene 跨域直读（阴影配置/氛围光调光），纯移动期间保持字段语义 */ public skyMesh: THREE.Mesh | null = null;
  /** @internal 由 EquipmentScene 跨域直读（阴影配置/氛围光调光），纯移动期间保持字段语义 */ public envRT: THREE.WebGLRenderTarget | null = null;
  /** @internal 由 EquipmentScene 跨域直读（阴影配置/氛围光调光），纯移动期间保持字段语义 */ public envSource: THREE.Texture | null = null;
  /** PMREM 生成器必须复用：每次 new 都会重新分配内部材质并触发着色器重编译，
   *  在软件光栅化下单次可达 1.3 秒（实测），复用后仅首次付出该代价。 */
  /** @internal 由 EquipmentScene 跨域直读（阴影配置/氛围光调光），纯移动期间保持字段语义 */ public pmrem: THREE.PMREMGenerator | null = null;
  /** 环境贴图 / 天空球 / 阴影贴图 只与预设配色有关，用 id 做缓存键避免每次重建都重算 */
  /** @internal 由 EquipmentScene 跨域直读（阴影配置/氛围光调光），纯移动期间保持字段语义 */ public envKey: string | null = null;
  /** @internal 由 EquipmentScene 跨域直读（阴影配置/氛围光调光），纯移动期间保持字段语义 */ public skyKey: string | null = null;
  public shadowKey = 0;
  /** @internal 由 EquipmentScene 跨域直读（阴影配置/氛围光调光），纯移动期间保持字段语义 */ public skyGeo: THREE.SphereGeometry | null = null;


  constructor(
    private sceneRef: THREE.Scene,
    private rendererRef: THREE.WebGLRenderer,
    private getLevel: () => SceneLevel,
    private getExposure: () => number,
  ) {}

  /* ========================= 光照 ========================= */

  initLights(): void {
    this.ambient = new THREE.AmbientLight(0xffffff, 0.75);
    this.hemi = new THREE.HemisphereLight(0xe5eef7, 0x566270, 0.85);
    this.sun = new THREE.DirectionalLight(0xfff4e6, 2.2);
    this.sun.position.set(80, 130, 60);
    this.sun.castShadow = true;

    // 天花板主吊灯垂直补充光照（高位下射，车间明亮均匀无死角）
    this.ceilingLight = new THREE.DirectionalLight(0xfffaed, 1.1);
    this.ceilingLight.position.set(0, 50, 0);

    // 侧窗倾斜射入的暖阳自然光照（穿透落地玻璃窗）
    this.windowSun = new THREE.DirectionalLight(0xffeedd, 1.5);
    this.windowSun.position.set(-75, 26, 8);
    this.windowSun.target.position.set(0, 0, 0);

    this.sceneRef.add(
      this.ambient,
      this.hemi,
      this.sun,
      this.sun.target,
      this.ceilingLight,
      this.windowSun,
      this.windowSun.target
    );
  }

  applyLighting(preset: ScenePreset): void {
    const l = preset.lighting;
    if (this.ambient) {
      this.ambient.color.setHex(preset.palette.light.ambient);
      this.ambient.intensity = Math.max(0.7, l.ambient * 1.25);
    }
    if (this.hemi) {
      this.hemi.color.setHex(preset.palette.light.hemi);
      this.hemi.groundColor.setHex(preset.palette.floor).multiplyScalar(0.5);
      this.hemi.intensity = Math.max(0.65, l.ambient * 1.05);
    }
    if (this.sun) {
      this.sun.color.setHex(preset.palette.light.sun);
      this.sun.intensity = l.sun;
      const a = 0.9;
      this.sun.position.set(Math.cos(a) * 160, l.sunHeight, Math.sin(a) * 160);
      this.sun.target.position.set(0, 0, 0);
      this.sun.target.updateMatrixWorld();
    }
    if (this.ceilingLight) {
      this.ceilingLight.intensity = this.getLevel() === 'factory' ? 0.2 : 1.1;
    }
    if (this.windowSun) {
      this.windowSun.intensity = this.getLevel() === 'factory' ? 0.2 : 1.5;
    }
    this.rendererRef.toneMappingExposure = Math.max(1.15, l.exposure * (this.getExposure() || 1));
    this.sceneRef.fog = new THREE.FogExp2(preset.palette.fog, l.fogDensity);
    this.sceneRef.background = new THREE.Color(preset.palette.sky);
  }

  /**
   * 环境贴图：用一张渐变 + 太阳光斑的小画布生成 PMREM —— 没有它金属会渲染成纯黑。
   *
   * 性能要点：PMREM 会渲染一整套 cubemap mip 链，在软件光栅化（SwiftShader）下
   * 单次就要几百毫秒，是「拖动滑块重建」耗时的主要来源。而它只取决于预设配色，
   * 因此按预设 id 缓存，重建时若预设未变直接复用。
   */
  updateEnvMap(preset: ScenePreset, presetId: string): void {
    if (this.envRT && this.envKey === presetId) return;
    const size = 128;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const top = new THREE.Color(preset.palette.sky);
    const bot = new THREE.Color(preset.palette.floor).multiplyScalar(0.75);
    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, `#${top.getHexString()}`);
    grad.addColorStop(0.55, `#${top.clone().lerp(bot, 0.45).getHexString()}`);
    grad.addColorStop(1, `#${bot.getHexString()}`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    // 太阳光斑
    const sun = new THREE.Color(preset.palette.light.sun);
    const sg = ctx.createRadialGradient(size * 0.28, size * 0.26, 1, size * 0.28, size * 0.26, size * 0.26);
    sg.addColorStop(0, `#${sun.getHexString()}`);
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(this.rendererRef);
    const rt = this.pmrem.fromEquirectangular(tex);
    this.sceneRef.environment = rt.texture;
    // 0.68：比原 0.62 略抬一档，金属设备反射更"实"（PBR 环境光是金属质感的主光源），
    // 再高会让钢壳过亮发假；渐变 PMREM 保持，不引入外部 HDRI（包体积 + 软渲染风险）。
    this.sceneRef.environmentIntensity = 0.68;
    tex.dispose();
    this.envRT?.dispose();
    this.envSource?.dispose();
    this.envRT = rt;
    this.envSource = null;
    this.envKey = presetId;
  }

  /** 天空球：ShaderMaterial 渐变，BackSide + depthWrite false。同样按预设缓存。 */
  updateSky(preset: ScenePreset, presetId: string): void {
    if (this.skyMesh && this.skyKey === presetId) return;
    if (this.skyMesh) {
      this.sceneRef.remove(this.skyMesh);
      (this.skyMesh.material as THREE.Material).dispose();
      this.skyMesh = null;
    }
    const uniforms = {
      uTop: { value: new THREE.Color(preset.palette.sky) },
      uMid: { value: new THREE.Color(preset.palette.fog) },
      uBottom: { value: new THREE.Color(preset.palette.floor).multiplyScalar(0.55) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uMid;
        uniform vec3 uBottom;
        varying vec3 vWorld;
        void main() {
          vec3 d = normalize(vWorld);
          float t = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 c = mix(uBottom, uMid, smoothstep(0.0, 0.52, t));
          c = mix(c, uTop, smoothstep(0.48, 1.0, t));
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
    // 天空球几何体固定，跨重建复用，避免重复分配与首次渲染的着色器重编译
    if (!this.skyGeo) this.skyGeo = new THREE.SphereGeometry(1400, 24, 16);
    const mesh = new THREE.Mesh(this.skyGeo, mat);
    mesh.name = 'sky';
    mesh.frustumCulled = false;
    this.skyMesh = mesh;
    this.skyKey = presetId;
    this.sceneRef.add(mesh);
  }
}
