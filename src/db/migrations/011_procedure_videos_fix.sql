-- 010: 修复 procedure_videos.task_id 长度不足（Agnes video_id 可超 128 字符）
ALTER TABLE procedure_videos ALTER COLUMN task_id TYPE TEXT;
