// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HermesWorkbenchView } from '../../src/components/hermes/HermesWorkbenchView';
import { ToastProvider } from '../../src/context/ToastContext';
import type { BusinessClosedLoopData } from '../../src/components/hermes/types';

const { mockLoop } = vi.hoisted(() => {
  const loop: BusinessClosedLoopData = {
    id: 'loop-001',
    loopCode: 'PL-28250618-042',
    status: 'running',
    businessGoal: '3号空压机轴承温度高，帮我走检修流程',
    equipment: {
      id: 'eq-003',
      name: '3#离心式空压机',
      code: 'AC-CENT-003',
      model: 'ZH-1000',
      workshop: '动力车间 B区',
      healthScore: 72,
      status: 'warning',
      temperature: 68.4,
      temperatureThreshold: 65,
      vibration: 2.1,
      loadRate: 75,
    },
    initiator: {
      name: '陈主管',
      role: '生产调度主管',
      time: '2025-06-18 09:30',
    },
    progress: {
      currentStageOrder: 3,
      totalStages: 6,
      percent: 33,
      estimatedTotalHours: 3.5,
      elapsedHours: 1.2,
    },
    stages: [
      {
        id: 'stage_report',
        order: 1,
        title: '现场报修',
        status: 'completed',
        aiBadge: '智能报修',
        outputSummary: '工单',
        targetPage: '工单管理',
        targetTabKey: 'workorders',
        duration: '10min',
        aiPrefill: { engine: 'ai' },
      },
      {
        id: 'stage_permit',
        order: 2,
        title: '高危作业票',
        status: 'completed',
        aiBadge: '风险研判',
        outputSummary: '作业票',
        targetPage: '安全管理',
        targetTabKey: 'safety',
        duration: '15min',
        aiPrefill: { engine: 'ai' },
      },
      {
        id: 'stage_loto',
        order: 3,
        title: 'LOTO能量隔离',
        status: 'in_progress',
        aiBadge: '隔离推演',
        outputSummary: 'LOTO清单',
        targetPage: 'LOTO管理',
        targetTabKey: 'safety',
        duration: '20min',
        aiPrefill: {
          engine: 'safety-interlock',
          generatedAt: '2025-06-18 10:20',
          content: '基于拓扑分析建议执行3处隔离点',
        },
      },
      {
        id: 'stage_execution',
        order: 4,
        title: '检修执行',
        status: 'pending',
        aiBadge: 'SOP推理',
        outputSummary: '作业方案',
        targetPage: '标准规程',
        targetTabKey: 'procedures',
        duration: '90min',
        aiPrefill: { engine: 'ai' },
      },
      {
        id: 'stage_completion',
        order: 5,
        title: '完工',
        status: 'pending',
        aiBadge: '巡检比对',
        outputSummary: '完工记录',
        targetPage: '巡检记录',
        targetTabKey: 'inspections',
        duration: '30min',
        aiPrefill: { engine: 'ai' },
      },
      {
        id: 'stage_archive',
        order: 6,
        title: '质检归档',
        status: 'pending',
        aiBadge: '知识提炼',
        outputSummary: '案例归档',
        targetPage: '知识图谱',
        targetTabKey: 'knowledge',
        duration: '20min',
        aiPrefill: { engine: 'ai' },
      },
    ],
    lotoItems: [
      {
        id: 'loto-1',
        type: '电气隔离',
        point: 'QF-03 主电源进线断路器',
        requirement: '分闸断电',
        lockNumber: 'LK-EL-408',
        confirmed: true,
        operator: '李工',
      },
      {
        id: 'loto-2',
        type: '气源隔离',
        point: 'V-301 压缩空气排气总管入口截止阀',
        requirement: '完全顺时针旋转手轮至关闭位',
        lockNumber: 'LK-PN-112',
        confirmed: true,
        operator: '王工',
      },
      {
        id: 'loto-3',
        type: '残余能量',
        point: '压缩空气蓄能管路及冷却器腔体',
        requirement: '双金属压力表指示彻底归零 (0MPa)',
        lockNumber: 'TAG-PRS-001',
        confirmed: false,
        operator: '待确认',
      },
    ],
    artifacts: [
      {
        id: 'art-1',
        code: 'WO-2025-0618-042',
        name: '智能检修工单',
        stageId: 'stage_report',
        status: 'ready',
        category: '检修工单',
        previewContent: '工单内容预览',
      },
    ],
    suggestions: [
      {
        id: 'sug-1',
        type: 'todo',
        title: '待办提醒：11:00 前完成 LOTO 三点确认',
        content: '当前生产平稳，确保检修班组准时开工',
        tag: '时间窗口',
        actionText: '去确认泄压',
      },
    ],
  };
  return { mockLoop: loop };
});

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { id: 'u-101', name: '陈主管', role: 'admin' } }),
  useOptionalAuth: () => ({ currentUser: { id: 'u-101', name: '陈主管', role: 'admin' } }),
}));

vi.mock('../../src/api/businessLoopApi', () => ({
  businessLoopApi: {
    list: vi.fn().mockResolvedValue([
      { id: 'loop-001', loopNo: 'PL-28250618-042', currentStage: 3, businessGoal: '3号空压机' },
    ]),
    getById: vi.fn().mockResolvedValue(mockLoop),
    history: vi.fn().mockResolvedValue([
      {
        id: 'hl-1',
        loopCode: 'PL-20250610-019',
        targetGoal: '2# 循环水泵机封泄漏综合处置',
        equipmentName: '2# 循环冷却水泵',
        status: 'archived',
        duration: '2.8h',
        artifactCount: 8,
        knowledgeCount: 1,
        closedDate: '2025-06-10 16:40',
        leadUser: '张主管',
      },
    ]),
  },
}));

describe('HermesWorkbenchView Component', () => {
  afterEach(() => {
    cleanup();
  });

  const renderComponent = () => {
    const onNavigateTab = vi.fn();
    const result = render(
      <ToastProvider>
        <HermesWorkbenchView onNavigateTab={onNavigateTab} />
      </ToastProvider>
    );
    return { ...result, onNavigateTab };
  };

  it('renders business overview card with target goal and equipment details', async () => {
    renderComponent();
    expect(await screen.findByText(/3号空压机轴承温度高，帮我走检修流程/i)).toBeInTheDocument();
    expect(screen.getByText(/PL-28250618-042/i)).toBeInTheDocument();
    expect(screen.getAllByText(/3#离心式空压机/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/陈主管/i).length).toBeGreaterThan(0);
  });

  it('renders the 6 closed-loop stages in the stepper', async () => {
    renderComponent();
    expect(await screen.findByText('现场报修')).toBeInTheDocument();
    expect(screen.getAllByText('高危作业票').length).toBeGreaterThan(0);
    expect(screen.getAllByText('LOTO能量隔离').length).toBeGreaterThan(0);
    expect(screen.getAllByText('检修执行').length).toBeGreaterThan(0);
    expect(screen.getAllByText('完工').length).toBeGreaterThan(0);
    expect(screen.getAllByText('质检归档').length).toBeGreaterThan(0);
  });

  it('displays LOTO workbench with AI prefilled card and confirmation items', async () => {
    renderComponent();
    expect(await screen.findByText(/AI 已预填/i)).toBeInTheDocument();
    expect(screen.getAllByText(/QF-03/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/V-301/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/0MPa/i).length).toBeGreaterThan(0);
  });

  it('renders bottom sections: artifacts, AI suggestions, and history loops', async () => {
    renderComponent();
    expect(await screen.findByText(/业务闭环产出物档案/i)).toBeInTheDocument();
    expect(screen.getByText(/AI 智能管家行动建议/i)).toBeInTheDocument();
    expect(screen.getByText(/近期已归档业务闭环/i)).toBeInTheDocument();
  });

  it('switches to goal input hero when clicking new business goal', async () => {
    renderComponent();
    const newGoalBtn = (await screen.findByText('新建业务目标')).closest('button')!;
    fireEvent.click(newGoalBtn);
    expect(await screen.findByText(/生成业务路线图/i)).toBeInTheDocument();

    const returnBtn = (await screen.findByText('返回当前闭环')).closest('button')!;
    fireEvent.click(returnBtn);
    expect(await screen.findByText(/业务闭环全景路线/i)).toBeInTheDocument();
  });
});
