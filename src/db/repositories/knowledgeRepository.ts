import { getDb } from "../db.ts";
import { parseJson } from "./shared.ts";

export const KnowledgeRepository = {
  async getAll(filters?: { category?: string; search?: string; status?: string }) {
    const db = await getDb();
    let sql = `SELECT * FROM knowledge_articles WHERE 1=1`;
    const params: any[] = [];

    if (filters?.category && filters.category !== "all") {
      params.push(filters.category);
      sql += ` AND category = $${params.length}`;
    }
    if (filters?.search) {
      params.push(`%${filters.search}%`);
      sql += ` AND (title ILIKE $${params.length} OR summary ILIKE $${params.length} OR content ILIKE $${params.length})`;
    }
    if (filters?.status) {
      params.push(filters.status);
      sql += ` AND status = $${params.length}`;
    }

    sql += ` ORDER BY id DESC;`;
    const { rows } = await db.query(sql, params);
    return rows.map(mapKnowledgeRow);
  },

  async getById(id: string) {
    const db = await getDb();
    const { rows } = await db.query(`SELECT * FROM knowledge_articles WHERE id = $1 LIMIT 1;`, [id]);
    if (!rows[0]) return null;
    return mapKnowledgeRow(rows[0]);
  },

  async create(article: any) {
    const db = await getDb();
    await db.query(
      `INSERT INTO knowledge_articles (id, title, category, target_equipment, tags, summary, content, author, updated_at, view_count, likes, file_type, chunks_count, embedding, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15);`,
      [
        article.id,
        article.title,
        article.category,
        article.targetEquipment,
        JSON.stringify(article.tags || []),
        article.summary,
        article.content,
        article.author,
        article.updatedAt,
        article.viewCount || 0,
        article.likes || 0,
        article.fileType || "manual",
        article.chunksCount || 1,
        article.embedding ? JSON.stringify(article.embedding) : null,
        article.status || "pending",
      ]
    );
    return this.getById(article.id);
  },
};

function mapKnowledgeRow(r: any) {
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    targetEquipment: r.target_equipment,
    tags: parseJson(r.tags, []),
    summary: r.summary,
    content: r.content,
    author: r.author,
    updatedAt: r.updated_at,
    viewCount: r.view_count,
    likes: r.likes,
    fileType: r.file_type,
    chunksCount: r.chunks_count,
    embedding: parseJson(r.embedding, null),
    status: r.status || "approved",
    reviewer: r.reviewer,
    reviewedAt: r.reviewed_at,
    createdAt: r.created_at,
  };
}
