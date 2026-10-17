import { z } from "zod";

// ==================== Zod 输入校验中间件（原 server.ts 通用校验器） ====================

export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: any, res: any, next: any) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: "请求体输入参数校验失败",
        code: "INVALID_INPUT",
        details: (result.error as any).issues || (result.error as any).errors,
      });
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return (req: any, res: any, next: any) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        error: "查询参数校验失败",
        code: "INVALID_INPUT",
        details: (result.error as any).issues || (result.error as any).errors,
      });
    }
    req.query = result.data;
    next();
  };
}

export function validateParams<T extends z.ZodTypeAny>(schema: T) {
  return (req: any, res: any, next: any) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return res.status(400).json({
        error: "路径参数校验失败",
        code: "INVALID_INPUT",
        details: (result.error as any).issues || (result.error as any).errors,
      });
    }
    req.params = result.data;
    next();
  };
}

// 多业务域共用的路径参数校验
export const idParamSchema = z.object({ id: z.string().min(1) });
export const deviceIdParamSchema = z.object({ deviceId: z.string().min(1) });
