/**
 * cameraFraming 取景数学单测。
 *
 * 锁四件事（均来自「聚焦机位居中」产品口径）：
 *   1. 任意纵横比下，包围盒 8 角投影不出视锥（NDC ≤ FILL + 余量）；
 *   2. 默认俯角 1.0 rad ≈ 33°（25-35° 观感区间）；
 *   3. 轨道半径 ≥ 外接球半径 1.8 倍（防贴脸硬下限）；
 *   4. minRadius/maxRadius 次序正确，preserveAngles 只调距离不改方位。
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { computeIsolatedFraming, type FramingBox } from '../src/components/equipment3d/cameraFraming';

const BOX: FramingBox = { w: 7.8, h: 5.9, d: 4.5, x: 10, z: -6, y: 0 };

/** 把包围盒 8 角按槽位角旋转后投影到 NDC，返回最大绝对值（x/y 分开）。 */
function maxCornerNDC(box: FramingBox, result: ReturnType<typeof computeIsolatedFraming>, aspect: number) {
  const cam = new THREE.PerspectiveCamera(46, aspect, 0.6, 2600);
  const phi = result.phi;
  cam.position.set(
    result.target.x + result.radius * Math.sin(phi) * Math.sin(result.theta),
    result.target.y + result.radius * Math.cos(phi),
    result.target.z + result.radius * Math.sin(phi) * Math.cos(result.theta),
  );
  cam.lookAt(result.target);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();

  const a = 0; // 槽位角 0，与盒子轴对齐简化
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  let maxX = 0;
  let maxY = 0;
  for (const lx of [-box.w / 2, box.w / 2]) {
    for (const ly of [box.y ?? 0, (box.y ?? 0) + box.h]) {
      for (const lz of [-box.d / 2, box.d / 2]) {
        const px = lx * ca + lz * sa;
        const pz = -lx * sa + lz * ca;
        const p = new THREE.Vector3(
          (box.centerX ?? box.x) + px,
          ly,
          (box.centerZ ?? box.z) + pz,
        ).project(cam);
        maxX = Math.max(maxX, Math.abs(p.x));
        maxY = Math.max(maxY, Math.abs(p.y));
      }
    }
  }
  return { maxX, maxY };
}

describe('cameraFraming.computeIsolatedFraming', () => {
  it('宽屏 1.6 纵横比：8 角全部落在视锥内（NDC ≤ 0.9 + 余量）', () => {
    const f = computeIsolatedFraming(BOX, { fov: 46, aspect: 1.6, near: 0.6 }, { slotAngle: 0 });
    const { maxX, maxY } = maxCornerNDC(BOX, f, 1.6);
    expect(maxX).toBeLessThanOrEqual(0.95);
    expect(maxY).toBeLessThanOrEqual(0.95);
  });

  it('窄屏 0.5 纵横比：自动取景仍能框住设备（角点适配，不沿用宽屏距离）', () => {
    const wide = computeIsolatedFraming(BOX, { fov: 46, aspect: 1.6, near: 0.6 }, { slotAngle: 0 });
    const narrow = computeIsolatedFraming(BOX, { fov: 46, aspect: 0.5, near: 0.6 }, { slotAngle: 0 });
    expect(narrow.radius).toBeGreaterThan(wide.radius);
    const { maxX, maxY } = maxCornerNDC(BOX, narrow, 0.5);
    expect(maxX).toBeLessThanOrEqual(0.95);
    expect(maxY).toBeLessThanOrEqual(0.95);
  });

  it('默认俯角 1.0 rad ≈ 33°（25-35° 观感区间），preserveAngles 保留当前方位', () => {
    const f = computeIsolatedFraming(BOX, { fov: 46, aspect: 1.6, near: 0.6 }, { slotAngle: 1.2 });
    expect(f.phi).toBeCloseTo(1.0, 5);
    expect(f.theta).toBeCloseTo(1.2 + 0.6, 5);

    const preserved = computeIsolatedFraming(
      BOX,
      { fov: 46, aspect: 1.6, near: 0.6 },
      { slotAngle: 1.2, preserveAngles: true, currentPhi: 0.8, currentTheta: 2.5 },
    );
    expect(preserved.phi).toBe(0.8);
    expect(preserved.theta).toBe(2.5);
  });

  it('轨道半径 ≥ 外接球半径 1.8 倍（防贴脸硬下限），且 min ≤ radius ≤ max', () => {
    const f = computeIsolatedFraming(BOX, { fov: 46, aspect: 1.6, near: 0.6 }, { slotAngle: 0 });
    const rSphere = 0.5 * Math.sqrt(BOX.w ** 2 + BOX.h ** 2 + BOX.d ** 2);
    expect(f.boundingRadius).toBeCloseTo(rSphere, 5);
    expect(f.radius).toBeGreaterThanOrEqual(rSphere * 1.8 - 1e-6);
    expect(f.minRadius).toBeLessThanOrEqual(f.radius);
    expect(f.radius).toBeLessThanOrEqual(f.maxRadius);
  });

  it('目标点始终是包围盒中心（聚焦机位居中口径），targetY 仅微调高度', () => {
    const f = computeIsolatedFraming(BOX, { fov: 46, aspect: 1.6, near: 0.6 }, { slotAngle: 0 });
    expect(f.target.x).toBeCloseTo(BOX.x, 5);
    expect(f.target.y).toBeCloseTo(BOX.h / 2, 5);
    expect(f.target.z).toBeCloseTo(BOX.z, 5);

    const f2 = computeIsolatedFraming(BOX, { fov: 46, aspect: 1.6, near: 0.6 }, { slotAngle: 0, targetY: 4.5 });
    expect(f2.target.y).toBeCloseTo(4.5, 5);
  });
});
