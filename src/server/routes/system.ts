// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import swaggerUi from "swagger-ui-express";
import { buildOpenApiSpec } from "../../openapi.ts";
import { requireAuth, requireRole } from "../middleware/auth.ts";
import { validateBody, validateQuery } from "../middleware/validate.ts";
import { auditLogsQuerySchema, debugLogSchema } from "../schemas/system.ts";
import {
  handleGetAuditLogs,
  handleAdminAiStats,
  handleAdminAiCacheClear,
  handleHealthDetail,
  handleAdminMetrics,
  handleAdminOperationalMetrics,
  handleApiDocsJson,
  handleApiHealth,
  handleDigitalHumanStatus,
  handleDebugLog,
  handleDownloadZip,
} from "../controllers/systemController.ts";
import {
  handleListAiModels,
  handleUpsertAiModel,
  handleTestAiModel,
  handleReorderAiModels,
} from "../controllers/aiModelConfigController.ts";

export function registerSystemRoutes(app: express.Express) {
  // 审计日志查询 API (GET /api/v1/audit-logs)：含全系统操作留痕，仅 admin 可读
  app.get("/api/v1/audit-logs", requireRole(["admin"], "查询审计日志"), validateQuery(auditLogsQuerySchema), handleGetAuditLogs);

  // ==================== 管理端点（P1-4 缓存统计 / P2-8 监控指标） ====================
  app.get("/api/v1/admin/ai-stats", requireRole(["admin"], "查询 AI 缓存统计"), handleAdminAiStats);

  app.post("/api/v1/admin/ai-cache/clear", requireRole(["admin"], "清除 AI 缓存"), handleAdminAiCacheClear);

  app.get("/health/detail", handleHealthDetail);

  app.get("/api/v1/admin/metrics", requireRole(["admin"], "查询性能与业务指标"), handleAdminMetrics);

  // 运营指标（AI 采纳率、工单效率、安全合规、AI 质量、系统可靠性）
  app.get("/api/v1/admin/metrics/operational", requireRole(["admin"], "查询运营指标"), handleAdminOperationalMetrics);

  // ==================== API 文档（Swagger UI） ====================
  app.get("/api-docs.json", handleApiDocsJson);
  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(buildOpenApiSpec(), {
      customSiteTitle: "工业设备智能检修系统 API 文档",
      customCss: ".topbar { display: none } .opblock-summary-description { color: #64748b }",
    })
  );

  // API Health Endpoint
  app.get("/api/health", handleApiHealth);

  // 魔珐星云数字人配置状态接口 (无密钥时优雅降级告知前端)
  app.get("/api/v1/digital-human/status", handleDigitalHumanStatus);

  // 接收前端浏览器运行时异常
  app.post("/api/debug-log", validateBody(debugLogSchema), handleDebugLog);

  // 全量源码工程打包下载 ZIP：等价于源码整体泄露面，仅登录后的 admin 可下载
  app.get("/api/download-zip", requireAuth, requireRole(["admin"], "下载源码包"), handleDownloadZip);

  // ==================== AI 模型路由管理（多模型接入 / 降级优先级 / 连接测试，仅管理员） ====================
  app.get("/api/v1/admin/ai-models", requireAuth, requireRole(["admin"], "查看 AI 模型配置"), handleListAiModels);
  app.post("/api/v1/admin/ai-models", requireAuth, requireRole(["admin"], "新增/更新 AI 模型配置"), handleUpsertAiModel);
  app.post("/api/v1/admin/ai-models/reorder", requireAuth, requireRole(["admin"], "调整模型降级优先级"), handleReorderAiModels);
  app.post("/api/v1/admin/ai-models/:id/test", requireAuth, requireRole(["admin"], "测试模型连接"), handleTestAiModel);
}

