// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import fs from 'node:fs';
import path from 'node:path';

// china_engineer.glb：腾讯混元3D 图生3D 生成的中国工程师（静态模型，无骨骼/无动画）。
// 这一版先解决"中国人脸"问题；绑骨/动画后续再补。
describe('DigitalHumanGLB — china_engineer.glb 静态模型验证', () => {
  const glbPath = path.resolve(process.cwd(), 'public/models/engineer/china_engineer.glb');
  let gltfRoot: THREE.Group;
  let animations: THREE.AnimationClip[] = [];

  beforeAll(async () => {
    if (!globalThis.createImageBitmap) {
      globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} } as any);
    }
    const buf = fs.readFileSync(glbPath);
    const ab = new window.ArrayBuffer(buf.length);
    const view = new window.Uint8Array(ab);
    for (let i = 0; i < buf.length; i++) view[i] = buf[i];

    const loader = new GLTFLoader();
    // 2026-10-18 起模型经 gltf-transform meshopt 压缩（EXT_meshopt_compression），解析必须挂解码器
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await new Promise<any>((resolve, reject) => {
      loader.parse(ab, '', resolve, reject);
    });

    gltfRoot = gltf.scene;
    animations = gltf.animations || [];
  });

  it('模型文件存在且体积合理（meshopt 全精度压缩 ~8.5MB，画质对齐原版 78MB）', () => {
    expect(fs.existsSync(glbPath)).toBe(true);
    const stat = fs.statSync(glbPath);
    // 2026-10-17 e5d3bdc：78MB→981KB（过度简化）；2026-10-18：改 meshopt 全精度 → 8.5MB
    expect(stat.size).toBeGreaterThan(300 * 1024); // 不是空壳 / 损坏文件
    expect(stat.size).toBeLessThan(16 * 1024 * 1024); // 压缩生效，未回退到大文件
  });

  it('模型可被 GLTFLoader 正常解析（不抛错）', () => {
    expect(gltfRoot).toBeDefined();
  });

  it('当前版本为静态模型：无骨骼、无动画（预期行为，绑骨待补）', () => {
    expect(animations.length).toBe(0);
    // 静态模型：没有任何 SkinnedMesh / Bone
    let skinned = 0;
    gltfRoot.traverse((o) => {
      if ((o as any).isSkinnedMesh) skinned++;
    });
    expect(skinned).toBe(0);
  });

  it('模型包围盒可计算（组件会自动绕X轴立起并归一化到 1.75m）', () => {
    const box = new THREE.Box3().setFromObject(gltfRoot);
    const size = box.getSize(new THREE.Vector3());
    expect(size.x + size.y + size.z).toBeGreaterThan(0.01);
    expect(size.x + size.y + size.z).toBeLessThan(100);
  });
});
