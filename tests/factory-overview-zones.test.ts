// @vitest-environment jsdom
/**
 * 厂区总览层（对标参考图 r1）回归守卫。
 *
 * 画面本身无法断言，所以这里锁的是**可被程序化验证的不变量**：
 *   1. 分区成簇 —— 建筑按分区落位，各分区地块中心互不重合（不是均匀排一排）；
 *   2. 指标口径 —— 分区视图的数值**全部**由调用方传入的真实台账派生，
 *      没有数据源的一律为 null（不编造产值 / 良品率）；
 *   3. 排名口径 —— 有产值按产值、否则按可算的设备故障率；名次连续且唯一；
 *   4. 出口分布 —— 4 个出入口标记，坐标落在园区包围盒内；
 *   5. 拾取 —— 厂房拾取体与分区地块拾取体数量、userData 与数据一一对应；
 *   6. 选中分区 —— 厂房标牌只展开选中分区，其余变暗；
 *   7. **贴牌恒定屏幕尺寸** —— three r186 把 sizeAttenuation 语义翻转过，
 *      漏写就会让所有标牌退化成亚像素级（画面全丢），这里钉死。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import {
  FactoryOverview,
  defaultBuildingSpecs,
  type FactoryBuildingSpec,
  type FactoryZoneSpec,
} from '../src/components/equipment3d/factoryOverview';

/** jsdom 未安装 canvas 包时 getContext('2d') 返回 null，贴图分支会被整体跳过。 */
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

/** 5 栋厂房 / 3 分区，带真实派生指标。 */
function makeSpecs(): FactoryBuildingSpec[] {
  return [
    { id: 'h1', name: '1 号厂房・机加车间', zoneId: 'za', deviceCount: 4, abnormalCount: 1, healthAvg: 80, openWorkOrders: 2, status: 'warning' },
    { id: 'h2', name: '2 号厂房・装配车间', zoneId: 'za', deviceCount: 4, abnormalCount: 1, healthAvg: 60, openWorkOrders: 3, status: 'warning' },
    { id: 'h3', name: '3 号厂房・焊接车间', zoneId: 'zb', deviceCount: 3, abnormalCount: 0, healthAvg: 92, openWorkOrders: 0, status: 'normal' },
    { id: 'h4', name: '4 号厂房・涂装车间', zoneId: 'zb', deviceCount: 3, abnormalCount: 0, healthAvg: 88, openWorkOrders: 1, status: 'normal' },
    { id: 'h5', name: '5 号厂房・立体库房', zoneId: 'zc', deviceCount: 2, abnormalCount: 0, healthAvg: 75, openWorkOrders: 0, status: 'normal' },
  ];
}

const ZONES: FactoryZoneSpec[] = [
  { id: 'za', name: 'A 区' },
  { id: 'zb', name: 'B 区' },
  { id: 'zc', name: 'C 区' },
];

function make(extra?: Partial<{ zones: FactoryZoneSpec[]; specs: FactoryBuildingSpec[] }>): FactoryOverview {
  return new FactoryOverview({
    seed: 7,
    buildings: extra?.specs ?? makeSpecs(),
    zones: extra?.zones ?? ZONES,
    shadows: false,
    detail: 2,
  });
}

describe('厂区总览：分区地图形态', () => {
  it('建筑按分区成簇，各地块中心互不重合（不是均匀排一排）', () => {
    const f = make();
    expect(f.placed.length).toBe(5);
    for (const b of f.placed) expect(b.zoneId).toBeTruthy();

    const boxes = ZONES.map((z) => f.boxOfZone(z.id)!);
    expect(boxes.every(Boolean)).toBe(true);
    const centers = boxes.map((b) => `${Math.round(b.x)},${Math.round(b.z)}`);
    expect(new Set(centers).size).toBe(3);

    // 各分区至少有一栋厂房
    for (const z of ZONES) {
      expect(f.placed.filter((b) => b.zoneId === z.id).length).toBeGreaterThan(0);
    }
    f.dispose();
  });

  it('未提供分区定义时按序号自动编号（不臆造业务含义）', () => {
    const f = new FactoryOverview({
      seed: 3,
      buildings: defaultBuildingSpecs(4),
      shadows: false,
      detail: 1,
    });
    const zs = f.zones;
    expect(zs.length).toBeGreaterThanOrEqual(1);
    expect(zs.length).toBeLessThanOrEqual(4);
    for (const z of zs) expect(z.name).toMatch(/^[A-D] 区$/);
    f.dispose();
  });

  it('包围盒覆盖全部厂房与分区地块', () => {
    const f = make();
    const ext = f.extent;
    for (const b of f.placed) {
      expect(Math.abs(b.x) + b.w / 2).toBeLessThanOrEqual(ext.halfX);
      expect(Math.abs(b.z) + b.d / 2).toBeLessThanOrEqual(ext.halfZ);
    }
    for (const z of ZONES) {
      const box = f.boxOfZone(z.id)!;
      expect(Math.abs(box.x) + box.w / 2).toBeLessThanOrEqual(ext.halfX);
      expect(Math.abs(box.z) + box.d / 2).toBeLessThanOrEqual(ext.halfZ);
    }
    expect(f.boxOfZone('不存在')).toBeNull();
    f.dispose();
  });
});

describe('厂区总览：指标口径（不编造业务数值）', () => {
  it('设备故障率 = 异常台数 / 设备总数，全部由传入数据派生', () => {
    const f = make();
    const za = f.zones.find((z) => z.id === 'za')!;
    // A 区：4+4 台，异常 1+1 → 2/8 = 25%
    expect(za.deviceCount).toBe(8);
    expect(za.abnormalCount).toBe(2);
    expect(za.failureRate).toBeCloseTo(25, 5);
    // 健康分取均值 (80+60)/2
    expect(za.healthAvg).toBeCloseTo(70, 5);
    // 未闭环工单 2+3
    expect(za.openWorkOrders).toBe(5);
    expect(za.status).toBe('warning');

    const zb = f.zones.find((z) => z.id === 'zb')!;
    expect(zb.failureRate).toBeCloseTo(0, 5);
    expect(zb.status).toBe('normal');
    f.dispose();
  });

  it('未接入数据源的分区：故障率 / 产值 / 良品率一律 null（不补零、不模拟）', () => {
    const f = new FactoryOverview({
      seed: 1,
      buildings: [{ id: 'h1', name: '1 号厂房' }],
      shadows: false,
      detail: 1,
    });
    const z = f.zones[0];
    expect(z.deviceCount).toBe(0);
    expect(z.failureRate).toBeNull();
    expect(z.healthAvg).toBeNull();
    expect(z.staffCount).toBeNull();
    expect(z.openWorkOrders).toBeNull();
    expect(z.outputValue).toBeNull();
    expect(z.yieldRate).toBeNull();
    f.dispose();
  });

  it('调用方给了产值 / 良品率时如实透传', () => {
    const f = make({
      zones: [
        { id: 'za', name: 'A 区', outputValue: 12800, yieldRate: 98.6 },
        { id: 'zb', name: 'B 区', outputValue: 9400, yieldRate: 97.2 },
        { id: 'zc', name: 'C 区' },
      ],
    });
    const za = f.zones.find((z) => z.id === 'za')!;
    expect(za.outputValue).toBe(12800);
    expect(za.yieldRate).toBeCloseTo(98.6, 5);
    f.dispose();
  });
});

describe('厂区总览：产值标牌排名', () => {
  it('无产值数据源时退回"设备故障率（低→优）"，名次连续唯一', () => {
    const f = make();
    expect(f.rankMetricValue).toBe('failureRate');
    const ranks = f.zones.map((z) => z.rank).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3]);
    // A 区故障率 25% 最差 → 第 3；B 区 0% 最优 → 第 1
    expect(f.zones.find((z) => z.id === 'za')!.rank).toBe(3);
    expect(f.zones.find((z) => z.id === 'zb')!.rank).toBe(1);
    f.dispose();
  });

  it('有产值数据源时自动按产值排名（高→优）', () => {
    const f = make({
      zones: [
        { id: 'za', name: 'A 区', outputValue: 12800 },
        { id: 'zb', name: 'B 区', outputValue: 9400 },
        { id: 'zc', name: 'C 区', outputValue: 15600 },
      ],
    });
    expect(f.rankMetricValue).toBe('output');
    expect(f.zones.find((z) => z.id === 'zc')!.rank).toBe(1);
    expect(f.zones.find((z) => z.id === 'zb')!.rank).toBe(3);
    f.dispose();
  });

  it('可切换排名口径，名次随之重算', () => {
    const f = make();
    f.setRankMetric('health');
    expect(f.rankMetricValue).toBe('health');
    // B 区健康分 (92+88)/2 = 90 最高 → 第 1
    expect(f.zones.find((z) => z.id === 'zb')!.rank).toBe(1);
    expect(f.zones.find((z) => z.id === 'za')!.rank).toBe(3);
    f.dispose();
  });
});

describe('厂区总览：出入口与拾取', () => {
  it('生成 4 个出入口标记，坐标落在园区包围盒内，种类不重复', () => {
    const f = make();
    expect(f.gates.length).toBe(4);
    const kinds = new Set(f.gates.map((g) => g.kind));
    expect(kinds.size).toBe(4);
    const ext = f.extent;
    for (const g of f.gates) {
      expect(Math.abs(g.x)).toBeLessThanOrEqual(ext.halfX);
      expect(Math.abs(g.z)).toBeLessThanOrEqual(ext.halfZ);
      // 连线终点必须朝园区内部收
      expect(Math.abs(g.linkTo.x)).toBeLessThanOrEqual(Math.abs(g.x) + 1e-6);
      expect(Math.abs(g.linkTo.z)).toBeLessThanOrEqual(Math.abs(g.z) + 1e-6);
    }
    f.dispose();
  });

  it('厂房拾取体与分区地块拾取体与数据一一对应', () => {
    const f = make();
    expect(f.picks.length).toBe(f.placed.length);
    expect(f.zonePicks.length).toBe(ZONES.length);
    for (const p of f.picks) {
      expect(p.userData.pick).toBe('building');
      expect(f.placed.some((b) => b.id === p.userData.buildingId)).toBe(true);
    }
    for (const p of f.zonePicks) {
      expect(p.userData.pick).toBe('zone');
      expect(ZONES.some((z) => z.id === p.userData.zoneId)).toBe(true);
    }
    expect(f.zoneOf('h5')).toBe('zc');
    expect(f.zoneOf('不存在')).toBeNull();
    f.dispose();
  });

  it('选中分区：厂房标牌只展开该分区，未选中时全部收起', () => {
    const f = make();
    const sprites: THREE.Sprite[] = [];
    f.group.traverse((o) => {
      const s = o as THREE.Sprite;
      if (s.isSprite && s.userData.kind === 'buildingLabel') sprites.push(s);
    });
    expect(sprites.length).toBe(5);

    // 默认（未选中）→ 全部隐藏，画面只剩分区产值标牌
    f.setActiveZone(null);
    expect(sprites.every((s) => s.visible === false)).toBe(true);

    f.setActiveZone('za');
    expect(f.activeZone).toBe('za');
    const visible = sprites.filter((s) => s.visible);
    expect(visible.length).toBe(2);
    for (const s of visible) expect(s.userData.zoneId).toBe('za');

    f.setActiveZone(null);
    expect(sprites.every((s) => s.visible === false)).toBe(true);
    f.dispose();
  });
});

describe('厂区总览：贴牌必须恒定屏幕尺寸（three r186 语义翻转守卫）', () => {
  it('所有贴牌 SpriteMaterial 的 sizeAttenuation 必须为 false', () => {
    const f = make();
    const sprites: THREE.Sprite[] = [];
    f.group.traverse((o) => {
      const s = o as THREE.Sprite;
      if (s.isSprite) sprites.push(s);
    });
    // 5 栋厂房标牌 + 3 个分区产值标牌 + 4 个出入口标牌 + 1 个在建工程徽章
    expect(sprites.length).toBeGreaterThanOrEqual(12);
    for (const s of sprites) {
      const m = s.material as THREE.SpriteMaterial;
      expect(m.sizeAttenuation, `标牌 ${s.userData.kind ?? s.userData.zoneId} 未关掉 sizeAttenuation`).toBe(false);
      // scale 是按"视口高度比例"给的，量级必须远小于 1（>1 会铺满整屏）
      expect(s.scale.x).toBeLessThan(0.5);
    }
    f.dispose();
  });
});

describe('厂区总览：生命周期', () => {
  it('update / dispose 幂等且不抛错', () => {
    const f = make();
    expect(() => {
      f.update(0.016, 1);
      f.update(0.016, 2);
      f.setPaused(true);
      f.update(0.016, 3);
      f.setPaused(false);
      f.setHighlight('h1');
      f.setHighlight(null);
      f.dispose();
      f.dispose();
    }).not.toThrow();
    expect(f.placed.length).toBe(0);
    expect(f.gates.length).toBe(0);
    expect(f.picks.length).toBe(0);
    expect(f.zonePicks.length).toBe(0);
    expect(f.zones.length).toBe(0);
  });
});
