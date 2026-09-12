import React, { useState, useEffect } from 'react';
import { X, Sparkles, Loader2, AlertTriangle, Wrench } from 'lucide-react';
import { workOrderApi } from '../../api';
import { WorkOrder } from '../../types';
import { renderAiValue } from './AiResultModal';

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: '紧急' },
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
];

const FAULT_TYPES = ['机械振动', '轴承过热', '电气短路', '密封泄漏', '结构磨损', '控制系统异常', '定期润滑维保'];

interface AiWorkOrderDraftModalProps {
  open: boolean;
  title: string;
  loading: boolean;
  error: string | null;
  degraded?: boolean;
  draft?: {
    title: string;
    description: string;
    priority: 'urgent' | 'high' | 'medium' | 'low';
    priorityReason?: string;
    suggestedSteps?: string[];
    spareParts?: { name: string; spec: string; qty: number }[];
    estimatedHours?: number;
  } | null;
  equipment?: { id: string; name: string; code: string; workshop: string } | null;
  operatorName: string;
  onClose: () => void;
  onCreated: (wo: WorkOrder) => void;
}

/**
 * 功能 1：AI 生成工单草稿 → 用户确认编辑后一键创建真实工单 (workOrderApi.create 落库)
 */
export const AiWorkOrderDraftModal: React.FC<AiWorkOrderDraftModalProps> = ({
  open,
  title,
  loading,
  error,
  degraded,
  draft,
  equipment,
  operatorName,
  onClose,
  onCreated,
}) => {
  const [form, setForm] = useState({ title: '', description: '', priority: 'high' as any, faultType: '机械振动' as any });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (draft) {
      setForm({
        title: draft.title || '',
        description: draft.description || '',
        priority: draft.priority || 'high',
        faultType: '机械振动',
      });
      setSubmitError(null);
    }
  }, [draft]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.description.trim() || !equipment) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await workOrderApi.create({
        title: form.title,
        equipmentId: equipment.id,
        faultType: form.faultType,
        priority: form.priority,
        description: form.description,
        creator: operatorName,
        forceSubmit: true,
      });
      onCreated(created);
      onClose();
    } catch (err: any) {
      setSubmitError(err?.message || '创建工单失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl max-w-2xl w-full max-h-[88vh] flex flex-col shadow-2xl shadow-cyan-950/40">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 rounded-lg bg-gradient-to-tr from-cyan-600 to-blue-500">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <h3 className="text-sm font-bold text-slate-100">{title}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && (
            <div className="flex flex-col items-center justify-center py-14 space-y-3 text-slate-400">
              <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
              <p className="text-xs font-medium">AI 正在结合设备档案与历史工单生成工单草稿，请稍候 (约 10~30 秒)...</p>
            </div>
          )}

          {!loading && error && (
            <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/40 space-y-2">
              <div className="flex items-center space-x-2 text-rose-300 text-xs font-semibold">
                <AlertTriangle className="w-4 h-4" />
                <span>{degraded ? 'AI 功能暂不可用' : 'AI 调用失败'}</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{error}</p>
            </div>
          )}

          {!loading && !error && draft && equipment && (
            <>
              <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-500/30 text-[11px] text-cyan-200">
                AI 已基于设备档案与历史工单生成草稿，请确认或修改以下内容后创建真实工单。
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">工单标题 *</label>
                  <input
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-400 mb-1">优先级</label>
                    <select
                      value={form.priority}
                      onChange={(e) => setForm({ ...form, priority: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
                    >
                      {PRIORITY_OPTIONS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">故障类型</label>
                    <select
                      value={form.faultType}
                      onChange={(e) => setForm({ ...form, faultType: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
                    >
                      {FAULT_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">关联设备</label>
                    <div className="px-3 py-2 bg-slate-800/60 border border-slate-700 rounded-lg text-slate-300 truncate">
                      {equipment.name}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">故障描述 *</label>
                  <textarea
                    rows={4}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
                  />
                </div>
                {draft.priorityReason && (
                  <div>
                    <div className="text-[10px] font-bold text-cyan-400/90 uppercase tracking-wide mb-0.5">优先级评定理由</div>
                    <p className="text-xs text-slate-300">{draft.priorityReason}</p>
                  </div>
                )}
                {draft.suggestedSteps && draft.suggestedSteps.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold text-cyan-400/90 uppercase tracking-wide mb-1">AI 建议检修步骤</div>
                    {renderAiValue(draft.suggestedSteps)}
                  </div>
                )}
                {draft.spareParts && draft.spareParts.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold text-cyan-400/90 uppercase tracking-wide mb-1">AI 建议备件清单 {draft.estimatedHours ? `· 预计工时 ${draft.estimatedHours}h` : ''}</div>
                    {renderAiValue(draft.spareParts)}
                  </div>
                )}
                {submitError && (
                  <div className="p-2.5 rounded-lg bg-rose-950/50 border border-rose-500/40 text-[11px] text-rose-300">{submitError}</div>
                )}
              </div>
            </>
          )}
        </div>

        {!loading && !error && draft && (
          <div className="px-5 py-3 border-t border-slate-800 shrink-0 flex items-center justify-end space-x-2">
            <button onClick={onClose} className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-xs">
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || !form.title.trim() || !form.description.trim()}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
              <span>{submitting ? '创建中...' : '确认创建工单'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
