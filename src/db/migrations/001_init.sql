-- ==============================================================================
-- 工业设备智能检修与作业协同系统 (Industrial Ops Maintenance System v2.0.0)
-- 数据库初始化建表脚本 (PostgreSQL Migration: 001_init.sql)
-- 覆盖实体：用户(users)、作业票(safety_permits)、审计日志(audit_logs)、工单(work_orders)、设备(equipments)、知识库(knowledge_articles)
-- ==============================================================================

-- 1. 用户表 (users)
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  username VARCHAR(64) UNIQUE NOT NULL,
  password VARCHAR(128) NOT NULL,
  name VARCHAR(64) NOT NULL,
  role VARCHAR(32) NOT NULL,
  role_title VARCHAR(128),
  department VARCHAR(128),
  phone VARCHAR(32),
  email VARCHAR(128),
  permissions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 2. 设备台账表 (equipments)
CREATE TABLE IF NOT EXISTS equipments (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(128) NOT NULL,
  category VARCHAR(64) NOT NULL,
  model VARCHAR(128),
  workshop VARCHAR(128),
  location TEXT,
  install_date VARCHAR(64),
  manufacturer VARCHAR(128),
  status VARCHAR(32) NOT NULL,
  health_score INT DEFAULT 100,
  criticality VARCHAR(64),
  telemetry JSONB DEFAULT '{}'::jsonb,
  specs JSONB DEFAULT '{}'::jsonb,
  maintenance_history JSONB DEFAULT '[]'::jsonb,
  next_inspection_date VARCHAR(64),
  assigned_technician VARCHAR(64),
  qr_code VARCHAR(128),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_equipments_code ON equipments(code);
CREATE INDEX IF NOT EXISTS idx_equipments_workshop ON equipments(workshop);
CREATE INDEX IF NOT EXISTS idx_equipments_status ON equipments(status);

-- 3. 检修工单表 (work_orders)
CREATE TABLE IF NOT EXISTS work_orders (
  id VARCHAR(64) PRIMARY KEY,
  order_no VARCHAR(64) UNIQUE NOT NULL,
  title TEXT NOT NULL,
  equipment_id VARCHAR(64) NOT NULL,
  equipment_name VARCHAR(128),
  equipment_code VARCHAR(64),
  workshop VARCHAR(128),
  fault_type VARCHAR(64),
  priority VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  creator VARCHAR(64),
  dispatcher VARCHAR(64),
  assignee VARCHAR(64),
  assignee_id VARCHAR(64),
  created_at VARCHAR(64),
  dispatched_at VARCHAR(64),
  accepted_at VARCHAR(64),
  completed_at VARCHAR(64),
  accepted_by_inspector_at VARCHAR(64),
  description TEXT,
  safety_requirements JSONB DEFAULT '[]'::jsonb,
  photos JSONB DEFAULT '[]'::jsonb,
  repair_log JSONB,
  acceptance JSONB,
  version INT DEFAULT 1,
  created_timestamp BIGINT,
  created_at_dt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at_dt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_work_orders_order_no ON work_orders(order_no);
CREATE INDEX IF NOT EXISTS idx_work_orders_equipment_id ON work_orders(equipment_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_priority ON work_orders(priority);

-- 4. 安全管理高危作业票表 (safety_permits)
CREATE TABLE IF NOT EXISTS safety_permits (
  id VARCHAR(64) PRIMARY KEY,
  permit_no VARCHAR(64) UNIQUE NOT NULL,
  permit_type VARCHAR(64) NOT NULL,
  risk_level VARCHAR(64) NOT NULL,
  title TEXT NOT NULL,
  equipment_id VARCHAR(64),
  equipment_name VARCHAR(128),
  workshop VARCHAR(128),
  location TEXT,
  applicant VARCHAR(64) NOT NULL,
  applicant_dept VARCHAR(128),
  applied_at VARCHAR(64),
  valid_until VARCHAR(64),
  status VARCHAR(32) NOT NULL,
  precautions JSONB DEFAULT '[]'::jsonb,
  loto_number VARCHAR(64),
  hazards JSONB DEFAULT '[]'::jsonb,
  safety_checklist JSONB DEFAULT '[]'::jsonb,
  gas_test_results JSONB,
  guardian_approval JSONB,
  supervisorApproval JSONB,
  closed_at VARCHAR(64),
  closed_by VARCHAR(64),
  close_remark TEXT,
  version INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_safety_permits_permit_no ON safety_permits(permit_no);
CREATE INDEX IF NOT EXISTS idx_safety_permits_status ON safety_permits(status);
CREATE INDEX IF NOT EXISTS idx_safety_permits_risk_level ON safety_permits(risk_level);

-- 5. 操作审计日志表 (audit_logs) - 无 500 条上限，永久安全落库
CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  timestamp VARCHAR(64) NOT NULL,
  user_id VARCHAR(64),
  user_name VARCHAR(64),
  user_role VARCHAR(64),
  ip VARCHAR(64),
  action_type VARCHAR(64) NOT NULL,
  module VARCHAR(64) NOT NULL,
  detail TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_module ON audit_logs(module);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- 6. RAG 知识库文章表 (knowledge_articles)
CREATE TABLE IF NOT EXISTS knowledge_articles (
  id VARCHAR(64) PRIMARY KEY,
  title TEXT NOT NULL,
  category VARCHAR(64) NOT NULL,
  target_equipment VARCHAR(128),
  tags JSONB DEFAULT '[]'::jsonb,
  summary TEXT,
  content TEXT NOT NULL,
  author VARCHAR(64),
  updated_at VARCHAR(64),
  view_count INT DEFAULT 0,
  likes INT DEFAULT 0,
  file_type VARCHAR(32) DEFAULT 'manual',
  chunks_count INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_articles(category);

-- 7. 工单流转操作日志表 (work_order_logs)
CREATE TABLE IF NOT EXISTS work_order_logs (
  id VARCHAR(64) PRIMARY KEY,
  work_order_id VARCHAR(64) NOT NULL,
  action VARCHAR(64) NOT NULL,
  previous_status VARCHAR(64),
  new_status VARCHAR(64),
  operator_name VARCHAR(64),
  comment TEXT,
  created_at VARCHAR(64),
  created_at_dt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_work_order_logs_wo_id ON work_order_logs(work_order_id);
