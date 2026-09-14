import "express-async-errors";
import express from "express";
import path from "path";
import fs from "fs";
import helmet from "helmet";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import { initDatabase, getDb } from "../db/db.ts";
import { createEmbedding } from "./services/aiClient.ts";
import { ensureAiModelSeed } from "./services/aiModelRouter.ts";
import { initAuthCache } from "./services/authService.ts";
import { installAuditHook } from "./services/auditService.ts";
import { loadSafetyPermitsIntoMemory } from "./controllers/safetyController.ts";
import { requestLogger } from "./middleware/requestLogger.ts";
import { globalLimiter, aiLimiter } from "./middleware/rateLimit.ts";
import { globalAuthGuard } from "./middleware/auth.ts";
import { globalErrorHandler } from "./middleware/errorHandler.ts";
import { logger } from "../utils/logger.ts";
import { UPLOADS_DIR } from "./utils/config.ts";
import { registerSystemRoutes } from "./routes/system.ts";
import { registerDashboardRoutes } from "./routes/dashboard.ts";
import { registerSseRoutes } from "./routes/sse.ts";
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

// 重构说明：本文件为应用装配与启动入口，自 server.ts（原 7329 行单文件）拆出。
// 各业务域路由/控制器/服务见同目录 routes/、controllers/、services/、middleware/、schemas/、utils/。
// 路由注册顺序与原 server.ts 首次出现顺序一致（唯一同路径重复注册的 GET /api/v1/admin/ai-stats
// 保持 system.ts（requireRole 版）先于 ai.ts（requireAuth 版），与原行为一致）。

// ==================== 主服务启动与 App 工厂函数 ====================

export async function createApp() {
  // 1. 初始化真实 PostgreSQL 数据库 (自动执行建表迁移与初始化种子)
  await initDatabase();

  const app = express();
  const PORT = 3000;

  // 2. 加权 Helmet 安全响应头
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  // 3. 可配置 CORS 白名单
  const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((s) => s.trim())
    : ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:5173", "http://127.0.0.1:5173"];

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS blocked for origin: ${origin}`));
        }
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: "120mb" }));
  app.use(express.urlencoded({ extended: true, limit: "120mb" }));

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

  // 故意触发异常测试端点 (用于验证全局 500 异常捕捉)
  app.get("/api/v1/test/error", async (req, res) => {
    throw new Error("故意触发的模拟未捕获异步异常 (Test Exception)");
  });

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
  registerSseRoutes(app); // AI 流式输出（SSE）
  // 注意：legacy /api/ai/* 兼容层已完全下线并由 /api/v1/ai/* 统一接管
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
    console.warn("[Knowledge] 存量向量回填未完成，将在下次启动重试:", err.message);
  }
}

export async function startServer() {
  const app = await createApp();
  const PORT = Number(process.env.PORT) || 3000;

  const distIndex = path.join(process.cwd(), "dist", "index.html");
  if (process.env.NODE_ENV === "production" || (fs.existsSync(distIndex) && process.argv[1]?.includes(".cjs"))) {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else if (process.env.NODE_ENV !== "test") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Industrial Ops System v2.0.0] Server running at http://0.0.0.0:${PORT}`);
  });
}

if (process.env.NODE_ENV !== "test") {
  startServer();
}
