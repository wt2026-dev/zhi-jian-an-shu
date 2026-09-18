import { afterEach, describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { DEVICE_FLUID_TYPES } from '../src/components/equipment3d/deviceProfiles';
import { FLUID_PATHS, FluidFlowSystem } from '../src/components/equipment3d/fluidFlow';
import type { DeviceSlot } from '../src/components/equipment3d/hall';

describe('3D 介质流动系统（Fluid Flow Visualization）', () => {
  const FLUID_DEVICE_IDS = [
    'eq-101', 'eq-102', 'eq-103', 'eq-105', 'eq-106',
    'eq-107', 'eq-111', 'eq-112', 'eq-113', 'eq-116',
  ];

  const NO_FLUID_DEVICE_IDS = [
    'eq-104', // 4# 电机
    'eq-108', // 8# 电机
    'eq-109', // 9# 五轴加工中心
    'eq-110', // 10# 焊接机器人
    'eq-114', // 14# 备用电机
    'eq-115', // 15# 码垛机器人
  ];

  it('介质类型映射严格覆盖指定的 10 台设备，无介质设备（电机/机器人/CNC）禁设介质', () => {
    // 恰好 10 台有介质
    expect(Object.keys(DEVICE_FLUID_TYPES).sort()).toEqual(FLUID_DEVICE_IDS.slice().sort());

    // 严禁为电机/CNC/机器人设置介质
    for (const noId of NO_FLUID_DEVICE_IDS) {
      expect((DEVICE_FLUID_TYPES as any)[noId]).toBeUndefined();
      expect((FLUID_PATHS as any)[noId]).toBeUndefined();
    }
  });

  it('介质颜色符合技术规格（水为蓝色、气为浅青、油为金色）', () => {
    // 泵与换热器：水（蓝色 0x38bdf8）
    expect(DEVICE_FLUID_TYPES['eq-101'].medium).toBe('water');
    expect(DEVICE_FLUID_TYPES['eq-101'].color).toBe(0x38bdf8);
    expect(DEVICE_FLUID_TYPES['eq-105'].medium).toBe('water');
    expect(DEVICE_FLUID_TYPES['eq-112'].medium).toBe('water');
    expect(DEVICE_FLUID_TYPES['eq-111'].medium).toBe('water');
    expect(DEVICE_FLUID_TYPES['eq-116'].medium).toBe('water');

    // 空压机与制冷机：空气/制冷剂（浅青 0x67e8f9）
    expect(DEVICE_FLUID_TYPES['eq-102'].medium).toBe('air');
    expect(DEVICE_FLUID_TYPES['eq-102'].color).toBe(0x67e8f9);
    expect(DEVICE_FLUID_TYPES['eq-106'].medium).toBe('air');
    expect(DEVICE_FLUID_TYPES['eq-113'].medium).toBe('air');

    // 减速机：润滑油（金色 0xfbbf24）
    expect(DEVICE_FLUID_TYPES['eq-103'].medium).toBe('oil');
    expect(DEVICE_FLUID_TYPES['eq-103'].color).toBe(0xfbbf24);
    expect(DEVICE_FLUID_TYPES['eq-107'].medium).toBe('oil');
    expect(DEVICE_FLUID_TYPES['eq-107'].color).toBe(0xfbbf24);
  });

  it('3#减速箱为封闭润滑油循环（isLoop: true），油路在油站与箱体间连通', () => {
    const p103 = FLUID_PATHS['eq-103'];
    expect(p103.isLoop).toBe(true);
    expect(p103.waypoints.length).toBeGreaterThanOrEqual(8);
    const hasOilTank = p103.waypoints.some(w => w.partKey === 'oilTank');
    const hasHousing = p103.waypoints.some(w => w.partKey === 'housing');
    expect(hasOilTank).toBe(true);
    expect(hasHousing).toBe(true);
  });

  const systems: FluidFlowSystem[] = [];
  const createSystem = (ids = ['eq-112']) => {
    const system = new FluidFlowSystem();
    systems.push(system);
    system.updateSlots(ids.map((_, i) => ({ x: i * 20, z: 0, angle: 0, radius: 3 })), ids.map(id => ({ id })), () => 0);
    return system;
  };
  const positions = (system: FluidFlowSystem) => Array.from(
    system.points.geometry.attributes.position.array.slice(0, system.points.geometry.drawRange.count * 3),
  );
  afterEach(() => {
    systems.splice(0).forEach(system => system.dispose());
    vi.restoreAllMocks();
  });

  it('管路坐标不携带无传感器依据的泄漏诊断配置', () => {
    for (const path of Object.values(FLUID_PATHS)) {
      expect(path).not.toHaveProperty('leakageCenter');
      expect(path).not.toHaveProperty('leakagePartKey');
    }
    expect(FLUID_PATHS['eq-112'].waypoints[3]).toEqual({ pos: [-1, 2.4, 0], partKey: 'dischargeElbow' });
  });

  it('未提供遥测时，包括12#泵在内的设备不显示流动', () => {
    const system = createSystem(FLUID_DEVICE_IDS);
    expect(system.points.geometry.drawRange.count).toBe(0);
    system.update(1, 1);
    expect(positions(system)).toEqual([]);
    for (const id of FLUID_DEVICE_IDS) {
      system.setIsolation(id);
      system.update(1, 2);
      expect(positions(system)).toEqual([]);
    }
  });

  it.each(['running', 'warning'])('%s 无有限正测量值时不显示流动', status => {
    const system = createSystem();
    for (const value of [undefined, NaN, Infinity, -Infinity, 0, -1]) {
      system.setDeviceTelemetry('eq-112', { status, loadRate: value, rpm: value });
      system.update(1, 1);
      expect(positions(system)).toEqual([]);
    }
  });

  it.each([undefined, '', 'unknown', 'nodata', 'fault', 'critical', 'standby', 'overhauling', 'scrapped'])(
    '%s 状态不能仅凭正测量值暗示流动、堵塞或泄漏', status => {
      const system = createSystem();
      system.setDeviceTelemetry('eq-112', { status, loadRate: 75, rpm: 1450 });
      system.update(1, 1);
      expect(positions(system)).toEqual([]);
    },
  );

  it.each([
    { loadRate: 50 }, { rpm: 750 }, { loadRate: 50, rpm: 750 },
    { loadRate: NaN, rpm: 750 }, { loadRate: 50, rpm: Infinity },
  ])('running/warning 可用真实正测量值驱动示意粒子 %j', measurements => {
    for (const status of ['running', 'warning']) {
      const system = createSystem();
      system.setDeviceTelemetry('eq-112', { status, ...measurements });
      system.update(0, 0);
      const before = positions(system);
      expect(before.length).toBeGreaterThan(0);
      system.update(0.1, 0); // Fixed wobble time isolates progress along the path.
      expect(positions(system)).not.toEqual(before);
      expect(positions(system).every(Number.isFinite)).toBe(true);
      expect(system.points.userData.visualization).toBe('schematic');
    }
  });

  it.each([{ loadRate: 0, rpm: 750 }, { loadRate: 50, rpm: 0 }, { loadRate: -1, rpm: 750 }])(
    '显式零/负测量值不被其他信号替代 %j', measurements => {
      const system = createSystem();
      system.setDeviceTelemetry('eq-112', { status: 'running', ...measurements });
      system.update(1, 1);
      expect(positions(system)).toEqual([]);
    },
  );

  it('快照替换清除旧测量；故障不改变路径进度或聚集到假定破损点', () => {
    const system = createSystem();
    system.setDeviceTelemetry('eq-112', { status: 'running', loadRate: 50 });
    system.update(0, 0);
    const before = positions(system);
    system.setDeviceTelemetry('eq-112', { status: 'fault', loadRate: 50 });
    expect(system.points.geometry.drawRange.count).toBe(0);
    system.update(1, 1);
    expect(positions(system)).toEqual([]);
    system.setDeviceTelemetry('eq-112', { status: 'running', loadRate: 50 });
    system.update(0, 0);
    expect(positions(system)).toEqual(before);
    system.setDeviceTelemetry('eq-112', { status: 'running' });
    system.update(1, 1);
    expect(positions(system)).toEqual([]);
  });

  it('保留旋转、缩放、地形高度与拆解部件位移，且隔离只显示选中设备', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const system = createSystem(['eq-101', 'eq-112']);
    system.updateSlots([
      { x: 10, z: 20, angle: Math.PI / 2, radius: 3 },
      { x: 40, z: 20, angle: 0, radius: 3 },
    ], [{ id: 'eq-101' }, { id: 'eq-112' }], () => 3, 2);
    system.setDeviceTelemetry('eq-101', { status: 'running', rpm: 750 });
    system.setDeviceTelemetry('eq-112', { status: 'running', rpm: 750 });
    system.setIsolation('eq-101');
    system.update(0, 0);
    expect(system.points.geometry.drawRange.count).toBe(220);
    const base = positions(system);
    const expected = new THREE.Vector3(...FLUID_PATHS['eq-101'].waypoints[0].pos)
      .multiplyScalar(2).applyAxisAngle(THREE.Object3D.DEFAULT_UP, Math.PI / 2)
      .add(new THREE.Vector3(10, 3.04, 20));
    base.slice(0, 3).forEach((value, i) => expect(value).toBeCloseTo(expected.toArray()[i], 4));
    const group = new THREE.Group();
    const part = new THREE.Object3D();
    part.name = 'exploded_elbowS';
    part.userData.origWorldPos = new THREE.Vector3(1, 2, 3);
    part.position.set(3, 6, 9);
    group.add(part);
    system.setExploded('eq-101', true, group);
    system.update(0, 0);
    positions(system).slice(0, 3).forEach((value, i) => expect(value - base[i]).toBeCloseTo([2, 4, 6][i], 4));
    system.setExploded(null, false, null);
    system.update(0, 0);
    expect(positions(system)).toEqual(base);
    system.setIsolation('eq-103'); // Known path, but not present in these slots.
    system.update(0, 0);
    expect(positions(system)).toEqual([]);
  });

  it('粒子系统总数硬性约束：总览模式全部设备 ≤600，独占模式单台 ≤400，三角面增量为0', () => {
    const system = new FluidFlowSystem();

    // 构造模拟 16 台设备槽位
    const mockSlots: DeviceSlot[] = [];
    const mockDevices: Array<{ id: string }> = [];
    for (let i = 1; i <= 16; i++) {
      const id = `eq-${100 + i}`;
      mockDevices.push({ id });
      mockSlots.push({
        x: (i % 4) * 8 - 12,
        z: Math.floor(i / 4) * 8 - 12,
        angle: 0,
        radius: 3,
      });
    }

    system.updateSlots(mockSlots, mockDevices, () => 0, 1);
    for (const id of FLUID_DEVICE_IDS) {
      system.setDeviceTelemetry(id, { status: 'running', loadRate: 50 });
    }

    // 总览模式
    system.setIsolation(null);
    system.update(0.016, 0);

    const geo = system.points.geometry;
    const overviewCount = geo.drawRange.count;
    expect(overviewCount).toBeLessThanOrEqual(600);
    expect(overviewCount).toBeGreaterThan(0);

    // 独占模式测试：3#减速箱独占
    system.setIsolation('eq-103');
    system.update(0.016, 0.1);
    const isolated103Count = geo.drawRange.count;
    expect(isolated103Count).toBeLessThanOrEqual(400);

    // 独占模式测试：12#故障泵不渲染任何推断流动/泄漏粒子
    system.setIsolation('eq-112');
    system.setDeviceTelemetry('eq-112', { status: 'fault', loadRate: 15, rpm: 1200 });
    system.update(0.016, 0.2);
    const isolated112Count = geo.drawRange.count;
    expect(isolated112Count).toBe(0);
    expect(geo.attributes.position.count).toBe(450);

    // 独占无介质设备（如 4#电机）：粒子数必须为 0
    system.setIsolation('eq-104');
    system.update(0.016, 0.3);
    const isolated104Count = geo.drawRange.count;
    expect(isolated104Count).toBe(0);

    // 三角面约束：Points 为点元，不产生三角面
    expect(system.points.type).toBe('Points');

    system.dispose();
  });

  it('开关控制：setVisible 可完全隐藏/显示粒子', () => {
    const system = new FluidFlowSystem();
    expect(system.points.visible).toBe(true);

    system.setVisible(false);
    expect(system.points.visible).toBe(false);

    system.setVisible(true);
    expect(system.points.visible).toBe(true);

    system.dispose();
  });
});
