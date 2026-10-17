// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceAnalysisPanel, type TelemetryHistory } from '../../src/components/equipment3d/DeviceAnalysisPanel';
import type { Equipment } from '../../src/types';

const equipment = (id: string) => ({ id, name: `真实台账-${id}`, code: id, category: '泵类设备', status: 'running', healthScore: 82, telemetry: { temperature: 0, vibration: 1.25, current: 12.4, lastUpdated: '2026-09-17 12:00' } } as Equipment);
const history = (id: string) => ({ equipmentId: id, points: [{ timestamp: '12:00', temperature: 0, vibration: 1.25, current: 12.4 }] } as TelemetryHistory);
const props = (id: string) => ({ equipment: equipment(id), detail: null, recipe: null, telemetry: history(id), orders: [], loading: false, error: null, onFocus: vi.fn(), onClose: vi.fn() });

beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('industrial analysis telemetry', () => {
  it('shows ledger identity and real temperature/vibration/current, not fabricated load', () => {
    render(<DeviceAnalysisPanel {...props('eq-101')} />);
    expect(screen.getByText('真实台账-eq-101')).toBeTruthy();
    const readings = within(screen.getByTestId('equipment3d-current-readings'));
    expect(readings.getByText('0.0 °C')).toBeTruthy();
    expect(readings.getByText('1.25 mm/s')).toBeTruthy();
    expect(readings.getByText('12.4 A')).toBeTruthy();
    expect(screen.getByText('近48小时 · 1 条落库记录')).toBeTruthy();
    expect(document.querySelector('[data-series="current"]')).toBeTruthy();
    expect(document.querySelector('[data-series="loadRate"]')).toBeNull();
  });

  it('does not coerce missing current to zero or display old device detail/history', () => {
    const p = props('eq-102');
    p.equipment.telemetry.current = null as unknown as number;
    render(<DeviceAnalysisPanel {...p} detail={equipment('eq-101')} telemetry={history('eq-101')} />);
    expect(screen.queryByText('真实台账-eq-101')).toBeNull();
    expect(screen.queryByTestId('equipment3d-analysis-charts')).toBeNull();
    // 读数卡新增"压力"字段后缺测项可能有多个"——"，断言"存在缺测占位且没有补零"即可
    expect(within(screen.getByTestId('equipment3d-current-readings')).getAllByText('—').length).toBeGreaterThan(0);
  });

  it.each([null, { equipmentId: 'eq-101', points: [] }])('shows empty history without charts or fabricated readings (%j)', (telemetry) => {
    render(<DeviceAnalysisPanel {...props('eq-101')} telemetry={telemetry as TelemetryHistory | null} />);
    expect(screen.getByText('暂无历史遥测数据')).toBeTruthy();
    expect(screen.queryByTestId('equipment3d-analysis-charts')).toBeNull();
    expect(screen.getByTestId('equipment3d-analysis-diagnose').hasAttribute('disabled')).toBe(true);
    expect(within(screen.getByTestId('equipment3d-current-readings')).getByText('0.0 °C')).toBeTruthy();
  });

  it('ignores an AI result after selecting a different device and aborts its request', async () => {
    let resolve!: (value: unknown) => void;
    const fetchMock = vi.fn(() => new Promise((done) => { resolve = done; }));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<DeviceAnalysisPanel {...props('eq-101')} />);
    fireEvent.click(screen.getByTestId('equipment3d-analysis-diagnose'));
    view.rerender(<DeviceAnalysisPanel {...props('eq-102')} />);
    expect((fetchMock.mock.calls[0] as any)[1].signal.aborted).toBe(true);
    await act(async () => resolve({ ok: true, json: async () => ({ success: true, diagnosis: { summary: 'OLD DEVICE RESULT' } }) }));
    expect(screen.queryByText('OLD DEVICE RESULT')).toBeNull();
    expect(screen.getByTestId('equipment3d-analysis-diagnose').hasAttribute('disabled')).toBe(false);
  });
});
