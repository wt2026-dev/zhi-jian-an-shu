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
function useAiEngineStatus(): AiEngineStatus | null {
  const [status, setStatus] = useState<AiEngineStatus | null>(null);

  useEffect(() => {
    let alive = true;
    aiEngineApi
      .get()
      .then((next) => {
        if (alive) setStatus(next);
      })
      .catch(() => {
        // 后端未启动 / 未配置：如实留空由界面显示占位，不编造引擎名
        if (alive) setStatus(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  return status;
}

export function useAiEngineLabel(): string | null {
  const status = useAiEngineStatus();
  return status ? formatEngineLabel(status) : null;
}

/**
 * 嵌在句子里用的短引擎名：去掉「（对话+视觉）」这类能力后缀，
 * 完整标签留给「当前应答引擎」状态位——标题里带着后缀会读成两句话。
 * 「最近探测失败」不是能力后缀，要原样留着，别把坏数据藏掉。
 */
export function useAiEngineShortLabel(): string | null {
  const status = useAiEngineStatus();
  if (!status?.displayName) return null;
  const short = status.displayName.replace(/（[^）]*）/g, '').trim();
  // 复用 formatEngineLabel 拼健康标记，避免两处各写一套「最近探测失败」口径
  return formatEngineLabel({ displayName: short, healthStatus: status.healthStatus });
}
