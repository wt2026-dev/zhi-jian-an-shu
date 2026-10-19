/**
 * AI 助手的工作模式面板：MODE 2 故障研判 / MODE 3 视觉识别。
 * 从 AiAssistantView.tsx 整块搬出，JSX 主体**逐字节未改**（连缩进都没动）。
 *
 * 为什么只搬这两个：MODE 1（对话）依赖 43 个标识符且是核心交互流，拆了收益低风险高。
 */
import React from 'react';
import {
  Sparkles,
  Wrench,
  Camera,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Upload,
  Shield,
  Cpu,
  BookOpen,
  ChevronDown,
  Search,
  Loader2,
  Image as ImageIcon,
} from 'lucide-react';
import type { Equipment } from '../../types';

export interface DiagnosisPanelProps {
  activeMode: 'chat' | 'diagnose' | 'vision';
  equipments: Equipment[];
  diagCategory: string;
  setDiagCategory: React.Dispatch<React.SetStateAction<string>>;
  diagEqId: string;
  setDiagEqId: React.Dispatch<React.SetStateAction<string>>;
  diagSymptoms: string;
  setDiagSymptoms: React.Dispatch<React.SetStateAction<string>>;
  diagSafetyConfirmed: boolean;
  setDiagSafetyConfirmed: React.Dispatch<React.SetStateAction<boolean>>;
  diagSafetyNotice: any | null;
  isDiagnosing: boolean;
  diagError: string | null;
  diagResult: any | null;
  diagTraceability: any | null;
  handleRunDiagnosis: () => Promise<void>;
  onCreateWorkOrderFromAi: (title: string, equipmentName: string, description: string) => void;
}

export const DiagnosisPanel: React.FC<DiagnosisPanelProps> = ({
  activeMode,
  equipments,
  diagCategory,
  setDiagCategory,
  diagEqId,
  setDiagEqId,
  diagSymptoms,
  setDiagSymptoms,
  diagSafetyConfirmed,
  setDiagSafetyConfirmed,
  diagSafetyNotice,
  isDiagnosing,
  diagError,
  diagResult,
  diagTraceability,
  handleRunDiagnosis,
  onCreateWorkOrderFromAi,
}) => (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Input Configuration Column */}
          <div className="card-industrial bg-white border border-slate-200 rounded-lg p-5 space-y-4 shadow-sm relative">
            <h3 className="text-sm font-bold text-slate-900 flex items-center">
              <Wrench className="w-4 h-4 mr-2 text-blue-600" />
              故障特征多维录入向导
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-medium mb-1">选择目标设备</label>
                <select
                  value={diagEqId}
                  onChange={(e) => setDiagEqId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-500 text-xs"
                >
                  {equipments.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {eq.name} ({eq.code}) - {eq.workshop}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">设备类别</label>
                <select
                  value={diagCategory}
                  onChange={(e) => setDiagCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-500 text-xs"
                >
                  <option value="泵类设备">泵类设备</option>
                  <option value="压缩机">压缩机</option>
                  <option value="传动减速机">传动减速机</option>
                  <option value="大型电机">大型电机</option>
                  <option value="数控机床">数控机床</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">现场征兆与异响描述 *</label>
                <textarea
                  rows={4}
                  value={diagSymptoms}
                  onChange={(e) => setDiagSymptoms(e.target.value)}
                  placeholder="详细描述异常异响（低频轰鸣/尖锐啸叫）、振动部位、漏油滴速等..."
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 text-xs"
                ></textarea>
              </div>

              <button
                onClick={handleRunDiagnosis}
                disabled={isDiagnosing}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 shadow-xs cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                <span>{isDiagnosing ? '多维故障树诊断中...' : '生成智能研判与处置SOP'}</span>
              </button>
            </div>
          </div>

          {/* Diagnosis Result Column */}
          <div className="lg:col-span-2 space-y-4">
            {!diagResult && diagError && (
              <div className="bg-rose-50 border border-rose-200 rounded-lg p-6 text-center space-y-3">
                <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto" />
                <h3 className="text-sm font-bold text-slate-900">AI 诊断请求失败</h3>
                <p className="text-xs text-rose-700 leading-relaxed break-all">{diagError}</p>
                <p className="text-[11px] text-slate-500">系统已禁止展示任何本地模拟诊断结论，请检查后端 AI 服务配置后重试。</p>
              </div>
            )}
            {diagResult ? (
              <div className="card-industrial bg-white border border-slate-200 rounded-lg p-6 space-y-5 shadow-sm animate-in fade-in duration-200 relative">
                {/* 来源模型 + 版本 + 是否降级元数据栏 */}
                <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-[11px] text-slate-600 flex-wrap gap-2">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-slate-700">来源模型:</span>
                    <span className="font-mono text-blue-700 font-bold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                      {diagTraceability?.model || '未回传模型标识'}
                    </span>
                    <span className="font-semibold text-slate-700">Prompt:</span>
                    <span className="font-mono text-purple-700 font-bold bg-purple-50 px-1.5 py-0.5 rounded border border-purple-100">
                      {diagTraceability?.promptVersion || 'v2.1.0'}
                    </span>
                  </div>
                  <div>
                    {diagSafetyNotice?.degraded ? (
                      <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 font-bold">
                        规则引擎降级兜底
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                        大模型正常输出
                      </span>
                    )}
                  </div>
                </div>

                {/* 工业高风险/降级安全红线警示条 + 强制勾选确认 */}
                {diagSafetyNotice?.required && (
                  <div className="p-4 rounded-xl bg-rose-50 border-2 border-rose-300 space-y-2.5 animate-in fade-in">
                    <div className="flex items-start space-x-2">
                      <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <h4 className="text-xs font-bold text-rose-800 flex items-center">
                          <span>【工业作业安全警示 · 需持证人员复核】</span>
                          {diagSafetyNotice.riskTypes?.length > 0 && (
                            <span className="ml-2 text-[10px] bg-rose-200/80 text-rose-900 px-1.5 py-0.2 rounded font-mono">
                              {diagSafetyNotice.riskTypes.join(' · ')}
                            </span>
                          )}
                        </h4>
                        <p className="text-xs text-rose-700 mt-1 leading-relaxed font-medium">
                          {diagSafetyNotice.reason}
                        </p>
                      </div>
                    </div>

                    {diagSafetyNotice.requiresConfirmation && (
                      <label className="flex items-center space-x-2 pt-2 border-t border-rose-200 text-xs text-rose-900 cursor-pointer font-medium select-none">
                        <input
                          type="checkbox"
                          checked={diagSafetyConfirmed}
                          onChange={(e) => setDiagSafetyConfirmed(e.target.checked)}
                          className="w-4 h-4 text-rose-600 border-rose-300 rounded focus:ring-rose-500 cursor-pointer"
                        />
                        <span>我已知悉此建议涉及高危作业，承诺在持证人员复核前绝不直接施工作业</span>
                      </label>
                    )}
                  </div>
                )}

                {/* Result Title & Urgency */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
                  <div>
                    <span className="text-xs font-semibold text-blue-600">{diagResult.equipmentName}</span>
                    <h3 className="text-base font-bold text-slate-900 mt-0.5">{diagResult.summary}</h3>
                  </div>
                  <div className="flex items-center space-x-2 shrink-0">
                    <span className="text-xs px-2.5 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 font-semibold">
                      {diagResult.severity}
                    </span>
                  </div>
                </div>

                {/* Probable Causes */}
                <div className="space-y-2 text-xs">
                  <h4 className="font-semibold text-slate-800 flex items-center">
                    <AlertTriangle className="w-4 h-4 mr-1.5 text-amber-500" />
                    潜在根本原因概率分布 (Root Causes)
                  </h4>
                  <div className="space-y-1.5">
                    {diagResult.probableCauses?.map((cause: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex justify-between items-center p-2.5 rounded-lg bg-slate-50 border border-slate-200"
                      >
                        <span className="text-slate-800">{cause.cause}</span>
                        <span className="font-mono font-bold text-amber-700">{cause.probability}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recommended SOP Actions */}
                <div className="space-y-2 text-xs">
                  <h4 className="font-semibold text-slate-800 flex items-center">
                    <CheckCircle2 className="w-4 h-4 mr-1.5 text-emerald-600" />
                    标准化处置检修步骤 (SOP) 与安全防范
                  </h4>
                  <div className="space-y-2">
                    {diagResult.recommendedActions?.map((act: any, idx: number) => (
                      <div key={idx} className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                        <div className="font-semibold text-slate-800 flex items-center">
                          <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-700 text-[10px] flex items-center justify-center mr-2 font-bold">
                            {idx + 1}
                          </span>
                          {act.action}
                        </div>
                        {act.safetyNotes && (
                          <p className="text-[11px] text-rose-600 ml-6 font-medium">⚠️ 安全管控: {act.safetyNotes}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Action Footer */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-slate-500">
                    预估检修耗时: <strong className="text-slate-900 font-mono">{diagResult.estimatedRepairTime || '3.5h'}</strong>
                  </span>

                  <button
                    disabled={diagSafetyNotice?.required && diagSafetyNotice?.requiresConfirmation && !diagSafetyConfirmed}
                    onClick={() => {
                      onCreateWorkOrderFromAi(
                        `【AI诊断派单】${diagResult.equipmentName} 异常处置`,
                        diagResult.equipmentName,
                        `${diagResult.summary}\n建议措施: ${diagResult.recommendedActions?.[0]?.action}`
                      );
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Wrench className="w-4 h-4" />
                    <span>采纳诊断结论直接发起工单</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="card-industrial bg-white border border-slate-200 rounded-lg p-12 text-center text-slate-500 shadow-xs relative">
                <Wrench className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <h4 className="text-sm font-semibold text-slate-700">请在左侧填写或修改征兆参数</h4>
                <p className="text-xs text-slate-500 mt-1">点击“生成智能研判”获取 AI 故障根因树与安全 SOP</p>
              </div>
            )}
          </div>
        </div>
);

export interface VisionPanelProps {
  activeMode: 'chat' | 'diagnose' | 'vision';
  diagCategory: string;
  uploadedImageInfo: { url: string; filename: string; size: number } | null;
  customImagePreview: string | null;
  uploadError: string | null;
  isUploadingImage: boolean;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  visionPrompt: string;
  setVisionPrompt: React.Dispatch<React.SetStateAction<string>>;
  isVisionAnalyzing: boolean;
  handleRunVisionAnalysis: () => Promise<void>;
  visionError: string | null;
  visionResult: any | null;
  multimodalVisionDesc: string | null;
  multimodalSafetyHint: string | null;
  multimodalCases: Array<{ id: string; title: string; category: string; targetEquipment?: string; summary: string; content: string }> | null;
  expandedCaseId: string | null;
  setExpandedCaseId: React.Dispatch<React.SetStateAction<string | null>>;
  isSearchingMultimodal: boolean;
  handleRunMultimodalSearch: () => Promise<void>;
  onCreateWorkOrderFromAi: (title: string, equipmentName: string, description: string) => void;
}

export const VisionPanel: React.FC<VisionPanelProps> = ({
  activeMode,
  diagCategory,
  uploadedImageInfo,
  customImagePreview,
  uploadError,
  isUploadingImage,
  handleFileUpload,
  visionPrompt,
  setVisionPrompt,
  isVisionAnalyzing,
  handleRunVisionAnalysis,
  visionError,
  visionResult,
  multimodalVisionDesc,
  multimodalSafetyHint,
  multimodalCases,
  expandedCaseId,
  setExpandedCaseId,
  isSearchingMultimodal,
  handleRunMultimodalSearch,
  onCreateWorkOrderFromAi,
}) => (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Image Selection / Upload */}
          <div className="card-industrial bg-white border border-slate-200 rounded-lg p-5 space-y-4 shadow-sm relative">
            <h3 className="text-sm font-bold text-slate-900 flex items-center">
              <Camera className="w-4 h-4 mr-2 text-blue-600" />
              工业视觉破损识别样本与拍摄
            </h3>

            {/* Upload or Sample Selector */}
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-medium mb-1.5">上传现场拍摄照片</label>
                <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-200 hover:border-blue-400 rounded-lg cursor-pointer bg-slate-50 transition-colors">
                  <Upload className="w-6 h-6 text-slate-500 mb-1" />
                  <span className="text-xs text-slate-700 font-medium">点击选择或拖拽现场拍摄图片</span>
                  <span className="text-[10px] text-slate-500 mt-0.5">支持 JPG、PNG 工业内窥镜/手持照片 (自动保存至 /uploads)</span>
                  <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>

              {isUploadingImage && (
                <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 flex items-center space-x-2 text-[11px] animate-pulse">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>正在上传图片并持久化至服务器存储目录...</span>
                </div>
              )}

              {uploadedImageInfo && (
                <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] space-y-1">
                  <div className="flex items-center text-emerald-700 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                    <span>图片已存储至后端静态目录</span>
                  </div>
                  <div className="font-mono text-slate-600 text-[10px] truncate">
                    路径: {uploadedImageInfo.url}
                  </div>
                </div>
              )}

              {uploadError && (
                <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[11px]">
                  上传警告: {uploadError}
                </div>
              )}

              {/* Image Preview */}
              {customImagePreview ? (
                <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                  <img
                    src={customImagePreview}
                    alt="Inspection Preview"
                    className="w-full h-40 object-cover rounded-md"
                  />
                  <span className="text-[10px] text-emerald-600 mt-1 block font-medium">自定义现场拍摄图片已就绪</span>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                  <span className="text-slate-500 block text-[11px] font-medium">或选择系统典型缺陷样本:</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setVisionPrompt('分析轴承滚道接触疲劳点蚀与滚珠剥落状态')}
                      className="p-2 rounded-md bg-white hover:bg-blue-50 text-left text-slate-700 border border-slate-200 text-[11px] cursor-pointer shadow-xs"
                    >
                      🔩 轴承滚道剥落
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisionPrompt('分析减速机渐开线齿轮轮齿点蚀与齿面裂纹')}
                      className="p-2 rounded-md bg-white hover:bg-blue-50 text-left text-slate-700 border border-slate-200 text-[11px] cursor-pointer shadow-xs"
                    >
                      ⚙️ 齿轮齿面微裂纹
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisionPrompt('分析机械密封动静环端面磨损与积碳泄漏')}
                      className="p-2 rounded-md bg-white hover:bg-blue-50 text-left text-slate-700 border border-slate-200 text-[11px] cursor-pointer shadow-xs"
                    >
                      ⭕ 机械密封端面磨损
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisionPrompt('分析电机定子绝缘漆老化变色与过热烧蚀')}
                      className="p-2 rounded-md bg-white hover:bg-blue-50 text-left text-slate-700 border border-slate-200 text-[11px] cursor-pointer shadow-xs"
                    >
                      ⚡ 电机绕组绝缘烧蚀
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-slate-700 font-medium mb-1">视觉诊断提示指令</label>
                <input
                  type="text"
                  value={visionPrompt}
                  onChange={(e) => setVisionPrompt(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-500 text-xs"
                />
              </div>

              <button
                onClick={handleRunVisionAnalysis}
                disabled={isVisionAnalyzing}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 shadow-xs cursor-pointer disabled:opacity-50"
              >
                <Camera className="w-4 h-4" />
                <span>{isVisionAnalyzing ? '多模态图像视觉识别中...' : '发起 AI 工业缺陷识别'}</span>
              </button>
            </div>
          </div>

          {/* Right: Vision Analysis Result */}
          <div className="lg:col-span-2">
            {!visionResult && visionError && (
              <div className="bg-rose-50 border border-rose-200 rounded-lg p-6 text-center space-y-3">
                <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto" />
                <h3 className="text-sm font-bold text-slate-900">视觉破损识别失败</h3>
                <p className="text-xs text-rose-700 leading-relaxed break-all">{visionError}</p>
                <p className="text-[11px] text-slate-500">系统已禁止展示任何本地模拟诊断结论，请检查后端 AI 服务配置后重试。</p>
              </div>
            )}
            {visionResult ? (
              <div className="card-industrial bg-white border border-slate-200 rounded-lg p-6 space-y-4 shadow-sm animate-in fade-in duration-200 relative">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 flex items-center">
                      <CheckCircle2 className="w-5 h-5 mr-2 text-emerald-600" />
                      工业视觉智能判损报告
                    </h3>
                    <div className="flex items-center space-x-2 mt-1">
                      <span className="text-[11px] text-blue-600 flex items-center font-medium">
                        <Cpu className="w-3.5 h-3.5 mr-1" />
                        {visionResult.modelEngine || '未回传视觉引擎名'}
                      </span>
                      {visionResult.confidence && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-mono font-medium">
                          置信度: {(visionResult.confidence * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 font-semibold">
                    {visionResult.damageLevel}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block text-[11px]">识别损伤类型:</span>
                    <span className="font-bold text-slate-900">{visionResult.defectType}</span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block text-[11px]">受损核心部件:</span>
                    <span className="font-bold text-slate-900">{visionResult.affectedComponent}</span>
                  </div>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1.5">
                  <span className="font-semibold text-slate-800">失效机理与根因分析:</span>
                  <p className="text-slate-700 leading-relaxed">{visionResult.rootCause}</p>
                </div>

                <div className="p-3.5 bg-emerald-50/70 rounded-lg border border-emerald-200 text-xs space-y-1.5">
                  <span className="font-semibold text-emerald-800">维保处置与更换建议:</span>
                  <p className="text-slate-700 leading-relaxed">{visionResult.maintenanceAdvice}</p>
                </div>

                {visionResult.safetyNotice && (
                  <div className="p-3.5 bg-amber-50/70 rounded-lg border border-amber-200 text-xs space-y-1.5">
                    <span className="font-semibold text-amber-800 flex items-center">
                      <Shield className="w-4 h-4 mr-1.5 text-amber-600" />
                      现场安全注意事项:
                    </span>
                    <p className="text-slate-700 leading-relaxed">{visionResult.safetyNotice}</p>
                  </div>
                )}

                <div className="pt-2 flex justify-end space-x-2.5">
                  <button
                    type="button"
                    onClick={handleRunMultimodalSearch}
                    disabled={isSearchingMultimodal}
                    className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer transition-colors"
                  >
                    {isSearchingMultimodal ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>多模态检索中...</span>
                      </>
                    ) : (
                      <>
                        <Search className="w-4 h-4" />
                        <span>🔍 检索知识库相似案例</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      onCreateWorkOrderFromAi(
                        `【视觉缺陷】${visionResult.defectType}`,
                        diagCategory,
                        `【受损部位】${visionResult.affectedComponent}\n【损伤等级】${visionResult.damageLevel}\n【根因研判】${visionResult.rootCause}\n【维保方案】${visionResult.maintenanceAdvice}\n【模型引擎】${visionResult.modelEngine || 'DashScope'}`
                      )
                    }
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer"
                  >
                    <FileText className="w-4 h-4" />
                    <span>采纳视觉诊断并生成抢修工单</span>
                  </button>
                </div>

                {/* 相似案例卡片列表 (功能④ 多模态看图找相似案例) */}
                {multimodalCases !== null && (
                  <div className="mt-4 pt-4 border-t border-slate-200/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-900 flex items-center">
                        <BookOpen className="w-4 h-4 mr-1.5 text-blue-600" />
                        知识库相似案例推荐 ({multimodalCases.length} 篇)
                      </h4>
                      {multimodalVisionDesc && (
                        <span className="text-[10px] text-slate-500">
                          基于视觉特征检索
                        </span>
                      )}
                    </div>

                    {multimodalVisionDesc && (
                      <div className="p-2.5 rounded-lg bg-blue-50/60 border border-blue-100 text-[11px] text-blue-900 leading-relaxed">
                        <span className="font-semibold text-blue-700">视觉特征描述: </span>
                        {multimodalVisionDesc}
                      </div>
                    )}

                    {multimodalSafetyHint && (
                      <div className="p-2.5 rounded-lg bg-amber-50/80 border border-amber-200 text-[11px] text-amber-800 flex items-start space-x-1.5">
                        <Shield className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-semibold">多模态现场安全提示: </span>
                          {multimodalSafetyHint}
                        </div>
                      </div>
                    )}

                    {multimodalCases.length === 0 ? (
                      <div className="text-center py-4 text-slate-500 text-xs">
                        未检索到高相似度的知识库案例
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {multimodalCases.map((item) => (
                          <div
                            key={item.id}
                            className="p-3 bg-slate-50/90 hover:bg-blue-50/40 border border-slate-200/90 hover:border-blue-200 rounded-lg transition-colors text-xs space-y-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-1.5 flex-wrap">
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">
                                  {item.category}
                                </span>
                                {item.targetEquipment && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-medium">
                                    {item.targetEquipment}
                                  </span>
                                )}
                                <span className="font-bold text-slate-900">{item.title}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setExpandedCaseId(expandedCaseId === item.id ? null : item.id)}
                                className="text-blue-600 hover:text-blue-800 text-[11px] font-medium flex items-center space-x-0.5 cursor-pointer ml-2 shrink-0"
                              >
                                <span>{expandedCaseId === item.id ? '收起正文' : '展开查看正文'}</span>
                                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expandedCaseId === item.id ? 'rotate-180' : ''}`} />
                              </button>
                            </div>

                            {item.summary && (
                              <p className="text-slate-600 text-[11px] leading-relaxed">
                                {item.summary}
                              </p>
                            )}

                            {expandedCaseId === item.id && (
                              <div className="mt-2 p-2.5 bg-white rounded border border-slate-200 text-[11px] space-y-2 animate-in fade-in duration-150">
                                <div className="font-semibold text-slate-700">规程/案例正文片段:</div>
                                <div className="whitespace-pre-wrap text-slate-600 font-sans leading-relaxed bg-slate-50 p-2 rounded max-h-48 overflow-y-auto">
                                  {item.content}
                                </div>
                                <div className="flex justify-end pt-1">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onCreateWorkOrderFromAi(
                                        `【参考案例抢修】${item.title}`,
                                        item.targetEquipment || '通用设备',
                                        `参考案例规程《${item.title}》：\n${item.summary}\n\n规程要点：\n${item.content}`
                                      )
                                    }
                                    className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 rounded text-[11px] font-medium cursor-pointer"
                                  >
                                    基于此案例创建工单
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="card-industrial bg-white border border-slate-200 rounded-lg p-12 text-center text-slate-500 shadow-xs relative">
                <ImageIcon className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <h4 className="text-sm font-semibold text-slate-700">暂无视觉识别结果</h4>
                <p className="text-xs text-slate-500 mt-1">请上传现场照片或选择典型样本后点击“发起 AI 工业缺陷识别”</p>
              </div>
            )}
          </div>
        </div>
);
