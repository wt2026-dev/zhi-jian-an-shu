-- ==============================================================================
-- 工业设备智能检修与作业协同系统 (Industrial Ops Maintenance System v2.0.0)
-- 数据库增量迁移: 002_inspections_telemetry.sql
-- 覆盖实体：巡检任务(inspections)、设备遥测历史时序(equipment_telemetry)
-- 让「巡检作业」与「健康监测」两大数据源由前端 mock 升级为本地真实落库
-- ==============================================================================

-- 8. 巡检任务表 (inspections)
CREATE TABLE IF NOT EXISTS inspections (
  id VARCHAR(64) PRIMARY KEY,
  task_no VARCHAR(64) UNIQUE NOT NULL,
  title TEXT NOT NULL,
  type VARCHAR(32) NOT NULL DEFAULT 'daily',
  inspector_id VARCHAR(64),
  inspector_name VARCHAR(128),
  workshop VARCHAR(128),
  route TEXT,
  scheduled_date VARCHAR(128),
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  total_points INT DEFAULT 0,
  completed_points INT DEFAULT 0,
  abnormal_count INT DEFAULT 0,
  items JSONB DEFAULT '[]'::jsonb,
  started_at VARCHAR(64),
  finished_at VARCHAR(64),
  summary TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inspections_status ON inspections(status);
CREATE INDEX IF NOT EXISTS idx_inspections_workshop ON inspections(workshop);
CREATE INDEX IF NOT EXISTS idx_inspections_inspector ON inspections(inspector_id);
CREATE INDEX IF NOT EXISTS idx_inspections_scheduled ON inspections(scheduled_date);

-- 9. 设备遥测历史时序表 (equipment_telemetry) - 健康监测图表真实数据源
CREATE TABLE IF NOT EXISTS equipment_telemetry (
  id BIGSERIAL PRIMARY KEY,
  equipment_id VARCHAR(64) NOT NULL,
  equipment_code VARCHAR(64),
  recorded_at VARCHAR(64),
  recorded_at_dt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  temperature NUMERIC(8,2),
  vibration NUMERIC(8,2),
  current NUMERIC(8,2),
  voltage NUMERIC(8,2),
  pressure NUMERIC(8,2),
  load_rate NUMERIC(8,2),
  rpm NUMERIC(8,2)
);

CREATE INDEX IF NOT EXISTS idx_telemetry_equipment_time ON equipment_telemetry(equipment_id, recorded_at_dt DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_equipment_code ON equipment_telemetry(equipment_code);
