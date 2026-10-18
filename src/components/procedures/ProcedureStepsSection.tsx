import React from 'react';
import {
  Clock,
  CheckCircle2,
  CheckSquare,
  Square,
  Wrench,
  ShieldAlert,
} from 'lucide-react';
import { MaintenanceProcedure } from '../../types';

interface ProcedureStepsSectionProps {
  activeProcedure: MaintenanceProcedure;
  checkedSteps: number[];
  isAllStepsCompleted: boolean;
  onToggleStep: (stepNo: number) => void;
}

export const ProcedureStepsSection: React.FC<ProcedureStepsSectionProps> = ({
  activeProcedure,
  checkedSteps,
  isAllStepsCompleted,
  onToggleStep,
}) => {
  return (
    <>
      {/* 规程标题卡片 */}
      <div className="card-industrial bg-white border border-slate-200 p-5 border-l-4 border-l-blue-600 shadow-xs rounded-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-xs font-semibold">
                {activeProcedure.equipmentType}
              </span>
              <span className="px-2.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-xs font-semibold">
                {activeProcedure.maintenanceLevel}
              </span>
              <span className="text-xs text-slate-500 flex items-center gap-1 font-mono">
                <Clock className="w-3.5 h-3.5" />
                {activeProcedure.estimatedMinutes || 60}分钟
              </span>
            </div>
            <h3 className="text-lg font-bold text-slate-900">{activeProcedure.title}</h3>
          </div>

          {/* 合规状态徽章 */}
          <div className="shrink-0">
            {isAllStepsCompleted ? (
              <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold text-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                合规通过
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 font-medium text-xs">
                <span className="font-mono font-semibold text-slate-800">
                  {checkedSteps.length}/{activeProcedure.steps.length}
                </span>
                <span>步骤完成</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 步骤卡片流 */}
      <div className="space-y-4">
        {activeProcedure.steps.map((step) => {
          const isChecked = checkedSteps.includes(step.step_no);
          const isNextToExecute =
            !isChecked &&
            (step.step_no === 1 || checkedSteps.includes(step.step_no - 1));

          return (
            <div
              key={step.step_no}
              className={`card-industrial p-5 transition-all relative rounded-xl border shadow-xs ${
                isChecked
                  ? 'bg-emerald-50/20 border-emerald-300'
                  : isNextToExecute
                  ? 'bg-white border-blue-400 shadow-md ring-1 ring-blue-200'
                  : 'bg-white border-slate-200 opacity-80'
              }`}
            >
              <div className="flex items-start gap-4">
                {/* 步骤数字圆标 */}
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 border ${
                    isChecked
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : isNextToExecute
                      ? 'bg-blue-600 text-white border-blue-500 shadow-xs'
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                  }`}
                >
                  {step.step_no < 10 ? `0${step.step_no}` : step.step_no}
                </div>

                {/* 步骤内容主体 */}
                <div className="flex-1 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      {step.name}
                      {isChecked && (
                        <span className="text-xs font-normal text-emerald-600 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> 已完成达标
                        </span>
                      )}
                    </h4>

                    {/* 勾选操作按键 */}
                    <button
                      type="button"
                      onClick={() => onToggleStep(step.step_no)}
                      className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        isChecked
                          ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200'
                          : isNextToExecute
                          ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200'
                      }`}
                    >
                      {isChecked ? (
                        <>
                          <CheckSquare className="w-4 h-4 text-emerald-600" />
                          <span>已确认</span>
                        </>
                      ) : (
                        <>
                          <Square className="w-4 h-4" />
                          <span>确认完成</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* 操作内容 */}
                  <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200">
                    {step.content}
                  </p>

                  {/* 工具、安全、验收三要素清单 */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-[11px] pt-1">
                    {/* 工具 */}
                    <div className="p-2.5 rounded-lg bg-blue-50/40 border border-blue-200 space-y-1">
                      <span className="text-blue-700 flex items-center gap-1 font-semibold">
                        <Wrench className="w-3 h-3 text-blue-600" /> 所需工具/备件:
                      </span>
                      <p className="text-slate-700">{step.tools || '标准机修工具'}</p>
                    </div>

                    {/* 安全要求 */}
                    <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 space-y-1">
                      <span className="text-rose-700 flex items-center gap-1 font-semibold">
                        <ShieldAlert className="w-3 h-3 text-rose-600" /> 安全要点/红线:
                      </span>
                      <p className="text-rose-900">{step.safety || '严格遵照作业防护规范'}</p>
                    </div>

                    {/* 验收标准 */}
                    <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 space-y-1">
                      <span className="text-emerald-700 flex items-center gap-1 font-semibold">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" /> 验收标准/要点:
                      </span>
                      <p className="text-emerald-900">{step.acceptance || '无异常，运行稳定'}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};
