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
import { MaintenanceProcedure, ProcedureStep, VideoScript, UserProfile, ProcedureVideo } from '../types';

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
    const isFull = taskId.startsWith('full-');
    const startTime = Date.now();
    const intervalMs = isFull ? 10000 : 6000;

    setVideoStatusText(
      isFull
        ? '正在生成完整讲解视频（多段拍摄 + 自动拼接配音，已开始启动）...'
        : '视频生成中（约 30-120 秒），已开始提交 GPU 渲染...'
    );

    const poll = async () => {
      const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
      const elapsedMin = Math.floor(elapsedSeconds / 60);
      const elapsedSec = elapsedSeconds % 60;
      const elapsedStr = elapsedMin > 0 ? `${elapsedMin}分${elapsedSec}秒` : `${elapsedSec}秒`;

      // 4. 超时保护：轮询超过 60 分钟（3600 秒）显示"仍在后台生成，可稍后查看"（不无限轮询）
      if (elapsedSeconds > 3600) {
        clearInterval(pollTimerRef.current);
        setGeneratingVideo(false);
        setVideoStatusText(null);
        setVideoError('仍在后台生成，可稍后查看');
        return;
      }

      try {
        const res = await procedureApi.getVideoStatus(taskId);
        if (res.status === 'completed') {
          // 3. 完成提示：completed 时停止轮询、自动刷新视频列表，提示"视频生成完成，可点击播放"
          clearInterval(pollTimerRef.current);
          setGeneratingVideo(false);
          setVideoStatusText(null);
          setVideoError(null);
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
          // 1. & 5. 进度显示：优先展示后端 error 字段进度文案，追加已耗时与预计剩余（每段约 6 分钟 + 65s 限频估算）
          if (isFull) {
            let progressMsg = res.error || '正在多段生成中...';
            // 估算剩余时间：每段约 6 分钟 (360s) + 限频 65s = 425s/段
            const match = progressMsg.match(/第\s*(\d+)\s*\/\s*(\d+)\s*段/);
            let etaText = '';
            if (match) {
              const currentSeg = parseInt(match[1], 10);
              const totalSegs = parseInt(match[2], 10);
              const remainingSegs = Math.max(0, totalSegs - currentSeg);
              const estRemainingMinutes = Math.max(1, Math.ceil((remainingSegs * (6 * 60 + 65)) / 60));
              etaText = `，预计剩余约 ${estRemainingMinutes} 分钟`;
            } else {
              const estRemainingMinutes = Math.max(1, Math.ceil(Math.max(0, 4 * 425 - elapsedSeconds) / 60));
              etaText = `，预计剩余约 ${estRemainingMinutes} 分钟`;
            }
            setVideoStatusText(`⏳ ${progressMsg}（已耗时 ${elapsedStr}${etaText}）`);
          } else {
            // 单段视频同样处理：优先展示后端 error 字段进度文案，每段约 6 分钟 (360 秒) 估算
            let progressMsg =
              res.error || (res.status === 'processing' ? '正在渲染视频中...' : '任务已排队，等待 GPU 调度...');
            const singleTotalEst = 360; // 单段排队加渲染约 6 分钟
            const remaining = Math.max(0, singleTotalEst - elapsedSeconds);
            const estRemainingMin = Math.ceil(remaining / 60);
            const singleEta = remaining > 0 ? `，预计剩余约 ${estRemainingMin} 分钟` : '，预计即将完成';
            setVideoStatusText(`⏳ ${progressMsg}（已耗时 ${elapsedStr}${singleEta}）`);
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

  // 删除历史视频记录
  const handleDeleteVideo = async (vidId: string) => {
    if (!confirm('确定要删除这条视频记录吗？')) return;
    try {
      await procedureApi.deleteVideo(vidId);
      if (activeProcedure?.id) {
        loadProcedureVideos(activeProcedure.id);
      }
    } catch (err: any) {
      alert('删除失败: ' + err.message);
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
        alert(`合规互锁警告：必须先逐项确认完成第 1 至第 ${stepNo - 1} 步的作业与安全验收，方可进行第 ${stepNo} 步！`);
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
      alert('分镜生成失败: ' + err.message);
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
      <div className="shrink-0 bg-white/95 backdrop-blur z-10 border-b border-slate-200/80 sticky top-0 pb-4 mb-4 space-y-4">
        {/* 顶部标题与视频分镜总控 */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shadow-xs border border-blue-200">
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
                覆盖机组全流程步骤分解、工具物料清单、安全红线防护及 Agnes AI 视频实操生成
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
      <div className="card-industrial bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-slate-600 flex items-center gap-1 font-medium">
            <Filter className="w-3.5 h-3.5 text-blue-600" /> 设备类型：
          </span>
          <div className="flex flex-wrap gap-1.5">
            {equipmentTypes.map((t) => (
              <button
                key={t}
                onClick={() => setSelectedType(t)}
                className={`px-3 py-1 rounded-lg transition-colors cursor-pointer text-xs ${
                  selectedType === t
                    ? 'bg-blue-600 text-white font-semibold shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                }`}
              >
                {t === 'all' ? '全部类型' : t}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-slate-600 font-medium">检修等级：</span>
          <div className="flex flex-wrap gap-1.5">
            {maintenanceLevels.map((lvl) => (
              <button
                key={lvl}
                onClick={() => setSelectedLevel(lvl)}
                className={`px-3 py-1 rounded-lg transition-colors cursor-pointer text-xs ${
                  selectedLevel === lvl
                    ? 'bg-cyan-600 text-white font-semibold shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                }`}
              >
                {lvl === 'all' ? '全部等级' : lvl}
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
              匹配指引列表 ({procedures.length})
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
                      <span className="text-xs font-bold text-slate-800 line-clamp-1">{proc.title}</span>
                      <ChevronRight
                        className={`w-4 h-4 shrink-0 transition-transform ${
                          isSelected ? 'text-blue-600 translate-x-1' : 'text-slate-500'
                        }`}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-cyan-50 text-cyan-700 border border-cyan-200 font-mono font-medium">
                          {proc.equipmentType}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                          {proc.maintenanceLevel}
                        </span>
                      </div>
                      <span className="flex items-center gap-1 font-mono">
                        <Clock className="w-3 h-3 text-slate-500" />
                        {proc.estimatedMinutes || 60}m
                      </span>
                    </div>

                    {/* 进度条 */}
                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden border border-slate-200">
                        <div
                          className={`h-full transition-all duration-300 ${
                            isDone ? 'bg-emerald-500' : 'bg-blue-500'
                          }`}
                          style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-slate-500">
                        {doneCount}/{total}
                      </span>
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
                          <Clock className="w-3.5 h-3.5 text-slate-500" />
                          预计工时: {activeProcedure.estimatedMinutes || 60} 分钟
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-slate-900">{activeProcedure.title}</h3>
                    </div>

                    {/* 合规状态徽章 */}
                    <div className="shrink-0">
                      {isAllStepsCompleted ? (
                        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold text-xs animate-bounce">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          作业合规通过
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium">
                          <AlertTriangle className="w-4 h-4 text-amber-600" />
                          <span>
                            步骤互锁进行中 ({checkedStepsForActive.length}/{activeProcedure.steps.length})
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Agnes AI 真实视频生成状态与播放展示区 */}
                {(generatingVideo || videoStatusText || videoError || currentActiveVideoUrl || historyVideos.length > 0) && (
                  <div className="card-industrial bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-200">
                          <Film className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                            Agnes AI 智能检修实操视频
                            <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200 font-medium">
                              model: agnes-video-v2.0
                            </span>
                          </h4>
                          <p className="text-xs text-slate-500">
                            工业级多模态真实视频生成，支持全屏播放与外部下载
                          </p>
                        </div>
                      </div>

                      {historyVideos.length > 0 && (
                        <button
                          onClick={() => loadProcedureVideos(activeProcedure.id)}
                          className="p-1.5 text-slate-500 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                          title="刷新视频记录"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${loadingVideos ? 'animate-spin' : ''}`} />
                        </button>
                      )}
                    </div>

                    {/* 状态通知条 */}
                    {generatingVideo && videoStatusText && (
                      <div className="flex items-center gap-3 p-3.5 rounded-xl bg-blue-50/80 border border-blue-200 text-blue-800 text-xs">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-600 shrink-0" />
                        <div className="flex-1">
                          <p className="font-semibold">{videoStatusText}</p>
                          <p className="text-[11px] text-blue-600 mt-0.5">
                            视频生成为云端 GPU 异步渲染任务，您可以切换到其他页面操作，系统会在后台继续轮询并在完成后自动呈现与播放。
                          </p>
                        </div>
                      </div>
                    )}

                    {/* 完成提示条 */}
                    {videoSuccessNotice && (
                      <div className="flex items-center justify-between p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <div>
                            <p className="font-bold">{videoSuccessNotice}</p>
                            <p className="text-emerald-700 mt-0.5">视频已自动入库，可点击下方播放器或历史记录播放。</p>
                          </div>
                        </div>
                        <button
                          onClick={() => setVideoSuccessNotice(null)}
                          className="text-emerald-600 hover:text-emerald-800 p-1"
                        >
                          ✕
                        </button>
                      </div>
                    )}

                    {/* 错误提示 */}
                    {videoError && (
                      <div className="flex items-start justify-between p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-bold">生成提示 / 异常</p>
                            <p className="text-rose-700 mt-0.5">{videoError}</p>
                          </div>
                        </div>
                        <button
                          onClick={currentTaskId?.startsWith('full-') ? handleGenerateFullVideo : handleGenerateRealVideo}
                          className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold text-xs transition-colors shrink-0 cursor-pointer"
                        >
                          重试生成
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
                          本指引视频历史记录 ({historyVideos.length})
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-48 overflow-y-auto pr-1">
                          {historyVideos.map((v) => {
                            const isCurrent = currentActiveVideoUrl === v.videoUrl;
                            return (
                              <div
                                key={v.id}
                                className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-3 transition-colors ${
                                  isCurrent
                                    ? 'bg-blue-50/60 border-blue-300'
                                    : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                                }`}
                              >
                                <div className="space-y-1 min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                        v.status === 'completed'
                                          ? 'bg-emerald-100 text-emerald-800'
                                          : v.status === 'failed'
                                          ? 'bg-rose-100 text-rose-800'
                                          : 'bg-amber-100 text-amber-800 animate-pulse'
                                      }`}
                                    >
                                      {v.status === 'completed'
                                        ? '已生成'
                                        : v.status === 'failed'
                                        ? '生成失败'
                                        : v.status === 'processing'
                                        ? '渲染中'
                                        : '排队中'}
                                    </span>
                                    <span className="text-[11px] text-slate-500 font-mono">
                                      {v.createdAt ? new Date(v.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-slate-600 truncate font-mono">
                                    Task: {v.taskId}
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
                                      title="删除记录"
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
                                  <span className="text-[11px] font-normal text-emerald-600 flex items-center gap-1">
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
