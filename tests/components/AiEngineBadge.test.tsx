// @vitest-environment jsdom
/**
 * 「当前应答引擎：未连接」的两条真因守卫（2026-10-19 现场复现）。
 *
 * ① 引擎名原来只取"本会话已经答过话的那条消息上的 model"，所以每次刚进页面、
 *    还没问过 AI 时必然显示「未连接」—— 而模型路由里明明配着 healthy 的引擎。
 *    现在补一条真实来源：读 /api/v1/admin/ai-models，按后端同一套优先级挑主用模型。
 * ② 输入框的 Enter 处理没判 isComposing。中文输入法在候选未上屏时按 Enter 是
 *    "选词"，处理器照旧 preventDefault 会把候选提交一起吞掉，表现就是按了没反应、
 *    请求根本没发出去（服务端访问日志里那条时间窗确实一条 POST 都没有）。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiModelConfig } from '../../src/api';

const listMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/api', () => ({ adminAiModelApi: { list: listMock } }));

const { pickPrimaryChatModel, useAiEngineLabel } = await import('../../src/components/ai/useAiEngineLabel');
const { AiChatInputBar } = await import('../../src/components/ai/AiChatInputBar');

const cfg = (over: Partial<AiModelConfig> = {}): AiModelConfig => ({
  id: 'aimc-x',
  provider: 'agnes',
  displayName: '占位模型',
  baseUrl: '',
  apiKeyMasked: 'sk-***',
  modelName: 'placeholder',
  capabilities: ['chat'],
  priority: 5,
  enabled: true,
  healthStatus: 'healthy',
  lastCheckedAt: null,
  ...over,
});

const Harness = () => {
  const label = useAiEngineLabel();
  return <div data-testid="engine-label">{label ?? '未探测'}</div>;
};

afterEach(() => {
  cleanup();
  listMock.mockReset();
});

describe('pickPrimaryChatModel —— 引擎名取的是真实配置里的主用模型', () => {
  it('按 priority 升序取主用模型，而不是数组第一条', () => {
    // 反证：故意把备用（priority 更大）的放在前面
    const configs = [
      cfg({ id: 'aimc-backup', displayName: '备用引擎', priority: 20 }),
      cfg({ id: 'aimc-main', displayName: '主用引擎', priority: 5 }),
    ];
    expect(pickPrimaryChatModel(configs)).toBe('主用引擎');
  });

  it('只具备 vision / video 能力的模型不能顶替应答引擎', () => {
    expect(pickPrimaryChatModel([cfg({ displayName: '视觉模型', capabilities: ['vision'] })])).toBeNull();
  });

  it('停用的模型不参与选择', () => {
    expect(pickPrimaryChatModel([cfg({ displayName: '已停用引擎', enabled: false })])).toBeNull();
  });

  it('最近探测失败时如实标注，不伪装成在线', () => {
    expect(pickPrimaryChatModel([cfg({ displayName: '主用引擎', healthStatus: 'unhealthy' })])).toBe(
      '主用引擎（最近探测失败）'
    );
    // unknown（刚播种还没测过）不加失败标记，避免把没数据说成坏数据
    expect(pickPrimaryChatModel([cfg({ displayName: '主用引擎', healthStatus: 'unknown' })])).toBe('主用引擎');
  });

  it('空配置返回 null，交给界面决定占位文案', () => {
    expect(pickPrimaryChatModel([])).toBeNull();
  });
});

describe('useAiEngineLabel —— 进页面就能报出真实引擎', () => {
  it('读到模型配置后显示主用引擎名（而不是「未连接」）', async () => {
    listMock.mockResolvedValue([cfg({ displayName: 'Agnes 2.5 Flash（对话+视觉）', healthStatus: 'healthy' })]);
    render(<Harness />);
    expect(await screen.findByText('Agnes 2.5 Flash（对话+视觉）')).toBeTruthy();
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it('读不到配置（无权限 / 后端未启动）时退回占位，不编造引擎名', async () => {
    listMock.mockRejectedValue(new Error('403'));
    render(<Harness />);
    expect(await screen.findByText('未探测')).toBeTruthy();
  });
});

describe('AiChatInputBar 的 Enter —— 输入法候选期间不得发送', () => {
  const sendMock = vi.fn();
  const renderBar = () =>
    render(
      <AiChatInputBar
        inputText="主机振动偏高"
        setInputText={() => {}}
        isStreaming={false}
        isAiLoading={false}
        isRecording={false}
        recordingSeconds={0}
        isTranscribing={false}
        voiceNotice={null}
        onDismissVoiceNotice={() => {}}
        onStartVoiceRecording={() => {}}
        onStopVoiceRecording={() => {}}
        onToggleVoiceRecording={() => {}}
        onSendMessage={sendMock}
        onStopGeneration={() => {}}
      />
    );

  it('非组合输入状态下 Enter 发送', () => {
    sendMock.mockReset();
    renderBar();
    const ta = screen.getByRole('textbox');
    fireEvent.keyDown(ta, { key: 'Enter', code: 'Enter', isComposing: false });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('输入法候选未上屏时 Enter 只是选词，不得触发发送', () => {
    sendMock.mockReset();
    renderBar();
    const ta = screen.getByRole('textbox');
    // 先证明 jsdom 真的把 isComposing 透传到了原生事件，否则这条断言是空的
    let sawComposing: boolean | undefined;
    ta.addEventListener('keydown', (e) => {
      sawComposing = e.isComposing;
    });
    fireEvent.keyDown(ta, { key: 'Enter', code: 'Enter', isComposing: true });
    expect(sawComposing).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('Shift+Enter 换行不发送', () => {
    sendMock.mockReset();
    renderBar();
    const ta = screen.getByRole('textbox');
    fireEvent.keyDown(ta, { key: 'Enter', code: 'Enter', shiftKey: true, isComposing: false });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
