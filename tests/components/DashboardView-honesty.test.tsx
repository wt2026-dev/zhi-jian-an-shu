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
import { complianceApi, knowledgeApi, procedureApi } from '../../src/api';

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

/* ---------------------------------------------------------------------------
 * 第二批（同日复核）：同一条命门在别的卡片上还有 5 处。
 *   · 合规三指标：`avgScore ?? 100` / `mistakeRate ?? 0` / `totalAuditedOrders ?? 0`
 *     → 接口挂了显示「0 单审计 · 100 分（绿色） · 0% 违章」，凭空一份满分安全记录。
 *   · 知识中枢：`knowledgeStats.total || 8` + 写死「标准化作业规程 4 篇 / 典型故障分析 3 篇 /
 *     设备机械结构手册 2 篇」→ 三个分类名在 knowledge_articles 里一个都不存在，且 4+3+2=9
 *     与上方的 8 自相矛盾。
 *   · 图谱卡：`graphEntityCount || 18`、写死「26 条关联关系」、写死「100% 核心动力设备」。
 *   · 推荐规程：列表为空时直接渲染一条**库里不存在**的规程名，长得跟真实记录一样。
 * 这些卡片只有 admin / archivist 角色才渲染，所以单独用 admin 跑一遍。
 * ------------------------------------------------------------------------- */

const adminUser: UserProfile = {
  id: 'u-admin',
  name: '测试管理员',
  role: 'admin',
  roleTitle: '系统管理员',
  department: '信息中心',
  phone: '13800000001',
} as UserProfile;

/** 知识中枢/图谱卡是 archivist 专属；推荐规程卡是 technician 专属 —— 必须按角色渲染才看得到 */
const archivistUser: UserProfile = {
  ...adminUser,
  id: 'u-arch',
  name: '测试档案员',
  role: 'archivist',
  roleTitle: '档案管理员',
} as UserProfile;

function renderAs(user: UserProfile) {
  return render(
    <DashboardView
      currentUser={user}
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

describe('DashboardView：合规/知识/图谱卡片的失败与空态不得编造数字', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(complianceApi.getStats).mockRejectedValue(new Error('compliance down'));
    vi.mocked(knowledgeApi.reviewList).mockResolvedValue([] as any);
    vi.mocked(knowledgeApi.list).mockRejectedValue(new Error('knowledge down'));
    vi.mocked(knowledgeApi.graph).mockRejectedValue(new Error('graph down'));
    vi.mocked(procedureApi.list).mockResolvedValue([] as any);
  });

  it('合规统计失败 → 三项指标显示 —，不得显示「100 分」满分', async () => {
    const { container } = renderAs(adminUser);
    await waitFor(() => {
      expect(container.textContent).toMatch(/平均合规得分/);
    });
    expect(container.textContent).not.toMatch(/100\s*分/);
    // 累计审计工单 / 平均合规得分 / 失误违章率 三项都应是 —
    const dashes = (container.textContent?.match(/—/g) || []).length;
    expect(dashes).toBeGreaterThanOrEqual(3);
  });

  it('知识库统计失败 → 「已入库 —」，不得写死 8 篇，也不得出现虚构分类名', async () => {
    const { container } = renderAs(archivistUser);
    await waitFor(() => {
      expect(screen.getByText(/知识库统计加载失败/)).toBeTruthy();
    });
    const text = container.textContent || '';
    expect(text).not.toMatch(/已入库\s*8\+?\s*篇/);
    // 这三行是原硬编码分类，库里并不存在同名 category
    expect(text).not.toMatch(/标准化作业规程/);
    expect(text).not.toMatch(/典型故障分析与案例/);
    expect(text).not.toMatch(/设备机械结构与参数手册/);
  });

  it('图谱接口失败 → 节点/关系统计显示 —，不得写死 18 / 26 / 100%', async () => {
    const { container } = renderAs(archivistUser);
    await waitFor(() => {
      expect(container.textContent).toMatch(/实体节点/);
    });
    const text = container.textContent || '';
    expect(text).not.toMatch(/18\s*实体节点/);
    expect(text).not.toMatch(/26\s*条关联关系/);
    expect(text).not.toMatch(/100%\s*核心动力设备/);
  });

  it('推荐规程为空 → 说"暂无推荐规程"，不得渲染库里不存在的规程名', async () => {
    const { container } = renderAs(currentUser);
    await waitFor(() => {
      expect(container.textContent).toMatch(/暂无推荐规程/);
    });
    expect(container.textContent).not.toMatch(/硬齿面减速机高速轴轴承更换SOP规程/);
  });
});
