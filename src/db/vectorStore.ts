import { getDb } from "./db.ts";

// ==================== 知识向量存储适配器（pgvector / JSONB 双实现） ====================
// 统一接口：upsertEmbedding / searchSimilar / countPending / countEmbedded。
// 检索分数统一为余弦相似度，并夹取到 [0, 1]。
//
// 实现选择（initVectorStore 自动探测，单例幂等）：
//   - pgvector 模式（实现 A/C）：CREATE EXTENSION vector 成功且 embedding 列为 vector 类型
//     时启用——HNSW 索引（vector_cosine_ops），相似度排序下推到数据库。
//     PGlite 0.5.x 不带 pgvector 扩展（已验证：包内无 ./vector 导出），故该模式在生产
//     PostgreSQL（DB_TYPE=postgres，实现 C）或未来升级 PGlite 后自动生效。
//   - JSONB 模式（实现 B，当前默认）：embedding 存 JSONB，应用层余弦相似度打分。
//     功能完整、零外部依赖；数据量为参赛规模（数十~数百篇）时性能足够。

export type VectorStoreMode = "pgvector" | "jsonb";

let cachedMode: VectorStoreMode | null = null;
let initPromise: Promise<VectorStoreMode> | null = null;

function normalizeScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(1, score));
}

async function detectPgVector(db: any): Promise<boolean> {
  try {
    await db.exec("CREATE EXTENSION IF NOT EXISTS vector");
  } catch {
    /* 扩展不可用（PGlite 0.5.x 默认无 pgvector），走 JSONB */
  }
  try {
    const { rows } = await db.query(
      "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') AS ok"
    );
    return !!rows[0]?.ok;
  } catch {
    return false;
  }
}

async function detectEmbeddingColumnType(db: any): Promise<string | null> {
  try {
    const { rows } = await db.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = 'knowledge_embeddings' AND column_name = 'embedding' LIMIT 1`
    );
    return rows[0]?.data_type || null;
  } catch {
    return null;
  }
}

async function ensureSchema(db: any, mode: VectorStoreMode): Promise<void> {
  if (mode === "pgvector") {
    await db.exec(
      `CREATE TABLE IF NOT EXISTS knowledge_embeddings (
        article_id VARCHAR(64) PRIMARY KEY REFERENCES knowledge_articles(id),
        embedding vector(1024),
        model VARCHAR(64),
        dims INT,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )`
    );
    await db.exec(
      `CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_hnsw
       ON knowledge_embeddings USING hnsw (embedding vector_cosine_ops)`
    );
    return;
  }
  await db.exec(
    `CREATE TABLE IF NOT EXISTS knowledge_embeddings (
      article_id VARCHAR(64) PRIMARY KEY REFERENCES knowledge_articles(id),
      embedding JSONB,
      model VARCHAR(64),
      dims INT,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`
  );
}

/** 初始化向量存储（单例幂等）：探测 pgvector 可用性并确保表结构存在。 */
export async function initVectorStore(): Promise<VectorStoreMode> {
  if (cachedMode) return cachedMode;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const db = await getDb();
    const hasPgVector = await detectPgVector(db);
    const columnType = await detectEmbeddingColumnType(db);

    // 已有表：按既有列类型决策（JSONB 表不会自动迁移到 vector，保证升级可控）
    if (columnType === "vector") {
      cachedMode = "pgvector";
    } else if (columnType === "jsonb" || columnType === "text") {
      cachedMode = "jsonb";
    } else if (hasPgVector) {
      try {
        await ensureSchema(db, "pgvector");
        cachedMode = "pgvector";
      } catch (err: any) {
        console.warn("[VectorStore] pgvector 建表失败，回退 JSONB:", err?.message || err);
        await ensureSchema(db, "jsonb");
        cachedMode = "jsonb";
      }
    } else {
      await ensureSchema(db, "jsonb");
      cachedMode = "jsonb";
    }
    console.log(`[VectorStore] 就绪（模式: ${cachedMode}）`);
    return cachedMode;
  })();

  return initPromise;
}

/** 当前模式（未初始化时自动初始化）。 */
export async function getVectorStoreMode(): Promise<VectorStoreMode> {
  return cachedMode || initVectorStore();
}

/** 写入/覆盖某文章的 embedding（ON CONFLICT DO UPDATE，幂等可重跑）。 */
export async function upsertEmbedding(
  articleId: string,
  embedding: number[],
  model = "text-embedding-v3"
): Promise<void> {
  const mode = await getVectorStoreMode();
  const db = await getDb();
  if (mode === "pgvector") {
    const vectorLiteral = `[${embedding.join(",")}]`;
    await db.query(
      `INSERT INTO knowledge_embeddings (article_id, embedding, model, dims)
       VALUES ($1, $2::vector, $3, $4)
       ON CONFLICT (article_id) DO UPDATE
       SET embedding = EXCLUDED.embedding, model = EXCLUDED.model,
           dims = EXCLUDED.dims, updated_at = CURRENT_TIMESTAMP`,
      [articleId, vectorLiteral, model, embedding.length]
    );
    return;
  }
  await db.query(
    `INSERT INTO knowledge_embeddings (article_id, embedding, model, dims)
     VALUES ($1, $2::jsonb, $3, $4)
     ON CONFLICT (article_id) DO UPDATE
     SET embedding = EXCLUDED.embedding, model = EXCLUDED.model,
         dims = EXCLUDED.dims, updated_at = CURRENT_TIMESTAMP`,
    [articleId, JSON.stringify(embedding), model, embedding.length]
  );
}

/** 余弦相似度检索，返回按相似度降序的 { articleId, score }（score ∈ [0,1]）。 */
export async function searchSimilar(
  embedding: number[],
  limit = 20
): Promise<{ articleId: string; score: number }[]> {
  const mode = await getVectorStoreMode();
  const db = await getDb();

  if (mode === "pgvector") {
    const vectorLiteral = `[${embedding.join(",")}]`;
    // <=> 为 pgvector 余弦距离（1 - cos_sim），score = 1 - distance
    const { rows } = await db.query(
      `SELECT article_id, 1 - (embedding <=> $1::vector) AS score
       FROM knowledge_embeddings
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [vectorLiteral, limit]
    );
    return rows
      .map((r: any) => ({ articleId: r.article_id, score: normalizeScore(Number(r.score)) }))
      .filter((x) => x.score > 0);
  }

  // JSONB 模式：应用层余弦相似度
  const { rows } = await db.query(
    `SELECT article_id, embedding FROM knowledge_embeddings WHERE embedding IS NOT NULL`
  );
  return rows
    .map((r: any) => {
      let stored: any = r.embedding;
      if (typeof stored === "string") {
        try {
          stored = JSON.parse(stored);
        } catch {
          return { articleId: r.article_id, score: 0 };
        }
      }
      const score = cosineSimilarity(embedding, stored);
      return { articleId: r.article_id, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** 已审核但尚无 embedding 的文章数（懒回填提醒与回填脚本统计用）。 */
export async function countPending(): Promise<number> {
  await getVectorStoreMode();
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT COUNT(*) AS count FROM knowledge_articles a
     WHERE a.status = 'approved'
       AND NOT EXISTS (SELECT 1 FROM knowledge_embeddings e WHERE e.article_id = a.id)`
  );
  return Number(rows[0]?.count || 0);
}

/** 已有 embedding 的文章数。 */
export async function countEmbedded(): Promise<number> {
  await getVectorStoreMode();
  const db = await getDb();
  const { rows } = await db.query(`SELECT COUNT(*) AS count FROM knowledge_embeddings`);
  return Number(rows[0]?.count || 0);
}

// 应用层余弦相似度（JSONB 模式使用；与 aiClient.cosineSimilarity 同口径，避免模块耦合）
function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? Math.max(0, Math.min(1, dot / denom)) : 0;
}
