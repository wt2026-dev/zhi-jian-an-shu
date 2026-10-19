import React from 'react';
import {
  Activity,
  ClipboardList,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';

export const STEP_META: Record<string, { icon: React.ComponentType<{ className?: string }>; desc: string }> = {
  '故障诊断': { icon: Activity, desc: 'AI 工程机理分析，输出严重度与可能原因' },
  '检修方案生成': { icon: ClipboardList, desc: '结合知识库 SOP 与历史检修记录生成作业指导书' },
  '风险审核': { icon: ShieldCheck, desc: 'JSA 作业安全分析，评定风险等级与 LOTO 建议' },
  '派单推荐': { icon: UserCheck, desc: '按负载与历史经验推荐主修技师' },
};

export interface CapabilityItem {
  name: string;
  stageBadge: string;
  icon: React.ComponentType<{ className?: string }>;
  desc: string;
  input: string;
  output: string;
  badgeStyle: string;
  iconStyle: string;
}

export const CAPABILITY_CARDS: CapabilityItem[] = [
  {
    name: '故障诊断推演',
    stageBadge: '阶段 1 · 串行机理分析',
    icon: Activity,
    desc: '基于 AI 引擎的工业工程机理深度分析，推演严重等级与多因概率',
    input: '时序遥测 + 故障现象',
    output: '诊断结论 + 概率成因',
    badgeStyle: 'bg-blue-50 text-blue-700 border-blue-200/80',
    iconStyle: 'bg-blue-50 text-blue-600',
  },
  {
    name: '检修方案制定',
    stageBadge: '阶段 2 · 串行 SOP 推演',
    icon: ClipboardList,
    desc: '融合企业知识库规程与历史工单记录，自动生成标准化作业指导书',
    input: '根因判定 + 知识库',
    output: '分步作业指南 + 工时',
    badgeStyle: 'bg-indigo-50 text-indigo-700 border-indigo-200/80',
    iconStyle: 'bg-indigo-50 text-indigo-600',
  },
  {
    name: 'JSA 风险审核',
    stageBadge: '阶段 3A · 并行安全风控',
    icon: ShieldCheck,
    desc: '工作安全危害辨识（JSA），评定风险等级并给出 LOTO 能量隔离方案',
    input: '作业工步 + 设备类型',
    output: '安全风险等级 + LOTO',
    badgeStyle: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
    iconStyle: 'bg-emerald-50 text-emerald-600',
  },
  {
    name: '智能派单推荐',
    stageBadge: '阶段 3B · 并行派工调度',
    icon: UserCheck,
    desc: '综合技师特种技能证书、在办负载工时与现场物理距离智能匹配',
    input: '作业资质 + 人员负荷',
    output: '主修推荐 + 备选技师',
    badgeStyle: 'bg-purple-50 text-purple-700 border-purple-200/80',
    iconStyle: 'bg-purple-50 text-purple-600',
  },
];

export const PRESET_SCENARIOS = [
  {
    label: '🔥 轴承温升异响',
    equipmentKeyword: '泵',
    problem: '运行中轴承箱温度持续升高至 78℃ 并伴有金属摩擦异响，振动值由 2.1mm/s 上升至 4.6mm/s 接近报警上限',
  },
  {
    label: '💧 机械密封泄漏',
    equipmentKeyword: '泵',
    problem: '机械密封动静环端面出现间歇性介质渗漏，伴随白色蒸汽喷冒与轴端轻微抖动',
  },
  {
    label: '⚡ 排气压力骤降',
    equipmentKeyword: '机',
    problem: '高压级间排气压力在 30 分钟内由 0.85MPa 跌落至 0.61MPa，电机负载电流波动超 15%',
  },
];
