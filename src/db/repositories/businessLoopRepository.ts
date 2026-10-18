import { getDb } from "../db.ts";

// ==================== Hermes 业务闭环仓储（迁移 027 三表） ====================
// 数据纪律：不塞种子行，全部行由真实业务动作（创建闭环 / 确认环节 / 归档）写入。

export function generateLoopId(): string {
  const loopId = `bl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return loopId;
}

export function generateStageId(loopId: string, stageNo: number): string {
  return `${loopId}-stage-${stageNo}`;
}

export function generateArtifactId(loopId: string, seq: number): string {
  return `${loopId}-art-${seq}`;
}

/**
 * PL-YYYYMMDD-NNN：同日序号取库内**当天最大数字后缀 +1**。
 * 旧实现用 `COUNT(*) + 1`：删掉一条闭环后行数回退，新号就会撞上仍存在的 loop_no，
 * 而 loop_no 带 UNIQUE 约束 —— 撞号不是覆盖，是整条创建请求 500。
 */
export async function generateLoopNo(): Promise<string> {
  const db = await getDb();
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `PL-${dateStr}-`;
  const { rows } = await db.query(
    `SELECT COALESCE(MAX((regexp_match(loop_no, '(\\d+)$'))[1])::bigint, 0) + 1 AS seq
       FROM business_loops WHERE loop_no LIKE $1 || '%';`,
    [prefix]
  );
  const seq = Number(rows[0]?.seq ?? 1);
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

export function mapLoopRow(r: any) {
  return {
    id: r.id,
    loopNo: r.loop_no,
    goal: r.goal,
    equipmentId: r.equipment_id,
    initiatorId: r.initiator_id,
    status: r.status,
    currentStage: r.current_stage,
    startedAt: r.started_at,
    expectedMinutes: r.expected_minutes,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function mapStageRow(r: any) {
  return {
    id: r.id,
    loopId: r.loop_id,
    stageNo: r.stage_no,
    stageKey: r.stage_key,
    status: r.status,
    aiPrefill: parseStagePrefill(r.ai_prefill_json),
    aiEngine: r.ai_engine,
    aiStatus: r.ai_status,
    confirmBy: r.confirm_by,
    confirmAt: r.confirm_at,
    pageRef: r.page_ref,
    producedArtifactRef: r.produced_artifact_ref,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function mapArtifactRow(r: any) {
  return {
    id: r.id,
    loopId: r.loop_id,
    artifactType: r.artifact_type,
    title: r.title,
    refId: r.ref_id,
    status: r.status,
    previewText: r.preview_text,
    aiUsed: r.ai_used,
    createdAt: r.created_at,
  };
}

function parseStagePrefill(raw: any) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // 解析失败如实返回原始文本，不伪造结构
    return { raw: String(raw) };
  }
}

export const BusinessLoopRepository = {
  async createLoop(loop: {
    id: string; loopNo: string; goal: string; equipmentId?: string | null;
    initiatorId?: string | null; currentStage?: number; expectedMinutes?: number;
  }) {
    const db = await getDb();
    await db.query(
      `INSERT INTO business_loops (id, loop_no, goal, equipment_id, initiator_id, status, current_stage, started_at, expected_minutes)
       VALUES ($1, $2, $3, $4, $5, 'running', $6, CURRENT_TIMESTAMP, $7);`,
      [
        loop.id,
        loop.loopNo,
        loop.goal,
        loop.equipmentId || null,
        loop.initiatorId || null,
        loop.currentStage ?? 1,
        loop.expectedMinutes ?? null,
      ]
    );
    return this.getLoopById(loop.id);
  },

  async getLoopById(id: string) {
    const db = await getDb();
    const { rows } = await db.query(`SELECT * FROM business_loops WHERE id = $1 LIMIT 1;`, [id]);
    return rows[0] ? mapLoopRow(rows[0]) : null;
  },

  async listLoops(filters?: { status?: string; limit?: number }) {
    const db = await getDb();
    const params: any[] = [];
    let sql = `SELECT * FROM business_loops WHERE 1=1`;
    if (filters?.status) {
      params.push(filters.status);
      sql += ` AND status = $${params.length}`;
    }
    sql += ` ORDER BY started_at DESC`;
    if (filters?.limit) {
      params.push(filters.limit);
      sql += ` LIMIT $${params.length}`;
    }
    const { rows } = await db.query(sql, params);
    return (rows as any[]).map(mapLoopRow);
  },

  async updateLoopStatus(id: string, status: string) {
    const db = await getDb();
    await db.query(
      `UPDATE business_loops SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1;`,
      [id, status]
    );
  },

  async updateLoopCurrentStage(id: string, currentStage: number) {
    const db = await getDb();
    await db.query(
      `UPDATE business_loops SET current_stage = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1;`,
      [id, currentStage]
    );
  },

  async completeLoop(id: string, completedAt = new Date()) {
    const db = await getDb();
    await db.query(
      `UPDATE business_loops SET status = 'archived', completed_at = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1;`,
      [id, completedAt.toISOString()]
    );
  },

  // ---- 环节 ----
  async insertStage(stage: {
    id: string; loopId: string; stageNo: number; stageKey: string;
    status: string; pageRef?: string;
  }) {
    const db = await getDb();
    await db.query(
      `INSERT INTO business_loop_stages (id, loop_id, stage_no, stage_key, status, page_ref)
       VALUES ($1, $2, $3, $4, $5, $6);`,
      [stage.id, stage.loopId, stage.stageNo, stage.stageKey, stage.status, stage.pageRef || null]
    );
  },

  async listStages(loopId: string) {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT * FROM business_loop_stages WHERE loop_id = $1 ORDER BY stage_no ASC;`,
      [loopId]
    );
    return (rows as any[]).map(mapStageRow);
  },

  async getStage(loopId: string, stageNo: number) {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT * FROM business_loop_stages WHERE loop_id = $1 AND stage_no = $2 LIMIT 1;`,
      [loopId, stageNo]
    );
    return rows[0] ? mapStageRow(rows[0]) : null;
  },

  async updateStagePrefill(loopId: string, stageNo: number, prefill: {
    aiPrefillJson: string; aiEngine: string; aiStatus: "ok" | "degraded"; producedArtifactRef?: string;
  }) {
    const db = await getDb();
    await db.query(
      `UPDATE business_loop_stages
         SET ai_prefill_json = $3, ai_engine = $4, ai_status = $5, produced_artifact_ref = COALESCE($6, produced_artifact_ref), updated_at = CURRENT_TIMESTAMP
       WHERE loop_id = $1 AND stage_no = $2;`,
      [loopId, stageNo, prefill.aiPrefillJson, prefill.aiEngine, prefill.aiStatus, prefill.producedArtifactRef || null]
    );
  },

  async updateLotoPrefill(loopId: string, prefillJson: string) {
    const db = await getDb();
    await db.query(
      `UPDATE business_loop_stages SET ai_prefill_json = $3, updated_at = CURRENT_TIMESTAMP
       WHERE loop_id = $1 AND stage_no = 3;`,
      [loopId, prefillJson]
    );
  },

  async confirmStage(loopId: string, stageNo: number, confirmBy: string) {
    const db = await getDb();
    await db.query(
      `UPDATE business_loop_stages SET status = 'completed', confirm_by = $3, confirm_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE loop_id = $1 AND stage_no = $2;`,
      [loopId, stageNo, confirmBy]
    );
  },

  async setStageInProgress(loopId: string, stageNo: number) {
    const db = await getDb();
    await db.query(
      `UPDATE business_loop_stages SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP
       WHERE loop_id = $1 AND stage_no = $2;`,
      [loopId, stageNo]
    );
  },

  /** 环节产物名义引用（如工单号/作业票号，仅作展示引用，不动 ai_prefill_json） */
  async updatePrefillArtifactRef(loopId: string, stageNo: number, ref: string) {
    const db = await getDb();
    await db.query(
      `UPDATE business_loop_stages SET produced_artifact_ref = $3, updated_at = CURRENT_TIMESTAMP
       WHERE loop_id = $1 AND stage_no = $2;`,
      [loopId, stageNo, ref]
    );
  },

  // ---- 产出物 ----
  async insertArtifact(artifact: {
    id: string; loopId: string; artifactType: string; title?: string;
    refId?: string | null; status?: string; previewText?: string | null; aiUsed?: string | null;
  }) {
    const db = await getDb();
    await db.query(
      `INSERT INTO business_loop_artifacts (id, loop_id, artifact_type, title, ref_id, status, preview_text, ai_used)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
      [
        artifact.id,
        artifact.loopId,
        artifact.artifactType,
        artifact.title || null,
        artifact.refId || null,
        artifact.status || "pending",
        artifact.previewText || null,
        artifact.aiUsed || null,
      ]
    );
  },

  async listArtifacts(loopId: string) {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT * FROM business_loop_artifacts WHERE loop_id = $1 ORDER BY created_at ASC, id ASC;`,
      [loopId]
    );
    return (rows as any[]).map(mapArtifactRow);
  },

  async getArtifactByType(loopId: string, artifactType: string) {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT * FROM business_loop_artifacts WHERE loop_id = $1 AND artifact_type = $2 LIMIT 1;`,
      [loopId, artifactType]
    );
    return rows[0] ? mapArtifactRow(rows[0]) : null;
  },

  /** 环节确认后把产出物落为「已生成」：ref_id 与预览文本由服务层按真实业务记录生成 */
  async markArtifactGenerated(loopId: string, artifactType: string, updates: {
    refId?: string; status?: string; previewText?: string; aiUsed?: string;
  }) {
    const db = await getDb();
    await db.query(
      `UPDATE business_loop_artifacts
         SET ref_id = COALESCE($3, ref_id),
             status = COALESCE($4, status),
             preview_text = COALESCE($5, preview_text),
             ai_used = COALESCE($6, ai_used)
       WHERE loop_id = $1 AND artifact_type = $2;`,
      [loopId, artifactType, updates.refId || null, updates.status || null, updates.previewText || null, updates.aiUsed || null]
    );
  },

  async countArtifacts(loopId: string): Promise<{ total: number; generated: number; knowledgeCount: number }> {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'generated')::int AS generated,
         COUNT(*) FILTER (WHERE artifact_type = 'knowledge_entry' AND status = 'generated')::int AS knowledge
       FROM business_loop_artifacts WHERE loop_id = $1;`,
      [loopId]
    );
    const r: any = rows[0] || {};
    return { total: r.total || 0, generated: r.generated || 0, knowledgeCount: r.knowledge || 0 };
  },
};
