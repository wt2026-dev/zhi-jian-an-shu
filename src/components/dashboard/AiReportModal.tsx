import React from 'react';
import { Sparkles } from 'lucide-react';
import { AiResultModal } from '../ai/AiResultModal';
import { AiReport } from '../../api';

export interface AiReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportType: 'inspection' | 'maintenance' | 'monthly';
  setReportType: (type: 'inspection' | 'maintenance' | 'monthly') => void;
  reportRange: { start: string; end: string };
  setReportRange: React.Dispatch<React.SetStateAction<{ start: string; end: string }>>;
  reportState: {
    loading: boolean;
    error: string | null;
    degraded?: boolean;
    reviewId?: string | null;
    data?: AiReport | null;
  };
  onGenerateReport: () => void;
}

export const AiReportModal: React.FC<AiReportModalProps> = ({
  isOpen,
  onClose,
  reportType,
  setReportType,
  reportRange,
  setReportRange,
  reportState,
  onGenerateReport,
}) => {
  return (
    <AiResultModal
      open={isOpen}
      title="AI 智能报告生成 (基于真实业务数据聚合)"
      loading={reportState.loading}
      error={reportState.error}
      degraded={reportState.degraded}
      pendingReview={!!reportState.reviewId}
      data={reportState.data}
      onClose={onClose}
      configForm={
        <div className="space-y-4 text-xs">
          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-[11px] text-blue-700">
            系统将实时聚合所选范围内巡检/工单/设备健康/作业票真实落库数据，交由 AI 诊断引擎生成结构化报告。
          </div>
          <div>
            <label className="block text-slate-700 font-medium mb-1">报告类型</label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value as any)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-500 text-xs"
            >
              <option value="monthly">月度设备运行报告</option>
              <option value="inspection">巡检报告</option>
              <option value="maintenance">检修报告</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 font-medium mb-1">开始日期</label>
              <input
                type="date"
                value={reportRange.start}
                onChange={(e) => setReportRange({ ...reportRange, start: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-500 text-xs"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-medium mb-1">结束日期</label>
              <input
                type="date"
                value={reportRange.end}
                onChange={(e) => setReportRange({ ...reportRange, end: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-500 text-xs"
              />
            </div>
          </div>
          <button
            onClick={onGenerateReport}
            disabled={reportState.loading}
            className="w-full py-2.5 btn-gradient rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>生成报告</span>
          </button>
        </div>
      }
    />
  );
};
