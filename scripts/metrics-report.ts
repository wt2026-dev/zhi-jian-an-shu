#!/usr/bin/env tsx
/**
 * 运营指标报表生成器
 * 
 * 使用方式：
 *   npx tsx scripts/metrics-report.ts --json     # JSON 格式
 *   npx tsx scripts/metrics-report.ts --markdown  # Markdown 格式
 *   npx tsx scripts/metrics-report.ts             # 默认 Markdown
 * 
 * 注意：此脚本在 PGlite 嵌入式模式下可能因 WASM 内存问题崩溃。
 * 如果脚本报错，请使用 API 端点替代：
 *   GET /api/v1/admin/metrics/operational  (需 admin 登录)
 * 
 * 数据来源：全部从已有表聚合，不新建表
 *   ai_analysis_log, ai_feedback, ai_generation_reviews, ai_knowledge_contributions
 *   work_orders, safety_permits, audit_logs
 */
import { getDb } from "../src/db/db";

function pct(a: number, b: number): number {
  return b > 0 ? +((a / b) * 100).toFixed(1) : 0;
}

function pctl(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

interface MetricsReport {
  generated_at: string;
  ai_adoption: {
    total_ai_calls: number;
    ai_with_work_order: number;
    total_contributions: number;
    adoption_rate_pct: number;
  };
  wo_efficiency: {
    created_to_dispatched: { p50: number; p90: number; count: number };
    dispatched_to_completed: { p50: number; p90: number; count: number };
    completed_to_accepted: { p50: number; p90: number; count: number };
  };
  safety: {
    total_permits: number;
    field_complete: number;
    overdue: number;
    dual_signoff: number;
    field_completeness_rate: number;
    overdue_rate: number;
    dual_signoff_rate: number;
  };
  ai_quality: {
    total_feedback: number;
    adopted: number;
    total_reviews: number;
    rejected: number;
    approval_rate: number;
    rejection_rate: number;
  };
  system: {
    total_audit: number;
    failed: number;
    blocked: number;
    rate_limited: number;
    error_rate: number;
    blocked_rate: number;
  };
}

async function main() {
  try {
    const db = await getDb();

    // 逐个查询（PGlite 不支持并发，但逐个查询在服务端环境下可行）
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
    const tp = permits.rows.length || 1;

    // ===== D. AI 质量 =====
    const fbAdopted = feedback.rows.filter((r) => r.status === "adopted").length;
    const rvRejected = reviews.rows.filter((r) => r.status === "rejected").length;

    // ===== E. 系统可靠性 =====
    const totalAudit = audit.rows.length;
    const failed = audit.rows.filter((r) => r.status === "FAILED").length;
    const blocked = audit.rows.filter((r) => r.status === "BLOCKED").length;
    const rl = audit.rows.filter((r) => r.action_type.includes("RATE_LIMIT") || r.action_type === "RBAC_ACCESS_DENIED").length;

    const report: MetricsReport = {
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
        field_completeness_rate: pct(fc, tp), overdue_rate: pct(od, permits.rows.length || 1), dual_signoff_rate: pct(ds, tp),
      },
      ai_quality: {
        total_feedback: feedback.rows.length, adopted: fbAdopted,
        total_reviews: reviews.rows.length, rejected: rvRejected,
        approval_rate: pct(fbAdopted, feedback.rows.length), rejection_rate: pct(rvRejected, reviews.rows.length),
      },
      system: {
        total_audit: totalAudit, failed, blocked, rate_limited: rl,
        error_rate: pct(failed, totalAudit), blocked_rate: pct(blocked, totalAudit),
      },
    };

    const fmt = process.argv.includes("--json") ? "json" : "markdown";
    if (fmt === "json") {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(toMarkdown(report));
    }
    process.exit(0);
  } catch (err: any) {
    if (String(err?.message || err).includes("Aborted")) {
      console.error("[Metrics] PGlite WASM 运行时异常（已知限制），请改用 API 端点：");
      console.error("  GET /api/v1/admin/metrics/operational  (需 admin 角色登录)");
    } else {
      console.error("[Metrics] 报表生成失败:", err);
    }
    process.exit(1);
  }
}

function toMarkdown(m: MetricsReport): string {
  return [
    `# 运营指标基线报表`,
    ``,
    `> 生成时间：${m.generated_at}`,
    ``,
    `## A. AI 采纳率`,
    ``,
    `| 指标 | 值 |`,
    `|------|-----|`,
    `| AI 分析总次数 | ${m.ai_adoption.total_ai_calls} |`,
    `| 后续产生工单数 | ${m.ai_adoption.ai_with_work_order} |`,
    `| 知识贡献数 | ${m.ai_adoption.total_contributions} |`,
    `| **AI 采纳率** | **${m.ai_adoption.adoption_rate_pct}%** |`,
    ``,
    `## B. 工单效率（小时）`,
    ``,
    `| 阶段 | P50 | P90 | 样本数 |`,
    `|------|-----|-----|--------|`,
    `| 创建→派发 | ${m.wo_efficiency.created_to_dispatched.p50}h | ${m.wo_efficiency.created_to_dispatched.p90}h | ${m.wo_efficiency.created_to_dispatched.count} |`,
    `| 派发→完成 | ${m.wo_efficiency.dispatched_to_completed.p50}h | ${m.wo_efficiency.dispatched_to_completed.p90}h | ${m.wo_efficiency.dispatched_to_completed.count} |`,
    `| 完成→验收 | ${m.wo_efficiency.completed_to_accepted.p50}h | ${m.wo_efficiency.completed_to_accepted.p90}h | ${m.wo_efficiency.completed_to_accepted.count} |`,
    ``,
    `## C. 安全合规`,
    ``,
    `| 指标 | 值 |`,
    `|------|-----|`,
    `| 作业票总数 | ${m.safety.total_permits} |`,
    `| 字段完整数 | ${m.safety.field_complete} |`,
    `| 逾期数 | ${m.safety.overdue} |`,
    `| 双人会签数 | ${m.safety.dual_signoff} |`,
    `| **字段完整率** | **${m.safety.field_completeness_rate}%** |`,
    `| **逾期率** | **${m.safety.overdue_rate}%** |`,
    `| **双人会签率** | **${m.safety.dual_signoff_rate}%** |`,
    ``,
    `## D. AI 质量`,
    ``,
    `| 指标 | 值 |`,
    `|------|-----|`,
    `| 反馈总数 | ${m.ai_quality.total_feedback} |`,
    `| 采纳数 | ${m.ai_quality.adopted} |`,
    `| 评审总数 | ${m.ai_quality.total_reviews} |`,
    `| 拒绝数 | ${m.ai_quality.rejected} |`,
    `| **好评率** | **${m.ai_quality.approval_rate}%** |`,
    `| **降级率** | **${m.ai_quality.rejection_rate}%** |`,
    ``,
    `## E. 系统可靠性`,
    ``,
    `| 指标 | 值 |`,
    `|------|-----|`,
    `| 审计日志总数 | ${m.system.total_audit} |`,
    `| 失败数 | ${m.system.failed} |`,
    `| 拦截数 | ${m.system.blocked} |`,
    `| 限流命中 | ${m.system.rate_limited} |`,
    `| **错误率** | **${m.system.error_rate}%** |`,
    `| **拦截率** | **${m.system.blocked_rate}%** |`,
  ].join("\n");
}

main();
