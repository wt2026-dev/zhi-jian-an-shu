// 重构说明：本模块自 server.ts 拆出，仅承载 Zod 输入校验 Schema，逻辑保持原样。
import { z } from "zod";

export const equipmentsQuerySchema = z.object({
  workshop: z.string().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
});

export const createEquipmentSchema = z.object({
  code: z.string().min(1, { message: "设备编码必填" }),
  name: z.string().min(1, { message: "设备名称必填" }),
  category: z.string().min(1, { message: "设备类别必填" }),
  model: z.string().optional(),
  workshop: z.string().optional(),
  location: z.string().optional(),
  manufacturer: z.string().optional(),
  status: z.string().optional(),
  criticality: z.string().optional(),
  specs: z.record(z.string(), z.any()).optional(),
});
