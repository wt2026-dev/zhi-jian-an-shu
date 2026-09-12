-- ==============================================================================
-- AI 协同任务链路 (AI Task Pipeline)：可编排 / 可追踪 / 可审核的多步协同任务
-- 015_ai_task_pipeline.sql
-- ai_tasks       协同任务主表（一次"AI 协同诊断"编排 = 一个任务）
-- ai_task_steps  任务步骤明细表（每个子任务一行，记录状态/进度/结果/错误）
-- 幂等设计：CREATE TABLE IF NOT EXISTS，可重复执行
-- ==============================================================================

CREATE TABLE IF NOT EXISTS ai_tasks (
  id VARCHAR(64) PRIMARY KEY,
  scene VARCHAR(64) NOT NULL DEFAULT 'collaborative-diagnosis',
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  progress INT NOT NULL DEFAULT 0,
  current_step VARCHAR(64),
  result_json JSONB,
  created_by VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ai_task_steps (
  id VARCHAR(64) PRIMARY KEY,
  task_id VARCHAR(64) NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
  step_name VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  progress INT NOT NULL DEFAULT 0,
  result_json JSONB,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_task_steps_task ON ai_task_steps(task_id);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_created ON ai_tasks(created_at DESC);
