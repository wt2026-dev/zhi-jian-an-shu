// 视频生成进度口径：已耗时的起点、剩余时间区间、轮询上限。
//
// 为什么单独抽成模块：这段口径被写错过两次，且两次都是"看起来合理但严重误导"——
//   1) 已耗时用"本轮轮询开始时刻"当起点 → 刷新页面即归零
//      （实测事故：任务已跑 36 分钟，界面显示"已耗时 0秒"，用户以为卡死了）；
//   2) 剩余时间按"每段 4 分钟"折算 → 把最坏要跑 3.4 小时的任务说成"预计剩余约 29 分钟"。
// 抽成纯函数是为了能直接单测，不必再靠肉眼和线上表现去判断。

/** 单段生成实测最快耗时（英文 prompt 实测 262 秒完成，取整 4 分钟） */
export const SEG_FAST_SEC = 4 * 60;

/** 单段生成的上限：跑满 40 分钟轮询窗口才判超时（见 videoGenerationService.ts 的轮询窗口注释） */
export const SEG_SLOW_SEC = 40 * 60;

/** 段与段之间强制等待的 Agnes 限频时间 */
export const SEG_RATE_LIMIT_GAP_SEC = 65;

/**
 * 前端放弃轮询的上限。
 * 必须与后端全局超时 AGNES_TOTAL_TIMEOUT_MIN（默认 240 分钟）保持一致 ——
 * 原先前端 60 分钟就停轮询、后端却还能跑到 240 分钟，界面会先弹"仍在后台生成"而任务其实还在跑。
 */
export const MAX_POLL_SECONDS = 240 * 60;

/**
 * 估算多段任务的剩余时间区间（分钟）。
 *
 * 只给区间、不给单点值：单段耗时实测 4~40 分钟方差极大，任何单点估计都会说谎。
 * 下限 = 后续每段都取实测最快值；上限 = 当前段跑满轮询窗口 + 后续每段都跑满。
 *
 * @param currentSeg 当前正在生成的段序号（1 基，取自后端进度文案"第 N/M 段"）
 * @param totalSegs 总段数
 */
export function estimateRemainingMinutes(
  currentSeg: number,
  totalSegs: number
): { fast: number; slow: number } {
  const after = Math.max(0, totalSegs - currentSeg);
  return {
    fast: Math.round((after * (SEG_FAST_SEC + SEG_RATE_LIMIT_GAP_SEC)) / 60),
    slow: Math.ceil((after * (SEG_SLOW_SEC + SEG_RATE_LIMIT_GAP_SEC) + SEG_SLOW_SEC) / 60),
  };
}

/** 把毫秒数格式化为"X分Y秒"（不足 1 分钟只报秒） */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

/**
 * 解析"已耗时"的起点：优先采用后端返回的任务入库时间 createdAt。
 * 非法值或未来时间一律退回 fallbackMs（宁可少报，也不让耗时倒退或变成负数）。
 */
export function resolveTaskStartMs(createdAt: unknown, fallbackMs: number): number {
  const t =
    typeof createdAt === "string" || typeof createdAt === "number"
      ? new Date(createdAt as string | number).getTime()
      : NaN;
  if (!Number.isFinite(t) || t > Date.now()) return fallbackMs;
  return t;
}
