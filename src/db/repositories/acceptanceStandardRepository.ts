import { getDb } from "../db.ts";

/**
 * 修后验收标准仓储。
 *
 * 只读：标准由迁移种子维护（带 source / confidence），不接受前端写入 ——
 * 否则维修人员可以自己改一条宽松阈值把不合格改成合格，验收就失去意义。
 *
 * scope 解析：设备专属（scope=<equipmentId>）覆盖全厂基线（scope='default'）。
 */
export interface AcceptanceStandard {
  id: string;
  scope: string;
  itemKey: string;
  itemLabel: string;
  metric: 'temperature' | 'vibration' | 'current' | 'visual' | 'switch';
  unit: string | null;
  maxLimit: number | null;
  minLimit: number | null;
  judgedBy: 'auto' | 'manual';
  source: string;
  confidence: string;
  sortOrder: number;
  note: string | null;
}

function num(v: unknown): number | null {
  // 数据库 NULL = 未配置；绝不在读取路径上补 0
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const AcceptanceStandardRepository = {
  mapRow(r: any): AcceptanceStandard {
    return {
      id: r.id,
      scope: r.scope,
      itemKey: r.item_key,
      itemLabel: r.item_label,
      metric: r.metric,
      unit: r.unit ?? null,
      maxLimit: num(r.max_limit),
      minLimit: num(r.min_limit),
      judgedBy: r.judged_by === 'manual' ? 'manual' : 'auto',
      source: r.source,
      confidence: r.confidence,
      sortOrder: Number(r.sort_order) || 0,
      note: r.note ?? null,
    };
  },

  /** 取有效标准：设备专属优先覆盖 default，按 sort_order 排序 */
  async getEffective(equipmentId: string): Promise<AcceptanceStandard[]> {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT * FROM acceptance_standards WHERE scope IN ($1, 'default') ORDER BY sort_order ASC;`,
      [equipmentId]
    );
    const byKey = new Map<string, AcceptanceStandard>();
    for (const r of rows) {
      const mapped = this.mapRow(r);
      const existing = byKey.get(mapped.itemKey);
      // default 先写入，设备专属后写入即覆盖；反之不覆盖
      if (!existing || mapped.scope !== 'default') byKey.set(mapped.itemKey, mapped);
    }
    return Array.from(byKey.values()).sort((a, b) => a.sortOrder - b.sortOrder);
  },
};
