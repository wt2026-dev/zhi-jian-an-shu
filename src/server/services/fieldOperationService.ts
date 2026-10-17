/**
 * 拆解作业终端（现场维修作业闭环）服务。
 *
 * 目标：让拆解视图跟着维修人员走完维修全过程 —— 边拆边记、自动完工，一切留痕。
 *
 * 数据契约（真实系统，禁止 mock）：
 *   · 全部现场记录写入**现有 work_orders 表**的 repair_log.fieldLog JSONB（与工单同表同寿）；
 *   · LOTO 安全确认是强制作业前置：没确认不能记录任何步骤（服务端硬拦）；
 *   · 「测量标准值」取真实点检系统 inspections.points 的限值（minLimit/maxLimit/unit/standard），
 *     设备没有对应点检标准就拒测，不编造允许区间；
 *   · 「现场照片」要求先经真实 /uploads/image 落盘，posNo 必须存在于真实拆解 BOM 目录；
 *   · 步骤全部 done/skip（无 issue）且 LOTO 已确认时**自动完工**：status='completed'、
 *     completedAt=now、workHours 按真实时间线计算、实际维修人取操作者；
 *   · 操作人一律取服务端会话 currentUser，不信任客户端传的身份。
 */
import { WorkOrderRepository } from "../../db/repositories/workOrderRepository.ts";
import { VersionConflictError } from "../../db/repositories/shared.ts";
import { getCatalogForDevice } from "./partMatchService.ts";
import { getWorkOrderExplodedContext, parseOrderSteps } from "./partHistoryService.ts";
import { InspectionRepository } from "../../db/repositories/inspectionRepository.ts";
import { aiCacheInvalidateEquipment } from "../../utils/aiCache.ts";
import { pushNotification } from "./auditService.ts";
import { pushWorkOrderLog, STATUS_LABELS } from "../controllers/workOrderController.ts";
import { logger } from "../../utils/logger.ts";
import type {
  FieldWorkLog,
  FieldWorkOperator,
  FieldLotoRecord,
  FieldStepRecord,
  FieldMeasurement,
  FieldPartPhoto,
  WorkOrder,
} from "../../types";

/** LOTO 四项强制安全确认（客户端弹窗渲染同一清单，key 契约一致） */
export const LOTO_CHECK_ITEMS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'loto_power_locked', label: '设备已断电、上锁挂牌（LOTO）' },
  { key: 'residual_energy_released', label: '残余压力/能量已释放' },
  { key: 'hazardous_parts_isolated', label: '高温/高压/转动部件已隔离' },
  { key: 'workzone_barricaded', label: '作业区域已设置警示围栏' },
] as const;

/* ---------------- 数据结构（服务端会话视图） ---------------- */

export interface FieldSessionStep {
  index: number;
  text: string;
  matchedPart: { posNo: string; name: string } | null;
  state: FieldStepRecord | null;
  /** 该步骤是否可以记录（仅检修中工单可操作） */
  recordable: boolean;
}

export interface FieldSessionOrderInfo {
  id: string;
  orderNo: string;
  title: string;
  description: string;
  faultType: string;
  priority: string;
  status: string;
  statusLabel: string;
  createdAt: string | null;
  assignee: string | null;
  completedAt: string | null;
}

export interface FieldMeasurementRef {
  key: string;
  checkPoint: string;
  standard: string | null;
  method: string | null;
  unit: string | null;
  minLimit: number | null;
  maxLimit: number | null;
}

export interface FieldSession {
  deviceId: string;
  order: FieldSessionOrderInfo | null;
  /** 当前登录者是否能记录（status==='in_progress'） */
  canOperate: boolean;
  /** 不可操作时的真实原因（无工单/待接单/待验收/已闭环…），前端原样透出 */
  blockedReason: string | null;
  /** LOTO 强制确认清单（弹窗渲染；确认后 loto 有值） */
  lotoItems: Array<{ key: string; label: string }>;
  loto: FieldLotoRecord | null;
  steps: FieldSessionStep[];
  progress: { total: number; done: number; skipped: number; issue: number; remaining: number; current: number | null };
  measurements: FieldMeasurement[];
  partPhotos: FieldPartPhoto[];
  events: FieldWorkLog['events'];
  /** 真实点检标准（测量录入的可选科目与限值） */
  measurementItems: FieldMeasurementRef[];
  autoCompleted: FieldWorkLog['completed'] | null;
  /** 乐观锁版本（写操作需回传，冲突 409） */
  version: number | null;
  dataNote: string;
}

/* ---------------- 内部工具 ---------------- */

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

function emptyFieldLog(): FieldWorkLog {
  return { events: [], loto: null, steps: {}, measurements: [], partPhotos: [], completed: null };
}

function normalizeFieldLog(raw: unknown): FieldWorkLog {
  const base = emptyFieldLog();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const r = raw as Record<string, unknown>;
  const steps: Record<string, FieldStepRecord> = {};
  if (r.steps && typeof r.steps === 'object' && !Array.isArray(r.steps)) {
    for (const [k, v] of Object.entries(r.steps as Record<string, unknown>)) {
      const s = v as Partial<FieldStepRecord> | null;
      if (s && typeof s === 'object' && (s.status === 'done' || s.status === 'skip' || s.status === 'issue')) {
        steps[k] = s as FieldStepRecord;
      }
    }
  }
  const events = Array.isArray(r.events)
    ? r.events.filter(
        (e): e is FieldWorkLog['events'][number] =>
          !!e && typeof e === 'object' && typeof (e as { at?: unknown }).at === 'string' && typeof (e as { kind?: unknown }).kind === 'string'
      )
    : [];
  const measurements = Array.isArray(r.measurements) ? (r.measurements as FieldMeasurement[]) : [];
  const partPhotos = Array.isArray(r.partPhotos) ? (r.partPhotos as FieldPartPhoto[]) : [];
  const loto = (r.loto && typeof r.loto === 'object' ? r.loto : null) as FieldLotoRecord | null;
  const completed = (r.completed && typeof r.completed === 'object' ? r.completed : null) as FieldWorkLog['completed'];
  return { events, loto, steps, measurements, partPhotos, completed };
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

function asIso(d: Date): string {
  return d.toISOString();
}

/** 同一事件流里最近一条记录（用于计算「距上一记录事件用时」） */
function previousEventAt(log: FieldWorkLog, now: Date): { at: Date | null; elapsedMin: number | null } {
  const last = log.events.length ? log.events[log.events.length - 1] : null;
  if (!last?.at) return { at: null, elapsedMin: null };
  const prev = new Date(last.at);
  if (Number.isNaN(prev.getTime())) return { at: null, elapsedMin: null };
  const elapsedMin = Math.max(0, Math.round(((now.getTime() - prev.getTime()) / 60000) * 10) / 10);
  return { at: prev, elapsedMin };
}

/** 真实点检标准：inspections.points（该设备全部点检任务的测点，同名测点取最新一条） */
export async function getMeasurementStandards(deviceId: string): Promise<FieldMeasurementRef[]> {
  if (!deviceId) return [];
  const tasks = await InspectionRepository.getAll();
  const byKey = new Map<string, FieldMeasurementRef>();
  for (const task of tasks) {
    const raw = task as unknown as { points?: unknown };
    const points = Array.isArray(raw.points) ? raw.points : [];
    for (const p of points) {
      const pt = p as Record<string, unknown>;
      if (pt.equipmentId !== deviceId) continue;
      const checkPoint = typeof pt.checkItem === 'string' && pt.checkItem.trim() ? pt.checkItem.trim() : typeof pt.checkPoint === 'string' ? pt.checkPoint.trim() : '';
      if (!checkPoint) continue;
      if (byKey.has(checkPoint)) continue; // 同名测点保留最新一条（任务按 created_at DESC 已有序）
      byKey.set(checkPoint, {
        key: checkPoint,
        checkPoint,
        standard: typeof pt.standard === 'string' && pt.standard.trim() ? pt.standard.trim() : null,
        method: typeof pt.method === 'string' ? pt.method : null,
        unit: typeof pt.unit === 'string' && pt.unit.trim() ? pt.unit.trim() : null,
        minLimit: typeof pt.minLimit === 'number' && Number.isFinite(pt.minLimit) ? pt.minLimit : null,
        maxLimit: typeof pt.maxLimit === 'number' && Number.isFinite(pt.maxLimit) ? pt.maxLimit : null,
      });
    }
  }
  return Array.from(byKey.values());
}

/** 设备 → 会话工单：检修中优先，其次待验收（只读回看），再次已闭环（只读留档），其他状态不入会话 */
async function pickSessionOrder(deviceId: string, pinnedOrderId?: string): Promise<WorkOrder | null> {
  // 写操作刚把当前工单推完工时，会话仍要展示**这张**单（否则页面会跳到下一张单，
  // 维修人员看不到自己刚闭环的留痕）。
  if (pinnedOrderId) {
    const pinned = await WorkOrderRepository.getById(pinnedOrderId);
    if (pinned && pinned.equipmentId === deviceId) return pinned;
  }
  const all = await WorkOrderRepository.getAll({ equipmentId: deviceId });
  const inProgress = all.filter((o) => o.status === 'in_progress');
  const pending = all.filter((o) => o.status === 'pending_acceptance');
  const archived = all.filter((o) => o.status === 'completed');
  return inProgress[0] ?? pending[0] ?? archived[0] ?? null;
}

function orderInfo(o: WorkOrder): FieldSessionOrderInfo {
  return {
    id: o.id,
    orderNo: o.orderNo,
    title: o.title,
    description: o.description ?? '',
    faultType: o.faultType ?? '',
    priority: o.priority ?? 'general',
    status: o.status,
    statusLabel: STATUS_LABELS[o.status] ?? o.status,
    createdAt: o.createdAt ?? null,
    assignee: o.assignee ?? null,
    completedAt: o.completedAt ?? null,
  };
}

/* ---------------- 会话组装 ---------------- */

export async function getWorkSession(deviceId: string, pinnedOrderId?: string): Promise<FieldSession> {
  if (!deviceId) throw fail('INVALID_INPUT', 'deviceId 必填');
  const catalog = getCatalogForDevice(deviceId);
  if (catalog.length === 0) {
    throw fail('NO_EXPLODED_CATALOG', '该设备没有拆解视图 BOM 目录', 404);
  }

  const order = await pickSessionOrder(deviceId, pinnedOrderId);
  const standards = await getMeasurementStandards(deviceId);

  if (!order) {
    return {
      deviceId,
      order: null,
      canOperate: false,
      blockedReason: '该设备当前没有检修中 / 待验收 / 已闭环的检修工单，现场作业需先在检修工单系统接单开工（不做无工单留痕）。',
      lotoItems: LOTO_CHECK_ITEMS.map((i) => ({ key: i.key, label: i.label })),
      loto: null,
      steps: [],
      progress: { total: 0, done: 0, skipped: 0, issue: 0, remaining: 0, current: null },
      measurements: [],
      partPhotos: [],
      events: [],
      measurementItems: standards,
      autoCompleted: null,
      version: null,
      dataNote: '现场记录直接写入检修工单；无工单时不产生任何作业记录。',
    };
  }

  const canOperate = order.status === 'in_progress';
  const blockedReason: string | null =
    order.status === 'in_progress'
      ? null
      : order.status === 'pending_acceptance'
        ? '工单已完工上报，等待质检验收（现场记录只读回看）。'
        : order.status === 'completed'
          ? '工单已闭环归档，现场记录只读留档。'
          : `工单状态为【${STATUS_LABELS[order.status] ?? order.status}】，需技师接单进入检修中后才能开始现场作业记录。`;

  const log = normalizeFieldLog((order.repairLog as WorkOrder['repairLog'])?.fieldLog ?? null);
  const brief = await getWorkOrderExplodedContext(order.id);
  const parsedSteps = parseOrderSteps((order.repairLog as WorkOrder['repairLog'])?.resolutionSteps ?? null) ?? [];

  // 步骤清单以真实解析结果为准；brief 步骤（含 BOM 匹配）按序号对齐
  const matchedBrief = new Map<number, FieldSessionStep['matchedPart']>();
  for (const s of brief?.steps ?? []) matchedBrief.set(s.index, s.matchedPart);
  const steps: FieldSessionStep[] = parsedSteps.map((text, i) => ({
    index: i + 1,
    text,
    matchedPart: matchedBrief.get(i + 1) ?? null,
    state: log.steps[String(i + 1)] ?? null,
    recordable: canOperate && Boolean(log.loto),
  }));

  const total = steps.length;
  const done = steps.filter((s) => s.state?.status === 'done').length;
  const skipped = steps.filter((s) => s.state?.status === 'skip').length;
  const issue = steps.filter((s) => s.state?.status === 'issue').length;
  const firstUnrecorded = steps.find((s) => !s.state)?.index ?? null;

  const lotoItems = LOTO_CHECK_ITEMS.map((i) => ({ key: i.key, label: i.label }));

  if (canOperate && total === 0) {
    return {
      deviceId,
      order: orderInfo(order),
      canOperate: true,
      blockedReason: '该工单没有填报检修步骤原文，无法进行步骤级现场留痕（可在工单页补充步骤后使用）。',
      lotoItems,
      loto: log.loto ?? null,
      steps: [],
      progress: { total: 0, done: 0, skipped: 0, issue: 0, remaining: 0, current: null },
      measurements: log.measurements,
      partPhotos: log.partPhotos,
      events: log.events,
      measurementItems: standards,
      autoCompleted: log.completed ?? null,
      version: order.version ?? null,
      dataNote: '步骤原文读自工单 repair_log.resolutionSteps；未填写时如实提示，不造步骤。',
    };
  }

  return {
    deviceId,
    order: orderInfo(order),
    canOperate,
    blockedReason,
    lotoItems,
    loto: log.loto ?? null,
    steps,
    progress: {
      total,
      done,
      skipped,
      issue,
      remaining: total - done - skipped - issue,
      current: canOperate ? firstUnrecorded : null,
    },
    measurements: log.measurements,
    partPhotos: log.partPhotos,
    events: log.events,
    measurementItems: standards,
    autoCompleted: log.completed ?? null,
    version: order.version ?? null,
    dataNote:
      '现场记录（LOTO / 步骤 / 测量 / 照片）写入检修工单 repair_log.fieldLog（与工单同表同寿）；测量标准取真实点检 inspections.points 的限值。',
  };
}

/* ---------------- 写操作 ---------------- */

interface OrderUpdateResult {
  order: WorkOrder;
  mergedLog: FieldWorkLog;
}

async function loadFieldOrder(orderId: string): Promise<OrderUpdateResult> {
  const order = await WorkOrderRepository.getById(orderId);
  if (!order) throw fail('WORK_ORDER_NOT_FOUND', '工单未找到', 404);
  const mergedLog = normalizeFieldLog((order.repairLog as WorkOrder['repairLog'])?.fieldLog ?? null);
  return { order, mergedLog };
}

async function persistFieldLog(
  order: WorkOrder,
  log: FieldWorkLog,
  extra: Partial<Parameters<typeof WorkOrderRepository.update>[1]> = {}
): Promise<WorkOrder | null> {
  const prevLog = (order.repairLog as WorkOrder['repairLog']) ?? {
    causeAnalysis: '',
    resolutionSteps: '',
    partsUsed: [],
    workHours: 0,
    completionPhotos: [],
  };
  const updates = {
    ...extra,
    repairLog: {
      ...prevLog,
      partsUsed: Array.isArray(prevLog.partsUsed) ? prevLog.partsUsed : [],
      completionPhotos: Array.isArray(prevLog.completionPhotos) ? prevLog.completionPhotos : [],
      fieldLog: log,
    },
  } as Parameters<typeof WorkOrderRepository.update>[1];
  return WorkOrderRepository.update(order.id, updates, order.version);
}

/** LOTO 全项是否确认 */
function lotoAllConfirmed(rec: FieldLotoRecord | null): boolean {
  return Boolean(rec && rec.items.length >= LOTO_CHECK_ITEMS.length && rec.items.every((i) => i.confirmed === true));
}

export async function confirmLoto(
  orderId: string,
  operatorRaw: unknown,
  submittedItems?: unknown
): Promise<FieldSession> {
  // 权威清单以服务端为准：必须**逐项**提交且全部 confirmed:true，才落"已确认"档案。
  // 否则客户端只勾一项（或伪造 label）就能把四项全绿写进档案，安全留痕就失去意义。
  const raw = Array.isArray(submittedItems) ? submittedItems : [];
  const byKey = new Map<string, boolean>();
  for (const it of raw) {
    const o = it as { key?: unknown; confirmed?: unknown };
    if (typeof o?.key === 'string') byKey.set(o.key, o.confirmed === true);
  }
  const missing = LOTO_CHECK_ITEMS.filter((i) => byKey.get(i.key) !== true).map((i) => i.label);
  if (missing.length > 0) {
    throw fail('INVALID_INPUT', `LOTO 四项强制检查必须逐项勾选确认，仍缺：${missing.join('、')}`, 422, { missing });
  }
  const { order, mergedLog } = await loadFieldOrder(orderId);
  if (order.status !== 'in_progress') {
    throw fail('STATE_MUTEX_ERROR', `状态互斥拦截：当前工单状态为【${STATUS_LABELS[order.status] ?? order.status}】，仅“检修中”可确认 LOTO。`, 409);
  }
  // 标签文本一律用服务端清单重写（防伪造档案文本）
  const items = LOTO_CHECK_ITEMS.map((i) => ({ key: i.key, label: i.label, confirmed: true }));
  const operator = cleanOperator(operatorRaw);
  const now = new Date();
  mergedLog.loto = { confirmedAt: asIso(now), by: operator, items };
  mergedLog.events = [
    ...mergedLog.events,
    { at: asIso(now), kind: 'loto', text: 'LOTO 安全确认：四项强制检查全部通过（断电上锁挂牌 / 残压释放 / 危险部件隔离 / 警示围栏）。', by: operator.name },
  ];
  const updated = await persistFieldLog(order, mergedLog, { version: order.version });
  if (!updated) throw fail('WORK_ORDER_NOT_FOUND', '工单未找到', 404);
  pushWorkOrderLog({
    id: `fieldlog-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    workOrderId: order.id,
    action: 'SAFETY_CONFIRM',
    previousStatus: 'in_progress',
    newStatus: 'in_progress',
    operatorName: operator.name,
    comment: '拆解作业终端：LOTO 四项强制安全确认完成（留档 repair_log.fieldLog.loto）',
    createdAt: asIso(now),
  });
  pushNotification({
    title: `【安全确认】${order.orderNo} LOTO 确认完成`,
    content: `「${order.title}」开始拆解作业前已完成 LOTO 四项强制确认，留痕工单。`,
    type: 'info',
    refType: 'work_order',
    refId: order.orderNo,
  });
  return getWorkSession(order.equipmentId);
}

/** 非问题步骤（done/skip）且全部有记录 → 自动完工 */
function canAutoComplete(log: FieldWorkLog, totalSteps: number): boolean {
  if (!lotoAllConfirmed(log.loto)) return false;
  if (totalSteps <= 0) return false;
  for (let i = 1; i <= totalSteps; i++) {
    const st = log.steps[String(i)];
    if (!st) return false;
    if (st.status === 'issue') return false;
  }
  return true;
}

async function autoComplete(
  order: WorkOrder,
  log: FieldWorkLog,
  totalSteps: number,
  operator: FieldWorkOperator
): Promise<{ autoCompleted: NonNullable<FieldWorkLog['completed']> }> {
  const now = new Date();
  const firstAt = log.loto ? new Date(log.loto.confirmedAt) : null;
  const startMs = firstAt && !Number.isNaN(firstAt.getTime()) ? firstAt.getTime() : log.events.length ? new Date(log.events[0].at).getTime() : Date.now();
  const workHours = Math.max(0.1, Math.round(((now.getTime() - startMs) / 3600000) * 10) / 10);
  const total = totalSteps;
  const done = Object.values(log.steps).filter((s) => s.status === 'done').length;
  const skipped = Object.values(log.steps).filter((s) => s.status === 'skip').length;
  const issueNotes = Object.values(log.steps).filter((s) => s.status === 'issue').map((s) => s.note ?? '').filter(Boolean);

  const prevLog = (order.repairLog as WorkOrder['repairLog']) ?? {
    causeAnalysis: '',
    resolutionSteps: '',
    partsUsed: [],
    workHours: 0,
    completionPhotos: [],
  };
  // 根因分析：保留工单已有真实填写；没有时用现场真实留痕派生汇总（透明学、不发明数据）
  const derivedCause =
    issueNotes.length > 0
      ? `步骤现场留痕存在的问题记录：${issueNotes.join('；')}`
      : `按拆解作业终端逐步执行并留痕，共 ${total} 步（完成 ${done}，跳过 ${skipped}）；全程时间线见 repair_log.fieldLog.events。`;
  log.completed = { at: asIso(now), by: operator.name, workHours, total, done, skipped };
  log.events = [...log.events, { at: asIso(now), kind: 'complete', text: `全部步骤记录完成（完成 ${done}/跳过 ${skipped}），工单自动完工闭环，实际维修人 ${operator.name}。`, by: operator.name }];

  const updated = await WorkOrderRepository.update(
    order.id,
    {
      status: 'completed',
      completedAt: asIso(now),
      assignee: operator.name || order.assignee || null,
      version: order.version,
      repairLog: {
        ...prevLog,
        partsUsed: Array.isArray(prevLog.partsUsed) ? prevLog.partsUsed : [],
        causeAnalysis: prevLog.causeAnalysis || derivedCause,
        workHours,
        completionPhotos: log.partPhotos.map((p) => p.url),
        remark: `${prevLog.remark ?? ''}${prevLog.remark ? '；' : ''}拆解作业终端自动完工（现场逐步留痕）。`,
        fieldLog: log,
      },
    },
    order.version
  );
  if (!updated) throw fail('WORK_ORDER_NOT_FOUND', '工单未找到', 404);
  aiCacheInvalidateEquipment(order.equipmentId);
  pushWorkOrderLog({
    id: `fieldlog-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    workOrderId: order.id,
    action: 'COMPLETE',
    previousStatus: 'in_progress',
    newStatus: 'completed',
    operatorName: operator.name,
    comment: `拆解作业终端自动完工：步骤 ${total}（完成 ${done}/跳过 ${skipped}），工时 ${workHours}h，时间线留档 fieldLog.events`,
    createdAt: asIso(now),
  });
  pushNotification({
    title: `【已闭环】${order.orderNo} 现场作业全部完成，工单自动完工`,
    content: `「${order.title}」按拆解作业终端留痕流程自动完工（${done}/${total} 步完成），实际维修人 ${operator.name}，工时 ${workHours}h。`,
    type: 'success',
    refType: 'work_order',
    refId: order.orderNo,
  });
  return { autoCompleted: log.completed! };
}

/** 记录单条步骤：done / skip / issue（跳过与问题必须留原因） */
export async function recordFieldStep(
  orderId: string,
  operatorRaw: unknown,
  body: unknown
): Promise<{ session: FieldSession; autoCompleted: boolean }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const index = typeof b.index === 'number' ? b.index : Number.parseInt(String(b.index ?? ''), 10);
  const action = b.action;
  if (!Number.isInteger(index) || index < 1) throw fail('INVALID_INPUT', '步骤序号必须是正整数');
  if (action !== 'done' && action !== 'skip' && action !== 'issue') {
    throw fail('INVALID_INPUT', 'action 必须为 done / skip / issue');
  }
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  if ((action === 'skip' || action === 'issue') && !note) {
    throw fail('INVALID_INPUT', '跳过 / 标记问题必须填写原因备注（现场留痕不收空白说明）', 422);
  }

  const { order, mergedLog } = await loadFieldOrder(orderId);
  if (order.status !== 'in_progress') {
    throw fail('STATE_MUTEX_ERROR', `状态互斥拦截：当前工单状态为【${STATUS_LABELS[order.status] ?? order.status}】，仅“检修中”可记录步骤。`, 409);
  }
  if (!lotoAllConfirmed(mergedLog.loto)) {
    throw fail('FIELD_LOTO_REQUIRED', '安全确认未完成：必须先通过 LOTO 四项强制检查，才能开始拆解操作记录。', 423);
  }
  const parsedSteps = parseOrderSteps((order.repairLog as WorkOrder['repairLog'])?.resolutionSteps ?? null) ?? [];
  if (index > parsedSteps.length) throw fail('INVALID_INPUT', `步骤序号超出范围（该工单共 ${parsedSteps.length} 步）`);

  const operator = cleanOperator(operatorRaw);
  const now = new Date();
  const { at: prevAt, elapsedMin } = previousEventAt(mergedLog, now);
  const state: FieldStepRecord = {
    status: action,
    note: note || undefined,
    by: operator,
    at: asIso(now),
    elapsedMin,
  };
  mergedLog.steps = { ...mergedLog.steps, [String(index)]: state };
  const text = parsedSteps[index - 1] ?? `步骤 ${index}`;
  const label = action === 'done' ? '完成' : action === 'skip' ? '跳过' : '标记问题';
  mergedLog.events = [...mergedLog.events, { at: asIso(now), kind: 'step', text: `步骤 ${index}「${text}」${label}${note ? `（备注：${note}）` : ''}${elapsedMin != null ? `，距上一记录 ${elapsedMin} 分钟` : ''}。`, by: operator.name }];
  void prevAt;

  let autoCompleted = false;
  if (canAutoComplete(mergedLog, parsedSteps.length)) {
    await autoComplete(order, mergedLog, parsedSteps.length, operator);
    autoCompleted = true;
  } else {
    const updated = await persistFieldLog(order, mergedLog);
    if (!updated) throw fail('WORK_ORDER_NOT_FOUND', '工单未找到', 404);
    aiCacheInvalidateEquipment(order.equipmentId);
  }
  const session = await getWorkSession(order.equipmentId, autoCompleted ? order.id : undefined);
  return { session, autoCompleted };
}

/** 录入测量数据：科目/限值以真实点检标准为准，服务端复算合格性 */
export async function addFieldMeasurement(
  orderId: string,
  operatorRaw: unknown,
  body: unknown
): Promise<FieldSession> {
  const b = (body ?? {}) as Record<string, unknown>;
  const checkPoint = typeof b.checkPoint === 'string' ? b.checkPoint.trim() : '';
  const posNo = typeof b.posNo === 'string' ? b.posNo.trim() : '';
  const value = typeof b.value === 'number' ? b.value : Number.parseFloat(String(b.value ?? ''));
  if (!checkPoint) throw fail('INVALID_INPUT', 'checkPoint（真实点检科目）必填');
  if (!posNo) throw fail('INVALID_INPUT', 'posNo（拆解 BOM 位号）必填');
  if (!Number.isFinite(value)) throw fail('INVALID_INPUT', 'value 必须是数值');

  const { order, mergedLog } = await loadFieldOrder(orderId);
  if (order.status !== 'in_progress') {
    throw fail('STATE_MUTEX_ERROR', `当前工单状态【${STATUS_LABELS[order.status] ?? order.status}】，仅“检修中”可录入测量。`, 409);
  }
  if (!lotoAllConfirmed(mergedLog.loto)) {
    throw fail('FIELD_LOTO_REQUIRED', '安全确认未完成：先完成 LOTO 强制确认才能录入测量。', 423);
  }
  const catalog = getCatalogForDevice(order.equipmentId);
  if (!catalog.some((p) => p.posNo === posNo)) {
    throw fail('PART_NOT_IN_CATALOG', '位号不存在于该设备拆解页 BOM', 404);
  }
  const standards = await getMeasurementStandards(order.equipmentId);
  const ref = standards.find((s) => s.checkPoint === checkPoint);
  if (!ref) {
    throw fail('MEASURE_STANDARD_NOT_FOUND', '该测点在该设备的真实点检标准中不存在，不做无标准测量记录。', 422);
  }
  const ok =
    ref.minLimit == null && ref.maxLimit == null
      ? null // 无限值如实录痕，不判合格
      : (ref.minLimit == null || value >= ref.minLimit) && (ref.maxLimit == null || value <= ref.maxLimit);

  const operator = cleanOperator(operatorRaw);
  const now = new Date();
  const record: FieldMeasurement = {
    id: `fm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    posNo,
    checkPoint,
    standard: ref.standard,
    unit: ref.unit,
    minLimit: ref.minLimit,
    maxLimit: ref.maxLimit,
    value,
    ok,
    by: operator,
    at: asIso(now),
  };
  mergedLog.measurements = [...mergedLog.measurements, record];
  mergedLog.events = [...mergedLog.events, {
    at: asIso(now),
    kind: 'measure',
    text: `${posNo} 现场测量「${checkPoint}」= ${value}${ref.unit ?? ''}，标准 ${ref.standard ?? '—'}，${ok === null ? '无限值仅留痕' : ok ? '合格' : '⚠ 超出标准区间'}。`,
    by: operator.name,
  }];
  const updated = await persistFieldLog(order, mergedLog);
  if (!updated) throw fail('WORK_ORDER_NOT_FOUND', '工单未找到', 404);
  aiCacheInvalidateEquipment(order.equipmentId);
  return getWorkSession(order.equipmentId);
}

/** 现场照片：必须先经真实 /uploads/image 落盘；posNo 必须在真实拆解 BOM 内 */
export async function addFieldPartPhoto(
  orderId: string,
  operatorRaw: unknown,
  body: unknown
): Promise<FieldSession> {
  const b = (body ?? {}) as Record<string, unknown>;
  const posNo = typeof b.posNo === 'string' ? b.posNo.trim() : '';
  const url = typeof b.url === 'string' ? b.url.trim() : '';
  const filename = typeof b.filename === 'string' ? b.filename : null;
  const size = typeof b.size === 'number' && Number.isFinite(b.size) ? Math.round(b.size) : null;
  if (!posNo) throw fail('INVALID_INPUT', 'posNo（拆解 BOM 位号）必填');
  if (!url.startsWith('/uploads/')) {
    throw fail('INVALID_INPUT', 'url 必须是先经 /api/v1/upload/image 真实上传得到的 /uploads/ 资源地址', 422);
  }
  const { order, mergedLog } = await loadFieldOrder(orderId);
  if (order.status !== 'in_progress') {
    throw fail('STATE_MUTEX_ERROR', `当前工单状态【${STATUS_LABELS[order.status] ?? order.status}】，仅“检修中”可上传现场照片。`, 409);
  }
  if (!lotoAllConfirmed(mergedLog.loto)) {
    throw fail('FIELD_LOTO_REQUIRED', '安全确认未完成：先完成 LOTO 强制确认才能录入现场照片。', 423);
  }
  const catalog = getCatalogForDevice(order.equipmentId);
  if (!catalog.some((p) => p.posNo === posNo)) {
    throw fail('PART_NOT_IN_CATALOG', '位号不存在于该设备拆解页 BOM', 404);
  }
  const operator = cleanOperator(operatorRaw);
  const now = new Date();
  const record: FieldPartPhoto = {
    id: `fp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    posNo,
    url,
    filename,
    size,
    by: operator,
    at: asIso(now),
  };
  mergedLog.partPhotos = [...mergedLog.partPhotos, record];
  mergedLog.events = [...mergedLog.events, {
    at: asIso(now),
    kind: 'photo',
    text: `${posNo} 上传现场照片（${filename ?? url}），已随工单留档。`,
    by: operator.name,
  }];
  const updated = await persistFieldLog(order, mergedLog);
  if (!updated) throw fail('WORK_ORDER_NOT_FOUND', '工单未找到', 404);
  aiCacheInvalidateEquipment(order.equipmentId);
  return getWorkSession(order.equipmentId);
}

export { VersionConflictError as FieldVersionConflictError };
export async function safeGetWorkSession(deviceId: string): Promise<FieldSession | null> {
  try {
    return await getWorkSession(deviceId);
  } catch (err: unknown) {
    logger.debug({ err: err instanceof Error ? err.message : String(err) }, 'field session unavailable');
    return null;
  }
}
