// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import bcrypt from "bcryptjs";
import { getDb } from "../../db/db.ts";
import { UserRepository } from "../../db/repositories/index.ts";
import { addAuditLog, getClientIp } from "../services/auditService.ts";
import { signJwtToken, revokeToken, authenticateBearer, reloadUsers } from "../services/authService.ts";
import { checkLoginBruteForce, recordLoginFailure, recordLoginSuccess } from "../middleware/rateLimit.ts";
import { WECHAT_APP_ID, WECHAT_APP_SECRET } from "../utils/config.ts";

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

  // 1.1 账号状态校验：被停用用户拒绝登录并写审计拦截
  if (user && user.status && user.status !== "active") {
    addAuditLog(req, {
      actionType: "LOGIN",
      module: "认证中心",
      detail: `[用户已被停用] 账号 [${user.name} - ${user.username}] 尝试登录系统，已被拦截拒绝`,
      status: "BLOCKED",
      metadata: { username, ip, userId: user.id },
    });
    return res.status(403).json({ error: "该账号已被停用，请联系管理员", code: "USER_DISABLED" });
  }

  let isPasswordValid = false;

  if (user && user.password) {
    if (user.password.startsWith("$2a$") || user.password.startsWith("$2b$") || user.password.startsWith("$2y$")) {
      isPasswordValid = await bcrypt.compare(password, user.password);
    } else {
      // 兼容平滑升级旧明文密码（任务 3 加固）
      if (process.env.NODE_ENV === "production") {
        addAuditLog(req, {
          actionType: "INSECURE_PASSWORD_DETECTED",
          module: "认证中心",
          detail: `[安全拦截] 生产环境检测到账号 [${user.username}] 使用明文密码存储，拒绝登录`,
          status: "BLOCKED",
          metadata: { username, ip, userId: user.id },
        });
        return res.status(403).json({
          error: "生产环境禁止使用明文密码登录，请联系管理员升级强哈希密码",
          code: "INSECURE_PASSWORD_DETECTED",
        });
      }

      // 开发/测试环境：校验明文匹配及强度下限（长度 >= 8，含字母+数字）
      isPasswordValid = user.password === password;
      if (isPasswordValid) {
        const hasLetter = /[a-zA-Z]/.test(password);
        const hasDigit = /\d/.test(password);
        const isStrongEnough = password.length >= 8 && hasLetter && hasDigit;

        if (!isStrongEnough) {
          addAuditLog(req, {
            actionType: "LOGIN",
            module: "认证中心",
            detail: `账号 [${user.username}] 明文密码强度不达标 (长度需>=8且含字母和数字)，拒绝自动升级登录`,
            status: "BLOCKED",
            metadata: { username, ip, userId: user.id },
          });
          return res.status(400).json({
            error: "密码安全强度不足：密码长度需至少8位且同时包含字母与数字，请联系管理员重置",
            code: "PASSWORD_TOO_WEAK",
          });
        }

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
      status: u.status || "active",
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
    if (user.status && user.status !== "active") {
      return res.status(403).json({ error: "目标用户已被停用，禁止切换身份", code: "USER_DISABLED" });
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
        status: user.status || "active",
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: "用户切换失败: " + err.message });
  }
}

// 管理员专用：更新用户状态 API（启用/停用）
export async function handleUpdateUserStatus(req: any, res: any) {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    if (!status || (status !== "active" && status !== "disabled")) {
      return res.status(400).json({
        error: "状态参数不合法，仅支持 'active' 或 'disabled'",
        code: "INVALID_STATUS",
      });
    }

    // 校验不允许操作自身账号
    if (req.currentUser && (req.currentUser.id === id || req.currentUser.username === id)) {
      return res.status(400).json({
        error: "安全策略限制：不允许操作自身账号的启用/停用状态",
        code: "SELF_STATUS_CHANGE_FORBIDDEN",
      });
    }

    const dbUsers = await UserRepository.getAllUsers();
    const targetUser = dbUsers.find((u) => u.id === id || u.username === id);
    if (!targetUser) {
      return res.status(404).json({ error: "目标用户不存在", code: "USER_NOT_FOUND" });
    }

    const prevStatus = targetUser.status || "active";
    await UserRepository.updateStatus(targetUser.id, status);
    await reloadUsers();

    addAuditLog(req, {
      actionType: "USER_STATUS_CHANGE",
      module: "用户与权限",
      detail: `管理员 [${req.currentUser.name}] 将用户 [${targetUser.name} - ${targetUser.username}] 状态从 [${prevStatus}] 修改为 [${status}]`,
      status: "SUCCESS",
      metadata: {
        operatorId: req.currentUser.id,
        operatorUsername: req.currentUser.username,
        targetUserId: targetUser.id,
        targetUsername: targetUser.username,
        prevStatus,
        newStatus: status,
      },
    });

    res.json({
      success: true,
      message: `用户 [${targetUser.name}] 状态已成功更新为 [${status}]`,
      user: {
        id: targetUser.id,
        username: targetUser.username,
        name: targetUser.name,
        role: targetUser.role,
        status,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: "修改用户状态失败: " + err.message, code: "UPDATE_STATUS_ERROR" });
  }
}

// ==================== 15.5 微信小程序登录 (wx.login → code2session) ====================
// 生产环境：配置 WECHAT_APP_ID / WECHAT_APP_SECRET 后走真实 code2session 换取 openid；未配置时直接 503 拒绝降级。
// 非生产环境（开发/测试）：未配置微信凭据时，需显式设置 WX_DEFAULT_USERNAME 且角色不可为 admin/manager，降级为 code 派生的稳定 openid。
export async function handleWxLogin(req: any, res: any) {
  try {
    const code = String(req.body?.code || "").trim();
    if (!code) {
      return res.status(400).json({ error: "缺少 wx.login 返回的 code", code: "INVALID_INPUT" });
    }

    const appid = process.env.WECHAT_APP_ID;
    const secret = process.env.WECHAT_APP_SECRET;
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
      // 1. 生产环境禁止降级
      if (process.env.NODE_ENV === "production") {
        return res.status(503).json({
          error: "微信小程序凭证未配置 (WECHAT_APP_ID / WECHAT_APP_SECRET 缺失)，生产环境严禁降级登录",
          code: "WECHAT_SERVICE_UNCONFIGURED",
        });
      }

      // 2. 开发态降级加固：必须显式配置 WX_DEFAULT_USERNAME
      const bindUsername = process.env.WX_DEFAULT_USERNAME;
      if (!bindUsername) {
        return res.status(401).json({
          error: "微信开发态降级未配置绑定账号，请显式设置环境变量 WX_DEFAULT_USERNAME",
          code: "WX_DEV_LOGIN_UNCONFIGURED",
        });
      }

      // 3. 目标账号角色限制：严禁降级绑定 admin / manager 高权限账号
      const dbUsers = (await UserRepository.getAllUsers()) as any[];
      const targetUser = dbUsers.find((u: any) => u.username === bindUsername);
      if (!targetUser) {
        return res.status(401).json({
          error: `微信开发态指定的降级绑定账号 [${bindUsername}] 不存在`,
          code: "WX_DEV_USER_NOT_FOUND",
        });
      }
      if (targetUser.role === "admin" || targetUser.role === "manager") {
        return res.status(401).json({
          error: "安全策略限制：微信开发态降级禁止绑定管理员或主管账号 (role 不得为 admin/manager)",
          code: "WX_DEV_FORBIDDEN_ROLE",
        });
      }

      // 4. 开发态降级：由 code 派生稳定 openid（FNV-1a），保留 dev_ 前缀
      let h = 0x811c9dc5;
      for (let i = 0; i < code.length; i++) {
        h ^= code.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
      openid = "dev_" + h.toString(16).padStart(8, "0");
      devMode = true;
    }

    // openid 与既有工号账号绑定：优先按 openid 命中，未绑定且在开发态时按经过校验的 WX_DEFAULT_USERNAME 绑定
    const dbUsers = (await UserRepository.getAllUsers()) as any[];
    let user: any = dbUsers.find((u: any) => (u.wxOpenId && u.wxOpenId === openid) || (u as any).wx_open_id === openid);
    if (!user && devMode) {
      const bindUsername = process.env.WX_DEFAULT_USERNAME;
      user = dbUsers.find((u: any) => u.username === bindUsername);
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

    // 检查用户是否被禁用
    if (user.status && user.status !== "active") {
      addAuditLog(req, {
        actionType: "LOGIN",
        module: "认证中心",
        detail: `[用户已被停用] 微信小程序端登录尝试 [${user.name} - ${user.username}] 已被拦截拒绝`,
        status: "BLOCKED",
        metadata: { userId: user.id, openid, devMode, client: "MiniProgram" },
      });
      return res.status(403).json({ error: "该账号已被停用，请联系管理员", code: "USER_DISABLED" });
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
        status: user.status || "active",
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: "微信登录异常: " + err.message, code: "WX_LOGIN_ERROR" });
  }
}
