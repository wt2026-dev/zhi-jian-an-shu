// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
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
import { handleAiMultimodalSearch } from "../controllers/aiMultimodalController.ts";

export function registerAiLegacyRoutes(app: express.Express) {
  app.post("/api/ai/chat", validateBody(aiChatSchema), handleAiChat);

  // AI 知识贡献识别（对话后判断是否沉淀为知识案例）
  app.post("/api/ai/suggest-contribution", validateBody(suggestContributionSchema), handleAiSuggestContribution);
  // 别名路由
  app.post("/api/v1/ai/suggest-contribution", validateBody(suggestContributionSchema), (req: any, res: any) => {
    return (app as any)._router.handle({ ...req, url: "/api/ai/suggest-contribution" }, res);
  });

  // AI 智能故障诊断向导 (Fault Diagnosis Wizard)
  app.post("/api/ai/diagnose", validateBody(aiDiagnoseSchema), handleAiDiagnose);

  // AI 图像识别与缺陷检测 (Vision Analysis)
  app.post("/api/ai/vision", validateBody(aiVisionSchema), handleAiVision);

  // AI 多模态检索（看图找相似案例）
  app.post("/api/ai/multimodal-search", validateBody(multimodalSearchSchema), handleAiMultimodalSearch);
  // 别名路由
  app.post("/api/v1/ai/multimodal-search", validateBody(multimodalSearchSchema), (req: any, res: any) => {
    return (app as any)._router.handle({ ...req, url: "/api/ai/multimodal-search" }, res);
  });

  // AI 知识库 RAG 语义检索 (RAG Semantic Search)
  app.post("/api/ai/rag-search", validateBody(aiRagSearchSchema), handleAiRagSearch);
}
