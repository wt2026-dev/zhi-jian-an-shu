import { getDb } from "../db.ts";

export const SparePartsRepository = {
  mapRow(r: any) {
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      spec: r.spec || "",
      model: r.model || "",
      category: r.category || "通用机械",
      stock: Number(r.stock ?? 0),
      // safe_stock 在库里是 `NOT NULL DEFAULT 5`，查询总能取到；回退写 5 会在
      // 「漏列」时伪造出一条看起来合理的阈值，让 `stock <= safe_stock` 凭空成立或失效。
      // 按 0 回退，与 stock/price 同口径 —— 真漏了就露出 0，而不是伪装成阈值。
      safe_stock: Number(r.safe_stock ?? 0),
      safeStock: Number(r.safe_stock ?? 0),
      unit: r.unit || "件",
      location: r.location || "",
      price: Number(r.price ?? 0),
      target_equipment_type: r.target_equipment_type || "",
      targetEquipmentType: r.target_equipment_type || "",
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  },

  mapMovementRow(r: any) {
    if (!r) return null;
    return {
      id: r.id,
      part_id: r.part_id,
      partId: r.part_id,
      type: r.type,
      quantity: Number(r.quantity ?? 0),
      balance_after: Number(r.balance_after ?? 0),
      balanceAfter: Number(r.balance_after ?? 0),
      related_work_order_id: r.related_work_order_id,
      relatedWorkOrderId: r.related_work_order_id,
      operator_name: r.operator_name,
      operatorName: r.operator_name,
      notes: r.notes || "",
      created_at: r.created_at,
      createdAt: r.created_at,
    };
  },

  async getAll(filters?: { query?: string; category?: string; lowStock?: boolean }) {
    const db = await getDb();
    let sql = `SELECT * FROM spare_parts WHERE 1=1`;
    const params: any[] = [];

    if (filters?.query) {
      params.push(`%${filters.query}%`);
      sql += ` AND (name ILIKE $${params.length} OR spec ILIKE $${params.length} OR model ILIKE $${params.length} OR location ILIKE $${params.length} OR target_equipment_type ILIKE $${params.length})`;
    }
    if (filters?.category && filters.category !== "all") {
      params.push(filters.category);
      sql += ` AND category = $${params.length}`;
    }
    if (filters?.lowStock) {
      sql += ` AND stock <= safe_stock`;
    }

    sql += ` ORDER BY (CASE WHEN stock <= safe_stock THEN 0 ELSE 1 END), updated_at DESC, id ASC;`;
    const { rows } = await db.query(sql, params);
    return rows.map((r: any) => this.mapRow(r));
  },

  async getById(id: string) {
    const db = await getDb();
    const { rows } = await db.query(`SELECT * FROM spare_parts WHERE id = $1 LIMIT 1;`, [id]);
    return rows[0] ? this.mapRow(rows[0]) : null;
  },

  async getLowStock() {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT * FROM spare_parts WHERE stock <= safe_stock ORDER BY (safe_stock - stock) DESC, id ASC;`
    );
    return rows.map((r: any) => this.mapRow(r));
  },

  async create(item: {
    id?: string;
    name: string;
    spec?: string;
    model?: string;
    category?: string;
    stock?: number;
    safe_stock?: number;
    unit?: string;
    location: string;
    price?: number;
    target_equipment_type?: string;
  }) {
    const db = await getDb();
    const id = item.id || `SP-${Date.now().toString().slice(-4)}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
    await db.query(
      `INSERT INTO spare_parts (id, name, spec, model, category, stock, safe_stock, unit, location, price, target_equipment_type, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
      [
        id,
        item.name,
        item.spec || "",
        item.model || "",
        item.category || "通用机械",
        Number(item.stock ?? 0),
        // 未填安全库存时传 null，让库里 `DEFAULT 5` 统一生效：显式传 5 会覆盖它，
        // 等于把同一个"默认值"在应用层和库层各存一份，改库时这里不会跟着变。
        item.safe_stock ?? null,
        item.unit || "件",
        item.location,
        Number(item.price ?? 0),
        item.target_equipment_type || "",
      ]
    );
    return this.getById(id);
  },

  async inOutStock(
    id: string,
    params: {
      type: "in" | "out";
      quantity: number;
      operatorName?: string;
      relatedWorkOrderId?: string;
      notes?: string;
    }
  ) {
    const db = await getDb();
    const part = await this.getById(id);
    if (!part) {
      throw new Error(`备件不存在: ${id}`);
    }

    const qty = Number(params.quantity);
    if (isNaN(qty) || qty <= 0) {
      throw new Error("出入库数量必须为大于 0 的正整数");
    }

    let newStock = part.stock;
    if (params.type === "in") {
      newStock += qty;
    } else {
      if (part.stock < qty) {
        throw new Error(`库存不足！当前在库量仅剩 ${part.stock} ${part.unit}，申请出库 ${qty} ${part.unit}`);
      }
      newStock -= qty;
    }

    // 更新库存
    await db.query(
      `UPDATE spare_parts SET stock = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2;`,
      [newStock, id]
    );

    // 写入流水
    const movementId = `MOV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await db.query(
      `INSERT INTO spare_parts_movements (id, part_id, type, quantity, balance_after, related_work_order_id, operator_name, notes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP);`,
      [
        movementId,
        id,
        params.type,
        qty,
        newStock,
        params.relatedWorkOrderId || null,
        params.operatorName || "系统经办人",
        params.notes || (params.type === "in" ? "备件采购入库" : "工单检修领用"),
      ]
    );

    const updatedPart = await this.getById(id);
    const { rows: movRows } = await db.query(`SELECT * FROM spare_parts_movements WHERE id = $1 LIMIT 1;`, [movementId]);
    return {
      part: updatedPart,
      movement: this.mapMovementRow(movRows[0]),
    };
  },

  async getMovements(partId?: string, limit = 50) {
    const db = await getDb();
    let sql = `SELECT * FROM spare_parts_movements`;
    const params: any[] = [];
    if (partId) {
      params.push(partId);
      sql += ` WHERE part_id = $1`;
    }
    sql += ` ORDER BY created_at DESC LIMIT ${limit};`;
    const { rows } = await db.query(sql, params);
    return rows.map((r: any) => this.mapMovementRow(r));
  },
};
