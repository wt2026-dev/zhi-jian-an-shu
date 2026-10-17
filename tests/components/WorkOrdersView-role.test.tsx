// @vitest-environment jsdom
/**
 * WorkOrdersView 按钮级角色权限接线测试 —— 补 tests/rbac-frontend.test.ts（纯逻辑）
 * 与 scratch/verify-role-perms.mjs（端到端）之间的中段：单元级断言按钮真的按角色
 * 渲染出来 / 隐藏。
 *
 * 焦点：仅验证"报修入口"按钮（`btn-create-work-order`）的按角色显隐。
 * 详情面板里的"接单 / 完工 / 审核"按钮需要先点开工单才能看到，jsdom 下完整模拟成本高，
 * 留给端到端探针（scratch/verify-role-perms.mjs 已经覆盖 manager/technician 落点）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { WorkOrdersView } from '../../src/components/WorkOrdersView';
import { ToastProvider } from '../../src/context/ToastContext';
import type { WorkOrder, Equipment, UserProfile } from '../../src/types';

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
  VirtualList: ({ items, renderItem }: any) => (
    <div data-testid="virtual-list">
      {items.map((item: any, i: number) => (
        <div key={item.id ?? i} data-testid="wo-item">{renderItem(item, i)}</div>
      ))}
    </div>
  ),
}));

const baseOrders: WorkOrder[] = [
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
    description: '输出轴振动剧烈',
  },
];

const baseEquipment: Equipment[] = [
  {
    id: 'eq-1', code: 'PUMP-001', name: '主驱动减速箱', category: '传动减速机',
    model: 'ZQ-500', workshop: '炼钢车间', location: '1号线', installDate: '2020-01-01',
    manufacturer: '沈阳鼓风机', status: 'running', healthScore: 85, criticality: '关键核心',
    telemetry: { temperature: 45, vibration: 2.1, voltage: 380, current: 50, loadRate: 75, lastUpdated: '' },
    specs: {}, maintenanceHistory: [], nextInspectionDate: '2026-10-01', qrCode: 'qr1',
  },
];

const mkUser = (role: UserProfile['role'], overrides: Partial<UserProfile> = {}): UserProfile => ({
  id: `u-${role}`,
  name: `${role}-测试`,
  role,
  roleTitle: { admin: '总工', manager: '主管', technician: '技师', inspector: '点检', operator: '操作工', archivist: '档案员', user: '操作岗' }[role],
  department: '测试',
  phone: '13800000000',
  ...overrides,
});

const baseProps = {
  workOrders: baseOrders,
  equipments: baseEquipment,
  allUsers: [] as UserProfile[],
  onCreateWorkOrder: vi.fn(),
  onUpdateWorkOrder: vi.fn(),
  onOpenAiDiagnose: vi.fn(),
};

describe('WorkOrdersView 报修入口按角色（btn-create-work-order）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** 该按钮用 id 而非 data-testid 暴露（CDP 探针也走 id），所以按 id 查。 */
  const findCreateBtn = (container: HTMLElement) =>
    container.querySelector('#btn-create-work-order');

  const renderAs = (role: UserProfile['role'], extra: Partial<typeof baseProps> = {}) =>
    render(
      <ToastProvider>
        <WorkOrdersView {...baseProps} {...extra} currentUser={mkUser(role)} />
      </ToastProvider>
    );

  it('operator 看到报修按钮', () => {
    const { container } = renderAs('operator');
    expect(findCreateBtn(container)).toBeTruthy();
  });

  it('technician 看不到报修按钮（只有 operator 能建单）', () => {
    const { container } = renderAs('technician');
    expect(findCreateBtn(container)).toBeNull();
  });

  it('manager 看不到报修按钮（只有 operator 能建单）', () => {
    const { container } = renderAs('manager');
    expect(findCreateBtn(container)).toBeNull();
  });

  it('inspector 看不到报修按钮（只有 operator 能建单）', () => {
    const { container } = renderAs('inspector');
    expect(findCreateBtn(container)).toBeNull();
  });

  it('archivist 看不到报修按钮（只有 operator 能建单）', () => {
    const { container } = renderAs('archivist');
    expect(findCreateBtn(container)).toBeNull();
  });

  it("'user'（吊装司机等普通操作岗）按 operator 处理，能看到报修按钮", () => {
    // utils/rbac.normalizeRole 把 'user' 归一为 operator，是这场改造的口径
    const { container } = renderAs('user' as UserProfile['role']);
    expect(findCreateBtn(container)).toBeTruthy();
  });

  it('admin 是超级用户，能看到报修按钮', () => {
    const { container } = renderAs('admin');
    expect(findCreateBtn(container)).toBeTruthy();
  });
});