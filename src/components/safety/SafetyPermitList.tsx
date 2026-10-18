import React from 'react';
import {
  ShieldCheck,
  Flame,
  Lock,
  Trash2,
  ArrowUpRight,
} from 'lucide-react';
import { SafetyPermit, UserProfile } from '../../types';
import { getRiskBadge, getStatusBadge } from './safetyTypes';

interface SafetyPermitListProps {
  filteredPermits: SafetyPermit[];
  currentUser: UserProfile;
  onSelectPermit: (permit: SafetyPermit) => void;
  onDeletePermit: (permit: SafetyPermit, e?: React.MouseEvent) => void;
}

export const SafetyPermitList: React.FC<SafetyPermitListProps> = ({
  filteredPermits,
  currentUser,
  onSelectPermit,
  onDeletePermit,
}) => {
  return (
    <div className="space-y-3">
      {filteredPermits.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center shadow-xs card-industrial">
          <ShieldCheck className="w-12 h-12 text-slate-500 mx-auto mb-3" />
          <h4 className="text-sm font-semibold text-slate-700">暂无此筛选条件下的安全作业票</h4>
          <p className="text-xs text-slate-500 mt-1">生产现场各项指标安全平稳</p>
        </div>
      ) : (
        filteredPermits.map((permit) => {
          const riskBadge = getRiskBadge(permit.riskLevel);
          const statusBadge = getStatusBadge(permit.status);
          const isPending = permit.status === 'pending_approval';

          return (
            <div
              key={permit.id}
              onClick={() => onSelectPermit(permit)}
              className={`p-4 bg-white hover:border-purple-300 border rounded-xl transition-all cursor-pointer group flex flex-col md:flex-row md:items-center justify-between gap-4 card-industrial shadow-xs ${
                isPending ? 'border-amber-300 bg-amber-50/20' : 'border-slate-200'
              }`}
            >
              <div className="flex items-start space-x-3.5">
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-purple-600 shrink-0 mt-0.5">
                  {permit.permitType.includes('动火') ? (
                    <Flame className="w-5 h-5 text-amber-600" />
                  ) : permit.lotoNumber ? (
                    <Lock className="w-5 h-5 text-rose-600" />
                  ) : (
                    <ShieldCheck className="w-5 h-5 text-purple-600" />
                  )}
                </div>

                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="font-mono text-xs font-bold text-purple-700">{permit.permitNo}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${riskBadge.color}`}>
                      {riskBadge.label}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${statusBadge.color}`}>
                      {statusBadge.label}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 font-medium">
                      {permit.permitType}
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-slate-800 group-hover:text-purple-700 transition-colors">
                    {permit.title}
                  </h3>

                  <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-[11px] text-slate-500 mt-2">
                    <span>作业区域: <strong className="text-slate-700">{permit.workshop} · {permit.location}</strong></span>
                    {permit.equipmentName && <span>关联设备: {permit.equipmentName}</span>}
                    <span>申请人: {permit.applicant}</span>
                    {permit.approver && <span>审批责任人: <strong className="text-emerald-700">{permit.approver}</strong></span>}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between md:justify-end space-x-2 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100">
                <div className="text-right hidden sm:block mr-2">
                  <span className="text-[10px] text-slate-500 block">有效截止时限</span>
                  <span className="font-mono text-xs text-amber-700 font-semibold">{permit.validUntil}</span>
                </div>

                <button
                  onClick={(e) => onDeletePermit(permit, e)}
                  title={currentUser.role === 'user' ? "普通操作员禁止删除高危作业票" : "注销并删除此安全作业票"}
                  className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 text-slate-500 hover:text-rose-600 border border-slate-200 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>

                <button className="px-3 py-1.5 bg-slate-100 group-hover:bg-purple-600 text-slate-700 group-hover:text-white rounded-lg text-xs font-medium transition-colors flex items-center space-x-1 cursor-pointer">
                  <span>{isPending ? '审批/详情' : '详情'}</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};
