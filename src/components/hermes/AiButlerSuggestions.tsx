import React from 'react';
import {
  Sparkles,
  Clock,
  ShieldAlert,
  ChevronRight
} from 'lucide-react';
import type { ButlerSuggestion } from './types';
import { useToast } from '../../context/ToastContext';

interface AiButlerSuggestionsProps {
  suggestions: ButlerSuggestion[];
  onActionClick?: (sug: ButlerSuggestion) => void;
}

export const AiButlerSuggestions: React.FC<AiButlerSuggestionsProps> = ({
  suggestions,
  onActionClick,
}) => {
  const { show: showToast } = useToast();

  // 建议正文完全来自服务端 buildSuggestions（按当前环节 / LOTO 进度 / AI 降级状态生成），
  // 点击只做一件事：把工作台切到该建议指向的环节，并把建议原文如实提示出来。
  const handleAction = (sug: ButlerSuggestion) => {
    if (onActionClick) onActionClick(sug);
    showToast({
      type: sug.type === 'risk' ? 'warning' : 'info',
      title: sug.title,
      message: sug.content,
      duration: 4500,
    });
  };

  return (
    <div className="rounded-2xl bg-white/95 border border-slate-200/90 shadow-sm p-4 sm:p-5 backdrop-blur-md flex flex-col justify-between space-y-3.5">
      {/* 标题 */}
      <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div 
            className="p-1 rounded-md text-white shadow-2xs"
            style={{ backgroundColor: '#E8A33D' }}
          >
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-800 tracking-tight">AI 智能管家行动建议</h3>
            <p className="text-[11px] text-slate-400">由服务端按当前环节、LOTO 进度与 AI 预填状态实时推演</p>
          </div>
        </div>

        <span className="text-[10px] text-amber-700 font-semibold bg-amber-50 border border-amber-200/70 px-2 py-0.5 rounded-full">
          共 {suggestions.length} 条
        </span>
      </div>

      {/* 建议列表 */}
      {suggestions.length === 0 && (
        <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
          暂无建议：读取闭环详情接口后即可看到服务端推演结果
        </div>
      )}
      <div className="space-y-2.5">
        {suggestions.map((sug) => {
          const isTodo = sug.type === 'todo';
          const isRisk = sug.type === 'risk';
          const isNext = sug.type === 'next';

          return (
            <div
              key={sug.id}
              className={`p-3 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                isRisk
                  ? 'bg-rose-50/25 border-rose-200/80 hover:border-rose-300'
                  : isTodo
                  ? 'bg-amber-50/20 border-amber-200/80 hover:border-amber-300'
                  : 'bg-blue-50/20 border-blue-200/80 hover:border-blue-300'
              }`}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="shrink-0 mt-0.5">
                  {isRisk && <ShieldAlert className="w-4 h-4 text-rose-600" />}
                  {isTodo && <Clock className="w-4 h-4 text-amber-600" />}
                  {isNext && <Sparkles className="w-4 h-4 text-blue-600" />}
                </div>

                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-900">
                      {sug.title}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                      isRisk 
                        ? 'bg-rose-100 text-rose-700' 
                        : isTodo 
                        ? 'bg-amber-100 text-amber-800' 
                        : 'bg-blue-100 text-blue-800'
                    }`}>
                      {sug.tag}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    {sug.content}
                  </p>
                </div>
              </div>

              {sug.actionText && (
                <button
                  type="button"
                  onClick={() => handleAction(sug)}
                  className={`shrink-0 self-end sm:self-center inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                    isRisk
                      ? 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50'
                      : isTodo
                      ? 'bg-white text-amber-800 border-amber-200 hover:bg-amber-50'
                      : 'bg-white text-blue-700 border-blue-200 hover:bg-blue-50'
                  }`}
                >
                  <span>{sug.actionText}</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
