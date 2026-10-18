import React from 'react';
import {
  ClipboardList,
  FileVideo,
  Video,
  Film,
  Sparkles,
  Loader2,
  Filter,
} from 'lucide-react';
import { MaintenanceProcedure } from '../../types';

export const EQUIPMENT_TYPES = ['all', '电机', '空压机', '风机', '水泵', '输送带'];
export const MAINTENANCE_LEVELS = ['all', '日常保养', '一级检修', '二级检修'];

interface ProceduresHeaderProps {
  activeProcedure?: MaintenanceProcedure | null;
  generatingScript: boolean;
  generatingVideo: boolean;
  videoDuration: number;
  selectedType: string;
  selectedLevel: string;
  onSelectType: (type: string) => void;
  onSelectLevel: (level: string) => void;
  onSetVideoDuration: (duration: number) => void;
  onOpenScriptModal: () => void;
  onGenerateRealVideo: () => void;
  onGenerateFullVideo: () => void;
}

export const ProceduresHeader: React.FC<ProceduresHeaderProps> = ({
  activeProcedure,
  generatingScript,
  generatingVideo,
  videoDuration,
  selectedType,
  selectedLevel,
  onSelectType,
  onSelectLevel,
  onSetVideoDuration,
  onOpenScriptModal,
  onGenerateRealVideo,
  onGenerateFullVideo,
}) => {
  return (
    <div className="shrink-0 z-10 border-b border-slate-200 sticky top-0 pb-4 mb-4 space-y-4">
      {/* 顶部标题与视频分镜总控 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shadow-xs border border-blue-200 shrink-0">
              <ClipboardList className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                工业标准化检修作业指引 (SOP)
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-mono font-medium">
                  强制合规互锁
                </span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                流程步骤分解 · 工具物料清单 · 安全红线防护 · AI视频实操生成
              </p>
            </div>
          </div>
        </div>

        {/* 顶部动作区 */}
        <div className="flex items-center gap-3">
          {activeProcedure && (
            <>
              {/* 次要入口：查看文字分镜 */}
              <button
                type="button"
                onClick={onOpenScriptModal}
                disabled={generatingScript}
                className="flex items-center space-x-1.5 px-3 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-medium shadow-xs transition-all cursor-pointer disabled:opacity-50"
                title="查看与播放基于语音合成的文字分镜脚本"
              >
                <FileVideo className="w-3.5 h-3.5 text-slate-500" />
                <span>{generatingScript ? '分镜生成中...' : '查看文字分镜'}</span>
              </button>

              {/* 视频时长选择（Agnes 免费上限 18 秒） */}
              <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1">
                {[10, 15, 18].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => onSetVideoDuration(d)}
                    disabled={generatingVideo}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer disabled:opacity-50 ${
                      videoDuration === d
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                    title={`生成约 ${d} 秒视频`}
                  >
                    {d}s
                  </button>
                ))}
              </div>

              {/* 主按钮：生成视频讲解 (主色蓝，调用 Agnes AI) */}
              <button
                type="button"
                onClick={onGenerateRealVideo}
                disabled={generatingVideo}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title="调用 Agnes AI 免费模型生成完整连贯真实视频"
              >
                {generatingVideo ? (
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                ) : (
                  <Video className="w-4 h-4 text-white" />
                )}
                <span>{generatingVideo ? `视频生成中(${videoDuration}s)...` : `生成${videoDuration}秒视频讲解`}</span>
                <Sparkles className="w-3.5 h-3.5 text-cyan-200 animate-pulse" />
              </button>

              {/* 完整讲解视频：按步骤分段拍摄 + 自动拼接（带声音） */}
              <button
                type="button"
                onClick={onGenerateFullVideo}
                disabled={generatingVideo}
                className="flex items-center space-x-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title="按步骤分段生成多段连贯视频镜头，自动拼接并保留原生中文配音与工业音效（预计 10-25 分钟）"
              >
                {generatingVideo ? (
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                ) : (
                  <Film className="w-4 h-4 text-white" />
                )}
                <span>生成完整讲解视频</span>
                <span className="px-1.5 py-0.5 bg-white/20 rounded-md text-[10px]">多段·配音</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* 筛选过滤工具栏 */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 text-xs pb-4">
        <div className="flex items-center gap-2">
          <span className="text-slate-600 flex items-center gap-1 font-medium whitespace-nowrap">
            <Filter className="w-3.5 h-3.5 text-blue-600" /> 设备类型
          </span>
          <div className="flex gap-1.5">
            {EQUIPMENT_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onSelectType(t)}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                  selectedType === t
                    ? 'bg-blue-600 text-white font-semibold shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                }`}
              >
                {t === 'all' ? '全部' : t}
              </button>
            ))}
          </div>
        </div>

        <div className="w-px h-4 bg-slate-200 shrink-0 hidden sm:block" />

        <div className="flex items-center gap-2">
          <span className="text-slate-600 font-medium whitespace-nowrap">检修等级</span>
          <div className="flex gap-1.5">
            {MAINTENANCE_LEVELS.map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => onSelectLevel(lvl)}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                  selectedLevel === lvl
                    ? 'bg-blue-600 text-white font-semibold shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                }`}
              >
                {lvl === 'all' ? '全部' : lvl}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
