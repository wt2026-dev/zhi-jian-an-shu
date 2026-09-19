// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import { requireAuth, requireRole } from "../middleware/auth.ts";
import { validateBody } from "../middleware/validate.ts";
import { getBudgetUsage } from "../services/aiClient.ts";
import {
  aiChatSchema,
  aiDiagnoseSchema,
  suggestContributionSchema,
  multimodalSearchSchema,
  aiRagSearchSchema,
  visionDefectDetectSchema,
  speechToTextSchema,
  generateWorkOrderAiSchema,
  rootCauseAnalysisSchema,
  generateMaintenancePlanSchema,
  healthForecastSchema,
  generateReportSchema,
  safetyRiskAssessmentSchema,
  suggestFollowupsSchema,
  equipmentSummarySchema,
  recommendAssigneeSchema,
  alarmCorrelationSchema,
  pipelineCreateSchema,
} from "../schemas/ai.ts";
import {
  handleAiChat,
  handleAiChatStream,
  handleSuggestFollowups,
  handleEquipmentSummary,
  handleRecommendAssignee,
  handleAlarmCorrelation,
  handleAiRagSearch,
  handleGetAiStats,
} from "../controllers/aiAssistantController.ts";
import { handleVisionDefectDetect, handleSpeechToText, handleVideoAnalysis, handleAiMultimodalSearch } from "../controllers/aiVisionController.ts";
import {
  handleGenerateWorkOrder,
  handleRootCauseAnalysis,
  handleGenerateMaintenancePlan,
  handleAiDiagnose,
} from "../controllers/aiGenerationController.ts";
import { handleAiSuggestContribution } from "../controllers/contributionController.ts";
import { handleHealthForecast, handleGenerateReport, handleSafetyRiskAssessment } from "../controllers/aiForecastController.ts";
import { handleCreatePipeline, handleGetPipeline, handlePipelineEvents, handleListPipeline } from "../controllers/aiPipelineController.ts";

// ==================== AI 统计与 v1 功能路由（自 server.ts 拆出，保持原相对顺序） ====================
export function registerAiRoutes(app: express.Express) {
  // AI 统计
  app.get("/api/v1/ai-stats", requireAuth, handleGetAiStats);
  app.get("/api/v1/admin/ai-stats", requireAuth, handleGetAiStats);

  // ---------- AI 每日预算状态（仅 admin 可见） ----------
  app.get("/api/v1/ai/budget", requireAuth, requireRole(["admin"], "查看 AI 预算"), (_req: any, res: any) => {
    res.json(getBudgetUsage());
  });

  // AI 对话
  app.post("/api/v1/ai/chat", requireAuth, validateBody(aiChatSchema), handleAiChat);

  // AI 智能故障诊断向导 (Fault Diagnosis Wizard)
  app.post("/api/v1/ai/diagnose", requireAuth, validateBody(aiDiagnoseSchema), handleAiDiagnose);

  // AI 知识贡献识别（对话后判断是否沉淀为知识案例）
  app.post("/api/v1/ai/suggest-contribution", requireAuth, validateBody(suggestContributionSchema), handleAiSuggestContribution);

  // 阿里云 DashScope / 通义千问 Qwen-VL 工业视觉缺陷深度识别链路
  app.post("/api/v1/ai/vision-defect-detect", validateBody(visionDefectDetectSchema), handleVisionDefectDetect);

  // AI 多模态检索（看图找相似案例）
  app.post("/api/v1/ai/multimodal-search", requireAuth, validateBody(multimodalSearchSchema), handleAiMultimodalSearch);

  // AI 知识库 RAG 语义检索 (RAG Semantic Search)
  app.post("/api/v1/ai/rag-search", requireAuth, validateBody(aiRagSearchSchema), handleAiRagSearch);

  // 语音识别转写链路 (ASR)
  // 支持 MediaRecorder 音频 Base64 输入，转换为工业现场故障与维保问答文本
  app.post("/api/v1/ai/speech-to-text", validateBody(speechToTextSchema), handleSpeechToText);

  // 视频时序多模态分析接口 (多模态时序抽帧与缺陷定性)
  app.post("/api/v1/ai/video-analysis", handleVideoAnalysis);

  // ==========================================================================
  // AI 扩展功能 (6 大工业场景)：智能工单生成 / 根因分析 / 检修方案 / 劣化趋势预警 / 报告生成 / 作业票风险评估
  // 全部复用 DashScope qwen-plus 客户端 (getAiClient)，结构化 JSON 输出，失败明确报错不伪造
  // ==========================================================================

  // ---------- 功能 1：智能工单生成 ----------
  app.post("/api/v1/ai/generate-work-order", requireAuth, validateBody(generateWorkOrderAiSchema), handleGenerateWorkOrder);

  // ---------- 功能 2：根因分析 (RCA / 5Why / 故障树) ----------
  app.post("/api/v1/ai/root-cause-analysis", requireAuth, validateBody(rootCauseAnalysisSchema), handleRootCauseAnalysis);

  // ---------- 功能 3：检修方案 / 作业指导书生成 ----------
  app.post("/api/v1/ai/generate-maintenance-plan", requireAuth, validateBody(generateMaintenancePlanSchema), handleGenerateMaintenancePlan);

  // ---------- 功能 4：设备劣化趋势预警（确定性统计引擎，AI 仅解读） ----------
  app.post("/api/v1/ai/health-forecast", requireAuth, validateBody(healthForecastSchema), handleHealthForecast);

  // ---------- 功能 5：智能报告生成 (巡检 / 检修 / 月度) ----------
  app.post("/api/v1/ai/generate-report", requireAuth, validateBody(generateReportSchema), handleGenerateReport);

  // ---------- 功能 6：作业票 AI 风险评估 ----------
  app.post("/api/v1/ai/safety-risk-assessment", requireAuth, validateBody(safetyRiskAssessmentSchema), handleSafetyRiskAssessment);

  // ---------- 任务一：AI 对话流式输出 (SSE) ----------
  app.post("/api/v1/ai/chat/stream", requireAuth, validateBody(aiChatSchema), handleAiChatStream);

  // ---------- 功能 7：AI 智能追问建议 ----------
  app.post("/api/v1/ai/suggest-followups", requireAuth, validateBody(suggestFollowupsSchema), handleSuggestFollowups);

  // ---------- 功能 8：设备健康画像 / 摘要 ----------
  app.post("/api/v1/ai/equipment-summary", requireAuth, validateBody(equipmentSummarySchema), handleEquipmentSummary);

  // ---------- 功能 9：AI 辅助派单 (推荐主修人 + 工时) ----------
  app.post("/api/v1/ai/recommend-assignee", requireAuth, validateBody(recommendAssigneeSchema), handleRecommendAssignee);

  // ---------- 功能 10：报警智能关联分析 ----------
  app.post("/api/v1/ai/alarm-correlation", requireAuth, validateBody(alarmCorrelationSchema), handleAlarmCorrelation);

  // ==========================================================================
  // AI 协同任务链路 (Pipeline)：可编排 / 可追踪 / 可审核
  // 场景「AI 协同诊断」：故障诊断 → 检修方案生成 →（风险审核 ∥ 派单推荐）
  // ==========================================================================

  // 创建并启动协同任务（立即返回任务 ID，编排异步执行）
  app.post("/api/v1/ai/pipeline", requireAuth, validateBody(pipelineCreateSchema), handleCreatePipeline);

  // 查询协同任务最近列表
  app.get("/api/v1/ai/pipeline", requireAuth, handleListPipeline);

  // 查询任务与各步骤状态
  app.get("/api/v1/ai/pipeline/:id", requireAuth, handleGetPipeline);

  // SSE 实时推送步骤进度（沿用现有 SSE 鉴权方式：requireAuth + Bearer Token）
  app.get("/api/v1/ai/pipeline/:id/events", requireAuth, handlePipelineEvents);

  // ---------- AI 追溯与版本分析审计日志（仅 admin 可见） ----------
  app.get("/api/v1/admin/ai-analysis-logs", requireAuth, requireRole(["admin"], "查看 AI 追溯日志"), async (req: any, res: any) => {
    try {
      const { AiAnalysisLogRepository } = await import("../../db/repositories/index.ts");
      const model = req.query.model ? String(req.query.model) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const logs = await AiAnalysisLogRepository.listTraceLogs({ model, limit });
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ error: "获取 AI 追溯日志失败", message: err.message });
    }
  });
}

