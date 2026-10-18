import React from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Loader2,
  PlugZap,
  Power,
  XCircle,
} from 'lucide-react';
import { AiModelConfig } from '../../api';
import { CAP_LABELS, HEALTH_META, TestResult } from './aiModelTypes';

interface AiModelCardProps {
  model: AiModelConfig;
  index: number;
  total: number;
  testResult?: TestResult;
  isTesting: boolean;
  isActing: boolean;
  onMove: (index: number, dir: -1 | 1) => void;
  onTest: (model: AiModelConfig) => void;
  onToggleEnabled: (model: AiModelConfig) => void;
  onEdit: (model: AiModelConfig) => void;
}

export const AiModelCard: React.FC<AiModelCardProps> = ({
  model,
  index,
  total,
  testResult,
  isTesting,
  isActing,
  onMove,
  onTest,
  onToggleEnabled,
  onEdit,
}) => {
  const hm = HEALTH_META[model.healthStatus] || HEALTH_META.unknown;

  return (
    <div
      className={`glass-card p-4 shadow-sm flex items-start justify-between gap-3 border-l-4 ${
        model.enabled ? 'border-l-blue-500' : 'border-l-slate-300 opacity-70'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[10px] text-slate-500 font-bold">#{index + 1}</span>
          <span className="text-sm font-bold text-slate-900">{model.displayName}</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${hm.cls}`}>
            {hm.label}
          </span>
          {model.capabilities.map((c) => (
            <span
              key={c}
              className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-semibold"
            >
              {CAP_LABELS[c] || c}
            </span>
          ))}
          {!model.enabled && (
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200 text-[10px] font-semibold">
              已停用
            </span>
          )}
        </div>
        <p className="mt-1 text-[11px] text-slate-500 font-mono truncate">
          {model.provider} · {model.modelName} · {model.baseUrl}
        </p>
        <p className="mt-0.5 text-[10px] text-slate-500 font-mono">
          密钥：{model.apiKeyMasked}
          {model.lastCheckedAt
            ? ` · 最近检测 ${new Date(model.lastCheckedAt).toLocaleString('zh-CN')}`
            : ''}
        </p>
        {testResult && (
          <p
            className={`mt-1 text-[11px] flex items-center ${
              testResult.ok ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            {testResult.ok ? (
              <CheckCircle2 className="w-3 h-3 mr-1 shrink-0" />
            ) : (
              <XCircle className="w-3 h-3 mr-1 shrink-0" />
            )}
            {testResult.ok
              ? `连接正常，耗时 ${testResult.latencyMs}ms`
              : `连接失败：${testResult.error}`}
          </p>
        )}
      </div>

      {/* 操作区：排序 / 测试 / 启停 / 编辑 */}
      <div className="flex flex-col gap-1.5 shrink-0">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => onMove(index, -1)}
            disabled={index === 0}
            className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-blue-600 cursor-pointer disabled:opacity-40"
            title="提高优先级"
            aria-label={`提高 ${model.displayName} 优先级`}
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onMove(index, 1)}
            disabled={index === total - 1}
            className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-blue-600 cursor-pointer disabled:opacity-40"
            title="降低优先级"
            aria-label={`降低 ${model.displayName} 优先级`}
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => onTest(model)}
          disabled={isTesting}
          className="px-2.5 py-1.5 rounded-lg bg-white border border-blue-200 text-blue-600 hover:bg-blue-50 text-[11px] font-semibold cursor-pointer disabled:opacity-60 flex items-center justify-center"
        >
          {isTesting ? (
            <Loader2 className="w-3 h-3 animate-spin mr-1" />
          ) : (
            <PlugZap className="w-3 h-3 mr-1" />
          )}
          测试连接
        </button>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => onToggleEnabled(model)}
            disabled={isActing}
            className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer disabled:opacity-60 flex items-center justify-center border ${
              model.enabled
                ? 'bg-white border-slate-200 text-slate-600 hover:text-rose-600'
                : 'bg-emerald-50 border-emerald-200 text-emerald-700'
            }`}
            title={model.enabled ? '停用该模型' : '启用该模型'}
          >
            <Power className="w-3 h-3 mr-1" />
            {model.enabled ? '停用' : '启用'}
          </button>
          <button
            type="button"
            onClick={() => onEdit(model)}
            className="flex-1 px-2 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-blue-600 text-[11px] font-semibold cursor-pointer"
          >
            编辑
          </button>
        </div>
      </div>
    </div>
  );
};
