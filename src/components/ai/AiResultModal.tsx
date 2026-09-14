import React from 'react';
import { X, Sparkles, Loader2, AlertTriangle, Copy, Check } from 'lucide-react';

/**
 * AI 扩展功能通用结果弹窗：
 * - loading 态 / 错误态 (降级提示与调用失败) / 结构化 JSON 数据渲染
 * - renderAiValue 递归渲染：对象→键值小节，数组→列表/卡片，字符串→段落
 * 保持与系统现有暗色工业风一致，仅替换数据来源时零成本复用。
 */

export function renderAiValue(value: any, depth = 0): React.ReactNode {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <span>{String(value)}</span>;
  }

  if (Array.isArray(value)) {
    // 全部为简单值 → 圆点列表
    if (value.every((v) => ['string', 'number', 'boolean'].includes(typeof v))) {
      return (
        <ul className="space-y-1 text-xs text-slate-300">
          {value.map((v, i) => (
            <li key={i} className="flex items-start space-x-1.5">
              <span className="text-cyan-400 mt-0.5 shrink-0">•</span>
              <span>{String(v)}</span>
            </li>
          ))}
        </ul>
      );
    }
    // 对象数组 → 卡片列表
    return (
      <div className="space-y-2">
        {value.map((v, i) => (
          <div key={i} className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-700/70">
            {typeof v === 'object' && v !== null ? (
              depth === 0 ? (
                renderAiObjectEntries(v, depth + 1)
              ) : (
                renderAiValue(v, depth + 1)
              )
            ) : (
              renderAiValue(v, depth + 1)
            )}
          </div>
        ))}
      </div>
    );
  }

  if (typeof value === 'object') {
    return renderAiObjectEntries(value, depth);
  }
  return null;
}

const KEY_LABELS: Record<string, string> = {
  title: '标题', description: '描述', priority: '优先级', priorityReason: '优先级理由',
  suggestedSteps: '建议检修步骤', spareParts: '建议备件清单', estimatedHours: '预计工时(h)',
  summary: '摘要', fiveWhys: '5Why 递进分析', rootCauses: '可能根因排序', correctiveActions: '纠正措施',
  references: '知识库引用', level: '层级', question: '追问', reason: '原因', evidence: '依据',
  type: '类别', cause: '原因', probability: '概率', shortTerm: '短期遏制', longTerm: '长期预防',
  overview: '方案概述', steps: '检修步骤', safetyMeasures: '安全措施', tools: '工具清单',
  qualityCheckpoints: '关键质检点', workers: '作业人数', step: '步骤', operation: '操作要点',
  qualityStandard: '质量标准', lotoPoints: 'LOTO 能量隔离点', ppe: 'PPE 要求', highRiskNotes: '高危作业提示',
  healthRating: '健康评级', ratingReason: '评级理由', trends: '指标趋势', failureRisks: '潜在故障风险',
  watchWindowHours: '关注窗口(小时)', watchWindowNote: '关注窗口说明', recommendations: '建议措施',
  metric: '指标', direction: '方向', rateDescription: '变化速率', mode: '故障模式', basis: '依据',
  highlights: '工作亮点', problems: '存在问题', statistics: '数据统计', topIssues: '重点问题',
  suggestions: '改进建议', markdown: '报告正文', label: '指标', value: '值', count: '数量', analysis: '分析',
  riskLevel: '风险等级', riskReason: '评定理由', hazardIdentifications: '危害辨识', jsaMeasures: 'JSA 控制措施',
  ppeList: 'PPE 清单', lotoAdvice: 'LOTO 隔离建议', approvalFocusPoints: '审批关注点',
  category: '类别', hazard: '危害', control: '控制措施', required: '需要LOTO', isolationPoints: '隔离点',
  lockCount: '锁具数量', name: '名称', spec: '规格', qty: '数量',
};

function keyLabel(key: string): string {
  return KEY_LABELS[key] || key;
}

function renderAiObjectEntries(obj: Record<string, any>, depth: number): React.ReactNode {
  return (
    <div className={`space-y-2 ${depth === 0 ? '' : ''}`}>
      {Object.entries(obj).map(([key, val]) => {
        if (val === null || val === undefined || val === '') return null;
        const isLongText = typeof val === 'string' && val.length > 60;
        return (
          <div key={key}>
            <div className="text-[10px] font-bold text-cyan-400/90 uppercase tracking-wide mb-0.5">
              {keyLabel(key)}
            </div>
            {isLongText ? (
              <pre className="whitespace-pre-wrap text-xs text-slate-300 leading-relaxed bg-slate-950/60 rounded-lg p-2.5 border border-slate-800 font-sans">
                {val}
              </pre>
            ) : (
              <div className="text-xs text-slate-300">{renderAiValue(val, depth + 1)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface AiResultModalProps {
  open: boolean;
  title: string;
  loading: boolean;
  error: string | null;
  degraded?: boolean;
  /** AI 生成内容待管理员审核角标 */
  pendingReview?: boolean;
  data?: any;
  /** 工业安全警示 */
  safetyNotice?: {
    required?: boolean;
    level?: string;
    reason?: string;
    requiresConfirmation?: boolean;
    riskTypes?: string[];
    degraded?: boolean;
  } | null;
  /** 版本与模型追溯信息 */
  traceability?: {
    model?: string;
    promptVersion?: string;
    inputDigest?: string;
    reviewStatus?: string;
  } | null;
  onClose: () => void;
  footer?: React.ReactNode;
  /** 可选：空闲态 (未发起 AI 调用前) 展示的参数配置表单 */
  configForm?: React.ReactNode;
}

export const AiResultModal: React.FC<AiResultModalProps> = ({
  open,
  title,
  loading,
  error,
  degraded,
  pendingReview,
  data,
  safetyNotice: propSafetyNotice,
  traceability: propTraceability,
  onClose,
  footer,
  configForm,
}) => {
  const [copied, setCopied] = React.useState(false);
  const [safetyConfirmed, setSafetyConfirmed] = React.useState(false);

  // 自动从 data 中提取 safetyNotice 和 traceability（若未显式传入）
  const effectiveSafetyNotice = propSafetyNotice || data?.safetyNotice || null;
  const effectiveTraceability = propTraceability || data?.traceability || null;
  const isDegraded = degraded || effectiveSafetyNotice?.degraded || data?.degraded;

  if (!open) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(data?.markdown || JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl max-w-2xl w-full max-h-[88vh] flex flex-col shadow-2xl shadow-cyan-950/40">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
            <div className="p-1.5 rounded-lg bg-gradient-to-tr from-cyan-600 to-blue-500">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <h3 className="text-sm font-bold text-slate-100">{title}</h3>
            {isDegraded && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold">
                规则引擎兜底
              </span>
            )}
            {pendingReview && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 font-semibold animate-pulse">
                待管理员审核
              </span>
            )}
            {effectiveTraceability && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                {effectiveTraceability.model || 'model'} · {effectiveTraceability.promptVersion || 'v2.1.0'}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-1.5">
            {data && !loading && (
              <button
                onClick={handleCopy}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-500 hover:text-white transition-colors cursor-pointer"
                title="复制结果"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-500 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex flex-col items-center justify-center py-14 space-y-3 text-slate-500">
              <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
              <p className="text-xs font-medium">AI 正在基于真实业务数据深度分析中，请稍候 (约 10~30 秒)...</p>
            </div>
          )}

          {!loading && error && (
            <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/40 space-y-2">
              <div className="flex items-center space-x-2 text-rose-300 text-xs font-semibold">
                <AlertTriangle className="w-4 h-4" />
                <span>{degraded ? 'AI 功能暂不可用' : 'AI 调用失败'}</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{error}</p>
            </div>
          )}

          {!loading && !error && data && (
            <div className="space-y-4">
              {/* 高风险/规则兜底工业安全红线警示条 */}
              {effectiveSafetyNotice?.required && (
                <div className="p-4 rounded-xl bg-rose-950/60 border-2 border-rose-500/80 space-y-2.5 animate-in fade-in">
                  <div className="flex items-start space-x-2.5">
                    <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold text-rose-200">
                          【工业安全警示 · 需持证人员复核】
                        </span>
                        {effectiveSafetyNotice.riskTypes?.length > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-900/80 border border-rose-700 text-rose-300 font-mono">
                            {effectiveSafetyNotice.riskTypes.join(' · ')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-rose-300 mt-1 leading-relaxed font-medium">
                        {effectiveSafetyNotice.reason}
                      </p>
                    </div>
                  </div>

                  {effectiveSafetyNotice.requiresConfirmation && (
                    <label className="flex items-center space-x-2 pt-2 border-t border-rose-800/80 text-xs text-rose-200 cursor-pointer select-none font-medium">
                      <input
                        type="checkbox"
                        checked={safetyConfirmed}
                        onChange={(e) => setSafetyConfirmed(e.target.checked)}
                        className="w-4 h-4 text-rose-500 border-rose-400 rounded focus:ring-rose-400 bg-slate-900 cursor-pointer"
                      />
                      <span>我已知悉此建议涉及高危作业，承诺在持证人员复核前绝不直接施工作业</span>
                    </label>
                  )}
                </div>
              )}

              <div className="space-y-3">{renderAiObjectEntries(data, 0)}</div>
            </div>
          )}

          {!loading && !error && !data && configForm}
        </div>

        {/* Footer */}
        {footer && !loading && (
          <div className="px-5 py-3 border-t border-slate-800 shrink-0 flex items-center justify-end space-x-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
