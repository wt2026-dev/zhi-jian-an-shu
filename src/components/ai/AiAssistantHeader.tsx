import React from 'react';
import { Sparkles, Bot, Wrench, Camera } from 'lucide-react';

interface AiAssistantHeaderProps {
  activeMode: 'chat' | 'diagnose' | 'vision';
  onModeChange: (mode: 'chat' | 'diagnose' | 'vision') => void;
  latestAiModel?: string;
}

export const AiAssistantHeader: React.FC<AiAssistantHeaderProps> = ({
  activeMode,
  onModeChange,
  latestAiModel,
}) => {
  return (
    <div className="shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 flex items-center">
          <Sparkles className="w-5 h-5 mr-2 text-blue-600" />
          智检安枢 · 工业检修AI助手
        </h2>
        <p className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center text-slate-700 font-medium">
            当前应答引擎：<span className="text-blue-600 font-mono font-semibold ml-0.5">{latestAiModel || '未连接'}</span>
          </span>
          <span className="text-slate-300">·</span>
          <span>融合知识图谱、遥测时序、故障树专家模型与多模态工业视觉诊断能力</span>
        </p>
      </div>

      {/* Mode Switcher */}
      <div className="flex rounded-lg bg-slate-100 p-1 border border-slate-200">
        <button
          type="button"
          onClick={() => onModeChange('chat')}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center space-x-1.5 cursor-pointer ${
            activeMode === 'chat' ? 'bg-white text-blue-600 shadow-xs border border-slate-200/80 font-bold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Bot className="w-3.5 h-3.5" />
          <span>智能对话问答</span>
        </button>
        <button
          type="button"
          onClick={() => onModeChange('diagnose')}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center space-x-1.5 cursor-pointer ${
            activeMode === 'diagnose' ? 'bg-white text-blue-600 shadow-xs border border-slate-200/80 font-bold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Wrench className="w-3.5 h-3.5" />
          <span>故障诊断向导</span>
        </button>
        <button
          type="button"
          onClick={() => onModeChange('vision')}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center space-x-1.5 cursor-pointer ${
            activeMode === 'vision' ? 'bg-white text-blue-600 shadow-xs border border-slate-200/80 font-bold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Camera className="w-3.5 h-3.5" />
          <span>视觉破损识别</span>
        </button>
      </div>
    </div>
  );
};
