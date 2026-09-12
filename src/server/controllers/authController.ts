// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import bcrypt from "bcryptjs";
import { getDb } from "../../db/db.ts";
import { UserRepository } from "../../db/repositories/index.ts";
import { addAuditLog, getClientIp } from "../services/auditService.ts";
import { signJwtToken, revokeToken, authenticateBearer } from "../services/authService.ts";
import { checkLoginBruteForce, recordLoginFailure, recordLoginSuccess } from "../middleware/rateLimit.ts";

// 用户登录 API（含防爆破限流、Bcrypt 密码校验与旧明文密码平滑升级）
export async function handleLogin(req: any, res: any) {
  const { username, password } = req.body;
  const ip = getClientIp(req);

  // 1. 防爆破限流校验 (同 IP 连续失败锁定)
  if (!checkLoginBruteForce(req, res)) {
    addAuditLog(req, {
      actionType: "LOGIN",
      module: "认证中心",
      detail: `[防爆破拦截] 来自 IP ${ip} 的登录请求已被锁定期拦截`,
      status: "BLOCKED",
      metadata: { username, ip },
    });
    return;
  }

  // 原 server.ts 中 dbUsers 为 createApp 闭包内的用户缓存，此处按既有拆分惯例改为实时读取数据库
  const dbUsers = await UserRepository.getAllUsers();
  const user = dbUsers.find((u) => u.username === username);
  let isPasswordValid = false;

  if (user && user.password) {
    if (user.password.startsWith("$2a$") || user.password.startsWith("$2b$") || user.password.startsWith("$2y$")) {
      isPasswordValid = await bcrypt.compare(password, user.password);
    } else {
      // 兼容平滑升级旧明文密码
      isPasswordValid = user.password === password;
      if (isPasswordValid) {
        try {
          const hashed = await bcrypt.hash(password, 10);
          user.password = hashed;
          const db = await getDb();
          await db.query(`UPDATE users SET password = $1 WHERE id = $2;`, [hashed, user.id]);
        } catch (e) {
          console.error("自动升级密码 Bcrypt 哈希失败:", e);
        }
      }
    }
  }

  if (!user || !isPasswordValid) {
    recordLoginFailure(ip);
    addAuditLog(req, {
      actionType: "LOGIN",
      module: "认证中心",
      detail: `用户登录凭证核验失败 (尝试用户名: ${username || "未知"}, IP: ${ip})`,
      status: "FAILED",
      metadata: { username, ip },
    });
    return res.status(401).json({ error: "账号或密码错误，请核对" });
  }

  // 登录成功重置失败计数
  recordLoginSuccess(ip);

  const token = signJwtToken(user);
  addAuditLog(req, {
    actionType: "LOGIN",
    module: "认证中心",
    detail: `用户 [${user.name} - ${user.roleTitle}] 成功登录系统工作台`,
    status: "SUCCESS",
    metadata: { userId: user.id, username: user.username, role: user.role },
  });

  res.json({
    token,
    tokenType: "bearer",
    expiresIn: 480 * 60,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      roleTitle: user.roleTitle,
      department: user.department,
      phone: user.phone,
      email: user.email,
      permissions: user.permissions,
    },
  });
}

// 用户登出 API (使当前 Token 失效)
export function handleLogout(req: any, res: any) {
  const auth = req.headers["authorization"];
  if (auth && auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    revokeToken(token);
  }
  res.json({ success: true, message: "已成功登出并作废当前 Token" });
}

// Token 刷新 API
export function handleRefresh(req: any, res: any) {
  const user = authenticateBearer(req);
  if (!user) {
    return res.status(401).json({ error: "无效或已过期的登录凭证，无法刷新 Token", code: "UNAUTHORIZED" });
  }
  const auth = req.headers["authorization"];
  if (auth && auth.startsWith("Bearer ")) {
    revokeToken(auth.slice(7).trim());
  }
  const newToken = signJwtToken(user);
  res.json({
    token: newToken,
    tokenType: "bearer",
    expiresIn: 480 * 60,
  });
}

export function handleMe(req: any, res: any) {
  const user = authenticateBearer(req);
  res.json(user);
}

export async function handleGetAuthUsers(req: any, res: any) {
  // 原 server.ts 中 dbUsers 为 createApp 闭包内的用户缓存，此处按既有拆分惯例改为实时读取数据库
  const dbUsers = await UserRepository.getAllUsers();
  res.json(
    dbUsers.map((u) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      roleTitle: u.roleTitle,
      department: u.department,
      phone: u.phone,
      email: u.email,
      permissions: u.permissions,
      avatar: u.avatar || "",
    }))
  );
}

// 快速身份切换 API (支持右上角角色无缝切换并签发对应用户 JWT)
export async function handleSwitchUser(req: any, res: any) {
  try {
    const { userId, username } = req.body || {};
    // 原 server.ts 中 dbUsers 为 createApp 闭包内的用户缓存，此处按既有拆分惯例改为实时读取数据库
    const dbUsers = await UserRepository.getAllUsers();
    const user = dbUsers.find((u) => (userId && u.id === userId) || (username && u.username === username));
    if (!user) {
      return res.status(404).json({ error: "目标切换用户不存在" });
    }
    const token = signJwtToken(user);
    res.json({
      token,
      tokenType: "bearer",
      expiresIn: 480 * 60,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        roleTitle: user.roleTitle,
        department: user.department,
        phone: user.phone,
        email: user.email,
        permissions: user.permissions || [],
        avatar: user.avatar || "",
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: "用户切换失败: " + err.message });
  }
}

// ==================== 15.5 微信小程序登录 (wx.login → code2session) ====================
// 生产环境：配置.env 中 WX_APPID / WX_APPSECRET 后走真实 code2session 换取 openid；
// 未配置时：开发态降级为 code 派生的稳定 openid，保证本地联调链路可跑通（响应中会标记 devMode: true）。
export async function handleWxLogin(req: any, res: any) {
  try {
    const code = String(req.body?.code || "").trim();
    if (!code) {
      return res.status(400).json({ error: "缺少 wx.login 返回的 code", code: "INVALID_INPUT" });
    }

    const appid = process.env.WX_APPID;
    const secret = process.env.WX_APPSECRET;
    let openid = "";
    let devMode = false;
    let unionid = "";

    if (appid && secret) {
      const wxRes = await fetch(
        `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(
          secret
        )}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`
      );
      const wxJson: any = await wxRes.json();
      if (!wxJson.openid) {
        return res.status(401).json({
          error: "微信登录失败: " + (wxJson.errmsg || "invalid code"),
          code: "WX_LOGIN_FAILED",
          errcode: wxJson.errcode,
        });
      }
      openid = wxJson.openid;
      unionid = wxJson.unionid || "";
    } else {
      // 开发态降级：由 code 派生稳定 openid（FNV-1a），仅用于本地联调
      let h = 0x811c9dc5;
      for (let i = 0; i < code.length; i++) {
        h ^= code.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
      openid = "dev_" + h.toString(16).padStart(8, "0");
      devMode = true;
    }

    // openid 与既有工号账号绑定：优先按 openid 命中，未绑定时按 WX_DEFAULT_USERNAME 绑定
    // 原 server.ts 中 dbUsers 为 createApp 闭包内的用户缓存，此处按既有拆分惯例改为实时读取数据库
    const dbUsers = await UserRepository.getAllUsers() as any[];
    let user: any = dbUsers.find((u: any) => u.wxOpenId === openid);
    if (!user) {
      const bindUsername = process.env.WX_DEFAULT_USERNAME || "admin";
      user = dbUsers.find((u: any) => u.username === bindUsername) || dbUsers[0];
      if (user) {
        user.wxOpenId = openid;
        try {
          const db = await getDb();
          await db.query(`UPDATE users SET wx_open_id = $1 WHERE id = $2;`, [openid, user.id]);
        } catch (e) {
          console.warn("[WxLogin] openid 落库失败（不影响本次登录）:", (e as any)?.message);
        }
      }
    }

    if (!user) {
      return res.status(401).json({ error: "未找到可绑定的企业账号，请先在 Web 端绑定工号", code: "WX_NO_ACCOUNT" });
    }

    addAuditLog(req, {
      actionType: "LOGIN",
      module: "认证中心",
      detail: `微信小程序端登录成功 [${user.name} - ${user.roleTitle}]${devMode ? " (开发态降级模式)" : ""}`,
      status: "SUCCESS",
      metadata: { userId: user.id, openid, devMode, client: "MiniProgram" },
    });

    res.json({
      token: signJwtToken(user),
      tokenType: "bearer",
      expiresIn: 480 * 60,
      openid,
      unionid,
      devMode,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        roleTitle: user.roleTitle,
        department: user.department,
        phone: user.phone,
        email: user.email,
        permissions: user.permissions,
        avatar: user.avatar || "",
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: "微信登录异常: " + err.message, code: "WX_LOGIN_ERROR" });
  }
}
