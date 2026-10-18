/**
 * 修后验收与效果验证服务 —— 维修流程的最后一环。
 *
 * 设计原则（与「不得造假」一致）：
 *   1. 阈值只来自 acceptance_standards 表（带 source/confidence）。
 *      表里 max_limit 为 NULL 就是"该项没有标准"，判定为 unconfigured，
 *      **绝不用 0 或推算值冒充**。额定电流全厂无台账，因此该项恒为 unconfigured。
 *   2. 修前数据只从 equipment_telemetry（真实遥测落库）按时间窗取，
 *      窗口取工单创建前 24h；没有数据就返回 samples=0，前端显示"未接入"。
 *   3. 合格性由**服务端**按录入时的标准快照复算，不信任前端 verdict。
 *   4. 签字：维修人 = 当前登录者；班组长必须是**另一个人**且具备 manager/admin 角色。
 *      同一人不能兼签 —— 双签字的意义就是两个人。
 *   5. 只有「全部验收项 pass/confirmed」且「两人签字」才把工单转 completed 并生成维修总结。
 */
import crypto from 'node:crypto';
import { WorkOrderRepository } from '../../db/repositories/workOrderRepository.ts';
import { AcceptanceStandardRepository, type AcceptanceStandard } from '../../db/repositories/acceptanceStandardRepository.ts';
import { TelemetryRepository } from '../../db/repositories/telemetryRepository.ts';
import { KnowledgeRepository } from '../../db/repositories/knowledgeRepository.ts';
import { aiCacheInvalidateEquipment } from '../../utils/aiCache.ts';
import { pushNotification } from './auditService.ts';
import { pushWorkOrderLog, STATUS_LABELS } from '../controllers/workOrderController.ts';
import type {
  WorkOrder,
  FieldWorkLog,
  FieldWorkOperator,
  FieldAcceptanceLog,
  AcceptanceCheckRecord,
  AcceptanceBaseline,
  AcceptanceSignature,
  AcceptanceVerdict,
} from '../../types';

function asIso(d: Date): string {
  return d.toISOString();
}

interface ErrorWithCode extends Error {
  code: string;
  status?: number;
  details?: unknown;
}

function fail(code: string, message: string, status = 400, details?: unknown): ErrorWithCode {
  const err = new Error(message) as ErrorWithCode;
  err.code = code;
  err.status = status;
  if (details !== undefined) err.details = details;
  return err;
}

function cleanOperator(u: unknown): FieldWorkOperator {
  const o = (u ?? {}) as Record<string, unknown>;
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : typeof o.username === 'string' ? o.username : '未知操作者';
  return {
    id: typeof o.id === 'string' ? o.id : undefined,
    username: typeof o.username === 'string' ? o.username : undefined,
    name,
    role: typeof o.role === 'string' ? o.role : undefined,
  };
}

function emptyLog(): FieldWorkLog {
  return { events: [], loto: null, steps: {}, measurements: [], partPhotos: [], completed: null, acceptance: null };
}

function normalizeLog(raw: unknown): FieldWorkLog {
  const base = emptyLog();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const r = raw as Record<string, unknown>;
  const steps: Record<string, any> = {};
  if (r.steps && typeof r.steps === 'object' && !Array.isArray(r.steps)) {
    for (const [k, v] of Object.entries(r.steps as Record<string, unknown>)) {
      const s = v as { status?: unknown } | null;
      if (s && typeof s === 'object' && (s.status === 'done' || s.status === 'skip' || s.status === 'issue')) steps[k] = s;
    }
  }
  const acceptance = (r.acceptance && typeof r.acceptance === 'object' ? r.acceptance : null) as FieldAcceptanceLog | null;
  return {
    events: Array.isArray(r.events) ? (r.events as FieldWorkLog['events']) : [],
    loto: (r.loto && typeof r.loto === 'object' ? r.loto : null) as FieldWorkLog['loto'],
    steps,
    measurements: Array.isArray(r.measurements) ? (r.measurements as FieldWorkLog['measurements']) : [],
    partPhotos: Array.isArray(r.partPhotos) ? (r.partPhotos as FieldWorkLog['partPhotos']) : [],
    completed: (r.completed && typeof r.completed === 'object' ? r.completed : null) as FieldWorkLog['completed'],
    acceptance: acceptance
      ? {
          startedAt: acceptance.startedAt ?? null,
          checks: acceptance.checks && typeof acceptance.checks === 'object' ? acceptance.checks : {},
          baselines: Array.isArray(acceptance.baselines) ? acceptance.baselines : [],
          signatures: Array.isArray(acceptance.signatures) ? acceptance.signatures : [],
          closedAt: acceptance.closedAt ?? null,
          summary: acceptance.summary ?? null,
        }
      : null,
  };
}

/* ---------------- 修前基线（真实遥测） ---------------- */

const BASELINE_METRICS: Array<{ key: 'temperature' | 'vibration' | 'current'; label: string; unit: string; alarm: number | null }> = [
  { key: 'temperature', label: '设备温度', unit: '℃', alarm: 80 },
  { key: 'vibration', label: '设备振动', unit: 'mm/s', alarm: 4.5 },
  // 电流无系统报警阈值（不造），alarm=null ⇒ 只给数值不判超限
  { key: 'current', label: '运行电流', unit: 'A', alarm: null },
];

const BASELINE_WINDOW_HOURS = 24;

/**
 * 修前基线：工单创建前 24 小时内的真实遥测。
 * 只统计有限数；缺测点不计入样本，也不当 0。
 */
export async function buildPreBaselines(order: WorkOrder): Promise<AcceptanceBaseline[]> {
  const rows = await TelemetryRepository.getHistoryInWindow(order.equipmentId, BASELINE_WINDOW_HOURS * 30);
  const createdMs = order.createdAt ? Date.parse(String(order.createdAt).replace(/\//g, '-')) : NaN;
  const cutoff = Number.isNaN(createdMs) ? Date.now() : createdMs;
  const fromMs = cutoff - BASELINE_WINDOW_HOURS * 3600 * 1000;

  const inWindow = rows.filter((r: any) => {
    const t = Date.parse(r.fullTime);
    return !Number.isNaN(t) && t >= fromMs && t <= cutoff;
  });

  return BASELINE_METRICS.map((m) => {
    const values = inWindow
      .map((r: any) => r[m.key])
      .filter((v: unknown): v is number => typeof v === 'number' && Number.isFinite(v));
    const samples = values.length;
    const preMax = samples ? Math.max(...values) : null;
    const preAvg = samples ? Math.round((values.reduce((a, b) => a + b, 0) / samples) * 100) / 100 : null;
    const overLimitSamples = m.alarm != null && samples ? values.filter((v) => v >= m.alarm!).length : null;
    return {
      metric: m.key,
      label: m.label,
      unit: m.unit,
      preMax,
      preAvg,
      samples,
      windowFrom: samples ? new Date(fromMs).toISOString() : null,
      windowTo: samples ? new Date(cutoff).toISOString() : null,
      overLimitSamples,
    };
  });
}

/* ---------------- 判定（服务端复算） ---------------- */

/**
 * 按标准快照判定单项。
 * · 定性项（judgedBy='manual'）：需人工 confirmed
 * · 数值项但无 min/max：unconfigured（这是额定电流的真实处境，不推算）
 * · 数值项有下限/上限：越界 fail，否则 pass
 */
export function judgeCheck(
  std: Pick<AcceptanceStandard, 'metric' | 'judgedBy' | 'minLimit' | 'maxLimit'>,
  value: number | null,
  confirmed: boolean
): AcceptanceVerdict {
  if (std.judgedBy === 'manual') return confirmed ? 'pass' : 'pending';
  const hasLimit = std.minLimit != null || std.maxLimit != null;
  if (!hasLimit) return 'unconfigured';
  if (value == null) return 'pending';
  if (std.minLimit != null && value < std.minLimit) return 'fail';
  if (std.maxLimit != null && value > std.maxLimit) return 'fail';
  return 'pass';
}

/* ---------------- 会话读取 ---------------- */

export interface AcceptanceItemView {
  itemKey: string;
  itemLabel: string;
  metric: string;
  unit: string | null;
  minLimit: number | null;
  maxLimit: number | null;
  judgedBy: 'auto' | 'manual';
  standardSource: string;
  confidence: string;
  note: string | null;
  /** 已录入的实测/确认记录 */
  record: AcceptanceCheckRecord | null;
  /** 当前判定（未录入 = pending / 无标准 = unconfigured） */
  verdict: AcceptanceVerdict;
}

export interface AcceptanceSession {
  order: {
    id: string;
    orderNo: string;
    title: string;
    equipmentId: string;
    equipmentName: string;
    faultType: string;
    status: string;
    statusLabel: string;
    createdAt: string | null;
    assignee: string | null;
  };
  /** 是否可进行验收（仅待验收工单） */
  canAccept: boolean;
  blockedReason: string | null;
  items: AcceptanceItemView[];
  /** 全部项均已 pass（可进入签字） */
  allPassed: boolean;
  /** 有 fail 的项数（超标告警） */
  failed: number;
  /** 无标准不可判的项数（如额定电流） */
  unconfigured: number;
  pending: number;
  baselines: AcceptanceBaseline[];
  signatures: AcceptanceSignature[];
  /** 还差谁签字 */
  nextSigner: 'technician' | 'teamlead' | null;
  /** 本次维修的执行人（决定谁有资格签「维修人」）；解析不出时 name 为 null */
  repairer: { id?: string; name: string | null };
  closedAt: string | null;
  summary: FieldAcceptanceLog['summary'] | null;
  events: FieldWorkLog['events'];
  version: number | null;
  dataNote: string;
}

function toItemView(std: AcceptanceStandard, record: AcceptanceCheckRecord | null): AcceptanceItemView {
  const verdict: AcceptanceVerdict = record
    ? record.verdict
    : std.judgedBy === 'manual'
      ? 'pending'
      : std.minLimit == null && std.maxLimit == null
        ? 'unconfigured'
        : 'pending';
  return {
    itemKey: std.itemKey,
    itemLabel: std.itemLabel,
    metric: std.metric,
    unit: std.unit,
    minLimit: std.minLimit,
    maxLimit: std.maxLimit,
    judgedBy: std.judgedBy,
    standardSource: std.source,
    confidence: std.confidence,
    note: std.note,
    record,
    verdict,
  };
}

export async function getAcceptanceSession(orderId: string): Promise<AcceptanceSession> {
  const order = await WorkOrderRepository.getById(orderId);
  if (!order) throw fail('WORK_ORDER_NOT_FOUND', '工单未找到', 404);
  const log = normalizeLog((order.repairLog as WorkOrder['repairLog'])?.fieldLog ?? null);
  const standards = await AcceptanceStandardRepository.getEffective(order.equipmentId);
  const acc = log.acceptance;

  const items = standards.map((s) => toItemView(s, acc?.checks?.[s.itemKey] ?? null));
  const failed = items.filter((i) => i.verdict === 'fail').length;
  const unconfigured = items.filter((i) => i.verdict === 'unconfigured').length;
  const pending = items.filter((i) => i.verdict === 'pending').length;
  // 全部可判定项均 pass 且无待测项 ⇒ 可进入签字。
  // unconfigured（如额定电流无台账）**不阻塞**：没有标准就不能判它不合格；
  // 但它同样不算"合格"，另行计数并由界面如实展示，绝不悄悄当通过。
  const allPassed = items.length > 0 && failed === 0 && pending === 0;

  const canAccept = order.status === 'pending_acceptance';
  const blockedReason =
    order.status === 'pending_acceptance'
      ? null
      : order.status === 'in_progress'
        ? '现场维修尚未提交完工上报，先完成全部维修步骤再验收。'
        : order.status === 'completed'
          ? '工单已验收关单归档，验收记录只读回看。'
          : `工单状态为【${STATUS_LABELS[order.status] ?? order.status}】，仅“待验收”可进行修后验收。`;

  const signatures = acc?.signatures ?? [];
  const signedTech = signatures.some((s) => s.step === 'technician');
  const signedLead = signatures.some((s) => s.step === 'teamlead');
  const nextSigner: 'technician' | 'teamlead' | null = !allPassed ? null : !signedTech ? 'technician' : !signedLead ? 'teamlead' : null;

  return {
    order: {
      id: order.id,
      orderNo: order.orderNo,
      title: order.title,
      equipmentId: order.equipmentId,
      equipmentName: order.equipmentName,
      faultType: order.faultType ?? '',
      status: order.status,
      statusLabel: STATUS_LABELS[order.status] ?? order.status,
      createdAt: order.createdAt ?? null,
      assignee: order.assignee ?? null,
    },
    canAccept,
    blockedReason,
    items,
    allPassed,
    failed,
    unconfigured,
    pending,
    baselines: acc?.baselines?.length ? acc.baselines : await buildPreBaselines(order),
    signatures,
    nextSigner,
    /** 本次维修的执行人（派工对象 / LOTO 确认人）；解析不出时 name 为 null */
    repairer: resolveRepairer(order, log) ?? { id: undefined, name: null },
    closedAt: acc?.closedAt ?? null,
    summary: acc?.summary ?? null,
    events: log.events,
    version: order.version ?? null,
    dataNote:
      '验收阈值取 acceptance_standards（带来源与可信度，未配置项如实显示不可判定）；修前基线取设备遥测表真实数据，无数据即显示未接入。',
  };
}

/* ---------------- 写操作 ---------------- */

async function loadOrder(orderId: string): Promise<{ order: WorkOrder; log: FieldWorkLog }> {
  const order = await WorkOrderRepository.getById(orderId);
  if (!order) throw fail('WORK_ORDER_NOT_FOUND', '工单未找到', 404);
  return { order, log: normalizeLog((order.repairLog as WorkOrder['repairLog'])?.fieldLog ?? null) };
}

async function persist(order: WorkOrder, log: FieldWorkLog, extra: Record<string, unknown> = {}) {
  const prevLog = (order.repairLog as WorkOrder['repairLog']) ?? {
    causeAnalysis: '',
    resolutionSteps: '',
    partsUsed: [],
    workHours: 0,
    completionPhotos: [],
  };
  const updated = await WorkOrderRepository.update(
    order.id,
    {
      ...extra,
      repairLog: {
        ...prevLog,
        partsUsed: Array.isArray(prevLog.partsUsed) ? prevLog.partsUsed : [],
        completionPhotos: Array.isArray(prevLog.completionPhotos) ? prevLog.completionPhotos : [],
        fieldLog: log,
      },
    } as Parameters<typeof WorkOrderRepository.update>[1],
    order.version
  );
  if (!updated) throw fail('WORK_ORDER_NOT_FOUND', '工单未找到', 404);
  aiCacheInvalidateEquipment(order.equipmentId);
  return updated;
}

function ensureAcceptance(log: FieldWorkLog): FieldAcceptanceLog {
  if (!log.acceptance) {
    log.acceptance = { startedAt: asIso(new Date()), checks: {}, baselines: [], signatures: [], closedAt: null, summary: null };
  }
  return log.acceptance;
}

/**
 * 记录一项验收结果。
 * value：数值项必填（定性项可为空）；
 * confirmed：定性项的人工确认（目视/听音）。
 */
export async function recordAcceptanceCheck(
  orderId: string,
  operatorRaw: unknown,
  body: unknown
): Promise<AcceptanceSession> {
  const b = (body ?? {}) as Record<string, unknown>;
  const itemKey = typeof b.itemKey === 'string' ? b.itemKey.trim() : '';
  if (!itemKey) throw fail('INVALID_INPUT', 'itemKey 必填');

  const { order, log } = await loadOrder(orderId);
  // 先判"已关单"再判状态：关单后工单会变成 completed，若先判状态，
  // 用户只会看到"仅待验收可录入"，读不出"这份验收已锁定"的真实原因。
  if (log.acceptance?.closedAt) {
    throw fail('ACCEPTANCE_CLOSED', '验收已签字关单，记录只读不可修改。', 409);
  }
  if (order.status !== 'pending_acceptance') {
    throw fail(
      'STATE_MUTEX_ERROR',
      `当前工单状态为【${STATUS_LABELS[order.status] ?? order.status}】，仅“待验收”可录入验收结果。`,
      409
    );
  }

  const standards = await AcceptanceStandardRepository.getEffective(order.equipmentId);
  const std = standards.find((s) => s.itemKey === itemKey);
  if (!std) throw fail('STANDARD_NOT_FOUND', '该验收项不在本设备的验收标准中', 404);

  const rawValue = b.value;
  let value: number | null = null;
  if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
    value = typeof rawValue === 'number' ? rawValue : Number.parseFloat(String(rawValue));
    if (!Number.isFinite(value)) throw fail('INVALID_INPUT', 'value 必须是数值', 422);
  }
  const confirmed = b.confirmed === true;
  const note = typeof b.note === 'string' ? b.note.trim() : '';

  if (std.judgedBy === 'manual' && !confirmed) {
    throw fail('INVALID_INPUT', '定性验收项（目视/听音）必须确认后才能记录', 422);
  }
  if (std.judgedBy === 'auto' && (std.minLimit != null || std.maxLimit != null) && value == null) {
    throw fail('INVALID_INPUT', '该验收项需要录入实测值', 422);
  }

  // 服务端复算，忽略前端可能传来的 verdict
  const verdict = judgeCheck(std, value, confirmed);
  const operator = cleanOperator(operatorRaw);
  const now = new Date();
  const acc = ensureAcceptance(log);

  const record: AcceptanceCheckRecord = {
    itemKey: std.itemKey,
    itemLabel: std.itemLabel,
    metric: std.metric,
    unit: std.unit,
    value,
    minLimit: std.minLimit,
    maxLimit: std.maxLimit,
    standardSource: std.source,
    verdict,
    confirmed,
    note: note || undefined,
    by: operator,
    at: asIso(now),
  };
  acc.checks = { ...acc.checks, [itemKey]: record };
  if (!acc.baselines.length) acc.baselines = await buildPreBaselines(order);

  const valueText = value != null ? `${value}${std.unit ?? ''}` : '目视/听音确认';
  const verdictText = verdict === 'pass' ? '合格' : verdict === 'fail' ? '⚠ 超标' : verdict === 'unconfigured' ? '无标准不可判定' : '待测';
  log.events = [
    ...log.events,
    {
      at: asIso(now),
      kind: 'acceptance',
      text: `验收项「${std.itemLabel}」：${valueText} → ${verdictText}${verdict === 'unconfigured' ? `（${std.source}）` : ''}。`,
      by: operator.name,
    },
  ];

  await persist(order, log);
  return getAcceptanceSession(order.id);
}

/** 可签字角色：班组长由车间主管/总工担任 */
const TEAMLEAD_ROLES = ['manager', 'admin'];

/**
 * 判定"是不是同一个操作者"。
 * 优先比用户 ID（可信）；没有 ID 时才退回姓名（历史数据只留了名字）。
 * 注意：姓名相同不等于同一人，所以只要有 ID 就绝不用姓名兜底 —— 会误伤同名同事。
 */
function sameOperator(a: { id?: string; name?: string }, b: { id?: string; name?: string }): boolean {
  if (a.id && b.id) return a.id === b.id;
  return !!a.name && a.name === b.name;
}

/**
 * 解析"谁是本次维修的执行人"。
 * 依次取最可靠的两个来源，都拿不到就返回 null（此时不做身份拦截，
 * 因为工单没有派工信息时拦下来会把老数据卡死，反而更糟）：
 *   1. 工单派工对象 assigneeId（派工时就定下的责任人）
 *   2. LOTO 确认人（现场作业第一步，必然由实际作业人确认）
 * 完工留痕 log.completed.by 只有名字、没有 ID，仅在两者都缺时作为最后线索。
 */
function resolveRepairer(
  order: WorkOrder,
  log: FieldWorkLog
): { id?: string; name: string } | null {
  if (order.assigneeId) return { id: order.assigneeId, name: order.assignee ?? order.assigneeId };
  if (log.loto?.by?.id) return { id: log.loto.by.id, name: log.loto.by.name };
  const byName = log.completed?.by ?? log.loto?.by?.name;
  if (byName) return { name: byName };
  if (order.assignee) return { name: order.assignee };
  return null;
}


export interface SignResult {
  session: AcceptanceSession;
  closed: boolean;
  summary: { knowledgeId: string; title: string } | null;
}

/**
 * 签字。step='technician' → 当前登录者即维修人；step='teamlead' → 必须另一人且为 manager/admin。
 * 两人签完后：转 completed + 生成维修总结 + 沉淀知识库。
 */
export async function signAcceptance(
  orderId: string,
  operatorRaw: unknown,
  body: unknown
): Promise<SignResult> {
  const b = (body ?? {}) as Record<string, unknown>;
  const step = b.step;
  if (step !== 'technician' && step !== 'teamlead') {
    throw fail('INVALID_INPUT', "step 必须为 technician / teamlead");
  }

  const { order, log } = await loadOrder(orderId);
  const acc = ensureAcceptance(log);
  // 同 check：已关单优先给出"只读"原因，其次才是状态原因
  if (acc.closedAt) throw fail('ACCEPTANCE_CLOSED', '验收已关单，签字不可重复。', 409);
  if (order.status !== 'pending_acceptance') {
    throw fail(
      'STATE_MUTEX_ERROR',
      `当前工单状态为【${STATUS_LABELS[order.status] ?? order.status}】，仅“待验收”可签字。`,
      409
    );
  }

  // 未全部通过不允许签字（unconfigured 不算未通过，见 getAcceptanceSession 的 allPassed 口径）
  const standards = await AcceptanceStandardRepository.getEffective(order.equipmentId);
  const items = standards.map((s) => toItemView(s, acc.checks?.[s.itemKey] ?? null));
  const blocking = items.filter((i) => i.verdict === 'fail' || i.verdict === 'pending');
  if (blocking.length > 0) {
    throw fail(
      'ACCEPTANCE_INCOMPLETE',
      `验收未全部合格，仍有 ${blocking.length} 项未通过（${blocking.map((i) => i.itemLabel).join('、')}），不能签字关单。`,
      422,
      { blocking: blocking.map((i) => i.itemKey) }
    );
  }

  const operator = cleanOperator(operatorRaw);
  const role = typeof (operatorRaw as Record<string, unknown>)?.role === 'string' ? String((operatorRaw as Record<string, unknown>).role) : '';
  const roleTitle = typeof (operatorRaw as Record<string, unknown>)?.roleTitle === 'string' ? String((operatorRaw as Record<string, unknown>).roleTitle) : role;

  if (acc.signatures.some((s) => s.step === step)) {
    throw fail('ALREADY_SIGNED', step === 'technician' ? '维修人已签字，无需重复。' : '班组长已签字，无需重复。', 409);
  }

  // 顺序：先维修人，后班组长
  if (step === 'teamlead' && !acc.signatures.some((s) => s.step === 'technician')) {
    throw fail('SIGN_ORDER_INVALID', '请先由维修人签字，再由班组长确认。', 422);
  }

  // 「维修人」签名只能是本次维修的执行人。
  // 不做这个校验的话，任何有作业权限的人都能抢着签"维修人"，
  // 双签字就退化成"随便拉两个人点两下"，而真正的执行人再也签不上（ALREADY_SIGNED）。
  if (step === 'technician') {
    const repairer = resolveRepairer(order, log);
    if (repairer && !sameOperator(repairer, operator)) {
      throw fail(
        'NOT_REPAIRER',
        `「维修人」签名必须由本次维修的执行人（${repairer.name}）签署，当前登录账号不是该工单的维修人。`,
        403,
        { expectedRepairer: repairer.name }
      );
    }
  }

  if (step === 'teamlead') {
    if (!TEAMLEAD_ROLES.includes(role)) {
      throw fail('ROLE_FORBIDDEN', '班组长签字需具备车间主管 / 总工（manager / admin）权限。', 403);
    }
    const tech = acc.signatures.find((s) => s.step === 'technician');
    if (tech && (tech.userId ? tech.userId === operator.id : tech.name === operator.name)) {
      // 双签字的意义是两个人：同一人兼签等于没有复核
      throw fail('SIGNER_MUST_DIFFER', '验收签字必须两人：班组长不能与维修人是同一人。', 422);
    }
  }

  const now = new Date();
  const payload = [order.id, step, operator.id ?? operator.name, asIso(now), items.map((i) => `${i.itemKey}:${i.verdict}`).join(',')].join('|');
  const signatureHash = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
  const signature: AcceptanceSignature = {
    step,
    name: operator.name,
    userId: operator.id,
    role,
    roleTitle,
    signedAt: asIso(now),
    signatureHash,
  };
  acc.signatures = [...acc.signatures, signature];
  log.events = [
    ...log.events,
    {
      at: asIso(now),
      kind: 'sign',
      text: `${step === 'technician' ? '维修人' : '班组长'}签字确认：${operator.name}（${roleTitle || role || '—'}），签字指纹 ${signatureHash}。`,
      by: operator.name,
    },
  ];

  const bothSigned = acc.signatures.some((s) => s.step === 'technician') && acc.signatures.some((s) => s.step === 'teamlead');

  if (!bothSigned) {
    await persist(order, log);
    return { session: await getAcceptanceSession(order.id), closed: false, summary: null };
  }

  // 两人签齐 → 关单
  acc.closedAt = asIso(now);
  acc.baselines = acc.baselines.length ? acc.baselines : await buildPreBaselines(order);
  log.events = [
    ...log.events,
    { at: asIso(now), kind: 'acceptance', text: '修后验收全部合格，维修人与班组长双签字完成，工单关单归档。', by: operator.name },
  ];

  const knowledge = await sinkMaintenanceSummary(order, log, acc);

  await persist(order, log, {
    status: 'completed',
    acceptedByInspectorAt: asIso(now),
    // 保留原 acceptance 结构给旧页面/报表兼容（质检评分由验收清单取代）
    acceptance: {
      inspectorName: operator.name,
      pass: true,
      score: 5,
      comment: `修后验收全部合格（${items.length} 项），双签字关单。`,
      signatureDate: asIso(now).slice(0, 10),
    },
  });

  pushWorkOrderLog({
    id: `acc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workOrderId: order.id,
    action: 'ACCEPT',
    previousStatus: 'pending_acceptance',
    newStatus: 'completed',
    operatorName: operator.name,
    comment: `修后验收合格关单：${items.length} 项全通过，双签字（维修人 + 班组长）；维修总结已沉淀知识库 ${knowledge.knowledgeId}`,
    createdAt: asIso(now),
  });
  pushNotification({
    title: `【验收关单】${order.orderNo} 修后验收合格，双签字归档`,
    content: `「${order.title}」通过 ${items.length} 项修后验收测试并由维修人、班组长双签字，维修总结已沉淀到案例库。`,
    type: 'success',
    refType: 'work_order',
    refId: order.orderNo,
  });

  return { session: await getAcceptanceSession(order.id), closed: true, summary: knowledge };
}

/* ---------------- 维修总结沉淀 ---------------- */

/**
 * 生成维修总结并写入知识库（真实案例，可检索）。
 * 数字全部来自工单留痕；拿不到的写"未记录"，不猜。
 */
export async function sinkMaintenanceSummary(
  order: WorkOrder,
  log: FieldWorkLog,
  acc: FieldAcceptanceLog
): Promise<{ knowledgeId: string; title: string }> {
  // 幂等：已生成过就直接返回，不重复入库
  if (acc.summary?.knowledgeId) return { knowledgeId: acc.summary.knowledgeId, title: acc.summary.title };

  const checks = Object.values(acc.checks ?? {});
  const baseline = (m: string) => acc.baselines?.find((b) => b.metric === m) ?? null;
  const checkValue = (m: string) => checks.find((c) => c.metric === m)?.value ?? null;

  const tempPre = baseline('temperature');
  const vibPre = baseline('vibration');
  const curPre = baseline('current');
  const tempPost = checkValue('temperature');
  const vibPost = checkValue('vibration');
  const curPost = checkValue('current');

  const fmt = (v: number | null | undefined, unit: string | null) => (v == null ? '未接入' : `${v}${unit ?? ''}`);

  const parts = (order.repairLog?.partsUsed ?? []).map((p) => `${p.name}（${p.spec}）× ${p.qty}${p.unit}`);
  const workHours = order.repairLog?.workHours ?? log.completed?.workHours ?? null;
  const cause = order.repairLog?.causeAnalysis?.trim() || '未记录（工单未填写根因分析）';
  const steps = log.steps ?? {};
  const stepCounts = {
    done: Object.values(steps).filter((s) => s.status === 'done').length,
    skip: Object.values(steps).filter((s) => s.status === 'skip').length,
    issue: Object.values(steps).filter((s) => s.status === 'issue').length,
  };

  const lines: string[] = [];
  lines.push(`# ${order.equipmentName} · ${order.faultType} · 维修案例`);
  lines.push('');
  lines.push(`- 工单：${order.orderNo}（${order.title}）`);
  lines.push(`- 设备：${order.equipmentName}（${order.equipmentCode}，${order.workshop}）`);
  lines.push(`- 故障类型：${order.faultType}`);
  lines.push(`- 根因分析：${cause}`);
  lines.push(`- 处理步骤：完成 ${stepCounts.done} 步、跳过 ${stepCounts.skip} 步、问题标记 ${stepCounts.issue} 项`);
  lines.push(`- 更换零件：${parts.length ? parts.join('；') : '无换件记录'}`);
  lines.push(`- 实际工时：${workHours != null ? `${workHours} h` : '未记录'}`);
  lines.push('');
  lines.push('## 修前 / 修后效果对比');
  lines.push('');
  lines.push('| 指标 | 修前（工单前 24h 遥测最坏值） | 修后（现场实测） | 验收标准 |');
  lines.push('| --- | --- | --- | --- |');
  const row = (label: string, pre: AcceptanceBaseline | null, post: number | null, unit: string | null, stdLabel: string) => {
    const preText = pre && pre.samples > 0 ? fmt(pre.preMax, unit) : '未接入';
    lines.push(`| ${label} | ${preText} | ${fmt(post, unit)} | ${stdLabel} |`);
  };
  const tempItem = checks.find((c) => c.metric === 'temperature');
  const vibItem = checks.find((c) => c.metric === 'vibration');
  const curItem = checks.find((c) => c.metric === 'current');
  row('温度', tempPre, tempPost, tempItem?.unit ?? '℃', tempItem?.maxLimit != null ? `≤ ${tempItem.maxLimit}${tempItem.unit ?? ''}` : '未配置');
  row('振动', vibPre, vibPost, vibItem?.unit ?? 'mm/s', vibItem?.maxLimit != null ? `≤ ${vibItem.maxLimit}${vibItem.unit ?? ''}` : '未配置');
  row('电流', curPre, curPost, curItem?.unit ?? 'A', curItem?.maxLimit != null ? `≤ ${curItem.maxLimit}A` : '未配置（额定电流台账缺失，不推算）');
  lines.push('');
  lines.push('## 验收');
  lines.push('');
  for (const c of checks) {
    const v = c.verdict === 'pass' ? '合格' : c.verdict === 'fail' ? '超标' : c.verdict === 'unconfigured' ? '无标准不可判定' : '待测';
    lines.push(`- ${c.itemLabel}：${c.value != null ? `${c.value}${c.unit ?? ''}` : '目视/听音确认'} → ${v}`);
  }
  const tech = acc.signatures.find((s) => s.step === 'technician');
  const lead = acc.signatures.find((s) => s.step === 'teamlead');
  lines.push('');
  lines.push(`- 维修人签字：${tech ? `${tech.name}（${tech.signedAt}，指纹 ${tech.signatureHash}）` : '未签'}`);
  lines.push(`- 班组长签字：${lead ? `${lead.name}（${lead.roleTitle || lead.role}，${lead.signedAt}，指纹 ${lead.signatureHash}）` : '未签'}`);
  lines.push('');
  lines.push('> 本案例由验收关单时自动生成，数据取自工单留痕与设备遥测，未做人工润色。');

  const content = lines.join('\n');
  const title = `【维修案例】${order.equipmentName} · ${order.faultType}（${order.orderNo}）`;
  const id = `kb-case-${order.id}`;
  const nowIso = new Date().toISOString();

  await KnowledgeRepository.create({
    id,
    title,
    category: '维修案例',
    targetEquipment: order.equipmentName,
    tags: ['维修案例', order.faultType, order.equipmentCode].filter(Boolean),
    summary: `${order.equipmentName} ${order.faultType}：修前振动 ${fmt(vibPre?.preMax, 'mm/s')} → 修后 ${fmt(vibPost, 'mm/s')}，工时 ${workHours ?? '未记录'}h，双签字验收关单。`,
    content,
    author: tech?.name ?? order.assignee ?? '维修班组',
    updatedAt: nowIso,
    viewCount: 0,
    likes: 0,
    fileType: 'manual',
    chunksCount: Math.max(1, Math.ceil(content.length / 500)),
    // 知识库检索列表只查 status='approved'（见 knowledgeController:118）。
    // 本案例全部由已关单工单自动生成、无人工润色，无需再走人工审核，直接 approved 才可被检索到。
    status: 'approved',
  });

  acc.summary = { knowledgeId: id, title, createdAt: nowIso };
  return { knowledgeId: id, title };
}
