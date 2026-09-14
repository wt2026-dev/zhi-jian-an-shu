-- ==============================================================================
-- 工业设备智能检修与作业协同系统 (Industrial Ops Maintenance System v2.0.0)
-- 数据库增量迁移: 003_notifications_loto.sql
-- 覆盖实体：系统通知(notifications)、LOTO 能量隔离锁具(loto_locks)
-- 让「通知中心」与「LOTO 停电挂牌看板」两大数据源由前端 mock 升级为本地真实落库
-- ==============================================================================

-- 10. 系统通知表 (notifications) - 通知中心 / Header 未读角标真实数据源
CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64),
  title VARCHAR(255) NOT NULL,
  content TEXT,
  type VARCHAR(32) NOT NULL DEFAULT 'info',
  time VARCHAR(64),
  read BOOLEAN DEFAULT FALSE,
  ref_type VARCHAR(64),
  ref_id VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id VARCHAR(64);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type VARCHAR(32) DEFAULT 'info';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS time VARCHAR(64);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read BOOLEAN DEFAULT FALSE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS ref_type VARCHAR(64);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS ref_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

-- 11. LOTO 能量隔离锁具表 (loto_locks) - 工作台/安全看板 LOTO 挂锁真实数据源
CREATE TABLE IF NOT EXISTS loto_locks (
  id VARCHAR(64) PRIMARY KEY,
  lock_no VARCHAR(64) UNIQUE NOT NULL,
  permit_no VARCHAR(64),
  permit_title TEXT,
  point_name VARCHAR(255),
  energy_source VARCHAR(255),
  location VARCHAR(255),
  workshop VARCHAR(128),
  locked_by VARCHAR(64),
  locked_at VARCHAR(64),
  status VARCHAR(32) NOT NULL DEFAULT 'locked',
  unlocked_at VARCHAR(64),
  unlock_remark TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_loto_locks_status ON loto_locks(status);
CREATE INDEX IF NOT EXISTS idx_loto_locks_permit_no ON loto_locks(permit_no);
