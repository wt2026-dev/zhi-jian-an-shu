// 重构说明：本模块自 server.ts 拆出，仅承载 Zod 输入校验 Schema，逻辑保持原样。
import { z } from "zod";

export const wxRepairSchema = z.object({
  deviceId: z.string().min(1, { message: "设备ID必填" }),
  desc: z.string().min(1, { message: "故障描述必填" }),
  level: z.string().optional(),
  faultType: z.string().optional(),
  images: z.array(z.string()).optional(),
  reporter: z.string().optional(),
  phone: z.string().optional(),
  openid: z.string().optional(),
  userId: z.string().optional(),
});
