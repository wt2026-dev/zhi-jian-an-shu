// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AiPipelineView } from '../../src/components/AiPipelineView';
import { equipmentApi, aiPipelineApi } from '../../src/api';
import { Equipment } from '../../src/types';

vi.mock('../../src/api', () => ({
  equipmentApi: {
    list: vi.fn(),
  },
  aiPipelineApi: {
    list: vi.fn(),
    create: vi.fn(),
    getById: vi.fn(),
  },
}));

const mockEquipments: Equipment[] = [
  {
    id: 'eq-101',
    code: 'EQ-001',
    name: '1# 高压循环泵',
    type: '离心泵',
    category: '泵类设备',
    workshop: '一号车间',
    location: '一号泵房',
    status: 'running',
    healthScore: 88,
    criticality: '关键核心',
    installDate: '2022-01-01',
    manufacturer: '泵业制造',
    model: 'PUMP-500',
    specs: {},
    maintenanceHistory: [],
    nextInspectionDate: '2026-10-20',
    qrCode: 'QR-EQ-001',
    telemetry: {
      temperature: 45,
      vibration: 1.2,
      voltage: 380,
      current: 25,
      loadRate: 75,
      lastUpdated: '2026-10-18T00:00:00Z',
    },
  },
];

const mockCompletedTask = {
  id: 'task-test-1234567890',
  equipmentId: 'eq-101',
  problemDescription: '运行中轴承箱温度持续升高并伴有金属摩擦异响',
  status: 'completed' as const,
  progress: 100,
  currentStep: null,
  steps: [
    {
      id: 'step-1',
      stepName: '故障诊断',
      status: 'completed' as const,
      progress: 100,
      result: {
        success: true,
        data: {
          diagnosis: {
            severity: '高风险',
            urgencyScore: 85,
            summary: '轴承疲劳磨损，游隙异常增大',
            probableCauses: [
              { cause: '润滑不良', probability: 70, detail: '油脂变质硬化' },
            ],
          },
        },
      },
    },
    {
      id: 'step-2',
      stepName: '检修方案生成',
      status: 'completed' as const,
      progress: 100,
      result: {
        success: true,
        data: {
          plan: {
            overview: '停机拆卸轴承箱，更换深沟球轴承',
            estimatedHours: 3.5,
            steps: [
              { step: 1, operation: '挂牌上锁并断开主电机电源' },
            ],
          },
        },
      },
    },
    {
      id: 'step-3',
      stepName: '风险审核',
      status: 'completed' as const,
      progress: 100,
      result: {
        success: true,
        data: {
          assessment: {
            riskLevel: '高',
            riskReason: '存在机械挤压与残余介质飞溅风险',
            lotoAdvice: { required: true, lockCount: 2 },
            jsaMeasures: [
              { hazard: '机械运转', control: '实施 LOTO 并验电确认' },
            ],
          },
        },
      },
    },
    {
      id: 'step-4',
      stepName: '派单推荐',
      status: 'completed' as const,
      progress: 100,
      result: {
        success: true,
        data: {
          recommendation: {
            recommended: { name: '张工', reason: '持有特种设备维修证书' },
            estimatedHours: 3.5,
            alternatives: [{ name: '李工' }],
          },
        },
      },
    },
  ],
  result: {
    report: {
      equipment: { id: 'eq-101', code: 'EQ-001', name: '1# 高压循环泵', healthScore: 88 },
      problemDescription: '运行中轴承箱温度持续升高并伴有金属摩擦异响',
      diagnosis: { severity: '高风险', summary: '轴承疲劳磨损' },
      plan: { overview: '停机拆卸轴承箱更换轴承', estimatedHours: 3.5 },
      risk: { riskLevel: '高', lotoAdvice: { required: true } },
      assignee: { recommended: { name: '张工' }, estimatedHours: 3.5 },
      generatedAt: '2026-10-18 15:00:00',
    },
  },
};

const mockRecentTasks = [
  {
    id: 'task-test-1234567890',
    equipmentId: 'eq-101',
    equipmentName: '1# 高压循环泵',
    problemDescription: '运行中轴承箱温度持续升高并伴有金属摩擦异响',
    status: 'completed',
    progress: 100,
    createdAt: '2026-10-18T07:00:00Z',
  },
];

describe('AiPipelineView 模块化重构验证', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (equipmentApi.list as any).mockResolvedValue(mockEquipments);
    (aiPipelineApi.list as any).mockResolvedValue({ tasks: mockRecentTasks });
    (aiPipelineApi.getById as any).mockResolvedValue({ task: mockCompletedTask });
    (aiPipelineApi.create as any).mockResolvedValue({ taskId: 'task-test-1234567890' });
  });

  it('1. 完整渲染页头、拓扑架构与 4 张能力卡片', async () => {
    render(<AiPipelineView />);

    expect(screen.getByText('AI 协同诊断与自动编排')).toBeInTheDocument();
    expect(screen.getByText('工业多智能体协同')).toBeInTheDocument();
    expect(screen.getByText('协同编排架构（DAG 异步并发拓扑）')).toBeInTheDocument();
    expect(screen.getAllByText('故障诊断推演')[0]).toBeInTheDocument();
    expect(screen.getAllByText('检修方案制定')[0]).toBeInTheDocument();
    expect(screen.getAllByText('JSA 风险审核')[0]).toBeInTheDocument();
    expect(screen.getAllByText('智能派单推荐')[0]).toBeInTheDocument();
  });

  it('2. 快捷测试工况点击可自动填充现象和设备', async () => {
    render(<AiPipelineView />);

    await waitFor(() => {
      expect(screen.getByText('🔥 轴承温升异响')).toBeInTheDocument();
    });

    const presetBtn = screen.getByText('🔥 轴承温升异响');
    fireEvent.click(presetBtn);

    const textarea = screen.getByPlaceholderText(/例：运行中轴承箱温度持续升高/);
    expect((textarea as HTMLTextAreaElement).value).toContain('运行中轴承箱温度持续升高至 78℃');
  });

  it('3. 发起协同诊断并展示执行流水线与步骤结果', async () => {
    render(<AiPipelineView />);

    await waitFor(() => {
      expect(screen.getByText('🔥 轴承温升异响')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('🔥 轴承温升异响'));
    const submitBtn = screen.getByText('启动协同诊断');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(aiPipelineApi.create).toHaveBeenCalledWith({
        equipmentId: 'eq-101',
        problemDescription: expect.stringContaining('运行中轴承箱温度持续升高'),
      });
    });

    await waitFor(() => {
      expect(screen.getByText('协同任务执行流水线')).toBeInTheDocument();
      expect(screen.getByText('全流程协同完成')).toBeInTheDocument();
      expect(screen.getByText('严重度：高风险')).toBeInTheDocument();
      expect(screen.getByText(/需 LOTO（2 把锁）/)).toBeInTheDocument();
    });
  });

  it('4. 终审报告正常渲染并支持 onGoDispatch 联动', async () => {
    const handleGoDispatch = vi.fn();
    render(<AiPipelineView onGoDispatch={handleGoDispatch} />);

    await waitFor(() => {
      expect(screen.getByText('载入详情')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('载入详情'));

    await waitFor(() => {
      expect(screen.getByText('协同检修终审报告')).toBeInTheDocument();
      expect(screen.getByText('前往调度大屏就近派单')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('前往调度大屏就近派单'));
    expect(handleGoDispatch).toHaveBeenCalledWith({ equipmentId: 'eq-101' });
  });

  it('5. 最近协同诊断历史表格展示正常与点击载入', async () => {
    render(<AiPipelineView />);

    await waitFor(() => {
      expect(screen.getByText('最近协同诊断历史')).toBeInTheDocument();
      expect(screen.getByText('全流程完成')).toBeInTheDocument();
    });

    const refreshBtn = screen.getByText('刷新历史');
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(aiPipelineApi.list).toHaveBeenCalled();
    });
  });
});
