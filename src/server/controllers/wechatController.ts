// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import { Request, Response } from "express";
import QRCode from "qrcode";
import { logger } from "../../utils/logger.ts";
import { XINGYUN_APP_ID, XINGYUN_APP_SECRET, WECHAT_APP_ID, WECHAT_APP_SECRET } from "../utils/config.ts";

// POST /api/v1/xingyun/session 魔珐星云数字人会话代理
export async function handleXingyunSession(req: Request, res: Response) {
  try {
    const appId = process.env.XINGYUN_APP_ID || XINGYUN_APP_ID;
    const appSecret = process.env.XINGYUN_APP_SECRET || XINGYUN_APP_SECRET;
    const gatewayUrl = "https://nebula-agent.xingyun3d.com/user/v1/ttsa/session";

    if (!appId || !appSecret) {
      return res.status(503).json({
        success: false,
        error_code: 50301,
        error_reason: "魔珐星云数字人服务凭证未配置 (XINGYUN_APP_ID/SECRET 缺失)",
      });
    }

    // 签名辅助工具函数 (与官方 Lite SDK headersNeedSign 保持一致)
    const compareUnicodeCodePoints = (t: string, e: string) => {
      const n = Array.from(t, (x) => x.codePointAt(0) || 0);
      const r = Array.from(e, (x) => x.codePointAt(0) || 0);
      const i = Math.min(n.length, r.length);
      for (let s = 0; s < i; s += 1) {
        if (n[s] !== r[s]) return n[s] - r[s];
      }
      return n.length - r.length;
    };

    const escapeNonAsciiForPythonJson = (t: string) => {
      return t.replace(/[^\u0000-\u007E]/g, (x) => "\\u" + (x.charCodeAt(0).toString(16).padStart(4, "0")));
    };

    const sortKeys = (e: any): any => {
      if (e == null || typeof e !== "object") return e;
      if (Array.isArray(e)) return e.map(sortKeys);
      const r: Record<string, any> = {};
      for (const k of Object.keys(e).sort(compareUnicodeCodePoints)) {
        r[k] = sortKeys(e[k]);
      }
      return r;
    };

    const signRequest = (aId: string, aSec: string, method: string, rawUrl: string, data: any) => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const parsed = new URL(rawUrl);
      const pathWithQuery = parsed.pathname + parsed.search;
      const sortedData = sortKeys(data);
      const escapedJson = escapeNonAsciiForPythonJson(JSON.stringify(sortedData)).replace(/ /g, "");
      const signString = pathWithQuery.toLowerCase() + method.toLowerCase() + escapedJson + aSec + timestamp;
      const cryptoMod = require("crypto");
      const token = cryptoMod.createHash("md5").update(signString).digest("hex");
      return {
        headers: {
          "X-APP-ID": aId,
          "X-TOKEN": token,
          "X-TIMESTAMP": timestamp,
          "Content-Type": "application/json",
        },
        data: sortedData,
      };
    };

    const reqData = Object.assign(
      {
        tag: "default",
        gateway_type: "default",
        config: { framedata_proto_version: 2, walk_version: 3 },
      },
      req.body || {}
    );

    const signed = signRequest(appId, appSecret, "POST", gatewayUrl, reqData);

    const gatewayResponse = await fetch(gatewayUrl, {
      method: "POST",
      headers: signed.headers,
      body: JSON.stringify(signed.data),
    });

    const jsonResult: any = await gatewayResponse.json();

    // 失败时透传魔珐星云原始 error_code 与 error_reason（如"您的积分不足, 请及时充值"）
    if (!gatewayResponse.ok || (jsonResult && jsonResult.error_code && jsonResult.error_code !== 0)) {
      return res.status(200).json({
        success: false,
        error_code: jsonResult?.error_code || 500,
        error_reason: jsonResult?.error_reason || jsonResult?.message || "魔珐星云会话建立异常",
        data: jsonResult?.data || null,
      });
    }

    // 成功时返回会话数据与资源地址，严禁包含任何 secret
    return res.status(200).json({
      success: true,
      error_code: 0,
      error_reason: "",
      data: jsonResult?.data || jsonResult,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "魔珐星云数字人 session 代理请求异常");
    return res.status(500).json({
      success: false,
      error_code: 50000,
      error_reason: err?.message || "数字人网关代理网络异常",
    });
  }
}

// ==================== 微信小程序码与设备报修扫码服务 ====================
// 微信 access_token 内存缓存与单飞行（Single-flight）Promise
let wechatTokenCache: { token: string; expiresAt: number } | null = null;
let wechatTokenPromise: Promise<string> | null = null;

export async function getWeChatAccessToken(): Promise<string> {
  const appId = process.env.WECHAT_APP_ID || WECHAT_APP_ID;
  const appSecret = process.env.WECHAT_APP_SECRET || WECHAT_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error("微信小程序凭证未配置 (WECHAT_APP_ID / WECHAT_APP_SECRET 缺失)");
  }

  const now = Date.now();
  // 缓存有效期取 expires_in - 300 秒，且有效直接复用
  if (wechatTokenCache && wechatTokenCache.expiresAt > now) {
    return wechatTokenCache.token;
  }

  // 单飞行（promise 缓存），避免并发请求造成重复拉取与凭证风暴
  if (wechatTokenPromise) {
    return wechatTokenPromise;
  }

  wechatTokenPromise = (async () => {
    try {
      const tokenUrl = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(
        appId
      )}&secret=${encodeURIComponent(appSecret)}`;

      const response = await fetch(tokenUrl);
      const data: any = await response.json();

      if (data.errcode && data.errcode !== 0) {
        throw new Error(`[微信Token错误 ${data.errcode}] ${data.errmsg || "获取 access_token 失败"}`);
      }

      if (!data.access_token) {
        throw new Error("微信接口未返回 access_token");
      }

      const expiresIn = Number(data.expires_in) || 7200;
      // 有效期提前 300 秒过期以确保安全裕量
      wechatTokenCache = {
        token: data.access_token,
        expiresAt: Date.now() + Math.max(60, expiresIn - 300) * 1000,
      };

      return data.access_token;
    } finally {
      wechatTokenPromise = null;
    }
  })();

  return wechatTokenPromise;
}

// 接口① POST /api/v1/wechat/token 获取 access_token (返回安全信息)
export async function handleWechatToken(req: Request, res: Response) {
  try {
    const token = await getWeChatAccessToken();
    const expiresRemaining = wechatTokenCache ? Math.max(0, Math.floor((wechatTokenCache.expiresAt - Date.now()) / 1000)) : 0;
    res.json({
      success: true,
      expiresIn: expiresRemaining,
      configured: true,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      msg: err?.message || "获取微信 access_token 失败",
      configured: false,
    });
  }
}

// 接口② GET /api/v1/wechat/repair-qrcode?deviceId=xxx&width=430 设备专属小程序太阳码
export async function handleWechatRepairQrcode(req: Request, res: Response) {
  const deviceId = String(req.query.deviceId || req.query.equipmentId || "").trim();
  const width = Math.min(1280, Math.max(280, Number(req.query.width) || 430));

  if (!deviceId) {
    return res.status(400).json({
      success: false,
      code: 400,
      msg: "deviceId 参数必填 (如 ?deviceId=eq-001)",
    });
  }

  const appId = process.env.WECHAT_APP_ID || WECHAT_APP_ID;
  const appSecret = process.env.WECHAT_APP_SECRET || WECHAT_APP_SECRET;

  // 当未配置小程序凭据时，返回 404 JSON 并带未配置标识，便于前端平滑切 H5 码
  if (!appId || !appSecret) {
    return res.status(404).json({
      success: false,
      code: 40401,
      msg: "微信小程序 AppID/Secret 未配置，请使用 H5 临时报修二维码",
      configured: false,
    });
  }

  try {
    const accessToken = await getWeChatAccessToken();
    const wxaUrl = `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(accessToken)}`;

    // 微信 scene 最大 32 字符，d=<deviceId>&src=qr 紧凑格式
    const scene = `d=${deviceId}&src=qr`.slice(0, 32);
    const postData = {
      scene,
      page: "pages/repair/repair",
      width,
      check_path: false,
      env_version: "release",
    };

    const wxaResp = await fetch(wxaUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(postData),
    });

    const contentType = wxaResp.headers.get("content-type") || "";

    // 微信接口若报错会返回 JSON (含 errcode, errmsg)
    if (contentType.includes("application/json")) {
      const errJson: any = await wxaResp.json();
      return res.status(200).json({
        success: false,
        code: errJson.errcode || 500,
        msg: errJson.errmsg || "生成小程序码失败",
      });
    }

    // 成功返回图片二进制 Buffer
    const arrayBuffer = await wxaResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buffer);
  } catch (err: any) {
    res.status(200).json({
      success: false,
      code: 500,
      msg: err?.message || "微信网关连接异常",
    });
  }
}

// 接口③ GET /api/v1/wechat/h5-qrcode?deviceId=xxx (H5 普通二维码 PNG 过渡码)
export async function handleWechatH5Qrcode(req: Request, res: Response) {
  const deviceId = String(req.query.deviceId || req.query.equipmentId || "").trim();
  const host = req.get("host") || "localhost:3000";
  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const targetUrl = `${protocol}://${host}/?view=quick_repair&equipmentId=${encodeURIComponent(deviceId)}&src=h5_qr`;

  try {
    const qrBuffer = await QRCode.toBuffer(targetUrl, {
      type: "png",
      width: 430,
      margin: 2,
      color: {
        dark: "#0f172a",
        light: "#ffffff",
      },
    });

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("X-Target-Url", targetUrl);
    res.send(qrBuffer);
  } catch (err: any) {
    res.status(500).json({
      success: false,
      msg: "生成 H5 二维码失败: " + err?.message,
    });
  }
}
