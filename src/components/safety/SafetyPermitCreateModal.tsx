import React from 'react';
import { Plus, X, Sparkles } from 'lucide-react';
import { Equipment, RiskLevel, SafetyPermit } from '../../types';

interface SafetyPermitCreateModalProps {
  open: boolean;
  equipments: Equipment[];
  formData: {
    permitType: SafetyPermit['permitType'];
    riskLevel: RiskLevel;
    title: string;
    equipmentId: string;
    workshop: string;
    location: string;
    precautions: string[];
    lotoNumber: string;
    validUntil: string;
  };
  isSubmittingPermit: boolean;
  submitError: string | null;
  onChangeFormData: React.Dispatch<
    React.SetStateAction<{
      permitType: SafetyPermit['permitType'];
      riskLevel: RiskLevel;
      title: string;
      equipmentId: string;
      workshop: string;
      location: string;
      precautions: string[];
      lotoNumber: string;
      validUntil: string;
    }>
  >;
  onSubmit: (e: React.FormEvent) => void;
  onAssessFromForm: () => void;
  onClose: () => void;
}

export const SafetyPermitCreateModal: React.FC<SafetyPermitCreateModalProps> = ({
  open,
  equipments,
  formData,
  isSubmittingPermit,
  submitError,
  onChangeFormData,
  onSubmit,
  onAssessFromForm,
  onClose,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <form
        onSubmit={onSubmit}
        className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 card-industrial"
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-800 flex items-center">
            <Plus className="w-4 h-4 mr-1.5 text-purple-600" />
            申请工业高危安全作业票 (SOP 审查)
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 mb-1 font-medium">作业票类型 *</label>
              <select
                value={formData.permitType}
                onChange={(e) =>
                  onChangeFormData((prev) => ({
                    ...prev,
                    permitType: e.target.value as SafetyPermit['permitType'],
                  }))
                }
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-purple-500 focus:bg-white"
              >
                <option value="动火作业票">动火作业票</option>
                <option value="受限空间作业票">受限空间作业票</option>
                <option value="高处作业票">高处作业票</option>
                <option value="LOTO停电上锁票">LOTO停电上锁票</option>
                <option value="临时用电作业票">临时用电作业票</option>
                <option value="吊装作业票">吊装作业票</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-700 mb-1 font-medium">风险辨识等级 *</label>
              <select
                value={formData.riskLevel}
                onChange={(e) =>
                  onChangeFormData((prev) => ({
                    ...prev,
                    riskLevel: e.target.value as RiskLevel,
                  }))
                }
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-purple-500 focus:bg-white"
              >
                <option value="极大风险 (Level 1)">🔴 极大风险 (Level 1)</option>
                <option value="较大风险 (Level 2)">🟠 较大风险 (Level 2)</option>
                <option value="一般风险 (Level 3)">🟡 一般风险 (Level 3)</option>
                <option value="低风险 (Level 4)">🔵 低风险 (Level 4)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-slate-700 mb-1 font-medium">作业任务标题 *</label>
            <input
              type="text"
              required
              placeholder="例如: 动力站主蒸汽管线更换二道截止阀气割作业"
              value={formData.title}
              onChange={(e) => onChangeFormData((prev) => ({ ...prev, title: e.target.value }))}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:bg-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 mb-1 font-medium">所属车间工段</label>
              <select
                value={formData.workshop}
                onChange={(e) => onChangeFormData((prev) => ({ ...prev, workshop: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-purple-500 focus:bg-white"
              >
                <option value="一号动力车间">一号动力车间</option>
                <option value="二号机加车间">二号机加车间</option>
                <option value="智能装配线">智能装配线</option>
                <option value="储运与气体动力站">储运与气体动力站</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-700 mb-1 font-medium">关联作业设备</label>
              <select
                value={formData.equipmentId}
                onChange={(e) => onChangeFormData((prev) => ({ ...prev, equipmentId: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-purple-500 focus:bg-white"
              >
                {equipments.map((eq) => (
                  <option key={eq.id} value={eq.id}>
                    {eq.name} ({eq.code})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="permit-valid-until" className="block text-slate-700 mb-1 font-medium">有效截止时限（本地时间） *</label>
            <input
              id="permit-valid-until"
              type="datetime-local"
              required
              disabled={isSubmittingPermit}
              value={formData.validUntil}
              onChange={(e) => onChangeFormData((prev) => ({ ...prev, validUntil: e.target.value }))}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-purple-500"
            />
            <p className="mt-1 text-slate-500">必须晚于当前时间，提交时转换为 ISO 时间。</p>
          </div>

          <div>
            <label className="block text-slate-700 mb-1 font-medium">LOTO 安全锁号 (如涉及电气/机械隔离)</label>
            <input
              type="text"
              placeholder="例如: LOCK-RED-8820"
              value={formData.lotoNumber}
              onChange={(e) => onChangeFormData((prev) => ({ ...prev, lotoNumber: e.target.value }))}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:bg-white font-mono"
            />
          </div>
        </div>

        {submitError && open && (
          <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-[11px] text-rose-700">
            {submitError}
          </div>
        )}

        <button
          type="button"
          onClick={onAssessFromForm}
          className="w-full py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 cursor-pointer transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>AI 风险评估 (JSA 作业安全分析)</span>
        </button>

        <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs hover:bg-slate-200 font-medium"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={isSubmittingPermit}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
          >
            {isSubmittingPermit ? '提交中...' : '提交安全审批流'}
          </button>
        </div>
      </form>
    </div>
  );
};
