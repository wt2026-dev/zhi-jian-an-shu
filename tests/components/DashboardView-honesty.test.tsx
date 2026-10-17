// @vitest-environment jsdom
/**
 * 首页两张安全语义卡片的「失败 ≠ 正常」守卫。
 *
 * 背景（2026-10-17 实测）：`DashboardView` 的隐患列表与低库存备件原本都是
 * `.catch(() => {})` 静默吞掉，状态留在初始空数组，于是 UI 渲染出：
 *   · 隐患接口挂了 → 「厂区无未消缺隐患，处于安全平稳期」
 *   · 备件接口挂了 → 「全厂 22+ 项备件在库充盈，满足维保周转」+ 绿色「充足」徽章
 * 也就是说**接口失败被渲染成了一个安全结论**。对一套安全管理平台，这比编造故障更隐蔽 ——
 * 它看起来是好消息。而「22+」还是写死在文案里的数字，与库里实际备件数无关。
 *
 * 这里把两件事钉住：
 *   1. 接口失败时必须显示"加载失败/无法判断"，不得显示"无隐患 / 充足"；
 *   2. 文案里不得出现写死的备件数量。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import type { UserProfile } from '../../src/types';

// recharts / echarts 在 jsdom 里没有尺寸与 canvas，替换成空实现即可（本用例只验文案）
vi.mock('echarts', () => ({
  init: vi.fn(() => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() })),
  graphic: { LinearGradient: class { constructor() {} } },
}));
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
  };
});
vi.mock('../../src/components/ai/AiResultModal', () => ({ AiResultModal: () => null }));

// 关键：隐患与低库存两个接口 reject，其余正常
vi.mock('../../src/api', () => ({
  complianceApi: { getStats: vi.fn().mockResolvedValue(null) },
  sparePartsApi: { getLowStock: vi.fn().mockRejectedValue(new Error('spare parts down')) },
  hazardsApi: { list: vi.fn().mockRejectedValue(new Error('hazards down')) },
  auditLogApi: { list: vi.fn().mockResolvedValue([]) },
  knowledgeApi: {
    reviewList: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue([]),
    graph: vi.fn().mockResolvedValue({ nodes: [] }),
  },
  procedureApi: { list: vi.fn().mockResolvedValue([]) },
  aiApi: { rootCauseAnalysis: vi.fn(), maintenancePlan: vi.fn() },
}));

import { DashboardView } from '../../src/components/DashboardView';

const currentUser: UserProfile = {
  id: 'u-tech',
  name: '测试技师',
  role: 'technician',
  roleTitle: '检修技师',
  department: '检修车间',
  phone: '13800000000',
} as UserProfile;

const noop = () => {};

function renderDashboard() {
  return render(
    <DashboardView
      currentUser={currentUser}
      equipments={[]}
      workOrders={[]}
      inspections={[]}
      safetyPermits={[]}
      lotoLocks={[]}
      onNavigate={noop}
      onSelectEquipment={noop}
      onSelectWorkOrder={noop}
      onOpenCreateWorkOrder={noop}
      onOpenCreateSafetyPermit={noop}
    />,
  );
}

describe('DashboardView：接口失败不得渲染成"一切正常"', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('隐患接口失败 → 显示加载失败，而不是"无隐患/安全平稳"', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/隐患数据加载失败/)).toBeTruthy();
    });

    // 这三句是"编造安全结论"的原文，一条都不许再出现
    expect(screen.queryByText(/厂区无未消缺隐患/)).toBeNull();
    expect(screen.queryByText(/处于安全平稳期/)).toBeNull();
    expect(screen.queryByText(/当前全厂无未闭环隐患/)).toBeNull();
  });

  it('备件接口失败 → 显示加载失败 + "未知"徽章，而不是"充足"', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/备件数据加载失败/)).toBeTruthy();
    });

    expect(screen.getByText('未知')).toBeTruthy();
    expect(screen.queryByText('充足')).toBeNull();
  });

  it('文案里不得写死备件数量（曾经的「全厂 22+ 项备件」）', async () => {
    const { container } = renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/备件数据加载失败/)).toBeTruthy();
    });
    expect(container.textContent).not.toMatch(/22\+\s*项/);
    expect(container.textContent).not.toMatch(/全厂\s*\d+\+?\s*项备件/);
  });
});
