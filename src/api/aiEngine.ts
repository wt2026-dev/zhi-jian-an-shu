import { request } from './client';

/**
 * 「当前应答引擎」只读状态。
 *
 * 为什么单独成一个域模块而不是往 `api/index.ts` 里加一段：那个桶文件正被逐刀切分，
 * 行数由 tests/godfile-ratchet.test.ts 按文件单独钉住，加一行就要动别人的基线。
 * 消费方（useAiEngineLabel）直接引这个模块，与本目录其它域模块同一依赖口径。
 */
export interface AiEngineStatus {
  /** 路由里是否真有可用候选（读不到候选是 false，不是"看起来在线"的默认值） */
  configured: boolean;
  displayName: string | null;
  modelName: string | null;
  provider: string | null;
  /** 最近一次连接探测结果；配置行没被探测过为 null */
  healthStatus: string | null;
  /** 具备 chat 能力的候选条数，用于说明降级链有多长 */
  chatCandidateCount: number;
}

export const aiEngineApi = {
  get: () => request<AiEngineStatus>('/ai/engine'),
};
