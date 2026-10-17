import "express-async-errors";
import express from "express";
import path from "path";
import fs from "fs";
import { existsSync } from "fs";
import helmet from "helmet";
import cors from "cors";
// 说明：vite 仅在开发模式（isDevMode 分支）按需动态 import，生产运行时无需安装 vite，
// 因此 vite 归入 devDependencies，生产镜像 `npm ci --omit=dev` 不再拉取它。
import { initDatabase, getDb } from "../db/db.ts";
import { syncVideoHistoryWithSnapshot } from "../db/videoHistorySnapshot.ts";
import { createEmbedding } from "./services/aiClient.ts";
import { ensureAiModelSeed } from "./services/aiModelRouter.ts";
import { initAuthCache, verifyJwtToken } from "./services/authService.ts";
import { installAuditHook } from "./services/auditService.ts";
import { loadSafetyPermitsIntoMemory } from "./controllers/safetyController.ts";
import { requestLogger } from "./middleware/requestLogger.ts";
import { globalLimiter, aiLimiter } from "./middleware/rateLimit.ts";
import { globalAuthGuard } from "./middleware/auth.ts";
import { globalErrorHandler } from "./middleware/errorHandler.ts";
import { logger } from "../utils/logger.ts";
import { UPLOADS_DIR } from "./utils/config.ts";
import { ProcedureVideoRepository } from "../db/repositories/index.ts";
import { sweepStaleVideoTasks } from "./services/videoGenerationService.ts";
import { registerSystemRoutes } from "./routes/system.ts";
import { registerDashboardRoutes } from "./routes/dashboard.ts";
import { registerEquipmentRoutes } from "./routes/equipment.ts";
import { registerWorkOrderRoutes } from "./routes/workorders.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerUserRoutes } from "./routes/users.ts";
import { registerSafetyRoutes } from "./routes/safety.ts";
import { registerNotificationRoutes } from "./routes/notifications.ts";
import { registerInspectionRoutes } from "./routes/inspection.ts";
import { registerKnowledgeRoutes } from "./routes/knowledge.ts";
import { registerProcedureRoutes } from "./routes/procedures.ts";
import { registerUploadRoutes } from "./routes/upload.ts";
import { registerAiRoutes } from "./routes/ai.ts";
import { registerSparePartsRoutes } from "./routes/spareParts.ts";
import { registerHazardRoutes } from "./routes/hazards.ts";
import { registerWechatRoutes } from "./routes/wechat.ts";
import { registerWxRoutes } from "./routes/wx.ts";
import { registerDispatchRoutes } from "./routes/dispatch.ts";
import { registerFactoryRoutes } from "./routes/factories.ts";
import { registerExplodedViewRoutes } from "./routes/explodedView.ts";
import { registerFieldOpsRoutes } from "./routes/fieldOps.ts";

// 重构说明：本文件为应用装配与启动入口，自 server.ts（原 7329 行单文件）拆出。
// 各业务域路由/控制器/服务见同目录 routes/、controllers/、services/、middleware/、schemas/、utils/。
// 路由注册顺序与原 server.ts 首次出现顺序一致（唯一同路径重复注册的 GET /api/v1/admin/ai-stats
// 保持 system.ts（requireRole 版）先于 ai.ts（requireAuth 版），与原行为一致）。

// ==================== 主服务启动与 App 工厂函数 ====================

export async function createApp() {
  // 1. 初始化真实 PostgreSQL 数据库 (自动执行建表迁移与初始化种子)
  await initDatabase();

  // 1b. 视频生成历史自愈：`procedure_videos` 不在 seed-data 里，而 PGlite 数据目录一旦被
  //     非正常终止（SIGKILL / 沙箱回收）就会损坏并被改名重建 —— 重建后这张表是空的，
  //     历史会被静默清空（其它业务表全被重新灌满，看不出异常）。这里按磁盘快照回填。
  //     详见 src/db/videoHistorySnapshot.ts。
  try {
    await syncVideoHistoryWithSnapshot();
  } catch (e: any) {
    console.warn("[VideoHistory] 快照同步失败（不影响启动）:", e?.message || e);
  }

  const app = express();
  const PORT = 3000;

  // 2. 加权 Helmet 安全响应头
  // ==================== Content Security Policy（内容安全策略）精准白名单 ====================
  // 设计决策：不使用 contentSecurityPolicy: false（等于放弃防 XSS 第一道防线）；
  // 改为显式枚举白名单，覆盖本系统已知第三方来源：
  //   - 高德地图 JS API (webapi.amap.com / restapi.amap.com)
  //   - 阿里云百炼 DashScope (dashscope.aliyuncs.com)
  //   - 魔珐星云数字人 (dhplayer.moxian.ai)
  // unsafe-inline 保留原因：
  //   ① React 内联样式 (style= 属性)，迁移到 CSS Modules 可消除
  //   ② Vite 开发模式 HMR 注入内联脚本，生产构建后可用 nonce 替代
  //   ③ TailwindCSS v4 JIT 模式生成的类名带 <style> 注入
  // 后续加固路径：引入 nonce 中间件（每请求生成随机 nonce）可去除 unsafe-inline。
  // HTTP 直连部署（无 TLS 反代）时必须设 DISABLE_HSTS=1：
  //   helmet 默认下发 CSP upgrade-insecure-requests 与 Strict-Transport-Security，
  //   会让浏览器把所有子资源强制升级为 https://，在纯 HTTP 环境下全部
  //   ERR_SSL_PROTOCOL_ERROR，页面白屏（服务器无 TLS 可回落）。
  //   走 HTTPS 反代部署时不要设置该变量，保持完整安全头。
  const isPlainHttpDeployment = process.env.DISABLE_HSTS === "1";
  app.use(
    helmet({
      strictTransportSecurity: isPlainHttpDeployment ? false : undefined,
      contentSecurityPolicy: {
        directives: {
          ...(isPlainHttpDeployment ? { upgradeInsecureRequests: null } : {}),
          defaultSrc:  ["'self'"],
          scriptSrc:   ["'self'", "'unsafe-inline'", "'unsafe-eval'",
                        "webapi.amap.com", "restapi.amap.com", "*.amap.com",
                        "dhplayer.moxian.ai",
                        // public/exploded/*.html 拆解视图静态页依赖的 CDN：
                        "cdnjs.cloudflare.com", "cdn.jsdelivr.net", "cdn.tailwindcss.com"],
          // 拆解页大量使用内联事件（onclick=...），helmet 默认 script-src-attr 'none' 会拦
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc:    ["'self'", "'unsafe-inline'", "*.amap.com",
                        "fonts.googleapis.com", "cdn.tailwindcss.com"],
          imgSrc:      ["'self'", "data:", "blob:", "*.amap.com", "*.aliyuncs.com",
                        "*.aliyun.com"],
          connectSrc:  ["'self'", "blob:",
                        "dashscope.aliyuncs.com", "api.dashscope.aliyuncs.com",
                        "*.amap.com", "restapi.amap.com",
                        "dhplayer.moxian.ai",
                        "ws://localhost:*", "wss://localhost:*"],   // Vite HMR
          fontSrc:     ["'self'", "data:", "fonts.gstatic.com"],
          mediaSrc:    ["'self'", "blob:", "*.aliyuncs.com"],
          // 'self' 而非 'none'：Godot 导出页（/godot-maze、/godot-game-2d）以同源
          // iframe 挂载，'none' 会在生产（下方 reportOnly=false）把引擎整个拦掉。
          frameSrc:    ["'self'"],
          objectSrc:   ["'none'"],
          baseUri:     ["'self'"],
          formAction:  ["'self'"],
          // frameAncestors 防止 Clickjacking（替代 X-Frame-Options）：'self' 仍拒绝
          // 任何第三方站点框入本页，只放行自家页面嵌自家页面（Godot iframe 需要）。
          frameAncestors: ["'self'"],
        },
        // 仅在开发模式报告 CSP 违规到控制台，不阻断（生产改为 enforce）
        reportOnly: process.env.NODE_ENV !== "production",
      },
      // crossOriginEmbedderPolicy 关闭原因：高德地图使用跨域 Worker，
      // 启用 COEP 会阻断地图加载；待迁移至 COOP/COEP 兼容方案后可开启。
      crossOriginEmbedderPolicy: false,
    })
  );

  // 3. 可配置 CORS 白名单
  const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((s) => s.trim())
    : ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:5173", "http://127.0.0.1:5173", "https://servicewechat.com"];

  // 3.1 CSRF 兜底防护：针对有状态写方法 (POST/PUT/PATCH/DELETE) 校验 Origin/Referer 与白名单一致
  app.use((req, res, next) => {
    const method = req.method.toUpperCase();
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      // Bearer token 认证的 API 请求免疫 CSRF：跨站请求无法自动携带自定义 Authorization 头，
      // 该通道覆盖小程序（wx.request 强制携带 Referer: https://servicewechat.com）与自动化测试。
      // 收紧点：判据必须是"令牌验签通过"，而不是"请求头存在且以 Bearer 开头"。
      // 原实现只看前缀，任意请求伪造一个 Bearer 字符串即可整体跳过 CSRF 校验。
      const authHeader = req.headers["authorization"];
      if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        const bearerToken = authHeader.slice("Bearer ".length).trim();
        if (bearerToken && verifyJwtToken(bearerToken)) {
          return next();
        }
      }
      const origin = req.headers["origin"];
      const referer = req.headers["referer"];

      // 允许非浏览器直接 API 客户端（无 Origin 且无 Referer，如自动化测试、curl 等）
      if (!origin && !referer) {
        return next();
      }

      let reqOrigin = "";
      if (origin && typeof origin === "string") {
        reqOrigin = origin;
      } else if (referer && typeof referer === "string") {
        try {
          reqOrigin = new URL(referer).origin;
        } catch {
          return res.status(403).json({ error: "CSRF 校验失败: 非法 Referer 来源", code: "CSRF_FORBIDDEN" });
        }
      }

      if (reqOrigin && !allowedOrigins.includes(reqOrigin)) {
        return res.status(403).json({
          error: `CSRF 校验失败: 请求来源 ${reqOrigin} 未在受信任白名单中`,
          code: "CSRF_FORBIDDEN",
        });
      }
    }
    next();
  });

  // 3.2 CORS 跨域资源共享配置
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      credentials: true,
    })
  );

  // 工业安全加固：全局 JSON / URL-encoded 请求体上限收紧至工业标准 2MB，防止恶意大报文拒绝服务攻击 (DoS)
  // 大文件 (如图片 15MB、视频 85MB) 仅在专属上传路由按需解析，跳过全局 2MB 限制
  app.use((req, res, next) => {
    if (req.originalUrl?.startsWith("/api/v1/upload/") || req.path?.startsWith("/api/v1/upload/")) {
      return next();
    }
    return express.json({ limit: "2mb" })(req, res, next);
  });
  app.use((req, res, next) => {
    if (req.originalUrl?.startsWith("/api/v1/upload/") || req.path?.startsWith("/api/v1/upload/")) {
      return next();
    }
    return express.urlencoded({ extended: true, limit: "2mb" })(req, res, next);
  });

  // 结构化 HTTP 请求日志中间件
  app.use(requestLogger);

  // ==================== 生产可观测性：健康检查与就绪探针 ====================
  // 存活健康检查端点 (Liveness Probe)
  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      service: "industrial-ops-backend",
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // 就绪健康检查端点 (Readiness Probe - 检查数据库连通性)
  app.get("/ready", async (req, res) => {
    try {
      const db = await getDb();
      await db.query("SELECT 1 AS ready_check;");
      res.json({
        status: "ready",
        database: "connected",
        dbType: db.type,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      logger.error({ err }, "Readiness database connectivity check failed");
      res.status(503).json({
        status: "unready",
        database: "disconnected",
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // 安全收口：故意触发异常的测试端点仅在测试环境下暴露，禁止流入生产环境
  if (process.env.NODE_ENV === "test") {
    app.get("/api/v1/test/error", async (req, res) => {
      throw new Error("故意触发的模拟未捕获异步异常 (Test Exception)");
    });
  }

  // 静态上传资源目录托管 (图片与视频)
  const uploadsDir = UPLOADS_DIR;
  const videosDir = path.join(uploadsDir, "videos");
  try {
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });
  } catch (e) {}
  app.use("/uploads", express.static(uploadsDir));

  // ==================== 用户与 RBAC 鉴权（PostgreSQL users 表持久化） ====================
  await initAuthCache();

  // 自愈：视频生成任务只存在于进程内存，进程重启后库里残留的 processing/queued 必为孤儿，
  // 不标记掉的话前端会一直转圈（且永远不会再有更新）。
  // 只清理超过 AGNES_STALE_AFTER_MIN（默认 60 分钟）的僵死任务，避免误杀正在慢跑的任务。
  try {
    const n = await sweepStaleVideoTasks();
    if (n > 0) console.log(`[Startup] 已把 ${n} 条僵死的视频生成任务标记为 failed`);
  } catch (e: any) {
    console.warn("[Startup] 清理僵死视频任务失败（不影响启动）:", e?.message || e);
  }

  // 自愈：核对成片产物与库内状态是否一致。
  //
  // 两个方向都要修：
  //  a) 文件被外部清走（实测工作区会清走 ≥10MiB 的大文件）但库里仍是 completed → 前端播空播放器，置 failed
  //  b) 此前被本自检**误判**为 failed 的（远程 URL 或文件其实还在）→ 恢复 completed
  //
  // ⚠️ 只能校验**本地** videoUrl：单段视频存的是 Agnes 远程 URL（https://cos-...），
  // 若不加判断就拿去 existsSync，会把好端端的远程视频误判成"成片文件已丢失"（踩过这个坑）。
  const LOST_MSG = "成片文件已丢失（可能被工作区清理），请重新生成";
  const localArtifactExists = (videoUrl?: string | null): boolean | null => {
    if (!videoUrl) return false;
    if (!videoUrl.startsWith("/")) return null; // 远程 URL：不做本地校验，视为无法判断
    const abs = path.join(UPLOADS_DIR, videoUrl.replace(/^\/uploads\//, "").replace(/^\//, ""));
    return existsSync(abs);
  };
  try {
    let lost = 0;
    let restored = 0;
    for (const v of await ProcedureVideoRepository.listByStatus("completed")) {
      if (localArtifactExists(v.videoUrl) === false) {
        await ProcedureVideoRepository.updateStatus(v.taskId, { status: "failed", error: LOST_MSG });
        lost++;
      }
    }
    for (const v of await ProcedureVideoRepository.listByStatus("failed")) {
      if (v.error !== LOST_MSG) continue;              // 只修本自检留下的，别动真正的失败
      if (localArtifactExists(v.videoUrl) === false) continue; // 确实没了，保持 failed
      await ProcedureVideoRepository.updateStatus(v.taskId, { status: "completed", error: null });
      restored++;
    }
    if (lost > 0) console.log(`[Startup] 已把 ${lost} 条成片文件缺失的完成任务标记为 failed`);
    if (restored > 0) console.log(`[Startup] 已把 ${restored} 条被误判的完成任务恢复为 completed`);
  } catch (e: any) {
    console.warn("[Startup] 校验成片文件失败（不影响启动）:", e?.message || e);
  }

  // 注入模块级 AI 审计钩子，供 AI 扩展功能的统一异常处理写审计日志
  installAuditHook();

  // 多模型路由：首次启动将 DASHSCOPE_* 环境变量落为初始模型配置（升级无感）
  await ensureAiModelSeed();

  // 全局 API 限流中间件
  app.use("/api/v1/", globalLimiter);
  // v1 AI 接口同样可能触发 DashScope 计费，须受 AI 专属限流保护。
  app.use("/api/v1/ai/", aiLimiter);

  // ==================== 全局 API 鉴权基线（默认拒绝 + 白名单放行） ====================
  // 必须在所有业务路由注册之前：/api/* 默认要求有效 JWT，白名单外漏挂 requireAuth
  // 的路由不再匿名可达（白名单见 middleware/auth.ts 的 PUBLIC_API_*）。
  app.use(globalAuthGuard);

  // ==================== 业务域路由注册（保持原 server.ts 首次注册顺序） ====================
  registerSystemRoutes(app); // 审计日志查询 / 管理 admin 接口 / 健康详情 / swagger / 数字人状态 / 调试日志 / 源码打包
  registerDashboardRoutes(app); // 驾驶舱指标
  // 注意：legacy /api/ai/* 兼容层已下线（路由文件已删除，由 /api/v1/ai/* 统一接管）；
  // AI 分析类接口不提供 /stream 双胞胎——只有对话流式（/api/v1/ai/chat/stream）有真实调用方，
  // 其余 6 个 stream 变体因零调用方连同 aiStreamController 一并移除。
  registerEquipmentRoutes(app); // 设备台账
  registerWorkOrderRoutes(app); // 检修工单全生命周期
  registerAuthRoutes(app); // 认证
  registerUserRoutes(app); // 用户与头像
  await loadSafetyPermitsIntoMemory(); // 原 createApp 中作业票内存列表启动加载（保持 await 时序）
  registerSafetyRoutes(app); // 高危作业票与 LOTO
  registerNotificationRoutes(app); // 通知中心
  registerInspectionRoutes(app); // 巡检点检
  // 知识库启动初始化：DB 刷新内存列表 + 存量向量回填（原 createApp 4240-4250 行逻辑）
  await initKnowledgeStartupState();
  registerKnowledgeRoutes(app); // 知识库与审核
  registerProcedureRoutes(app); // 维护作业指引与合规
  registerUploadRoutes(app); // 上传
  registerAiRoutes(app); // AI v1 功能
  registerSparePartsRoutes(app); // 备件
  registerHazardRoutes(app); // 隐患
  registerWechatRoutes(app); // 微信 / 星云数字人
  registerWxRoutes(app); // 微信扫码报修
  registerDispatchRoutes(app); // 内部师傅距离调度
  registerFactoryRoutes(app); // 多厂区层级（全国地图下钻）
  registerExplodedViewRoutes(app); // 拆解视图 ↔ 检修业务联动（工单跳转 / 零件维修历史）
  registerFieldOpsRoutes(app); // 拆解作业终端（现场维修闭环：LOTO / 步骤留痕 / 测量 / 照片 → 自动完工）

  // 全局异常处理中间件 (Global Error Handling Middleware)
  app.use(globalErrorHandler);

  return app;
}

/** 知识库启动状态：为历史知识回填真实 DashScope 向量；失败不伪造向量，下一次启动会继续补齐。
 *  列表/检索已统一走 KnowledgeRepository（数据库），启动时不再向内存数组灌种子。 */
async function initKnowledgeStartupState() {
  try {
    const db = await getDb();
    const { rows: missingEmbeddings } = await db.query(
      "SELECT id,title,summary,content FROM knowledge_articles WHERE embedding IS NULL AND status='approved'"
    );
    for (const article of missingEmbeddings) {
      const embedding = await createEmbedding(`${article.title}\n${article.summary}\n${article.content}`);
      await db.query("UPDATE knowledge_articles SET embedding=$2 WHERE id=$1", [article.id, JSON.stringify(embedding)]);
    }
  } catch (err: any) {
    logger.warn("[Knowledge] 存量向量回填未完成，将在下次启动重试:", err.message);
  }
}

export async function startServer() {
  const app = await createApp();
  const PORT = Number(process.env.PORT) || 3000;

  // vite 实例需在退出时一并关闭，故提升到外层作用域（仅开发模式会赋值）。
  let viteServer: { close: () => Promise<void> } | null = null;

  const distIndex = path.join(process.cwd(), "dist", "index.html");
  if (process.env.NODE_ENV === "production" || (fs.existsSync(distIndex) && process.argv[1]?.includes(".cjs"))) {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else if (process.env.NODE_ENV !== "test") {
    // 动态 import：仅开发模式加载 vite，生产镜像未安装 vite 时不报错。
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    viteServer = vite as unknown as { close: () => Promise<void> };
  }

  const httpServer = app.listen(PORT, "0.0.0.0", () => {
    logger.info(`[Industrial Ops System v2.0.0] Server running at http://0.0.0.0:${PORT}`);
  });

  // 优雅退出：先停 HTTP，再关 vite，最后关数据库。
  //
  // 背景（实测，非推测）：本机曾因进程被强杀（沙箱护栏异常 / 手动 kill）导致 PGlite
  // 数据目录损坏 —— `global/pg_control` 在启动中途被写坏后**不可修复**（PGlite 没有
  // pg_resetwal 等价物），只能把整个数据目录改名重建再重灌种子。
  // 没有退出处理时，`npm run dev` 的每次重启都是一次非正常关闭，
  // 因此补上：让数据库有机会干净落盘，显著降低再次损坏的概率。
  //
  // ⚠️ 平台限制（务必知晓，不要误以为万能）：
  // Windows 没有真正的信号。本处理只在**终端里 Ctrl+C**（SIGINT / SIGBREAK）时可靠触发，
  // 也就是用户手动停止 `npm run dev` 的常见路径。
  // 而 `taskkill /F`、`process.kill(pid)`、任务管理器结束进程、沙箱 TaskStop 等
  // **外部强杀一律绕过本处理**（Node 在 Windows 上用 TerminateProcess，不会回调 handler）。
  // 因此它降低风险但不等于保险；真正稳妥的重启方式是在终端按 Ctrl+C。
  if (process.env.NODE_ENV !== "test") {
    let closing = false;
    const shutdown = async (signal: string) => {
      if (closing) return;
      closing = true;
      logger.info(`[Shutdown] 收到 ${signal}，开始优雅关闭（停 HTTP → 关 vite → 关数据库）...`);

      // 兜底：若 10s 内未能完成（例如有长连接挂着），强制退出，避免卡死。
      const force = setTimeout(() => {
        logger.warn("[Shutdown] 超时 10s，强制退出");
        process.exit(0);
      }, 10_000);
      force.unref?.();

      try {
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        logger.info("[Shutdown] HTTP 服务已停止");
      } catch (e: any) {
        logger.warn("[Shutdown] 停止 HTTP 服务出错:", e?.message);
      }

      try {
        await viteServer?.close();
      } catch (e: any) {
        logger.warn("[Shutdown] 关闭 vite 出错:", e?.message);
      }

      try {
        const db = await getDb();
        await db.close();
        logger.info("[Shutdown] 数据库已干净关闭");
      } catch (e: any) {
        logger.warn("[Shutdown] 关闭数据库出错:", e?.message);
      }

      process.exit(0);
    };

    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGBREAK", () => void shutdown("SIGBREAK"));
  }
}

if (process.env.NODE_ENV !== "test") {
  startServer();
}
