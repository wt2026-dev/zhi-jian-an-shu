import type { StageId } from './types';

/** 环节说明取自服务端 STAGE_DEFS（与 aiBadge/outputSummary 同源），不在前端另写一套 */
export const STAGE_INTRO: Record<StageId, string> = {
  stage_report: '遥测越限与业务目标自动生成报修工单草稿，人工核对确认后落库为真实工单',
  stage_permit: '作业安全分析 (JSA) 识别危险能量与控制措施，确认后落成真实作业票（待双人会签）',
  stage_loto: '按 GB/T 33579 推演隔离点并匹配台账真实锁具，须现场逐项人工确认方可开工',
  stage_execution: '依据设备档案与历史检修记录生成检修方案，确认后转为作业指引档案',
  stage_completion: '引用真实工单状态与台账遥测基线生成完工验收记录',
  stage_archive: '汇总全链路数据生成质检报告，并判定是否沉淀知识条目入知识库',
};

/** 故障类型/优先级/风险档取值口径与服务端 schema 与 work_orders/safety_permits 现网枚举一致 */
export const FAULT_TYPES = ['机械振动', '轴承温度', '润滑系统', '气路与密封', '电气联锁', '传动部件', '其他'];
export const PRIORITIES = ['urgent', 'high', 'medium', 'low'];
export const PRIORITY_LABEL: Record<string, string> = {
  urgent: 'urgent（紧急）',
  high: 'high（高）',
  medium: 'medium（中）',
  low: 'low（低）',
};
/** JSA 四档结论，服务端按 Level 1-4 映射为作业票风险档 */
export const RISK_LEVELS = ['极高', '高', '中', '低'];
export const LOTO_TYPES = ['电气隔离', '气源隔离', '液压隔离', '残余能量', '机械隔离'];

export type FieldKind = 'text' | 'textarea' | 'number' | 'select';

export interface EditableFieldSpec {
  group: 'workOrderDraft' | 'assessment' | 'plan';
  key: string;
  label: string;
  kind: FieldKind;
  options?: string[];
  span2?: boolean;
  placeholder?: string;
  step?: string;
}

/** 空规格单例：不能每次渲染新建数组，否则下游 useMemo 的依赖永远在变 */
export const EMPTY_EDIT_SPECS: EditableFieldSpec[] = [];

/**
 * 确认闸门上可人工改写的字段（与服务端 HUMAN_EDITABLE_FIELDS 白名单一一对应）。
 * AI 只出草稿：预计工时/优先级/风险档这类现场才说得清的数，必须由确认人改后再落库。
 */
export const STAGE_EDIT_SPECS: Partial<Record<StageId, EditableFieldSpec[]>> = {
  stage_report: [
    { group: 'workOrderDraft', key: 'title', label: '工单标题', kind: 'text', span2: true, placeholder: '至少 4 个字，含设备名与故障' },
    { group: 'workOrderDraft', key: 'faultType', label: '故障类型', kind: 'select', options: FAULT_TYPES },
    { group: 'workOrderDraft', key: 'priority', label: '优先级', kind: 'select', options: PRIORITIES },
    { group: 'workOrderDraft', key: 'estimatedHours', label: '预计工时（小时）', kind: 'number', step: '0.5', placeholder: '如 4' },
    { group: 'workOrderDraft', key: 'description', label: '现场情况描述', kind: 'textarea', span2: true, placeholder: '引用真实遥测数值，说明当前状态' },
  ],
  stage_permit: [
    { group: 'assessment', key: 'riskLevel', label: 'JSA 风险等级', kind: 'select', options: RISK_LEVELS },
    { group: 'assessment', key: 'riskReason', label: '风险定级理由', kind: 'textarea', span2: true },
  ],
  stage_execution: [
    { group: 'plan', key: 'overview', label: '方案概述', kind: 'textarea', span2: true },
    { group: 'plan', key: 'estimatedHours', label: '预估工时（小时）', kind: 'number', step: '0.5' },
    { group: 'plan', key: 'workers', label: '作业人数', kind: 'number', step: '1', placeholder: '整数，1-50' },
  ],
};

export const fmtClock = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function groupValue(raw: any, group: string, key: string): string {
  const g = raw?.[group];
  if (!g || typeof g !== 'object') return '';
  const v = (g as any)[key];
  return v === undefined || v === null ? '' : String(v);
}
