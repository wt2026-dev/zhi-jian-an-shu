import React, { useState } from 'react';
import { 
  History, 
  CheckCircle2, 
  Clock, 
  FileBox, 
  BookOpen, 
  ExternalLink,
  ChevronRight,
  X,
  FileCheck
} from 'lucide-react';
import type { HistoryLoopItem } from './demoData';
import { useToast } from '../../context/ToastContext';

interface HistoryLoopsProps {
  historyLoops: HistoryLoopItem[];
}

export const HistoryLoops: React.FC<HistoryLoopsProps> = ({ historyLoops }) => {
  const { show: showToast } = useToast();
  const [selectedHistory, setSelectedHistory] = useState<HistoryLoopItem | null>(null);

  const handleOpenDetail = (item: HistoryLoopItem) => {
    setSelectedHistory(item);
  };

  return (
    <div className="rounded-2xl bg-white/95 border border-slate-200/90 shadow-sm p-4 sm:p-5 backdrop-blur-md flex flex-col justify-between space-y-3.5">
      {/* 标题 */}
      <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-emerald-50 text-emerald-600">
            <History className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-800 tracking-tight">近期已归档业务闭环</h3>
            <p className="text-[11px] text-slate-400">已形成工业标准案例沉淀至企业知识库</p>
          </div>
        </div>

        <span className="text-[11px] text-emerald-600 font-medium">
          闭环归档率 100%
        </span>
      </div>

      {/* 3 条历史记录列表 */}
      <div className="space-y-2.5">
        {historyLoops.map((item) => (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            onClick={() => handleOpenDetail(item)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleOpenDetail(item);
              }
            }}
            className="p-3 rounded-xl border border-slate-200/80 bg-slate-50/50 hover:bg-white hover:border-slate-300 hover:shadow-2xs transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 group"
          >
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[10px] text-slate-500 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                  {item.loopCode}
                </span>
                <span className="text-xs font-bold text-slate-800 group-hover:text-blue-600 transition-colors">
                  {item.targetGoal}
                </span>
                <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200/60">
                  已归档
                </span>
              </div>

              <div className="flex items-center gap-3 text-[11px] text-slate-400 flex-wrap">
                <span>设备：<strong className="text-slate-600 font-normal">{item.equipmentName}</strong></span>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-slate-400" />
                  总耗时 <strong className="text-slate-700 font-mono font-normal">{item.duration}</strong>
                </span>
                <span>·</span>
                <span>负责人：{item.leadUser}</span>
              </div>
            </div>

            <div className="flex items-center gap-2.5 self-end sm:self-center shrink-0 text-xs">
              <div className="text-right hidden sm:block">
                <div className="text-[10px] text-slate-400 font-mono">
                  {item.closedDate}
                </div>
                <div className="text-[10px] text-indigo-600 font-medium">
                  产出资料 {item.artifactCount} 项 · 采纳知识 {item.knowledgeCount} 条
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-600 transition-colors" />
            </div>
          </div>
        ))}
      </div>

      {/* 历史记录复盘弹窗 */}
      {selectedHistory && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700">
                  <FileCheck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{selectedHistory.targetGoal}</h3>
                  <p className="text-[11px] font-mono text-slate-500">{selectedHistory.loopCode}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedHistory(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600">
              <div className="grid grid-cols-2 gap-2 text-slate-700">
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                  <span className="text-[11px] text-slate-400 block">闭环设备</span>
                  <span className="font-semibold text-slate-800">{selectedHistory.equipmentName}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                  <span className="text-[11px] text-slate-400 block">全流程耗时</span>
                  <span className="font-semibold text-blue-600 font-mono">{selectedHistory.duration}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                  <span className="text-[11px] text-slate-400 block">主导人</span>
                  <span className="font-semibold text-slate-800">{selectedHistory.leadUser}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                  <span className="text-[11px] text-slate-400 block">归档时间</span>
                  <span className="font-semibold text-slate-800 font-mono">{selectedHistory.closedDate}</span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-indigo-50/50 border border-indigo-100 space-y-1">
                <div className="font-bold text-indigo-900">闭环知识包提炼</div>
                <p className="text-slate-600 leading-relaxed">
                  已沉淀 {selectedHistory.knowledgeCount} 条专家排障经验到知识中心，并在该设备档案树生成关联卡片。
                </p>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedHistory(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
