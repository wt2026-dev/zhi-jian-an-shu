// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import { validateBody } from "../middleware/validate.ts";
import { wxRepairSchema } from "../schemas/wx.ts";
import { handleWxRepairCreate } from "../controllers/wechatController.ts";

export function registerWxRoutes(app: express.Express) {
  // 接口④ POST /api/v1/wx/repairs 微信小程序免登录快速扫码报修创建
  app.post("/api/v1/wx/repairs", validateBody(wxRepairSchema), handleWxRepairCreate);
  // 别名路由兼容
  app.post("/api/v1/wx/repair", validateBody(wxRepairSchema), (req: any, res: any) => {
    return (app as any)._router.handle({ ...req, url: "/api/v1/wx/repairs" }, res);
  });
}
