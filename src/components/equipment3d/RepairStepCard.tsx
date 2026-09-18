/**
 * 检修步骤卡片 (RepairStepCard)
 *
 * 用于 3D 设备场景中：点击设备关联工单或从工单列表跳转时，
 * 弹出展示该工单的详细信息、检修步骤清单或作业安全指引。
 */

import React, { useMemo } from 'react';
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

  return (
    <div
      data-testid="equipment3d-repair-step-card"
      className="absolute bottom-3 left-3 z-40 w-[380px] max-w-[calc(100%-24px)] max-h-[calc(100%-24px)] flex flex-col bg-slate-900/90 backdrop-blur-md border border-white/15 rounded-2xl shadow-2xl text-slate-100 overflow-hidden animate-in fade-in slide-in-from-bottom-3 duration-200"
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

          <div className="space-y-1.5">
            {steps.map((step, idx) => (
              <div
                key={idx}
                className="flex items-start gap-2 p-2 rounded-xl bg-white/5 hover:bg-white/8 border border-white/8 transition-colors text-[11px]"
              >
                <span className="w-4 h-4 rounded-full bg-blue-500/25 text-blue-300 border border-blue-500/40 flex items-center justify-center shrink-0 text-[9px] font-bold mt-0.5">
                  {idx + 1}
                </span>
                <span className="text-slate-200 leading-relaxed flex-1">{step}</span>
              </div>
            ))}
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
    </div>
  );
};
