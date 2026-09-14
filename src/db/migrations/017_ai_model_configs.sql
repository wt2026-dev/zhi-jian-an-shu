-- ==============================================================================
-- 多模型路由配置 (AI Model Router)：可编排 / 可降级 / 可视化配置的多模型接入
-- 017_ai_model_configs.sql
-- 注：015 已被 015_ai_task_pipeline.sql 占用、016 已被 016_ai_generation_reviews.sql 占用，顺延为 017
-- 幂等设计：CREATE TABLE IF NOT EXISTS，可重复执行
-- ==============================================================================

CREATE TABLE IF NOT EXISTS ai_model_configs (
  id VARCHAR(64) PRIMARY KEY,
  provider VARCHAR(64) NOT NULL,
  display_name VARCHAR(128) NOT NULL,
  base_url VARCHAR(256) NOT NULL DEFAULT '',
  api_key_encrypted TEXT,
  api_key_env VARCHAR(64),
  model_name VARCHAR(128) NOT NULL,
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  priority INT NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  health_status VARCHAR(16) NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('unknown','healthy','unhealthy')),
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 同一 provider 下模型名唯一，防止重复录入
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_model_configs_model ON ai_model_configs(provider, model_name);
CREATE INDEX IF NOT EXISTS idx_ai_model_configs_priority ON ai_model_configs(priority);
