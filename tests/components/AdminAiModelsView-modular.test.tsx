// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import type { AiModelConfig } from '../../src/api';

const mockList = vi.fn();
const mockUpsert = vi.fn();
const mockReorder = vi.fn();
const mockTest = vi.fn();

vi.mock('../../src/api', () => ({
  adminAiModelApi: {
    list: (...args: unknown[]) => mockList(...args),
    upsert: (...args: unknown[]) => mockUpsert(...args),
    reorder: (...args: unknown[]) => mockReorder(...args),
    test: (...args: unknown[]) => mockTest(...args),
  },
}));

import { AdminAiModelsView } from '../../src/components/AdminAiModelsView';

const DEMO_MODELS: AiModelConfig[] = [
  {
    id: 'aimc-dashscope-chat',
    provider: 'dashscope',
    displayName: '通义千问 (主选)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyMasked: 'env:DASHSCOPE_API_KEY',
    modelName: 'qwen-plus',
    capabilities: ['chat'],
    priority: 10,
    enabled: true,
    healthStatus: 'healthy',
    lastCheckedAt: '2026-10-18T10:00:00Z',
  },
  {
    id: 'aimc-deepseek-chat',
    provider: 'deepseek',
    displayName: 'DeepSeek V3 (候选)',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyMasked: 'sk-***abcd',
    modelName: 'deepseek-chat',
    capabilities: ['chat'],
    priority: 20,
    enabled: true,
    healthStatus: 'unhealthy',
    lastCheckedAt: '2026-10-18T10:05:00Z',
  },
  {
    id: 'aimc-vision-experimental',
    provider: 'dashscope',
    displayName: '通义视觉 (实验)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyMasked: 'env:DASHSCOPE_API_KEY',
    modelName: 'qwen-vl-max',
    capabilities: ['vision'],
    priority: 30,
    enabled: false,
    healthStatus: 'unknown',
    lastCheckedAt: null,
  },
];

describe('AdminAiModelsView - 模块化拆分与交互全量测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('展示页头、容灾流程图以及准确的模型池统计摘要', async () => {
    mockList.mockResolvedValueOnce(DEMO_MODELS);
    render(<AdminAiModelsView />);

    expect(screen.getByText('加载模型配置…')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('AI 模型路由')).toBeInTheDocument();
    });

    expect(screen.getByText('多模型容灾与路由降级机制')).toBeInTheDocument();
    expect(screen.getByText('步骤 1')).toBeInTheDocument();
    expect(screen.getByText('业务请求发起')).toBeInTheDocument();
    expect(screen.getByText('候选 #1 优先尝试')).toBeInTheDocument();
    expect(screen.getByText('切换候选 #2 … #N')).toBeInTheDocument();
    expect(screen.getByText('规则引擎专家降级')).toBeInTheDocument();

    // 统计条断言：总数 3，启用 2，健康 1，异常 1，未检测 1
    expect(screen.getByText('模型总数')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('正确渲染各个模型卡片及其详情与状态标签', async () => {
    mockList.mockResolvedValueOnce(DEMO_MODELS);
    render(<AdminAiModelsView />);

    await waitFor(() => {
      expect(screen.getByText('通义千问 (主选)')).toBeInTheDocument();
      expect(screen.getByText('DeepSeek V3 (候选)')).toBeInTheDocument();
      expect(screen.getByText('通义视觉 (实验)')).toBeInTheDocument();
    });

    expect(screen.getAllByText('健康').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('异常').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('未检测').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('已停用')).toBeInTheDocument();
    expect(screen.getByText(/dashscope · qwen-plus/)).toBeInTheDocument();
    expect(screen.getByText(/deepseek · deepseek-chat/)).toBeInTheDocument();
  });

  it('支持调整优先级（提高 / 降低）并触发 reorder 接口', async () => {
    mockList.mockResolvedValue(DEMO_MODELS);
    mockReorder.mockResolvedValueOnce({ configs: [DEMO_MODELS[1], DEMO_MODELS[0], DEMO_MODELS[2]] });

    render(<AdminAiModelsView />);

    await waitFor(() => {
      expect(screen.getByText('DeepSeek V3 (候选)')).toBeInTheDocument();
    });

    const upButton = screen.getByLabelText('提高 DeepSeek V3 (候选) 优先级');
    fireEvent.click(upButton);

    await waitFor(() => {
      expect(mockReorder).toHaveBeenCalledWith([
        'aimc-deepseek-chat',
        'aimc-dashscope-chat',
        'aimc-vision-experimental',
      ]);
    });
  });

  it('支持测试连接并展示耗时与成功反馈', async () => {
    mockList.mockResolvedValue(DEMO_MODELS);
    mockTest.mockResolvedValueOnce({ success: true, latencyMs: 342 });

    render(<AdminAiModelsView />);

    await waitFor(() => {
      expect(screen.getByText('通义千问 (主选)')).toBeInTheDocument();
    });

    const testButtons = screen.getAllByRole('button', { name: /测试连接/ });
    fireEvent.click(testButtons[0]);

    await waitFor(() => {
      expect(mockTest).toHaveBeenCalledWith('aimc-dashscope-chat');
      expect(screen.getByText('连接正常，耗时 342ms')).toBeInTheDocument();
    });
  });

  it('支持启停切换并触发 upsert 接口', async () => {
    mockList.mockResolvedValue(DEMO_MODELS);
    mockUpsert.mockResolvedValueOnce({
      success: true,
      config: { ...DEMO_MODELS[0], enabled: false },
    });

    render(<AdminAiModelsView />);

    await waitFor(() => {
      expect(screen.getByText('通义千问 (主选)')).toBeInTheDocument();
    });

    const stopButtons = screen.getAllByRole('button', { name: '停用' });
    fireEvent.click(stopButtons[0]);

    await waitFor(() => {
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'aimc-dashscope-chat',
          enabled: false,
        })
      );
    });
  });

  it('支持打开表单弹窗、填写内容、Unicode NFC 规范化并提交保存', async () => {
    mockList.mockResolvedValue(DEMO_MODELS);
    mockUpsert.mockResolvedValueOnce({
      success: true,
      config: { ...DEMO_MODELS[0] },
    });

    render(<AdminAiModelsView />);

    await waitFor(() => {
      expect(screen.getByText('通义千问 (主选)')).toBeInTheDocument();
    });

    const addBtn = screen.getByRole('button', { name: /新增模型/ });
    fireEvent.click(addBtn);

    expect(screen.getByText('新增模型配置')).toBeInTheDocument();

    const providerInput = screen.getByPlaceholderText('dashscope / openai / deepseek…');
    const nameInput = screen.getByPlaceholderText('如：DeepSeek V3（备用）');
    const modelInput = screen.getByPlaceholderText('如：deepseek-chat / qwen-plus');

    fireEvent.change(providerInput, { target: { value: '  zhipu  ' } });
    fireEvent.change(nameInput, { target: { value: '  智谱 GLM-4  ' } });
    fireEvent.change(modelInput, { target: { value: '  glm-4-plus  ' } });

    const saveBtn = screen.getByRole('button', { name: '保存' });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'zhipu',
          displayName: '智谱 GLM-4',
          modelName: 'glm-4-plus',
          capabilities: ['chat'],
          enabled: true,
        })
      );
    });
  });

  it('当模型配置列表为空时展示友好空状态与新增引导按钮', async () => {
    mockList.mockResolvedValueOnce([]);
    render(<AdminAiModelsView />);

    await waitFor(() => {
      expect(screen.getByText('暂无模型配置')).toBeInTheDocument();
    });

    expect(
      screen.getByText((content) => content.includes('OpenAI 兼容接口'))
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /新增模型配置/ })).toBeInTheDocument();
  });
});
