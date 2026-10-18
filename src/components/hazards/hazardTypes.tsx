import React from 'react';
import { CheckCircle2 } from 'lucide-react';

export function getStatusBadge(status: string): React.ReactElement {
  switch (status) {
    case 'pending':
      return (
        <span className="px-2 py-0.5 rounded-full text-xs bg-orange-50 text-orange-700 border border-orange-200 flex items-center space-x-1 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
          <span>待整改</span>
        </span>
      );
    case 'rectifying':
      return (
        <span className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200 flex items-center space-x-1 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          <span>整改中</span>
        </span>
      );
    case 'verifying':
      return (
        <span className="px-2 py-0.5 rounded-full text-xs bg-purple-50 text-purple-700 border border-purple-200 flex items-center space-x-1 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
          <span>待验收复核</span>
        </span>
      );
    case 'closed':
      return (
        <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center space-x-1 font-medium">
          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
          <span>已闭环销号</span>
        </span>
      );
    default:
      return <span className="text-slate-600 font-medium">{status}</span>;
  }
}

export const HAZARD_STATUS_TABS = [
  { id: 'all', label: '全部隐患' },
  { id: 'pending', label: '待整改' },
  { id: 'rectifying', label: '整改中' },
  { id: 'verifying', label: '待复核验收' },
  { id: 'closed', label: '已闭环销号' },
];
