// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import {
  handleXingyunSession,
  handleWechatToken,
  handleWechatRepairQrcode,
  handleWechatH5Qrcode,
} from "../controllers/wechatController.ts";

export function registerWechatRoutes(app: express.Express) {
  app.post("/api/v1/xingyun/session", handleXingyunSession);

  // 接口① POST /api/v1/wechat/token 获取 access_token (返回安全信息)
  app.post("/api/v1/wechat/token", handleWechatToken);

  // 接口② GET /api/v1/wechat/repair-qrcode?deviceId=xxx&width=430 设备专属小程序太阳码
  app.get("/api/v1/wechat/repair-qrcode", handleWechatRepairQrcode);

  // 接口③ GET /api/v1/wechat/h5-qrcode?deviceId=xxx (H5 普通二维码 PNG 过渡码)
  app.get("/api/v1/wechat/h5-qrcode", handleWechatH5Qrcode);
}
