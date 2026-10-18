import React from 'react';
import { Loader2, Route, Plus } from 'lucide-react';
import { AiModelConfig } from '../../api';
import { TestResult } from './aiModelTypes';
import { AiModelCard } from './AiModelCard';

interface AiModelListProps {
  models: AiModelConfig[];
  loading: boolean;
  testing: string | null;
  acting: boolean;
  testResults: Record<string, TestResult>;
  onMove: (index: number, dir: -1 | 1) => void;
  onTest: (model: AiModelConfig) => void;
  onToggleEnabled: (model: AiModelConfig) => void;
  onEdit: (model: AiModelConfig) => void;
  onAddNew: () => void;
}

export const AiModelList: React.FC<AiModelListProps> = ({
  models,
  loading,
  testing,
  acting,
  testResults,
  onMove,
  onTest,
  onToggleEnabled,
  onEdit,
  onAddNew,
}) => {
  if (loading) {
    return (
      <div className="glass-card p-10 flex flex-col items-center text-slate-500 text-xs">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500 mb-2" />
        加载模型配置…
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {models.map((m, i) => (
        <AiModelCard
          key={m.id}
          model={m}
          index={i}
          total={models.length}
          testResult={testResults[m.id]}
          isTesting={testing === m.id}
          isActing={acting}
          onMove={onMove}
          onTest={onTest}
          onToggleEnabled={onToggleEnabled}
          onEdit={onEdit}
        />
      ))}
      {models.length === 0 && (
        <div className="glass-card p-10 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <Route className="w-6 h-6" />
          </div>
          <p className="text-sm font-bold text-slate-800">暂无模型配置</p>
          <p className="text-xs text-slate-500 mt-2 max-w-xl mx-auto leading-relaxed">
            点击右上角「<span className="font-semibold text-slate-700">新增模型</span>」接入 OpenAI 兼容接口（如{' '}
            <span className="font-semibold text-blue-700">DeepSeek</span>、
            <span className="font-semibold text-blue-700">通义千问</span>、
            <span className="font-semibold text-blue-700">智谱 GLM</span>、
            <span className="font-semibold text-blue-700">讯飞星火</span>
            ）；不配置时 AI 调用自动回退使用环境变量{' '}
            <code className="font-mono text-blue-600 bg-slate-100 px-1 py-0.5 rounded">
              DASHSCOPE_*
            </code>
            。
          </p>
          <div className="mt-4">
            <button
              type="button"
              onClick={onAddNew}
              className="inline-flex items-center px-4 py-2 rounded-lg btn-gradient text-white text-xs font-semibold cursor-pointer hover:shadow-md transition-all"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              <span>新增模型配置</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
