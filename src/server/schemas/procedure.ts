// 重构说明：本模块自 server.ts 拆出，仅承载 Zod 输入校验 Schema，逻辑保持原样。
import { z } from "zod";

export const procedureQuerySchema = z.object({
  equipmentType: z.string().optional(),
  maintenanceLevel: z.string().optional(),
  keyword: z.string().optional(),
});

export const createProcedureSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(2, { message: "指引标题必填且至少2个字符" }),
  equipmentType: z.string().min(1, { message: "设备类型必填" }),
  maintenanceLevel: z.string().min(1, { message: "检修等级必填" }),
  steps: z.array(
    z.object({
      step_no: z.number().int().positive(),
      name: z.string().min(1),
      content: z.string().min(1),
      tools: z.string().optional(),
      safety: z.string().optional(),
      acceptance: z.string().optional(),
    })
  ).min(1, { message: "至少包含一个步骤" }),
  estimatedMinutes: z.number().int().positive().optional(),
});
