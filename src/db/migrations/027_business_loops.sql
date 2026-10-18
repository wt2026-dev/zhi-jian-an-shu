-- ==============================================================================
-- Migration 027: Hermes 业务闭环（business_loops）
-- 目的：智能业务管家（Hermes）六环节业务闭环的数据模型：
--   闭环主表 business_loops → 环节表 business_loop_stages → 产出物表 business_loop_artifacts。
--   六环节 stage_key：field_report → hazard_permit → loto → repair_execution → completion → quality_archive。
-- 数据纪律：
--   - 不塞任何种子行，数据全部由真实业务动作（创建闭环 / 确认环节）生成；
--   - AI 预填写入 stages.ai_prefill_json（真实 DashScope 调用或如实 degraded），
--     产出物 ref_id 关联现有业务工单/作业票等真实记录 id，禁止悬空编造。
-- 编号：业务原计划文件名 026，但 026 已被 acceptance_standards 占用，顺延为 027。
-- 幂等：IF NOT EXISTS，重复执行不报错。
-- ==============================================================================

-- 1. 闭环主表
CREATE TABLE IF NOT EXISTS business_loops (
  id VARCHAR(64) PRIMARY KEY,
  loop_no VARCHAR(32) UNIQUE,                          -- PL-YYYYMMDD-NNN
  goal VARCHAR(500) NOT NULL,                          -- 业务目标原文
  equipment_id VARCHAR(64) REFERENCES equipments(id),  -- 可空：目标未识别到具体设备
  initiator_id VARCHAR(64) REFERENCES users(id),
  status VARCHAR(16) DEFAULT 'running',                -- running / paused / archived
  current_stage INT DEFAULT 1 CHECK (current_stage BETWEEN 1 AND 6),
  started_at TIMESTAMPTZ,
  expected_minutes INT,                                -- 六环节预计总时长（分钟）
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_business_loops_status ON business_loops(status);

-- 2. 环节表（每个闭环固定 6 行）
CREATE TABLE IF NOT EXISTS business_loop_stages (
  id VARCHAR(64) PRIMARY KEY,
  loop_id VARCHAR(64) NOT NULL REFERENCES business_loops(id) ON DELETE CASCADE,
  stage_no INT NOT NULL CHECK (stage_no BETWEEN 1 AND 6),
  stage_key VARCHAR(32) NOT NULL CHECK (stage_key IN ('field_report','hazard_permit','loto','repair_execution','completion','quality_archive')),
  status VARCHAR(16) DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed')),
  ai_prefill_json TEXT,                                -- AI 预填内容 JSON（真实调用结果）
  ai_engine VARCHAR(64),                               -- 本次调用的 AI 能力名，如 generate-work-order
  ai_status VARCHAR(16) CHECK (ai_status IN ('ok','degraded')),  -- ok / degraded（不伪造成功）
  confirm_by VARCHAR(64),                              -- 人工闸门确认人
  confirm_at TIMESTAMPTZ,
  page_ref VARCHAR(32),                                -- 对应前端页面路由（work_orders/hazards/...）
  produced_artifact_ref VARCHAR(128),                  -- 环节产物（引用 artifact 或业务记录 id）
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_business_loop_stages ON business_loop_stages(loop_id, stage_no);

-- 3. 产出物表
CREATE TABLE IF NOT EXISTS business_loop_artifacts (
  id VARCHAR(64) PRIMARY KEY,
  loop_id VARCHAR(64) NOT NULL REFERENCES business_loops(id) ON DELETE CASCADE,
  artifact_type VARCHAR(32) NOT NULL CHECK (artifact_type IN ('work_order','hazard_permit','loto_checklist','work_guide','acceptance','quality_report','knowledge_entry','archive_pack')),
  title VARCHAR(200),
  ref_id VARCHAR(128),                                 -- 关联现有业务记录 id（如 work_orders.id）
  status VARCHAR(16) DEFAULT 'pending' CHECK (status IN ('generated','pending')),
  preview_text TEXT,                                   -- 人工推断生产：预览内容（由预填/既有业务记录生成，未生成时留空）
  ai_used VARCHAR(64),                                 -- 生成该产出物所用的 AI 能力（可空：人工产出）
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_business_loop_artifacts ON business_loop_artifacts(loop_id);
