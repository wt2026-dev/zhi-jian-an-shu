// 遥测数据摄入路由。全局鉴权基线（index.ts globalAuthGuard）已要求 /api/* 带 JWT；
// 这里用 requireRole 显式收口写入者，与「工单高危端点 RBAC 收口」的安全基调一致。
import express from "express";
import { requireRole } from "../middleware/auth.ts";
import { validateBody } from "../middleware/validate.ts";
import { telemetryIngestSchema } from "../schemas/telemetry.ts";
import { handleIngestTelemetry } from "../controllers/telemetryController.ts";

export function registerTelemetryRoutes(app: express.Express) {
  app.post(
    "/api/v1/telemetry/ingest",
    requireRole(["admin", "manager", "technician", "inspector"], "遥测数据摄入"),
    validateBody(telemetryIngestSchema),
    handleIngestTelemetry
  );
}
