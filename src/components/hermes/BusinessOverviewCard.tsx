import React from 'react';
import {
  Sparkles,
  Archive,
  Clock,
  User,
  Cpu,
  Loader2,
  Copy
} from 'lucide-react';
import type { BusinessClosedLoopData } from './types';
import { useToast } from '../../context/ToastContext';

interface BusinessOverviewCardProps {
  data: BusinessClosedLoopData;
  /** 闭环状态取自服务端 business_loops.status，不在前端另造状态机 */
  status: BusinessClosedLoopData['status'];
  canOperate: boolean;
  busy?: boolean;
  onNewGoal: () => void;
  onArchive: () => void;
  onSelectStage: (stageIndex: number) => void;
}

export const BusinessOverviewCard: React.FC<BusinessOverviewCardProps> = ({
  data,
  status,
  canOperate,
  busy,
  onNewGoal,
  onArchive,
  onSelectStage,
}) => {
  const { show: showToast } = useToast();

  const completedCount = data.stages.filter((s) => s.status === 'completed').length;
  const currentStage = data.stages.find((s) => s.status === 'in_progress') || data.stages[data.stages.length - 1];
  const percent = Math.round((completedCount / data.stages.length) * 100);

  const handleCopyCode = () => {
    navigator.clipboard?.writeText(data.loopCode);
    showToast({
      type: 'success',
      title: '已复制闭环编号',
      message: `${data.loopCode} 已写入剪贴板`,
      duration: 2500,
    });
  };

  const statusMeta =
    status === 'archived'
      ? { text: '已归档', dot: 'bg-slate-400', tone: 'text-slate-600 bg-slate-100 border-slate-200/70' }
      : status === 'paused'
        ? { text: '已暂停', dot: 'bg-amber-500', tone: 'text-amber-700 bg-amber-50 border-amber-200/70' }
        : { text: '闭环进行中', dot: 'bg-emerald-500 animate-pulse', tone: 'text-emerald-600 bg-emerald-50 border-emerald-200/60' };

  return (
    <div className="relative overflow-hidden rounded-2xl bg-white/95 border border-slate-200/90 shadow-sm p-4 sm:p-5 lg:p-6 backdrop-blur-md">
      {/* 顶部微光装饰条 */}
      <div 
        className="absolute top-0 left-0 right-0 h-1"
        style={{
          background: 'linear-gradient(90deg, #E8A33D 0%, #0EA5E9 50%, #2563EB 100%)',
        }}
      />

      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5">
        {/* 左侧：目标与设备关键标识 */}
        <div className="flex-1 min-w-0 space-y-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span 
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-bold text-amber-900 border"
              style={{
                backgroundColor: 'rgba(232, 163, 61, 0.15)',
                borderColor: 'rgba(232, 163, 61, 0.35)',
              }}
            >
              <Sparkles className="w-3.5 h-3.5 text-[#E8A33D]" />
              业务目标
            </span>
            <span className="font-mono text-xs text-slate-500 bg-slate-100/90 px-2 py-0.5 rounded border border-slate-200/70 flex items-center gap-1">
              <span>{data.loopCode}</span>
              <button 
                type="button" 
                onClick={handleCopyCode}
                title="复制闭环编号"
                className="hover:text-blue-600 transition-colors cursor-pointer"
              >
                <Copy className="w-3 h-3" />
              </button>
            </span>
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${statusMeta.tone}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />
              {statusMeta.text}
            </span>
          </div>

          <div className="space-y-1">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <span>「{data.businessGoal}」</span>
            </h2>
            <div className="flex items-center gap-3 sm:gap-4 text-xs text-slate-500 flex-wrap">
              <span className="flex items-center gap-1.5 font-medium text-slate-700">
                <Cpu className="w-3.5 h-3.5 text-blue-600" />
                {data.equipment.name}
                <span className="text-[11px] font-mono text-slate-400">({data.equipment.code})</span>
              </span>
              <span className="text-slate-300">|</span>
              <span className="flex items-center gap-1 text-slate-600">
                <User className="w-3.5 h-3.5 text-slate-400" />
                发起人：<span className="font-medium text-slate-800">{data.initiator.name}</span>
                <span className="text-slate-400">({data.initiator.role})</span>
              </span>
              <span className="text-slate-300">|</span>
              <span className="flex items-center gap-1 text-slate-600">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                时间：{data.initiator.time}
              </span>
            </div>
          </div>
        </div>

        {/* 中间：闭环流转进度与用时预估 */}
        <div className="w-full lg:w-72 shrink-0 p-3.5 rounded-xl bg-slate-50/90 border border-slate-200/80 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-600 font-medium flex items-center gap-1">
              <span>环节流转</span>
              <span className="font-bold text-blue-600 font-mono">
                {completedCount}/{data.stages.length}
              </span>
              <span className="text-slate-400">({percent}%)</span>
            </span>
            <span className="text-[11px] text-slate-500 flex items-center gap-1">
              <Clock className="w-3 h-3 text-slate-400" />
              预计总用时 <strong className="text-slate-700 font-mono">{data.progress.estimatedTotalHours}h</strong>
            </span>
          </div>

          {/* 进度条 */}
          <div className="w-full bg-slate-200/80 h-2.5 rounded-full overflow-hidden p-0.5">
            <div 
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${percent}%`,
                background: 'linear-gradient(90deg, #E8A33D 0%, #0EA5E9 70%, #2563EB 100%)',
              }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
          {currentStage && currentStage.status !== 'completed' ? (
            <button
              type="button"
              onClick={() => onSelectStage(currentStage.order - 1)}
              className="text-blue-700 font-medium truncate text-left hover:text-blue-900 hover:underline underline-offset-2 transition-colors cursor-pointer"
              title="跳到该环节工作台"
            >
              当前：{currentStage.order}. {currentStage.title}
            </button>
          ) : (
            <span className="text-slate-500 truncate">当前：全部环节已确认</span>
          )}
            <span className="text-slate-400 shrink-0">
              剩余 {data.stages.length - completedCount} 环节待推进
            </span>
          </div>
        </div>

        {/* 右侧：快捷操作区 */}
        <div className="flex items-center gap-2 self-stretch lg:self-center justify-end shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100">
          <button
            type="button"
            onClick={onNewGoal}
            disabled={!canOperate}
            className="flex-1 lg:flex-none inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-sm hover:shadow transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            title={canOperate ? '新建业务目标并编排六环节' : '当前角色无新建闭环权限'}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>新建业务目标</span>
          </button>


          <button
            type="button"
            onClick={onArchive}
            disabled={!canOperate || status === 'archived' || Boolean(busy)}
            className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              status === 'archived'
                ? '该闭环已归档'
                : canOperate
                  ? '沉淀归档（生成质检报告与知识条目）'
                  : '当前角色无归档权限'
            }
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />
            ) : (
              <Archive className="w-3.5 h-3.5 text-slate-500" />
            )}
            <span>{status === 'archived' ? '已归档' : '归档'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
