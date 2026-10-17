-- 024: 视频生成进度透传：记录 Agnes 远端真实进度（progressPct / internalStatus）。
-- 幂等：IF NOT EXISTS 确保重复执行不报错。
ALTER TABLE procedure_videos ADD COLUMN IF NOT EXISTS progress_pct INTEGER NULL;
ALTER TABLE procedure_videos ADD COLUMN IF NOT EXISTS internal_status TEXT NULL;
