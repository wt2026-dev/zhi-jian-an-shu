// @vitest-environment jsdom
/**
 * 「当前应答引擎：未连接」的两条真因守卫（2026-10-19 现场复现）。
 *
 * ① 引擎名原来只取"本会话已经答过话的那条消息上的 model"，所以每次刚进页面、
 *    还没问过 AI 时必然显示「未连接」—— 而模型路由里明明配着 healthy 的引擎。
 *    补的真实来源是 /api/v1/ai/engine：第一跳由后端按路由口径算，
 *    不是 /admin/ai-models（admin 专属，主管登录只会 403，非管理员永远看不到引擎名）。
 * ② 输入框的 Enter 处理没判 isComposing。中文输入法在候选未上屏时按 Enter 是
 *    "选词"，处理器照旧 preventDefault 会把候选提交一起吞掉，表现就是按了没反应、
 *    请求根本没发出去（服务端访问日志里那条时间窗确实一条 POST 都没有）。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiEngineStatus } from '../../src/api/aiEngine';

const getMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/api/aiEngine', () => ({ aiEngineApi: { get: getMock } }));

const { formatEngineLabel, useAiEngineLabel } = await import('../../src/components/ai/useAiEngineLabel');
const { AiChatInputBar } = await import('../../src/components/ai/AiChatInputBar');

const status = (over: Partial<AiEngineStatus> = {}): AiEngineStatus => ({
  configured: true,
  displayName: '占位模型',
  modelName: 'placeholder',
  provider: 'agnes',
  healthStatus: 'healthy',
  chatCandidateCount: 1,
  ...over,
});

const Harness = () => {
  const label = useAiEngineLabel();
  return <div data-testid="engine-label">{label ?? '未探测'}</div>;
};

afterEach(() => {
  cleanup();
  getMock.mockReset();
});

describe('formatEngineLabel —— 拿到投影字段后怎么说人话', () => {
  it('直接报后端算出的第一跳名字', () => {
    expect(formatEngineLabel(status({ displayName: '主用引擎' }))).toBe('主用引擎');
  });

  it('最近探测失败时如实标注，不伪装成在线', () => {
    expect(formatEngineLabel(status({ displayName: '主用引擎', healthStatus: 'unhealthy' }))).toBe(
      '主用引擎（最近探测失败）'
    );
    // unknown（刚播种还没测过）不加失败标记，避免把没数据说成坏数据
    expect(formatEngineLabel(status({ displayName: '主用引擎', healthStatus: 'unknown' }))).toBe('主用引擎');
  });

  it('configured:false（路由里没有可用候选）不编名字，交给界面显示占位', () => {
    expect(formatEngineLabel(status({ configured: false, displayName: null, healthStatus: null }))).toBeNull();
  });
});

describe('useAiEngineLabel —— 进页面就能报出真实引擎', () => {
  it('读到引擎状态后显示主用引擎名（而不是「未连接」）', async () => {
    getMock.mockResolvedValue(status({ displayName: 'Agnes 2.5 Flash（对话+视觉）' }));
    render(<Harness />);
    expect(await screen.findByText('Agnes 2.5 Flash（对话+视觉）')).toBeTruthy();
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('读不到（后端未启动 / 请求失败）时退回占位，不编造引擎名', async () => {
    getMock.mockRejectedValue(new Error('ECONNREFUSED'));
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
