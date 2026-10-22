/**
 * GLB 装载域（自 equipment.ts 机械切出，纯移动不改行为）。
 *
 * 内聚在此：GLTFLoader 单例、按 URL 的模型缓存、PhysicalMaterial → StandardMaterial
 * 降级（shader 变体瘦身）。失败不进缓存的语义在这里保证（一次网络抖动不许永久钉死模型）。
 *
 * 不在此：EQUIPMENT_GLB_MAP 映射表留在 equipment.ts（多方追加的共享区，禁止重排）。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const gltfLoader = typeof window !== 'undefined' ? new GLTFLoader() : null;
const gltfCache = new Map<string, Promise<THREE.Group>>();

/**
 * 把 GLB 里的 `MeshPhysicalMaterial` 降级为 `MeshStandardMaterial`。
 *
 * 原因：`KHR_materials_specular` / `KHR_materials_ior` 会让 GLTFLoader 生成
 * MeshPhysicalMaterial —— 它的 shader 变体比 Standard 重得多（多出 clearcoat/sheen/
 * specular/transmission 等分支）。实测本目录里 `lathe_machine.glb` 用了这两个扩展。
 *
 * 在**缓存的原始模型**上做一次，所有 clone 共享转换后的材质
 * （`Object3D.clone()` 是按引用共享材质的），因此不会每个设备各转一遍、
 * 也不会出现"dispose 掉别人还在用的材质"。
 */
export function normalizeGLBMaterials(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    let changed = false;
    const next = mats.map((mat) => {
      if (!(mat instanceof THREE.MeshPhysicalMaterial)) return mat;
      changed = true;
      const std = new THREE.MeshStandardMaterial({
        map: mat.map,
        roughnessMap: mat.roughnessMap,
        metalnessMap: mat.metalnessMap,
        normalMap: mat.normalMap,
        emissiveMap: mat.emissiveMap,
        aoMap: mat.aoMap,
        alphaMap: mat.alphaMap,
        emissive: mat.emissive,
        color: mat.color,
        roughness: mat.roughness,
        metalness: mat.metalness,
        transparent: mat.transparent,
        opacity: mat.opacity,
        side: mat.side,
        alphaTest: mat.alphaTest,
      });
      std.name = mat.name;
      mat.dispose();
      return std;
    });
    if (changed) m.material = Array.isArray(m.material) ? next : next[0];
  });
}

export function loadEquipmentGLB(url: string): Promise<THREE.Group> {
  if (gltfCache.has(url)) {
    return gltfCache.get(url)!.then((g) => g.clone(true));
  }
  if (!gltfLoader) {
    return Promise.reject(new Error('GLTFLoader unavailable in this environment'));
  }
  const p = new Promise<THREE.Group>((resolve, reject) => {
    gltfLoader.load(
      url,
      (gltf) => {
        resolve(gltf.scene);
      },
      undefined,
      (err) => {
        // 失败不能留在缓存里：否则一次网络抖动会把该模型永久钉死成"加载失败"，
        // 后续任何重试都直接命中已 reject 的 Promise，表现为"有些设备永远没有 GLB"。
        gltfCache.delete(url);
        reject(err);
      }
    );
  }).then((scene) => {
    normalizeGLBMaterials(scene);
    return scene;
  });
  gltfCache.set(url, p);
  return p.then((g) => g.clone(true));
}
