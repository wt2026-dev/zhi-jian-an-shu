// 重构说明：本模块自 server.ts 拆出，仅承载 Zod 输入校验 Schema，逻辑保持原样。
import { z } from "zod";

export const knowledgeQuerySchema = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
});

export const createKnowledgeSchema = z.object({
  title: z.string().min(1, { message: "文章标题必填" }),
  category: z.string().optional(),
  targetEquipment: z.string().optional(),
  tags: z.array(z.string()).optional(),
  summary: z.string().optional(),
  content: z.string().min(1, { message: "规程正文内容必填" }),
});

export const uploadKnowledgeSchema = z.object({
  fileName: z.string().optional(),
  textContent: z.string().min(1, { message: "未能解析到文档文本" }),
  category: z.string().optional(),
  targetEquipment: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const searchKnowledgeSchema = z.object({
  query: z.string().optional(),
  imageBase64: z.string().max(14_000_000).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});
export const reviewListQuerySchema = z.object({ status: z.enum(["pending", "approved", "rejected"]).optional() });
export const rejectKnowledgeSchema = z.object({ reason: z.string().max(1000).optional() });
export const graphQuerySchema = z.object({ equipment: z.string().optional() });
