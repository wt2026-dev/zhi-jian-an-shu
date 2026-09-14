// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import { createEmbedding } from "../services/aiClient.ts";
import { getDb } from "../../db/db.ts";
import { KnowledgeRepository } from "../../db/repositories/index.ts";
import { addAuditLog } from "../services/auditService.ts";

// POST /api/v1/ai/feedback
export const handleCreateAiFeedback = async (req: any, res: any) => {
  const db = await getDb(), id = `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const b = req.body;
  await db.query("INSERT INTO ai_feedback (id,chat_id,model_response,user_correction,corrected_content,device_id,status) VALUES ($1,$2,$3,$4,$5,$6,'pending')", [id, b.chatId, b.model_response || null, b.user_correction, b.corrected_content, b.device_id || null]);
  res.status(201).json({ success: true, id, status: "pending" });
};

// GET /api/v1/ai/feedback
export const handleListAiFeedback = async (req: any, res: any) => {
  const db = await getDb();
  const status = req.query.status || "pending";
  const { rows } = await db.query("SELECT * FROM ai_feedback WHERE status=$1 ORDER BY created_at DESC", [status]);
  res.json(rows);
};

// POST /api/v1/ai/feedback/:id/adopt
export const handleAdoptAiFeedback = async (req: any, res: any) => {
  const db = await getDb(); const { rows } = await db.query("SELECT * FROM ai_feedback WHERE id=$1 AND status='pending'", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "待采纳纠错不存在" });
  const f = rows[0], article = { id: `kb-feedback-${Date.now()}`, title: `AI 纠错沉淀：${f.chat_id}`, category: "AI纠错知识", targetEquipment: f.device_id || "通用设备", tags: ["AI纠错", "人工确认"], summary: String(f.user_correction).slice(0, 150), content: f.corrected_content, author: req.currentUser.name, updatedAt: new Date().toLocaleDateString("zh-CN"), fileType: "feedback", chunksCount: 1, status: "pending" };
  try { (article as any).embedding = await createEmbedding(`${article.title}\n${article.content}`); } catch (err: any) { return res.status(502).json({ error: "修正知识向量生成失败，未采纳", message: err.message }); }
  await KnowledgeRepository.create(article); await db.query("UPDATE ai_feedback SET status='adopted' WHERE id=$1", [f.id]);
  res.json({ success: true, article });
};

// ==================== 16.2 知识自进化贡献管理 (Knowledge Contributions) ====================
// 用户提交沉淀案例（需登录态）
// POST /api/v1/ai/contributions
export const handleCreateContribution = async (req: any, res: any) => {
  try {
    const db = await getDb();
    const { id, chatId, title, type = "故障案例", equipment = "通用设备", summary = "", solution = "" } = req.body;
    const contributor = req.currentUser?.name || "检修工程师";

    if (id) {
      const { rowCount } = await db.query(
        `UPDATE ai_knowledge_contributions
         SET title = $1, type = $2, equipment = $3, summary = $4, solution = $5, contributor = $6, status = 'pending'
         WHERE id = $7`,
        [title, type, equipment, summary, solution, contributor, id]
      );
      if (rowCount && rowCount > 0) {
        return res.json({ success: true, id, message: "已提交，待知识管理员审核" });
      }
    }

    const newId = id || `kc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newChatId = chatId || `chat-${Date.now()}`;
    await db.query(
      `INSERT INTO ai_knowledge_contributions (id, chat_id, title, type, equipment, summary, solution, contributor, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
      [newId, newChatId, title, type, equipment, summary, solution, contributor]
    );
    return res.status(201).json({ success: true, id: newId, message: "已提交，待知识管理员审核" });
  } catch (err: any) {
    console.error("Submit contribution error:", err);
    return res.status(500).json({ success: false, error: "提交知识案例失败: " + err.message });
  }
};

// 管理端查看知识贡献列表 (列 pending)
// GET /api/v1/ai/contributions
export const handleListContributions = async (req: any, res: any) => {
  try {
    const db = await getDb();
    const status = req.query.status || "pending";
    const { rows } = await db.query(
      "SELECT * FROM ai_knowledge_contributions WHERE status = $1 ORDER BY created_at DESC",
      [status]
    );
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: "获取知识贡献列表失败: " + err.message });
  }
};

// 管理端采纳知识贡献 (采纳→写入 knowledge_articles 表，字段对齐)
// POST /api/v1/ai/contributions/:id/adopt
export const handleAdoptContribution = async (req: any, res: any) => {
  try {
    const db = await getDb();
    const { rows } = await db.query(
      "SELECT * FROM ai_knowledge_contributions WHERE id = $1 AND status = 'pending'",
      [req.params.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "待采纳知识贡献不存在或已被采纳" });
    }

    const c = rows[0];
    const article: any = {
      id: `kb-contrib-${Date.now()}`,
      title: c.title || "工业设备检修实践经验",
      category: c.type || "故障案例",
      targetEquipment: c.equipment || "通用工业机组",
      tags: ["知识贡献", c.type || "故障案例", "AI自进化"],
      summary: c.summary || (c.solution ? c.solution.slice(0, 150) : ""),
      content: `### 故障案例与处置方案\n\n**适用设备**: ${c.equipment || "通用设备"}\n**案例类型**: ${c.type || "故障案例"}\n**问题摘要**: ${c.summary || ""}\n\n#### 核心解决方案与检修要点\n${c.solution || ""}\n\n---\n*由现场检修工程师与AI问答协同生成，经知识管理员审核采纳沉淀为企业标准规程。*`,
      author: req.currentUser.name || "知识管理员",
      updatedAt: new Date().toLocaleDateString("zh-CN"),
      fileType: "case",
      chunksCount: 1,
      status: "approved",
    };

    try {
      article.embedding = await createEmbedding(`${article.title}\n${article.content}`);
    } catch (embErr: any) {
      console.warn("Embedding creation fallback during contribution adoption:", embErr?.message);
    }

    await KnowledgeRepository.create(article);
    await db.query("UPDATE ai_knowledge_contributions SET status = 'adopted' WHERE id = $1", [c.id]);
    return res.json({ success: true, article });
  } catch (err: any) {
    console.error("Adopt contribution error:", err);
    return res.status(500).json({ error: "采纳知识贡献失败: " + err.message });
  }
};

// ==================== AI 生成内容审核台（管理端） ====================

const AI_REVIEW_SOURCE_LABELS: Record<string, string> = {
  maintenance_plan: "检修方案",
  safety_risk: "作业风险评估",
  report: "AI 报告",
  work_order_draft: "工单草稿",
};

// GET /api/v1/admin/ai-reviews?status=pending|approved|rejected
export const handleListAiReviews = async (req: any, res: any) => {
  try {
    const { AiGenerationReviewRepository } = await import("../../db/repositories/index.ts");
    const reviews = await AiGenerationReviewRepository.list({
      status: req.query.status || undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    // 知识库溯源：将 knowledge_sources 的文章 id 补充为标题与摘录片段
    const { rows } = await getDb().then((db) => db.query(`SELECT id, title, category, summary FROM knowledge_articles;`));
    const kbMap = Object.fromEntries(rows.map((r: any) => [r.id, r]));
    res.json(
      reviews.map((r: any) => ({
        ...r,
        sourceTypeLabel: AI_REVIEW_SOURCE_LABELS[r.sourceType] || r.sourceType,
        knowledgeRefs: (r.knowledgeSources || [])
          .map((id: string) => kbMap[id])
          .filter(Boolean)
          .map((k: any) => ({ id: k.id, title: k.title, category: k.category, excerpt: (k.summary || "").slice(0, 160) })),
      }))
    );
  } catch (err: any) {
    res.status(500).json({ error: "获取 AI 生成审核列表失败", message: err.message });
  }
};

// POST /api/v1/admin/ai-reviews/:id/approve
export const handleApproveAiReview = async (req: any, res: any) => {
  try {
    const { AiGenerationReviewRepository } = await import("../../db/repositories/index.ts");
    const reviewer = req.currentUser?.name || req.currentUser?.username || "admin";
    const updated = await AiGenerationReviewRepository.review(req.params.id, {
      status: "approved",
      reviewer,
      note: req.body?.review_note,
    });
    if (!updated) {
      return res.status(404).json({ error: "审核记录不存在或已审核（仅 pending 状态可审核）" });
    }
    addAuditLog(req, {
      actionType: "AI_REVIEW_APPROVE",
      module: "AI 内容审核",
      detail: `AI 生成内容审核通过 (${updated.sourceType}, ${updated.aiEndpoint})`,
      status: "SUCCESS",
      metadata: { reviewId: updated.id, sourceType: updated.sourceType },
    });
    res.json({ success: true, review: updated });
  } catch (err: any) {
    res.status(500).json({ error: "审核通过操作失败", message: err.message });
  }
};

// POST /api/v1/admin/ai-reviews/:id/reject
export const handleRejectAiReview = async (req: any, res: any) => {
  try {
    const { AiGenerationReviewRepository } = await import("../../db/repositories/index.ts");
    const reviewer = req.currentUser?.name || req.currentUser?.username || "admin";
    const note = req.body?.review_note || "";
    if (!note.trim()) {
      return res.status(400).json({ error: "驳回必须填写原因 (review_note)", code: "INVALID_INPUT" });
    }
    const updated = await AiGenerationReviewRepository.review(req.params.id, {
      status: "rejected",
      reviewer,
      note,
    });
    if (!updated) {
      return res.status(404).json({ error: "审核记录不存在或已审核（仅 pending 状态可审核）" });
    }
    addAuditLog(req, {
      actionType: "AI_REVIEW_REJECT",
      module: "AI 内容审核",
      detail: `AI 生成内容审核驳回 (${updated.sourceType}): ${note.slice(0, 80)}`,
      status: "SUCCESS",
      metadata: { reviewId: updated.id, sourceType: updated.sourceType, note: note.slice(0, 200) },
    });
    res.json({ success: true, review: updated });
  } catch (err: any) {
    res.status(500).json({ error: "审核驳回操作失败", message: err.message });
  }
};
