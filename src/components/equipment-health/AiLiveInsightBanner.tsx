import React from 'react';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { AiSafetyNoticeData, AiDiagTraceabilityData } from './healthTypes';

interface AiLiveInsightBannerProps {
  aiAnalysisResult: string | null;
  aiSafetyNotice: AiSafetyNoticeData | null;
  aiDiagTraceability: AiDiagTraceabilityData | null;
}

export const AiLiveInsightBanner: React.FC<AiLiveInsightBannerProps> = ({
  aiAnalysisResult,
  aiSafetyNotice,
  aiDiagTraceability,
}) => {
  if (!aiAnalysisResult) return null;

  return (
    <div className="space-y-2 animate-in fade-in duration-200">
      {/* 元数据 Badge */}
      <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-[11px] text-slate-600">
        <div className="flex items-center space-x-2">
          <span className="font-semibold text-slate-700">来源模型:</span>
          <span className="font-mono text-blue-700 font-bold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
            {aiDiagTraceability?.model || 'DashScope qwen-plus'}
          </span>
          <span className="font-semibold text-slate-700">Prompt:</span>
          <span className="font-mono text-purple-700 font-bold bg-purple-50 px-1.5 py-0.5 rounded border border-purple-100">
            {aiDiagTraceability?.promptVersion || 'v2.1.0'}
          </span>
        </div>
        <div>
          {aiSafetyNotice?.degraded ? (
            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 font-bold">
              规则引擎降级兜底
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
              大模型正常输出
            </span>
          )}
        </div>
      </div>

      {/* 红色安全警示条 */}
      {aiSafetyNotice?.required && (
        <div className="p-3.5 rounded-xl bg-rose-50 border-2 border-rose-300 text-xs text-rose-900 space-y-1">
          <div className="flex items-center space-x-1.5 font-bold text-rose-800">
            <AlertTriangle className="w-4 h-4 text-rose-600" />
            <span>【工业高危安全警示】</span>
          </div>
          <p className="text-rose-700 leading-relaxed font-medium">{aiSafetyNotice.reason}</p>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-xs text-blue-900 space-y-1 shadow-xs">
        <div className="flex items-center space-x-1.5 font-bold text-blue-700">
          <Sparkles className="w-4 h-4 text-blue-600" />
          <span>DashScope 通义千问工业诊断引擎即时分析报告</span>
        </div>
        <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700 leading-relaxed mt-1">
          {aiAnalysisResult}
        </pre>
      </div>
    </div>
  );
};
