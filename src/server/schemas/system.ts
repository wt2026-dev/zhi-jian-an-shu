// 重构说明：本模块自 server.ts 拆出，仅承载 Zod 输入校验 Schema，逻辑保持原样。
import { z } from "zod";

export const auditLogsQuerySchema = z.object({
  module: z.string().optional(),
  actionType: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().optional(),
});
