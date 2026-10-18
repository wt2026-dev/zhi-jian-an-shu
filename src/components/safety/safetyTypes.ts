import { RiskLevel, SafetyPermit } from '../../types';

export const getRiskBadge = (level: RiskLevel) => {
  if (level.includes('Level 1')) {
    return { label: '极大风险 (Level 1)', color: 'bg-red-50 text-red-700 border-red-200' };
  }
  if (level.includes('Level 2')) {
    return { label: '较大风险 (Level 2)', color: 'bg-orange-50 text-orange-700 border-orange-200' };
  }
  if (level.includes('Level 3')) {
    return { label: '一般风险 (Level 3)', color: 'bg-blue-50 text-blue-700 border-blue-200' };
  }
  return { label: '低风险 (Level 4)', color: 'bg-slate-100 text-slate-600 border-slate-200' };
};

export const getStatusBadge = (status: SafetyPermit['status']) => {
  switch (status) {
    case 'pending_approval':
      return { label: '待安全总监审批', color: 'bg-orange-50 text-orange-700 border-orange-200' };
    case 'approved':
    case 'active':
      return { label: '作业中/在控', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'closed':
      return { label: '已完工撤离闭环', color: 'bg-slate-100 text-slate-600 border-slate-200' };
    case 'rejected':
      return { label: '审批驳回', color: 'bg-red-50 text-red-700 border-red-200' };
  }
};
