import React, { useState } from 'react';
import {
  Sparkles,
  ArrowRight,
  Lightbulb,
  Workflow,
  Cpu,
  ShieldCheck,
  CheckCircle2,
  Loader2
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';

interface GoalInputHeroProps {
  onGeneratePlan: (goalText: string) => Promise<void> | void;
  onCancel?: () => void;
  busy?: boolean;
}

const PRESET_GOALS = [
  '2#无油螺杆空压机主机振动偏高，走检修流程',
  '1#离心主循环给水泵温度报警，安排检修',
  '3#轧机主传动行星减速箱异响排查',
  '13#螺杆制冷压缩机联锁跳停复检',
];

export const GoalInputHero: React.FC<GoalInputHeroProps> = ({
  onGeneratePlan,
  onCancel,
  busy,
}) => {
  const { show: showToast } = useToast();
  const [goalInput, setGoalInput] = useState('2#无油螺杆空压机主机振动偏高，走检修流程');
  const [isGenerating, setIsGenerating] = useState(false);

  const generating = isGenerating || Boolean(busy);

  const handleStartGenerate = async () => {
    if (!goalInput.trim()) {
      showToast({
        type: 'warning',
        title: '请输入业务目标',
        message: '请描述您的业务意图，例如：2#无油螺杆空压机主机振动偏高，走检修流程',
        duration: 3000,
      });
      return;
    }

    setIsGenerating(true);
    try {
      await Promise.resolve(onGeneratePlan(goalInput));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-3xl bg-white/95 border border-slate-200/90 shadow-lg p-6 sm:p-8 lg:p-10 backdrop-blur-md max-w-4xl mx-auto my-4 space-y-6">
      {/* 顶部炫彩环境背景 */}
      <div 
        className="absolute -top-24 -right-24 w-96 h-96 rounded-full blur-3xl opacity-20 pointer-events-none"
        style={{ background: 'radial-gradient(circle, #E8A33D 0%, #0EA5E9 100%)' }}
      />
      <div 
        className="absolute -bottom-24 -left-24 w-96 h-96 rounded-full blur-3xl opacity-15 pointer-events-none"
        style={{ background: 'radial-gradient(circle, #2563EB 0%, #6366F1 100%)' }}
      />

      {/* 头部标题与管家定位 */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gradient-to-r from-amber-50 to-blue-50 border border-amber-200/60 text-xs font-semibold text-slate-800 shadow-2xs">
            <Sparkles className="w-3.5 h-3.5 text-[#E8A33D]" />
            <span>Hermes 智能业务管家 · 意图驱动编排</span>
          </div>

          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            输入一句话业务意图，一键编排六大环节业务闭环
          </h2>

          <p className="text-xs sm:text-sm text-slate-500 max-w-2xl leading-relaxed">
            AI 负责检索设备图谱、识别 JSA 危险源、自动预填工单与 LOTO 清单；您只需在关键安全闸门点击确认推进，全流程留痕闭环并沉淀知识包。
          </p>
        </div>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-slate-500 hover:text-slate-800 font-medium px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer shrink-0"
          >
            返回当前闭环
          </button>
        )}
      </div>

      {/* 输入框主卡片 */}
      <div className="space-y-3 pt-2">
        <div className="relative">
          <textarea
            value={goalInput}
            onChange={(e) => setGoalInput(e.target.value)}
            disabled={generating}
            placeholder="例如：2#无油螺杆空压机主机振动偏高，走检修流程..."
            rows={3}
            className="w-full p-4 rounded-2xl border-2 border-blue-200/80 bg-slate-50/50 text-slate-800 text-sm sm:text-base font-medium placeholder-slate-400 focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-500/10 transition-all shadow-inner resize-none"
          />

          <div className="absolute bottom-3.5 right-3.5 flex items-center gap-2">
            <button
              type="button"
              disabled={generating}
              onClick={handleStartGenerate}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold text-white bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-800 shadow-md hover:shadow-lg disabled:opacity-70 transition-all cursor-pointer"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>服务端受理中…</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>生成业务路线图</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* 快捷推荐预设意图 */}
        <div className="space-y-1.5 pt-1">
          <div className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
            <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
            <span>或尝试选择工业常见高频意图：</span>
          </div>

          <div className="flex flex-wrap gap-2">
            {PRESET_GOALS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setGoalInput(preset)}
                className="text-xs text-slate-600 bg-slate-100/80 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 border border-slate-200/80 px-3 py-1.5 rounded-xl transition-all cursor-pointer text-left"
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 受理中提示：只说明服务端此刻真实在做什么，不放假进度条 */}
      {generating && (
        <div className="p-4 rounded-2xl bg-blue-50/70 border border-blue-200 space-y-2.5">
          <div className="text-xs font-bold text-blue-900 flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
            <span>POST /api/v1/business-loops 受理中</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div className="p-2.5 rounded-xl border bg-white border-blue-300 text-blue-700">
              <div className="font-semibold flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5" /> 1. 目标解析与设备对齐
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">按 seed 设备台账匹配目标设备并登记闭环</div>
            </div>

            <div className="p-2.5 rounded-xl border bg-white border-blue-300 text-blue-700">
              <div className="font-semibold flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" /> 2. 写入六环节与产出物空档
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">business_loop_stages / artifacts 落库</div>
            </div>

            <div className="p-2.5 rounded-xl border bg-white border-blue-300 text-blue-700">
              <div className="font-semibold flex items-center gap-1.5">
                <Workflow className="w-3.5 h-3.5" /> 3. 环节 1-4 异步调用真实 AI 能力
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">工单草稿 / JSA / LOTO / 检修方案逐环节回写</div>
            </div>
          </div>
        </div>
      )}

      {/* 闭环流转特性说明卡 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-100 text-xs">
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50/70 border border-slate-200/60">
          <div className="p-1 rounded bg-blue-100 text-blue-700 shrink-0">
            <Workflow className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="font-bold text-slate-800">全链路线串联</div>
            <div className="text-slate-500 text-[11px] mt-0.5">从现场报修直至质检归档，打通 6 个散落模块</div>
          </div>
        </div>

        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50/70 border border-slate-200/60">
          <div className="p-1 rounded bg-amber-100 text-amber-800 shrink-0">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="font-bold text-slate-800">AI 自主预填</div>
            <div className="text-slate-500 text-[11px] mt-0.5">自动匹配工单编号、JSA 措施与隔离点位</div>
          </div>
        </div>

        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50/70 border border-slate-200/60">
          <div className="p-1 rounded bg-emerald-100 text-emerald-700 shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="font-bold text-slate-800">人工确认闸门</div>
            <div className="text-slate-500 text-[11px] mt-0.5">关键安全防线人工逐项核准，严守工程底线</div>
          </div>
        </div>
      </div>
    </div>
  );
};
