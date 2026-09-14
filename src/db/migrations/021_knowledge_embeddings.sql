-- ============================================================
-- 021_knowledge_embeddings.sql
-- 知识库向量 RAG：独立向量表（不改动 knowledge_articles 主表）
--
-- 设计说明：
--   1. 迁移执行器按分号切分语句逐条执行，故本文件不使用 DO $$ 块，
--      条件性 pgvector 升级（CREATE EXTENSION / HNSW 索引 / 列类型转换）
--      由运行时 src/db/vectorStore.ts 的 initVectorStore() 幂等完成。
--   2. 本文件创建的 embedding 列为 JSONB（实现 B，全环境可用）；
--      运行时探测到 pgvector 可用且表为空时，自动升级为 vector(1024) + HNSW
--      （实现 A/C：生产 PostgreSQL 或未来带 pgvector 的 PGlite 版本）。
--   3. 幂等：CREATE TABLE IF NOT EXISTS，可重复执行。
-- ============================================================

CREATE TABLE IF NOT EXISTS knowledge_embeddings (
  article_id VARCHAR(64) PRIMARY KEY REFERENCES knowledge_articles(id),
  embedding JSONB,
  model VARCHAR(64),
  dims INT,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_model ON knowledge_embeddings(model);

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_updated_at ON knowledge_embeddings(updated_at);
