// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import { getDb } from "../../db/db.ts";
import { DASHSCOPE_CHAT_MODEL, DASHSCOPE_VISION_MODEL } from "../utils/config.ts";

export const handleGetAiStats = async (_req: any, res: any) => {
  try {
    const db = await getDb();
    const [artCount, fbCount, checkCount, auditCount] = await Promise.all([
      db.query<{ count: string }>("SELECT COUNT(*) as count FROM knowledge_articles;").catch(() => ({ rows: [{ count: "18" }] })),
      db.query<{ count: string }>("SELECT COUNT(*) as count FROM ai_feedback;").catch(() => ({ rows: [{ count: "6" }] })),
      db.query<{ count: string }>("SELECT COUNT(*) as count FROM compliance_checks;").catch(() => ({ rows: [{ count: "12" }] })),
      db.query<{ count: string }>("SELECT COUNT(*) as count FROM audit_logs WHERE module ILIKE '%AI%' OR action_type LIKE 'AI_%';").catch(() => ({ rows: [{ count: "48" }] })),
    ]);

    const baseInteractions = 186;
    const totalCalls = baseInteractions + Number(auditCount.rows[0]?.count || 0) + Number(fbCount.rows[0]?.count || 0) * 3;
    res.json({
      success: true,
      totalCalls,
      chatCalls: Math.round(totalCalls * 0.58),
      visionCalls: Math.round(totalCalls * 0.24),
      ragRetrievals: Math.round(totalCalls * 0.18),
      feedbackTotal: Number(fbCount.rows[0]?.count || 0),
      knowledgeArticles: Number(artCount.rows[0]?.count || 0),
      complianceChecks: Number(checkCount.rows[0]?.count || 0),
      models: {
        chat: DASHSCOPE_CHAT_MODEL,
        vision: DASHSCOPE_VISION_MODEL,
        embedding: "text-embedding-v3",
        asr: "paraformer-realtime-industrial",
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: "获取 AI 统计失败: " + err.message });
  }
};
