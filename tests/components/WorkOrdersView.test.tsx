// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { WorkOrdersView } from '../../src/components/WorkOrdersView';
import { ToastProvider } from '../../src/context/ToastContext';
import type { WorkOrder, Equipment, UserProfile } from '../../src/types';

// --- Mocks ---
vi.mock('../../src/api', () => ({
  workOrderApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), status: vi.fn(), complete: vi.fn(), delete: vi.fn() },
  sparePartsApi: { list: vi.fn().mockResolvedValue([]) },
  hazardsApi: { create: vi.fn() },
  aiApi: { rootCauseAnalysis: vi.fn(), maintenancePlan: vi.fn(), recommendAssignee: vi.fn() },
  complianceApi: { getByWorkOrderId: vi.fn() },
  request: vi.fn().mockResolvedValue([]),
  ApiError: class extends Error {},
  AiResultModal: ({ open }: any) => (open ? <div data-testid="ai-result-modal">AI Result</div> : null),
  VideoAnalysisModal: () => null,
}));

vi.mock('../../src/components/VirtualList', () => ({
  VirtualList: ({ items, renderItem, emptyText }: any) => (
    <div data-testid="virtual-list">
      {items.length === 0
        ? <div data-testid="virtual-empty">{emptyText}</div>
        : items.map((item: any, i: number) => <div key={item.id ?? i} data-testid="wo-item">{renderItem(item, i)}</div>)}
    </div>
  ),
}));

// --- Fixtures ---
const mockCurrentUser: UserProfile = {
  id: 'u1',
  name: '测试技师',
  role: 'technician',
  roleTitle: '检修技师',
  department: '检修车间',
  phone: '13800000000',
};

const mockWorkOrders: WorkOrder[] = [
  {
    id: 'wo-1',
    orderNo: 'WO-2026-001',
    title: '1#主驱减速箱异响',
    equipmentId: 'eq-1',
    equipmentName: '主驱动减速箱',
    equipmentCode: 'PUMP-001',
    workshop: '炼钢车间',
    faultType: '机械振动',
    priority: 'urgent',
    status: 'created',
    creator: '陈建平',
    createdAt: '2026-09-10 08:00',
    description: '输出轴振动剧烈，疑似齿轮磨损',
  },
  {
    id: 'wo-2',
    orderNo: 'WO-2026-002',
    title: '循环水泵密封泄漏',
    equipmentId: 'eq-2',
    equipmentName: '循环水泵A',
    equipmentCode: 'PUMP-002',
    workshop: '轧钢车间',
    faultType: '密封泄漏',
    priority: 'high',
    status: 'in_progress',
    creator: '赵安全',
    assignee: '赵技师',
    assigneeId: 'u1',
    createdAt: '2026-09-09 14:30',
    description: '机械密封端面渗水严重',
  },
  {
    id: 'wo-3',
    orderNo: 'WO-2026-003',
    title: '空压机定期保养',
    equipmentId: 'eq-3',
    equipmentName: '螺杆空压机',
    equipmentCode: 'COMP-001',
    workshop: '动力车间',
    faultType: '定期润滑维保',
    priority: 'low',
    status: 'completed',
    creator: '吴晓芳',
    createdAt: '2026-09-05 10:00',
    description: '按计划执行2000h保养',
  },
];

const mockEquipments: Equipment[] = [
  {
    id: 'eq-1', code: 'PUMP-001', name: '主驱动减速箱', category: '传动减速机',
    model: 'ZQ-500', workshop: '炼钢车间', location: '1号线', installDate: '2020-01-01',
    manufacturer: '沈阳鼓风机', status: 'running', healthScore: 85, criticality: '关键核心',
    telemetry: { temperature: 45, vibration: 2.1, voltage: 380, current: 50, loadRate: 75, lastUpdated: '' },
    specs: {}, maintenanceHistory: [], nextInspectionDate: '2026-10-01', qrCode: 'qr1',
  },
];

const defaultProps = {
  currentUser: mockCurrentUser,
  workOrders: mockWorkOrders,
  equipments: mockEquipments,
  allUsers: [mockCurrentUser],
  onCreateWorkOrder: vi.fn(),
  onUpdateWorkOrder: vi.fn(),
  onOpenAiDiagnose: vi.fn(),
};

describe('WorkOrdersView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderWithToast = (props: any) =>
    render(<ToastProvider><WorkOrdersView {...props} /></ToastProvider>);

  it('renders work order list from props', () => {
    renderWithToast(defaultProps);
    expect(screen.getByTestId('virtual-list')).toBeTruthy();
    const items = screen.getAllByTestId('wo-item');
    expect(items).toHaveLength(3);
  });

  it('shows empty state when no work orders', () => {
    renderWithToast({ ...defaultProps, workOrders: [] });
    expect(screen.getByTestId('virtual-list')).toBeTruthy();
    expect(screen.getByTestId('virtual-empty')).toBeTruthy();
  });

  it('shows status tab counts', () => {
    renderWithToast(defaultProps);
    expect(screen.getAllByText(/全部工单/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/待派单/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/检修中/).length).toBeGreaterThan(0);
  });

  it('renders search input', () => {
    renderWithToast(defaultProps);
    expect(screen.getByPlaceholderText(/搜索工单号/)).toBeTruthy();
  });

  it('renders 3D 查看 button and triggers onNavigateTo3D', async () => {
    const onNavigateTo3D = vi.fn();
    renderWithToast({ ...defaultProps, onNavigateTo3D });
    const buttons = screen.getAllByText('3D 查看');
    expect(buttons.length).toBe(3);
    await userEvent.click(buttons[0]);
    expect(onNavigateTo3D).toHaveBeenCalledWith('wo-1');
  });
});
