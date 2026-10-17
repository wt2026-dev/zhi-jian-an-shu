// @vitest-environment jsdom
/**
 * 设备健康视图：**缺测不得补一个"看起来合理"的默认值**。
 *
 * 背景（2026-10-17）：`equipment_telemetry` 表里 temperature / vibration / current /
 * voltage / load_rate 全部**没有 NOT NULL**（002_inspections_telemetry.sql:43-48），
 * 所以接口完全可能返回"只上报了部分指标"的采样点。原代码是：
 *
 *   temperature: p.temperature ?? 65.0,
 *   vibration:   p.vibration   ?? 2.5,
 *   current:     p.current     ?? 45.0,
 *   voltage:     p.voltage     ?? 380.0,
 *   loadRate:    p.loadRate    ?? 75.0,
 *
 * 这些默认值**长得就像真实读数**（比 `|| 0` 更危险：0 一眼假，65°C 不像假的），
 * 而且紧接着就用它们判阈值告警 —— 于是一次"没采到"会被显示成"正常运转"。
 *
 * 现在缺测一律 null，UI 显示 —；告警判定只在有值时才做。
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import type { Equipment } from '../../src/types';

vi.mock('recharts', () => {
  const Box = ({ children }: any) => <div>{children}</div>;
  return {
    ResponsiveContainer: Box,
    AreaChart: Box,
    Area: () => null,
    LineChart: Box,
    Line: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    CartesianGrid: () => null,
    Legend: () => null,
  };
});
vi.mock('../../src/components/ai/AiResultModal', () => ({ AiResultModal: () => null }));
vi.mock('../../src/components/ai/AiWorkOrderDraftModal', () => ({ AiWorkOrderDraftModal: () => null }));
vi.mock('../../src/utils/demoMode', () => ({ isDemoMode: () => false }));

// 只上报了温度与振动，其余 4 个指标缺测（DB 允许 NULL）
vi.mock('../../src/api', () => ({
  equipmentApi: {
    getTelemetryHistory: vi.fn().mockResolvedValue({
      equipmentId: 'eq-101',
      points: [
        { timestamp: '08:00', temperature: 72.4, vibration: 3.1, current: null, voltage: null, loadRate: null },
        { timestamp: '09:00', temperature: 73.8, vibration: 3.4, current: null, voltage: null, loadRate: null },
      ],
    }),
  },
  aiApi: {
    equipmentSummary: vi.fn().mockResolvedValue(null),
    alarmCorrelation: vi.fn().mockResolvedValue(null),
    healthForecast: vi.fn().mockResolvedValue(null),
    workOrderDraft: vi.fn().mockResolvedValue(null),
  },
  safeStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
}));

import { EquipmentHealthView } from '../../src/components/EquipmentHealthView';

const equipment = {
  id: 'eq-101',
  code: 'EQ-101',
  name: '1#离心泵',
  category: '泵类',
  status: 'running',
  healthScore: 88,
  workshop: '一车间',
  location: 'A 区',
  model: 'X-100',
  manufacturer: '某厂',
  installDate: '2024-01-01',
  lastMaintenanceDate: '2026-08-01',
  nextMaintenanceDate: '2026-11-01',
  criticality: 'A',
  telemetry: {
    temperature: 72.4,
    vibration: 3.1,
    voltage: 380,
    current: 45,
    loadRate: 75,
    lastUpdated: '2026-10-17T09:00:00Z',
  },
} as unknown as Equipment;

const noop = () => {};

function renderView() {
  return render(
    <EquipmentHealthView
      equipments={[equipment]}
      selectedEquipmentId="eq-101"
      onOpenWorkOrder={noop}
      onOpenAiDiagnose={noop}
      onCreateWorkOrder={noop}
    />,
  );
}

describe('EquipmentHealthView：缺测显示 —，不补默认值', () => {
  it('未上报的指标必须显示 —，不得出现 2.5 / 45 / 380 / 75 这些默认值', async () => {
    const { container } = renderView();

    // 等到时序真的加载完（温度来自接口的 73.8）
    await waitFor(() => {
      expect(container.textContent).toContain('73.8');
    });

    // 有值的照常显示
    expect(container.textContent).toContain('73.8 °C');
    expect(container.textContent).toContain('3.4 mm/s');

    // 缺测的四项显示 —
    expect(container.textContent).toContain('— V');
    expect(container.textContent).toContain('— A');
    expect(container.textContent).toContain('— %');

    // 原代码的伪造默认值一个都不许出现
    expect(container.textContent).not.toContain('2.5 mm/s');
    expect(container.textContent).not.toContain('65 °C');
    expect(container.textContent).not.toContain('380 V');
    expect(container.textContent).not.toContain('45 A');
    expect(container.textContent).not.toContain('75 %');
  });
});
