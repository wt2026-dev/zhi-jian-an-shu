import React from 'react';
import { Check, CheckCircle2, Send, Wrench, X } from 'lucide-react';
import { Hazard } from '../../types';
import { getStatusBadge } from './hazardTypes';

interface HazardDetailDrawerProps {
  hazard: Hazard | null;
  canOperate: boolean;
  onClose: () => void;
  onAssign: (hazard: Hazard) => void;
  onRequestVerify: () => void;
  onVerify: (hazard: Hazard) => void;
}

export const HazardDetailDrawer: React.FC<HazardDetailDrawerProps> = ({
  hazard,
  canOperate,
  onClose,
  onAssign,
  onRequestVerify,
  onVerify,
}) => {
  if (!hazard) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-xl animate-in fade-in zoom-in-95">
        <div className="p-5 border-b border-slate-100 flex items-start justify-between">
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 font-semibold">
                {hazard.code}
              </span>
              {hazard.level === 'major' && (
                <span className="px-2 py-0.5 rounded bg-rose-600 text-white text-xs font-bold shadow-xs">
                  重大隐患 · 厂级督办
                </span>
              )}
              {getStatusBadge(hazard.status)}
            </div>
            <h3 className="text-base font-bold text-slate-900 mt-2">{hazard.title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              关联设备: {hazard.equipment_name || '公共区域'} · 区域: {hazard.location}
            </p>
          </div>

          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto space-y-4 text-xs">
          {/* Description */}
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 space-y-1.5">
            <span className="font-semibold text-slate-700 block">现场隐患征兆与风险特征描述</span>
            <p className="text-slate-600 leading-relaxed">{hazard.description}</p>
          </div>

          {/* Grid detail */}
          <div className="grid grid-cols-2 gap-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
            <div>
              <span className="text-slate-500 block">隐患分类</span>
              <span className="text-slate-800 font-semibold">{hazard.category}</span>
            </div>
            <div>
              <span className="text-slate-500 block">上报人 / 时间</span>
              <span className="text-slate-800">
                {hazard.reported_by} · {new Date(hazard.created_at).toLocaleDateString()}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">要求整改截止时限</span>
              <span className="text-orange-700 font-mono font-bold">{hazard.deadline || '即刻整改'}</span>
            </div>
            <div>
              <span className="text-slate-500 block">已下发工单</span>
              <span className="text-blue-700 font-mono font-semibold">
                {hazard.work_order_id ? `工单 #${hazard.work_order_id}` : '尚未下发工单'}
              </span>
            </div>
          </div>

          {/* Rectification Details (If any) */}
          {hazard.rectifier && (
            <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-200 space-y-1.5">
              <span className="font-semibold text-blue-900 block">整改消缺执行进度</span>
              <div className="text-slate-700">
                主修责任人: <span className="font-medium text-slate-900">{hazard.rectifier}</span>
              </div>
              {hazard.rectify_desc && (
                <div className="text-slate-700">消缺措施: {hazard.rectify_desc}</div>
              )}
              {hazard.rectified_at && (
                <div className="text-[11px] text-slate-500 font-mono">
                  完工提交时间: {new Date(hazard.rectified_at).toLocaleString()}
                </div>
              )}
            </div>
          )}

          {/* Verification Details (If Closed) */}
          {hazard.verifier && (
            <div className="bg-emerald-50/50 p-4 rounded-lg border border-emerald-200 space-y-1.5">
              <span className="font-semibold text-emerald-900 flex items-center">
                <CheckCircle2 className="w-4 h-4 mr-1 text-emerald-600" />
                复核验收闭环结论
              </span>
              <div className="text-slate-700">
                复核验收人: <span className="font-medium text-slate-900">{hazard.verifier}</span>
              </div>
              {hazard.verify_comment && (
                <div className="text-slate-700">复核评价: {hazard.verify_comment}</div>
              )}
            </div>
          )}
        </div>

        {/* Footer Action Bar */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200 shadow-xs cursor-pointer"
          >
            关闭
          </button>

          <div className="flex items-center space-x-2">
            {canOperate && hazard.status === 'pending' && (
              <button
                onClick={() => onAssign(hazard)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>一键派发整改工单</span>
              </button>
            )}

            {canOperate && hazard.status === 'rectifying' && (
              <button
                onClick={onRequestVerify}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer"
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>提请复核验收</span>
              </button>
            )}

            {canOperate && hazard.status === 'verifying' && (
              <button
                onClick={() => onVerify(hazard)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>复核验收闭环</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
