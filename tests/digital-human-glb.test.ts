// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
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
    const gltf = await new Promise<any>((resolve, reject) => {
      loader.parse(ab, '', resolve, reject);
    });

    gltfRoot = gltf.scene;
    animations = gltf.animations || [];
  });

  it('模型文件存在且体积合理（已压缩至 ~1MB 低模，绑定动画后续补齐）', () => {
    expect(fs.existsSync(glbPath)).toBe(true);
    const stat = fs.statSync(glbPath);
    // 2026-10-17 提交 e5d3bdc 已将 78MB 高模压缩至 981KB：断言压缩后体积区间
    expect(stat.size).toBeGreaterThan(300 * 1024); // 不是空壳 / 损坏文件
    expect(stat.size).toBeLessThan(5 * 1024 * 1024); // 压缩生效，未回退到大文件
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
