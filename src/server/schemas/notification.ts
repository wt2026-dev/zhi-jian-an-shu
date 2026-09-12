// 重构说明：本模块自 server.ts 拆出，仅承载 Zod 输入校验 Schema，逻辑保持原样。
import { z } from "zod";

export const notificationsQuerySchema = z.object({
  unread_only: z.string().optional(),
  limit: z.string().optional(),
  user_id: z.string().optional(),
  all: z.string().optional(),
});
