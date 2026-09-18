// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ledger: [
    { id: 'eq-101', code: 'ORIGINAL-101', name: '原台账101', status: 'running', telemetry: { temperature: 31, vibration: 0, current: 12 } },
    { id: 'eq-102', code: 'ORIGINAL-102', name: '原台账102', status: 'warning', telemetry: { temperature: 42, vibration: 5, current: 18, loadRate: 60 } },
  ],
  getById: vi.fn(), getTelemetryHistory: vi.fn(), setDeviceTelemetry: vi.fn(), setIsolation: vi.fn(() => true),
}));
vi.mock('../../src/context/AppDataContext', () => ({ useAppData: () => ({ equipments: mocks.ledger }) }));
vi.mock('../../src/api', () => ({
  equipmentApi: { list: async () => mocks.ledger, getById: mocks.getById, getTelemetryHistory: mocks.getTelemetryHistory },
  workOrderApi: { list: async () => [] },
  safetyPermitApi: { list: async () => [], getLotoLocks: async () => [] },
  dispatchApi: { board: async () => ({}), listTechnicians: async () => ({ technicians: [] }) },
}));
vi.mock('../../src/components/equipment3d/scene', () => ({
  DEFAULT_PARAMS: { presetId: 'standard', seed: 1, quality: 'medium', deviceCount: 16, layout: 'grid', spacing: 1, highlight: true, showGrid: true, fluidFlow: true, shell: 'ghost', exposure: 1 },
  EquipmentScene: class {
    setDeviceTelemetry = mocks.setDeviceTelemetry;
    setIsolation = mocks.setIsolation;
    attachMinimap() {} start() {} dispose() {} quickApply() {} setSelected() {} resetFocus() {} focusDevice() {}
    clearStatusOverrides() {} clearFaultChain() {} buildFaultChain() {} buildWorkers() {} setWorkerVisible() {}
    buildSafetyBoundaries() {} setSafetyBoundaryVisible() {} setWorkOrderIndicators() {}
    liveStats() { return { devices: 2, triangles: 0, drawCalls: 0 }; }
    build() { return { ...this.liveStats(), faults: 0, legend: [], buildMs: 0 }; }
  },
}));
vi.mock('../../src/components/equipment3d/ExplodedView', () => ({ isExplodedViewSupported: () => false }));
vi.mock('../../src/components/equipment3d/DeviceAnalysisPanel', () => ({
  DeviceAnalysisPanel: (p: any) => <div data-testid="panel" data-loading={String(p.loading)}>{p.equipment?.id}|{p.detail?.name}|{p.telemetry?.equipmentId}</div>,
}));
import { Equipment3DView } from '../../src/components/equipment3d/EquipmentScene';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getById.mockImplementation((id: string) => Promise.resolve(mocks.ledger.find((e) => e.id === id)));
  mocks.getTelemetryHistory.mockImplementation((id: string) => Promise.resolve({ equipmentId: id, points: [] }));
});
afterEach(() => { cleanup(); });

it('forwards all real telemetry, explicitly clears absent load/rpm, and collapses controls', async () => {
  render(<Equipment3DView />);
  await waitFor(() => expect(mocks.setDeviceTelemetry).toHaveBeenCalledWith('eq-101', {
    status: 'running', temperature: 31, vibration: 0, current: 12, loadRate: undefined, rpm: undefined,
  }));
  fireEvent.click(screen.getByTestId('equipment3d-tab-params'));
  for (const label of ['设备密度', '布局模式', '光照', '随机种子']) {
    expect(screen.getByText(label).closest('details')?.open).toBe(false);
  }
  expect(screen.getAllByRole('option').map((option) => option.textContent).join(' ')).toContain('ORIGINAL-101');
});

it('rejects stale selections and late responses after Escape exits isolation', async () => {
  let resolveFirst!: (value: unknown) => void;
  let resolveLast!: (value: unknown) => void;
  mocks.getById.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
  render(<Equipment3DView />);
  await waitFor(() => expect(mocks.setDeviceTelemetry).toHaveBeenCalled());
  const select = screen.getByTestId('equipment3d-device-select');
  fireEvent.change(select, { target: { value: 'eq-101' } });
  fireEvent.change(select, { target: { value: 'eq-102' } });
  await waitFor(() => expect(screen.getByTestId('panel').textContent).toContain('原台账102'));
  await act(async () => resolveFirst({ ...mocks.ledger[0], name: 'STALE RESPONSE' }));
  expect(screen.getByTestId('panel').textContent).not.toContain('STALE RESPONSE');
  mocks.getById.mockImplementationOnce(() => new Promise((resolve) => { resolveLast = resolve; }));
  fireEvent.change(select, { target: { value: 'eq-101' } });
  expect(screen.getByTestId('panel').textContent).not.toContain('原台账102');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(mocks.setIsolation).toHaveBeenLastCalledWith(null);
  await act(async () => resolveLast(mocks.ledger[0]));
  expect(screen.getByTestId('panel').textContent).toBe('||');
  expect(screen.getByTestId('panel').getAttribute('data-loading')).toBe('false');
});
