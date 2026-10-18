// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiAssistantHeader } from '../../src/components/ai/AiAssistantHeader';
import { AiChatMessagesList } from '../../src/components/ai/AiChatMessagesList';
import { AiChatInputBar } from '../../src/components/ai/AiChatInputBar';
import { AiFeedbackModal } from '../../src/components/ai/AiFeedbackModal';
import { ChatMessage } from '../../src/hooks/useAiChat';
import { UserProfile } from '../../src/types';

describe('AiAssistantView 模块化子组件单元测试', () => {
  afterEach(cleanup);

  const mockUser: UserProfile = {
    id: 'u-eng',
    name: '张工',
    role: 'technician',
    roleTitle: '检修专家',
    department: '动设备车间',
    phone: '13800000000',
  };

  it('AiAssistantHeader 正确渲染模式切换与引擎指示器', () => {
    const onModeChange = vi.fn();
    render(
      <AiAssistantHeader
        activeMode="chat"
        onModeChange={onModeChange}
        latestAiModel="DashScope Qwen-Plus"
      />
    );

    expect(screen.getByText('智检安枢 · 工业检修AI助手')).toBeDefined();
    expect(screen.getByText('DashScope Qwen-Plus')).toBeDefined();

    const diagBtn = screen.getByText('故障诊断向导');
    fireEvent.click(diagBtn);
    expect(onModeChange).toHaveBeenCalledWith('diagnose');
  });

  it('AiChatMessagesList 正确渲染消息列表与 AI 专家楷体标识', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg-1',
        sender: 'user',
        text: '减速机轴承温升异常',
        timestamp: '10:00:00',
      },
      {
        id: 'msg-2',
        sender: 'assistant',
        text: '建议按五步排查润滑与同轴度',
        timestamp: '10:00:05',
      },
    ];

    const onSendMessage = vi.fn();
    const onCopyMessage = vi.fn();
    const onRegenerate = vi.fn();
    const onOpenFeedbackModal = vi.fn();

    render(
      <AiChatMessagesList
        messages={messages}
        currentUser={mockUser}
        isSpeaking={false}
        isStreaming={false}
        isAiLoading={false}
        copiedMessageId={null}
        feedbackNotice={null}
        followups={['如何测量同轴度？']}
        loadingFollowups={false}
        contributionSuggestion={null}
        isSubmittingContribution={false}
        contributionNotice={null}
        chatBottomRef={{ current: null }}
        onSendMessage={onSendMessage}
        onRegenerate={onRegenerate}
        onCopyMessage={onCopyMessage}
        onOpenFeedbackModal={onOpenFeedbackModal}
        onDismissContribution={vi.fn()}
        onSubmitContribution={vi.fn()}
      />
    );

    // AI 专家楷体 "智" 标识
    expect(screen.getByText('智')).toBeDefined();
    // 用户角色首字
    expect(screen.getByText('检')).toBeDefined();
    // 消息内容
    expect(screen.getByText('减速机轴承温升异常')).toBeDefined();
    expect(screen.getByText('建议按五步排查润滑与同轴度')).toBeDefined();

    // 纠错按钮
    const feedbackBtn = screen.getByText('标记/纠错');
    fireEvent.click(feedbackBtn);
    expect(onOpenFeedbackModal).toHaveBeenCalledWith(messages[1]);
  });

  it('AiChatInputBar 快捷指令填入与发送触发', () => {
    let text = '';
    const setInputText = vi.fn((val) => {
      text = typeof val === 'function' ? val(text) : val;
    });
    const onSendMessage = vi.fn();

    render(
      <AiChatInputBar
        inputText={text}
        setInputText={setInputText}
        isStreaming={false}
        isAiLoading={false}
        isRecording={false}
        recordingSeconds={0}
        isTranscribing={false}
        voiceNotice={null}
        onDismissVoiceNotice={vi.fn()}
        onStartVoiceRecording={vi.fn()}
        onStopVoiceRecording={vi.fn()}
        onToggleVoiceRecording={vi.fn()}
        onSendMessage={onSendMessage}
        onStopGeneration={vi.fn()}
      />
    );

    // 快捷指令按钮
    const chip = screen.getByText('泵轴温76°C抖动异响');
    fireEvent.click(chip);
    expect(setInputText).toHaveBeenCalledWith(
      '2号循环泵轴承箱温度升至76度，出口压力表剧烈抖动，伴随金属干摩擦异响，请排查游隙'
    );
  });

  it('AiFeedbackModal 专家评星与纠错提交交互', () => {
    const onRatingChange = vi.fn();
    const onCorrectionChange = vi.fn();
    const onSubmit = vi.fn();
    const onClose = vi.fn();

    const state = {
      isOpen: true,
      message: {
        id: 'msg-ai-1',
        sender: 'assistant' as const,
        text: '错误结论：建议直接开机',
        timestamp: '10:00:00',
      },
      userQuery: '设备异响怎么办？',
      correction: '必须先停机上锁 LOTO',
      rating: 1,
      submitting: false,
      error: null,
    };

    render(
      <AiFeedbackModal
        state={state}
        onClose={onClose}
        onRatingChange={onRatingChange}
        onCorrectionChange={onCorrectionChange}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByText('AI 回答专家纠错与知识沉淀标注')).toBeDefined();
    expect(screen.getByText('严重错误 / 存在安全隐患')).toBeDefined();

    const submitBtn = screen.getByText('提交专家纠错标注');
    fireEvent.click(submitBtn);
    expect(onSubmit).toHaveBeenCalled();
  });
});
