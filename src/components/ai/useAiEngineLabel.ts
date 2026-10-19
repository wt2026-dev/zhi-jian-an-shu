import { useEffect, useState } from 'react';
import { AiEngineStatus, aiEngineApi } from '../../api/aiEngine';

/**
 * 引擎名与探测状态拼成一句人话。
 * 「最近探测失败」这类判断留在这里：后端只投影字段，界面决定怎么说。
 * unknown（刚播种还没测过）不加失败标记，避免把没数据说成坏数据。
 */
export function formatEngineLabel(status: Pick<AiEngineStatus, 'displayName' | 'healthStatus'>): string | null {
  if (!status.displayName) return null;
  return status.healthStatus === 'unhealthy' ? `${status.displayName}（最近探测失败）` : status.displayName;
}

/**
 * 会话里还没有 AI 应答时的引擎名兜底：读真实模型路由的第一跳。
 * 走 /api/v1/ai/engine 而不是 /admin/ai-models，后者是 admin 专属，
 * 主管/操作员登录时只会 403，角标就永远停在「未探测」。
 */
export function useAiEngineLabel(): string | null {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    aiEngineApi
      .get()
      .then((status) => {
        if (alive) setLabel(formatEngineLabel(status));
      })
      .catch(() => {
        // 后端未启动 / 未配置：如实留空由界面显示占位，不编造引擎名
        if (alive) setLabel(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  return label;
}
