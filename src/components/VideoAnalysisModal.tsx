import React, { useState, useRef } from 'react';
import {
  FileVideo,
  Upload,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  X,
  Play,
  Layers,
  Wrench,
  ShieldCheck,
} from 'lucide-react';
import { aiApi } from '../api';
import { VideoAnalysisResult, Equipment } from '../types';

interface VideoAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultEquipmentModel?: string;
  equipments?: Equipment[];
  onApplyDiagnosis?: (result: VideoAnalysisResult) => void;
  onApplyToWorkOrder?: (result: VideoAnalysisResult) => void;
}

export const VideoAnalysisModal: React.FC<VideoAnalysisModalProps> = ({
  isOpen,
  onClose,
  defaultEquipmentModel = '工业重型旋转机械',
  equipments,
  onApplyDiagnosis,
  onApplyToWorkOrder,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [frames, setFrames] = useState<string[]>([]);
  const [isExtractingFrames, setIsExtractingFrames] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [question, setQuestion] = useState('设备运行中伴随异常震颤与异响，请诊断故障原因及处理建议。');
  const [deviceModel, setDeviceModel] = useState(defaultEquipmentModel);
  const [analysisResult, setAnalysisResult] = useState<VideoAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoBase64, setVideoBase64] = useState<string | null>(null);

  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);

  if (!isOpen) return null;

  // 视频文件选择与 6 帧提取
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 限制 ≤ 80MB
    const MAX_SIZE = 80 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      setError(`文件过大！视频文件不得超过 80MB (当前大小: ${(file.size / (1024 * 1024)).toFixed(1)}MB)`);
      return;
    }

    const allowed = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'];
    if (!allowed.includes(file.type) && !file.name.match(/\.(mp4|mov|avi|webm)$/i)) {
      setError('仅支持上传 mp4, mov, avi, webm 格式的视频文件！');
      return;
    }

    setError(null);
    setSelectedFile(file);
    setAnalysisResult(null);
    setFrames([]);

    // 读取 base64 备用上传
    const reader = new FileReader();
    reader.onload = () => {
      setVideoBase64(reader.result as string);
    };
    reader.readAsDataURL(file);

    // 载入临时 URL
    const url = URL.createObjectURL(file);
    setVideoSrc(url);
    extractSixFrames(url);
  };

  // 通过 HTML5 video + canvas 抽取 6 帧
  const extractSixFrames = (url: string) => {
    setIsExtractingFrames(true);
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.crossOrigin = 'anonymous';

    video.onloadedmetadata = async () => {
      const duration = video.duration || 1;
      const timestamps = [
        0.1,
        Math.min(duration * 0.2, duration - 0.5),
        Math.min(duration * 0.4, duration - 0.4),
        Math.min(duration * 0.6, duration - 0.3),
        Math.min(duration * 0.8, duration - 0.2),
        Math.max(0.2, duration - 0.1),
      ];

      const capturedFrames: string[] = [];
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = 480;
      canvas.height = 270;

      for (const time of timestamps) {
        try {
          await new Promise<void>((resolve) => {
            const onSeeked = () => {
              video.removeEventListener('seeked', onSeeked);
              if (ctx) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                capturedFrames.push(canvas.toDataURL('image/jpeg', 0.75));
              }
              resolve();
            };
            video.addEventListener('seeked', onSeeked);
            video.currentTime = Math.max(0, Math.min(time, duration - 0.05));
          });
        } catch {
          // ignore seek error
        }
      }

      setFrames(capturedFrames);
      setIsExtractingFrames(false);
    };

    video.onerror = () => {
      setIsExtractingFrames(false);
      setError('无法解码该视频文件以截取帧画面，请确认视频编码正常。');
    };
  };

  // 执行多模态智能分析
  const handleStartAnalysis = async () => {
    if (frames.length === 0) {
      setError('尚未提取到视频有效关键帧，请重新选择视频文件。');
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      let uploadedVideoId = '';
      if (videoBase64) {
        try {
          const uploadRes = await aiApi.uploadVideo(videoBase64, selectedFile?.name);
          uploadedVideoId = uploadRes.videoId;
        } catch (ue: any) {
          console.warn('视频落盘警告 (不阻断AI分析):', ue?.message);
        }
      }

      const res = await aiApi.analyzeVideo({
        frames,
        question,
        deviceModel,
        videoId: uploadedVideoId,
      });

      if (res.success && res.analysis) {
        setAnalysisResult(res.analysis);
      } else {
        throw new Error(res.analysis?.message || 'AI 诊断未返回有效数据');
      }
    } catch (err: any) {
      setError('多模态智能分析失败: ' + err.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="card-industrial bg-slate-950 border border-slate-700 shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden rounded-2xl">
        {/* 顶部标题栏 */}
        <div className="px-5 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
              <FileVideo className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                视频上传与多模态智能故障分析
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  AI 视觉模型
                </span>
              </h3>
              <p className="text-[11px] text-slate-500">
                上传巡检视频（≤80MB），自动捕获 6 帧关键胶卷并由大模型推理故障部位与维修建议
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 主体滚动区 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {error && (
            <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/30 text-xs text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 视频选择区 */}
          {!selectedFile ? (
            <label className="border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer bg-slate-900/40 hover:bg-slate-900/80 transition-all">
              <input type="file" accept="video/mp4,video/quicktime,video/x-msvideo,video/webm" onChange={handleFileChange} className="hidden" />
              <div className="w-12 h-12 rounded-full bg-blue-600/10 text-blue-400 flex items-center justify-center">
                <Upload className="w-6 h-6" />
              </div>
              <div className="text-center">
                <p className="text-xs font-semibold text-white">点击选择或拖拽上传设备巡检视频</p>
                <p className="text-[11px] text-slate-500 mt-1">支持 MP4, MOV, AVI, WEBM 格式，单个视频大小 ≤ 80MB</p>
              </div>
            </label>
          ) : (
            <div className="space-y-4">
              {/* 文件信息与重新选择 */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs">
                <div className="flex items-center space-x-2.5">
                  <FileVideo className="w-4 h-4 text-blue-400" />
                  <span className="font-semibold text-white">{selectedFile.name}</span>
                  <span className="text-slate-500 font-mono">({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)</span>
                </div>
                <label className="text-xs text-blue-400 hover:text-blue-300 font-medium cursor-pointer">
                  重新选择
                  <input type="file" accept="video/mp4,video/quicktime,video/x-msvideo,video/webm" onChange={handleFileChange} className="hidden" />
                </label>
              </div>

              {/* 自动抽取的 6 帧胶卷预览 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-blue-400" />
                    视频关键时间帧提取 (自动生成 6 帧分析胶卷)
                  </span>
                  {isExtractingFrames && (
                    <span className="text-cyan-400 animate-pulse text-[11px]">正在解析视频关键时间帧...</span>
                  )}
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                  {frames.length > 0
                    ? frames.map((frame, idx) => (
                        <div key={idx} className="relative aspect-video rounded-lg overflow-hidden border border-slate-700/80 group">
                          <img src={frame} alt={`Frame ${idx + 1}`} className="w-full h-full object-cover" />
                          <span className="absolute bottom-1 left-1 px-1 py-0.5 rounded bg-black/70 text-[9px] text-cyan-300 font-mono">
                            0{idx + 1}
                          </span>
                        </div>
                      ))
                    : Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="aspect-video rounded-lg bg-slate-900 animate-pulse border border-slate-800 flex items-center justify-center text-[10px] text-slate-600">
                          帧 0{i + 1}
                        </div>
                      ))}
                </div>
              </div>

              {/* 分析参数配置 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-slate-500 mb-1 font-medium">受检设备型号 / 类型：</label>
                  <input
                    type="text"
                    value={deviceModel}
                    onChange={(e) => setDeviceModel(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-200 focus:outline-none focus:border-blue-500"
                    placeholder="如：三相异步电机 Y315M-4 / 离心泵 IS150-125"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1 font-medium">现场异常现象疑问说明：</label>
                  <input
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-200 focus:outline-none focus:border-blue-500"
                    placeholder="如：出现间歇性异响与高频发热震动"
                  />
                </div>
              </div>

              {/* 发起分析按钮 */}
              <div className="pt-2 flex justify-end">
                <button
                  onClick={handleStartAnalysis}
                  disabled={isAnalyzing || isExtractingFrames || frames.length === 0}
                  className="flex items-center space-x-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-blue-500/20 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>{isAnalyzing ? 'AI 多模态分析中...' : '开始多模态智能故障分析'}</span>
                </button>
              </div>

              {/* 智能分析结果展示卡片 */}
              {analysisResult && (
                <div className="card-industrial p-5 bg-gradient-to-br from-slate-900/95 to-blue-950/30 border border-blue-500/40 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center space-x-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      <h4 className="text-sm font-bold text-white">大模型多模态智能诊断报告</h4>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-xs font-mono font-semibold">
                      综合置信度: {(analysisResult.confidence * 100).toFixed(0)}%
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div className="space-y-1">
                      <span className="text-slate-500 font-semibold flex items-center gap-1">
                        <Wrench className="w-3.5 h-3.5 text-blue-400" /> 研判故障部位:
                      </span>
                      <p className="text-slate-100 font-bold bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                        {analysisResult.device_part}
                      </p>
                    </div>

                    <div className="space-y-1">
                      <span className="text-slate-500 font-semibold flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> 观察异常物理现象:
                      </span>
                      <p className="text-slate-200 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                        {analysisResult.phenomenon}
                      </p>
                    </div>
                  </div>

                  {/* 可能原因 */}
                  <div className="space-y-1.5 text-xs">
                    <span className="text-slate-500 font-semibold">潜在根本原因推断 (FTA/FMEA)：</span>
                    <div className="flex flex-wrap gap-2">
                      {analysisResult.causes?.map((c, i) => (
                        <span key={i} className="px-2.5 py-1 rounded-lg bg-red-950/40 text-red-300 border border-red-900/40 text-[11px]">
                          • {c}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* 处置建议 */}
                  <div className="space-y-1.5 text-xs">
                    <span className="text-slate-500 font-semibold flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> 专业检修与预防处置建议：
                    </span>
                    <ul className="space-y-1.5 bg-slate-950/50 p-3 rounded-lg border border-slate-800 text-[11px] text-slate-300">
                      {analysisResult.suggestions?.map((s, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-cyan-400 font-bold">{i + 1}.</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* 一键填入工单 */}
                  {(onApplyDiagnosis || onApplyToWorkOrder) && (
                    <div className="pt-2 flex justify-end">
                      <button
                        onClick={() => {
                          if (onApplyDiagnosis) onApplyDiagnosis(analysisResult);
                          if (onApplyToWorkOrder) onApplyToWorkOrder(analysisResult);
                          onClose();
                        }}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold cursor-pointer shadow-md"
                      >
                        一键将诊断结论带入工单报修
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
