// 重构说明：本模块自 server.ts 拆出，仅承载 Zod 输入校验 Schema，逻辑保持原样。
import { z } from "zod";

export const inspectionsQuerySchema = z.object({
  status: z.string().optional(),
  workshop: z.string().optional(),
  search: z.string().optional(),
});

export const inspectionCreateSchema = z.object({
  id: z.string().optional(),
  taskNo: z.string().optional(),
  title: z.string().min(1, { message: "缺少必填参数: 标题" }),
  type: z.string().optional(),
  inspectorId: z.string().optional(),
  inspectorName: z.string().optional(),
  workshop: z.string().optional(),
  route: z.string().optional(),
  scheduledDate: z.string().optional(),
  status: z.string().optional(),
  totalPoints: z.number().optional(),
  completedPoints: z.number().optional(),
  abnormalCount: z.number().optional(),
  items: z.array(z.any()).optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  summary: z.string().optional(),
});

export const inspectionUpdateSchema = inspectionCreateSchema.partial();
