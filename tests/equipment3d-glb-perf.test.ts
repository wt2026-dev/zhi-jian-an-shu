/**
 * GLB 资产的「渲染开销」守卫。
 *
 * 背景：L2 用真实 GLB 替换程序化设备后，三角形数其实很小（全仓 12 个 GLB 合计约 83 万），
 * 真正的压力是**未合批的 mesh 数**（= draw call 数）。实测：
 *   exhaust_fan_motor 130 mesh、centrifugal_pump 57（被 eq-101 / eq-112 各用一次）、
 *   double_suction_pump 49、milling_machine 14 → 11 台映射设备合计约 323 个 mesh。
 * 而本引擎整体是围绕 InstancedMesh 压 draw call 设计的，所以：
 *   1. GLB 不得投射阴影 —— 否则每个 mesh 在 shadow pass 再画一遍，凭空翻倍；
 *   2. MeshPhysicalMaterial（KHR_materials_specular/ior 产物）要降级成
 *      MeshStandardMaterial —— 它的 shader 变体重得多。
 * 这两条都是 FPS≥30 的前提，且画面上一眼看不出差别，所以锁在这里。
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { normalizeGLBMaterials } from '../src/components/equipment3d/equipmentGlb';

/** 造一个带 MeshPhysicalMaterial 的 mesh，模拟 GLTFLoader 遇到 KHR_materials_specular 的输出。 */
function physicalMesh(): { root: THREE.Group; mesh: THREE.Mesh; mat: THREE.MeshPhysicalMaterial } {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x8899aa,
    roughness: 0.42,
    metalness: 0.77,
    clearcoat: 0.5,
    ior: 1.45,
    specularIntensity: 0.9,
  });
  mat.name = 'lathe_body';
  const tex = new THREE.Texture();
  mat.map = tex;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  const root = new THREE.Group();
  root.add(mesh);
  return { root, mesh, mat };
}

describe('GLB 材质降级 normalizeGLBMaterials', () => {
  it('MeshPhysicalMaterial 被换成 MeshStandardMaterial', () => {
    const { root, mesh } = physicalMesh();
    normalizeGLBMaterials(root);
    expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(mesh.material).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
  });

  it('质感与贴图被保留（不是粗暴丢弃材质）', () => {
    const { root, mesh, mat } = physicalMesh();
    const srcMap = mat.map;
    normalizeGLBMaterials(root);
    const out = mesh.material as THREE.MeshStandardMaterial;
    expect(out.map).toBe(srcMap);
    expect(out.color.getHex()).toBe(0x8899aa);
    expect(out.roughness).toBeCloseTo(0.42, 5);
    expect(out.metalness).toBeCloseTo(0.77, 5);
    expect(out.name).toBe('lathe_body');
  });

  it('MeshStandardMaterial 原样保留（不重复包装）', () => {
    const std = new THREE.MeshStandardMaterial({ color: 0x123456 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), std);
    const root = new THREE.Group();
    root.add(mesh);
    normalizeGLBMaterials(root);
    expect(mesh.material).toBe(std);
  });

  it('多材质数组逐个降级，且仍保持数组形态', () => {
    const a = new THREE.MeshPhysicalMaterial();
    const b = new THREE.MeshStandardMaterial();
    const c = new THREE.MeshPhysicalMaterial();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [a, b, c]);
    const root = new THREE.Group();
    root.add(mesh);
    normalizeGLBMaterials(root);
    const out = mesh.material as THREE.Material[];
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(3);
    expect(out[0]).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(out[1]).toBe(b);
    expect(out[2]).toBeInstanceOf(THREE.MeshStandardMaterial);
  });

  it('嵌套层级也会被遍历到（GLB 常见多层 Group）', () => {
    const { root, mesh } = physicalMesh();
    const outer = new THREE.Group();
    const inner = new THREE.Group();
    outer.add(inner);
    // 把 mesh 从 root 挪到深层
    root.remove(mesh);
    inner.add(mesh);
    normalizeGLBMaterials(outer);
    expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
  });

  it('非 mesh 节点（Group / Light）不被误伤', () => {
    const g = new THREE.Group();
    const light = new THREE.PointLight();
    g.add(light);
    expect(() => normalizeGLBMaterials(g)).not.toThrow();
    expect(g.children).toContain(light);
  });
});
