// 重构说明：本模块自 server.ts 拆出，仅承载 Zod 输入校验 Schema，逻辑保持原样。
import { z } from "zod";

export const workOrdersQuerySchema = z.object({
  status: z.string().optional(),
  priority: z.string().optional(),
  equipment_id: z.string().optional(),
  search: z.string().optional(),
  workshop: z.string().optional(),
});

export const createWorkOrderSchema = z.object({
  title: z.string().min(1, { message: "缺少必填参数: 标题" }),
  equipmentId: z.string().min(1, { message: "缺少必填参数: 设备ID" }),
  faultType: z.string().optional(),
  priority: z.string().optional(),
  description: z.string().min(1, { message: "缺少必填参数: 描述" }),
  safetyRequirements: z.array(z.string()).optional(),
  creator: z.string().optional(),
  forceSubmit: z.boolean().optional(),
  idempotencyKey: z.string().optional(),
});

export const dispatchWorkOrderSchema = z.object({
  assigneeId: z.string().optional(),
  assigneeName: z.string().optional(),
  dispatcher: z.string().optional(),
  estimatedHours: z.number().optional(),
  version: z.number().optional(),
});

export const claimWorkOrderSchema = z.object({
  operatorName: z.string().optional(),
  version: z.number().optional(),
});

export const completeWorkOrderSchema = z.object({
  causeAnalysis: z.string().optional(),
  resolutionSteps: z.string().optional(),
  partsUsed: z.array(z.any()).optional(),
  workHours: z.number().optional(),
  completionPhotos: z.array(z.string()).optional(),
  remark: z.string().optional(),
  operatorName: z.string().optional(),
  version: z.number().optional(),
});

export const acceptWorkOrderSchema = z.object({
  inspectorName: z.string().optional(),
  pass: z.boolean().optional(),
  score: z.number().optional(),
  comment: z.string().optional(),
  version: z.number().optional(),
});

export const transitionStatusSchema = z.object({
  targetStatus: z.string().min(1, { message: "缺少目标状态 targetStatus" }),
  operatorName: z.string().optional(),
  comment: z.string().optional(),
  version: z.number().optional(),
});
