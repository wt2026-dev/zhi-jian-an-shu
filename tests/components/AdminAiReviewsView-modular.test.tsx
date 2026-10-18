// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AdminAiReviewsView } from '../../src/components/AdminAiReviewsView';
import { adminAiReviewApi, AiGenerationReview, AiAnalysisTraceLog } from '../../src/api';

vi.mock('../../src/api', () => ({
  adminAiReviewApi: {
    list: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    listTraceLogs: vi.fn(),
  },
}));

const mockReviews: AiGenerationReview[] = [
  {
    id: 'rev-001',
    aiEndpoint: '/api/v1/ai/generate-maintenance-plan',
    sourceType: 'maintenance_plan',
    sourceTypeLabel: '检修方案',
    status: 'pending',
    reviewer: null,
    reviewNote: null,
    reviewedAt: null,
    content: {
      overview: '离心压缩机干气密封系统大修规程',
      steps: [
        { step: 1, operation: '挂牌上锁 (LOTO)' },
        { step: 2, operation: '氮气置换与压力测试' },
      ],
      safetyMeasures: '严禁带压作业',
    },
    knowledgeSources: ['kb-01', 'kb-02'],
    knowledgeRefs: [
      { id: 'kb-01', title: '离心压缩机检修技术规范', category: '检修SOP规程', excerpt: '检修前需完成氮气吹扫置换' },
    ],
    createdAt: '2026-10-18T10:00:00Z',
  },
  {
    id: 'rev-002',
    aiEndpoint: '/api/v1/ai/safety-risk-assessment',
    sourceType: 'safety_risk',
    sourceTypeLabel: '作业风险评估',
    status: 'approved',
    reviewer: '管理员张工',
    reviewedAt: '2026-10-18T11:00:00Z',
    reviewNote: '风险控制措施充分，同意签发',
    content: {
      riskLevel: '高风险',
      riskReason: '存在高压易燃介质泄漏可能',
      jsaMeasures: '配备正压式呼吸器与可燃气体检测仪',
    },
    knowledgeSources: [],
    createdAt: '2026-10-18T09:30:00Z',
  },
];

const mockTraceLogs: AiAnalysisTraceLog[] = [
  {
    id: 'trace-001',
    model: 'qwen-plus',
    promptVersion: 'v2.4-fault-tree',
    reviewStatus: 'approved',
    question: '1#循环水泵振动8.2mm/s，轴温78°C',
    inputDigest: '1#循环水泵振动8.2mm/s，轴温78°C',
    deviceModel: '离心泵 KQ-500',
    createdAt: '2026-10-18T10:30:00Z',
    safetyNotice: {
      required: true,
      level: 'high',
      reason: '振动超过 ISO 10816-3 停机阈值，需停机检修',
      requiresConfirmation: true,
      riskTypes: ['vibration'],
      degraded: false,
    },
    result: {
      diagnosis: '轴承疲劳剥落或动不平衡',
      confidence: 0.94,
    },
  },
];

describe('AdminAiReviewsView 模块化重构验证', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminAiReviewApi.list).mockResolvedValue(mockReviews);
    vi.mocked(adminAiReviewApi.listTraceLogs).mockResolvedValue(mockTraceLogs);
    vi.mocked(adminAiReviewApi.approve).mockResolvedValue({ id: 'rev-001', status: 'approved' } as any);
    vi.mocked(adminAiReviewApi.reject).mockResolvedValue({ id: 'rev-001', status: 'rejected' } as any);
  });

  it('1. 完整渲染页头、统计卡、审核生命周期流程与审核列表', async () => {
    render(<AdminAiReviewsView />);

    await waitFor(() => {
      expect(screen.getByText('AI 生成内容审核与追溯台')).toBeInTheDocument();
      expect(screen.getByText('AI 生成内容全生命周期审核流程')).toBeInTheDocument();
      expect(screen.getByText('离心压缩机干气密封系统大修规程')).toBeInTheDocument();
      expect(screen.getByText('知识库引用 2 篇')).toBeInTheDocument();
    });
  });

  it('2. 支持按状态切换过滤 (待审核 / 已通过 / 已驳回 / 全部)', async () => {
    render(<AdminAiReviewsView />);

    await waitFor(() => {
      expect(adminAiReviewApi.list).toHaveBeenCalled();
    });

    // 点击已通过按钮
    const approvedBtn = screen.getByRole('button', { name: '已通过' });
    fireEvent.click(approvedBtn);

    await waitFor(() => {
      expect(adminAiReviewApi.list).toHaveBeenCalledWith('approved');
    });

    // 点击全部内容卡片
    const allBtn = screen.getByRole('button', { name: '全部' });
    fireEvent.click(allBtn);

    await waitFor(() => {
      expect(adminAiReviewApi.list).toHaveBeenCalledWith(undefined);
    });
  });

  it('3. 支持主 Tab 自由切换至版本与输入追溯日志并按模型筛选', async () => {
    render(<AdminAiReviewsView />);

    // 切换到版本与输入追溯日志
    const traceTabBtn = screen.getByRole('button', { name: /版本与输入追溯日志/ });
    fireEvent.click(traceTabBtn);

    await waitFor(() => {
      expect(adminAiReviewApi.listTraceLogs).toHaveBeenCalled();
      expect(screen.getByText('全链路 AI 调用追溯审计 (ai_analysis_log)')).toBeInTheDocument();
      expect(screen.getByText(/1#循环水泵振动8.2mm\/s/)).toBeInTheDocument();
      expect(screen.getByText('Prompt: v2.4-fault-tree')).toBeInTheDocument();
      expect(screen.getByText('高危复核要求')).toBeInTheDocument();
    });

    // 更改模型过滤
    const modelSelect = screen.getByRole('combobox');
    fireEvent.change(modelSelect, { target: { value: 'qwen-plus' } });

    await waitFor(() => {
      expect(adminAiReviewApi.listTraceLogs).toHaveBeenCalledWith('qwen-plus');
    });
  });

  it('4. 点击审核条目打开详情抽屉，并支持通过操作', async () => {
    render(<AdminAiReviewsView />);

    await waitFor(() => {
      expect(screen.getByText('离心压缩机干气密封系统大修规程')).toBeInTheDocument();
    });

    // 点击该行打开详情抽屉
    fireEvent.click(screen.getByText('离心压缩机干气密封系统大修规程'));

    expect(screen.getByText('生成内容详情')).toBeInTheDocument();
    expect(screen.getByText(/离心压缩机检修技术规范/)).toBeInTheDocument();
    expect(screen.getByText(/严禁带压作业/)).toBeInTheDocument();

    // 点击抽屉底部的审核通过按钮
    const approveBtn = screen.getByRole('button', { name: /审核通过（内容可正式使用）/ });
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(adminAiReviewApi.approve).toHaveBeenCalledWith('rev-001');
    });
  });

  it('5. 支持在详情抽屉中填写原因并驳回', async () => {
    render(<AdminAiReviewsView />);

    await waitFor(() => {
      expect(screen.getByText('离心压缩机干气密封系统大修规程')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('离心压缩机干气密封系统大修规程'));

    // 点击抽屉内的驳回按钮展开驳回表单
    const drawerRejectBtn = screen.getAllByRole('button', { name: /驳回/ })[1];
    fireEvent.click(drawerRejectBtn);

    expect(screen.getByText('驳回原因（必填）')).toBeInTheDocument();

    // 填写驳回原因
    const reasonInput = screen.getByPlaceholderText(/例：检修步骤与设备实际工况不符/);
    fireEvent.change(reasonInput, { target: { value: '缺少氮气置换完毕的含氧量检测标准' } });

    // 确认驳回
    const confirmRejectBtn = screen.getByRole('button', { name: /确认驳回/ });
    fireEvent.click(confirmRejectBtn);

    await waitFor(() => {
      expect(adminAiReviewApi.reject).toHaveBeenCalledWith('rev-001', '缺少氮气置换完毕的含氧量检测标准');
    });
  });

  it('6. 点击追溯记录打开追溯详情抽屉，展示模型与安全警示', async () => {
    render(<AdminAiReviewsView />);

    // 切换到追溯 Tab
    fireEvent.click(screen.getByRole('button', { name: /版本与输入追溯日志/ }));

    await waitFor(() => {
      expect(screen.getByText(/1#循环水泵振动8.2mm\/s/)).toBeInTheDocument();
    });

    // 点击追溯项
    fireEvent.click(screen.getByText(/1#循环水泵振动8.2mm\/s/));

    expect(screen.getByText('AI 调用追溯明细')).toBeInTheDocument();
    expect(screen.getByText('工业安全警示 (safetyNotice)')).toBeInTheDocument();
    expect(screen.getByText(/振动超过 ISO 10816-3 停机阈值/)).toBeInTheDocument();
    expect(screen.getByText('轴承疲劳剥落或动不平衡')).toBeInTheDocument();
  });
});
