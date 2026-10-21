import { EquipmentStatus } from '../../types';

export function getStatusBadge(status: EquipmentStatus): { label: string; color: string } {
  switch (status) {
    case 'running':
      return { label: '正常运行', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'warning':
      return { label: '预警关注', color: 'bg-orange-50 text-orange-700 border-orange-200' };
    case 'fault':
      return { label: '故障待修', color: 'bg-red-50 text-red-700 border-red-200' };
    // critical 是台账真实存在的取值（如 eq-103），原先落进 default 被显示成「报废」。
    case 'critical':
      return { label: '紧急', color: 'bg-red-100 text-red-800 border-red-300' };
    case 'overhauling':
      return { label: '检修中', color: 'bg-blue-50 text-blue-700 border-blue-200' };
    case 'standby':
      return { label: '停机备用', color: 'bg-slate-100 text-slate-600 border-slate-200' };
    case 'scrapped':
      return { label: '报废', color: 'bg-slate-100 text-slate-600 border-slate-200' };
    // 兜底不再谎报「报废」：未知状态如实显示为未知，避免把在役设备说成已报废。
    default:
      return { label: '未知状态', color: 'bg-slate-100 text-slate-500 border-slate-300' };
  }
}

export const WORKSHOPS = ['all', '一号动力车间', '二号机加车间', '智能装配线', '储运与气体动力站'];

export const CATEGORIES = ['all', '泵类设备', '压缩机', '传动减速机', '大型电机', '数控机床', '工业机器人'];

export const STATUSES: { id: string; label: string }[] = [
  { id: 'all', label: '全部状态' },
  { id: 'running', label: '正常运行' },
  { id: 'warning', label: '预警关注' },
  { id: 'fault', label: '故障待修' },
  { id: 'critical', label: '紧急' },
  { id: 'overhauling', label: '检修作业中' },
  { id: 'standby', label: '停机备用' },
];
