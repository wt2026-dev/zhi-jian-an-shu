-- ==============================================================================
-- 工业设备智能检修与作业协同系统 (Industrial Ops Maintenance System v2.0.0)
-- 数据库增量迁移: 020_user_status.sql
-- 覆盖实体：用户状态管理（status 字段: active / disabled 与状态索引）
-- ==============================================================================

-- 1. 为 users 表增加 status 状态字段，默认 'active'
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(16) DEFAULT 'active';

-- 2. 为既有用户数据回填 status 为 'active'
UPDATE users SET status = 'active' WHERE status IS NULL;

-- 3. 创建状态索引以加速状态过滤与登录校验查询
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
