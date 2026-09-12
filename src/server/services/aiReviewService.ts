// 重构说明：AI 生成内容审核台的写入服务——"加一道闸"而不改变生成接口行为：
// 写入失败时记日志并返回 null（fail-open），生成接口照常返回，仅缺少 reviewId。
import { randomUUID } from "crypto";
import { AiGenerationReviewRepository } from "../../db/repositories/index.ts";

export type AiReviewSourceType = "maintenance_plan" | "safety_risk" | "report" | "work_order_draft";

/**
 * 将一次 AI 生成结果登记为待审核记录（status=pending）。
 * 仅在 AI 原生成成功时调用（缓存命中与规则引擎降级内容不重复登记）。
 * @returns reviewId；登记失败返回 null（不阻断生成主流程）
 */
export async function createPendingAiReview(params: {
  aiEndpoint: string;
  sourceType: AiReviewSourceType;
  content: any;
  knowledgeSources?: string[];
}): Promise<string | null> {
  try {
    const id = `airev-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    await AiGenerationReviewRepository.create({
      id,
      aiEndpoint: params.aiEndpoint,
      sourceType: params.sourceType,
      contentJson: params.content,
      knowledgeSources: params.knowledgeSources || [],
    });
    return id;
  } catch (err: any) {
    // 审核台不可用不影响 AI 生成主流程（约束：审核只是加一道闸）
    console.error("[AI Review] 待审核记录写入失败（fail-open）:", err?.message || err);
    return null;
  }
}
