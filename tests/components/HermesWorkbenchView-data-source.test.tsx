// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HermesWorkbenchView } from '../../src/components/hermes/HermesWorkbenchView';
import { businessLoopApi } from '../../src/api/businessLoopApi';
import { ToastProvider } from '../../src/context/ToastContext';
import type {
  ArtifactItem,
  BusinessClosedLoopData,
  ButlerSuggestion,
  HistoryLoopItem,
  LoopHeaderStats,
  StageStepMeta,
} from '../../src/components/hermes/types';

/**
 * 数据源纪律用例（与 HermesWorkbenchView.test.tsx 互补，只验「接口 → 界面」映射）：
 * - 页面唯一的闭环数据来自 /api/v1/business-loops，任何字段都不允许由前端自造；
 * - 后端不可达时必须落到「无法连接后端服务」态，且不回落任何演示数据。
 * 设备/人员均取自 seed 台账口径（eq-102 2# 无油螺杆空压机主机、陈主管）。
 */

const stage = (
  over: Partial<StageStepMeta> & Pick<StageStepMeta, 'id' | 'order' | 'title' | 'status'>
): StageStepMeta => ({
  aiBadge: '待预填',
  outputSummary: '服务端尚未回写',
  targetPage: '检修工单',
  targetTabKey: 'workorders',
  duration: '—',
  ...over,
});

const loop: BusinessClosedLoopData = {
  id: 'bl-1',
  loopCode: 'PL-20261018-001',
  status: 'running',
  businessGoal: '2#无油螺杆空压机主机振动偏高，走检修流程',
  equipment: {
    id: 'eq-102',
    code: 'EQ-2024-COMP-02',
    name: '2# 无油螺杆空压机主机',
    model: 'ZLS-160Si-8',
    workshop: '动力车间 A区',
    status: 'warning',
    temperature: 92.3,
    temperatureThreshold: 105,
    vibration: 14.6,
    loadRate: 0.88,
    healthScore: 72,
  },
  initiator: { name: '陈主管', role: '生产调度主管', time: '2026-10-18 09:40' },
  progress: { currentStageOrder: 3, totalStages: 6, percent: 33, estimatedTotalHours: 12, elapsedHours: 2.5 },
  stages: [
    stage({
      id: 'stage_report',
      order: 1,
      title: '现场报修',
      status: 'completed',
      aiBadge: 'generate-work-order',
      outputSummary: '工单草稿已人工核对',
      completedTime: '10:05',
      aiPrefill: {
        engine: 'generate-work-order',
        status: 'ok',
        generatedAt: '2026-10-18 09:50',
        content: '建议开「主机振动偏高」检修工单',
        raw: { workOrderDraft: { title: '2# 无油螺杆空压机主机振动偏高检修', priority: 'high', estimatedHours: 6 } },
      },
    }),
    stage({
      id: 'stage_permit',
      order: 2,
      title: '高危作业票',
      status: 'completed',
      aiBadge: 'safety-risk-assessment（AI 降级）',
      outputSummary: 'JSA 措施已核对',
      targetPage: '安全管理',
      targetTabKey: 'safety',
      aiPrefill: {
        engine: 'safety-risk-assessment',
        status: 'degraded',
        generatedAt: '2026-10-18 09:52',
        content: '无 Key 降级：按规则库给出高危判定',
        raw: {
          assessment: {
            riskLevel: 'high',
            jsaMeasures: [{ hazard: '残余气压', control: '泄压并挂锁' }],
            hazardIdentifications: [{ category: '能量', hazard: '压缩空气蓄能', level: '高' }],
          },
          degraded: true,
        },
      },
    }),
    stage({
      id: 'stage_loto',
      order: 3,
      title: 'LOTO能量隔离',
      status: 'in_progress',
      aiBadge: 'safety-interlock',
      outputSummary: '隔离点待逐项确认',
      targetPage: '安全管理',
      targetTabKey: 'safety',
      aiPrefill: {
        engine: 'safety-interlock',
        status: 'ok',
        generatedAt: '2026-10-18 09:55',
        content: '建议执行 3 处隔离点',
        raw: { isolationPoints: ['QF-02 主电源进线断路器'], lockRequired: true, lockCount: 3, standards: ['GB/T 33579-2017'] },
      },
    }),
    stage({ id: 'stage_execution', order: 4, title: '检修执行', status: 'pending', targetPage: '检修执行', targetTabKey: 'maintenance' }),
    stage({ id: 'stage_completion', order: 5, title: '完工', status: 'pending', targetPage: '现场验收', targetTabKey: 'acceptance' }),
    stage({ id: 'stage_archive', order: 6, title: '质检归档', status: 'pending', targetPage: '知识库', targetTabKey: 'knowledge' }),
  ],
  lotoItems: [
    { id: 'loto-1', type: '电气隔离', point: 'QF-02 主电源进线断路器', requirement: '分闸断电并挂锁', lockNumber: 'LK-EL-408', confirmed: true, operator: '李工', confirmTime: '10:02' },
    { id: 'loto-2', type: '气源隔离', point: 'V-201 排气总管入口截止阀', requirement: '手轮关闭至限位', lockNumber: 'LK-PN-112', confirmed: true, operator: '王工', confirmTime: '10:04' },
    { id: 'loto-3', type: '残余能量', point: '压缩空气蓄能管路及冷却器腔体', requirement: '双金属压力表指示归零', lockNumber: '', confirmed: false, operator: '' },
  ],
  artifacts: [
    { id: 'art-1', code: 'PL-20261018-001-WO', name: '检修工单', stageId: 'stage_report', status: 'ready', category: '检修工单', previewContent: '【工单号】WO-20261018-001' },
    { id: 'art-2', code: 'PL-20261018-001-QC', name: '质检报告', stageId: 'stage_archive', status: 'pending', category: '质量评估', previewContent: '' },
  ] as ArtifactItem[],
  suggestions: [
    { id: 'sug-1', type: 'todo', title: '待办提醒：LOTO 请完成 2/3 项确认', content: '未确认项：压缩空气蓄能管路及冷却器腔体', tag: '安全闸门', actionText: '去逐项确认' },
  ] as ButlerSuggestion[],
};

/** 现场逐项勾完后的详情：仅 lotoItems 全 confirmed，其余字段与 loop 一致 */
const allConfirmedLoop: BusinessClosedLoopData = {
  ...loop,
  lotoItems: loop.lotoItems.map((i) => ({ ...i, confirmed: true, operator: i.operator || '李工', confirmTime: '10:09' })),
};

/** 停在环节 1 的闭环：用于验证「确认前可改写 AI 预填要素」（人工闸门不是只能点确认） */
const loopAtStage1: BusinessClosedLoopData = {
  ...loop,
  progress: { ...loop.progress, currentStageOrder: 1, percent: 0 },
  stages: loop.stages.map((s) => ({
    ...s,
    status: s.order === 1 ? 'in_progress' : 'pending',
    completedTime: undefined,
  })),
  lotoItems: [],
  artifacts: [],
};

/** 停在环节 6（质检归档）的闭环：归档核对卡必须有实际内容，不能只剩一个空壳 */
const loopAtStage6: BusinessClosedLoopData = {
  ...loop,
  progress: { ...loop.progress, currentStageOrder: 6, percent: 83 },
  stages: loop.stages
    .map((s) =>
      s.order < 6
        ? { ...s, status: 'completed' as const, completedTime: s.completedTime || `10:0${s.order}` }
        : {
            ...s,
            status: 'in_progress' as const,
            aiPrefill: {
              engine: 'suggest-contribution',
              status: 'ok' as const,
              generatedAt: '2026-10-18 11:20',
              content: '已达沉淀标准，建议入库',
              raw: { contribution: { worthContributing: true, title: '2# 空压机主机振动：以人工复测替代 AI 初判' } },
            },
          }
    )
    .map((s) =>
      s.order === 1
        ? { ...s, aiPrefill: { ...s.aiPrefill, revised: { by: '陈主管', at: '2026-10-18 10:05', fields: ['工单标题', '优先级', '预计工时'] } } }
        : s
    ),
  lotoItems: loop.lotoItems.map((i) => ({
    ...i,
    confirmed: true,
    confirmedBy: '陈主管',
    operator: i.operator || '李工',
    editedBy: i.id === 'loto-3' ? '陈主管' : null,
    editedAt: i.id === 'loto-3' ? '10:08' : null,
  })),
  artifacts: loop.artifacts.map((a) => (a.category === '质量评估' ? { ...a, status: 'ready' as const, previewContent: '【结论】修复后振动 1.6 mm/s，达标' } : a)),
};

const historyItem: HistoryLoopItem = {
  id: 'hl-1',
  loopCode: 'PL-20261010-002',
  targetGoal: '3# 轧机主传动行星减速箱异响排查',
  equipmentName: '3# 轧机主传动行星减速箱',
  status: 'archived',
  duration: '7.4h',
  artifactCount: 8,
  knowledgeCount: 1,
  closedDate: '2026-10-10 16:40',
  leadUser: '陈主管',
};

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { id: 'u-101', name: '陈主管', role: 'manager' } }),
  useOptionalAuth: () => ({ currentUser: { id: 'u-101', name: '陈主管', role: 'manager' } }),
}));

vi.mock('../../src/api/businessLoopApi', () => ({
  ApiError: class ApiError extends Error {},
  businessLoopApi: {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    confirmStage: vi.fn(),
    toggleLotoItem: vi.fn(),
    addLotoItem: vi.fn(),
    complete: vi.fn(),
    history: vi.fn(),
  },
}));

describe('HermesWorkbenchView 数据源纪律', () => {
  const api = vi.mocked(businessLoopApi);

  const renderView = () =>
    render(
      <ToastProvider>
        <HermesWorkbenchView />
      </ToastProvider>
    );

  beforeEach(() => {
    api.list.mockResolvedValue([
      {
        id: 'bl-1',
        loopNo: 'PL-20261018-001',
        goal: loop.businessGoal,
        equipmentId: 'eq-102',
        equipmentName: loop.equipment.name,
        status: 'running',
        currentStage: 3,
        startedAt: '2026-10-18T09:40:00+08:00',
        expectedMinutes: 720,
        completedAt: null,
        initiatorName: '陈主管',
      },
    ]);
    api.getById.mockResolvedValue(loop);
    api.history.mockResolvedValue([historyItem]);
    api.create.mockResolvedValue(loop);
    api.confirmStage.mockResolvedValue(loop);
    api.toggleLotoItem.mockResolvedValue(loop);
    api.addLotoItem.mockResolvedValue(loop);
    api.complete.mockResolvedValue({ ...loop, status: 'archived' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('首屏只走 GET 列表 + GET 详情 + GET history', async () => {
    renderView();
    expect(await screen.findByText(/2#无油螺杆空压机主机振动偏高/)).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledWith({ status: 'running', limit: 20 });
    expect(api.getById).toHaveBeenCalledWith('bl-1');
    expect(api.history).toHaveBeenCalled();
  });

  it('降级环节必须显式标出（AI 降级），不把规则兜底伪装成正常 AI 结果', async () => {
    renderView();
    expect((await screen.findAllByText(/（AI 降级）/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText('safety-interlock').length).toBeGreaterThan(0);
  });
  it('LOTO 已确认项数按接口 lotoItems 统计（2/3，不是写死的 3/3）', async () => {
    renderView();
    expect(await screen.findByText(/当前已确认 2\/3 项/)).toBeInTheDocument();
    expect(screen.getByText('压缩空气蓄能管路及冷却器腔体')).toBeInTheDocument();
  });

  /** LOTO 行卡片：隔离点位文本所在的一行（行内即现场登记输入框与确认勾选） */
  const lotoRow = (pointText: string) => {
    const el = screen.getByText(pointText).closest('[class*="rounded-xl"]');
    if (!el) throw new Error(`未找到隔离点行：${pointText}`);
    return el as HTMLElement;
  };

  const checkToggle = (pointText: string) => {
    const box = lotoRow(pointText).querySelector('input[type="checkbox"]');
    if (!box) throw new Error(`隔离点行内未找到确认勾选：${pointText}`);
    return box as HTMLInputElement;
  };

  /** 补登面板：点「补登隔离点」后展开的虚线框，行内也有同名的「隔离点位」输入框，必须按面板取 */
  const lotoAddPanel = () => {
    const el = screen.getByText(/现场补登/).closest('[class*="rounded-xl"]');
    if (!el) throw new Error('未找到补登面板');
    return el as HTMLElement;
  };

  it('勾选隔离点只发 PATCH loto-confirm，前端不自建确认状态', async () => {
    renderView();
    await screen.findByText('压缩空气蓄能管路及冷却器腔体');
    fireEvent.click(checkToggle('压缩空气蓄能管路及冷却器腔体'));
    await waitFor(() =>
      expect(api.toggleLotoItem).toHaveBeenCalledWith('bl-1', { itemId: 'loto-3', confirmed: true, fields: undefined })
    );
  });

  it('LOTO 行内点位/锁号可现场登记，保存时只提交改过的字段', async () => {
    renderView();
    const row = await screen.findByText('压缩空气蓄能管路及冷却器腔体');
    const lockInput = within(lotoRow('压缩空气蓄能管路及冷却器腔体')).getByLabelText(/锁具/) as HTMLInputElement;
    fireEvent.change(lockInput, { target: { value: 'LK-RS-902' } });
    expect(row).toBeInTheDocument();
    fireEvent.click(within(lotoRow('压缩空气蓄能管路及冷却器腔体')).getByRole('button', { name: /保存登记/ }));
    await waitFor(() =>
      expect(api.toggleLotoItem).toHaveBeenCalledWith('bl-1', {
        itemId: 'loto-3',
        confirmed: false,
        fields: { lockNumber: 'LK-RS-902' },
      })
    );
  });

  it('AI 清单漏项时可补登隔离点，来源由服务端标人工登记', async () => {
    renderView();
    await screen.findByText('压缩空气蓄能管路及冷却器腔体');
    fireEvent.click(screen.getByRole('button', { name: /补登隔离点/ }));
    fireEvent.change(within(lotoAddPanel()).getByLabelText(/隔离点位/), { target: { value: '润滑油泵电机接线端子' } });
    fireEvent.click(screen.getByRole('button', { name: /提交补登/ }));
    await waitFor(() =>
      expect(api.addLotoItem).toHaveBeenCalledWith('bl-1', { type: '电气隔离', point: '润滑油泵电机接线端子' })
    );
  });

  it('LOTO 未 100% 确认时前端拦住推进，不把半成品请求发给服务端', async () => {
    renderView();
    const advance = await screen.findByRole('button', { name: /确认推进/ });
    fireEvent.click(advance);
    await waitFor(() => expect(api.confirmStage).not.toHaveBeenCalled());
    // 页面上挂着的是真实闸门说明，而不是「已推进」的假成功
    expect(screen.getByText(/服务端闸门会拒绝未满 100% 的推进请求/)).toBeInTheDocument();
  });

  it('逐项确认到 3/3 后推进，才对服务端进行中环节 3 发 POST confirm', async () => {
    api.toggleLotoItem.mockResolvedValue(allConfirmedLoop);
    renderView();
    await screen.findByText('压缩空气蓄能管路及冷却器腔体');
    fireEvent.click(checkToggle('压缩空气蓄能管路及冷却器腔体'));
    await waitFor(() => expect(screen.getByText(/当前已确认 3\/3 项/)).toBeInTheDocument());

    const advance = await screen.findByRole('button', { name: /确认推进/ });
    fireEvent.click(advance);
    await waitFor(() => expect(api.confirmStage).toHaveBeenCalledWith('bl-1', 3, undefined));
  });

  it('工单要素在确认前可改写：确认请求带 edits，未改的字段不提交', async () => {
    api.getById.mockResolvedValue(loopAtStage1);
    renderView();
    const hours = await screen.findByLabelText(/预计工时/);
    fireEvent.change(hours, { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText(/优先级/), { target: { value: 'urgent' } });
    // 提示条如实标出待提交处数，确认按钮文案同步
    expect(await screen.findByText(/待提交人工修订 2 处/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /确认落库（含 2 处人工修订）/ }));
    await waitFor(() =>
      expect(api.confirmStage).toHaveBeenCalledWith('bl-1', 1, {
        workOrderDraft: { estimatedHours: 2.5, priority: 'urgent' },
      })
    );
  });

  it('「恢复 AI 原值」丢弃本地改写，确认后按 AI 预填原值落库', async () => {
    api.getById.mockResolvedValue(loopAtStage1);
    renderView();
    const title = await screen.findByLabelText(/工单标题/);
    fireEvent.change(title, { target: { value: '人工改过的标题名字' } });
    fireEvent.click(screen.getByRole('button', { name: /恢复 AI 原值/ }));
    expect((title as HTMLInputElement).value).toBe('2# 无油螺杆空压机主机振动偏高检修');
    fireEvent.click(screen.getByRole('button', { name: /确认推进/ }));
    await waitFor(() => expect(api.confirmStage).toHaveBeenCalledWith('bl-1', 1, undefined));
  });

  it('产出物计数取接口数组长度，且不再保留「打包导出」等无接口入口', async () => {
    renderView();
    expect(await screen.findByText(/已就绪 1\/2/)).toBeInTheDocument();
    expect(screen.getByText('业务闭环产出物档案')).toBeInTheDocument();
    expect(screen.queryByText('打包导出')).not.toBeInTheDocument();
  });

  it('历史闭环区渲染 /history 返回的记录与条数', async () => {
    renderView();
    expect(await screen.findByText('PL-20261010-002')).toBeInTheDocument();
    expect(screen.getByText(/1 条归档记录/)).toBeInTheDocument();
  });

  it('排版：两栏流式落位，卡片不再被写死的最小高度撑出整片空白', async () => {
    renderView();
    await screen.findByText(/2#无油螺杆空压机主机振动偏高/);
    const left = document.querySelector('[class*="lg:col-span-8"]');
    const right = document.querySelector('[class*="lg:col-span-4"]');
    if (!left || !right) throw new Error('未渲染 lg:col-span-8 / lg:col-span-4 两栏容器');

    // 用户点名的空白来源：档案/建议曾挂在被撑高的第三行上方，现在按内容高度顺排
    expect(within(left as HTMLElement).getByText('业务闭环产出物档案')).toBeInTheDocument();
    expect(within(left as HTMLElement).getByText('AI 智能管家行动建议')).toBeInTheDocument();
    expect(within(right as HTMLElement).getByText('AI 全域上下文贯穿链')).toBeInTheDocument();
    expect(within(right as HTMLElement).getByText('近期已归档业务闭环')).toBeInTheDocument();
    // 全站不允许再出现 min-h-* 撑高（原 min-h-[460px] 在任何视口宽度下都会留白）
    expect(document.querySelector('[class*="min-h-"]')).toBeNull();
  });

  it('质检归档环节不是空面板：进环节 6 渲染归档前核对与人工修订台账', async () => {
    api.getById.mockResolvedValue(loopAtStage6);
    renderView();
    expect(await screen.findByText(/归档前核对/)).toBeInTheDocument();
    // 六环节确认态 + 产出物实况 + 修订台账，全部取自接口
    expect(screen.getByText('环节 6·质检归档')).toBeInTheDocument();
    expect(screen.getByText('人工修订台账')).toBeInTheDocument();
    expect(screen.getByText(/环节 1：工单标题、优先级、预计工时（陈主管/)).toBeInTheDocument();
    expect(screen.getByText(/LOTO「压缩空气蓄能管路及冷却器腔体」：陈主管/)).toBeInTheDocument();
    expect(screen.getByText(/【结论】修复后振动 1\.6 mm\/s，达标/)).toBeInTheDocument();
  });

  it('页头三颗指标由接口现算：在办=列表长度，本周=归档落在本自然周，平均=历史耗时均值', async () => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 10:00`;
    const now = new Date();
    const thisWeekItem: HistoryLoopItem = { ...historyItem, closedDate: stamp(now), duration: '6.0h' };
    const lastMonthItem: HistoryLoopItem = {
      ...historyItem,
      id: 'hl-older',
      loopCode: 'PL-20260918-001',
      closedDate: stamp(new Date(now.getTime() - 30 * 86400000)),
      duration: '2.0h',
    };
    api.history.mockResolvedValue([thisWeekItem, lastMonthItem]);

    const seen: LoopHeaderStats[] = [];
    render(
      <ToastProvider>
        <HermesWorkbenchView onStatsChange={(s) => seen.push(s)} />
      </ToastProvider>
    );
    await screen.findByText(/2#无油螺杆空压机主机振动偏高/);
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));

    const stats = seen[seen.length - 1];
    expect(stats.runningCount).toBe(1);
    // 30 天前那条不属于本自然周，不能拿「归档总条数」冒充「本周闭环」
    expect(stats.archivedThisWeek).toBe(1);
    expect(stats.avgDurationHours).toBe(4);
  });

  it('后端不可达时只提示无法连接，不回落任何闭环数据', async () => {
    api.list.mockRejectedValue(new Error('Failed to fetch'));
    renderView();
    expect(await screen.findByText('无法连接后端服务')).toBeInTheDocument();
    expect(screen.getByText(/请确认服务已在 3000 端口启动/)).toBeInTheDocument();
    expect(screen.queryByText('PL-20261018-001')).not.toBeInTheDocument();
    expect(screen.queryByText('现场报修')).not.toBeInTheDocument();
    expect(screen.queryByText(/2#无油螺杆空压机主机振动偏高/)).not.toBeInTheDocument();
  });

  it('没有进行中闭环时进入目标录入态，提交后调用 POST 创建接口', async () => {
    api.list.mockResolvedValue([]);
    renderView();
    const submit = await screen.findByRole('button', { name: /生成业务路线图/ });
    fireEvent.click(submit);
    await waitFor(() => expect(api.create).toHaveBeenCalledWith({ goal: loop.businessGoal }));
  });
});
