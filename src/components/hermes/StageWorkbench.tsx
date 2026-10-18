import React, { useMemo, useState } from 'react';
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
  Eye,
  X,
  PencilLine,
  Plus
} from 'lucide-react';
import type {
  BusinessClosedLoopData,
  LotoConfirmationItem,
  LotoFieldDraft,
  Stage1Prefill,
  Stage2Prefill,
  Stage3Prefill,
  Stage4Prefill,
  Stage5Prefill,
  Stage6Prefill,
  StageHumanEdits,
  StageId,
  StageStepMeta,
} from './types';
import { useToast } from '../../context/ToastContext';
import {
  EMPTY_EDIT_SPECS,
  LOTO_TYPES,
  STAGE_EDIT_SPECS,
  STAGE_INTRO,
  fmtClock,
  groupValue,
} from './stageEditSpecs';
import { PrefillBanner, RevisionLedger, RevisionRecordBanner, StageStatusBadge } from './StagePrefillParts';
import { EditForm, LabeledInput } from './StageEditForm';
import { LotoRowEditor } from './LotoRowEditor';
import {
  EmptyBlock,
  EmptyLine,
  Field,
  ListBlock,
  MetaChip,
  Para,
  RevertButton,
  StandardsList,
  StructuredBlock,
} from './StageAtoms';

interface StageWorkbenchProps {
  currentStageId: StageId | null;
  stages: StageStepMeta[];
  lotoItems: LotoConfirmationItem[];
  loopData: BusinessClosedLoopData;
  canOperate: boolean;
  busy?: boolean;
  onToggleLotoItem: (itemId: string, confirmed: boolean, fields?: LotoFieldDraft) => void;
  onAddLotoItem: (fields: { type: string; point: string; requirement?: string; lockNumber?: string }) => void;
  onAdvanceStage: (stageNo: number, edits?: StageHumanEdits) => void;
  onNavigateToTab?: (tabKey: string) => void;
}

export const StageWorkbench: React.FC<StageWorkbenchProps> = ({
  currentStageId,
  stages,
  lotoItems,
  loopData,
  canOperate,
  busy,
  onToggleLotoItem,
  onAddLotoItem,
  onAdvanceStage,
  onNavigateToTab,
}) => {
  const { show: showToast } = useToast();
  const [showAiReasonModal, setShowAiReasonModal] = useState(false);
  /** 人工修订表单（确认前只存本地，点「确认并推进」才随 edits 提交） */
  const [form, setForm] = useState<Record<string, string>>({});
  const [lotoForm, setLotoForm] = useState<Record<string, LotoFieldDraft>>({});
  const [showLotoAdd, setShowLotoAdd] = useState(false);
  const [lotoAddForm, setLotoAddForm] = useState<{ type: string; point: string; requirement: string; lockNumber: string }>({
    type: '电气隔离',
    point: '',
    requirement: '',
    lockNumber: '',
  });

  const currentStage = stages.find((s) => s.id === currentStageId) || null;
  const activeStage = stages.find((s) => s.status === 'in_progress') || null;
  const confirmedCount = lotoItems.filter((i) => i.confirmed).length;
  const isAllConfirmed = lotoItems.length > 0 && confirmedCount === lotoItems.length;

  // 切换环节 / 服务端回写新预填后丢弃旧表单，避免把上一环节的修订带到下一环节。
  // 用「渲染期对齐 key」而不是 useEffect：effect 里 setState 会多渲染一轮，
  // 那半帧里挂着的是上一环节的表单值，确认按钮的处数提示会闪。
  const stageResetKey = `${currentStage?.id}|${currentStage?.aiPrefill?.generatedAt}|${currentStage?.status}`;
  const [appliedResetKey, setAppliedResetKey] = useState(stageResetKey);
  if (appliedResetKey !== stageResetKey) {
    setAppliedResetKey(stageResetKey);
    setForm({});
    setLotoForm({});
    setShowLotoAdd(false);
  }

  const prefill = currentStage?.aiPrefill || {};
  // specs 必须是稳定引用（空数组也复用同一个），否则 dirtyKeys 的 useMemo 每帧都重算
  const specs = useMemo(
    () => (currentStage ? (STAGE_EDIT_SPECS[currentStage.id] ?? EMPTY_EDIT_SPECS) : EMPTY_EDIT_SPECS),
    [currentStage],
  );
  const isViewingActive = !!activeStage && !!currentStage && activeStage.id === currentStage.id && currentStage.status === 'in_progress';
  const canEdit = canOperate && isViewingActive;
  const hasEquipment = loopData.equipment.id !== '';

  const dirtyKeys = useMemo(
    () =>
      specs
        .map((f) => `${f.group}.${f.key}`)
        .filter((id) => id in form)
        .filter((id) => {
          const spec = specs.find((f) => `${f.group}.${f.key}` === id)!;
          const next = (form[id] ?? '').trim();
          const base = groupValue(prefill.raw, spec.group, spec.key).trim();
          if (spec.kind === 'number') {
            const n = Number(next);
            return !!next && Number.isFinite(n) && String(n) !== base;
          }
          return next !== base;
        }),
    [specs, form, prefill.raw],
  );

  const buildEdits = (): StageHumanEdits => {
    const out: Record<string, Record<string, any>> = {};
    for (const f of specs) {
      const id = `${f.group}.${f.key}`;
      if (!(id in form)) continue;
      const rawVal = (form[id] ?? '').trim();
      const base = groupValue(prefill.raw, f.group, f.key).trim();
      if (f.kind === 'number') {
        const n = Number(rawVal);
        if (!rawVal || !Number.isFinite(n)) continue;
        if (String(n) === base) continue;
        (out[f.group] ||= {})[f.key] = n;
        continue;
      }
      if (!rawVal || rawVal === base) continue;
      (out[f.group] ||= {})[f.key] = rawVal;
    }
    return out as StageHumanEdits;
  };

  if (!currentStage) {
    return (
      <div className="rounded-2xl bg-white/95 border border-slate-200/90 shadow-sm p-6 text-sm text-slate-500">
        请在上方路线条选择要查看的环节。
      </div>
    );
  }

  const lotoChangedFields = (item: LotoConfirmationItem): LotoFieldDraft | undefined => {
    const draft = lotoForm[item.id];
    if (!draft) return undefined;
    const changed: LotoFieldDraft = {};
    (['type', 'point', 'requirement', 'lockNumber', 'operator'] as const).forEach((key) => {
      const next = String(draft[key] ?? '').trim();
      const base = String((item as any)[key] ?? '').trim();
      if (next && next !== base) (changed as any)[key] = next;
    });
    return Object.keys(changed).length ? changed : undefined;
  };

  const dirtyLotoCount = lotoItems.filter((i) => lotoChangedFields(i)).length;

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
    const edits = buildEdits();
    const editCount = Object.values(edits).reduce((acc, g: any) => acc + Object.keys(g || {}).length, 0);
    onAdvanceStage(currentStage.order, editCount ? edits : undefined);
  };

  const submitLotoAdd = () => {
    const point = lotoAddForm.point.trim();
    const type = lotoAddForm.type.trim();
    if (!point) {
      showToast({ type: 'warning', title: '补登隔离点缺少点位', message: '请填写实际隔离点位（如「储气罐出口截止阀」）后再提交', duration: 3500 });
      return;
    }
    onAddLotoItem({
      type,
      point,
      requirement: lotoAddForm.requirement.trim() || undefined,
      lockNumber: lotoAddForm.lockNumber.trim() || undefined,
    });
    setShowLotoAdd(false);
    setLotoAddForm({ type: '电气隔离', point: '', requirement: '', lockNumber: '' });
  };

  return (
    <div className="rounded-2xl bg-white/95 border border-slate-200/90 shadow-sm p-4 sm:p-5 lg:p-6 backdrop-blur-md space-y-5">
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
            {dirtyKeys.length > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-700">
                <PencilLine className="w-3 h-3" />
                待提交人工修订 {dirtyKeys.length} 处
              </span>
            )}
            {dirtyLotoCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-800">
                <PencilLine className="w-3 h-3" />
                LOTO 待登记 {dirtyLotoCount} 行
              </span>
            )}
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

      {/* 已持久化的人工修订留痕（服务端 prefill.humanRevised） */}
      {prefill.revised && <RevisionRecordBanner revised={prefill.revised} />}

      {/* 环节 3：LOTO 能量隔离（隔离点与锁号来自服务端预填 + 现场人工登记确认） */}
      {currentStage.id === 'stage_loto' && (
        <div className="space-y-4">
          <StructuredBlock
            title={`LOTO 能量隔离确认矩阵（${lotoItems.length} 个隔离点）`}
            icon={<Lock className="w-3.5 h-3.5 text-blue-600" />}
            note={(currentStage.aiPrefill?.raw as Stage3Prefill | undefined)?.note}
            aside={
              canEdit && lotoItems.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowLotoAdd((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 px-2 py-1 rounded-lg border border-blue-200 bg-white hover:bg-blue-50 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>{showLotoAdd ? '收起补登' : '补登隔离点'}</span>
                </button>
              ) : null
            }
          >
            {lotoItems.length === 0 ? (
              <EmptyLine text="服务端尚未回写隔离点：环节 2 的 JSA 评估未输出 lotoAdvice 时，请前往「安全与LOTO」页按现场实际补充隔离方案后再确认。" />
            ) : (
              <div className="space-y-2.5">
                {lotoItems.map((item) => (
                  <LotoRowEditor
                    key={item.id}
                    item={item}
                    form={lotoForm[item.id]}
                    editable={canEdit}
                    busy={!!busy}
                    onChangeField={(key, value) =>
                      setLotoForm((prev) => ({ ...prev, [item.id]: { ...(prev[item.id] || {}), [key]: value } }))
                    }
                    onToggle={(confirmed) => onToggleLotoItem(item.id, confirmed, lotoChangedFields(item))}
                    onSaveFields={() => {
                      const changed = lotoChangedFields(item);
                      if (!changed) return;
                      onToggleLotoItem(item.id, item.confirmed, changed);
                      setLotoForm((prev) => {
                        const next = { ...prev };
                        delete next[item.id];
                        return next;
                      });
                    }}
                    onResetFields={() =>
                      setLotoForm((prev) => {
                        const next = { ...prev };
                        delete next[item.id];
                        return next;
                      })
                    }
                  />
                ))}

                {showLotoAdd && (
                  <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50/40 p-3 space-y-2">
                    <div className="text-[11px] font-bold text-blue-900">现场补登（AI/JSA 清单外的能量源，来源将如实标「人工登记」）</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <LabeledInput
                        label="能量类型"
                        kind="select"
                        options={LOTO_TYPES}
                        value={lotoAddForm.type}
                        onChange={(v) => setLotoAddForm((f) => ({ ...f, type: v }))}
                      />
                      <LabeledInput
                        label="隔离点位"
                        kind="text"
                        value={lotoAddForm.point}
                        placeholder="如：储气罐出口截止阀"
                        onChange={(v) => setLotoAddForm((f) => ({ ...f, point: v }))}
                      />
                      <LabeledInput
                        label="操作要求（留空按 GB/T 33579 规则生成）"
                        kind="text"
                        value={lotoAddForm.requirement}
                        onChange={(v) => setLotoAddForm((f) => ({ ...f, requirement: v }))}
                      />
                      <LabeledInput
                        label="锁具牌号"
                        kind="text"
                        value={lotoAddForm.lockNumber}
                        placeholder="台账未匹配时现场登记"
                        onChange={(v) => setLotoAddForm((f) => ({ ...f, lockNumber: v }))}
                      />
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowLotoAdd(false)}
                        className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 cursor-pointer"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={submitLotoAdd}
                        disabled={!!busy}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                      >
                        {busy && <Loader2 className="w-3 h-3 animate-spin" />}
                        <span>提交补登</span>
                      </button>
                    </div>
                  </div>
                )}
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

      {/* 环节 1：现场报修（generate-work-order 草稿，确认要素可人工改写） */}
      {currentStage.id === 'stage_report' && (
        <div className="space-y-4">
          {prefill.engine ? (
            <StructuredBlock
              title="工单草稿（AI 预填，人工核对改写后落库）"
              icon={<FileText className="w-3.5 h-3.5 text-blue-600" />}
              aside={dirtyKeys.length ? <RevertButton onRevert={() => setForm({})} /> : null}
            >
              <EditForm
                specs={specs}
                raw={prefill.raw}
                form={form}
                editable={canEdit}
                onChange={(id, v) => setForm((prev) => ({ ...prev, [id]: v }))}
              />
              <ListBlock label="AI 建议工序" items={(prefill.raw as Stage1Prefill)?.workOrderDraft?.recommendedSteps} />
              <ListBlock label="开工前安全注意" items={(prefill.raw as Stage1Prefill)?.workOrderDraft?.safetyNotes} />
            </StructuredBlock>
          ) : (
            <EmptyBlock text="工单草稿尚未回写，AI 能力调用完成后自动出现在这里。回写前也可等服务端降级后人工填写要素。" />
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
            <StructuredBlock
              title="作业安全分析 JSA（人工定级确认后落库为作业票）"
              icon={<ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />}
              aside={dirtyKeys.length ? <RevertButton onRevert={() => setForm({})} /> : null}
            >
              <EditForm
                specs={specs}
                raw={prefill.raw}
                form={form}
                editable={canEdit}
                onChange={(id, v) => setForm((prev) => ({ ...prev, [id]: v }))}
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
            <StructuredBlock
              title="检修方案与作业步骤（工时人数可人工校正）"
              icon={<Wrench className="w-3.5 h-3.5 text-indigo-600" />}
              aside={dirtyKeys.length ? <RevertButton onRevert={() => setForm({})} /> : null}
            >
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
              <EditForm
                specs={specs}
                raw={prefill.raw}
                form={form}
                editable={canEdit}
                onChange={(id, v) => setForm((prev) => ({ ...prev, [id]: v }))}
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

      {/* 环节 6：质检归档（归档前核对清单，全部取自接口真实状态） */}
      {currentStage.id === 'stage_archive' && (
        <div className="space-y-4">
          <StructuredBlock title="归档前核对（六环节人工确认与产出物实况）" icon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {stages.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white/80 border border-slate-200/70 text-xs">
                  <span className="text-slate-600">
                    环节 {s.order}·{s.title}
                  </span>
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                      s.status === 'completed'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : s.status === 'in_progress'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-slate-50 text-slate-500 border-slate-200'
                    }`}
                  >
                    {s.status === 'completed' ? `已确认 ${s.completedTime || ''}`.trim() : s.status === 'in_progress' ? '进行中' : '待开始'}
                  </span>
                </div>
              ))}
            </div>
            <ListBlock
              label="产出物"
              items={loopData.artifacts.map((a) => `${a.name}：${a.status === 'ready' ? `已生成（${a.code}）` : '待生成'}`)}
            />
            <RevisionLedger stages={stages} lotoItems={lotoItems} />
          </StructuredBlock>

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
          <span>
            {isViewingActive
              ? dirtyKeys.length
                ? `确认落库（含 ${dirtyKeys.length} 处人工修订）→`
                : '核对/修订后确认推进 →'
              : `服务端进行中为第 ${activeStage?.order ?? '—'} 环节`}
          </span>
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
                需人工核校后方可确认。人工修订后 aiOriginal 保留 AI 原值，humanRevised 记录修订人与字段。
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
