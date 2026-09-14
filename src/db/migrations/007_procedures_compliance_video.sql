-- 006: 标准化检修作业指引、AI合规审查与视频多模态分析持久化表

-- 1. 标准化检修作业指引表 (maintenance_procedures)
CREATE TABLE IF NOT EXISTS maintenance_procedures (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(256) NOT NULL,
  equipment_type VARCHAR(64) NOT NULL,
  maintenance_level VARCHAR(64) NOT NULL,
  steps JSONB NOT NULL,
  estimated_minutes INT DEFAULT 60,
  script JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_proc_eq_level ON maintenance_procedures(equipment_type, maintenance_level);
CREATE INDEX IF NOT EXISTS idx_proc_title ON maintenance_procedures(title);

-- 2. 工单操作合规审查记录表 (compliance_checks)
CREATE TABLE IF NOT EXISTS compliance_checks (
  id VARCHAR(64) PRIMARY KEY,
  work_order_id VARCHAR(64) NOT NULL,
  operator VARCHAR(64),
  device_name VARCHAR(128),
  violations JSONB DEFAULT '[]'::jsonb,
  total_steps INT DEFAULT 0,
  passed_steps INT DEFAULT 0,
  score INT NOT NULL DEFAULT 100,
  summary TEXT,
  checked_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_compliance_order ON compliance_checks(work_order_id);
CREATE INDEX IF NOT EXISTS idx_compliance_score ON compliance_checks(score);
CREATE INDEX IF NOT EXISTS idx_compliance_created ON compliance_checks(created_at);

-- 3. 视频多模态智能故障分析日志表 (ai_analysis_log)
CREATE TABLE IF NOT EXISTS ai_analysis_log (
  id VARCHAR(64) PRIMARY KEY,
  video_id VARCHAR(128),
  frames_count INT DEFAULT 0,
  question TEXT,
  device_model VARCHAR(128),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_video ON ai_analysis_log(video_id);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_created ON ai_analysis_log(created_at);
