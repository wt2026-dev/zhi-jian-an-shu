// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import fs from "fs";
import path from "path";
import { getDb, getQueryStats } from "../../db/db.ts";
import { buildOpenApiSpec } from "../../openapi.ts";
import { aiCache, aiCacheClear, cacheStats } from "../../utils/aiCache.ts";
import { XINGYUN_APP_ID, XINGYUN_APP_SECRET } from "../utils/config.ts";
import { perfRegistry } from "../utils/perf.ts";
import { addAuditLog } from "../services/auditService.ts";
import { AuditLogRepository } from "../../db/repositories/index.ts";

// 审计日志查询 API (GET /api/v1/audit-logs)
export async function handleGetAuditLogs(req: any, res: any) {
  try {
    const { module, actionType, status: statusQ, limit = 500 } = req.query;
    const list = await AuditLogRepository.getAll({
      module: module as string,
      actionType: actionType as string,
      status: statusQ as string,
      limit: Number(limit),
    });
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: "获取审计日志失败: " + err.message });
  }
}

// 管理端点（P1-4 缓存统计 / P2-8 监控指标）
export function handleAdminAiStats(_req: any, res: any) {
  var cs = cacheStats;
  var total = cs.hits + cs.misses;
  res.json({
    hits: cs.hits, misses: cs.misses,
    hitRate: total ? Number(((cs.hits / total) * 100).toFixed(1)) : 0,
    savedApiCalls: cs.savedApiCalls, sets: cs.sets, evictions: cs.evictions,
    cacheSize: aiCache.size(), byType: cs.byType,
  });
}

export function handleAdminAiCacheClear(req: any, res: any) {
  var removed = aiCacheClear(req.body && req.body.type);
  addAuditLog(req, {
    actionType: "ADMIN_AI_CACHE_CLEAR", module: "ai",
    detail: `清除 AI 缓存${req.body && req.body.type ? "（类型: " + req.body.type + "）" : "（全部）"}，共 ${removed} 条`,
    status: "SUCCESS", metadata: { removed: removed, type: req.body && req.body.type },
  });
  res.json({ success: true, removed: removed });
}

export async function handleHealthDetail(_req: any, res: any) {
  var mem = process.memoryUsage();
  var osm = require("os");
  var totalMem = osm.totalmem();
  var freeMem = osm.freemem();
  var dbOk = true, dbMs = -1, dbType = "unknown";
  try {
    var t0 = Date.now();
    var db = await getDb();
    dbType = db.type;
    await db.query("SELECT 1");
    dbMs = Date.now() - t0;
  } catch (e: any) { dbOk = false; }
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? "ok" : "degraded",
    uptimeSeconds: Math.round(process.uptime()),
    checks: {
      database: { ok: dbOk, responseMs: dbMs, type: dbType },
      memory: {
        rssMb: Number((mem.rss / 1024 / 1024).toFixed(1)),
        heapUsedMb: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
        systemFreeMb: Number((freeMem / 1024 / 1024).toFixed(0)),
        systemTotalMb: Number((totalMem / 1024 / 1024).toFixed(0)),
        usagePercent: Number(((1 - freeMem / totalMem) * 100).toFixed(1)),
      },
      ai: { dashscopeConfigured: !!process.env.DASHSCOPE_API_KEY, model: process.env.DASHSCOPE_MODEL || "qwen-plus" },
      version: "2.0.0",
    },
  });
}

export async function handleAdminMetrics(_req: any, res: any) {
  var now = Date.now();
  var recent = perfRegistry.requests.filter(function (r) { return r.at > now - 60 * 1000; });
  var all = perfRegistry.requests;
  var sorted = all.map(function (r) { return r.ms; }).sort(function (a: number, b: number) { return a - b; });
  var p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
  var errors = all.filter(function (r) { return r.status >= 500; }).length;
  var routeMap: Record<string, { count: number; totalMs: number; errors: number }> = {};
  all.forEach(function (r) {
    var key = r.method + " " + r.path.split("?")[0];
    if (!routeMap[key]) routeMap[key] = { count: 0, totalMs: 0, errors: 0 };
    routeMap[key].count += 1; routeMap[key].totalMs += r.ms;
    if (r.status >= 500) routeMap[key].errors += 1;
  });
  var mem = process.memoryUsage();
  var cs = cacheStats;
  var total = cs.hits + cs.misses;
  var dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  var dayStartMs = dayStart.getTime();
  var db = await getDb();
  var ordersToday = await db.query("SELECT COUNT(*)::int AS c FROM work_orders WHERE created_timestamp >= $1", [dayStartMs]);
  var completedToday = await db.query("SELECT COUNT(*)::int AS c FROM work_orders WHERE status = 'completed' AND accepted_by_inspector_at LIKE $1", [new Date().toLocaleDateString("zh-CN") + "%"]);
  var mttr = await db.query("SELECT COALESCE(AVG((repair_log->>'workHours')::numeric), 0)::numeric(10,2) AS v FROM work_orders WHERE status = 'completed' AND repair_log IS NOT NULL");
  var eqStats = await db.query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status IN ('fault','overhauling'))::int AS faulty FROM equipments");
  var insp = await db.query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'completed')::int AS completed, COALESCE(SUM(abnormal_count),0)::int AS abnormal FROM inspections");
  var aiCalls = await db.query("SELECT COUNT(*)::int AS c FROM audit_logs WHERE module = 'ai' AND action_type LIKE 'AI_%'");
  res.json({
    performance: {
      qpsLast60s: Number((recent.length / 60).toFixed(2)),
      avgResponseMs: all.length ? Number((all.reduce(function (s, r) { return s + r.ms; }, 0) / all.length).toFixed(1)) : 0,
      p95ResponseMs: p95,
      errorRate: all.length ? Number((errors / all.length * 100).toFixed(2)) : 0,
      samples: all.length,
      routes: Object.keys(routeMap).map(function (k) {
        var r = routeMap[k];
        return { route: k, count: r.count, avgMs: Number((r.totalMs / r.count).toFixed(1)), errors: r.errors };
      }),
      database: getQueryStats(),
    },
    system: {
      rssMb: Number((mem.rss / 1024 / 1024).toFixed(1)),
      heapUsedMb: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
      uptimeSeconds: Math.round(process.uptime()),
    },
    business: {
      ordersToday: ordersToday.rows[0].c,
      completedToday: completedToday.rows[0].c,
      avgRepairHours: Number(mttr.rows[0].v || 0),
      equipmentTotal: eqStats.rows[0].total,
      equipmentFaulty: eqStats.rows[0].faulty,
      faultRate: eqStats.rows[0].total ? Number((eqStats.rows[0].faulty / eqStats.rows[0].total * 100).toFixed(1)) : 0,
      inspectionsTotal: insp.rows[0].total,
      inspectionsCompleted: insp.rows[0].completed,
      inspectionCompletionRate: insp.rows[0].total ? Number((insp.rows[0].completed / insp.rows[0].total * 100).toFixed(1)) : 0,
      inspectionAbnormal: insp.rows[0].abnormal,
      aiCallsTotal: aiCalls.rows[0].c,
    },
    aiCache: {
      hits: cs.hits, misses: cs.misses,
      hitRate: total ? Number((cs.hits / total * 100).toFixed(1)) : 0,
      savedApiCalls: cs.savedApiCalls, cacheSize: aiCache.size(),
      recentAlerts: perfRegistry.alerts.slice(-5),
    },
  });
}

// API 文档（Swagger UI）
export function handleApiDocsJson(_req: any, res: any) {
  res.json(buildOpenApiSpec());
}

// API Health Endpoint
export function handleApiHealth(req: any, res: any) {
  res.json({
    status: "ok",
    version: "2.0.0",
    system: "设备检修知识检索与作业系统",
    hasAiKey: !!process.env.DASHSCOPE_API_KEY,
    timestamp: new Date().toISOString(),
  });
}

// 魔珐星云数字人配置状态接口 (无密钥时优雅降级告知前端)
export function handleDigitalHumanStatus(req: any, res: any) {
  const configured = !!(XINGYUN_APP_ID && XINGYUN_APP_SECRET);
  res.json({
    configured,
    appId: configured ? XINGYUN_APP_ID.slice(0, 4) + "****" : null,
    message: configured ? "魔珐星云数字人服务已就绪" : "数字人服务未配置：缺少 XINGYUN_APP_ID / XINGYUN_APP_SECRET 环境变量",
    degraded: !configured,
  });
}

// 接收前端浏览器运行时异常
export function handleDebugLog(req: any, res: any) {
  console.error(">>> [CLIENT_RUNTIME_ERROR]:", JSON.stringify(req.body, null, 2));
  try {
    fs.appendFileSync("/tmp/client_runtime_errors.log", JSON.stringify({ time: new Date().toISOString(), ...req.body }) + "\n");
  } catch (e) {}
  res.json({ received: true });
}

// 全量源码工程打包下载 ZIP
export async function handleDownloadZip(req: any, res: any) {
  try {
    // archiver v8（纯 ESM）导出 ZipArchive 等类，不再提供 v7 的 archiver("zip", opts) 工厂函数；
    // ZipArchive 继承 Transform，directory/file/finalize 与 v7 同名，直接实例化即可。
    const archiverModule: any = await import("archiver").catch(() => null);
    const ZipArchive = archiverModule?.ZipArchive;
    if (typeof ZipArchive !== "function") {
      return res.status(500).json({ error: "Archiver module is not available" });
    }

    const archive = new ZipArchive({
      zlib: { level: 9 },
    });

    res.attachment("smart-plant-maintenance.zip");

    archive.on("error", (err: any) => {
      console.error("Archive error:", err);
      if (!res.headersSent) {
        res.status(500).send({ error: err.message });
      }
    });

    archive.pipe(res);

    const rootDir = process.cwd();

    const dirsToInclude = ["src", "public", "backend"];
    for (const dir of dirsToInclude) {
      const fullDir = path.join(rootDir, dir);
      if (fs.existsSync(fullDir)) {
        archive.directory(fullDir, dir);
      }
    }

    const filesToInclude = [
      "package.json",
      "tsconfig.json",
      "vite.config.ts",
      "server.ts",
      "metadata.json",
      "index.html",
      ".env.example",
      ".gitignore",
      "README.md",
      "Dockerfile",
      "docker-compose.yml",
    ];

    for (const file of filesToInclude) {
      const fullFile = path.join(rootDir, file);
      if (fs.existsSync(fullFile)) {
        archive.file(fullFile, { name: file });
      }
    }

    archive.finalize();
  } catch (err: any) {
    console.error("Zip download error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
}
