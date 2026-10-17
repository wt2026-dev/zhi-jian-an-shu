import React, { useState, useEffect, useRef } from 'react';
import {
  Wrench,
  ShieldAlert,
  CheckCircle2,
  Clock,
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  SkipBack,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  Sparkles,
  ChevronRight,
  Filter,
  CheckSquare,
  Square,
  AlertTriangle,
  FileVideo,
  X,
  Layers,
  ClipboardList,
  Video,
  Loader2,
  Trash2,
  ExternalLink,
  RefreshCw,
  Film,
} from 'lucide-react';
import { procedureApi } from '../api';
import { useToast } from '../context/ToastContext';
import { MaintenanceProcedure, ProcedureStep, VideoScript, UserProfile, ProcedureVideo } from '../types';
import {
  SEG_FAST_SEC,
  SEG_SLOW_SEC,
  MAX_POLL_SECONDS,
  estimateRemainingMinutes,
  formatElapsed,
  resolveTaskStartMs,
} from '../utils/videoProgress';

interface ProceduresViewProps {
  currentUser: UserProfile;
  preselectedEquipmentType?: string;
  preselectedLevel?: string;
  onSelectProcedure?: (proc: MaintenanceProcedure) => void;
}

export const ProceduresView: React.FC<ProceduresViewProps> = ({
  currentUser,
  preselectedEquipmentType,
  preselectedLevel,
  onSelectProcedure,
}) => {
  const { show: showToast } = useToast();
  const [procedures, setProcedures] = useState<MaintenanceProcedure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 筛选状态
  const [selectedType, setSelectedType] = useState<string>(preselectedEquipmentType || 'all');
  const [selectedLevel, setSelectedLevel] = useState<string>(preselectedLevel || 'all');
  const [activeProcedureId, setActiveProcedureId] = useState<string>('');

  // 步骤勾选状态 (规程ID -> Set of completed step numbers)
  const [completedSteps, setCompletedSteps] = useState<Record<string, number[]>>({});

  // 视频分镜播放器状态（保留原有逻辑）
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [videoScript, setVideoScript] = useState<VideoScript | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [generatingScript, setGeneratingScript] = useState(false);
  const [scriptNotice, setScriptNotice] = useState<string | null>(null);

  // ==================== Agnes AI 真实视频生成状态 ====================
  const [historyVideos, setHistoryVideos] = useState<ProcedureVideo[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [videoStatusText, setVideoStatusText] = useState<string | null>(null);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [currentActiveVideoUrl, setCurrentActiveVideoUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoSuccessNotice, setVideoSuccessNotice] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(18); // Agnes 视频时长（秒）：10 / 15 / 18
  const [pollCount, setPollCount] = useState(0);
  const [progressPct, setProgressPct] = useState<number | null>(null);
  const [internalStatus, setInternalStatus] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState<number | null>(null);

  const videoPlayerRef = useRef<HTMLDivElement>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const pollTimerRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis;
    }
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // 加载规程列表
  const loadProcedures = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await procedureApi.list({
        equipmentType: selectedType !== 'all' ? selectedType : undefined,
        maintenanceLevel: selectedLevel !== 'all' ? selectedLevel : undefined,
      });
      setProcedures(data);
      if (data.length > 0 && (!activeProcedureId || !data.some((p: any) => p.id === activeProcedureId))) {
        setActiveProcedureId(data[0].id);
      }
    } catch (err: any) {
      setError(err?.message || '规程加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProcedures();
  }, [selectedType, selectedLevel]);

  const activeProcedure = procedures.find((p) => p.id === activeProcedureId) || procedures[0];

  // 加载当前规程的 AI 真实视频记录
  const loadProcedureVideos = async (procId: string) => {
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
      console.error('[ProceduresView] 加载历史视频失败:', err);
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
  const startPolling = (taskId: string) => {
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

    // 已耗时的起点必须是「任务入库时刻」，而不是「本轮轮询开始的时刻」。
    // 后者在每次刷新页面 / 组件重新挂载时都会归零 —— 实测出现过任务已跑 36 分钟、
    // 界面却显示"已耗时 0秒"的情况（用户因此以为卡住了）。
    // 首轮轮询拿到后端的 createdAt 后立刻纠正；拿不到时保留本轮时刻兜底（宁可少报，也不会倒退）。
    let taskStartMs = Date.now();
    let taskStartCorrected = false;
    // 停止轮询的上限：默认用本地兜底值，首轮拿到后端的 totalTimeoutMin 后改用后端口径。
    // 后端那个数是按段数推导的（段数 × 单段窗口 + 段间限频），8 段任务会比 240 分钟大得多。
    let maxPollSeconds = MAX_POLL_SECONDS;

    setVideoStatusText(
      isFull
        ? '正在生成完整讲解视频（多段拍摄 + 自动拼接配音，已开始启动）...'
        : '视频生成中（约 30-120 秒），已开始提交 GPU 渲染...'
    );

    /** 统一的"已耗时"口径：始终以 taskStartMs 为起点 */
    const readElapsed = () => {
      const seconds = Math.max(0, Math.floor((Date.now() - taskStartMs) / 1000));
      return { seconds, text: formatElapsed(Date.now() - taskStartMs) };
    };

    const poll = async () => {
      // 4. 超时保护：达到后端全局超时（默认 240 分钟，8 段任务会更大）才停轮询。
      //    与后端保持一致，避免界面比后端更早放弃、弹出"仍在后台生成"却仍显示转圈。
      if (readElapsed().seconds > maxPollSeconds) {
        clearInterval(pollTimerRef.current);
        setGeneratingVideo(false);
        setVideoStatusText(null);
        setVideoError(`已超过 ${Math.round(maxPollSeconds / 60)} 分钟，仍在后台生成，可稍后查看`);
        return;
      }

      try {
        const res = await procedureApi.getVideoStatus(taskId);

        // 首轮用后端返回的任务入库时间纠正"已耗时"起点（只纠正一次，避免轮询期间起点漂移）。
        // 刷新页面后 startPolling 会重跑，若不纠正，耗时就会从 0 重新计。
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
          // 3. 完成提示：completed 时停止轮询、自动刷新视频列表，提示"视频生成完成，可点击播放"
          clearInterval(pollTimerRef.current);
          setGeneratingVideo(false);
          setVideoStatusText(null);
          setVideoError(null);
          setProgressPct(100);
          setInternalStatus(null);
          setVideoSuccessNotice('视频生成完成，可点击播放');
          if (res.videoUrl) {
            setCurrentActiveVideoUrl(res.videoUrl);
          }
          // 自动刷新视频列表
          if (activeProcedure?.id) {
            loadProcedureVideos(activeProcedure.id);
          }
        } else if (res.status === 'failed') {
          // 2. 失败可见：getVideoStatus 返回 failed 时 setVideoError 显示具体原因，停止轮询，不一直转圈
          clearInterval(pollTimerRef.current);
          setGeneratingVideo(false);
          setVideoStatusText(null);
          const failReason = res.error || 'Agnes AI 视频生成失败，请稍后重试';
          setVideoError(failReason);
          if (activeProcedure?.id) {
            loadProcedureVideos(activeProcedure.id);
          }
        } else {
          // 1. & 5. 进度显示：优先展示后端 error 字段进度文案，追加已耗时与剩余区间
          // 透传后端真实进度字段
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
            // 单段视频：同样只给区间（实测最快约 4 分钟，慢时会被 40 分钟窗口兜住）
            const progressMsg =
              res.error || (res.status === 'processing' ? '正在渲染视频中...' : '任务已排队，等待 GPU 调度...');
            const etaText =
              elapsedSeconds < SEG_FAST_SEC
                ? `，通常还需 ${Math.ceil((SEG_FAST_SEC - elapsedSeconds) / 60)}~${Math.ceil(SEG_SLOW_SEC / 60)} 分钟`
                : `，已超过常见耗时，最长可能到 ${Math.ceil(SEG_SLOW_SEC / 60)} 分钟`;
            setVideoStatusText(`⏳ ${progressMsg}（已耗时 ${elapsedStr}${etaText}）`);
          }
        }
      } catch (err: any) {
        console.error('[ProceduresView] 轮询异常:', err);
      }
    };

    pollTimerRef.current = setInterval(poll, intervalMs);
    // 立即发起首次状态查询
    poll();
  };

  // 发起调用 Agnes AI 生成真实视频（单段：10s/15s/18s）
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
    } catch (err: any) {
      setGeneratingVideo(false);
      setVideoStatusText(null);
      setVideoError(err.message || '发起视频生成失败');
    }
  };

  // 发起调用 Agnes AI 生成完整讲解视频（多段拍摄 + 自动拼接，带声音）
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
    } catch (err: any) {
      setGeneratingVideo(false);
      setVideoStatusText(null);
      setVideoError(err.message || '发起完整视频生成失败');
    }
  };

  // Agnes internal_status 中文映射
  const INTERNAL_STATUS_MAP: Record<string, string> = {
    queued: '排队中',
    inference: '模型推理中',
    rendering: '渲染中',
    processing: '生成中',
    pending: '排队中',
    waiting: '排队中',
    running: '生成中',
    in_progress: '生成中',
  };

  // 放弃视频生成任务
  const handleCancelVideoTask = async () => {
    if (!currentTaskId) return;
    if (!confirm('确定要放弃这条视频生成任务吗？')) return;
    try {
      await procedureApi.cancelVideo(currentTaskId);
      // 取消成功后，卡片变成失败态
      clearInterval(pollTimerRef.current);
      setGeneratingVideo(false);
      setVideoStatusText(null);
      setVideoError('用户主动放弃');
      setProgressPct(null);
      setInternalStatus(null);
      if (activeProcedure?.id) {
        loadProcedureVideos(activeProcedure.id);
      }
    } catch (err: any) {
      showToast({ type: 'error', title: '取消失败', message: err.message || '取消任务失败' });
    }
  };

  // 删除历史视频记录
  const handleDeleteVideo = async (vidId: string) => {
    if (!confirm('确定要删除这条视频记录吗？')) return;
    try {
      await procedureApi.deleteVideo(vidId);
      if (activeProcedure?.id) {
        loadProcedureVideos(activeProcedure.id);
      }
    } catch (err: any) {
      showToast({ type: 'error', title: '删除失败', message: err.message });
    }
  };

  const checkedStepsForActive = activeProcedure ? completedSteps[activeProcedure.id] || [] : [];
  const isAllStepsCompleted =
    activeProcedure &&
    activeProcedure.steps &&
    activeProcedure.steps.length > 0 &&
    checkedStepsForActive.length === activeProcedure.steps.length;

  // 勾选处理 (顺序门禁机制：必须完成上一步才能进入下一步)
  const handleToggleStep = (stepNo: number) => {
    if (!activeProcedure) return;
    const currentList = [...checkedStepsForActive];
    const isChecked = currentList.includes(stepNo);

    if (isChecked) {
      // 取消勾选时，取消该步及之后所有步骤
      const filtered = currentList.filter((n) => n < stepNo);
      setCompletedSteps({ ...completedSteps, [activeProcedure.id]: filtered });
    } else {
      // 必须先勾选前面的所有步骤
      const prevSteps = Array.from({ length: stepNo - 1 }, (_, i) => i + 1);
      const allPrevChecked = prevSteps.every((n) => currentList.includes(n));
      if (!allPrevChecked) {
        showToast({ type: 'warning', title: '合规互锁警告', message: `必须先逐项确认完成第 1 至第 ${stepNo - 1} 步的作业与安全验收，方可进行第 ${stepNo} 步！` });
        return;
      }
      setCompletedSteps({ ...completedSteps, [activeProcedure.id]: [...currentList, stepNo].sort((a, b) => a - b) });
    }
  };

  // 生成或打开次要文字分镜脚本弹窗
  const handleOpenVideo = async () => {
    if (!activeProcedure) return;

    if (activeProcedure.script && activeProcedure.script.voiceover && activeProcedure.script.voiceover.length > 0) {
      setVideoScript(activeProcedure.script);
      setCurrentStepIndex(0);
      setShowVideoModal(true);
      return;
    }

    setGeneratingScript(true);
    setScriptNotice('AI 正在基于标准化作业步骤生成分镜脚本与解说词...');
    try {
      const res = await procedureApi.generateVideoScript(activeProcedure.id);
      if (res.script) {
        setVideoScript(res.script);
        activeProcedure.script = res.script;
        setCurrentStepIndex(0);
        setShowVideoModal(true);
      }
    } catch (err: any) {
      showToast({ type: 'error', title: '分镜生成失败', message: err.message });
    } finally {
      setGeneratingScript(false);
      setScriptNotice(null);
    }
  };

  // 语音合成播放逻辑
  const speakCurrentStep = (index: number) => {
    if (!synthRef.current || !videoScript) return;
    synthRef.current.cancel();

    if (isMuted) return;

    const text = videoScript.voiceover?.[index] || activeProcedure?.steps?.[index]?.content || '';
    if (!text) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onend = () => {
      // 当前步骤解说完毕，自动进入下一步
      if (isPlaying && index + 1 < (activeProcedure?.steps?.length || 0)) {
        setCurrentStepIndex(index + 1);
      } else if (index + 1 >= (activeProcedure?.steps?.length || 0)) {
        setIsPlaying(false);
      }
    };

    utteranceRef.current = utterance;
    synthRef.current.speak(utterance);
  };

  useEffect(() => {
    if (showVideoModal && isPlaying) {
      speakCurrentStep(currentStepIndex);
    } else if (synthRef.current) {
      synthRef.current.cancel();
    }
  }, [currentStepIndex, isPlaying, showVideoModal]);

  const handlePlayPause = () => {
    if (isPlaying) {
      setIsPlaying(false);
      synthRef.current?.cancel();
    } else {
      setIsPlaying(true);
      speakCurrentStep(currentStepIndex);
    }
  };

  const handleNextStep = () => {
    if (!activeProcedure) return;
    if (currentStepIndex + 1 < activeProcedure.steps.length) {
      setCurrentStepIndex(currentStepIndex + 1);
    }
  };

  const handlePrevStep = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
    }
  };

  const handleReplay = () => {
    setCurrentStepIndex(0);
    setIsPlaying(true);
    speakCurrentStep(0);
  };

  const handleCloseVideo = () => {
    setShowVideoModal(false);
    setIsPlaying(false);
    synthRef.current?.cancel();
  };

  const equipmentTypes = ['all', '电机', '空压机', '风机', '水泵', '输送带'];
  const maintenanceLevels = ['all', '日常保养', '一级检修', '二级检修'];

  const canDeleteVideo = currentUser?.role === 'admin' || currentUser?.role === 'manager';

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 顶部固定容器：标题区 + 操作栏 + 筛选过滤 */}
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
                onClick={handleOpenVideo}
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
                    onClick={() => setVideoDuration(d)}
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
                onClick={handleGenerateRealVideo}
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
                onClick={handleGenerateFullVideo}
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
            {equipmentTypes.map((t) => (
              <button
                key={t}
                onClick={() => setSelectedType(t)}
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
            {maintenanceLevels.map((lvl) => (
              <button
                key={lvl}
                onClick={() => setSelectedLevel(lvl)}
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

      {/* 下方指引列表/卡片区：单独滚动 */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 pb-6">
        {/* 主工作区：左侧指引列表，右侧步骤卡片流 */}
      {loading ? (
        <div className="card-industrial bg-white border border-slate-200 p-12 text-center text-slate-500 text-sm shadow-xs">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          正在加载标准化作业指引库...
        </div>
      ) : error ? (
        <div className="card-industrial bg-white border border-slate-200 p-8 text-center text-rose-600 text-sm shadow-xs">{error}</div>
      ) : procedures.length === 0 ? (
        <div className="card-industrial bg-white border border-slate-200 p-12 text-center text-slate-500 text-sm shadow-xs">暂无符合条件的作业指引</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* 左侧规程清单 */}
          <div className="lg:col-span-4 space-y-2.5 lg:sticky lg:top-2 lg:self-start lg:flex lg:flex-col lg:min-h-0 lg:max-h-[calc(100vh-210px)]">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-1 lg:shrink-0">
              匹配指引 ({procedures.length})
            </h3>
            <div className="space-y-2 max-h-[700px] overflow-y-auto pr-1 lg:max-h-none lg:flex-1 lg:min-h-0">
              {procedures.map((proc) => {
                const isSelected = proc.id === activeProcedure?.id;
                const doneCount = (completedSteps[proc.id] || []).length;
                const total = proc.steps?.length || 0;
                const isDone = total > 0 && doneCount === total;

                return (
                  <div
                    key={proc.id}
                    onClick={() => setActiveProcedureId(proc.id)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer card-industrial shadow-xs ${
                      isSelected
                        ? 'bg-blue-50/70 border-blue-400 ring-1 ring-blue-300'
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-xs font-bold text-slate-800 line-clamp-1 flex-1">{proc.title}</span>
                      <ChevronRight
                        className={`w-4 h-4 shrink-0 transition-transform ${
                          isSelected ? 'text-blue-600 translate-x-0.5' : 'text-slate-400'
                        }`}
                      />
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                      <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium">{proc.equipmentType}</span>
                      <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium">{proc.maintenanceLevel}</span>
                      <span className="ml-auto font-mono">{proc.estimatedMinutes || 60}m</span>
                      <span className={`font-mono ${isDone ? 'text-emerald-600 font-semibold' : ''}`}>{doneCount}/{total}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 右侧步骤卡片流与合规校验 */}
          <div className="lg:col-span-8 space-y-5">
            {activeProcedure && (
              <>
                {/* 规程标题卡片 */}
                <div className="card-industrial bg-white border border-slate-200 p-5 border-l-4 border-l-blue-600 shadow-xs rounded-xl">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-xs font-semibold">
                          {activeProcedure.equipmentType}
                        </span>
                        <span className="px-2.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-xs font-semibold">
                          {activeProcedure.maintenanceLevel}
                        </span>
                        <span className="text-xs text-slate-500 flex items-center gap-1 font-mono">
                          <Clock className="w-3.5 h-3.5" />
                          {activeProcedure.estimatedMinutes || 60}分钟
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-slate-900">{activeProcedure.title}</h3>
                    </div>

                    {/* 合规状态徽章 */}
                    <div className="shrink-0">
                      {isAllStepsCompleted ? (
                        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold text-xs">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          合规通过
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 font-medium text-xs">
                          <span className="font-mono font-semibold text-slate-800">{checkedStepsForActive.length}/{activeProcedure.steps.length}</span>
                          <span>步骤完成</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Agnes AI 真实视频生成状态与播放展示区 */}
                {(generatingVideo || videoStatusText || videoError || currentActiveVideoUrl || historyVideos.length > 0) && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Film className="w-4 h-4 text-blue-500" />
                      <h4 className="text-sm font-bold text-slate-900">
                        Agnes AI 实操视频
                        <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-normal font-mono">v2.0</span>
                      </h4>
                      {historyVideos.length > 0 && (
                        <button
                          onClick={() => loadProcedureVideos(activeProcedure.id)}
                          className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition-colors ml-auto"
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
                          {/* internalStatus 中文映射 */}
                          {internalStatus && (
                            <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold shrink-0">
                              {INTERNAL_STATUS_MAP[internalStatus] || internalStatus}
                            </span>
                          )}
                          {/* 已耗时（优先用后端 elapsedSec） */}
                          {(elapsedSec !== null && elapsedSec !== undefined) && (
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
                            onClick={handleCancelVideoTask}
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
                          onClick={() => setVideoSuccessNotice(null)}
                          className="text-emerald-500 hover:text-emerald-700 p-0.5"
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
                          onClick={currentTaskId?.startsWith('full-') ? handleGenerateFullVideo : handleGenerateRealVideo}
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
                                      {v.createdAt ? new Date(v.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-slate-600 truncate font-mono">
                                    {v.taskId}
                                  </p>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  {v.status === 'completed' && v.videoUrl && (
                                    <button
                                      onClick={() => setCurrentActiveVideoUrl(v.videoUrl!)}
                                      className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium transition-colors"
                                    >
                                      播放
                                    </button>
                                  )}
                                  {canDeleteVideo && (
                                    <button
                                      onClick={() => handleDeleteVideo(v.id)}
                                      className="p-1 rounded text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
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
                )}

                {/* 步骤卡片流 */}
                <div className="space-y-4">
                  {activeProcedure.steps.map((step, idx) => {
                    const isChecked = checkedStepsForActive.includes(step.step_no);
                    const isNextToExecute =
                      !isChecked &&
                      (step.step_no === 1 || checkedStepsForActive.includes(step.step_no - 1));

                    return (
                      <div
                        key={step.step_no}
                        className={`card-industrial p-5 transition-all relative rounded-xl border shadow-xs ${
                          isChecked
                            ? 'bg-emerald-50/20 border-emerald-300'
                            : isNextToExecute
                            ? 'bg-white border-blue-400 shadow-md ring-1 ring-blue-200'
                            : 'bg-white border-slate-200 opacity-80'
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          {/* 步骤数字圆标 */}
                          <div
                            className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 border ${
                              isChecked
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : isNextToExecute
                                ? 'bg-blue-600 text-white border-blue-500 shadow-xs'
                                : 'bg-slate-100 text-slate-600 border-slate-200'
                            }`}
                          >
                            {step.step_no < 10 ? `0${step.step_no}` : step.step_no}
                          </div>

                          {/* 步骤内容主体 */}
                          <div className="flex-1 space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                                {step.name}
                                {isChecked && (
                                  <span className="text-xs font-normal text-emerald-600 flex items-center gap-1">
                                    <CheckCircle2 className="w-3.5 h-3.5" /> 已完成达标
                                  </span>
                                )}
                              </h4>

                              {/* 勾选操作按键 */}
                              <button
                                onClick={() => handleToggleStep(step.step_no)}
                                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                  isChecked
                                    ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200'
                                    : isNextToExecute
                                    ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-xs'
                                    : 'bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200'
                                }`}
                              >
                                {isChecked ? (
                                  <>
                                    <CheckSquare className="w-4 h-4 text-emerald-600" />
                                    <span>已确认</span>
                                  </>
                                ) : (
                                  <>
                                    <Square className="w-4 h-4" />
                                    <span>确认完成</span>
                                  </>
                                )}
                              </button>
                            </div>

                            {/* 操作内容 */}
                            <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200">
                              {step.content}
                            </p>

                            {/* 工具、安全、验收三要素清单 */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-[11px] pt-1">
                              {/* 工具 */}
                              <div className="p-2.5 rounded-lg bg-blue-50/40 border border-blue-200 space-y-1">
                                <span className="text-blue-700 flex items-center gap-1 font-semibold">
                                  <Wrench className="w-3 h-3 text-blue-600" /> 所需工具/备件:
                                </span>
                                <p className="text-slate-700">{step.tools || '标准机修工具'}</p>
                              </div>

                              {/* 安全要求 */}
                              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 space-y-1">
                                <span className="text-rose-700 flex items-center gap-1 font-semibold">
                                  <ShieldAlert className="w-3 h-3 text-rose-600" /> 安全要点/红线:
                                </span>
                                <p className="text-rose-900">{step.safety || '严格遵照作业防护规范'}</p>
                              </div>

                              {/* 验收标准 */}
                              <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 space-y-1">
                                <span className="text-emerald-700 flex items-center gap-1 font-semibold">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" /> 验收标准/要点:
                                </span>
                                <p className="text-emerald-900">{step.acceptance || '无异常，运行稳定'}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}
      </div>

      {/* 仿真视频分镜播放器弹窗 */}
      {showVideoModal && activeProcedure && videoScript && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div
            ref={videoPlayerRef}
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
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
                <button
                  onClick={handleCloseVideo}
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
                    onClick={() => {
                      setCurrentStepIndex(i);
                      if (isPlaying) speakCurrentStep(i);
                    }}
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
                  onClick={handlePrevStep}
                  disabled={currentStepIndex === 0}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 cursor-pointer"
                  title="上一步"
                >
                  <SkipBack className="w-4 h-4" />
                </button>

                <button
                  onClick={handlePlayPause}
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
                  onClick={handleNextStep}
                  disabled={currentStepIndex >= activeProcedure.steps.length - 1}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 cursor-pointer"
                  title="下一步"
                >
                  <SkipForward className="w-4 h-4" />
                </button>

                <button
                  onClick={handleReplay}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                  title="重播全部"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                  title={isMuted ? '取消静音' : '静音'}
                >
                  {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
