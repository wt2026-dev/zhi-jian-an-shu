// 重构说明：本模块自 server.ts 拆出，仅承载 Zod 输入校验 Schema，逻辑保持原样。
import { z } from "zod";

export const createSparePartSchema = z.object({
  name: z.string().min(1, { message: "备件名称必填" }),
  spec: z.string().optional(),
  model: z.string().optional(),
  category: z.string().optional(),
  stock: z.number().int().nonnegative().optional(),
  safeStock: z.number().int().nonnegative().optional(),
  safe_stock: z.number().int().nonnegative().optional(),
  unit: z.string().optional(),
  location: z.string().min(1, { message: "存放库位必填" }),
  price: z.number().nonnegative().optional(),
  targetEquipmentType: z.string().optional(),
  target_equipment_type: z.string().optional(),
});

export const sparePartInOutSchema = z.object({
  type: z.enum(["in", "out"]),
  quantity: z.number().int().positive({ message: "出入库数量必须大于 0" }),
  operatorName: z.string().optional(),
  relatedWorkOrderId: z.string().optional(),
  notes: z.string().optional(),
});
