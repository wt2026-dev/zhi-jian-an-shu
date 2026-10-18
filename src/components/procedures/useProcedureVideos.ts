import { useState, useEffect, useRef } from 'react';
import { procedureApi } from '../../api';
import { MaintenanceProcedure, ProcedureVideo } from '../../types';
import { logger } from '../../utils/logger';
import {
  SEG_FAST_SEC,
  SEG_SLOW_SEC,
  MAX_POLL_SECONDS,
  estimateRemainingMinutes,
  formatElapsed,
  resolveTaskStartMs,
} from '../../utils/videoProgress';

export const INTERNAL_STATUS_MAP: Record<string, string> = {
  queued: '排队中',
  inference: '模型推理中',
  rendering: '渲染中',
  processing: '生成中',
  pending: '排队中',
  waiting: '排队中',
  running: '生成中',
  in_progress: '生成中',
};

interface UseProcedureVideosOptions {
  activeProcedure?: MaintenanceProcedure | null;
  showToast: (toast: { type: 'success' | 'error' | 'warning' | 'info'; title: string; message?: string }) => void;
}

export function useProcedureVideos({ activeProcedure, showToast }: UseProcedureVideosOptions) {
  const [historyVideos, setHistoryVideos] = useState<ProcedureVideo[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [videoStatusText, setVideoStatusText] = useState<string | null>(null);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [currentActiveVideoUrl, setCurrentActiveVideoUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoSuccessNotice, setVideoSuccessNotice] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(18);
  const [progressPct, setProgressPct] = useState<number | null>(null);
  const [internalStatus, setInternalStatus] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState<number | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // 加载当前规程的 AI 真实视频记录
  async function loadProcedureVideos(procId: string) {
    if (!procId) return;
    setLoadingVideos(true);
    try {
      const vids = await procedureApi.getVideos(procId);
      setHistoryVideos(vids || []);
      // 检查最新视频如果完成直接设为播放源
      const completedVid = (vids || []).find((v: ProcedureVideo) => v.status === 'completed' && v.videoUrl);
      if (completedVid && !currentActiveVideoUrl) {
        setCurrentActiveVideoUrl(completedVid.videoUrl);
      }
      // 检查是否有仍在生成中的任务自动接管轮询
      const pendingVid = (vids || []).find((v: ProcedureVideo) => v.status === 'queued' || v.status === 'processing');
      if (pendingVid && !currentTaskId) {
        startPolling(pendingVid.taskId);
      }
    } catch (err) {
      logger.error('[ProceduresView] 加载历史视频失败:', err);
    } finally {
      setLoadingVideos(false);
    }
  };

  useEffect(() => {
    if (activeProcedure?.id) {
      setCurrentActiveVideoUrl(null);
      setVideoError(null);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      setCurrentTaskId(null);
      setGeneratingVideo(false);
      loadProcedureVideos(activeProcedure.id);
    }
  }, [activeProcedure?.id]);

  // 开始轮询视频任务状态
  function startPolling(taskId: string) {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setCurrentTaskId(taskId);
    setGeneratingVideo(true);
    setVideoError(null);
    setVideoSuccessNotice(null);
    setProgressPct(null);
    setInternalStatus(null);
    setElapsedSec(null);
    const isFull = taskId.startsWith('full-');
    const intervalMs = isFull ? 10000 : 6000;

    let taskStartMs = Date.now();
    let taskStartCorrected = false;
    let maxPollSeconds = MAX_POLL_SECONDS;

    setVideoStatusText(
      isFull
        ? '正在生成完整讲解视频（多段拍摄 + 自动拼接配音，已开始启动）...'
        : '视频生成中（约 30-120 秒），已开始提交 GPU 渲染...'
    );

    const readElapsed = () => {
      const seconds = Math.max(0, Math.floor((Date.now() - taskStartMs) / 1000));
      return { seconds, text: formatElapsed(Date.now() - taskStartMs) };
    };

    const poll = async () => {
      if (readElapsed().seconds > maxPollSeconds) {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        setGeneratingVideo(false);
        setVideoStatusText(null);
        setVideoError(`已超过 ${Math.round(maxPollSeconds / 60)} 分钟，仍在后台生成，可稍后查看`);
        return;
      }

      try {
        const res = await procedureApi.getVideoStatus(taskId);

        if (!taskStartCorrected && res.createdAt) {
          taskStartMs = resolveTaskStartMs(res.createdAt, taskStartMs);
          taskStartCorrected = true;
        }
        if (res.totalTimeoutMin && res.totalTimeoutMin > 0) {
          maxPollSeconds = res.totalTimeoutMin * 60;
        }
        const elapsed = readElapsed();
        const elapsedSeconds = elapsed.seconds;
        const elapsedStr = elapsed.text;

        if (res.status === 'completed') {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          setGeneratingVideo(false);
          setVideoStatusText(null);
          setVideoError(null);
          setProgressPct(100);
          setInternalStatus(null);
          setVideoSuccessNotice('视频生成完成，可点击播放');
          if (res.videoUrl) {
            setCurrentActiveVideoUrl(res.videoUrl);
          }
          if (activeProcedure?.id) {
            loadProcedureVideos(activeProcedure.id);
          }
        } else if (res.status === 'failed') {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          setGeneratingVideo(false);
          setVideoStatusText(null);
          const failReason = res.error || 'Agnes AI 视频生成失败，请稍后重试';
          setVideoError(failReason);
          if (activeProcedure?.id) {
            loadProcedureVideos(activeProcedure.id);
          }
        } else {
          setProgressPct(res.progressPct ?? null);
          setInternalStatus(res.internalStatus ?? null);
          setElapsedSec(res.elapsedSec ?? null);

          if (isFull) {
            const progressMsg = res.error || '正在多段生成中...';
            const match = progressMsg.match(/第\s*(\d+)\s*\/\s*(\d+)\s*段/);
            let etaText = '';
            if (match) {
              const currentSeg = parseInt(match[1], 10);
              const totalSegs = parseInt(match[2], 10);
              const { fast, slow } = estimateRemainingMinutes(currentSeg, totalSegs);
              etaText = `，剩余最快约 ${fast} 分钟 / 最坏约 ${slow} 分钟`;
            }
            setVideoStatusText(`⏳ ${progressMsg}（已耗时 ${elapsedStr}${etaText}）`);
          } else {
            const progressMsg =
              res.error || (res.status === 'processing' ? '正在渲染视频中...' : '任务已排队，等待 GPU 调度...');
            const etaText =
              elapsedSeconds < SEG_FAST_SEC
                ? `，通常还需 ${Math.ceil((SEG_FAST_SEC - elapsedSeconds) / 60)}~${Math.ceil(SEG_SLOW_SEC / 60)} 分钟`
                : `，已超过常见耗时，最长可能到 ${Math.ceil(SEG_SLOW_SEC / 60)} 分钟`;
            setVideoStatusText(`⏳ ${progressMsg}（已耗时 ${elapsedStr}${etaText}）`);
          }
        }
      } catch (err) {
        logger.error('[ProceduresView] 轮询异常:', err);
      }
    };

    pollTimerRef.current = setInterval(poll, intervalMs);
    poll();
  }

  const handleGenerateRealVideo = async () => {
    if (!activeProcedure) return;
    setGeneratingVideo(true);
    setVideoError(null);
    setVideoStatusText(`正在发起 Agnes AI 工业视频生成任务（${videoDuration} 秒版）...`);
    try {
      const res = await procedureApi.generateVideo(activeProcedure.id, videoDuration);
      if (res.success && res.taskId) {
        startPolling(res.taskId);
        if (activeProcedure.id) {
          loadProcedureVideos(activeProcedure.id);
        }
      } else {
        throw new Error('未获取到有效的生成任务 ID');
      }
    } catch (err: unknown) {
      setGeneratingVideo(false);
      setVideoStatusText(null);
      setVideoError((err as Error)?.message || '发起视频生成失败');
    }
  };

  const handleGenerateFullVideo = async () => {
    if (!activeProcedure) return;
    setGeneratingVideo(true);
    setVideoError(null);
    try {
      const res = await procedureApi.generateVideoFull(activeProcedure.id);
      if (res.success && res.taskId) {
        startPolling(res.taskId);
        if (activeProcedure.id) {
          loadProcedureVideos(activeProcedure.id);
        }
      } else {
        throw new Error(res.message || '未获取到有效的完整视频任务 ID');
      }
    } catch (err: unknown) {
      setGeneratingVideo(false);
      setVideoStatusText(null);
      setVideoError((err as Error)?.message || '发起完整视频生成失败');
    }
  };

  const handleCancelVideoTask = async () => {
    if (!currentTaskId) return;
    if (!confirm('确定要放弃这条视频生成任务吗？')) return;
    try {
      await procedureApi.cancelVideo(currentTaskId);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      setGeneratingVideo(false);
      setVideoStatusText(null);
      setVideoError('用户主动放弃');
      setProgressPct(null);
      setInternalStatus(null);
      if (activeProcedure?.id) {
        loadProcedureVideos(activeProcedure.id);
      }
    } catch (err: unknown) {
      showToast({ type: 'error', title: '取消失败', message: (err as Error)?.message || '取消任务失败' });
    }
  };

  const handleDeleteVideo = async (vidId: string) => {
    if (!confirm('确定要删除这条视频记录吗？')) return;
    try {
      await procedureApi.deleteVideo(vidId);
      if (activeProcedure?.id) {
        loadProcedureVideos(activeProcedure.id);
      }
    } catch (err: unknown) {
      showToast({ type: 'error', title: '删除失败', message: (err as Error)?.message });
    }
  };

  return {
    historyVideos,
    loadingVideos,
    generatingVideo,
    videoStatusText,
    currentTaskId,
    currentActiveVideoUrl,
    videoError,
    videoSuccessNotice,
    setVideoSuccessNotice,
    videoDuration,
    setVideoDuration,
    progressPct,
    internalStatus,
    elapsedSec,
    loadProcedureVideos,
    handleGenerateRealVideo,
    handleGenerateFullVideo,
    handleCancelVideoTask,
    handleDeleteVideo,
    setCurrentActiveVideoUrl,
  };
}
