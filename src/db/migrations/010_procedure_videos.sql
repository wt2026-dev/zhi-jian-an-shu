-- 009: 标准化检修作业指引真正 AI 视频生成记录表 (Agnes AI)
CREATE TABLE IF NOT EXISTS procedure_videos (
  id VARCHAR(64) PRIMARY KEY,
  procedure_id VARCHAR(64) NOT NULL REFERENCES maintenance_procedures(id) ON DELETE CASCADE,
  task_id TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  video_url TEXT,
  prompt TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_proc_videos_proc_id ON procedure_videos(procedure_id);
CREATE INDEX IF NOT EXISTS idx_proc_videos_task_id ON procedure_videos(task_id);
CREATE INDEX IF NOT EXISTS idx_proc_videos_created_at ON procedure_videos(created_at DESC);

