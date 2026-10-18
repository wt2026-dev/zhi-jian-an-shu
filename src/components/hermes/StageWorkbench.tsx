import React, { useState } from 'react';
import {
  Sparkles,
  Lock,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  ShieldCheck,
  FileText,
  Loader2,
  Wrench,
  Check,
  Eye,
  X,
  Clock
} from 'lucide-react';
import type {
  BusinessClosedLoopData,
  LotoConfirmationItem,
  Stage1Prefill,
  Stage2Prefill,
  Stage3Prefill,
  Stage4Prefill,
  Stage5Prefill,
  Stage6Prefill,
  StageId,
  StageStepMeta,
} from './types';
import { useToast } from '../../context/ToastContext';

interface StageWorkbenchProps {
  currentStageId: StageId | null;
  stages: StageStepMeta[];
  lotoItems: LotoConfirmationItem[];
  loopData: BusinessClosedLoopData;
  canOperate: boolean;
  busy?: boolean;
  onToggleLotoItem: (itemId: string, confirmed: boolean) => void;
  onAdvanceStage: (stageNo: number) => void;
  onNavigateToTab?: (tabKey: string) => void;
}

/** 环节说明取自服务端 STAGE_DEFS（与 aiBadge/outputSummary 同源），不在前端另写一套 */
const STAGE_INTRO: Record<StageId, string> = {
  stage_report: '遥测越限与业务目标自动生成报修工单草稿，人工核对确认后落库为真实工单',
  stage_permit: '作业安全分析 (JSA) 识别危险能量与控制措施，确认后落成真实作业票（待双人会签）',
  stage_loto: '按 GB/T 33579 推演隔离点并匹配台账真实锁具，须现场逐项人工确认方可开工',
  stage_execution: '依据设备档案与历史检修记录生成检修方案，确认后转为作业指引档案',
  stage_completion: '引用真实工单状态与台账遥测基线生成完工验收记录',
  stage_archive: '汇总全链路数据生成质检报告，并判定是否沉淀知识条目入知识库',
};

const fmtClock = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const StageWorkbench: React.FC<StageWorkbenchProps> = ({
  currentStageId,
  stages,
  lotoItems,
  loopData,
  canOperate,
  busy,
  onToggleLotoItem,
  onAdvanceStage,
  onNavigateToTab,
}) => {
  const { show: showToast } = useToast();
  const [showAiReasonModal, setShowAiReasonModal] = useState(false);

  const currentStage = stages.find((s) => s.id === currentStageId) || null;
  const activeStage = stages.find((s) => s.status === 'in_progress') || null;
  const confirmedCount = lotoItems.filter((i) => i.confirmed).length;
  const isAllConfirmed = lotoItems.length > 0 && confirmedCount === lotoItems.length;

  if (!currentStage) {
    return (
      <div className="rounded-2xl bg-white/95 border border-slate-200/90 shadow-sm p-6 text-sm text-slate-500">
        请在上方路线条选择要查看的环节。
      </div>
    );
  }

  const prefill = currentStage.aiPrefill || {};
  const isViewingActive = activeStage?.id === currentStage.id && currentStage.status === 'in_progress';
  const hasEquipment = loopData.equipment.id !== '';

  const handleAdvance = () => {
    if (!canOperate) {
      showToast({ type: 'warning', title: '当前角色无确认权限', message: '确认推进需 admin / manager / technician 角色', duration: 3500 });
      return;
    }
    if (!isViewingActive) {
      showToast({
        type: 'warning',
        title: '环节顺序校验未通过',
        message: activeStage ? `服务端进行中的环节是「${activeStage.title}」，请先完成该环节确认` : '六个环节均已确认，请直接执行归档',
        duration: 4000,
      });
      return;
    }
    if (currentStage.id === 'stage_loto' && !isAllConfirmed) {
      showToast({
        type: 'warning',
        title: '关键安全环节未确认',
        message: `LOTO 能量隔离要求 100% 确认（当前 ${confirmedCount}/${lotoItems.length} 项），请现场逐项勾选后再推进`,
        duration: 4000,
      });
      return;
    }
    onAdvanceStage(currentStage.order);
  };

  return (
    <div className="rounded-2xl bg-white/95 border border-slate-200/90 shadow-sm p-4 sm:p-5 lg:p-6 backdrop-blur-md flex flex-col justify-between space-y-5">
      {/* 顶部环节标题栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200/80">
              环节 {currentStage.order}/6
            </span>
            <h2 className="text-base font-bold text-slate-900 tracking-tight">{currentStage.title}</h2>
            <span className="text-slate-300">·</span>
            <span className="text-xs text-slate-500">
              对应页面：<strong className="text-slate-700">{currentStage.targetPage}</strong>
            </span>
            <StageStatusBadge status={currentStage.status} />
          </div>
          <p className="text-xs text-slate-500 mt-1">{STAGE_INTRO[currentStage.id]}</p>
        </div>

        {onNavigateToTab && (
          <button
            type="button"
            onClick={() => onNavigateToTab(currentStage.targetTabKey)}
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium px-2.5 py-1.5 rounded-lg hover:bg-blue-50 border border-transparent hover:border-blue-200 transition-colors cursor-pointer self-start sm:self-center"
          >
            <span>前往「{currentStage.targetPage}」</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* AI 预填状态条：真实引擎名 + ok/degraded 如实标注 */}
      <PrefillBanner stage={currentStage} waitingPrefill={!prefill.engine && currentStage.order <= 4} />

      {/* 环节 3：LOTO 能量隔离（隔离点与锁号全部来自服务端预填 + 现场确认） */}
      {currentStage.id === 'stage_loto' && (
        <div className="space-y-4">
          <StructuredBlock
            title={`LOTO 能量隔离确认矩阵（${lotoItems.length} 个隔离点）`}
            icon={<Lock className="w-3.5 h-3.5 text-blue-600" />}
            note={(currentStage.aiPrefill?.raw as Stage3Prefill | undefined)?.note}
          >
            {lotoItems.length === 0 ? (
              <EmptyLine text="服务端尚未回写隔离点：环节 2 的 JSA 评估未输出 lotoAdvice 时，请前往「安全与LOTO」页按现场实际补充隔离方案后再确认。" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200/80">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50/50 text-slate-500 border-b border-slate-100 font-medium">
                      <th className="py-2.5 px-3 w-24">隔离类型</th>
                      <th className="py-2.5 px-3 w-40">隔离点</th>
                      <th className="py-2.5 px-3 min-w-[200px]">操作要求与规范</th>
                      <th className="py-2.5 px-3 w-28">锁具/牌号</th>
                      <th className="py-2.5 px-3 w-28 text-center">确认勾选</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {lotoItems.map((item) => (
                      <tr key={item.id} className={`transition-colors ${item.confirmed ? 'bg-emerald-50/20' : 'bg-amber-50/15'}`}>
                        <td className="py-3 px-3 font-semibold text-slate-800">
                          <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium ${typeChip(item.type)}`}>
                            {item.type}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-medium text-slate-900">
                          {item.point}
                          {item.basis === '类别规则兜底' && (
                            <span className="mt-1 block text-[11px] font-normal text-amber-700">类别规则推演，点位编号需现场核对</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-slate-600 leading-relaxed">{item.requirement}</td>
                        <td className="py-3 px-3 font-mono text-[11px] text-slate-500">
                          <span className="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200/70">
                            {item.lockNumber || '现场登记'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <label className="inline-flex items-center justify-center cursor-pointer p-1">
                            <input
                              type="checkbox"
                              checked={item.confirmed}
                              disabled={!canOperate || currentStage.status === 'completed' || busy}
                              onChange={() => onToggleLotoItem(item.id, !item.confirmed)}
                              className="sr-only"
                            />
                            <div
                              className={`w-5 h-5 rounded flex items-center justify-center transition-all ${
                                item.confirmed
                                  ? 'bg-emerald-500 text-white shadow-2xs'
                                  : 'border-2 border-slate-300 bg-white hover:border-blue-500'
                              }`}
                            >
                              {item.confirmed && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                            </div>
                          </label>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {item.confirmed ? `${item.operator || '已确认'} ${item.confirmTime || ''}` : '点击确认'}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </StructuredBlock>

          <div
            className={`p-3 rounded-xl border flex items-center justify-between text-xs transition-colors ${
              isAllConfirmed ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-amber-50/80 text-amber-900 border-amber-200/80'
            }`}
          >
            <div className="flex items-center gap-2">
              {isAllConfirmed ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              )}
              <span>
                关键安全环节需人工逐项确认 · <strong>当前已确认 {confirmedCount}/{lotoItems.length} 项</strong>
              </span>
            </div>
            <span className="text-[11px] font-semibold">
              {isAllConfirmed ? '安全核准已满足，允许推进下发检修' : '服务端闸门会拒绝未满 100% 的推进请求'}
            </span>
          </div>

          <StandardsList raw={currentStage.aiPrefill?.raw as Stage3Prefill | undefined} />
        </div>
      )}

      {/* 环节 1：现场报修（generate-work-order 草稿） */}
      {currentStage.id === 'stage_report' && (
        <div className="space-y-4">
          {prefill.engine ? (
            <StructuredBlock title="工单草稿（AI 预填，确认后才落库）" icon={<FileText className="w-3.5 h-3.5 text-blue-600" />}>
              <DraftGrid
                items={[
                  { label: '工单标题', value: (prefill.raw as Stage1Prefill)?.workOrderDraft?.title },
                  { label: '故障类型', value: (prefill.raw as Stage1Prefill)?.workOrderDraft?.faultType },
                  { label: '优先级', value: (prefill.raw as Stage1Prefill)?.workOrderDraft?.priority },
                  { label: '预计工时', value: (prefill.raw as Stage1Prefill)?.workOrderDraft?.estimatedHours != null ? `${(prefill.raw as Stage1Prefill)?.workOrderDraft?.estimatedHours} 小时` : undefined },
                ]}
              />
              <Para label="现场情况描述" text={(prefill.raw as Stage1Prefill)?.workOrderDraft?.description} />
              <ListBlock label="AI 建议工序" items={(prefill.raw as Stage1Prefill)?.workOrderDraft?.recommendedSteps} />
              <ListBlock label="开工前安全注意" items={(prefill.raw as Stage1Prefill)?.workOrderDraft?.safetyNotes} />
            </StructuredBlock>
          ) : (
            <EmptyBlock text="工单草稿尚未回写，AI 能力调用完成后自动出现在这里。" />
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <Field label="业务目标" value={loopData.businessGoal} />
            <Field label="识别设备" value={hasEquipment ? `${loopData.equipment.name}（${loopData.equipment.code}）` : '未识别到台账设备'} />
            <Field label="关联工单" value={loopData.artifacts.find((a) => a.category === '检修工单' && a.status === 'ready')?.code || '确认环节 1 后生成'} />
          </div>
        </div>
      )}

      {/* 环节 2：高危作业票（safety-risk-assessment JSA） */}
      {currentStage.id === 'stage_permit' && (
        <div className="space-y-4">
          {prefill.engine ? (
            <StructuredBlock title="作业安全分析 JSA（确认后才落库为作业票）" icon={<ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />}>
              <DraftGrid
                items={[
                  { label: '风险等级', value: (prefill.raw as Stage2Prefill)?.assessment?.riskLevel },
                  { label: '判定理由', value: (prefill.raw as Stage2Prefill)?.assessment?.riskReason },
                ]}
              />
              <ListBlock
                label="危险源辨识"
                items={(prefill.raw as Stage2Prefill)?.assessment?.hazardIdentifications?.map(
                  (h) => `${h.category || '危险源'}：${h.hazard || ''}${h.level ? `（等级 ${h.level}）` : ''}`,
                )}
              />
              <ListBlock
                label="控制措施"
                items={(prefill.raw as Stage2Prefill)?.assessment?.jsaMeasures?.map((m) => `${m.hazard || ''}：${m.control || ''}`)}
              />
              <ListBlock
                label="LOTO 建议"
                items={(prefill.raw as Stage2Prefill)?.assessment?.lotoAdvice?.isolationPoints}
              />
            </StructuredBlock>
          ) : (
            <EmptyBlock text="JSA 评估尚未回写。" />
          )}
          <Field
            label="关联作业票"
            value={loopData.artifacts.find((a) => a.category === '安全许可' && a.status === 'ready')?.code || '确认环节 2 后生成（状态 pending_approval，需双人会签）'}
          />
        </div>
      )}

      {/* 环节 4：检修执行（generate-maintenance-plan） */}
      {currentStage.id === 'stage_execution' && (
        <div className="space-y-4">
          {prefill.engine ? (
            <StructuredBlock title="检修方案与作业步骤（AI 预填）" icon={<Wrench className="w-3.5 h-3.5 text-indigo-600" />}>
              <Para label="方案概述" text={(prefill.raw as Stage4Prefill)?.plan?.overview} />
              <ListBlock
                label="作业步骤与验收标准"
                items={(prefill.raw as Stage4Prefill)?.plan?.steps?.map(
                  (s) => `${s.step ?? ''}. ${s.operation || ''}${s.qualityStandard ? `（验收：${s.qualityStandard}）` : ''}`,
                )}
              />
              <ListBlock
                label="备件与工具"
                items={(prefill.raw as Stage4Prefill)?.plan?.spareParts?.map((p) => `${p.name || ''}${p.spec ? `（${p.spec}）` : ''}×${p.qty ?? 1}`)}
              />
              <ListBlock label="PPE 要求" items={(prefill.raw as Stage4Prefill)?.plan?.safetyMeasures?.ppe} />
              <DraftGrid
                items={[
                  { label: '预估工时', value: (prefill.raw as Stage4Prefill)?.plan?.estimatedHours != null ? `${(prefill.raw as Stage4Prefill)?.plan?.estimatedHours} 小时` : undefined },
                  { label: '作业人数', value: (prefill.raw as Stage4Prefill)?.plan?.workers != null ? `${(prefill.raw as Stage4Prefill)?.plan?.workers} 人` : undefined },
                ]}
              />
            </StructuredBlock>
          ) : (
            <EmptyBlock text="检修方案尚未回写。" />
          )}
        </div>
      )}

      {/* 环节 5：完工 */}
      {currentStage.id === 'stage_completion' && (
        <div className="space-y-4">
          <StructuredBlock title="完工验收记录（引用真实工单状态与台账遥测基线）" icon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}>
            <Para label="验收摘要" text={(prefill.raw as Stage5Prefill)?.acceptanceSummary || prefill.content} />
            <ListBlock
              label="修前基线（设备台账真实遥测）"
              items={
                hasEquipment
                  ? [
                      `轴承温度 ${loopData.equipment.temperature}°C（经验限值 ${loopData.equipment.temperatureThreshold}°C）`,
                      `振动 RMS ${loopData.equipment.vibration} mm/s`,
                      `负载率 ${loopData.equipment.loadRate}%`,
                      `健康分 ${loopData.equipment.healthScore}`,
                    ]
                  : ['未识别到台账设备，无遥测基线']
              }
            />
          </StructuredBlock>
          <Field
            label="验收记录档案"
            value={loopData.artifacts.find((a) => a.category === '现场验收' && a.status === 'ready')?.code || '确认环节 5 后生成'}
          />
        </div>
      )}

      {/* 环节 6：质检归档 */}
      {currentStage.id === 'stage_archive' && (
        <div className="space-y-4">
          <StructuredBlock title="质检归档与知识沉淀" icon={<Sparkles className="w-3.5 h-3.5 text-indigo-600" />}>
            <Para
              label="质检报告"
              text={loopData.artifacts.find((a) => a.category === '质量评估' && a.status === 'ready')?.previewContent || '执行归档后由 generate-report 生成'}
            />
            <Para
              label="知识沉淀判定"
              text={
                (prefill.raw as Stage6Prefill)?.contribution
                  ? `${(prefill.raw as Stage6Prefill)?.contribution?.worthContributing ? '已达沉淀标准，' : '未达沉淀标准，'}${(prefill.raw as Stage6Prefill)?.contribution?.title || (prefill.raw as Stage6Prefill)?.contribution?.message || ''}`
                  : '执行归档后由 suggest-contribution 判定并写入知识贡献审核台'
              }
            />
          </StructuredBlock>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            归档请求会校验六个环节是否全部人工确认；未全部确认时服务端直接拒绝（HTTP 400），前端不做假成功。
          </p>
        </div>
      )}

      {/* 底部操作区 */}
      <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setShowAiReasonModal(true)}
          className="w-full sm:w-auto flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-blue-700 bg-blue-50/70 border border-blue-200/70 hover:bg-blue-100 transition-colors cursor-pointer"
        >
          <Eye className="w-3.5 h-3.5 text-blue-600" />
          <span>查看 AI 依据原文</span>
        </button>

        <button
          type="button"
          onClick={handleAdvance}
          disabled={busy || !isViewingActive}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-800 shadow-sm hover:shadow transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          <span>{isViewingActive ? '确认并推进环节 →' : `服务端进行中为第 ${activeStage?.order ?? '—'} 环节`}</span>
          {isViewingActive && <ArrowRight className="w-4 h-4" />}
        </button>
      </div>

      {/* 弹窗：AI 依据原文（服务端 ai_prefill_json 真实内容） */}
      {showAiReasonModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200/80">
                  <Sparkles className="w-4 h-4 text-[#E8A33D]" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">环节 {currentStage.order} AI 依据原文</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAiReasonModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <MetaChip label="AI 能力" value={prefill.engine || '未回写'} />
                <MetaChip label="结果状态" value={prefill.status === 'degraded' ? 'degraded（降级兜底）' : prefill.status === 'ok' ? 'ok' : '—'} />
                <MetaChip label="回写时间" value={fmtClock(prefill.generatedAt) || '—'} />
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                以下原文来自 business_loop_stages.ai_prefill_json，为服务端真实调用结果；degraded 表示 AI 未产出可信结构化结果，
                需人工核校后方可确认。
              </p>
              <pre className="p-3 rounded-xl bg-slate-50 border border-slate-200/70 text-[11px] font-mono text-slate-700 max-h-[50vh] overflow-auto whitespace-pre-wrap break-all">
                {JSON.stringify(prefill.raw ?? { message: '该环节暂无 AI 预填内容' }, null, 2)}
              </pre>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowAiReasonModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
              >
                已知晓关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function StageStatusBadge({ status }: { status: StageStepMeta['status'] }) {
  const map = {
    completed: { text: '已人工确认', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200/80' },
    in_progress: { text: '进行中', cls: 'bg-blue-50 text-blue-700 border-blue-200/80' },
    pending: { text: '待开始', cls: 'bg-slate-50 text-slate-500 border-slate-200/80' },
  } as const;
  const m = map[status];
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${m.cls}`}>{m.text}</span>;
}

/** AI 预填状态条：引擎名、真实回写时间、ok/degraded 明示；degraded 不得伪装成成功 */
function PrefillBanner({ stage, waitingPrefill }: { stage: StageStepMeta; waitingPrefill: boolean }) {
  const prefill = stage.aiPrefill || {};
  if (waitingPrefill) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs text-slate-600 flex items-center gap-2">
        <Clock className="w-3.5 h-3.5 text-slate-400" />
        <span>该环节的 AI 预填仍在服务端排队（创建闭环后异步调用），结果回写后自动展示。</span>
      </div>
    );
  }
  if (!prefill.engine) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs text-slate-600">
        该环节不走 AI 预填：{prefill.content || '由现场人工完成后确认'}。
      </div>
    );
  }
  const degraded = prefill.status === 'degraded';
  return (
    <div
      className="relative overflow-hidden rounded-xl p-4 border"
      style={
        degraded
          ? { backgroundColor: 'rgba(244, 63, 94, 0.06)', borderColor: 'rgba(244, 63, 94, 0.35)' }
          : { backgroundColor: 'rgba(232, 163, 61, 0.08)', borderColor: 'rgba(232, 163, 61, 0.4)' }
      }
    >
      <div className="flex items-start gap-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 shadow-xs"
          style={{ backgroundColor: degraded ? '#E11D48' : '#E8A33D' }}
        >
          {degraded ? <AlertTriangle className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
        </div>
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded ${degraded ? 'text-rose-900 bg-rose-100' : 'text-amber-900'}`}
              style={degraded ? undefined : { backgroundColor: 'rgba(232, 163, 61, 0.25)' }}
            >
              {degraded ? 'AI 降级结果' : 'AI 已预填'}
            </span>
            <span className={`text-[11px] font-mono ${degraded ? 'text-rose-800' : 'text-amber-800'}`}>
              {prefill.engine}
              {fmtClock(prefill.generatedAt) ? ` · ${fmtClock(prefill.generatedAt)} 回写` : ''}
            </span>
          </div>
          {prefill.content && (
            <p className="text-xs sm:text-sm text-slate-800 font-medium leading-relaxed">{prefill.content}</p>
          )}
        </div>
      </div>
      {prefill.advice && (
        <pre className="mt-3 text-[11px] text-slate-600 leading-relaxed whitespace-pre-wrap font-sans border-t border-slate-200/60 pt-2">
          {prefill.advice}
        </pre>
      )}
    </div>
  );
}

function StructuredBlock({
  title,
  icon,
  note,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-blue-200/80 bg-blue-50/40 p-4 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
          {icon}
          {title}
        </span>
      </div>
      {note && <p className="text-[11px] text-slate-500 leading-relaxed">{note}</p>}
      {children}
    </div>
  );
}

function DraftGrid({ items }: { items: Array<{ label: string; value?: string | number | null }> }) {
  const filled = items.filter((i) => i.value !== undefined && i.value !== null && String(i.value) !== '');
  if (!filled.length) return <EmptyLine text="AI 未输出结构化字段，请人工核对后在对应业务页补录。" />;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
      {filled.map((i) => (
        <div key={i.label} className="p-2.5 rounded-lg bg-white/80 border border-slate-200/70">
          <div className="text-slate-400 text-[11px]">{i.label}</div>
          <div className="font-semibold text-slate-800 mt-0.5">{String(i.value)}</div>
        </div>
      ))}
    </div>
  );
}

function Para({ label, text }: { label: string; text?: string | null }) {
  if (!text) return null;
  return (
    <p className="text-xs text-slate-700 leading-relaxed">
      <strong>{label}：</strong>
      {text}
    </p>
  );
}

function ListBlock({ label, items }: { label: string; items?: string[] }) {
  const list = (items || []).filter((x) => String(x || '').trim() !== '');
  if (!list.length) return null;
  return (
    <div className="text-xs text-slate-700 space-y-1">
      <div className="font-semibold text-slate-800">{label}</div>
      <ul className="space-y-1">
        {list.map((item, idx) => (
          <li key={idx} className="flex gap-1.5 leading-relaxed">
            <span className="text-blue-500 shrink-0">·</span>
            <span className="text-slate-600">{String(item)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
      <div className="text-slate-400 text-[11px]">{label}</div>
      <div className="font-semibold text-slate-800 mt-0.5 break-all">{value || '—'}</div>
    </div>
  );
}

function StandardsList({ raw }: { raw?: Stage3Prefill }) {
  const standards = raw?.standards || [];
  if (!standards.length) return null;
  return (
    <div className="text-[11px] text-slate-500 space-y-0.5">
      {standards.map((s) => (
        <div key={s} className="flex items-center gap-1.5">
          <ShieldCheck className="w-3 h-3 text-emerald-600 shrink-0" />
          <span>{s}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4 text-xs text-slate-500">{text}</div>;
}

function EmptyLine({ text }: { text: string }) {
  return <p className="text-[11px] text-slate-500 leading-relaxed">{text}</p>;
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-white text-slate-700 border border-slate-200/80">
      <span className="text-slate-400">{label}</span>
      <span className="font-mono">{value}</span>
    </span>
  );
}

function typeChip(type: string) {
  if (type === '电气隔离') return 'bg-blue-50 text-blue-700 border border-blue-200/60';
  if (type === '气源隔离') return 'bg-cyan-50 text-cyan-700 border border-cyan-200/60';
  if (type === '残余能量') return 'bg-amber-50 text-amber-700 border border-amber-200/60';
  if (type === '液压隔离') return 'bg-sky-50 text-sky-700 border border-sky-200/60';
  return 'bg-slate-50 text-slate-600 border border-slate-200/60';
}
