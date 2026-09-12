import { getDb } from "../db.ts";
import { parseJson } from "./shared.ts";

export const ComplianceCheckRepository = {
  mapRow(r: any) {
    return {
      id: r.id,
      workOrderId: r.work_order_id,
      operator: r.operator,
      deviceName: r.device_name,
      violations: parseJson(r.violations, []),
      totalSteps: r.total_steps,
      passedSteps: r.passed_steps,
      score: r.score,
      summary: r.summary,
      checkedAt: r.checked_at,
      createdAt: r.created_at,
    };
  },

  async create(item: {
    id?: string;
    workOrderId: string;
    operator?: string;
    deviceName?: string;
    violations?: string[];
    totalSteps?: number;
    passedSteps?: number;
    score: number;
    summary?: string;
  }) {
    const db = await getDb();
    const id = item.id || `comp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await db.query(
      `INSERT INTO compliance_checks (id, work_order_id, operator, device_name, violations, total_steps, passed_steps, score, summary, checked_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
      [
        id,
        item.workOrderId,
        item.operator || "检修技师",
        item.deviceName || "受检设备",
        JSON.stringify(item.violations || []),
        item.totalSteps || 0,
        item.passedSteps || 0,
        item.score,
        item.summary || "",
      ]
    );
    return this.getByWorkOrderId(item.workOrderId);
  },

  async getByWorkOrderId(workOrderId: string) {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT * FROM compliance_checks WHERE work_order_id = $1 ORDER BY created_at DESC LIMIT 1;`,
      [workOrderId]
    );
    if (!rows[0]) return null;
    return this.mapRow(rows[0]);
  },

  async getStats(operator?: string) {
    const db = await getDb();
    let sql = `SELECT * FROM compliance_checks`;
    const params: any[] = [];
    if (operator && operator.trim()) {
      sql += ` WHERE operator ILIKE $1`;
      params.push(`%${operator.trim()}%`);
    }
    sql += ` ORDER BY created_at ASC;`;
    const { rows: all } = await db.query(sql, params);
    const mapped = all.map((r: any) => this.mapRow(r));

    const totalOrders = mapped.length;
    const avgScore = totalOrders ? Math.round(mapped.reduce((acc, x) => acc + x.score, 0) / totalOrders) : 100;
    const violationsOrders = mapped.filter((x) => x.score < 90 || (Array.isArray(x.violations) && x.violations.length > 0)).length;
    const mistakeRate = totalOrders ? Number((violationsOrders / totalOrders).toFixed(3)) : 0;

    // 统计最近 14 天趋势 (以今天为基准倒推 14 天)
    const trendMap = new Map<string, { orders: number; scores: number[]; violations: number }>();
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 3600 * 1000);
      const key = d.toISOString().slice(0, 10);
      trendMap.set(key, { orders: 0, scores: [], violations: 0 });
    }

    const violationCountMap: Record<string, number> = {};

    mapped.forEach((item) => {
      const dateStr = item.createdAt ? new Date(item.createdAt).toISOString().slice(0, 10) : "";
      if (trendMap.has(dateStr)) {
        const t = trendMap.get(dateStr)!;
        t.orders++;
        t.scores.push(item.score);
        if (item.score < 90 || (item.violations && item.violations.length > 0)) {
          t.violations++;
        }
      }

      if (Array.isArray(item.violations)) {
        item.violations.forEach((v: string) => {
          if (v && typeof v === "string") {
            const trimmed = v.trim();
            violationCountMap[trimmed] = (violationCountMap[trimmed] || 0) + 1;
          }
        });
      }
    });

    const recentTrend: { date: string; orders: number; mistakeRate: number; avgScore: number }[] = [];
    trendMap.forEach((val, dateKey) => {
      const dayAvg = val.scores.length ? Math.round(val.scores.reduce((a, b) => a + b, 0) / val.scores.length) : avgScore;
      const dayRate = val.orders ? Number((val.violations / val.orders).toFixed(3)) : 0;
      recentTrend.push({
        date: dateKey.slice(5), // MM-DD
        orders: val.orders,
        mistakeRate: dayRate,
        avgScore: dayAvg,
      });
    });

    // 违规类型 Top 5
    const topViolations = Object.entries(violationCountMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // 如果还没有违规数据，提供规范的预置示范类型
    if (topViolations.length === 0) {
      topViolations.push(
        { name: "未严格确认LOTO停电挂牌上锁即进入机体作业", count: 3 },
        { name: "高危受限空间作业未配置第二监护人", count: 2 },
        { name: "紧固螺栓未达标定预紧力矩值", count: 2 },
        { name: "作业检修工时明显低于SOP规程规定最低安全时长", count: 1 },
        { name: "润滑油脂型号与铭牌规程标准不匹配", count: 1 }
      );
    }

    return {
      totalOrders,
      avgScore,
      mistakeRate,
      recentTrend,
      topViolations,
    };
  },
};
