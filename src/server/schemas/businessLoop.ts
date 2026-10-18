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

// LOTO 隔离点逐项确认：确认开关 + 可选的现场登记字段（点位/要求/锁具牌号/现场操作人）
export const lotoConfirmSchema = z.object({
  itemId: z.string().trim().min(1).max(64),
  confirmed: z.boolean(),
  fields: z
    .object({
      type: z.string().trim().max(20).optional(),
      point: z.string().trim().min(1).max(200).optional(),
      requirement: z.string().trim().max(1000).optional(),
      lockNumber: z.string().trim().max(64).optional(),
      operator: z.string().trim().max(64).optional(),
    })
    .optional(),
});

// 新增隔离点（AI 推演漏项时由现场补登，来源标「人工登记」）
export const lotoAddItemSchema = z.object({
  type: z.string().trim().min(1).max(20),
  point: z.string().trim().min(1).max(200),
  requirement: z.string().trim().max(1000).optional(),
  lockNumber: z.string().trim().max(64).optional(),
});

// 环节确认时随行人工修订：只白名单这些字段，其余键在服务端按字段逐个取，未知键直接丢弃。
// 优先级口径与 work_orders.priority 现网取值一致（urgent/high/medium/low，无 critical）。
export const stageConfirmBodySchema = z.looseObject({
  edits: z
    .object({
      workOrderDraft: z
        .object({
          title: z.string().trim().min(4).max(200).optional(),
          faultType: z.string().trim().max(50).optional(),
          priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
          estimatedHours: z.coerce.number().min(0.5).max(200).optional(),
          description: z.string().trim().max(2000).optional(),
        })
        .optional(),
      assessment: z
        .object({
          riskLevel: z.string().trim().max(20).optional(),
          riskReason: z.string().trim().max(1000).optional(),
        })
        .optional(),
      plan: z
        .object({
          overview: z.string().trim().max(2000).optional(),
          estimatedHours: z.coerce.number().min(0.5).max(200).optional(),
          workers: z.coerce.number().int().min(1).max(50).optional(),
        })
        .optional(),
    })
    .optional(),
});
