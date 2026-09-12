-- ==============================================================================
-- 数据库增量迁移: 004_upload_files.sql
-- 覆盖实体：上传文件元数据（P2-7 文件上传安全加固）
-- ==============================================================================

CREATE TABLE IF NOT EXISTS upload_files (
  id VARCHAR(64) PRIMARY KEY,
  stored_name VARCHAR(128) UNIQUE NOT NULL,
  original_name VARCHAR(255),
  size_bytes BIGINT,
  mime_type VARCHAR(64),
  width INT,
  height INT,
  uploader_id VARCHAR(64),
  uploader_name VARCHAR(64),
  access VARCHAR(16) DEFAULT 'private',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_upload_files_uploader ON upload_files(uploader_id);
CREATE INDEX IF NOT EXISTS idx_upload_files_created ON upload_files(created_at);
