// @vitest-environment jsdom
/**
 * L3 单设备故障定位标回归守卫 —— 「场景密度优先」版（2026-09）。
 *
 * 口径变更：设备详情层**不允许任何 3D 飘字**，旧版"故障位置 XXX" Sprite 文字标
 * 与落地光柱已整体移除；定位标 = 红色线框笼（优先包真实零件包围盒）+ 光晕球 +
 * 扫描环，部位名由右侧 DOM 面板展示。本文件锁住新的"看得见"口径：
 *   1. 定位标**不含任何 Sprite / 文字贴图 / 光柱**；
 *   2. 高亮材质一律 depthTest:false —— 故障部位常被外壳/管线挡住；
 *   3. 线框笼优先贴合传入的零件世界包围盒（bounds），无 bounds 时用标准笼盒；
 *   4. focusPointOf 与镜头对准点之间的偏移固定为 +0.6，聚焦逻辑依赖它；
 *   5. 维修进度减淡（勾一步消一层）与完工红→绿恢复动画（播完自移除）；
 *   6. clear / setFaults([]) / dispose 必须把高亮一起摘干净，不留悬挂引用。
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FaultLocator, type FaultAnchor } from '../src/components/equipment3d/faultLocator';

const ANCHOR: FaultAnchor = { deviceId: 'eq-101', partName: '主轴轴承', x: 12, y: 5, z: -8 };

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); });
  return out;
}

function linesOf(root: THREE.Object3D): THREE.LineSegments[] {
  const out: THREE.LineSegments[] = [];
  root.traverse((o) => { if ((o as THREE.LineSegments).isLineSegments) out.push(o as THREE.LineSegments); });
  return out;
}

describe('FaultLocator 红色高亮（无文字口径）', () => {
  it('一条定位标 = 光晕 + 扫描环 + 红色线框笼，绝无 Sprite 文字与落地光柱', () => {
    const fl = new FaultLocator();
    fl.setFaults([ANCHOR]);
    expect(fl.markerCount).toBe(1);

    // 3D 不飘任何文字：group 里不允许出现任何 Sprite
    const sprites: THREE.Sprite[] = [];
    fl.group.traverse((o) => { if ((o as THREE.Sprite).isSprite) sprites.push(o as THREE.Sprite); });
    expect(sprites.length).toBe(0);

    // 光柱（faultBeam）已随文字口径一并移除
    const beams = fl.group.children.filter((o) => o.userData?.kind === 'faultBeam');
    expect(beams.length).toBe(0);

    const marker = fl.group.children.find((o) => o.userData?.kind === 'faultMarker');
    expect(marker).toBeTruthy();
    // 光晕 + 扫描环 = 2 个 Mesh；线框笼 = 1 个 LineSegments
    expect(meshesOf(marker!).length).toBe(2);
    expect(linesOf(marker!).length).toBe(1);
    fl.dispose();
  });

  it('高亮材质为红色且 depthTest 关闭（被外壳挡住时也看得见）', () => {
    const fl = new FaultLocator();
    fl.setFaults([ANCHOR]);
    const marker = fl.group.children.find((o) => o.userData?.kind === 'faultMarker')!;
    for (const m of [...meshesOf(marker), ...linesOf(marker)]) {
      const mat = m.material as THREE.MeshBasicMaterial & THREE.LineBasicMaterial;
      expect(mat.depthTest, '高亮必须 depthTest:false，否则被设备外壳挡住就看不见').toBe(false);
      expect(mat.color.r).toBeGreaterThan(0.6);
      expect(mat.color.g).toBeLessThan(0.6);
      expect(mat.color.b).toBeLessThan(0.6);
    }
    fl.dispose();
  });

  it('线框笼优先贴合零件世界包围盒（bounds），无 bounds 用标准笼盒', () => {
    const fl = new FaultLocator();
    fl.setFaults([ANCHOR]);
    const cage = linesOf(fl.group)[0];
    // 标准笼盒：0.85³
    expect(cage.scale.x).toBeCloseTo(0.85, 5);
    expect(cage.scale.y).toBeCloseTo(0.85, 5);
    expect(cage.scale.z).toBeCloseTo(0.85, 5);

    // 传入真实零件包围盒：笼盒尺寸/中心随 bounds 走
    const bounds = { cx: 12.4, cy: 5.3, cz: -8.2, sx: 0.9, sy: 0.5, sz: 1.1 };
    fl.setFaults([{ ...ANCHOR, bounds }]);
    expect(cage.scale.x).toBeCloseTo(bounds.sx, 5);
    expect(cage.scale.y).toBeCloseTo(bounds.sy, 5);
    expect(cage.scale.z).toBeCloseTo(bounds.sz, 5);
    expect(cage.parent!.position.x).toBeCloseTo(bounds.cx, 5);
    expect(cage.parent!.position.y).toBeCloseTo(bounds.cy, 5);
    expect(cage.parent!.position.z).toBeCloseTo(bounds.cz, 5);

    // 同一台设备换部位：锚点/bounds 变了要跟着重摆
    fl.setFaults([{ ...ANCHOR, bounds: { ...bounds, cx: 13, cy: 6, sx: 0.4 } }]);
    expect(cage.scale.x).toBeCloseTo(0.4, 5);
    expect(cage.parent!.position.x).toBeCloseTo(13, 5);
    fl.dispose();
  });

  it('focusPointOf 返回锚点 +0.6 抬升（相机聚焦依赖该偏移）', () => {
    const fl = new FaultLocator();
    fl.setFaults([ANCHOR]);
    const p = fl.focusPointOf('eq-101');
    expect(p).not.toBeNull();
    expect(p!.x).toBe(12);
    expect(p!.y).toBeCloseTo(5.6, 5);
    expect(p!.z).toBe(-8);
    expect(fl.focusPointOf('eq-999')).toBeNull();
    fl.dispose();
  });

  it('update 会呼吸/自转（不是静止贴图），亮度有上限', () => {
    const fl = new FaultLocator();
    fl.setFaults([ANCHOR]);
    const marker = fl.group.children.find((o) => o.userData?.kind === 'faultMarker')!;
    const [halo, ring] = meshesOf(marker);
    const haloMat = halo.material as THREE.MeshBasicMaterial;
    const before = haloMat.opacity;
    const ringRot = ring.rotation.z;
    fl.update(0.016, 1.7);
    expect(haloMat.opacity).not.toBe(before);
    expect(ring.rotation.z).not.toBe(ringRot);
    // 亮度上限：太亮会糊成一块红饼，看不出"是哪个零件"
    for (let t = 0; t < 40; t++) fl.update(0.016, t * 0.13);
    expect(haloMat.opacity).toBeLessThan(0.9);
    fl.dispose();
  });

  it('维修进度：勾一步消一层（repairDim 减淡），全勾完定位标仍在', () => {
    const fl = new FaultLocator();
    fl.setFaults([ANCHOR]);
    const marker = fl.group.children.find((o) => o.userData?.kind === 'faultMarker')!;
    const haloMat = (meshesOf(marker)[0]).material as THREE.MeshBasicMaterial;
    fl.update(0.016, 0.3);
    fl.setRepairProgress('eq-101', 0.5);
    const o1 = haloMat.opacity;
    fl.update(0.016, 0.3);
    fl.setRepairProgress('eq-101', 1);
    const o2 = haloMat.opacity;
    // 减淡单调下降，但保留 15% 底亮（不为 0）
    expect(o1).toBeGreaterThan(0);
    expect(o2).toBeLessThan(o1);
    expect(o2).toBeGreaterThan(0);
    expect(fl.markerCount).toBe(1);
    fl.dispose();
  });

  it('完工恢复：红→绿扫过 + 淡出后自动移除定位标', () => {
    const fl = new FaultLocator();
    fl.setFaults([ANCHOR]);
    expect(fl.startRecovery('eq-101', 1.0)).toBe(true);
    expect(fl.startRecovery('eq-999')).toBe(false);
    const marker = fl.group.children.find((o) => o.userData?.kind === 'faultMarker')!;
    const haloMat = (meshesOf(marker)[0]).material as THREE.MeshBasicMaterial;
    fl.update(0.5, 1.0);
    const gMid = haloMat.color.g;
    // 播完（累计 1.0s ≥ duration）自动移除
    fl.update(0.5, 1.5);
    fl.update(0.1, 2.0);
    expect(fl.markerCount).toBe(0);
    expect(fl.group.children.length).toBe(0);
    // 中途颜色已向绿端移动（Color 存线性值：纯红 g≈0.058，绿端 g≈0.56，中点≈0.31）
    expect(gMid).toBeGreaterThan(0.2);
    fl.dispose();
  });

  it('clear / setFaults([]) / dispose 都把高亮摘干净', () => {
    const fl = new FaultLocator();
    fl.setFaults([ANCHOR, { ...ANCHOR, deviceId: 'eq-102' }]);
    expect(fl.group.children.length).toBe(2);

    fl.clear('eq-101');
    expect(fl.activeDeviceIds).toEqual(['eq-102']);
    expect(fl.group.children.length).toBe(1);

    fl.setFaults([]);
    expect(fl.markerCount).toBe(0);
    expect(fl.group.children.length).toBe(0);

    fl.setFaults([ANCHOR]);
    fl.dispose();
    expect(fl.group.children.length).toBe(0);
    expect(fl.markerCount).toBe(0);
  });
});
