/**
 * 劣化趋势引擎单测：全部用合成序列，不依赖数据库与大模型。
 * 重点盯三件事：ETA 不能瞎给、R² 不够时必须闭嘴、缺测不能当 0。
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeMetricTrend,
  evaluateDegradation,
  TREND_METRICS,
} from '../src/server/services/degradationTrend';

const temp = TREND_METRICS.find((m) => m.key === 'temperature')!;
const vib = TREND_METRICS.find((m) => m.key === 'vibration')!;

/** 确定性伪噪声，避免测试本身抖 */
const noise = (i: number, amp: number) => amp * Math.sin(i * 2.399) * Math.cos(i * 0.77);

describe('analyzeMetricTrend', () => {
  it('稳定上升的温度给出 rising + 可信 ETA', () => {
    const series = Array.from({ length: 24 }, (_, i) => 60 + 0.4 * i);
    const t = analyzeMetricTrend(temp, series);
    expect(t.direction).toBe('rising');
    expect(t.confidence).toBe('high');
    expect(t.r2).toBeGreaterThan(0.9);
    expect(t.exceedCount).toBe(0);
    // EWMA 落在 68~70，斜率 0.4 → 越 75°C 警戒线约十几小时后
    expect(t.etaToWarnHours).not.toBeNull();
    expect(t.etaToWarnHours!).toBeGreaterThan(5);
    expect(t.etaToWarnHours!).toBeLessThan(40);
  });

  it('已越限的序列不再给 ETA（已经发生了，不是预测）', () => {
    const series = Array.from({ length: 24 }, (_, i) => 70 + 0.5 * i);
    const t = analyzeMetricTrend(temp, series);
    expect(t.direction).toBe('rising');
    expect(t.exceedCount).toBeGreaterThan(0);
    expect(t.etaToWarnHours).toBeNull();
  });

  it('纯噪声平稳序列：R² 不够就判平稳，且绝不给 ETA', () => {
    const series = Array.from({ length: 48 }, (_, i) => 62 + noise(i, 3.2));
    const t = analyzeMetricTrend(temp, series);
    expect(t.direction).toBe('flat');
    expect(t.confidence).toBe('low');
    expect(t.etaToWarnHours).toBeNull();
  });

  it('常数序列 R² 记 0 而不是 1', () => {
    const t = analyzeMetricTrend(temp, Array.from({ length: 20 }, () => 55));
    expect(t.r2).toBe(0);
    expect(t.direction).toBe('flat');
  });

  it('下降趋势判 falling 且不给 ETA', () => {
    const series = Array.from({ length: 24 }, (_, i) => 74 - 0.5 * i);
    const t = analyzeMetricTrend(temp, series);
    expect(t.direction).toBe('falling');
    expect(t.etaToWarnHours).toBeNull();
  });

  it('样本不足 3 点时明确说"不足以判定"，不硬算', () => {
    const t = analyzeMetricTrend(temp, [61, 70]);
    expect(t.usedPoints).toBe(2);
    expect(t.direction).toBe('flat');
    expect(t.confidence).toBe('low');
    expect(t.basis).toContain('不足');
  });

  it('缺测点剔除但保留时间下标，斜率不被断点带歪', () => {
    const withGaps = Array.from({ length: 24 }, (_, i) => (i % 4 === 3 ? null : 60 + 0.4 * i));
    const t = analyzeMetricTrend(temp, withGaps);
    expect(t.usedPoints).toBe(18);
    expect(t.direction).toBe('rising');
    expect(t.slopePerHour).toBeCloseTo(0.4, 1);
  });

  it('振动指标按 ISO 10816-3 口径的 4.5 mm/s 警戒', () => {
    expect(vib.warnThreshold).toBe(4.5);
    const t = analyzeMetricTrend(vib, Array.from({ length: 24 }, (_, i) => 3.2 + 0.05 * i));
    expect(t.direction).toBe('rising');
    expect(t.etaToWarnHours).not.toBeNull();
  });
});

describe('evaluateDegradation 评级规则', () => {
  const rows = (temperature: (i: number) => number, vibration: (i: number) => number) =>
    Array.from({ length: 24 }, (_, i) => ({
      temperature: temperature(i),
      vibration: vibration(i),
      current: 50,
      pressure: 1.5,
      loadRate: 40,
      rpm: 1480,
    }));

  it('全指标受控 → 正常', () => {
    const r = evaluateDegradation(rows((i) => 58 + noise(i, 0.6), (i) => 2.4 + noise(i, 0.08)));
    expect(r.summary.riskLevel).toBe('正常');
    expect(r.summary.exceedTotal).toBe(0);
  });

  it('仅趋势上升、未越限 → 关注，且列出上升指标', () => {
    const r = evaluateDegradation(rows((i) => 60 + 0.35 * i, (i) => 2.5 + noise(i, 0.05)));
    expect(r.summary.riskLevel).toBe('关注');
    expect(r.summary.risingMetrics).toContain('temperature');
    expect(r.summary.earliestEtaHours).not.toBeNull();
  });

  it('单指标越限 → 警告', () => {
    const r = evaluateDegradation(rows(() => 78, (i) => 2.4 + noise(i, 0.05)));
    expect(r.summary.riskLevel).toBe('警告');
  });

  it('温度与振动同时越限 → 危险', () => {
    const r = evaluateDegradation(rows(() => 79, () => 5.6));
    expect(r.summary.riskLevel).toBe('危险');
    expect(r.summary.exceedTotal).toBeGreaterThan(0);
  });

  it('空历史不抛错，各指标标记样本不足', () => {
    const r = evaluateDegradation([]);
    expect(r.summary.riskLevel).toBe('正常');
    expect(r.perMetric.temperature.usedPoints).toBe(0);
    expect(r.perMetric.temperature.basis).toContain('不足');
  });

  it('数据库 NULL 不参与均值，不会被当成 0 读数', () => {
    const history = Array.from({ length: 12 }, (_, i) => ({
      temperature: i < 6 ? null : 60,
      vibration: null,
      current: null,
      pressure: null,
      loadRate: null,
      rpm: null,
    }));
    const r = evaluateDegradation(history);
    expect(r.perMetric.temperature.usedPoints).toBe(6);
    expect(r.perMetric.temperature.mean).toBe(60);
    expect(r.perMetric.vibration.usedPoints).toBe(0);
  });
});
