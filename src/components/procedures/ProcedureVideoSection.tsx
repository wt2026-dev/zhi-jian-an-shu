import React from 'react';
import {
  Film,
  RefreshCw,
  Loader2,
  CheckCircle2,
  X,
  AlertTriangle,
  ExternalLink,
  Trash2,
} from 'lucide-react';
import { ProcedureVideo } from '../../types';
import { INTERNAL_STATUS_MAP } from './useProcedureVideos';
import { formatElapsed } from '../../utils/videoProgress';

interface ProcedureVideoSectionProps {
  generatingVideo: boolean;
  videoStatusText: string | null;
  videoError: string | null;
  videoSuccessNotice: string | null;
  currentTaskId: string | null;
  currentActiveVideoUrl: string | null;
  historyVideos: ProcedureVideo[];
  loadingVideos: boolean;
  internalStatus: string | null;
  elapsedSec: number | null;
  progressPct: number | null;
  canDeleteVideo: boolean;
  onRefreshVideos: () => void;
  onCancelVideoTask: () => void;
  onDismissSuccessNotice: () => void;
  onRetryGenerate: () => void;
  onSelectVideoUrl: (url: string) => void;
  onDeleteVideo: (id: string) => void;
}

export const ProcedureVideoSection: React.FC<ProcedureVideoSectionProps> = ({
  generatingVideo,
  videoStatusText,
  videoError,
  videoSuccessNotice,
  currentActiveVideoUrl,
  historyVideos,
  loadingVideos,
  internalStatus,
  elapsedSec,
  progressPct,
  canDeleteVideo,
  onRefreshVideos,
  onCancelVideoTask,
  onDismissSuccessNotice,
  onRetryGenerate,
  onSelectVideoUrl,
  onDeleteVideo,
}) => {
  const shouldRender =
    generatingVideo ||
    videoStatusText ||
    videoError ||
    currentActiveVideoUrl ||
    historyVideos.length > 0;

  if (!shouldRender) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Film className="w-4 h-4 text-blue-500" />
        <h4 className="text-sm font-bold text-slate-900">
          Agnes AI 实操视频
          <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-normal font-mono">v2.0</span>
        </h4>
        {historyVideos.length > 0 && (
          <button
            type="button"
            onClick={onRefreshVideos}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition-colors ml-auto cursor-pointer"
            title="刷新视频记录"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingVideos ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>

      {/* 状态通知条 */}
      {generatingVideo && videoStatusText && (
        <div className="p-3.5 rounded-xl bg-blue-50/80 border border-blue-200 text-xs space-y-2">
          <div className="flex items-center gap-3">
            <Loader2 className="w-4 h-4 animate-spin text-blue-600 shrink-0" />
            <span className="text-blue-800 font-semibold flex-1">{videoStatusText}</span>
            {internalStatus && (
              <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold shrink-0">
                {INTERNAL_STATUS_MAP[internalStatus] || internalStatus}
              </span>
            )}
            {elapsedSec !== null && elapsedSec !== undefined && (
              <span className="text-[11px] text-blue-600 font-mono shrink-0">
                已耗时 {formatElapsed(elapsedSec * 1000)}
              </span>
            )}
            <span className="text-[11px] text-blue-600 hidden sm:inline">可切换页面，后台自动轮询</span>
          </div>
          {/* 进度条：progressPct 非 null 时显示 */}
          {progressPct !== null && progressPct !== undefined && (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-blue-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
                />
              </div>
              <span className="text-[10px] text-blue-600 font-mono w-8 text-right">{progressPct}%</span>
            </div>
          )}
          {/* 放弃按钮 */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onCancelVideoTask}
              className="px-3 py-1 text-[11px] text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-lg font-medium transition-colors cursor-pointer"
            >
              放弃这条任务
            </button>
          </div>
        </div>
      )}

      {/* 完成提示条 */}
      {videoSuccessNotice && (
        <div className="flex items-center justify-between p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold">{videoSuccessNotice}</span>
          </div>
          <button
            type="button"
            onClick={onDismissSuccessNotice}
            className="text-emerald-500 hover:text-emerald-700 p-0.5 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 错误提示 */}
      {videoError && (
        <div className="flex items-center justify-between p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="truncate">{videoError}</span>
          </div>
          <button
            type="button"
            onClick={onRetryGenerate}
            className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold text-xs transition-colors shrink-0 cursor-pointer ml-2"
          >
            重试
          </button>
        </div>
      )}

      {/* 当前活跃/选中的真实视频播放器 */}
      {currentActiveVideoUrl && (
        <div className="space-y-2">
          <div className="relative rounded-xl overflow-hidden bg-slate-900 border border-slate-200 aspect-video max-h-[420px] flex items-center justify-center">
            <video
              key={currentActiveVideoUrl}
              src={currentActiveVideoUrl}
              controls
              autoPlay
              className="w-full h-full object-contain"
            >
              您的浏览器不支持 video 标签播放。
            </video>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500 px-1">
            <span className="flex items-center gap-1.5 font-medium text-emerald-600">
              <CheckCircle2 className="w-3.5 h-3.5" /> 视频生成成功，已成功载入高清实操视频
            </span>
            <a
              href={currentActiveVideoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium"
            >
              新窗口全屏观看 <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      )}

      {/* 历史视频记录列表 */}
      {historyVideos.length > 0 && (
        <div className="pt-3 border-t border-slate-100 space-y-2">
          <span className="text-xs font-semibold text-slate-600">
            历史记录 ({historyVideos.length})
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-48 overflow-y-auto pr-1">
            {historyVideos.map((v) => {
              const isCurrent = currentActiveVideoUrl === v.videoUrl;
              return (
                <div
                  key={v.id}
                  className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-3 transition-colors ${
                    isCurrent
                      ? 'bg-blue-50/60 border-blue-200'
                      : 'bg-slate-50/50 border-slate-100 hover:bg-slate-50'
                  }`}
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          v.status === 'completed'
                            ? 'bg-emerald-100 text-emerald-700'
                            : v.status === 'failed'
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-amber-100 text-amber-700 animate-pulse'
                        }`}
                      >
                        {v.status === 'completed' ? '已生成' : v.status === 'failed' ? '失败' : '渲染中'}
                      </span>
                      <span className="text-[11px] text-slate-500 font-mono">
                        {v.createdAt
                          ? new Date(v.createdAt).toLocaleString('zh-CN', {
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : ''}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 truncate font-mono">
                      {v.taskId}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {v.status === 'completed' && v.videoUrl && (
                      <button
                        type="button"
                        onClick={() => onSelectVideoUrl(v.videoUrl!)}
                        className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium transition-colors cursor-pointer"
                      >
                        播放
                      </button>
                    )}
                    {canDeleteVideo && (
                      <button
                        type="button"
                        onClick={() => onDeleteVideo(v.id)}
                        className="p-1 rounded text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                        title="删除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
