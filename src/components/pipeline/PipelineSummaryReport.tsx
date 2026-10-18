import React from 'react';
import { CheckCircle2, ClipboardList, Zap } from 'lucide-react';
import { AiPipelineTask } from '../../api';

interface PipelineSummaryReportProps {
  task: AiPipelineTask;
  onGoDispatch?: (preset: { workOrderId?: string | null; equipmentId?: string | null }) => void;
}

export const PipelineSummaryReport: React.FC<PipelineSummaryReportProps> = ({
  task,
  onGoDispatch,
}) => {
  const report = task.result?.report;
  if (!report) return null;

  return (
    <div className="card-saas p-6 border border-slate-200/80 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-slate-100">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
            <ClipboardList className="w-4 h-4" />
          </div>
          <h2 className="text-sm font-bold text-slate-900">
            协同检修终审报告
          </h2>
        </div>
        {task?.result?.degradedSteps?.length ? (
          <span className="text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
            {task.result.degradedSteps.join('、')} 为规则引擎降级结果
          </span>
        ) : (
          <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            全部步骤 AI 原生结果
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
        <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/70 space-y-1.5">
          <p className="font-bold text-slate-800 text-xs">受检设备与问题工况</p>
          <p className="text-slate-700 font-medium">
            {report.equipment?.name}（{report.equipment?.code}）· 健康指数 {report.equipment?.healthScore ?? '—'}
          </p>
          <p className="text-slate-500 leading-relaxed pt-1">{report.problemDescription}</p>
        </div>
        {report.diagnosis && (
          <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/70 space-y-1.5">
            <p className="font-bold text-slate-800 text-xs">① 诊断结论{report.diagnosis.degraded ? '（降级）' : ''}</p>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-bold border border-blue-200/60">
                {report.diagnosis.severity}
              </span>
              <span className="text-slate-600 font-medium">{report.diagnosis.summary}</span>
            </div>
          </div>
        )}
        {report.plan && (
          <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/70 space-y-1.5">
            <p className="font-bold text-slate-800 text-xs">② 检修方案{report.plan.degraded ? '（降级）' : ''}</p>
            <p className="text-slate-700 leading-relaxed">{report.plan.overview}</p>
            <p className="text-xs text-slate-500 font-mono pt-1">预估工时 {report.plan.estimatedHours ?? '—'}h · 标准 SOP 步骤</p>
          </div>
        )}
        {report.risk && (
          <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/70 space-y-1.5">
            <p className="font-bold text-slate-800 text-xs">③ 安全审核{report.risk.degraded ? '（降级）' : ''}</p>
            <p className="text-slate-700">
              安全风险评级：<span className="font-bold text-amber-600">{report.risk.riskLevel}</span>
              {report.risk.lotoAdvice?.required ? ' · 需严格执行 LOTO 能量隔离' : ''}
            </p>
          </div>
        )}
        {report.assignee && (
          <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/70 space-y-2 md:col-span-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="font-bold text-slate-800 text-xs">④ 派单推荐{report.assignee.degraded ? '（降级）' : ''}</p>
                <p className="text-slate-700 mt-1">
                  推荐主修技师：<span className="font-bold text-blue-700">{report.assignee.recommended?.name || '—'}</span> · 预估工时{' '}
                  {report.assignee.estimatedHours ?? '—'}h
                </p>
              </div>
              {onGoDispatch && (
                <button
                  type="button"
                  onClick={() => onGoDispatch({ equipmentId: report.equipment?.id })}
                  className="px-4 py-2 rounded-xl btn-gradient text-xs font-semibold text-white cursor-pointer flex items-center shadow-xs hover:shadow-md transition-all"
                >
                  <Zap className="w-3.5 h-3.5 mr-1.5" />
                  前往调度大屏就近派单
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <p className="text-xs text-slate-500 font-mono">报告生成时间：{report.generatedAt}</p>
    </div>
  );
};
