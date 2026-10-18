import React from 'react';
import { 
  Sparkles, 
  Clock, 
  AlertTriangle, 
  ArrowRight, 
  CheckCircle,
  Lightbulb,
  ShieldAlert,
  ChevronRight
} from 'lucide-react';
import type { ButlerSuggestion } from './demoData';
import { useToast } from '../../context/ToastContext';

interface AiButlerSuggestionsProps {
  suggestions: ButlerSuggestion[];
  onActionClick?: (sugId: string) => void;
}

export const AiButlerSuggestions: React.FC<AiButlerSuggestionsProps> = ({
  suggestions,
  onActionClick,
}) => {
  const { show: showToast } = useToast();

  const handleAction = (sug: ButlerSuggestion) => {
    if (sug.id === 'sug-1') {
      if (onActionClick) onActionClick('sug-1');
      showToast({
        type: 'info',
        title: '已定位至 LOTO 确认区',
        message: '请在上方工作台确认「残余能量泄压」项',
        duration: 3000,
      });
    } else if (sug.id === 'sug-2') {
      showToast({
        type: 'warning',
        title: '高低温安全防护标准',
        message: '作业规范要求：凡工件表面温度 > 60℃ 时，现场作业人员须全程穿戴防烫长袖作业服与耐高温防穿刺劳保手套。',
        duration: 5000,
      });
    } else if (sug.id === 'sug-3') {
      showToast({
        type: 'info',
        title: '自动编排已就绪',
        message: '系统已把《离心机轴承检修规程》与备件领用二维码推送至机修一班移动端看板。',
        duration: 4000,
      });
    }
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
            <p className="text-[11px] text-slate-400">基于多模态遥测与闭环规则库动态推演</p>
          </div>
        </div>

        <span className="text-[10px] text-amber-700 font-semibold bg-amber-50 border border-amber-200/70 px-2 py-0.5 rounded-full">
          实时干预保障
        </span>
      </div>

      {/* 3 条建议列表 */}
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
