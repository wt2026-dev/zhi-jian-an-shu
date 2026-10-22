// @vitest-environment jsdom
/**
 * 厂区场地细节守卫：验收线里"厂区有道路、绿化、车辆""不像简单盒子"的可断言部分。
 *
 * 钉住的是**存在性 + 排布合法性 + 不越预算**：
 *   1. 围墙沿边界成圈，且在四个真实出入口处留豁口（不能把大门砌死）；
 *   2. 门卫室 / 道闸 / 路灯 / 储罐 / 停车场 / 工人节点都存在，数量与台账规模相称；
 *   3. 场地设施不压厂房轮廓、不占主干道（要找空地）；
 *   4. 每帧更新走 FactoryOverview.addUpdater，装饰自己不开第二个 RAF；
 *   5. Draw Call 有上界（全部重复体走 InstancedMesh）；
 *   6. dispose 后场景里不残留、也不再回调。
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  attachPerimeterDecor,
  type PerimeterHost,
} from '../src/components/equipment3d/factoryPerimeterDecor';
import { FactoryOverview } from '../src/components/equipment3d/factoryOverview';
import { type FactoryBuildingSpec } from "../src/components/equipment3d/factoryOverviewTypes";;

const specs: FactoryBuildingSpec[] = [
  { id: 'hall-1', name: '1 号厂房・动力一车间', workshopId: '动力一车间', zoneId: 'zone-a', deviceCount: 14 },
  { id: 'hall-2', name: '2 号厂房・公用工程车间', workshopId: '公用工程车间', zoneId: 'zone-a', deviceCount: 11 },
  { id: 'hall-3', name: '3 号厂房・重型热轧车间', workshopId: '重型热轧车间', zoneId: 'zone-b', deviceCount: 8 },
  { id: 'hall-4', name: '4 号厂房・智能装配车间', workshopId: '智能装配车间', zoneId: 'zone-b', deviceCount: 10 },
  { id: 'hall-5', name: '5 号厂房・物流装运车间', workshopId: '物流装运车间', zoneId: 'zone-c', deviceCount: 5 },
];

function makeFactory(): FactoryOverview {
  return new FactoryOverview({
    seed: 20260921,
    buildings: specs,
    zones: [
      { id: 'zone-a', name: 'A 区' },
      { id: 'zone-b', name: 'B 区' },
      { id: 'zone-c', name: 'C 区' },
    ],
    shadows: false,
    detail: 2,
  });
}

function namedNodes(root: THREE.Object3D): Set<string> {
  const names = new Set<string>();
  root.traverse((o) => {
    if (o.name) names.add(o.name);
  });
  return names;
}

/** 取某个 InstancedMesh 的实例世界位置（根节点位于原点，直接用局部即可）。 */
function instancePositions(root: THREE.Object3D, name: string): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  root.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (!im.isInstancedMesh || im.name !== name) return;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m);
      m.decompose(p, q, s);
      out.push(p.clone());
    }
  });
  return out;
}

describe('FactoryOverview.addUpdater', () => {
  it('注册的回调由 update 驱动，注销后不再被调用', () => {
    const fo = makeFactory();
    let hits = 0;
    const off = fo.addUpdater(() => hits++);
    fo.update(0.016, 1);
    fo.update(0.016, 2);
    expect(hits).toBe(2);
    off();
    fo.update(0.016, 3);
    expect(hits).toBe(2);
    fo.dispose();
  });

  it('setPaused(true) 时不驱动装饰回调（暂停语义覆盖装饰层）', () => {
    const fo = makeFactory();
    let hits = 0;
    fo.addUpdater(() => hits++);
    fo.setPaused(true);
    fo.update(0.016, 1);
    expect(hits).toBe(0);
    fo.setPaused(false);
    fo.update(0.016, 2);
    expect(hits).toBe(1);
    fo.dispose();
  });
});

describe('围墙与出入口', () => {
  it('沿园区边界成圈，且数量与周长相称', () => {
    const fo = makeFactory();
    const decor = attachPerimeterDecor(fo as unknown as PerimeterHost);
    const { halfX, halfZ } = fo.extent;
    const perimeter = 2 * (2 * halfX + 2 * halfZ);
    // 每 3.2m 一段，允许开口与裁剪带来的余量
    expect(decor.stats.fencePanels).toBeGreaterThan(perimeter / 6);
    expect(decor.stats.fencePanels).toBeLessThan(perimeter / 2.4);
    decor.dispose();
    fo.dispose();
  });

  it('每个真实出入口处都是豁口（门不会被围墙砌死）', () => {
    const fo = makeFactory();
    attachPerimeterDecor(fo as unknown as PerimeterHost);
    const panels = instancePositions(fo.group, 'fencePanels');
    for (const gate of fo.gates) {
      const near = panels.filter(
        (p) => Math.hypot(p.x - gate.x, p.z - gate.z) < 9
      );
      expect(near.length).toBe(0);
    }
    fo.dispose();
  });

  it('道闸杆与门卫室落在门的内侧，不悬在园区外', () => {
    const fo = makeFactory();
    attachPerimeterDecor(fo as unknown as PerimeterHost);
    const { halfX, halfZ } = fo.extent;
    for (const name of ['gateBoomArms', 'gateBooths']) {
      const list = instancePositions(fo.group, name);
      expect(list.length).toBe(fo.gates.length);
      for (const p of list) {
        expect(Math.abs(p.x)).toBeLessThan(halfX);
        expect(Math.abs(p.z)).toBeLessThan(halfZ);
      }
    }
    fo.dispose();
  });
});

describe('场地设施', () => {
  it('路灯成排且落在主干道两侧', () => {
    const fo = makeFactory();
    const decor = attachPerimeterDecor(fo as unknown as PerimeterHost);
    expect(decor.stats.lamps).toBeGreaterThanOrEqual(16);
    const poles = instancePositions(fo.group, 'lampPoles');
    const heads = instancePositions(fo.group, 'lampHeads');
    expect(heads.length).toBe(poles.length);
    // 灯杆贴着十字路两侧：|x| 或 |z| ≈ 10.8
    const onRoadside = poles.filter(
      (p) => Math.abs(Math.abs(p.x) - 10.8) < 0.6 || Math.abs(Math.abs(p.z) - 10.8) < 0.6
    );
    expect(onRoadside.length).toBe(poles.length);
    fo.dispose();
  });

  it('储罐不压厂房、不占主干道，并且有支腿与管廊支架', () => {
    const fo = makeFactory();
    const decor = attachPerimeterDecor(fo as unknown as PerimeterHost);
    const shells = instancePositions(fo.group, 'tankShells');
    expect(shells.length).toBe(decor.stats.tanks);
    expect(shells.length).toBeGreaterThan(0);
    for (const p of shells) {
      expect(Math.abs(p.x)).toBeGreaterThan(12);
      expect(Math.abs(p.z)).toBeGreaterThan(12);
      for (const b of fo.placed) {
        const hit =
          Math.abs(p.x - b.x) < b.w / 2 + 2 && Math.abs(p.z - b.z) < b.d / 2 + 2;
        expect(hit).toBe(false);
      }
    }
    const names = namedNodes(fo.group);
    expect(names.has('tankLegs')).toBe(true);
    expect(names.has('pipeRackPosts')).toBe(true);
    fo.dispose();
  });

  it('停车场有划线与停放车辆，且车位数不为 0', () => {
    const fo = makeFactory();
    const decor = attachPerimeterDecor(fo as unknown as PerimeterHost);
    expect(decor.stats.parkingSlots).toBeGreaterThan(0);
    expect(decor.stats.parkedVehicles).toBeGreaterThan(0);
    const names = namedNodes(fo.group);
    expect(names.has('parkingLines')).toBe(true);
    expect(names.has('parkedCars')).toBe(true);
    expect(names.has('parkingPad')).toBe(true);
    fo.dispose();
  });
});

describe('工人和车辆', () => {
  it('每栋厂房门口 3 人 + 门口 4 人，规模随台账走', () => {
    const fo = makeFactory();
    const decor = attachPerimeterDecor(fo as unknown as PerimeterHost);
    expect(decor.stats.workers).toBe(fo.placed.length * 3 + 4);
    expect(instancePositions(fo.group, 'workerBodies').length).toBe(decor.stats.workers);
    expect(instancePositions(fo.group, 'workerHats').length).toBe(decor.stats.workers);
    fo.dispose();
  });

  it('update 后人会沿路径走动（实例矩阵确实被改写）', () => {
    const fo = makeFactory();
    attachPerimeterDecor(fo as unknown as PerimeterHost);
    const before = instancePositions(fo.group, 'workerBodies');
    for (let i = 0; i < 40; i++) fo.update(0.016, i * 0.016);
    const after = instancePositions(fo.group, 'workerBodies');
    const moved = after.filter((p, i) => p.distanceTo(before[i]) > 0.05).length;
    expect(moved).toBeGreaterThan(0);
    // 车辆也在动
    const carsBefore = instancePositions(fo.group, 'roadVehicles');
    for (let i = 0; i < 60; i++) fo.update(0.016, 1 + i * 0.016);
    const carsAfter = instancePositions(fo.group, 'roadVehicles');
    expect(carsAfter.some((p, i) => p.distanceTo(carsBefore[i]) > 0.05)).toBe(true);
    fo.dispose();
  });
});

describe('预算与回收', () => {
  it('整套场地装饰的 Draw Call 有上界（重复体全部实例化）', () => {
    const fo = makeFactory();
    const decor = attachPerimeterDecor(fo as unknown as PerimeterHost);
    expect(decor.stats.drawCalls).toBeLessThanOrEqual(30);
    fo.dispose();
  });

  it('dispose 后场景里不残留装饰节点，也不再驱动回调', () => {
    const fo = makeFactory();
    const decor = attachPerimeterDecor(fo as unknown as PerimeterHost);
    const before = namedNodes(fo.group);
    expect(before.has('fencePanels')).toBe(true);
    decor.dispose();
    expect(namedNodes(fo.group).has('fencePanels')).toBe(false);
    // 不再抛错：说明 updater 已注销
    expect(() => fo.update(0.016, 5)).not.toThrow();
    expect(instancePositions(fo.group, 'workerBodies').length).toBe(0);
    fo.dispose();
  });
});
