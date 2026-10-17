// @vitest-environment jsdom
/**
 * AI 悬浮助手「头部三个按钮点不动」的回归守卫。
 *
 * 头部整条是拖拽区，onPointerDown 里对头部调了 setPointerCapture（为了划过
 * Godot iframe 时拖拽不断流）。但朗读 / 最小化 / 关闭三个按钮也在头部里：
 * 浏览器一旦建立指针捕获，后续 pointerup 与由它派生的 click 都会被重定向到
 * 捕获元素（头部本身），按钮的 onClick 永远不触发 —— 表现就是"点关闭没反应"。
 *
 * 所以钉两件事：
 *   ① 指针按在按钮上：不得捕获指针、不得启动拖拽，click 要能走到 closePanel；
 *   ② 指针按在头部的非按钮区域：必须照旧捕获指针（跨 iframe 拖拽不能退化）。
 * jsdom 不实现指针捕获的重定向，所以这里断言的是"是否调用 setPointerCapture"
 * 这一根因，而不是模拟重定向后的 click 归属。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  closePanel: vi.fn(),
  openPanel: vi.fn(),
  toggleSpeech: vi.fn(),
  stopGeneration: vi.fn(),
  stopSpeaking: vi.fn(),
  sendMessage: vi.fn(),
  toggleVoiceRecording: vi.fn(),
  clearPrefill: vi.fn(),
  setVoiceNotice: vi.fn(),
}));

vi.mock('../../src/context/AiChatContext', () => ({
  useAiChatContext: () => ({
    panelOpen: true,
    messages: [{ id: 'm1', sender: 'assistant', content: '你好', timestamp: '2026-09-21T10:00:00.000Z' }],
    followups: [],
    isStreaming: false,
    isLoading: false,
    isSpeaking: false,
    isRecording: false,
    isTranscribing: false,
    recordingSeconds: 0,
    speechEnabled: true,
    voiceNotice: null,
    prefill: '',
    prefillSeq: 0,
    closePanel: mocks.closePanel,
    openPanel: mocks.openPanel,
    toggleSpeech: mocks.toggleSpeech,
    stopGeneration: mocks.stopGeneration,
    stopSpeaking: mocks.stopSpeaking,
    sendMessage: mocks.sendMessage,
    toggleVoiceRecording: mocks.toggleVoiceRecording,
    clearPrefill: mocks.clearPrefill,
    setVoiceNotice: mocks.setVoiceNotice,
  }),
}));

import { AiAssistantPanel } from '../../src/components/AiAssistantPanel';

/** jsdom 没有 Pointer Capture，手动挂一个可计数的桩。 */
let captureCalls: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  captureCalls = [];
  // jsdom 既没有 scrollIntoView 也没有 Pointer Capture，两个都要自己挂。
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.setPointerCapture = function (this: Element) {
    captureCalls.push(this.tagName + (this.getAttribute('title') ? `:${this.getAttribute('title')}` : ''));
  };
});
afterEach(() => cleanup());

const press = (el: HTMLElement) => fireEvent.pointerDown(el, { pointerId: 7, clientX: 100, clientY: 100, bubbles: true });

describe('AI 助手头部按钮与拖拽区的指针捕获互斥', () => {
  it('按在「关闭面板」上不捕获指针，click 能关面板', () => {
    render(<AiAssistantPanel />);
    const closeBtn = screen.getByTitle('关闭面板');
    press(closeBtn);
    expect(captureCalls).toEqual([]);
    fireEvent.click(closeBtn);
    expect(mocks.stopGeneration).toHaveBeenCalledTimes(1);
    expect(mocks.closePanel).toHaveBeenCalledTimes(1);
  });

  it('按在「最小化」「语音朗读」上同样不捕获指针', () => {
    render(<AiAssistantPanel />);
    const minBtn = screen.getByTitle('最小化（收起为悬浮球）');
    press(minBtn);
    fireEvent.click(minBtn);
    expect(captureCalls).toEqual([]);
    expect(mocks.closePanel).toHaveBeenCalledTimes(1);

    const speechBtn = screen.getByTitle('关闭语音朗读');
    press(speechBtn);
    fireEvent.click(speechBtn);
    expect(captureCalls).toEqual([]);
    expect(mocks.toggleSpeech).toHaveBeenCalledTimes(1);
  });

  it('按在头部的非按钮区域仍然捕获指针（跨 iframe 拖拽不退化）', () => {
    render(<AiAssistantPanel />);
    // 只匹配"品牌后缀"这一段，不锁死 persona 名字与品牌全称：
    // 品牌文案由 866b89b 从「AI 助手」改为「智检安枢 AI 助手」，此处用正则避免再次漂移。
    press(screen.getByText(/·\s*智检安枢 AI 助手$/));
    expect(captureCalls.length).toBe(1);
  });
});
