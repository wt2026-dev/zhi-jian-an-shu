import { useEffect, useState } from 'react';
import { adminAiModelApi, AiModelConfig } from '../../api';

/**
 * 挑出「当前应答引擎」：启用 + 具备 chat 能力 + priority 最小。
 * 顺序与后端 aiModelRouter.resolveCandidates 的故障切换顺序一致（priority 升序），
 * 所以这里显示的就是真正会先被调用的那个模型，不是列表里的第一条。
 */
export function pickPrimaryChatModel(configs: AiModelConfig[]): string | null {
  const chat = (configs || []).filter((c) => c.enabled && (c.capabilities || []).includes('chat'));
  if (chat.length === 0) return null;
  const primary = chat.slice().sort((a, b) => a.priority - b.priority)[0];
  // 探测明确失败时如实标注，避免把"配置在、上游挂了"显示成正常在线
  return primary.healthStatus === 'unhealthy' ? `${primary.displayName}（最近探测失败）` : primary.displayName;
}

/** 会话里还没有 AI 应答时的引擎名兜底：读真实模型配置，读不到（无权限 / 后端未启动）返回 null */
export function useAiEngineLabel(): string | null {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    adminAiModelApi
      .list()
      .then((configs) => {
        if (alive) setLabel(pickPrimaryChatModel(configs));
      })
      .catch(() => {
        if (alive) setLabel(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  return label;
}
