// 重构说明：本模块自 server.ts 拆出，仅承载 Zod 输入校验 Schema，逻辑保持原样。
import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().min(1, { message: "用户名必填" }),
  password: z.string().min(1, { message: "密码必填" }),
});

export const createUserSchema = z.object({
  username: z.string().min(2, { message: "用户名至少 2 个字符" }),
  name: z.string().min(1, { message: "姓名必填" }),
  password: z.string().min(6, { message: "初始密码至少 6 位" }),
  role: z.enum(["admin", "manager", "technician", "inspector", "operator", "archivist", "user"] as const),
  roleTitle: z.string().optional(),
  department: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  permissions: z.array(z.string()).optional(),
});
