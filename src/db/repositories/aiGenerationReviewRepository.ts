import { getDb } from "../db.ts";
import { parseJson } from "./shared.ts";

// ==================== AI 生成内容审核台仓储（ai_generation_reviews） ====================

export const AiGenerationReviewRepository = {
  async create(review: {
    id: string;
    aiEndpoint: string;
    sourceType: string;
    contentJson: any;
    knowledgeSources?: string[];
  }) {
    const db = await getDb();
    await db.query(
      `INSERT INTO ai_generation_reviews (id, ai_endpoint, source_type, content_json, knowledge_sources, status)
       VALUES ($1, $2, $3, $4, $5, 'pending');`,
      [
        review.id,
        review.aiEndpoint,
        review.sourceType,
        JSON.stringify(review.contentJson),
        JSON.stringify(review.knowledgeSources || []),
      ]
    );
    return this.getById(review.id);
  },

  async getById(id: string) {
    const db = await getDb();
    const { rows } = await db.query(`SELECT * FROM ai_generation_reviews WHERE id = $1;`, [id]);
    return rows.length ? this.mapRow(rows[0]) : null;
  },

  async list(filter: { status?: string; limit?: number } = {}) {
    const db = await getDb();
    const limit = Math.min(Number(filter.limit) || 100, 500);
    let rows: any[];
    if (filter.status) {
      const res = await db.query(
        `SELECT * FROM ai_generation_reviews WHERE status = $1 ORDER BY created_at DESC LIMIT ${limit};`,
        [filter.status]
      );
      rows = res.rows;
    } else {
      const res = await db.query(
        `SELECT * FROM ai_generation_reviews ORDER BY created_at DESC LIMIT ${limit};`
      );
      rows = res.rows;
    }
    return rows.map((r) => this.mapRow(r));
  },

  async review(id: string, params: { status: "approved" | "rejected"; reviewer: string; note?: string }) {
    const db = await getDb();
    // 注意：PGlite 适配器的 rowCount 取自 rows.length，UPDATE 需用 RETURNING 才能判断是否命中
    const { rows } = await db.query(
      `UPDATE ai_generation_reviews
       SET status = $2, reviewer = $3, review_note = $4, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'pending'
       RETURNING id;`,
      [id, params.status, params.reviewer, params.note || null]
    );
    if (!rows.length) return null;
    return this.getById(id);
  },

  mapRow(r: any) {
    return {
      id: r.id,
      aiEndpoint: r.ai_endpoint,
      sourceType: r.source_type,
      content: parseJson(r.content_json, null as any),
      knowledgeSources: parseJson(r.knowledge_sources, [] as string[]),
      status: r.status,
      reviewer: r.reviewer,
      reviewNote: r.review_note,
      createdAt: r.created_at,
      reviewedAt: r.reviewed_at,
    };
  },
};
