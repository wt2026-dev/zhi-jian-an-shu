-- 011: 工单来源字段 (manual / inspection / wx_scan)
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS source VARCHAR(32) DEFAULT 'manual';
