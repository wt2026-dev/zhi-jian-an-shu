// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import type { Equipment } from '../../src/types';
import { EquipmentHealthView } from '../../src/components/EquipmentHealthView';

vi.mock('recharts', () => {
  const Box = ({ children }: any) => <div data-testid="recharts-box">{children}</div>;
  const SvgBox = ({ children }: any) => <svg>{children}</svg>;
  return {
    ResponsiveContainer: Box,
    AreaChart: SvgBox,
    Area: () => null,
    LineChart: SvgBox,
    Line: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    CartesianGrid: () => null,
    Legend: () => null,
  };
});

vi.mock('../../src/components/ai/AiResultModal', () => ({
  AiResultModal: ({ open, title, onClose }: any) =>
    open ? (
      <div data-testid="ai-result-modal">
        <div>{title}</div>
        <button onClick={onClose}>关闭</button>
      </div>
    ) : null,
}));

vi.mock('../../src/components/ai/AiWorkOrderDraftModal', () => ({
  AiWorkOrderDraftModal: ({ open, title, onClose }: any) =>
    open ? (
      <div data-testid="ai-draft-modal">
        <div>{title}</div>
        <button onClick={onClose}>关闭</button>
      </div>
    ) : null,
}));

vi.mock('../../src/utils/demoMode', () => ({
  isDemoMode: () => true,
}));

const mockGetTelemetryHistory = vi.fn().mockResolvedValue({
  equipmentId: 'eq-101',
  points: [
    { timestamp: '10:00', temperature: 68.5, vibration: 2.1, current: 42.0, voltage: 380.0, loadRate: 65.0 },
    { timestamp: '11:00', temperature: 71.0, vibration: 2.5, current: 44.0, voltage: 381.0, loadRate: 68.0 },
  ],
});

vi.mock('../../src/api', () => ({
  equipmentApi: {
    getTelemetryHistory: (...args: any[]) => mockGetTelemetryHistory(...args),
  },
  aiApi: {
    equipmentSummary: vi.fn().mockResolvedValue({ success: true, summary: { summaryText: '机组运行平稳' } }),
    alarmCorrelation: vi.fn().mockResolvedValue({ success: true, analysis: { summary: '未发现强关联' } }),
    healthForecast: vi.fn().mockResolvedValue({ success: true, forecast: { trend: 'stable' } }),
    generateWorkOrder: vi.fn().mockResolvedValue({ success: true, draft: { title: '轴承检修' } }),
  },
  safeStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
}));

const mockEquipments: Equipment[] = [
  {
    id: 'eq-101',
    code: 'EQ-101',
    name: '1#高压离心泵',
    category: '泵类',
    status: 'warning',
    healthScore: 78,
    workshop: '主车间',
    location: 'A-01',
    model: 'HP-90',
    manufacturer: '上海重工',
    installDate: '2023-01-01',
    lastMaintenanceDate: '2026-08-01',
    nextMaintenanceDate: '2026-11-01',
    criticality: 'A',
    telemetry: {
      temperature: 71.0,
      vibration: 2.5,
      voltage: 381,
      current: 44,
      loadRate: 68,
      lastUpdated: '2026-10-18T10:00:00Z',
    },
  } as unknown as Equipment,
  {
    id: 'eq-102',
    code: 'EQ-102',
    name: '2#空压机机组',
    category: '压缩机',
    status: 'fault',
    healthScore: 45,
    workshop: '动力车间',
    location: 'B-02',
    model: 'AC-300',
    manufacturer: '沈阳鼓风',
    installDate: '2022-05-01',
    lastMaintenanceDate: '2026-07-01',
    nextMaintenanceDate: '2026-10-01',
    criticality: 'A',
    telemetry: {
      temperature: 88.0,
      vibration: 5.6,
      voltage: 379,
      current: 58,
      loadRate: 92,
      lastUpdated: '2026-10-18T10:00:00Z',
    },
  } as unknown as Equipment,
];

describe('EquipmentHealthView 模块化组件与交互测试', () => {
  const onOpenWorkOrder = vi.fn();
  const onOpenAiDiagnose = vi.fn();
  const onCreateWorkOrder = vi.fn();
  const onNavigateTo3D = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderComponent(selectedEquipmentId = 'eq-101') {
    return render(
      <EquipmentHealthView
        equipments={mockEquipments}
        selectedEquipmentId={selectedEquipmentId}
        onOpenWorkOrder={onOpenWorkOrder}
        onOpenAiDiagnose={onOpenAiDiagnose}
        onCreateWorkOrder={onCreateWorkOrder}
        onNavigateTo3D={onNavigateTo3D}
        currentUser={{ id: 'u1', name: '张工', role: 'engineer', roleTitle: '首席检修工程师' } as any}
      />
    );
  }

  it('正确渲染标题、设备芯片导航、实时仪表和时序图表区域', async () => {
    const { container } = renderComponent();

    expect(screen.getByText('工业级精密机组健康画像与多维遥测监视')).toBeDefined();
    expect(screen.getByText('1#高压离心泵')).toBeDefined();
    expect(screen.getByText('2#空压机机组')).toBeDefined();
    expect(screen.getByText('实时健康综合评分')).toBeDefined();
    expect(screen.getByText('实时仪表传感器读数')).toBeDefined();

    await waitFor(() => {
      expect(container.textContent).toContain('71 °C');
      expect(container.textContent).toContain('2.5 mm/s');
    });
  });

  it('切换设备芯片时更新选中的设备并在仪表中呈现新数据', async () => {
    renderComponent('eq-101');

    const secondEqChip = screen.getByText('2#空压机机组');
    fireEvent.click(secondEqChip);

    await waitFor(() => {
      expect(mockGetTelemetryHistory).toHaveBeenCalledWith('eq-102');
    });
  });

  it('点击 3D 孪生定位按钮触发 onNavigateTo3D 回调', async () => {
    renderComponent();

    await waitFor(() => {
      expect(mockGetTelemetryHistory).toHaveBeenCalled();
    });

    const btn3D = screen.getByTestId('health-navigate-to-3d');
    fireEvent.click(btn3D);

    expect(onNavigateTo3D).toHaveBeenCalledWith('eq-101');
  });

  it('点击一键发起检修单按钮触发 onOpenWorkOrder 回调', async () => {
    renderComponent();

    await waitFor(() => {
      expect(mockGetTelemetryHistory).toHaveBeenCalled();
    });

    const btnWorkOrder = screen.getByText('一键发起检修单');
    fireEvent.click(btnWorkOrder);

    expect(onOpenWorkOrder).toHaveBeenCalledWith(mockEquipments[0]);
  });

  it('多设备预警/故障时展示 AI 报警关联分析按钮并可打开弹窗', async () => {
    renderComponent();

    await waitFor(() => {
      expect(mockGetTelemetryHistory).toHaveBeenCalled();
    });

    const corrBtn = screen.getByText(/AI 报警关联分析/);
    expect(corrBtn).toBeDefined();

    fireEvent.click(corrBtn);

    await waitFor(() => {
      expect(screen.getByTestId('ai-result-modal')).toBeDefined();
      expect(screen.getByText('AI 报警关联分析 (根因识别 / 因果图谱 / 处置建议)')).toBeDefined();
    });
  });

  it('触发 AI 劣化趋势预警与工单草稿模态', async () => {
    renderComponent();

    await waitFor(() => {
      expect(mockGetTelemetryHistory).toHaveBeenCalled();
    });

    const forecastBtn = screen.getByText('AI 劣化趋势预警');
    fireEvent.click(forecastBtn);

    await waitFor(() => {
      expect(screen.getByText('AI 设备劣化趋势预警')).toBeDefined();
    });

    const draftBtn = screen.getByText('AI 生成检修工单');
    fireEvent.click(draftBtn);

    await waitFor(() => {
      expect(screen.getByText('AI 智能生成检修工单草稿')).toBeDefined();
    });
  });
});
