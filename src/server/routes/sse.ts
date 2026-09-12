// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import { requireAuth } from "../middleware/auth.ts";
import { validateBody } from "../middleware/validate.ts";
import {
  rootCauseAnalysisSchema,
  generateMaintenancePlanSchema,
  healthForecastSchema,
  equipmentSummarySchema,
  safetyRiskAssessmentSchema,
  generateReportSchema,
} from "../schemas/ai.ts";
import {
  handleRootCauseAnalysisStream,
  handleGenerateMaintenancePlanStream,
  handleHealthForecastStream,
  handleEquipmentSummaryStream,
  handleSafetyRiskAssessmentStream,
  handleGenerateSmartReportStream,
} from "../controllers/aiStreamController.ts";

export function registerSseRoutes(app: express.Express) {
  app.post("/api/v1/ai/root-cause-analysis/stream", requireAuth, validateBody(rootCauseAnalysisSchema), handleRootCauseAnalysisStream);

  app.post("/api/v1/ai/generate-maintenance-plan/stream", requireAuth, validateBody(generateMaintenancePlanSchema), handleGenerateMaintenancePlanStream);

  app.post("/api/v1/ai/health-forecast/stream", requireAuth, validateBody(healthForecastSchema), handleHealthForecastStream);

  app.post("/api/v1/ai/equipment-summary/stream", requireAuth, validateBody(equipmentSummarySchema), handleEquipmentSummaryStream);

  app.post("/api/v1/ai/safety-risk-assessment/stream", requireAuth, validateBody(safetyRiskAssessmentSchema), handleSafetyRiskAssessmentStream);

  app.post("/api/v1/ai/generate-smart-report/stream", requireAuth, validateBody(generateReportSchema), handleGenerateSmartReportStream);
}
