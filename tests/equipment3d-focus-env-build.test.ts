/**
 * 设备详情环境层：全量构造兜底测试。
 * 任何一节（立柱 / 管道 / 物料 / 灯光 / 远景）抛错都会被 catch 成 console.warn，
 * 表现就是「聚焦层缺件甚至全黑」，所以这里把 warn 直接判为失败。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { DeviceDetailEnv } from '../src/components/equipment3d/deviceDetailEnv';
import type { DeviceDetailEnvBox } from '../src/components/equipment3d/deviceDetailEnv';

// 一次性扫描：不同体量 / 旋转角的设备盒都要能建出环境层，任何分节 catch 都算失败
describe('deviceDetailEnv 构造全量兜底', () => {
  afterEach(() => vi.restoreAllMocks());
  const boxes: DeviceDetailEnvBox[] = [
    { x: 0, y: 0, z: 0, w: 2.4, h: 5.9, d: 6.6 },
    { x: -12, y: 0.4, z: 8, w: 8.2, h: 3.1, d: 4.4 },
    { x: 6, y: 0, z: -20, w: 0.9, h: 0.9, d: 0.9 },
    { x: 3, y: 0, z: 3, w: 14, h: 9.5, d: 12 },
  ];
  for (const [i, box] of boxes.entries()) {
    for (const angle of [0, Math.PI / 2, 1.23]) {
      it(`box#${i} angle=${angle.toFixed(2)} 无分节异常`, () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const env = new DeviceDetailEnv({ box, rotationY: angle, lowFx: i === 3 });
        expect(env.group).toBeInstanceOf(THREE.Group);
        for (const t of [0.03, 0.7, 4.2, 11.9]) env.update(0.016, t);
        let meshes = 0;
        env.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
        expect(meshes).toBeGreaterThan(40);
        expect(warn).not.toHaveBeenCalled();
        env.dispose();
      });
    }
  }
});
