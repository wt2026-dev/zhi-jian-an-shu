-- ==============================================================================
-- AI 生成内容审核台 (AI Generation Review)：AI 生成内容正式使用前的人工审核闸
-- 016_ai_generation_reviews.sql
-- 注：编号 015 已被 015_ai_task_pipeline.sql 占用，本迁移顺延为 016
-- 幂等设计：CREATE TABLE IF NOT EXISTS，可重复执行
-- ==============================================================================

CREATE TABLE IF NOT EXISTS ai_generation_reviews (
  id VARCHAR(64) PRIMARY KEY,
  ai_endpoint VARCHAR(128) NOT NULL,
  source_type VARCHAR(32) NOT NULL CHECK (source_type IN ('maintenance_plan','safety_risk','report','work_order_draft')),
  content_json JSONB NOT NULL,
  knowledge_sources JSONB DEFAULT '[]'::jsonb,
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewer VARCHAR(64),
  review_note TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_gen_reviews_status ON ai_generation_reviews(status, created_at DESC);
