import React from 'react';
import { ShieldCheck, Plus, Lock } from 'lucide-react';
import { LotoLock, SafetyPermit } from '../../types';

interface SafetyHeaderAndFilterProps {
  safetyPermits: SafetyPermit[];
  activeLotoLocks: LotoLock[];
  selectedRiskLevel: string;
  onSelectRiskLevel: (level: string) => void;
  onOpenCreateModal: () => void;
}

export const SafetyHeaderAndFilter: React.FC<SafetyHeaderAndFilterProps> = ({
  safetyPermits,
  activeLotoLocks,
  selectedRiskLevel,
  onSelectRiskLevel,
  onOpenCreateModal,
}) => {
  const riskLevels: { id: string; label: string; count: number; color: string }[] = [
    { id: 'all', label: '全部风险级别', count: safetyPermits.length, color: 'text-slate-300' },
    {
      id: '极大风险 (Level 1)',
      label: '🔴 极大风险 (Level 1)',
      count: safetyPermits.filter((s) => s.riskLevel.includes('Level 1')).length,
      color: 'text-rose-400',
    },
    {
      id: '较大风险 (Level 2)',
      label: '🟠 较大风险 (Level 2)',
      count: safetyPermits.filter((s) => s.riskLevel.includes('Level 2')).length,
      color: 'text-amber-400',
    },
    {
      id: '一般风险 (Level 3)',
      label: '🟡 一般风险 (Level 3)',
      count: safetyPermits.filter((s) => s.riskLevel.includes('Level 3')).length,
      color: 'text-blue-400',
    },
    {
      id: '低风险 (Level 4)',
      label: '🔵 低风险 (Level 4)',
      count: safetyPermits.filter((s) => s.riskLevel.includes('Level 4')).length,
      color: 'text-slate-500',
    },
  ];

  return (
    <>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center">
            <ShieldCheck className="w-5 h-5 mr-2 text-purple-600" />
            工业现场高危作业安全管控与作业票审批中心
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            四级风险分级管控、动火/受限空间/高处作业票双人审批、LOTO 停电挂牌生命锁联锁机制
          </p>
        </div>

        <button
          id="btn-create-safety-permit"
          onClick={onOpenCreateModal}
          className="px-4 py-2 text-xs font-medium bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors flex items-center space-x-1.5 shadow-xs cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>申请高危安全作业票</span>
        </button>
      </div>

      {/* LOTO Special Interlock Banner (真实 loto_locks 落库数据驱动) */}
      <div className="bg-purple-50/70 border border-purple-200 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-xs card-industrial">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-purple-100 text-purple-700 rounded-xl border border-purple-200">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-purple-600 text-white">
                LOTO 能量隔离人工台账
              </span>
              <span className="text-xs font-semibold text-purple-900">
                当前 {activeLotoLocks.length} 条人工挂锁记录未释放
                {activeLotoLocks.length > 0 && `: ${activeLotoLocks.map((l) => l.lockNo).join(' / ')}`}
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              {activeLotoLocks.length > 0
                ? `隔离点: ${activeLotoLocks[0].pointName || '—'} | 动力源: ${activeLotoLocks[0].energySource || '—'} (人工记录，现场状态须核验)`
                : '当前无未释放的人工挂锁记录，不代表现场锁具已解除'}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2 shrink-0">
          <span className="text-xs px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
            人工台账 · 非硬件控制
          </span>
        </div>
      </div>

      {/* Risk Filter Chips */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        {riskLevels.map((risk) => {
          const isSelected = selectedRiskLevel === risk.id;
          return (
            <button
              key={risk.id}
              onClick={() => onSelectRiskLevel(risk.id)}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer shadow-xs ${
                isSelected
                  ? 'bg-purple-50 border-purple-300 ring-1 ring-purple-300'
                  : 'bg-white border-slate-200 hover:border-slate-300 card-industrial'
              }`}
            >
              <div className={`text-xs font-bold ${risk.color}`}>{risk.label}</div>
              <div className="text-xs font-mono text-slate-500 mt-1">
                在控票据: <strong className="text-slate-800">{risk.count}</strong> 张
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
};
