// @vitest-environment jsdom
/**
 * 问候卡上「知识库 / 设备遥测中枢」两枚状态标签与问候语真实化的守卫。
 *
 * 这两枚标签原先是写死的 `· 已连接` + 绿色呼吸点：后端哪怕挂了它也照样亮绿，
 * 与主对话页的「当前应答引擎：未连接」是同一类假读数（一个是假阴性，这两个是假阳性）。
 * 现在状态由 useSourceConnectivity 打真实读接口决定，所以三种状态都要钉：
 *   ① 探测通过才允许出现「已连接」和呼吸点；
 *   ② 探测失败要出现「无法连接」，且**不得**再出现「已连接工厂知识库」这句话（反空断言）；
 *   ③ 还没回来时是「检测中」，不能有呼吸点冒充在线。
 */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  knowledgeList: vi.fn(),
  equipmentList: vi.fn(),
}));

vi.mock('../../src/api', () => ({
  knowledgeApi: { list: apiMocks.knowledgeList },
  equipmentApi: { list: apiMocks.equipmentList },
}));

const { AiChatMessagesList } = await import('../../src/components/ai/AiChatMessagesList');
const { useSourceConnectivity } = await import('../../src/components/ai/useSourceConnectivity');

const INIT_MESSAGE = [
  {
    id: 'm-init',
    sender: 'assistant' as const,
    text: '你好',
    timestamp: '2026-10-19T16:20:00.000Z',
  },
];

function renderGreetingCard(sourceStatus: { knowledge: any; telemetry: any }) {
  return render(
    <AiChatMessagesList
      messages={INIT_MESSAGE as any}
      sourceStatus={sourceStatus as any}
      currentUser={{ id: 'u-admin', username: 'admin', name: '陈建平', role: 'admin' } as any}
      isSpeaking={false}
      isStreaming={false}
      isAiLoading={false}
      copiedMessageId={null}
      feedbackNotice={null}
      followups={[]}
      loadingFollowups={false}
      contributionSuggestion={null}
      isSubmittingContribution={false}
      contributionNotice={null}
      chatBottomRef={{ current: null }}
      onSendMessage={vi.fn()}
      onRegenerate={vi.fn()}
      onCopyMessage={vi.fn()}
      onOpenFeedbackModal={vi.fn()}
      onDismissContribution={vi.fn()}
      onSubmitContribution={vi.fn()}
    />
  );
}

describe('问候卡数据源状态标签', () => {
  it('两路都探测通过：标签写「已连接」并保留绿色呼吸点，问候语照旧', () => {
    const { container } = renderGreetingCard({ knowledge: 'online', telemetry: 'online' });
    const text = container.textContent || '';
    expect(text).toContain('知识库 · 已连接');
    expect(text).toContain('设备遥测中枢 · 已连接');
    expect(text).toContain('已连接工厂知识库与设备遥测中枢');
    // 呼吸点只有两枚标签各一个，别处不该再多出「在线」指示
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(2);
  });

  it('知识库探测失败：该标签改「无法连接」，问候语不得再声称已连接它', () => {
    const { container } = renderGreetingCard({ knowledge: 'offline', telemetry: 'online' });
    const text = container.textContent || '';
    expect(text).toContain('知识库 · 无法连接');
    expect(text).toContain('设备遥测中枢 · 已连接');
    expect(text).toContain('工厂知识库当前无法连接，回答可能不完整');
    expect(text).not.toContain('已连接工厂知识库与设备遥测中枢');
    expect(text).not.toContain('知识库 · 已连接');
    // 挂掉的那一枚不能还在呼吸（绿色在线的观感）
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(1);
  });

  it('两路都失败：点名两个数据源都不可达', () => {
    const { container } = renderGreetingCard({ knowledge: 'offline', telemetry: 'offline' });
    const text = container.textContent || '';
    expect(text).toContain('工厂知识库与设备遥测中枢当前无法连接');
    expect(text).not.toContain('已连接');
  });

  it('探测未回来时是「检测中」，不允许提前挂绿色呼吸点', () => {
    const { container } = renderGreetingCard({ knowledge: 'checking', telemetry: 'checking' });
    const text = container.textContent || '';
    expect(text).toContain('知识库 · 检测中');
    expect(text).toContain('设备遥测中枢 · 检测中');
    expect(text).toContain('正在确认工厂知识库与设备遥测中枢的连通状态');
    expect(text).not.toContain('已连接工厂知识库');
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
  });
});

describe('useSourceConnectivity 用真实读接口定性', () => {
  const hookCase = async (knowledgeResult: 'ok' | 'fail', equipmentResult: 'ok' | 'fail') => {
    apiMocks.knowledgeList.mockReturnValue(
      knowledgeResult === 'ok' ? Promise.resolve([{ id: 'k1' }]) : Promise.reject(new Error('后端未启动'))
    );
    apiMocks.equipmentList.mockReturnValue(
      equipmentResult === 'ok' ? Promise.resolve([{ id: 'eq-102' }]) : Promise.reject(new Error('后端未启动'))
    );

    const { result } = renderHookSimple(() => useSourceConnectivity());
    // 请求发出前的初值必须是「检测中」，不能先亮绿再改口
    expect(result.current).toEqual({ knowledge: 'checking', telemetry: 'checking' });

    await vi.waitFor(() => {
      expect(result.current.knowledge !== 'checking' && result.current.telemetry !== 'checking').toBe(true);
    });
    return result.current;
  };

  it('两路都取到数据才判 online', async () => {
    expect(await hookCase('ok', 'ok')).toEqual({ knowledge: 'online', telemetry: 'online' });
    expect(apiMocks.knowledgeList).toHaveBeenCalledTimes(1);
    expect(apiMocks.equipmentList).toHaveBeenCalledTimes(1);
  });

  it('任一路失败只影响自己那一枚，不互相带崩', async () => {
    expect(await hookCase('fail', 'ok')).toEqual({ knowledge: 'offline', telemetry: 'online' });
    expect(await hookCase('ok', 'fail')).toEqual({ knowledge: 'online', telemetry: 'offline' });
  });
});

/**
 * 不引 @testing-library/react 的 renderHook（本仓未装该入口），
 * 用一次最小渲染 + state 快照拿返回值；hook 自身只依赖 useEffect。
 */
function renderHookSimple<T>(hook: () => T): { result: { current: T } } {
  const result = { current: undefined as unknown as T };
  const Harness: React.FC = () => {
    result.current = hook();
    return null;
  };
  render(<Harness />);
  return { result };
}
