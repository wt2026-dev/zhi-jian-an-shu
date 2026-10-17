/**
 * 零件维修历史仓库 —— 全部查询走真实数据表：
 *   · work_orders.repair_log.parts_used：完工上报时技师真实填写的耗用备件记录
 *   · work_orders.title/description：真实报单文本
 *   · spare_parts / spare_parts_movements：真实备件库存与出入库流水
 *
 * ## 数据缺口声明（不造假）
 *   库里没有以拆解位号（P01…）为主键的零件台账表；本仓库直接**按零件名称/型号文本**检索
 *   work_orders 与 spare_parts 的真实记录。一个位号若没有被任何工单文本或备件记录提及，
 *   历史就返回空 —— 由前端如实显示"暂无维修记录"，绝不补零、不编造。
 */
import { getDb } from "../db.ts";

export interface PartUsageRow {
  name: string;
  code: string;
  spec: string;
  qty: number;
  unit: string;
  unitPrice: number;
}

export interface RelatedWorkOrderRow {
  id: string;
  orderNo: string;
  title: string;
  status: string;
  faultType: string;
  priority: string;
  equipmentId: string;
  equipmentName: string;
  equipmentCode: string;
  workshop: string;
  description: string;
  createdAt: string | null;
  acceptedAt: string | null;
  completedAt: string | null;
  /** 命中查询词的证据文本（真实字段原词，不加工成伪证据） */
  matchedBy: string[];
  /** repair_log.parts_used 中真实登记的耗用备件（未完工单常为 null） */
  usedParts: PartUsageRow[] | null;
  /** 完工上报里的真实维修字段（未完工单为 null/空） */
  causeAnalysis: string;
  resolutionSteps: string;
  workHours: number | null;
}

export interface SpareMovementRow {
  id: string;
  partId: string;
  partName: string;
  partCode: string;
  type: 'in' | 'out';
  quantity: number;
  relatedWorkOrderId: string | null;
  relatedWorkOrderNo: string | null;
  notes: string;
  createdAt: string | null;
}

function asIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const s = String(value);
  return s ? s : null;
}

function mapPartUsage(u: unknown): PartUsageRow | null {
  if (!u || typeof u !== 'object') return null;
  const r = u as Record<string, unknown>;
  if (typeof r.name !== 'string' || !r.name) return null;
  return {
    name: r.name,
    code: typeof r.code === 'string' ? r.code : '',
    spec: typeof r.spec === 'string' ? r.spec : '',
    qty: typeof r.qty === 'number' ? r.qty : 1,
    unit: typeof r.unit === 'string' ? r.unit : '',
    unitPrice: typeof r.unitPrice === 'number' ? r.unitPrice : 0,
  };
}

export type PartHistoryFilter = {
  /** 台账设备 id（历史严格限定在该设备自己的工单范围内） */
  equipmentId: string;
  /** 名称/型号待匹配词组（由服务端做过别名展开与清洗） */
  tokens: string[];
};

export const PartHistoryRepository = {
  /**
   * 在该设备的真实工单里检索"文本或耗用备件命中查询词"的工单。
   * SQL 用 `repair_log::text ILIKE ANY($2::text[])` + title/description ILIKE OR 组合；
   * $2 为 `%token%` 模式数组，任一命中即入选（再由服务端做一级证据分类，
   * 这里不做语义判断，只负责真实取数）。
   */
  async getRelatedWorkOrders(filter: PartHistoryFilter): Promise<RelatedWorkOrderRow[]> {
    const db = await getDb();
    const patterns = filter.tokens
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => `%${t}%`);
    if (!patterns.length) return [];
    const { rows } = await db.query(
      `
      SELECT id, order_no, title, equipment_id, equipment_name, equipment_code,
             workshop, fault_type, priority, status, description,
             accepted_at, completed_at, repair_log
      FROM work_orders
      WHERE equipment_id = $1
        AND (
          description ILIKE ANY($2::text[])
          OR title ILIKE ANY($2::text[])
          OR repair_log::text ILIKE ANY($2::text[])
        )
      ORDER BY created_timestamp DESC NULLS LAST, id DESC
      LIMIT 120;
      `,
      [filter.equipmentId, patterns]
    );

    return (rows as Record<string, unknown>[]).map((r) => {
      let repairLog: unknown = null;
      if (typeof r.repair_log === 'string') {
        try { repairLog = JSON.parse(r.repair_log); } catch { repairLog = null; }
      } else {
        repairLog = r.repair_log;
      }
      const log = repairLog && typeof repairLog === 'object' ? repairLog as Record<string, unknown> : null;
      const rawUsed = Array.isArray(log?.parts_used) ? log.parts_used : Array.isArray(log?.partsUsed) ? log.partsUsed : null;
      let usedParts: PartUsageRow[] | null = null;
      if (rawUsed) {
        usedParts = rawUsed.map(mapPartUsage).filter((x): x is PartUsageRow => !!x);
        if (usedParts.length === 0) usedParts = null;
      }
      return {
        id: String(r.id ?? ''),
        orderNo: String(r.order_no ?? ''),
        title: String(r.title ?? ''),
        status: String(r.status ?? ''),
        faultType: String(r.fault_type ?? ''),
        priority: String(r.priority ?? ''),
        equipmentId: String(r.equipment_id ?? ''),
        equipmentName: String(r.equipment_name ?? ''),
        equipmentCode: String(r.equipment_code ?? ''),
        workshop: String(r.workshop ?? ''),
        description: String(r.description ?? ''),
        createdAt: asIso(r.created_at),
        acceptedAt: asIso(r.accepted_at),
        completedAt: asIso(r.completed_at ?? r.completed_at_dt),
        matchedBy: [],
        usedParts,
        causeAnalysis: typeof log?.causeAnalysis === 'string' ? log.causeAnalysis : '',
        resolutionSteps: typeof log?.resolutionSteps === 'string' ? log.resolutionSteps : '',
        workHours: typeof log?.workHours === 'number' ? log.workHours : null,
      };
    });
  },

  /**
   * 备件出入库流水（真实库存事件）：按 part 名称/型号匹配 spare_parts，
   * 并携带其关联的真实工单号。出入库只对真实库存操作发生 —— 没有流水就没有记录。
   */
  async getSpareMovements(tokens: string[]): Promise<SpareMovementRow[]> {
    const db = await getDb();
    const patterns = tokens
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => `%${t}%`);
    if (!patterns.length) return [];
    const { rows } = await db.query(
      `
      SELECT m.id, m.part_id, m.type, m.quantity, m.related_work_order_id,
             m.notes, m.created_at, w2.order_no, sp.name, sp.spec, sp.model
      FROM spare_parts_movements m
      JOIN spare_parts sp ON sp.id = m.part_id
      LEFT JOIN work_orders w2 ON w2.id = m.related_work_order_id
      WHERE sp.name ILIKE ANY($1::text[]) OR sp.spec ILIKE ANY($1::text[]) OR sp.model ILIKE ANY($1::text[])
      ORDER BY m.created_at DESC
      LIMIT 80;
      `,
      [patterns]
    );
    return (rows as Record<string, unknown>[]).map((r) => {
      const type = String(r.type) === 'in' ? 'in' : 'out';
      return {
        id: String(r.id ?? ''),
        partId: String(r.part_id ?? ''),
        partName: String(r.name ?? ''),
        partCode: String(r.model ?? r.spec ?? ''),
        type: type as 'in' | 'out',
        quantity: Number(r.quantity ?? 0),
        relatedWorkOrderId: r.related_work_order_id ? String(r.related_work_order_id) : null,
        relatedWorkOrderNo: r.order_no ? String(r.order_no) : null,
        notes: String(r.notes ?? ''),
        createdAt: asIso(r.created_at),
      };
    });
  },

  /**
   * 备件目录的真实库存快照（人工配件的"在哪可领"信息源）。
   * 按名称/型号匹配 spare_parts，取最像的一条。
   */
  async lookupSparePart(tokens: string[]): Promise<Record<string, unknown> | null> {
    const db = await getDb();
    const patterns = tokens
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => `%${t}%`);
    if (!patterns.length) return null;
    const { rows } = await db.query(
      `
      SELECT id, name, spec, model, category, stock, safe_stock, unit, location, price
      FROM spare_parts
      WHERE name ILIKE ANY($1::text[]) OR spec ILIKE ANY($1::text[]) OR model ILIKE ANY($1::text[])
      ORDER BY (length(name) DESC)
      LIMIT 1;
      `,
      [patterns]
    );
    const r = (rows as Record<string, unknown>[])[0];
    if (!r) return null;
    return {
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      spec: String(r.spec ?? ''),
      model: String(r.model ?? ''),
      category: String(r.category ?? ''),
      stock: Number(r.stock ?? 0),
      safeStock: Number(r.safe_stock ?? 5),
      unit: String(r.unit ?? ''),
      location: String(r.location ?? ''),
      price: Number(r.price ?? 0),
    };
  },

  /**
   * 该设备的全部真实完工工单（只取更换判定需要的最小字段）。
   * 零件寿命预警用它做**一次**查询替代"每零件一查"的浪费：
   * 服务端拿这批完工单的 parts_used 按零件名文本归属到各拆解位号（与
   * getPartMaintenanceHistory 同一条"完工单 + 耗用备件命中"口径）。
   */
  async getCompletedOrdersForEquipment(equipmentId: string): Promise<Array<{
    id: string;
    orderNo: string;
    completedAt: string | null;
    usedParts: PartUsageRow[] | null;
  }>> {
    if (!equipmentId) return [];
    const db = await getDb();
    const { rows } = await db.query(
      `
      SELECT id, order_no, completed_at, repair_log
      FROM work_orders
      WHERE equipment_id = $1 AND status = 'completed'
      ORDER BY completed_at ASC NULLS LAST, id ASC
      LIMIT 240;
      `,
      [equipmentId]
    );
    return (rows as Record<string, unknown>[]).map((r) => {
      let repairLog: unknown = null;
      if (typeof r.repair_log === 'string') {
        try { repairLog = JSON.parse(r.repair_log); } catch { repairLog = null; }
      } else {
        repairLog = r.repair_log;
      }
      const log = repairLog && typeof repairLog === 'object' ? repairLog as Record<string, unknown> : null;
      const rawUsed = Array.isArray(log?.parts_used) ? log.parts_used : Array.isArray(log?.partsUsed) ? log.partsUsed : null;
      let usedParts: PartUsageRow[] | null = null;
      if (rawUsed) {
        usedParts = rawUsed.map(mapPartUsage).filter((x): x is PartUsageRow => !!x);
        if (usedParts.length === 0) usedParts = null;
      }
      return {
        id: String(r.id ?? ''),
        orderNo: String(r.order_no ?? ''),
        completedAt: asIso(r.completed_at ?? r.completed_at_dt),
        usedParts,
      };
    });
  },

  /**
   * 检修报告（拆解视图 F7）专用：某设备全部已完工单的概览（含标题/故障类型/完工
   * 时间/根本原因分析/作业步骤/更换备件）。只读聚合查询，不改任何状态。
   */
  async getCompletedOrdersSummary(equipmentId: string): Promise<Array<{
    orderNo: string;
    title: string;
    faultType: string | null;
    completedAt: string | null;
    causeAnalysis: string | null;
    resolutionSteps: string | null;
    usedParts: PartUsageRow[] | null;
  }>> {
    if (!equipmentId) return [];
    const db = await getDb();
    const { rows } = await db.query(
      `
      SELECT order_no, title, fault_type, completed_at, description, repair_log
      FROM work_orders
      WHERE equipment_id = $1 AND status = 'completed'
      ORDER BY completed_at DESC NULLS LAST, id ASC
      LIMIT 120;
      `,
      [equipmentId]
    );
    return (rows as Record<string, unknown>[]).map((r) => {
      // repair_log JSONB 或字符串两种存储形态统一解析（解析失败 = null，不编造）
      const log = ((): Record<string, unknown> | null => {
        let parsed: unknown = r.repair_log;
        if (typeof parsed === 'string') {
          try { parsed = JSON.parse(parsed); } catch { parsed = null; }
        }
        return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
      })();
      const rawUsed = Array.isArray(log?.parts_used) ? log.parts_used : Array.isArray(log?.partsUsed) ? log.partsUsed : null;
      const usedParts = rawUsed ? rawUsed.map(mapPartUsage).filter((x): x is PartUsageRow => !!x) : [];
      const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
      return {
        orderNo: String(r.order_no ?? ''),
        title: str(r.title) ?? '',
        faultType: str(r.fault_type),
        completedAt: asIso(r.completed_at ?? r.completed_at_dt),
        causeAnalysis: str(log?.cause_analysis) ?? str(log?.causeAnalysis),
        resolutionSteps: str(log?.resolution_steps) ?? str(log?.resolutionSteps),
        usedParts: usedParts.length ? usedParts : null,
      };
    });
  },
};
