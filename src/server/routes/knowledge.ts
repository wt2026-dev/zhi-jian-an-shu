// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import { requireAuth, requireRole } from "../middleware/auth.ts";
import { validateBody, validateQuery } from "../middleware/validate.ts";
import {
  knowledgeQuerySchema,
  createKnowledgeSchema,
  uploadKnowledgeSchema,
  searchKnowledgeSchema,
  reviewListQuerySchema,
  rejectKnowledgeSchema,
  graphQuerySchema,
} from "../schemas/knowledge.ts";
import { feedbackSchema, submitContributionSchema } from "../schemas/ai.ts";
import {
  handleListKnowledge,
  handleCreateKnowledge,
  handleUploadKnowledge,
  handleSearchKnowledge,
  handleKnowledgeReviewList,
  handleKnowledgeApprove,
  handleKnowledgeReject,
  handleKnowledgeGraphExtract,
  handleKnowledgeGraph,
} from "../controllers/knowledgeController.ts";
import {
  handleCreateAiFeedback,
  handleListAiFeedback,
  handleAdoptAiFeedback,
  handleCreateContribution,
  handleListContributions,
  handleAdoptContribution,
  handleListAiReviews,
  handleApproveAiReview,
  handleRejectAiReview,
} from "../controllers/contributionController.ts";

export function registerKnowledgeRoutes(app: express.Express) {
  app.get("/api/v1/knowledge", validateQuery(knowledgeQuerySchema), handleListKnowledge);

  app.post("/api/v1/knowledge", requireAuth, validateBody(createKnowledgeSchema), handleCreateKnowledge);

  app.post("/api/v1/knowledge/upload", requireAuth, validateBody(uploadKnowledgeSchema), handleUploadKnowledge);

  app.post("/api/v1/knowledge/search", requireAuth, validateBody(searchKnowledgeSchema), handleSearchKnowledge);

  app.get("/api/v1/knowledge/review/list", requireAuth, requireRole(["admin", "archivist"], "知识审核"), validateQuery(reviewListQuerySchema), handleKnowledgeReviewList);
  app.post("/api/v1/knowledge/review/:id/approve", requireAuth, requireRole(["admin", "archivist"], "知识审核"), handleKnowledgeApprove);
  app.post("/api/v1/knowledge/review/:id/reject", requireAuth, requireRole(["admin", "archivist"], "知识审核"), validateBody(rejectKnowledgeSchema), handleKnowledgeReject);

  app.post("/api/v1/knowledge/graph/extract", requireAuth, requireRole(["admin", "archivist"], "知识图谱抽取"), handleKnowledgeGraphExtract);
  app.get("/api/v1/knowledge/graph", requireAuth, validateQuery(graphQuerySchema), handleKnowledgeGraph);

  app.post("/api/v1/ai/feedback", requireAuth, validateBody(feedbackSchema), handleCreateAiFeedback);
  app.get("/api/v1/ai/feedback", requireAuth, requireRole(["admin"], "查看 AI 纠错列表"), handleListAiFeedback);
  app.post("/api/v1/ai/feedback/:id/adopt", requireAuth, requireRole(["admin"], "采纳 AI 纠错"), handleAdoptAiFeedback);

  // ==================== 16.2 知识自进化贡献管理 (Knowledge Contributions) ====================
  // 用户提交沉淀案例（需登录态）
  app.post("/api/v1/ai/contributions", requireAuth, validateBody(submitContributionSchema), handleCreateContribution);

  // 管理端查看知识贡献列表 (列 pending)
  app.get("/api/v1/ai/contributions", requireAuth, requireRole(["admin"], "查看知识贡献审核列表"), handleListContributions);

  // 管理端采纳知识贡献 (采纳→写入 knowledge_articles 表，字段对齐)
  app.post("/api/v1/ai/contributions/:id/adopt", requireAuth, requireRole(["admin"], "采纳知识贡献"), handleAdoptContribution);

  // ==================== AI 生成内容审核台（管理端，仅管理员） ====================
  app.get("/api/v1/admin/ai-reviews", requireAuth, requireRole(["admin"], "查看 AI 生成内容审核列表"), handleListAiReviews);
  app.post("/api/v1/admin/ai-reviews/:id/approve", requireAuth, requireRole(["admin"], "审核通过 AI 生成内容"), handleApproveAiReview);
  app.post("/api/v1/admin/ai-reviews/:id/reject", requireAuth, requireRole(["admin"], "驳回 AI 生成内容"), handleRejectAiReview);
}

