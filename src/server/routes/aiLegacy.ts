// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import { requireAuth } from "../middleware/auth.ts";
import { validateBody } from "../middleware/validate.ts";
import {
  aiChatSchema,
  aiDiagnoseSchema,
  aiVisionSchema,
  aiRagSearchSchema,
  suggestContributionSchema,
  multimodalSearchSchema,
} from "../schemas/ai.ts";
import {
  handleAiChat,
  handleAiSuggestContribution,
  handleAiDiagnose,
  handleAiVision,
  handleAiRagSearch,
} from "../controllers/aiLegacyController.ts";
import { handleAiMultimodalSearch } from "../controllers/aiVisionController.ts";

export function registerAiLegacyRoutes(app: express.Express) {
  // 兼容层鉴权：所有 legacy /api/ai/* 端点统一要求登录（JWT），防止匿名用户消耗 AI 额度；
  // 前端（Web 端 request()/小程序 request.js）与第三方调用均携带 Authorization: Bearer <token>
  app.post("/api/ai/chat", requireAuth, validateBody(aiChatSchema), handleAiChat);

  // AI 知识贡献识别（对话后判断是否沉淀为知识案例）
  app.post("/api/ai/suggest-contribution", requireAuth, validateBody(suggestContributionSchema), handleAiSuggestContribution);
  // 别名路由
  app.post("/api/v1/ai/suggest-contribution", requireAuth, validateBody(suggestContributionSchema), (req: any, res: any) => {
    return (app as any)._router.handle({ ...req, url: "/api/ai/suggest-contribution" }, res);
  });

  // AI 智能故障诊断向导 (Fault Diagnosis Wizard)
  app.post("/api/ai/diagnose", requireAuth, validateBody(aiDiagnoseSchema), handleAiDiagnose);

  // AI 图像识别与缺陷检测 (Vision Analysis)
  app.post("/api/ai/vision", requireAuth, validateBody(aiVisionSchema), handleAiVision);

  // AI 多模态检索（看图找相似案例）
  app.post("/api/ai/multimodal-search", requireAuth, validateBody(multimodalSearchSchema), handleAiMultimodalSearch);
  // 别名路由
  app.post("/api/v1/ai/multimodal-search", requireAuth, validateBody(multimodalSearchSchema), (req: any, res: any) => {
    return (app as any)._router.handle({ ...req, url: "/api/ai/multimodal-search" }, res);
  });

  // AI 知识库 RAG 语义检索 (RAG Semantic Search)
  // 说明：前端 Web/小程序均未调用此端点（前端走 /api/v1/knowledge/search），保留原因：
  // 已写入 openapi.ts 对外文档，供数字人/第三方集成方使用。2026-09-13 调用方评估结论。
  app.post("/api/ai/rag-search", requireAuth, validateBody(aiRagSearchSchema), handleAiRagSearch);
}
