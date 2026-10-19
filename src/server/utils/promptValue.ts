/**
 * 提示词里的"缺测"措辞。
 *
 * 为什么需要这个函数：`${eq.healthScore}` 在 healthScore 为 null 时会拼出**字面量 `null`**，
 * 而这段文本会原样进 AI 提示词。模型看到 `健康分: null` 有两种糟糕反应 ——
 * 要么当成 0 分（"设备状况极差"），要么自行猜一个数。两者都是编造，且都发生在
 * 用户看不见的地方（报告正文/诊断结论里）。
 *
 * 所以凡是往提示词里插这类可空数值，都走这里：有值写值，没有值就**明说未评估**，
 * 让模型陈述缺失，而不是补一个数。
 */
export function scoreOrUnscored(
  score: number | null | undefined,
  opts?: { withUnit?: boolean; missingHint?: string }
): string {
  if (typeof score === "number" && Number.isFinite(score)) {
    return opts?.withUnit === false ? String(score) : `${score}分`;
  }
  return opts?.missingHint ?? "未评估（无健康评估记录，不得据此推断设备状况）";
}
