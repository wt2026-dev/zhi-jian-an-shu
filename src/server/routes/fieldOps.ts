// 拆解作业终端（现场维修闭环）路由：会话 + LOTO / 步骤 / 测量 / 照片 四类写操作。
// 全部写操作 requireAuth —— 操作人取服务端会话用户，不信任请求体身份。
import express from "express";
import { deviceIdParamSchema, orderIdParamSchema, validateParams, validateBody } from "../middleware/validate.ts";
import { requireAuth } from "../middleware/auth.ts";
import { z } from "zod";
import {
  handleGetFieldSession,
  handleFieldLoto,
  handleFieldStep,
  handleFieldMeasure,
  handleFieldPhoto,
} from "../controllers/fieldOpsController.ts";

// LOTO：四项强制安全检查全部 confirmed:true（服务端再按权威清单复验 key）
const lotoActionSchema = z.object({
  items: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        confirmed: z.literal(true),
      })
    )
    .min(1),
});

// 步骤记录：action done/skip/issue；skip 与 issue 必须带原因
const stepActionSchema = z.object({
  index: z.number().int().min(1),
  action: z.enum(["done", "skip", "issue"]),
  note: z.string().max(500).optional(),
}).refine(
  (v) => (v.action === "skip" || v.action === "issue" ? typeof v.note === "string" && v.note.trim().length > 0 : true),
  { message: "跳过或标记问题必须填写原因" }
);

// 测量：真实点检科目 + 数值；位号必须落在真实拆解 BOM
const measureActionSchema = z.object({
  posNo: z.string().min(1),
  checkPoint: z.string().min(1),
  value: z.number().finite(),
});

// 照片：先经真实 /uploads/image 落盘（url 白名单校验在服务层再做更严的 /uploads/ 前缀判断）
const photoActionSchema = z.object({
  posNo: z.string().min(1),
  url: z.string().startsWith("/uploads/"),
  filename: z.string().max(200).optional(),
  size: z.number().int().min(0).optional(),
});

export function registerFieldOpsRoutes(app: express.Express) {
  // 现场作业会话（只读；跨设备前两个分支）
  app.get("/api/v1/equipments/:deviceId/field-session", validateParams(deviceIdParamSchema), handleGetFieldSession);

  // 写操作一律昂贵校验放服务层；:orderId 用 id 校验
  app.post("/api/v1/work-orders/:orderId/field-actions/loto", requireAuth, validateParams(orderIdParamSchema), validateBody(lotoActionSchema), handleFieldLoto);

  app.post("/api/v1/work-orders/:orderId/field-actions/step", requireAuth, validateParams(orderIdParamSchema), validateBody(stepActionSchema), handleFieldStep);

  app.post("/api/v1/work-orders/:orderId/field-actions/measure", requireAuth, validateParams(orderIdParamSchema), validateBody(measureActionSchema), handleFieldMeasure);

  app.post("/api/v1/work-orders/:orderId/field-actions/photo", requireAuth, validateParams(orderIdParamSchema), validateBody(photoActionSchema), handleFieldPhoto);
}
