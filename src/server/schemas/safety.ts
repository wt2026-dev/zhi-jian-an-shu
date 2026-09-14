// 重构说明：本模块自 server.ts 拆出，仅承载 Zod 输入校验 Schema，逻辑保持原样。
import { z } from "zod";

export const safetyPermitsQuerySchema = z.object({
  risk_level: z.string().optional(),
  status: z.string().optional(),
  workshop: z.string().optional(),
});

export const createSafetyPermitSchema = z.object({
  permitType: z.string().optional(),
  riskLevel: z.string().optional(),
  title: z.string().min(1, { message: "作业票标题必填" }),
  equipmentId: z.string().optional(),
  equipmentName: z.string().optional(),
  workshop: z.string().optional(),
  location: z.string().optional(),
  validUntil: z.string().optional(),
  precautions: z.array(z.string()).optional(),
  lotoNumber: z.string().nullable().optional(),
  hazards: z.array(z.string()).optional(),
  safetyChecklist: z.array(z.any()).optional(),
});

export const approveSafetyPermitSchema = z.object({
  step: z.enum(["guardian", "supervisor"] as const),
  pass: z.boolean().optional(),
  comment: z.string().optional(),
  gasTestResults: z.any().optional(),
  version: z.number().optional(),
});

export const closeSafetyPermitSchema = z.object({
  closeRemark: z.string().optional(),
  version: z.number().optional(),
});
