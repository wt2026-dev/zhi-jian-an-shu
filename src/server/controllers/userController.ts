// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { getDb } from "../../db/db.ts";
import { UserRepository } from "../../db/repositories/index.ts";
import { addAuditLog } from "../services/auditService.ts";
import { UPLOADS_DIR } from "../utils/config.ts";

// ==================== 15.6 用户头像上传与持久化 (小程序 /api/v1/user/avatar) ====================
export async function handleUploadAvatar(req: any, res: any) {
  try {
    const avatarUrlInput = req.body?.avatarUrl;
    const imageBase64 = String(req.body?.imageBase64 || "");

    let url = "";
    let safeFilename = "";
    let bufferLength = 0;

    if (avatarUrlInput && typeof avatarUrlInput === "string" && !imageBase64) {
      url = avatarUrlInput.trim();
      bufferLength = url.length;
    } else if (imageBase64) {
      // 支持 jpg, png, webp, svg
      const headerMatch = imageBase64.match(/^data:image\/(jpeg|jpg|png|webp|svg\+xml);(base64|utf8),?/i);
      if (!headerMatch) {
        return res.status(400).json({ error: "非法图片类型！仅支持 jpg、png、webp、svg 格式", code: "INVALID_FILE_TYPE" });
      }

      const isSvgUtf8 = headerMatch[2].toLowerCase() === 'utf8';
      const cleanData = imageBase64.replace(/^data:image\/\w+(\+xml)?;(base64|utf8),?/, "");
      const buffer = isSvgUtf8 ? Buffer.from(decodeURIComponent(cleanData), "utf-8") : Buffer.from(cleanData, "base64");
      bufferLength = buffer.length;

      // 头像单文件上限 5MB
      const MAX_SIZE = 5 * 1024 * 1024;
      if (buffer.length > MAX_SIZE) {
        return res.status(413).json({
          error: `头像过大，不能超过 5MB (实测: ${(buffer.length / (1024 * 1024)).toFixed(2)} MB)`,
          code: "PAYLOAD_TOO_LARGE",
        });
      }

      let ext = ".jpg";
      const fmt = headerMatch[1].toLowerCase();
      if (fmt === "png") ext = ".png";
      else if (fmt === "webp") ext = ".webp";
      else if (fmt.includes("svg")) ext = ".svg";

      safeFilename = `avatar_${req.currentUser.id.replace(/[^a-zA-Z0-9_-]/g, "")}_${Date.now()}${ext}`;
      await fs.promises.writeFile(path.join(UPLOADS_DIR, safeFilename), buffer);
      url = `/uploads/${safeFilename}`;
    } else {
      return res.status(400).json({ error: "缺少头像图片数据 (imageBase64 或 avatarUrl)", code: "INVALID_INPUT" });
    }

    // 落库 + 同步内存用户缓存（保证 /auth/me 与后续请求即时生效）
    try {
      const db = await getDb();
      await db.query(`UPDATE users SET avatar = $1 WHERE id = $2;`, [url, req.currentUser.id]);
    } catch (e) {
      console.warn("[Avatar] 头像 URL 落库失败（仅内存生效）:", (e as any)?.message);
    }
    // req.currentUser 即 authService 用户缓存中的对象引用，更新其 avatar 等价于原 dbUsers[idx].avatar = url 的缓存同步
    req.currentUser.avatar = url;

    addAuditLog(req, {
      actionType: "AVATAR_UPDATE",
      module: "用户中心",
      detail: `用户 [${req.currentUser.name}] 更新了个人头像 (${(bufferLength / 1024).toFixed(1)} KB)`,
      status: "SUCCESS",
      metadata: { filename: safeFilename, url, sizeBytes: bufferLength },
    });

    res.json({ success: true, url, avatarUrl: url, filename: safeFilename });
  } catch (err: any) {
    res.status(500).json({ error: "头像上传失败: " + err.message });
  }
}

// 管理员创建用户账号
export async function handleCreateUser(req: any, res: any) {
  try {
    const { username, name, password, role, roleTitle, department, phone, email, permissions } = req.body;

    const existing = await UserRepository.getUserByUsername(username);
    if (existing) {
      return res.status(409).json({ error: `用户名 ${username} 已存在`, code: "USERNAME_CONFLICT" });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const created = await UserRepository.create({
      username,
      name,
      password: passwordHash,
      role,
      roleTitle,
      department,
      phone,
      email,
      permissions: permissions || ["read", "create_order"],
    });

    addAuditLog(req, {
      actionType: "USER_CREATE",
      module: "用户与权限",
      detail: `管理员 ${req.currentUser.name} 创建用户账号 [${name} / ${username}]，角色 ${role}`,
      status: "SUCCESS",
      metadata: { userId: created?.id, username, role },
    });

    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: "创建用户失败: " + err.message });
  }
}
