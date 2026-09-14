-- ============================================================
-- 022_timestamp_normalize.sql
-- 时间戳 ISO-8601 标准化与历史数据向后兼容
--
-- 说明：
--   1. 服务端所有持久化时间字段全面采用 ISO-8601 格式（new Date().toISOString()）。
--   2. work_orders.created_at_dt / updated_at_dt 以及 audit_logs.created_at
--      原有 TIMESTAMPTZ 索引继续保持时间升序排列。
--   3. 本迁移确保所有相关查询索引幂等就绪。
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_work_orders_created_at_dt ON work_orders(created_at_dt);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
