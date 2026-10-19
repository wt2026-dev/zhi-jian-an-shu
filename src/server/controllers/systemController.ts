// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import fs from "fs";
import path from "path";
import os from "os";
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
  // ESM 修复：原为 require("os")，在 "type": "module" 下 require 未定义，
  // 会让 /health/detail 抛 ReferenceError 直接 500。改为顶层 import 后取用。
  var totalMem = os.totalmem();
  var freeMem = os.freemem();
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
  var completedToday = await db.query("SELECT COUNT(*)::int AS c FROM work_orders WHERE status = 'completed' AND (accepted_by_inspector_at LIKE $1 OR accepted_by_inspector_at LIKE $2)", [new Date().toLocaleDateString("zh-CN") + "%", new Date().toISOString().slice(0, 10) + "%"]);
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

// ==================== 运营指标（5 类核心指标，从已有表聚合） ====================
export async function handleAdminOperationalMetrics(_req: any, res: any) {
  try {
    const db = await getDb();

    // 逐个查询（PGlite 不支持并发查询，但服务端环境下逐个查询可行）
    const aiLogs = await db.query<{ id: string; created_at: string }>(
      `SELECT id, created_at FROM ai_analysis_log ORDER BY created_at`
    );
    const woRes = await db.query<{
      created_at: string; dispatched_at: string | null;
      completed_at: string | null; accepted_by_inspector_at: string | null;
    }>(
      `SELECT created_at, dispatched_at, completed_at, accepted_by_inspector_at
       FROM work_orders WHERE created_at IS NOT NULL`
    );
    const kcRes = await db.query<{ id: string }>(`SELECT id FROM ai_knowledge_contributions`);
    const permits = await db.query<{
      id: string; valid_until: string | null; closed_at: string | null;
      precautions: any; hazards: any; safety_checklist: any;
      guardian_approval: any; supervisor_approval: any;
    }>(
      `SELECT id, valid_until, closed_at,
              precautions, hazards, safety_checklist,
              guardian_approval, "supervisorApproval" as supervisor_approval
       FROM safety_permits`
    );
    const feedback = await db.query<{ status: string }>(`SELECT status FROM ai_feedback`);
    const reviews = await db.query<{ status: string }>(`SELECT status FROM ai_generation_reviews`);
    const audit = await db.query<{ status: string; action_type: string }>(
      `SELECT status, action_type FROM audit_logs`
    );

    // ===== A. AI 采纳率 =====
    const totalAiCalls = aiLogs.rows.length;
    const allWO = woRes.rows;
    const totalContributions = kcRes.rows.length;
    const aiWithWO = aiLogs.rows.filter((log) => {
      const t = new Date(log.created_at).getTime();
      return allWO.some((wo) => {
        const wt = new Date(wo.created_at).getTime();
        return wt >= t && wt <= t + 7 * 24 * 3600 * 1000;
      });
    }).length;

    // ===== B. 工单效率 =====
    const seg1: number[] = [], seg2: number[] = [], seg3: number[] = [];
    for (const wo of allWO) {
      if (wo.dispatched_at) {
        const h = (new Date(wo.dispatched_at).getTime() - new Date(wo.created_at).getTime()) / 3600000;
        if (h >= 0) seg1.push(h);
      }
      if (wo.completed_at && wo.dispatched_at) {
        const h = (new Date(wo.completed_at).getTime() - new Date(wo.dispatched_at).getTime()) / 3600000;
        if (h >= 0) seg2.push(h);
      }
      if (wo.accepted_by_inspector_at && wo.completed_at) {
        const h = (new Date(wo.accepted_by_inspector_at).getTime() - new Date(wo.completed_at).getTime()) / 3600000;
        if (h >= 0) seg3.push(h);
      }
    }
    seg1.sort((a, b) => a - b); seg2.sort((a, b) => a - b); seg3.sort((a, b) => a - b);
    const pctl = (s: number[], p: number) => {
      if (!s.length) return 0;
      return s[Math.min(s.length - 1, Math.floor(s.length * p / 100))];
    };

    // ===== C. 安全合规 =====
    let fc = 0, od = 0, ds = 0;
    const now = new Date();
    for (const p of permits.rows) {
      if ((Array.isArray(p.precautions) && p.precautions.length > 0) &&
          (Array.isArray(p.hazards) && p.hazards.length > 0) &&
          (Array.isArray(p.safety_checklist) && p.safety_checklist.length > 0)) fc++;
      if (p.valid_until && !p.closed_at && now > new Date(p.valid_until)) od++;
      const ga = p.guardian_approval as any, sa = p.supervisor_approval as any;
      if (ga?.signed === true && sa?.signed === true) ds++;
    }

    // ===== D. AI 质量 =====
    const fbAdopted = feedback.rows.filter((r) => r.status === "adopted").length;
    const rvRejected = reviews.rows.filter((r) => r.status === "rejected").length;

    // ===== E. 系统可靠性 =====
    const totalAudit = audit.rows.length;
    const failed = audit.rows.filter((r) => r.status === "FAILED").length;
    const blocked = audit.rows.filter((r) => r.status === "BLOCKED").length;
    const rl = audit.rows.filter((r) => r.action_type.includes("RATE_LIMIT") || r.action_type === "RBAC_ACCESS_DENIED").length;

    const pct = (a: number, b: number) => b > 0 ? +((a / b) * 100).toFixed(1) : 0;

    res.json({
      generated_at: new Date().toISOString(),
      ai_adoption: {
        total_ai_calls: totalAiCalls,
        ai_with_work_order: aiWithWO,
        total_contributions: totalContributions,
        adoption_rate_pct: pct(aiWithWO + totalContributions, totalAiCalls),
      },
      wo_efficiency: {
        created_to_dispatched: { p50: +pctl(seg1, 50).toFixed(1), p90: +pctl(seg1, 90).toFixed(1), count: seg1.length },
        dispatched_to_completed: { p50: +pctl(seg2, 50).toFixed(1), p90: +pctl(seg2, 90).toFixed(1), count: seg2.length },
        completed_to_accepted: { p50: +pctl(seg3, 50).toFixed(1), p90: +pctl(seg3, 90).toFixed(1), count: seg3.length },
      },
      safety: {
        total_permits: permits.rows.length, field_complete: fc, overdue: od, dual_signoff: ds,
        field_completeness_rate: pct(fc, permits.rows.length || 1),
        overdue_rate: pct(od, permits.rows.length || 1),
        dual_signoff_rate: pct(ds, permits.rows.length || 1),
      },
      ai_quality: {
        total_feedback: feedback.rows.length, adopted: fbAdopted,
        total_reviews: reviews.rows.length, rejected: rvRejected,
        approval_rate: pct(fbAdopted, feedback.rows.length),
        rejection_rate: pct(rvRejected, reviews.rows.length),
      },
      system: {
        total_audit: totalAudit, failed, blocked, rate_limited: rl,
        error_rate: pct(failed, totalAudit),
        blocked_rate: pct(blocked, totalAudit),
      },
    });
  } catch (err) {
    console.error("[Metrics] 运营指标查询失败:", err);
    res.status(500).json({ error: "运营指标查询失败" });
  }
}

// API 文档（Swagger UI）
export function handleApiDocsJson(_req: any, res: any) {
  res.json(buildOpenApiSpec());
}

// 旧 /api/health 与 /api/debug-log 的 handler 已于 2026-10-19 前缀清理中删除：
// 前者与根路径 /health 语义重复（且载荷不同），后者前端从未实现发送端。

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

// 全量源码工程打包下载 ZIP (受 ENABLE_SOURCE_DOWNLOAD 环境变量保护，生产环境默认关闭)
export async function handleDownloadZip(req: any, res: any) {
  try {
    if (process.env.ENABLE_SOURCE_DOWNLOAD !== "true" && process.env.NODE_ENV === "production") {
      addAuditLog(req, {
        actionType: "SECURITY_BLOCK",
        module: "系统管理",
        detail: "生产环境拒绝源码工程打包下载 (未开启 ENABLE_SOURCE_DOWNLOAD 开关)",
        status: "BLOCKED",
      });
      return res.status(403).json({
        error: "生产环境默认禁用源码打包下载功能，以防源代码全量泄露风险。如需打包请设置 ENABLE_SOURCE_DOWNLOAD=true",
        code: "DOWNLOAD_ZIP_DISABLED",
      });
    }

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
