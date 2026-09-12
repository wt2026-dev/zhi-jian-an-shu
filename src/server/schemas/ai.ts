// 重构说明：本模块自 server.ts 拆出，仅承载 Zod 输入校验 Schema，逻辑保持原样。
import { z } from "zod";

export const aiChatSchema = z.object({
  message: z.string().min(1, { message: "消息内容必填" }),
  history: z.array(z.any()).optional(),
  contextData: z.record(z.string(), z.any()).optional(),
});

export const aiDiagnoseSchema = z.object({
  equipmentName: z.string().optional(),
  equipmentCode: z.string().optional(),
  category: z.string().optional(),
  symptoms: z.string().optional(),
  telemetry: z.any().optional(),
  errorCodes: z.string().optional(),
});

export const aiVisionSchema = z.object({
  imageBase64: z.string().optional(),
  mimeType: z.string().optional(),
  promptText: z.string().optional(),
});

export const aiRagSearchSchema = z.object({
  query: z.string().optional(),
  knowledgeList: z.array(z.any()).optional(),
});

export const suggestContributionSchema = z.object({
  lastUserMessage: z.string().min(1, "用户输入内容必填").max(4000),
  lastAiReply: z.string().min(1, "AI回复内容必填").max(8000),
  equipment: z.string().optional(),
});

export const submitContributionSchema = z.object({
  id: z.string().optional(),
  chatId: z.string().optional(),
  title: z.string().min(1, "案例标题必填"),
  type: z.string().default("故障案例"),
  equipment: z.string().optional(),
  summary: z.string().optional(),
  solution: z.string().optional(),
});

export const multimodalSearchSchema = z.object({
  imageBase64: z.string().min(1, "缺少图片数据"),
  userText: z.string().max(500).optional(),
});

// ==================== AI 扩展功能输入校验 Schemas (6 大工业场景) ====================
export const generateWorkOrderAiSchema = z.object({
  equipmentId: z.string().min(1, { message: "equipmentId 必填" }),
  abnormalDescription: z.string().min(2, { message: "异常描述必填" }),
  inspectionPointId: z.string().optional(),
  telemetrySnapshot: z.any().optional(),
});

export const rootCauseAnalysisSchema = z
  .object({
    workOrderId: z.string().optional(),
    equipmentId: z.string().optional(),
    faultDescription: z.string().optional(),
  })
  .refine((d) => !!d.workOrderId || (!!d.equipmentId && !!d.faultDescription), {
    message: "必须提供 workOrderId，或同时提供 equipmentId 与 faultDescription",
  });

export const generateMaintenancePlanSchema = z.object({
  equipmentId: z.string().min(1, { message: "equipmentId 必填" }),
  faultDescription: z.string().min(2, { message: "故障描述必填" }),
  workOrderId: z.string().optional(),
});

export const healthForecastSchema = z.object({
  equipmentId: z.string().min(1, { message: "equipmentId 必填" }),
  hours: z.number().int().positive().max(2160).optional(),
});

export const generateReportSchema = z.object({
  reportType: z.enum(["inspection", "maintenance", "monthly"] as const),
  startDate: z.string().min(8, { message: "startDate 必填 (如 2026-09-01)" }),
  endDate: z.string().min(8, { message: "endDate 必填 (如 2026-09-05)" }),
  workshop: z.string().optional(),
});

export const safetyRiskAssessmentSchema = z.object({
  permitType: z.string().min(1, { message: "permitType 必填" }),
  equipmentId: z.string().optional(),
  workDescription: z.string().min(2, { message: "作业内容描述必填" }),
  location: z.string().optional(),
  hazards: z.array(z.string()).optional(),
});

// ==================== AI 助手体验升级 + 4 个新功能 Schemas (功能 7-10) ====================
export const suggestFollowupsSchema = z.object({
  lastUserMessage: z.string().min(1, { message: "lastUserMessage 必填" }),
  lastAiReply: z.string().min(1, { message: "lastAiReply 必填" }),
  context: z.any().optional(),
});

export const equipmentSummarySchema = z.object({
  equipmentId: z.string().min(1, { message: "equipmentId 必填" }),
});

export const recommendAssigneeSchema = z.object({
  equipmentId: z.string().min(1, { message: "equipmentId 必填" }),
  faultDescription: z.string().min(2, { message: "faultDescription 必填" }),
  priority: z.string().optional(),
});

export const alarmCorrelationSchema = z.object({
  alarms: z
    .array(
      z.object({
        equipmentId: z.string().min(1),
        alarmType: z.string().min(1),
        value: z.any().optional(),
        timestamp: z.string().optional(),
      })
    )
    .min(2, { message: "至少需要 2 条报警才能做关联分析" }),
});

export const visionDefectDetectSchema = z.object({
  imageBase64: z.string().optional(),
  imageUrl: z.string().optional(),
  equipmentType: z.string().optional(),
  promptText: z.string().optional(),
});

export const speechToTextSchema = z.object({
  audioBase64: z.string().optional(),
  durationSeconds: z.number().optional(),
  mimeType: z.string().optional(),
});

export const videoAnalyzeSchema = z.object({
  frames: z.array(z.string()).min(1, { message: "至少需要提供1帧视频截图" }).max(12),
  question: z.string().optional(),
  deviceModel: z.string().optional(),
  videoId: z.string().optional(),
});

export const feedbackSchema = z.object({ chatId: z.string().min(1), user_correction: z.string().min(1), corrected_content: z.string().min(1), model_response: z.string().optional(), device_id: z.string().optional() });
