import { useEffect, useState } from 'react';
import { equipmentApi, knowledgeApi } from '../../api';

export type SourceStatus = 'checking' | 'online' | 'offline';

export interface SourceConnectivity {
  knowledge: SourceStatus;
  telemetry: SourceStatus;
}

/**
 * 问候卡两枚状态标签的依据：各打一次真实读接口，取到数据才算「已连接」，
 * 取不到就如实标不可达 —— 不能用固定文案冒充在线状态。
 */
export function useSourceConnectivity(): SourceConnectivity {
  const [status, setStatus] = useState<SourceConnectivity>({ knowledge: 'checking', telemetry: 'checking' });

  useEffect(() => {
    let alive = true;
    const mark = (key: keyof SourceConnectivity, ok: boolean) => {
      if (alive) setStatus((prev) => ({ ...prev, [key]: ok ? 'online' : 'offline' }));
    };
    knowledgeApi.list().then(
      () => mark('knowledge', true),
      () => mark('knowledge', false),
    );
    equipmentApi.list().then(
      () => mark('telemetry', true),
      () => mark('telemetry', false),
    );
    return () => {
      alive = false;
    };
  }, []);

  return status;
}
