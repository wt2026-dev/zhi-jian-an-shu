// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import swaggerUi from "swagger-ui-express";
import { buildOpenApiSpec } from "../../openapi.ts";
import { requireRole } from "../middleware/auth.ts";
import { validateBody, validateQuery } from "../middleware/validate.ts";
import { auditLogsQuerySchema, debugLogSchema } from "../schemas/system.ts";
import {
  handleGetAuditLogs,
  handleAdminAiStats,
  handleAdminAiCacheClear,
  handleHealthDetail,
  handleAdminMetrics,
  handleApiDocsJson,
  handleApiHealth,
  handleDigitalHumanStatus,
  handleDebugLog,
  handleDownloadZip,
} from "../controllers/systemController.ts";

export function registerSystemRoutes(app: express.Express) {
  // 审计日志查询 API (GET /api/v1/audit-logs)
  app.get("/api/v1/audit-logs", validateQuery(auditLogsQuerySchema), handleGetAuditLogs);

  // ==================== 管理端点（P1-4 缓存统计 / P2-8 监控指标） ====================
  app.get("/api/v1/admin/ai-stats", requireRole(["admin"], "查询 AI 缓存统计"), handleAdminAiStats);

  app.post("/api/v1/admin/ai-cache/clear", requireRole(["admin"], "清除 AI 缓存"), handleAdminAiCacheClear);

  app.get("/health/detail", handleHealthDetail);

  app.get("/api/v1/admin/metrics", requireRole(["admin"], "查询性能与业务指标"), handleAdminMetrics);

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

  // 全量源码工程打包下载 ZIP
  app.get("/api/download-zip", handleDownloadZip);
}
