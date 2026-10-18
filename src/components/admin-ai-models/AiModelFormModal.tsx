import React from 'react';
import { Route, Loader2, CheckCircle2 } from 'lucide-react';
import { AiModelConfig } from '../../api';
import { CapabilityType, CAP_LABELS, ModelFormData } from './aiModelTypes';

interface AiModelFormModalProps {
  isOpen: boolean;
  editing: AiModelConfig | null;
  form: ModelFormData;
  acting: boolean;
  onClose: () => void;
  onSave: () => void;
  onChangeField: <K extends keyof ModelFormData>(field: K, value: ModelFormData[K]) => void;
  onToggleCap: (cap: CapabilityType) => void;
}

const CAP_OPTIONS: CapabilityType[] = ['chat', 'vision', 'video'];

export const AiModelFormModal: React.FC<AiModelFormModalProps> = ({
  isOpen,
  editing,
  form,
  acting,
  onClose,
  onSave,
  onChangeField,
  onToggleCap,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md glass-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-slate-800 flex items-center mb-3">
          <Route className="w-4 h-4 mr-1.5 text-blue-600" />
          {editing ? '编辑模型配置' : '新增模型配置'}
        </h3>
        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-slate-500 block mb-1">Provider *</label>
              <input
                value={form.provider}
                onChange={(e) => onChangeField('provider', e.target.value)}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="dashscope / openai / deepseek…"
              />
            </div>
            <div>
              <label className="text-slate-500 block mb-1">显示名称 *</label>
              <input
                value={form.displayName}
                onChange={(e) => onChangeField('displayName', e.target.value)}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="如：DeepSeek V3（备用）"
              />
            </div>
          </div>
          <div>
            <label className="text-slate-500 block mb-1">模型名（model）*</label>
            <input
              value={form.modelName}
              onChange={(e) => onChangeField('modelName', e.target.value)}
              className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
              placeholder="如：deepseek-chat / qwen-plus"
            />
          </div>
          <div>
            <label className="text-slate-500 block mb-1">Base URL（OpenAI 兼容）</label>
            <input
              value={form.baseUrl}
              onChange={(e) => onChangeField('baseUrl', e.target.value)}
              className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-slate-500 block mb-1">API Key（明文，加密入库）</label>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => {
                  onChangeField('apiKey', e.target.value);
                  onChangeField('apiKeyEnv', '');
                }}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="留空则不修改"
              />
            </div>
            <div>
              <label className="text-slate-500 block mb-1">或引用环境变量名</label>
              <input
                value={form.apiKeyEnv}
                onChange={(e) => {
                  onChangeField('apiKeyEnv', e.target.value);
                  onChangeField('apiKey', '');
                }}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="DASHSCOPE_API_KEY"
              />
            </div>
          </div>
          <div>
            <label className="text-slate-500 block mb-1">能力（多选）</label>
            <div className="flex gap-2">
              {CAP_OPTIONS.map((cap) => (
                <button
                  key={cap}
                  type="button"
                  onClick={() => onToggleCap(cap)}
                  className={`px-3 py-1.5 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                    form.capabilities.includes(cap)
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-white border-slate-200 text-slate-500'
                  }`}
                >
                  {CAP_LABELS[cap]}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center space-x-2 text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => onChangeField('enabled', e.target.checked)}
              className="rounded"
            />
            <span>启用该模型（参与路由与降级）</span>
          </label>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={acting}
            className="flex-1 py-2.5 rounded-lg btn-gradient text-xs font-semibold text-white cursor-pointer disabled:opacity-60 flex items-center justify-center"
          >
            {acting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
            )}
            保存
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs font-semibold cursor-pointer"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
};
