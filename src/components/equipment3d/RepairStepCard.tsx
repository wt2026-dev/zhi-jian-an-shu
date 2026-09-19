/**
 * 检修步骤卡片 (RepairStepCard)
 *
 * 用于 3D 设备场景中：点击设备关联工单或从工单列表跳转时，
 * 以**左侧滑出面板**（贴住大屏工具栏以下、直达底部）展示该工单的详细信息、
 * 检修步骤清单或作业安全指引。不再浮在画布左下角遮挡设备与地面。
 *
 * 维修闭环（3D 内操作）：状态可操作时内嵌工单流转按钮——
 *   created  主管派单（自动采纳调度推荐）
 *   dispatched  技师接单
 *   in_progress  逐步勾选检修步骤（联动 3D 故障定位标逐层减淡）→ 完工上报
 *   pending_acceptance  质检验收通过
 * 所有操作都走真实工单 API，状态互斥拦截原样透出；3D 只做"手"，不做假状态。
 */

import React, { useMemo, useState } from 'react';
import {
  Wrench,
  CheckCircle2,
  Clock,
  User,
  ShieldAlert,
  ListOrdered,
  X,
  Eye,
  FileText,
  AlertTriangle,
  Layers,
  UserPlus,
  PlayCircle,
  ClipboardCheck,
  BadgeCheck,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { WorkOrder } from '../../types';
import {
  WorkOrderStatusBadge,
  WorkOrderPriorityBadge,
} from '../workorders/WorkOrderStatusBadge';

interface RepairStepCardProps {
  workOrder: WorkOrder;
  onClose: () => void;
  onFocusDevice?: () => void;

  // ── 维修闭环操作（全部可选：不传则保持只读展示） ─────────────────
  /** 当前登录用户署名（如 "李工 (技师)"），用于操作提示 */
  currentUser?: string | null;
  /** 操作请求进行中（按钮禁用） */
  busy?: boolean;
  /** 操作失败信息（状态互斥拦截等，原样透出） */
  actionError?: string | null;
  /** 已勾选步骤数（重新打开卡片时恢复进度） */
  initialCheckedCount?: number;
  /** created → 派单（自动采纳调度推荐的技师） */
  onDispatch?: () => void;
  /** dispatched → 接单 */
  onClaim?: () => void;
  /** in_progress → 完工上报 */
  onComplete?: (payload: { causeAnalysis: string; workHours: number; resolutionSteps: string }) => void;
  /** pending_acceptance → 验收通过 */
  onAccept?: () => void;
  /** 勾选步骤变化（checked 为勾选数，total 为步骤总数），用于联动 3D */
  onStepProgress?: (checked: number, total: number) => void;
}

/**
 * 依据故障类型提供默认关联作业规程与安全要点
 */
function getDefaultProcedures(faultType?: string): string[] {
  switch (faultType) {
    case '机械振动':
      return [
        '执行能量隔离与安全上锁 (LOTO)，确认设备完全断电且机械转子静止',
        '架设千分表复核联轴器径向与轴向对中偏差，检查紧固螺栓预紧力矩',
        '排查轴承游隙、偏心动不平衡与底座刚度，清洗清理轴承箱杂质',
        '低负荷点动试运转并监测振动加速度 RMS 频谱，确认恢复标称限值',
      ];
    case '轴承过热':
      return [
        '设备停机静置降温，红外热像仪精确定位发热轴承位与局部热点',
        '检查润滑油脂牌号、油位与变质乳化程度，必要时彻底换油清洗',
        '检测轴承游隙与轴向窜动量，排查保持架损伤与滚道疲劳剥落',
        '空载及带载分阶段试运行，连续监测 30 分钟轴温稳定在安全区间',
      ];
    case '密封泄漏':
      return [
        '关闭进出口切断阀并排空管路介质压力，测定现场介质浓度安全',
        '拆卸机封压盖与密封端盖，检查动静环研磨接触面及辅助 O 型密封圈',
        '彻底清洁轴套配合面，按规定力矩对称交叉锁紧机械密封螺栓',
        '充压静态保压测试 15 分钟无渗漏后，方可恢复供料投运',
      ];
    case '电气短路':
    case '控制系统异常':
      return [
        '切断上级动力配电开关并验电，张挂「有人工作，禁止合闸」安全警示牌',
        '使用绝缘兆欧表测试相对相及相对地绝缘电阻，定位对地漏电点',
        '检查交流接触器灭弧罩与触头烧灼状态，紧固端子排接线螺丝',
        '控制回路通电模拟点动，确认 PLC 输入输出信号反馈正常后合闸恢复',
      ];
    case '结构磨损':
      return [
        '清理设备外表附着污物，内窥镜或目视探伤排查关键受力件微裂纹',
        '游标卡尺/超声测厚仪测量关键摩擦副磨损极限与壁厚腐蚀余量',
        '更换超差耐磨衬板/导向导轨组件，按公差配合精密装配',
        '手盘动机械传动机构确认顺畅无卡阻，恢复防护防护罩并试运转',
      ];
    default:
      return [
        '班前安全技术交底，穿戴好防砸劳保鞋、护目镜并办理相关作业许可证',
        '按工业规程实施动力切断与安全上锁，确认所有蓄能释放完毕',
        '依照工单缺陷描述排查故障根因，更换或修复受损机械电气零部件',
        '现场 6S 整理清扫，开展试运行与仪器复测，确认各项指标合格后归档',
      ];
  }
}

export const RepairStepCard: React.FC<RepairStepCardProps> = ({
  workOrder,
  onClose,
  onFocusDevice,
  currentUser,
  busy = false,
  actionError = null,
  initialCheckedCount = 0,
  onDispatch,
  onClaim,
  onComplete,
  onAccept,
  onStepProgress,
}) => {
  // 解析步骤清单
  const steps = useMemo(() => {
    const rawSteps = workOrder.repairLog?.resolutionSteps;
    if (rawSteps && typeof rawSteps === 'string' && rawSteps.trim().length > 0) {
      // 尝试按换行符或分号或数字序号切分
      const lines = rawSteps
        .split(/[\n;；]+/)
        .map((s) => s.trim().replace(/^(\d+[\.、\s]+|[一二三四五]+[\.、\s]+)/, ''))
        .filter((s) => s.length > 0);
      if (lines.length > 0) return lines;
    }
    return getDefaultProcedures(workOrder.faultType);
  }, [workOrder.repairLog?.resolutionSteps, workOrder.faultType]);

  const hasCustomSteps = Boolean(workOrder.repairLog?.resolutionSteps?.trim());

  // ---- 维修闭环：步骤勾选（in_progress 时可勾，联动 3D 定位标减淡） ----
  const [checked, setChecked] = useState<Set<number>>(() => {
    const init = new Set<number>();
    for (let i = 0; i < Math.min(initialCheckedCount, steps.length); i++) init.add(i);
    return init;
  });
  const [completeFormOpen, setCompleteFormOpen] = useState(false);
  const [causeAnalysis, setCauseAnalysis] = useState('');
  const [workHours, setWorkHours] = useState('2');

  const actionable = workOrder.status === 'in_progress' && typeof onStepProgress === 'function';
  const checkedCount = checked.size;
  const progress = steps.length > 0 ? checkedCount / steps.length : 0;

  const toggleStep = (idx: number) => {
    if (!actionable || busy) return;
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      onStepProgress?.(next.size, steps.length);
      return next;
    });
  };

  const doneStepsText = useMemo(
    () => steps.filter((_, i) => checked.has(i)).join('；'),
    [steps, checked]
  );

  const canSubmitComplete =
    actionable &&
    checkedCount > 0 &&
    causeAnalysis.trim().length > 0 &&
    Number(workHours) > 0;

  const submitComplete = () => {
    if (!canSubmitComplete || busy) return;
    onComplete?.({
      causeAnalysis: causeAnalysis.trim(),
      workHours: Number(workHours),
      resolutionSteps: doneStepsText || steps.join('；'),
    });
  };

  return (
    <aside
      data-testid="equipment3d-repair-step-card"
      className="absolute left-0 top-[52px] bottom-0 z-40 w-[360px] max-w-[78%] flex flex-col bg-slate-900/92 backdrop-blur-md border-t border-r border-b border-white/15 border-l-2 border-l-cyan-400/70 rounded-r-2xl shadow-[22px_0_54px_-18px_rgba(2,6,23,0.95)] text-slate-100 overflow-hidden animate-in fade-in slide-in-from-left duration-200"
    >
      {/* 卡片头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30 shrink-0">
            <Wrench className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs font-bold text-cyan-400 truncate">
                {workOrder.orderNo}
              </span>
              <WorkOrderStatusBadge status={workOrder.status} size="xs" />
              <WorkOrderPriorityBadge priority={workOrder.priority} size="xs" />
            </div>
            <h4 className="text-xs font-semibold text-slate-200 truncate mt-0.5" title={workOrder.title}>
              {workOrder.title}
            </h4>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors shrink-0 ml-2"
          title="关闭步骤卡片"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 卡片主体（可滚动） */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 scrollbar-thin text-xs">
        {/* 设备与人员信息网格 */}
        <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-white/4 border border-white/8 text-[11px]">
          <div>
            <span className="text-slate-400 block text-[10px]">关联设备</span>
            <span className="font-medium text-slate-200 truncate block" title={`${workOrder.equipmentName} (${workOrder.equipmentCode})`}>
              {workOrder.equipmentName}
            </span>
            <span className="text-[10px] text-cyan-400 font-mono">{workOrder.equipmentCode}</span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px]">所属车间</span>
            <span className="font-medium text-slate-200 truncate block">{workOrder.workshop || '生产主车间'}</span>
            <span className="text-[10px] text-slate-400">{workOrder.faultType}</span>
          </div>
          <div className="pt-1.5 border-t border-white/5">
            <span className="text-slate-400 block text-[10px]">派单 / 报修人</span>
            <span className="font-medium text-slate-200 truncate block">{workOrder.dispatcher || workOrder.creator || '调度中心'}</span>
          </div>
          <div className="pt-1.5 border-t border-white/5">
            <span className="text-slate-400 block text-[10px]">主修技师</span>
            <span className="font-medium text-blue-300 truncate block">{workOrder.assignee || '待分配技师'}</span>
          </div>
        </div>

        {/* 问题与现象描述 */}
        {workOrder.description && (
          <div className="space-y-1">
            <div className="text-[10px] font-semibold text-slate-400 flex items-center gap-1">
              <FileText className="w-3 h-3 text-slate-400" />
              <span>缺陷与故障描述</span>
            </div>
            <p className="p-2.5 rounded-xl bg-white/4 border border-white/8 text-slate-300 leading-relaxed text-[11px]">
              {workOrder.description}
            </p>
          </div>
        )}

        {/* 检修步骤清单 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400">
            <div className="flex items-center gap-1">
              <ListOrdered className="w-3 h-3 text-blue-400" />
              <span>{hasCustomSteps ? '工单执行排查步骤' : '关联标准化作业指引要点'}</span>
            </div>
            {!hasCustomSteps && (
              <span className="text-[9px] px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                标准规程
              </span>
            )}
          </div>

          {/* 维修进度条：勾一步亮一格，联动 3D 故障定位标逐层减淡 */}
          {actionable && (
            <div data-testid="equipment3d-repair-progress">
              <div className="flex items-center justify-between text-[10px] mb-1">
                <span className="text-amber-300 font-medium">检修进度（勾选已完成步骤）</span>
                <span className="tabular-nums text-slate-300">
                  {checkedCount} / {steps.length}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-400 transition-all duration-300"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            {steps.map((step, idx) => {
              const done = checked.has(idx);
              const row = (
                <div
                  key={idx}
                  className={`flex items-start gap-2 p-2 rounded-xl border transition-colors text-[11px] ${
                    done
                      ? 'bg-emerald-500/10 border-emerald-500/30'
                      : 'bg-white/5 border-white/8 hover:bg-white/8'
                  } ${actionable && !busy ? 'cursor-pointer' : ''}`}
                >
                  {actionable ? (
                    <span
                      aria-checked={done}
                      role="checkbox"
                      data-testid={`equipment3d-repair-step-${idx}`}
                      className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                        done
                          ? 'bg-emerald-500 border-emerald-400 text-white'
                          : 'bg-white/10 border-white/30 text-transparent'
                      }`}
                    >
                      <CheckCircle2 className="w-3 h-3" />
                    </span>
                  ) : (
                    <span className="w-4 h-4 rounded-full bg-blue-500/25 text-blue-300 border border-blue-500/40 flex items-center justify-center shrink-0 text-[9px] font-bold mt-0.5">
                      {idx + 1}
                    </span>
                  )}
                  <span
                    className={`leading-relaxed flex-1 ${
                      done ? 'text-emerald-100 line-through decoration-emerald-400/50' : 'text-slate-200'
                    }`}
                  >
                    {step}
                  </span>
                </div>
              );
              return actionable ? (
                <div key={idx} onClick={() => toggleStep(idx)}>
                  {row}
                </div>
              ) : (
                row
              );
            })}
          </div>
        </div>

        {/* 原因分析 (若有) */}
        {workOrder.repairLog?.causeAnalysis && (
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-[11px] space-y-1">
            <div className="flex items-center gap-1 font-semibold text-[10px] text-amber-300">
              <AlertTriangle className="w-3 h-3" />
              <span>根因研判</span>
            </div>
            <p className="leading-relaxed">{workOrder.repairLog.causeAnalysis}</p>
          </div>
        )}

        {/* 安全防护要求标签 */}
        {workOrder.safetyRequirements && workOrder.safetyRequirements.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] font-semibold text-slate-400 flex items-center gap-1">
              <ShieldAlert className="w-3 h-3 text-rose-400" />
              <span>作业安全防护要点</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {workOrder.safetyRequirements.map((req, idx) => (
                <span
                  key={idx}
                  className="px-2 py-0.5 rounded-lg bg-rose-500/15 text-rose-200 border border-rose-500/25 text-[10px]"
                >
                  {req}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 维修闭环操作区（按工单状态给出唯一可用动作，全部走真实 API） */}
      {(onDispatch || onClaim || onComplete || onAccept) && (
        <div
          data-testid="equipment3d-repair-actions"
          className="px-4 py-3 border-t border-white/10 bg-white/5 space-y-2"
        >
          {actionError && (
            <div className="text-[10px] leading-relaxed text-amber-200 bg-amber-500/10 border border-amber-500/25 rounded-lg px-2 py-1.5">
              {actionError}
            </div>
          )}

          {workOrder.status === 'created' && onDispatch && (
            <button
              type="button"
              data-testid="equipment3d-repair-dispatch"
              onClick={onDispatch}
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
              title={currentUser ? `以 ${currentUser} 身份派单（自动采纳调度推荐首位技师）` : '自动采纳调度推荐的技师'}
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
              主管派单（调度推荐）
            </button>
          )}

          {workOrder.status === 'dispatched' && onClaim && (
            <button
              type="button"
              data-testid="equipment3d-repair-claim"
              onClick={onClaim}
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
              title={currentUser ? `以 ${currentUser} 身份接单开工` : '接单开工'}
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
              技师接单 · 开始检修
            </button>
          )}

          {workOrder.status === 'in_progress' && onComplete && (
            <>
              {completeFormOpen ? (
                <div className="space-y-2 p-2.5 rounded-xl bg-white/5 border border-white/10">
                  <div className="flex items-center justify-between text-[10px] font-semibold text-slate-300">
                    <span className="flex items-center gap-1">
                      <ClipboardCheck className="w-3 h-3 text-emerald-400" />
                      完工上报（检修记录将写入工单）
                    </span>
                    <button
                      type="button"
                      onClick={() => setCompleteFormOpen(false)}
                      className="text-slate-400 hover:text-white"
                      aria-label="收起完工上报表单"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <textarea
                    data-testid="equipment3d-repair-cause"
                    value={causeAnalysis}
                    onChange={(e) => setCauseAnalysis(e.target.value)}
                    placeholder="根因分析（必填）：如 轴承疲劳微剥落并伴随同轴度偏差"
                    rows={3}
                    className="w-full px-2 py-1.5 rounded-lg bg-white/8 border border-white/12 text-[11px] text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-400/60 resize-none"
                  />
                  <div className="flex items-center gap-2 text-[10px] text-slate-400">
                    <label htmlFor="equipment3d-repair-hours" className="shrink-0">实用工时 (h)</label>
                    <input
                      id="equipment3d-repair-hours"
                      data-testid="equipment3d-repair-hours"
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={workHours}
                      onChange={(e) => setWorkHours(e.target.value)}
                      className="w-20 px-2 py-1 rounded-lg bg-white/8 border border-white/12 text-[11px] text-slate-100 tabular-nums focus:outline-none focus:border-emerald-400/60"
                    />
                    <span className="truncate" title={doneStepsText || '先勾选已完成的检修步骤'}>
                      执行记录：{doneStepsText ? `已勾 ${checkedCount} 步` : '未勾选步骤'}
                    </span>
                  </div>
                  <button
                    type="button"
                    data-testid="equipment3d-repair-complete"
                    onClick={submitComplete}
                    disabled={busy || !canSubmitComplete}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
                    title={!checkedCount ? '先勾选已完成的检修步骤' : !causeAnalysis.trim() ? '请填写根因分析' : '提交完工上报，进入质检验收'}
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    提交完工上报
                  </button>
                  {!canSubmitComplete && !busy && (
                    <p className="text-[9px] leading-relaxed text-slate-500">
                      需至少勾选 1 步已完成操作，并填写根因分析；执行记录取勾选步骤原文。
                    </p>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  data-testid="equipment3d-repair-open-complete"
                  onClick={() => setCompleteFormOpen(true)}
                  disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
                >
                  <ClipboardCheck className="w-3.5 h-3.5" />
                  完工上报（已勾 {checkedCount} / {steps.length} 步）
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}

          {workOrder.status === 'pending_acceptance' && onAccept && (
            <div className="space-y-1">
              <button
                type="button"
                data-testid="equipment3d-repair-accept"
                onClick={onAccept}
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
                title={currentUser ? `以 ${currentUser} 身份验收` : '质检验收通过，工单闭环归档'}
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BadgeCheck className="w-3.5 h-3.5" />}
                质检验收通过 · 闭环归档
              </button>
              <p className="text-[9px] text-slate-500 text-center">验收不通过/驳回请前往「工单管理」页操作</p>
            </div>
          )}

          {workOrder.status === 'completed' && (
            <div className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
              <BadgeCheck className="w-3.5 h-3.5" />
              工单已闭环归档
            </div>
          )}
        </div>
      )}

      {/* 底部操作条 */}
      <div className="px-4 py-2.5 border-t border-white/10 bg-white/5 flex items-center justify-between text-xs">
        <div className="text-[10px] text-slate-400 flex items-center gap-1">
          <Clock className="w-3 h-3 text-slate-500" />
          <span>创建时间: {workOrder.createdAt ? String(workOrder.createdAt).slice(0, 16) : '—'}</span>
        </div>

        <div className="flex items-center gap-2">
          {onFocusDevice && (
            <button
              type="button"
              onClick={onFocusDevice}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600/80 hover:bg-blue-600 text-white font-medium text-[11px] transition-colors"
              title="3D 相机平滑聚焦到此设备"
            >
              <Eye className="w-3 h-3" />
              <span>聚焦设备</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-slate-300 font-medium text-[11px] transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </aside>
  );
};
