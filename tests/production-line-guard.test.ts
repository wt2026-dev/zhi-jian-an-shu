// @vitest-environment jsdom
/**
 * 车间生产线 / 厂区总览 / 故障定位标 的回归守卫。
 *
 * 这些是"画面可见"的改动，但画面无法被断言 —— 因此这里锁的是**可被程序化验证的不变量**：
 *   1. 机械臂数量被夹在 4–6，编号牌连续且唯一；
 *   2. 传送带物料箱会随 update() 位移，关闭开关后不动；
 *   3. 警示浮标**只**由真实状态驱动：故障/告警才生成，正常不生成，恢复后移除；
 *   4. 厂区厂房数、拾取体、包围盒一致；
 *   5. 故障定位标数量与 focusPointOf 正确。
 * 任一条被改坏，都会在这里红灯。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { ProductionLine, type DeviceAnchor } from '../src/components/equipment3d/productionLine';
import { FactoryOverview, defaultBuildingSpecs } from '../src/components/equipment3d/factoryOverview';
import { FaultLocator } from '../src/components/equipment3d/faultLocator';

/** jsdom 未安装 canvas 包时 getContext('2d') 返回 null，贴图分支会被整体跳过，
 *  导致"到底生成没生成标签/浮标"无法断言。这里挂最小 2D 上下文桩。 */
function makeCtxStub(): unknown {
  const noop = () => undefined;
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    shadowColor: '', shadowBlur: 0, font: '', textAlign: '', textBaseline: '',
    clearRect: noop, fillRect: noop, strokeRect: noop, fillText: noop, strokeText: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop,
    fill: noop, stroke: noop, save: noop, restore: noop, translate: noop, rotate: noop,
    measureText: (t: string) => ({ width: String(t).length * 10 }),
  };
}

beforeAll(() => {
  const proto = (globalThis as unknown as { HTMLCanvasElement?: { prototype: { getContext: unknown } } })
    .HTMLCanvasElement?.prototype;
  if (proto) proto.getContext = () => makeCtxStub();
});

function makeLine(stationCount = 6): ProductionLine {
  return new ProductionLine({
    seed: 20260918,
    stationCount,
    halfX: 27,
    halfZ: 20,
    shadows: false,
    detail: 2,
    zoneLabel: '4# 生产车间',
  });
}

/** 取物料箱实例矩阵的第 i 个平移分量（用于判断"动没动"）。 */
function boxX(line: ProductionLine, i = 0): number {
  const m = new THREE.Matrix4();
  line.boxMesh!.getMatrixAt(i, m);
  return new THREE.Vector3().setFromMatrixPosition(m).x;
}

describe('车间生产线 ProductionLine', () => {
  it('机械臂数量夹在 4–6，且编号牌连续唯一', () => {
    expect(makeLine(8).stations.length).toBe(6);
    expect(makeLine(2).stations.length).toBe(4);

    const line = makeLine(6);
    const codes = line.stations.map((s) => s.code);
    expect(codes).toEqual([
      '机械臂 001', '机械臂 002', '机械臂 003',
      '机械臂 004', '机械臂 005', '机械臂 006',
    ]);
    expect(new Set(codes).size).toBe(6);
  });

  it('每台机械臂都有独立拾取体', () => {
    const line = makeLine(5);
    expect(line.picks.length).toBe(5);
    for (const p of line.picks) expect(p.userData.pick).toBe('station');
  });

  it('双侧交错布置在中轴两侧，不压在传送带上', () => {
    const line = makeLine(6);
    const sides = line.stations.map((s) => Math.sign(s.z));
    expect(sides.every((s) => s === -1 || s === 1)).toBe(true);
    // 相邻两站应分处传送带两侧
    expect(sides[0]).not.toBe(sides[1]);
  });

  it('传送带物料箱会移动，关闭开关后静止', () => {
    const line = makeLine(6);
    expect(line.boxMesh).toBeTruthy();

    const before = boxX(line);
    line.update(1, 0);
    const after = boxX(line);
    expect(Math.abs(after - before)).toBeGreaterThan(0.5);

    line.setBeltEnabled(false);
    const paused0 = boxX(line);
    line.update(1, 1);
    expect(boxX(line)).toBeCloseTo(paused0, 5);
  });

  it('警示浮标只由真实状态驱动：故障生成、正常不生成、恢复后移除', () => {
    const line = makeLine(6);
    const mk = (id: string, status: DeviceAnchor['status']): DeviceAnchor => ({
      id, name: `设备${id}`, x: 0, z: 0, topY: 3, status,
    });

    line.setDeviceAnchors([mk('A', 'fault'), mk('B', 'running'), mk('C', 'warning')]);
    expect(line.warnedDeviceIds.sort()).toEqual(['A', 'C']);

    // C 恢复为正常 → 浮标必须消失
    line.setDeviceAnchors([mk('A', 'fault'), mk('B', 'running'), mk('C', 'running')]);
    expect(line.warnedDeviceIds).toEqual(['A']);

    // 全部正常 → 一个都不剩
    line.setDeviceAnchors([mk('A', 'running')]);
    expect(line.warnedDeviceIds).toEqual([]);
  });

  it('resetAnimation 把物料箱复位到起点', () => {
    const line = makeLine(6);
    const start = boxX(line);
    line.update(2, 0);
    expect(boxX(line)).not.toBeCloseTo(start, 3);
    line.resetAnimation();
    expect(boxX(line)).toBeCloseTo(start, 5);
  });

  it('dispose 后可安全再次调用（不抛异常）', () => {
    const line = makeLine(6);
    expect(() => {
      line.dispose();
      line.dispose();
    }).not.toThrow();
  });
});

describe('厂区总览 FactoryOverview', () => {
  it('厂房数量、拾取体与包围盒一致', () => {
    const specs = defaultBuildingSpecs(4);
    const f = new FactoryOverview({ seed: 1, buildings: specs, shadows: false, detail: 2 });

    expect(f.placed.length).toBe(4);
    expect(f.picks.length).toBe(4);
    for (const p of f.picks) expect(p.userData.pick).toBe('building');

    const ext = f.extent;
    for (const b of f.placed) {
      expect(Math.abs(b.x) + b.w / 2).toBeLessThanOrEqual(ext.halfX);
      expect(Math.abs(b.z) + b.d / 2).toBeLessThanOrEqual(ext.halfZ);
    }

    const box = f.boxOf('hall-2');
    expect(box).toBeTruthy();
    expect(box!.w).toBeGreaterThan(0);
    expect(f.boxOf('不存在')).toBeNull();
  });

  it('厂房数上限 5', () => {
    const many = defaultBuildingSpecs(5).concat([{ id: 'x', name: 'x' }]);
    const f = new FactoryOverview({ seed: 1, buildings: many, shadows: false, detail: 1 });
    expect(f.placed.length).toBe(5);
    f.dispose();
  });
});

describe('故障部位定位标 FaultLocator', () => {
  // 每处故障会往 group 里加 **2** 个对象：文字标签(Sprite) + 红色实体高亮
  // (光晕球/扫描环/落地光柱，见 makeMarker)。所以断言按"2 × 故障数"来写，
  // 而不是写死 1 —— 后者会在定位标视觉升级时无意义地红灯。
  // 真正要守的不变量是：**同一设备换部位时不累积、恢复后彻底摘除**。
  const PER_FAULT = 2;

  it('生成 / 更新 / 清空 与 focusPointOf 正确', () => {
    const fl = new FaultLocator();

    fl.setFaults([{ deviceId: 'E1', partName: '主轴轴承', x: 1, y: 2, z: 3 }]);
    expect(fl.activeDeviceIds).toEqual(['E1']);
    expect(fl.group.children.length).toBe(PER_FAULT);

    const p = fl.focusPointOf('E1');
    expect(p).toBeTruthy();
    // 对准点应抬升到标签中心，便于相机对准
    expect(p!.y).toBeCloseTo(2.6, 5);
    expect(p!.x).toBeCloseTo(1, 5);

    // 同一设备换部位：仍只有一组标，不累积
    fl.setFaults([{ deviceId: 'E1', partName: '电机绕组', x: 1, y: 2, z: 3 }]);
    expect(fl.group.children.length).toBe(PER_FAULT);

    fl.clear('E1');
    expect(fl.activeDeviceIds).toEqual([]);
    expect(fl.group.children.length).toBe(0);

    fl.setFaults([
      { deviceId: 'A', partName: '轴承', x: 0, y: 0, z: 0 },
      { deviceId: 'B', partName: '关节', x: 2, y: 1, z: 0 },
    ]);
    expect(fl.activeDeviceIds.sort()).toEqual(['A', 'B']);
    expect(fl.group.children.length).toBe(2 * PER_FAULT);
    // 只恢复一台：另一台的标必须留着
    fl.clear('A');
    expect(fl.activeDeviceIds).toEqual(['B']);
    expect(fl.group.children.length).toBe(PER_FAULT);
    fl.clearAll();
    expect(fl.group.children.length).toBe(0);

    fl.dispose();
  });
});
