import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { getDb } from './db.ts';
import { TelemetryRepository } from './repository.ts';

// ==============================================================================
// 工业设备智能检修与作业协同系统 - 数据库种子数据 (Seed Data v2.1.0)
// ADR: 数据/代码分离架构，纯数据维护于 seed-data/*.json，本文件纯逻辑层 (<= 400 行)
// ==============================================================================

// 与 db.ts 的 migrationsDir 同用 process.cwd()：esbuild 将本文件打进 CJS 产物，
// import.meta.url 在该产物里为 undefined（dev 的 tsx/ESM 下才存在）。
const seedDataDir = path.join(process.cwd(), 'src', 'db', 'seed-data');

function loadJson<T = any>(filename: string): T {
  const filepath = path.join(seedDataDir, filename);
  return JSON.parse(fs.readFileSync(filepath, 'utf-8').replace(/^\uFEFF/, ''));
}

const seedUsersData = loadJson<any[]>('users.json');
const seedEquipmentsData = loadJson<any[]>('equipments.json');
const seedWorkOrdersData = loadJson<any[]>('work-orders.json');
const seedSafetyPermitsData = loadJson<any[]>('safety-permits.json');
const seedLotoLocksData = loadJson<any[]>('loto-locks.json');
const seedNotificationsData = loadJson<any[]>('notifications.json');
const seedAuditLogsData = loadJson<any[]>('audit-logs.json');
const seedKnowledgeArticlesData = loadJson<any[]>('knowledge-articles.json');
const seedInspectionsData = loadJson<any[]>('inspections.json');
const seedProceduresData = loadJson<any[]>('maintenance-procedures.json');

function toIsoOrNull(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(String(value).replace(/-/g, '/'));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const round = (val: number, d = 2) => Math.round(val * Math.pow(10, d)) / Math.pow(10, d);
const clamp = (val: number, min: number, max: number) => Math.min(max, Math.max(min, val));

export async function seedDatabase(): Promise<void> {
  const db = await getDb();
  console.log('[Seed] 开始插入初始数据库种子数据...');

  const DEMO_PASSWORDS: Record<string, string> = {
    admin: 'Admin@2026#Demo', manager: 'Manager@2026#Safe', tech1: 'Tech1@2026#Work',
    inspector: 'Inspect@2026#Check', operator: 'Operator@2026#Line', tech2: 'Tech2@2026#Elec',
    inspector2: 'Inspect2@2026#Site', operator2: 'Operator2@2026#Lift', archivist: 'Archive@2026#Doc',
  };
  // 生产静态哈希缓存（避免测试与启动时重复 9 次 bcrypt 计算消耗 CPU）
  const PRECOMPUTED_HASHES: Record<string, string> = {
    admin: '$2b$10$f6lyS6qKg1twGal33BDPnOPXSPeNLB6DJvglIujxHw8WalTazta5e',
    manager: '$2b$10$fBb69UDbkXl3O32m8JB49ufibKSXjvZe7wM6Ku3cYRnt3NpaXAB8O',
    tech1: '$2b$10$Jkegsa88soIyC8GLwusMueHbT2ofQYSqA2vzU7HpMz9PcTYJqAQ4O',
    inspector: '$2b$10$s2fLWGU541Sb.EUgYha/Neysp7a/AZjtKSQUO9iLHoCloe2cNjwIC',
    operator: '$2b$10$ysM3Ymz/UCjtufxMcag6GubtMjj6yybFYGQVhXjIGZYko2F4Qpc0y',
    tech2: '$2b$10$cmAK86WWpFmsCFrawHhb0eJtMLgQMqIcJQfgCHh4SccGh5sCZbWou',
    inspector2: '$2b$10$L5e.IpUMfwxcOjaqB9RnSehx.rFgsQ.GbE3Xrar4rOn29pruL7VKS',
    operator2: '$2b$10$lhpgs6RSA898Dhi2Bb/d6uHUVDPQaZnOQpN5MgX73kqBjAFM0NwuW',
    archivist: '$2b$10$yuFpYqqoxEhX6dWCnBALleVYNQce4XOySGWMxjL6BGM4uSjIQyQR2',
  };

  try {
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS certifications JSONB DEFAULT '[]'::jsonb;`);
    await db.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id VARCHAR(64);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);`);
    await db.query(`ALTER TABLE safety_permits ADD COLUMN IF NOT EXISTS supervisor_approval JSONB;`);
  } catch (_) {}

  // 1. 用户数据
  for (const u of seedUsersData) {
    const plain = DEMO_PASSWORDS[u.username];
    const password = PRECOMPUTED_HASHES[u.username] || (plain ? bcrypt.hashSync(plain, 10) : '');
    await db.query(
      `INSERT INTO users (id, username, password, name, role, role_title, department, phone, email, permissions, certifications)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         username = EXCLUDED.username, password = EXCLUDED.password, name = EXCLUDED.name,
         role = EXCLUDED.role, role_title = EXCLUDED.role_title, department = EXCLUDED.department,
         phone = EXCLUDED.phone, email = EXCLUDED.email, permissions = EXCLUDED.permissions,
         certifications = EXCLUDED.certifications;`,
      [u.id, u.username, password, u.name, u.role, u.roleTitle, u.department, u.phone, u.email, JSON.stringify(u.permissions), JSON.stringify(u.certifications || [])]
    );
  }
  console.log(`[Seed] 成功插入/更新 ${seedUsersData.length} 个用户`);

  // 调度模块补种：技能标签与初始位置
  await db.query(`UPDATE users SET skills = '["泵类检修","轴承更换","机械密封更换","润滑保养","对中校准"]'::jsonb, map_x = 140, map_y = 320, online_status = 'online', geo_lng = 113.307, geo_lat = 23.121 WHERE username = 'tech1' AND (skills IS NULL OR skills = '[]'::jsonb OR skills = '{}'::jsonb);`);
  await db.query(`UPDATE users SET skills = '["电气故障","电机检修","变频器调试","高压测试","PLC 排查"]'::jsonb, map_x = 300, map_y = 160, online_status = 'online', geo_lng = 113.305, geo_lat = 23.123 WHERE username = 'tech2' AND (skills IS NULL OR skills = '[]'::jsonb OR skills = '{}'::jsonb);`);
  await db.query(`UPDATE users SET skills = '["设备点检","隐患排除","振动监测"]'::jsonb, map_x = 480, map_y = 300, online_status = 'idle', geo_lng = 113.310, geo_lat = 23.120 WHERE username = 'inspector' AND (skills IS NULL OR skills = '[]'::jsonb OR skills = '{}'::jsonb);`);
  await db.query(`UPDATE users SET skills = '["巡检管理","状态监测","温度测振"]'::jsonb, map_x = 520, map_y = 680, online_status = 'idle', geo_lng = 113.311, geo_lat = 23.117 WHERE username = 'inspector2' AND (skills IS NULL OR skills = '[]'::jsonb OR skills = '{}'::jsonb);`);

  // 2. 设备台账
  for (const eq of seedEquipmentsData) {
    await db.query(
      `INSERT INTO equipments (id, code, name, category, model, workshop, location, install_date, manufacturer, status, health_score, criticality, telemetry, specs, maintenance_history, next_inspection_date, assigned_technician, qr_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (id) DO UPDATE SET
         code = EXCLUDED.code, name = EXCLUDED.name, category = EXCLUDED.category, model = EXCLUDED.model,
         workshop = EXCLUDED.workshop, location = EXCLUDED.location, install_date = EXCLUDED.install_date,
         manufacturer = EXCLUDED.manufacturer, status = EXCLUDED.status, health_score = EXCLUDED.health_score,
         criticality = EXCLUDED.criticality, telemetry = EXCLUDED.telemetry, specs = EXCLUDED.specs,
         maintenance_history = EXCLUDED.maintenance_history, next_inspection_date = EXCLUDED.next_inspection_date,
         assigned_technician = EXCLUDED.assigned_technician, qr_code = EXCLUDED.qr_code, updated_at = CURRENT_TIMESTAMP;`,
      [eq.id, eq.code, eq.name, eq.category, eq.model, eq.workshop, eq.location, eq.installDate, eq.manufacturer, eq.status, eq.healthScore, eq.criticality, JSON.stringify(eq.telemetry), JSON.stringify(eq.specs), JSON.stringify(eq.maintenanceHistory), eq.nextInspectionDate, eq.assignedTechnician, eq.qrCode]
    );
  }
  console.log(`[Seed] 成功插入/更新 ${seedEquipmentsData.length} 个设备台账`);

  // 3. 检修工单
  const woLegacyParse = (s: string) => new Date(s.replace(/\//g, '-')).getTime();
  const woIsoToZh = (ts: number) => new Date(ts).toLocaleString('zh-CN', { hour12: false });
  for (const wo of seedWorkOrdersData) {
    const base: number = wo.createdTimestamp ?? Date.now();
    const legacyCreated = typeof wo.createdAt === 'string' ? woLegacyParse(wo.createdAt) : NaN;
    const shift = (legacy: string | null | undefined, fallbackMin: number): string | null => {
      if (legacy === null || legacy === undefined) return null;
      const parsed = typeof legacy === 'string' && legacy.length > 0 ? woLegacyParse(legacy) : NaN;
      const delta = Number.isFinite(parsed) && Number.isFinite(legacyCreated) ? parsed - legacyCreated : fallbackMin * 60000;
      return woIsoToZh(base + delta);
    };
    wo.createdAt = woIsoToZh(base);
    wo.dispatchedAt = ['dispatched', 'in_progress', 'pending_acceptance', 'completed', 'cancelled'].includes(wo.status) ? shift(wo.dispatchedAt, 15) : (wo.dispatchedAt ?? null);
    wo.acceptedAt = ['in_progress', 'pending_acceptance', 'completed'].includes(wo.status) ? shift(wo.acceptedAt, 30) : (wo.acceptedAt ?? null);
    wo.completedAt = wo.status === 'completed' ? shift(wo.completedAt, 180) : (wo.completedAt ?? null);
    wo.acceptedByInspectorAt = wo.status === 'completed' ? shift(wo.acceptedByInspectorAt, 210) : (wo.acceptedByInspectorAt ?? null);

    await db.query(
      `INSERT INTO work_orders (id, order_no, title, equipment_id, equipment_name, equipment_code, workshop, fault_type, priority, status, creator, dispatcher, assignee, assignee_id, created_at, dispatched_at, accepted_at, completed_at, accepted_by_inspector_at, description, safety_requirements, photos, repair_log, acceptance, version, created_timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, status = EXCLUDED.status, priority = EXCLUDED.priority,
         assignee = EXCLUDED.assignee, repair_log = EXCLUDED.repair_log, acceptance = EXCLUDED.acceptance, version = EXCLUDED.version;`,
      [wo.id, wo.orderNo, wo.title, wo.equipmentId, wo.equipmentName, wo.equipmentCode, wo.workshop, wo.faultType, wo.priority, wo.status, wo.creator, wo.dispatcher, wo.assignee, wo.assigneeId, wo.createdAt, wo.dispatchedAt, wo.acceptedAt, wo.completedAt, wo.acceptedByInspectorAt, wo.description, JSON.stringify(wo.safetyRequirements), JSON.stringify(wo.photos), wo.repairLog ? JSON.stringify(wo.repairLog) : null, wo.acceptance ? JSON.stringify(wo.acceptance) : null, wo.version, wo.createdTimestamp]
    );
  }
  console.log(`[Seed] 成功插入/更新 ${seedWorkOrdersData.length} 个工单`);

  // 4. 高危作业票
  // 演示库联锁可用性：未结案（approved/active）的作业票，若种子有效期已过，
  // 则滚动顺延到「今天 20:00」，避免演示库一开工就被「作业票已过期」联锁拦截。
  const permitRollDeadline = () => {
    const d = new Date();
    d.setHours(20, 0, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return woIsoToZh(d.getTime());
  };
  for (const sp of seedSafetyPermitsData) {
    const expireAt = woLegacyParse(sp.validUntil || '');
    const rolledValidUntil = ['approved', 'active'].includes(sp.status) && (!Number.isFinite(expireAt) || expireAt < Date.now())
      ? permitRollDeadline()
      : sp.validUntil;
    if (rolledValidUntil !== sp.validUntil) {
      console.log(`[Seed] 作业票 ${sp.permitNo} 有效期已过，演示联锁滚动顺延至今日 20:00`);
    }
    await db.query(
      `INSERT INTO safety_permits (id, permit_no, permit_type, risk_level, title, equipment_id, equipment_name, workshop, location, applicant, applicant_dept, applied_at, valid_until, status, precautions, loto_number, hazards, safety_checklist, gas_test_results, guardian_approval, supervisor_approval, closed_at, closed_by, close_remark, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status, precautions = EXCLUDED.precautions, hazards = EXCLUDED.hazards, safety_checklist = EXCLUDED.safety_checklist,
         guardian_approval = EXCLUDED.guardian_approval, supervisor_approval = EXCLUDED.supervisor_approval, gas_test_results = EXCLUDED.gas_test_results,
         closed_at = EXCLUDED.closed_at, closed_by = EXCLUDED.closed_by, close_remark = EXCLUDED.close_remark, version = EXCLUDED.version;`,
      [sp.id, sp.permitNo, sp.permitType, sp.riskLevel, sp.title, sp.equipmentId, sp.equipmentName, sp.workshop, sp.location, sp.applicant, sp.applicantDept, sp.appliedAt, rolledValidUntil, sp.status, JSON.stringify(sp.precautions), sp.lotoNumber, JSON.stringify(sp.hazards), JSON.stringify(sp.safetyChecklist), sp.gasTestResults ? JSON.stringify(sp.gasTestResults) : null, sp.guardianApproval ? JSON.stringify(sp.guardianApproval) : null, sp.supervisorApproval ? JSON.stringify(sp.supervisorApproval) : null, sp.closedAt, sp.closedBy, sp.closeRemark, sp.version]
    );
  }
  console.log(`[Seed] 成功插入/更新 ${seedSafetyPermitsData.length} 个高危作业票`);

  // 4.5 LOTO 能量隔离锁具
  for (const lock of seedLotoLocksData) {
    await db.query(
      `INSERT INTO loto_locks (id, lock_no, permit_no, permit_title, point_name, energy_source, location, workshop, locked_by, locked_at, status, unlocked_at, unlock_remark)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status, locked_by = EXCLUDED.locked_by, locked_at = EXCLUDED.locked_at,
         unlocked_at = EXCLUDED.unlocked_at, unlock_remark = EXCLUDED.unlock_remark;`,
      [lock.id, lock.lockNo, lock.permitNo, lock.permitTitle, lock.pointName, lock.energySource, lock.location, lock.workshop, lock.lockedBy, lock.lockedAt, lock.status, lock.unlockedAt, lock.unlockRemark]
    );
  }
  console.log(`[Seed] 成功插入/更新 ${seedLotoLocksData.length} 组 LOTO 锁具`);

  // 4.6 系统通知
  for (const n of seedNotificationsData) {
    await db.query(
      `INSERT INTO notifications (id, user_id, title, content, type, time, read, ref_type, ref_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         user_id = EXCLUDED.user_id, title = EXCLUDED.title, content = EXCLUDED.content,
         type = EXCLUDED.type, time = EXCLUDED.time, read = EXCLUDED.read, ref_type = EXCLUDED.ref_type, ref_id = EXCLUDED.ref_id;`,
      [n.id, n.userId, n.title, n.content, n.type, n.time, n.read, n.refType, n.refId]
    );
  }
  console.log(`[Seed] 成功插入/更新 ${seedNotificationsData.length} 条岗位专属通知`);

  // 5. 操作审计日志
  for (const al of seedAuditLogsData) {
    await db.query(
      `INSERT INTO audit_logs (id, timestamp, user_id, user_name, user_role, ip, action_type, module, detail, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO NOTHING;`,
      [al.id, new Date(Date.now() - al.hoursAgo * 3600000).toLocaleString('zh-CN'), al.userId, al.userName, al.userRole, al.ip, al.actionType, al.module, al.detail, al.status, JSON.stringify(al.metadata)]
    );
  }
  console.log(`[Seed] 成功插入 ${seedAuditLogsData.length} 条审计日志 (DO NOTHING 幂等)`);

  // 6. RAG 检修知识库
  for (const art of seedKnowledgeArticlesData) {
    await db.query(
      `INSERT INTO knowledge_articles (id, title, category, target_equipment, tags, summary, content, author, updated_at, view_count, likes, file_type, chunks_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary, content = EXCLUDED.content;`,
      [art.id, art.title, art.category, art.targetEquipment, JSON.stringify(art.tags), art.summary, art.content, art.author, art.updatedAt, art.viewCount, art.likes, art.fileType, art.chunksCount]
    );
  }
  console.log(`[Seed] 成功插入/更新 ${seedKnowledgeArticlesData.length} 篇知识库文章`);

  // 7. 巡检任务
  for (const task of seedInspectionsData) {
    const items = task.items || task.points || [];
    const completed = items.filter((i: any) => i.status === 'normal' || i.status === 'abnormal').length;
    const abnormal = items.filter((i: any) => i.status === 'abnormal').length;
    await db.query(
      `INSERT INTO inspections (id, task_no, title, type, inspector_id, inspector_name, workshop, route, scheduled_date, status, total_points, completed_points, abnormal_count, items, started_at, finished_at, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, type = EXCLUDED.type, inspector_id = EXCLUDED.inspector_id, inspector_name = EXCLUDED.inspector_name,
         workshop = EXCLUDED.workshop, route = EXCLUDED.route, scheduled_date = EXCLUDED.scheduled_date, status = EXCLUDED.status,
         total_points = EXCLUDED.total_points, completed_points = EXCLUDED.completed_points, abnormal_count = EXCLUDED.abnormal_count,
         items = EXCLUDED.items, started_at = EXCLUDED.started_at, finished_at = EXCLUDED.finished_at, summary = EXCLUDED.summary, updated_at = CURRENT_TIMESTAMP;`,
      [task.id, task.taskNo, task.title, task.type, task.inspectorId, task.inspectorName, task.workshop, task.route, task.scheduledDate, task.status, items.length, completed, abnormal, JSON.stringify(items), task.startedAt, task.finishedAt, task.summary]
    );
  }
  console.log(`[Seed] 成功插入/更新 ${seedInspectionsData.length} 个巡检任务`);

  // 7.5 标准化检修规程
  for (const proc of seedProceduresData) {
    await db.query(
      `INSERT INTO maintenance_procedures (id, title, equipment_type, maintenance_level, estimated_minutes, steps)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, equipment_type = EXCLUDED.equipment_type, maintenance_level = EXCLUDED.maintenance_level,
         estimated_minutes = EXCLUDED.estimated_minutes, steps = EXCLUDED.steps, updated_at = CURRENT_TIMESTAMP;`,
      [proc.id, proc.title, proc.equipment_type, proc.maintenance_level, proc.estimated_minutes, JSON.stringify(proc.steps)]
    );
  }
  console.log(`[Seed] 成功插入/更新 ${seedProceduresData.length} 份标准化检修规程`);

  // 8. 工单流转操作日志
  const workOrderLogs: any[] = [];
  for (const wo of seedWorkOrdersData) {
    const base = wo.id.replace(/^wo-/, 'log-');
    workOrderLogs.push({ id: `${base}-create`, workOrderId: wo.id, action: 'CREATE', previousStatus: null, newStatus: 'created', operatorName: wo.creator, comment: `创建工单 ${wo.orderNo}: ${wo.title}`, createdAt: wo.createdAt });
    if (wo.dispatchedAt) workOrderLogs.push({ id: `${base}-dispatch`, workOrderId: wo.id, action: 'DISPATCH', previousStatus: 'created', newStatus: 'dispatched', operatorName: wo.dispatcher, comment: `指派责任技师: ${wo.assignee || '待定'}，要求按优先级 ${wo.priority} 响应`, createdAt: wo.dispatchedAt });
    if (wo.acceptedAt) workOrderLogs.push({ id: `${base}-claim`, workOrderId: wo.id, action: 'CLAIM', previousStatus: 'dispatched', newStatus: 'in_progress', operatorName: wo.assignee, comment: '确认接单，已执行 LOTO 停电挂牌并落实安全隔离措施，开始检修作业', createdAt: wo.acceptedAt });
    if (wo.completedAt) workOrderLogs.push({ id: `${base}-complete`, workOrderId: wo.id, action: 'COMPLETE', previousStatus: 'in_progress', newStatus: 'pending_acceptance', operatorName: wo.assignee, comment: `完工上报，工时 ${wo.repairLog?.workHours ?? 0}h，耗用备件 ${wo.repairLog?.partsUsed?.length ?? 0} 项`, createdAt: wo.completedAt });
    if (wo.acceptedByInspectorAt) {
      const acc = wo.acceptance as any;
      workOrderLogs.push({ id: `${base}-accept`, workOrderId: wo.id, action: acc?.pass ? 'ACCEPT' : 'REJECT', previousStatus: 'pending_acceptance', newStatus: acc?.pass ? 'completed' : 'in_progress', operatorName: acc?.inspectorName || '质检专员', comment: acc?.pass ? `质检验收合格闭环 (评分 ${acc?.score} 星): ${acc?.comment || '符合检修工艺标准'}` : `质检验收驳回: ${acc?.comment || '未达到验收标准，退回整改'}`, createdAt: wo.acceptedByInspectorAt });
    }
    if (wo.status === 'cancelled') workOrderLogs.push({ id: `${base}-cancel`, workOrderId: wo.id, action: 'CANCEL', previousStatus: 'created', newStatus: 'cancelled', operatorName: wo.creator, comment: '经生产调度会决定，因备件未到货，本工单取消并顺延至下月检修窗口执行', createdAt: wo.createdAt });
  }

  for (const log of workOrderLogs) {
    await db.query(
      `INSERT INTO work_order_logs (id, work_order_id, action, previous_status, new_status, operator_name, comment, created_at, created_at_dt)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, CURRENT_TIMESTAMP))
       ON CONFLICT (id) DO UPDATE SET action = EXCLUDED.action, new_status = EXCLUDED.new_status, operator_name = EXCLUDED.operator_name, comment = EXCLUDED.comment, created_at = EXCLUDED.created_at;`,
      [log.id, log.workOrderId, log.action, log.previousStatus, log.newStatus, log.operatorName, log.comment, log.createdAt, toIsoOrNull(log.createdAt)]
    );
  }
  console.log(`[Seed] 成功插入/更新 ${workOrderLogs.length} 条工单流转日志`);

  // 9. 设备遥测历史时序 (16 台 × 48 小时 = 768 条)
  const PRESSURE_BASE: Record<string, number> = {
    'eq-101': 0.85, 'eq-102': 0.82, 'eq-103': 0.34, 'eq-104': 0.3, 'eq-105': 6.2, 'eq-106': 0.92, 'eq-107': 0.28, 'eq-108': 0.25,
    'eq-109': 5.5, 'eq-110': 0.55, 'eq-111': 0.42, 'eq-112': 0.65, 'eq-113': 1.35, 'eq-114': 0.2, 'eq-115': 0.55, 'eq-116': 0.38,
  };
  const TELEMETRY_HOURS = 48;
  const now = Date.now();
  const telemetryRows: any[] = [];

  seedEquipmentsData.forEach((eq, eqIndex) => {
    const t: any = eq.telemetry || {};
    const baseTemp = Number(t.temperature ?? 60), baseVib = Number(t.vibration ?? 2), baseCurrent = Number(t.current ?? 50);
    const baseVoltage = Number(t.voltage ?? 380), baseRpm = Number(t.rpm ?? 1500), baseLoad = Number(t.loadRate ?? 70);
    const basePressure = PRESSURE_BASE[eq.id] ?? 0.5, isStandby = eq.status === 'standby';
    const severity = eq.status === 'fault' || eq.status === 'critical' ? 3 : eq.status === 'warning' ? 2 : 0;
    const phase = (eqIndex * Math.PI) / 6;

    for (let h = TELEMETRY_HOURS - 1; h >= 0; h--) {
      const step = TELEMETRY_HOURS - 1 - h, stamp = new Date(now - h * 3600 * 1000), hourOfDay = stamp.getHours();
      const daily = Math.sin((hourOfDay / 24) * Math.PI * 2 + phase), shift = Math.sin((step / 12) * Math.PI * 2 + phase);
      const nTemp = pseudoRandom(eqIndex * 1000 + step * 7.1), nVib = pseudoRandom(eqIndex * 1000 + step * 3.3 + 11);
      const nCur = pseudoRandom(eqIndex * 1000 + step * 5.7 + 23), nVol = pseudoRandom(eqIndex * 1000 + step * 2.9 + 37);
      const nPre = pseudoRandom(eqIndex * 1000 + step * 1.7 + 53), nLoad = pseudoRandom(eqIndex * 1000 + step * 4.1 + 67);
      const nRpm = pseudoRandom(eqIndex * 1000 + step * 6.3 + 79);
      const driftPerHour = isStandby ? 0 : severity * 0.055;
      const temperature = isStandby ? 33 + 3.2 * (1 + daily) * 0.5 + (nTemp - 0.5) * 1.6 : baseTemp + severity * 1.1 + 2.4 * daily + driftPerHour * step + (nTemp - 0.5) * 2.2;
      const vibration = isStandby ? 0.02 + (nVib - 0.5) * 0.02 : Math.max(0.05, baseVib * (1 + 0.09 * daily) + severity * 0.045 * step * 0.25 + (nVib - 0.5) * (0.12 + severity * 0.05));
      const current = isStandby ? 0 : Math.max(0, baseCurrent * (0.9 + 0.14 * shift) + (nCur - 0.5) * baseCurrent * 0.05);
      const voltage = baseVoltage === 0 ? 0 : baseVoltage * (1 + 0.006 * shift + (nVol - 0.5) * 0.006);
      const rpm = baseRpm === 0 ? 0 : baseRpm * (1 + 0.004 * shift + (nRpm - 0.5) * 0.004);
      const loadRate = isStandby ? 0 : clamp(baseLoad + 6.5 * shift + (nLoad - 0.5) * 3.4, 0, 100);
      const pressure = isStandby ? basePressure : Math.max(0, basePressure * (1 + 0.03 * shift) + (nPre - 0.5) * basePressure * 0.02);

      telemetryRows.push({
        equipmentId: eq.id, equipmentCode: eq.code, recordedAt: `${hourOfDay.toString().padStart(2, '0')}:00`,
        recordedAtDt: stamp.toISOString(), temperature: round(clamp(temperature, 0, 160), 1),
        vibration: round(clamp(vibration, 0, 60), 2), current: round(Math.max(0, current), 1),
        voltage: round(Math.max(0, voltage), 1), pressure: round(clamp(pressure, 0, 12), 2),
        loadRate: round(loadRate, 1), rpm: Math.round(rpm),
      });
    }
  });

  await TelemetryRepository.clearAll();
  const telemetryCount = await TelemetryRepository.insertBatch(telemetryRows as any);
  console.log(`[Seed] 成功写入 ${telemetryCount} 条设备遥测历史时序 (${seedEquipmentsData.length} 台 × ${TELEMETRY_HOURS} 小时)`);
  console.log('[Seed] 初始数据库种子数据填充全部完成！');
}

if (process.argv[1]?.endsWith('seed.ts')) {
  seedDatabase().then(async () => {
    console.log('[Seed] 脚本执行成功并退出。');
    const db = await getDb();
    await db.close();
    process.exit(0);
  }).catch((err) => {
    console.error('[Seed] 脚本执行异常:', err);
    process.exit(1);
  });
}
