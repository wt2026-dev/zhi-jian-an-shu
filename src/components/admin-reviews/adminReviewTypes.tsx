import React from 'react';
import {
  CheckCircle2,
  Clock,
  XCircle,
  ScanSearch,
  Sparkles,
  BookOpen,
  ShieldCheck,
  FileSearch,
  ClipboardList,
} from 'lucide-react';

function WrenchIcon({ className }: { className?: string }) {
  return <span className={className}>🔧</span>;
}

export const SOURCE_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  maintenance_plan: { label: '检修方案', icon: WrenchIcon },
  safety_risk: { label: '作业风险评估', icon: ShieldCheck },
  report: { label: 'AI 报告', icon: FileSearch },
  work_order_draft: { label: '工单草稿', icon: ClipboardList },
};

export const STATUS_META: Record<
  string,
  { label: string; cls: string; icon: React.ComponentType<{ className?: string }> }
> = {
  pending: { label: '待审核', cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: Clock },
  approved: { label: '已通过', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  rejected: { label: '已驳回', cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: XCircle },
};

export const STAT_CARDS = [
  {
    key: 'pending' as const,
    label: '待审核',
    desc: '待管理员核验的 AI 产物',
    icon: Clock,
    activeCls: 'border-amber-400 bg-amber-50/50 ring-1 ring-amber-300',
    badgeCls: 'bg-amber-100 text-amber-700 border border-amber-200',
    countCls: 'text-amber-600',
    iconBg: 'bg-amber-100 text-amber-700',
  },
  {
    key: 'approved' as const,
    label: '已通过',
    desc: '已核验准入，正式生效',
    icon: CheckCircle2,
    activeCls: 'border-emerald-400 bg-emerald-50/50 ring-1 ring-emerald-300',
    badgeCls: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
    countCls: 'text-emerald-600',
    iconBg: 'bg-emerald-100 text-emerald-700',
  },
  {
    key: 'rejected' as const,
    label: '已驳回',
    desc: '已退回修正或存在异常',
    icon: XCircle,
    activeCls: 'border-rose-400 bg-rose-50/50 ring-1 ring-rose-300',
    badgeCls: 'bg-rose-100 text-rose-700 border border-rose-200',
    countCls: 'text-rose-600',
    iconBg: 'bg-rose-100 text-rose-700',
  },
  {
    key: 'all' as const,
    label: '全部内容',
    desc: '全量 AI 生成审核记录',
    icon: ScanSearch,
    activeCls: 'border-blue-400 bg-blue-50/50 ring-1 ring-blue-300',
    badgeCls: 'bg-blue-100 text-blue-700 border border-blue-200',
    countCls: 'text-blue-600',
    iconBg: 'bg-blue-100 text-blue-700',
  },
];

export const REVIEW_PROCESS_STEPS = [
  {
    step: '1',
    title: 'AI 生成内容',
    desc: '大模型生成方案/评估/报告/工单草案',
    icon: Sparkles,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
  },
  {
    step: '2',
    title: '进入审核台',
    desc: '自动挂起队列，状态标记为 pending',
    icon: Clock,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
  },
  {
    step: '3',
    title: '管理员核验溯源',
    desc: '核实知识库 SOP 引用与现场工况',
    icon: BookOpen,
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
  },
  {
    step: '4',
    title: '通过 / 驳回',
    desc: '通过：内容正式可用；驳回：填原因修正',
    icon: ShieldCheck,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
  },
];

export const KEY_LABELS: Record<string, string> = {
  overview: '方案概述',
  steps: '检修步骤',
  safetyMeasures: '安全措施',
  lotoPoints: 'LOTO 能量隔离点',
  ppe: '防护装备 (PPE)',
  highRiskNotes: '高危作业提示',
  tools: '工具清单',
  spareParts: '备件清单',
  qualityCheckpoints: '质检要点',
  estimatedHours: '预估工时(h)',
  workers: '建议人数',
  riskLevel: '风险等级',
  riskReason: '评级理由',
  hazardIdentifications: '危害辨识',
  jsaMeasures: 'JSA 控制措施',
  ppeList: '必备 PPE',
  lotoAdvice: 'LOTO 建议',
  approvalFocusPoints: '审批关注点',
  summary: '摘要',
  highlights: '工作亮点',
  problems: '存在问题',
  statistics: '关键指标',
  topIssues: '重点问题',
  suggestions: '改进建议',
  markdown: '报告正文',
};

export function renderContent(value: unknown, depth = 0): React.ReactNode {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const s = String(value);
    if (s.length > 120 && (s.includes('\n') || depth >= 1)) {
      return <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">{s}</p>;
    }
    return <span className="text-xs text-slate-700">{s}</span>;
  }
  if (Array.isArray(value)) {
    if (value.every((v) => ['string', 'number', 'boolean'].includes(typeof v))) {
      return (
        <ul className="space-y-1 text-xs text-slate-600">
          {value.map((v, i) => (
            <li key={i} className="flex items-start space-x-1.5">
              <span className="text-blue-400 mt-0.5 shrink-0">•</span>
              <span>{String(v)}</span>
            </li>
          ))}
        </ul>
      );
    }
    return (
      <div className="space-y-2">
        {value.map((v, i) => (
          <div key={i} className="p-2 rounded-lg bg-slate-50 border border-slate-100">
            {typeof v === 'object' && v !== null ? renderContent(v, depth + 1) : renderContent(v, depth + 1)}
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === 'object') {
    return (
      <div className={depth === 0 ? 'space-y-3' : 'space-y-2'}>
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <div key={k}>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">
              {KEY_LABELS[k] || k}
            </p>
            {renderContent(v, depth + 1)}
          </div>
        ))}
      </div>
    );
  }
  return null;
}
