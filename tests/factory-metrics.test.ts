/**
 * 厂区估算指标口径单测（纯逻辑，node 环境）。
 *
 * 这条线是"把未接入填上合理数据"的**合规性**守卫：填的必须是"从真实台账派生 +
 * 带 estimated 标记"的估算，不能是写死的常量。所以断言集中在：
 *   1. 真实可算字段与台账逐一对齐（台数 / 异常 / 故障率 / 健康均分）；
 *   2. 零台账 → 全 null 且 estimated=false（不许凭空造一个数）；
 *   3. 估算字段随台账规模单调（A 区设备多 → 产值高），不是按 index 轮转的假象；
 *   4. 故障率越高、健康分越低 → 良品率越低（口径自洽）；
 *   5. 分区聚合：产值相加、良率按台数加权、null 不参与也不当 0；
 *   6. 同输入同输出（3D 侧重建时不会跳数）。
 */

import { describe, it, expect } from 'vitest';
import {
  estimateWorkshopMetrics,
  aggregateZoneMetrics,
  statusAbnormal,
  formatWan,
  ESTIMATE_NOTE,
  type LedgerDevice,
} from '../src/components/equipment3d/factoryMetrics';

const dev = (patch: Partial<LedgerDevice> = {}): LedgerDevice => ({
  status: 'running',
  healthScore: 92,
  criticality: '主要生产',
  ...patch,
});

const many = (n: number, patch: Partial<LedgerDevice> = {}): LedgerDevice[] =>
  Array.from({ length: n }, () => dev(patch));

describe('真实可算字段：与台账逐一对齐', () => {
  it('台数 / 异常台数 / 故障率 / 健康均分全部来自入参', () => {
    const m = estimateWorkshopMetrics({
      workshopName: '动力一车间',
      devices: [
        dev({ status: 'fault', healthScore: 40 }),
        dev({ status: 'warning', healthScore: 70 }),
        dev({ healthScore: 95 }),
        dev({ healthScore: 87 }),
      ],
    });
    expect(m.deviceCount).toBe(4);
    expect(m.abnormalCount).toBe(2);
    expect(m.failureRate).toBeCloseTo(50, 6);
    expect(m.healthAvg).toBeCloseTo((40 + 70 + 95 + 87) / 4, 6);
  });

  it('遥测派生的异常判定可由调用方注入（单一口径，不在这里重复实现）', () => {
    const devices = [dev({ status: 'running', healthScore: 30 }), dev()];
    const byStatus = estimateWorkshopMetrics({ workshopName: '机加工车间', devices });
    expect(byStatus.abnormalCount).toBe(0);
    const byHealth = estimateWorkshopMetrics({
      workshopName: '机加工车间',
      devices,
      isAbnormal: (d) => (d.healthScore ?? 100) < 50,
    });
    expect(byHealth.abnormalCount).toBe(1);
  });

  it('statusAbnormal 只认 fault / warning', () => {
    expect(statusAbnormal(dev({ status: 'fault' }))).toBe(true);
    expect(statusAbnormal(dev({ status: 'warning' }))).toBe(true);
    expect(statusAbnormal(dev({ status: 'overhauling' }))).toBe(false);
    expect(statusAbnormal(dev({ status: 'standby' }))).toBe(false);
    expect(statusAbnormal({})).toBe(false);
  });

  it('健康分全缺 → healthAvg 为 null，但产值仍可测算（不谎称有读数）', () => {
    const m = estimateWorkshopMetrics({
      workshopName: '公用工程车间',
      devices: [{ status: 'running' }, { status: 'running' }],
    });
    expect(m.healthAvg).toBeNull();
    expect(m.outputValue).not.toBeNull();
    expect(m.yieldRate).not.toBeNull();
  });
});

describe('零台账不编数', () => {
  it('没有设备 → 全部 null、estimated=false', () => {
    const m = estimateWorkshopMetrics({ workshopName: '新建车间', devices: [] });
    expect(m).toMatchObject({
      deviceCount: 0,
      abnormalCount: 0,
      failureRate: null,
      healthAvg: null,
      outputValue: null,
      yieldRate: null,
      staffCount: null,
      estimated: false,
    });
  });

  it('devices 非数组也不能抛错或造数', () => {
    const m = estimateWorkshopMetrics({
      workshopName: '智能装配车间',
      devices: undefined as unknown as LedgerDevice[],
    });
    expect(m.deviceCount).toBe(0);
    expect(m.outputValue).toBeNull();
  });
});

describe('估算字段随台账规模变化', () => {
  it('设备越多产值越高（口径不再是"按 index 轮转的写死数"）', () => {
    const small = estimateWorkshopMetrics({ workshopName: '重型热轧车间', devices: many(2) });
    const big = estimateWorkshopMetrics({ workshopName: '重型热轧车间', devices: many(12) });
    expect(big.outputValue!).toBeGreaterThan(small.outputValue! * 4);
    expect(big.staffCount!).toBeGreaterThan(small.staffCount!);
  });

  it('同样台数下，角色越重产值越高', () => {
    const heavy = estimateWorkshopMetrics({ workshopName: '重型热轧车间', devices: many(6) });
    const storage = estimateWorkshopMetrics({ workshopName: '物流装运车间', devices: many(6) });
    expect(heavy.role).toBe('heavy');
    expect(storage.role).toBe('storage');
    expect(heavy.outputValue!).toBeGreaterThan(storage.outputValue!);
  });

  it('关键核心设备比通用辅助贡献更大', () => {
    const core = estimateWorkshopMetrics({
      workshopName: '重型热轧车间',
      devices: many(4, { criticality: '关键核心' }),
    });
    const aux = estimateWorkshopMetrics({
      workshopName: '重型热轧车间',
      devices: many(4, { criticality: '通用辅助' }),
    });
    expect(core.outputValue!).toBeGreaterThan(aux.outputValue!);
  });

  it('停机 / 报废多的车间产值明显低于全运行', () => {
    const run = estimateWorkshopMetrics({ workshopName: '机加工车间', devices: many(6) });
    const down = estimateWorkshopMetrics({
      workshopName: '机加工车间',
      devices: [
        ...many(2),
        ...many(4, { status: 'standby' }),
      ],
    });
    expect(down.outputValue!).toBeLessThan(run.outputValue!);
    const scrapped = estimateWorkshopMetrics({
      workshopName: '机加工车间',
      devices: many(6, { status: 'scrapped' }),
    });
    expect(scrapped.outputValue).toBe(0);
  });
});

describe('良品率口径自洽', () => {
  it('故障率越高、健康分越低 → 良率越低', () => {
    const healthy = estimateWorkshopMetrics({ workshopName: '智能装配车间', devices: many(8) });
    const failing = estimateWorkshopMetrics({
      workshopName: '智能装配车间',
      devices: many(8, { status: 'fault', healthScore: 45 }),
    });
    expect(failing.yieldRate!).toBeLessThan(healthy.yieldRate!);
    expect(failing.failureRate).toBeCloseTo(100, 6);
  });

  it('良率始终落在 [92, 99.9]', () => {
    for (const health of [5, 40, 70, 99]) {
      for (const n of [1, 3, 9]) {
        for (const status of ['running', 'fault', 'warning', 'overhauling']) {
          const m = estimateWorkshopMetrics({
            workshopName: '烧结车间',
            devices: many(n, { healthScore: health, status }),
          });
          expect(m.yieldRate!).toBeGreaterThanOrEqual(92);
          expect(m.yieldRate!).toBeLessThanOrEqual(99.9);
        }
      }
    }
  });
});

describe('分区聚合', () => {
  const ws = (name: string, devices: LedgerDevice[]) =>
    estimateWorkshopMetrics({ workshopName: name, devices });

  it('产值 = 各车间相加，人数相加', () => {
    const a = ws('动力一车间', many(5));
    const b = ws('重型热轧车间', many(7));
    const z = aggregateZoneMetrics([a, b]);
    expect(z.outputValue).toBe(a.outputValue! + b.outputValue!);
    expect(z.staffCount).toBe(a.staffCount! + b.staffCount!);
    expect(z.deviceCount).toBe(12);
    expect(z.estimated).toBe(true);
  });

  it('良率与健康按台数加权（大车间说话更响）', () => {
    const big = ws('重型热轧车间', [
      ...many(10, { status: 'fault', healthScore: 50 }),
    ]);
    const tiny = ws('智能装配车间', [dev({ healthScore: 99 })]);
    const z = aggregateZoneMetrics([big, tiny]);
    expect(z.healthAvg).not.toBeNull();
    // 加权后必须明显偏向台数多的那一边
    expect(Math.abs(z.healthAvg! - big.healthAvg!)).toBeLessThan(
      Math.abs(z.healthAvg! - tiny.healthAvg!)
    );
    expect(z.failureRate).toBeCloseTo((10 / 11) * 100, 6);
  });

  it('null 车间不参与加权，也不会把整体拉成 0', () => {
    const ok = ws('机加工车间', many(4));
    const empty = ws('在建车间', []);
    const z = aggregateZoneMetrics([ok, empty]);
    expect(z.healthAvg).toBeCloseTo(ok.healthAvg!, 6);
    expect(z.yieldRate).toBeCloseTo(ok.yieldRate!, 6);
    expect(z.outputValue).toBe(ok.outputValue);
  });

  it('全空分区 → 全 null、estimated=false', () => {
    const z = aggregateZoneMetrics([ws('a', []), ws('b', [])]);
    expect(z).toMatchObject({
      deviceCount: 0,
      outputValue: null,
      yieldRate: null,
      staffCount: null,
      failureRate: null,
      healthAvg: null,
      estimated: false,
    });
  });

  it('非数组输入不抛错', () => {
    expect(aggregateZoneMetrics(undefined as unknown as never).deviceCount).toBe(0);
  });
});

describe('确定性与文案', () => {
  it('同输入必同输出（重建厂房不跳数）', () => {
    const input = {
      workshopName: '连铸车间',
      devices: many(9, { status: 'warning', healthScore: 78, criticality: '关键核心' }),
      zoneIndex: 1,
      indexInZone: 2,
    };
    expect(estimateWorkshopMetrics(input)).toEqual(estimateWorkshopMetrics(input));
  });

  it('产值文案走千分位，缺测返回 null 而不是 0', () => {
    expect(formatWan(1420)).toBe('1,420');
    expect(formatWan(null)).toBeNull();
    expect(formatWan(undefined)).toBeNull();
    expect(formatWan(Number.NaN)).toBeNull();
    expect(ESTIMATE_NOTE).toContain('测算');
  });

  it('NaN / null 字段不会污染结果', () => {
    const m = estimateWorkshopMetrics({
      workshopName: '冷轧精整车间',
      devices: [
        { status: null, healthScore: Number.NaN, criticality: null },
        dev({ healthScore: undefined }),
      ],
    });
    expect(Number.isFinite(m.outputValue as number)).toBe(true);
    expect(m.healthAvg).toBeNull();
    expect(m.abnormalCount).toBe(0);
  });
});
