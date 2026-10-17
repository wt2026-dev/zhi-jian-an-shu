// @vitest-environment jsdom
/**
 * 3D 车间「彩色可视化层」验收：图例 7 行齐全 / 每层独立开关 / 默认状态收敛。
 *
 * 为什么要有这一组：这些层全部画在同一块地面上，"关掉某一层后画面里还剩什么"
 * 靠肉眼看截图很难判定（软渲染下更是如此）。这里把"开关 → 场景调用"与
 * "图例行 → 实际在画状态"两条链路都钉成断言。
 */
import React from 'react';
import * as THREE from 'three';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FaultLocator } from '../../src/components/equipment3d/faultLocator';
import { SceneLegend } from '../../src/components/equipment3d/SceneLegend';

const mocks = vi.hoisted(() => ({
  ledger: [
    { id: 'eq-101', code: 'ORIGINAL-101', name: '原台账101', status: 'fault', telemetry: { temperature: 88, vibration: 0, current: 12 } },
  ],
  getById: vi.fn(), getTelemetryHistory: vi.fn(), setDeviceTelemetry: vi.fn(),
  setIsolation: vi.fn(() => true), setWorkerVisible: vi.fn(), setFaultLocatorVisible: vi.fn(),
  buildWorkers: vi.fn(), clearWorkers: vi.fn(),
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
    setWorkerVisible = mocks.setWorkerVisible;
    setFaultLocatorVisible = mocks.setFaultLocatorVisible;
    buildWorkers = mocks.buildWorkers;
    clearWorkers = mocks.clearWorkers;
    attachMinimap() {} start() {} dispose() {} quickApply() {} setSelected() {} resetFocus() {} focusDevice() {}
    clearStatusOverrides() {} clearFaultChain() {} buildFaultChain() {}
    buildSafetyBoundaries() {} setSafetyBoundaryVisible() {} setWorkOrderIndicators() {}
    liveStats() { return { devices: 1, triangles: 0, drawCalls: 0 }; }
    build() { return { ...this.liveStats(), faults: 1, legend: [], buildMs: 0 }; }
  },
}));
vi.mock('../../src/components/equipment3d/ExplodedView', () => ({ isExplodedViewSupported: () => false }));
vi.mock('../../src/components/equipment3d/DeviceAnalysisPanel', () => ({
  DeviceAnalysisPanel: () => <div data-testid="panel" />,
}));
import { Equipment3DView } from '../../src/components/equipment3d/EquipmentScene';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setIsolation.mockImplementation(() => true);
  mocks.getById.mockImplementation((id: string) => Promise.resolve(mocks.ledger.find((e) => e.id === id)));
  mocks.getTelemetryHistory.mockImplementation((id: string) => Promise.resolve({ equipmentId: id, points: [] }));
});
afterEach(() => cleanup());

/** 图例里 7 行的 key（顺序即渲染顺序） */
const LEGEND_KEYS = ['faultRing', 'recoveryRing', 'workerTrail', 'dispatchGuide', 'coolingWater', 'oilFlow', 'safetyBoundary'];

const legendRow = (key: string) =>
  screen.getByTestId('equipment3d-scene-legend').querySelector(`[data-legend-row="${key}"]`);

/**
 * 展开图例后再读行。
 * 第三轮减法把厂区层的图例改成默认折叠（一屏文字量的大头就是这 7 行），
 * 所以整屏渲染出来的图例一开始只剩标题行 —— 断言"某一行的开关状态"前必须先点开。
 */
const expandLegend = () => {
  const box = screen.getByTestId('equipment3d-scene-legend');
  if (box.getAttribute('data-collapsed') === 'true') {
    fireEvent.click(screen.getByTestId('equipment3d-scene-legend-toggle'));
  }
};

describe('SceneLegend 图例', () => {
  it('7 行说明齐全，且每行都写清颜色 / 线型与中文含义', () => {
    render(<SceneLegend />);
    const legend = screen.getByTestId('equipment3d-scene-legend');
    const rows = Array.from(legend.querySelectorAll('[data-legend-row]'));
    expect(rows.map((r) => r.getAttribute('data-legend-row'))).toEqual(LEGEND_KEYS);

    const text = legend.textContent ?? '';
    for (const phrase of [
      '红色脉冲环', '设备故障定位（轴承 / 振动异常）',
      '绿色环', '检修中 / 已恢复',
      '蓝色实线', '技师巡检轨迹',
      '蓝色虚线', '派工指引（技师 → 故障设备）',
      '青色粒子流', '冷却水流动',
      '琥珀粒子流', '油路循环',
      '黄色边界', '安全作业区',
    ]) {
      expect(text).toContain(phrase);
    }
  });

  it('默认展开，点击标题可收起 / 再展开', () => {
    render(<SceneLegend />);
    expect(screen.getByTestId('equipment3d-scene-legend').getAttribute('data-collapsed')).toBe('false');
    expect(screen.getByTestId('equipment3d-scene-legend-toggle').getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(screen.getByTestId('equipment3d-scene-legend-toggle'));
    expect(screen.getByTestId('equipment3d-scene-legend').getAttribute('data-collapsed')).toBe('true');
    expect(screen.queryByText(/安全作业区/)).toBeNull();

    fireEvent.click(screen.getByTestId('equipment3d-scene-legend-toggle'));
    expect(screen.getByTestId('equipment3d-scene-legend').getAttribute('data-collapsed')).toBe('false');
    expect(screen.getByText(/安全作业区/)).toBeTruthy();
  });

  it('关掉的层在图例里标注「已关」，不会出现"图例说有、画面上没有"', () => {
    render(<SceneLegend layers={{ workers: false, fluid: false, faultLocator: true, safety: true, guide: false }} />);
    expect(legendRow('workerTrail')?.getAttribute('data-layer-on')).toBe('false');
    expect(legendRow('coolingWater')?.getAttribute('data-layer-on')).toBe('false');
    expect(legendRow('oilFlow')?.getAttribute('data-layer-on')).toBe('false');
    expect(legendRow('faultRing')?.getAttribute('data-layer-on')).toBe('true');
    expect(legendRow('safetyBoundary')?.getAttribute('data-layer-on')).toBe('true');
    expect((legendRow('workerTrail')?.textContent ?? '')).toContain('已关');
    expect((legendRow('faultRing')?.textContent ?? '')).not.toContain('已关');
  });
});

describe('可视化图层开关', () => {
  it('默认状态收敛：只保留「故障定位环 + 安全边界」，技师轨迹与介质流动默认关', async () => {
    render(<Equipment3DView />);
    await waitFor(() => expect(mocks.setDeviceTelemetry).toHaveBeenCalled());

    const checked = (id: string) => screen.getByTestId(id).getAttribute('data-checked');
    expect(checked('equipment3d-layer-fault-toggle')).toBe('true');
    expect(checked('equipment3d-layer-safety-toggle')).toBe('true');
    expect(checked('equipment3d-layer-workers-toggle')).toBe('false');
    expect(checked('equipment3d-layer-fluid-toggle')).toBe('false');

    // 默认关掉的层不应被构建出来（省一次技师网格构建）
    expect(mocks.buildWorkers).not.toHaveBeenCalled();
    expect(mocks.clearWorkers).not.toHaveBeenCalled();

    // 图例同步反映"实际在画状态"（厂区层默认折叠，先展开再读行）
    expect(screen.getByTestId('equipment3d-scene-legend').getAttribute('data-collapsed')).toBe('true');
    expandLegend();
    expect(legendRow('workerTrail')?.getAttribute('data-layer-on')).toBe('false');
    expect(legendRow('coolingWater')?.getAttribute('data-layer-on')).toBe('false');
    expect(legendRow('faultRing')?.getAttribute('data-layer-on')).toBe('true');
    expect(legendRow('safetyBoundary')?.getAttribute('data-layer-on')).toBe('true');
  });

  it('四个开关各自独立：故障环 / 技师轨迹 / 介质流动分别打到对应场景方法', async () => {
    render(<Equipment3DView />);
    await waitFor(() => expect(mocks.setDeviceTelemetry).toHaveBeenCalled());
    // 故障环默认开：场景就绪后推一次 true
    await waitFor(() => expect(mocks.setFaultLocatorVisible).toHaveBeenLastCalledWith(true));
    expandLegend();

    // 开「技师轨迹与指引线」→ 构建人员动线层并置为可见
    fireEvent.click(screen.getByTestId('equipment3d-layer-workers-toggle'));
    await waitFor(() => expect(mocks.buildWorkers).toHaveBeenCalled());
    await waitFor(() => expect(mocks.setWorkerVisible).toHaveBeenLastCalledWith(true));
    expect(screen.getByTestId('equipment3d-layer-workers-toggle').getAttribute('data-checked')).toBe('true');
    await waitFor(() => expect(legendRow('workerTrail')?.getAttribute('data-layer-on')).toBe('true'));

    // 再关掉 → 蓝色线消失（整层隐藏，并把已建的人形/轨迹清掉）
    fireEvent.click(screen.getByTestId('equipment3d-layer-workers-toggle'));
    await waitFor(() => expect(mocks.setWorkerVisible).toHaveBeenLastCalledWith(false));
    expect(mocks.clearWorkers).toHaveBeenCalled();
    expect(legendRow('workerTrail')?.getAttribute('data-layer-on')).toBe('false');

    // 开「介质流动」→ 粒子层随渲染参数放行
    fireEvent.click(screen.getByTestId('equipment3d-layer-fluid-toggle'));
    await waitFor(() => expect(legendRow('coolingWater')?.getAttribute('data-layer-on')).toBe('true'));

    // 关「故障定位环」→ 红环整层隐藏
    fireEvent.click(screen.getByTestId('equipment3d-layer-fault-toggle'));
    await waitFor(() => expect(mocks.setFaultLocatorVisible).toHaveBeenLastCalledWith(false));
    await waitFor(() => expect(legendRow('faultRing')?.getAttribute('data-layer-on')).toBe('false'));
  });
});

describe('FaultLocator.setVisible', () => {
  const anchor = { deviceId: 'eq-101', partName: '主轴轴承', x: 1, y: 2, z: 3 };

  it('关掉后整层不渲染，重新打开时已登记的定位标原样回来', () => {
    const loc = new FaultLocator();
    loc.setFaults([anchor]);
    expect(loc.markerCount).toBe(1);

    loc.setVisible(false);
    expect(loc.isVisible).toBe(false);
    expect(loc.group.visible).toBe(false);
    // 关掉不应顺手清空登记（否则再打开时红环不会回来，用户会以为坏了）
    expect(loc.markerCount).toBe(1);

    loc.setVisible(true);
    expect(loc.group.visible).toBe(true);
    expect(loc.markerCount).toBe(1);
  });

  it('隐藏时不再逐帧更新材质（隐藏层不吃 CPU）', () => {
    const loc = new FaultLocator();
    loc.setFaults([anchor]);
    const ring = loc.group.children[0].userData.ring as THREE.Mesh;
    const mat = ring.material as THREE.MeshBasicMaterial;
    loc.update(0.016, 0);
    const frozen = mat.opacity;

    loc.setVisible(false);
    loc.update(0.016, 12.34); // 换一个相位：若仍在更新，opacity 必然不同
    expect(mat.opacity).toBe(frozen);
  });

  it('正常故障环不透明度收敛（峰值 ≤0.6），恢复环脉冲保持原样', () => {
    const loc = new FaultLocator();
    loc.setFaults([anchor]);
    const ring = loc.group.children[0].userData.ring as THREE.Mesh;
    const mat = ring.material as THREE.MeshBasicMaterial;

    let peak = 0;
    for (let i = 0; i < 400; i++) {
      loc.update(0.016, i * 0.03);
      peak = Math.max(peak, mat.opacity);
    }
    // 口径：0.35 + pulse*0.25 ⇒ 峰值 0.6（旧口径 0.5 + pulse*0.35 ⇒ 0.85）
    expect(peak).toBeLessThanOrEqual(0.6 + 1e-6);
    expect(peak).toBeGreaterThan(0.35);

    // 恢复动画（红→绿扫过）仍按原脉冲走，峰值可超过 0.6
    expect(loc.startRecovery('eq-101')).toBe(true);
    let recoveryPeak = 0;
    for (let i = 0; i < 20; i++) {
      loc.update(0.02, i * 0.05);
      recoveryPeak = Math.max(recoveryPeak, mat.opacity);
    }
    expect(recoveryPeak).toBeGreaterThan(0.6);
  });
});
