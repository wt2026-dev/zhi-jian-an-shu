import React from 'react';
import {
  FileVideo,
  Maximize2,
  Minimize2,
  X,
  Volume2,
  VolumeX,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  RotateCcw,
} from 'lucide-react';
import { MaintenanceProcedure, VideoScript } from '../../types';

interface ProcedureScriptModalProps {
  isOpen: boolean;
  activeProcedure: MaintenanceProcedure;
  videoScript: VideoScript;
  currentStepIndex: number;
  isPlaying: boolean;
  isMuted: boolean;
  isFullscreen: boolean;
  onClose: () => void;
  onToggleFullscreen: () => void;
  onToggleMute: () => void;
  onPlayPause: () => void;
  onNextStep: () => void;
  onPrevStep: () => void;
  onReplay: () => void;
  onSelectStepIndex: (index: number) => void;
}

export const ProcedureScriptModal: React.FC<ProcedureScriptModalProps> = ({
  isOpen,
  activeProcedure,
  videoScript,
  currentStepIndex,
  isPlaying,
  isMuted,
  isFullscreen,
  onClose,
  onToggleFullscreen,
  onToggleMute,
  onPlayPause,
  onNextStep,
  onPrevStep,
  onReplay,
  onSelectStepIndex,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div
        className={`card-industrial bg-slate-950 border border-slate-700 shadow-2xl flex flex-col overflow-hidden transition-all ${
          isFullscreen ? 'w-full h-full rounded-none' : 'w-full max-w-4xl max-h-[90vh] rounded-2xl'
        }`}
      >
        {/* 播放器顶部条 */}
        <div className="px-5 py-3.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <FileVideo className="w-4 h-4 text-blue-400" />
            <span className="text-xs font-bold text-white tracking-wide">
              {videoScript.title || activeProcedure.title}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">
              步骤 {currentStepIndex + 1}/{activeProcedure.steps.length}
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onToggleFullscreen}
              className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 视频主舞台 (模拟实景操作渲染) */}
        <div className="relative flex-1 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 flex flex-col items-center justify-center p-8 min-h-[360px]">
          {/* 背景工业动态光影 */}
          <div className="absolute inset-0 opacity-20 pointer-events-none bg-[radial-gradient(#2563eb_1px,transparent_1px)] [background-size:16px_16px]" />

          {/* 当前步骤聚焦大字牌 */}
          <div className="relative z-10 max-w-2xl w-full text-center space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs font-mono">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
              当前作业分镜 · 步骤 0{currentStepIndex + 1}
            </div>

            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              {activeProcedure.steps[currentStepIndex]?.name}
            </h2>

            <p className="text-sm text-slate-300 bg-slate-900/80 p-4 rounded-xl border border-slate-800 leading-relaxed shadow-lg">
              {activeProcedure.steps[currentStepIndex]?.content}
            </p>

            {/* 动态同步解说词 / 字幕框 */}
            <div className="p-3.5 rounded-xl bg-blue-950/60 border border-blue-500/40 text-cyan-200 text-xs shadow-inner flex items-center justify-center space-x-2">
              <Volume2 className={`w-4 h-4 text-cyan-400 shrink-0 ${isPlaying ? 'animate-pulse' : ''}`} />
              <span className="font-medium">
                字幕：
                {videoScript.subtitles?.[currentStepIndex] ||
                  videoScript.voiceover?.[currentStepIndex] ||
                  activeProcedure.steps[currentStepIndex]?.name}
              </span>
            </div>
          </div>
        </div>

        {/* 播放器控制栏 */}
        <div className="p-4 bg-slate-900 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* 步骤跳选 */}
          <div className="flex items-center space-x-1 overflow-x-auto max-w-full pb-1 sm:pb-0">
            {activeProcedure.steps.map((s, i) => (
              <button
                key={s.step_no}
                type="button"
                onClick={() => onSelectStepIndex(i)}
                className={`px-2.5 py-1 rounded text-xs font-mono transition-colors cursor-pointer ${
                  currentStepIndex === i
                    ? 'bg-blue-600 text-white font-bold shadow'
                    : 'bg-slate-800 text-slate-500 hover:text-white'
                }`}
              >
                0{s.step_no}
              </button>
            ))}
          </div>

          {/* 核心播放控制器 */}
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={onPrevStep}
              disabled={currentStepIndex === 0}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 cursor-pointer"
              title="上一步"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onPlayPause}
              className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center space-x-2 shadow-lg shadow-blue-500/20 cursor-pointer"
            >
              {isPlaying ? (
                <>
                  <Pause className="w-4 h-4" />
                  <span>暂停讲解</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-white" />
                  <span>播放讲解</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onNextStep}
              disabled={currentStepIndex >= activeProcedure.steps.length - 1}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 cursor-pointer"
              title="下一步"
            >
              <SkipForward className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onReplay}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
              title="重播全部"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onToggleMute}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
              title={isMuted ? '取消静音' : '静音'}
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
