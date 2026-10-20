// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import fs from 'node:fs';
import path from 'node:path';
import { BONE, findBone } from '../src/components/digital-human/DigitalHumanGLB';

// worker_talk.glb：仓库里唯一完好的写实 GLB 模型（~10.4MB，Mixamo 骨骼，
// 内置 Armature|beszed 说话动画）。原 asian_worker.glb 已损坏为 Sketchfab 网页 HTML，
// 见 public/models/engineer/ATTRIBUTION.md 的警告。
describe('DigitalHumanGLB — worker_talk.glb 模型骨骼与动画验证', () => {
  const glbPath = path.resolve(process.cwd(), 'public/models/engineer/worker_talk.glb');
  let gltfRoot: THREE.Group;
  let animations: THREE.AnimationClip[] = [];

  beforeAll(async () => {
    if (!globalThis.createImageBitmap) {
      globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} } as any);
    }
    const buf = fs.readFileSync(glbPath);
    // 跨 jsdom realm 的 ArrayBuffer 兼容处理
    const ab = new window.ArrayBuffer(buf.length);
    const view = new window.Uint8Array(ab);
    for (let i = 0; i < buf.length; i++) view[i] = buf[i];

    const loader = new GLTFLoader();
    const gltf = await new Promise<any>((resolve, reject) => {
      loader.parse(ab, '', resolve, reject);
    });

    gltfRoot = gltf.scene;
    animations = gltf.animations || [];
  });

  it('模型文件存在且大小符合写实模型规格 (~10MB)', () => {
    expect(fs.existsSync(glbPath)).toBe(true);
    const stat = fs.statSync(glbPath);
    expect(stat.size).toBeGreaterThan(8 * 1024 * 1024);
  });

  it('【要求1】正确找到模型的核心骨骼 (hips/spine/neck/head/leftArm/rightArm)', () => {
    const hips = findBone(gltfRoot, BONE.hips);
    const spine = findBone(gltfRoot, BONE.spine);
    const neck = findBone(gltfRoot, BONE.neck);
    const head = findBone(gltfRoot, BONE.head);
    const leftArm = findBone(gltfRoot, BONE.lArm);
    const rightArm = findBone(gltfRoot, BONE.rArm);

    expect(hips).not.toBeNull();
    expect(spine).not.toBeNull();
    expect(neck).not.toBeNull();
    expect(head).not.toBeNull();
    expect(leftArm).not.toBeNull();
    expect(rightArm).not.toBeNull();

    // 以 worker_talk.glb 实际节点表为准：左臂 _09，右臂 _020
    expect(leftArm?.name).toBe('mixamorigLeftArm_09');
    expect(rightArm?.name).toBe('mixamorigRightArm_020');
    expect(head?.name).toBe('mixamorigHead_06');
    expect(hips?.name).toBe('mixamorigHips_01');
  });

  it('【要求2】模型自带说话动画剪辑 Armature|beszed，供 speak 时播放', () => {
    expect(animations.length).toBeGreaterThan(0);
    const talkClip = animations.find((a) => {
      const cn = (a.name || '').toLowerCase();
      return cn === 'armature|beszed' || cn.includes('talk') || cn.includes('speak') || cn.includes('beszed');
    });
    expect(talkClip).toBeDefined();
    // 完整说话动作：120 个骨骼通道
    expect(talkClip?.tracks.length).toBeGreaterThan(60);
  });

  it('【要求3】模型包含写实工人材质（衬衫 + 头部皮肤 + 双眼）', () => {
    // GLTFLoader 渲染节点名是 Object_xx，材质名才带 shirt / Std_Skin_* 语义
    const matNames: string[] = [];
    gltfRoot.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh && !(o as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) return;
      const mats: THREE.Material[] = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const m of mats) if (m?.name) matNames.push(m.name);
    });
    expect(matNames.some((n) => n.toLowerCase().includes('shirt'))).toBe(true);
    expect(matNames.some((n) => n.includes('Skin_Head'))).toBe(true);
    expect(matNames.some((n) => n.includes('Eye_L'))).toBe(true);
    expect(matNames.some((n) => n.includes('Eye_R'))).toBe(true);
  });

  it('【要求4】模型身高约 1.75m（米制单位，无需大幅缩放）', () => {
    const box = new THREE.Box3().setFromObject(gltfRoot);
    const size = box.getSize(new THREE.Vector3());
    expect(size.y).toBeGreaterThan(1.5);
    expect(size.y).toBeLessThan(2.0);
  });
});
