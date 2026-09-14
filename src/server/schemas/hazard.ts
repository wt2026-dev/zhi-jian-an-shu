// 重构说明：本模块自 server.ts 拆出，仅承载 Zod 输入校验 Schema，逻辑保持原样。
import { z } from "zod";

export const createHazardSchema = z.object({
  title: z.string().min(1, { message: "隐患标题必填" }),
  equipmentId: z.string().optional(),
  equipment_id: z.string().optional(),
  location: z.string().min(1, { message: "发生位置必填" }),
  level: z.enum(["general", "major"]),
  description: z.string().min(1, { message: "隐患详细描述必填" }),
  discoverer: z.string().optional(),
  reported_by: z.string().optional(),
  source: z.enum(["inspection", "work_order", "report"]).optional(),
  deadline: z.string().optional(),
  rectificationPlan: z.string().optional(),
  rectification_plan: z.string().optional(),
});

export const updateHazardSchema = z.object({
  title: z.string().optional(),
  level: z.enum(["general", "major"]).optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  status: z.enum(["pending", "rectifying", "verifying", "closed"]).optional(),
  deadline: z.string().optional(),
  rectificationPlan: z.string().optional(),
  rectification_plan: z.string().optional(),
});

export const assignHazardSchema = z.object({
  priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
  assigneeId: z.string().optional(),
  deadline: z.string().optional(),
  dispatch_note: z.string().optional(),
});

export const verifyHazardSchema = z.object({
  verificationNotes: z.string().optional(),
  comment: z.string().optional(),
  pass: z.boolean().optional(),
  passed: z.boolean().optional(),
  verifierName: z.string().optional(),
  verifier: z.string().optional(),
});
