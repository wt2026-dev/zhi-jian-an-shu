import { z } from "zod";

// ==================== Hermes 业务闭环入参校验 ====================

// 创建闭环：goal 必填；equipmentId 可缺省（由服务端按目标文本解析真实设备）
export const createBusinessLoopSchema = z.object({
  goal: z.string().trim().min(4, "业务目标至少 4 个字").max(300, "业务目标最长 300 字"),
  equipmentId: z.string().trim().min(1).max(64).optional(),
});

export const loopIdParamSchema = z.object({ id: z.string().trim().min(1).max(64) });

export const stageNoParamSchema = z.object({
  id: z.string().trim().min(1).max(64),
  stageNo: z.coerce.number().int().min(1).max(6),
});

export const listLoopsQuerySchema = z.object({
  status: z.enum(["running", "paused", "archived"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// LOTO 逐项确认：只收确认开关，操作人从服务端会话取
export const lotoConfirmSchema = z.object({
  itemId: z.string().trim().min(1).max(64),
  confirmed: z.boolean(),
});
