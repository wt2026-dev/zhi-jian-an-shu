import React from 'react';
import {
  Activity,
  ArrowRight,
  ClipboardList,
  GitBranch,
  Layers,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';

export const PipelineTopologyCard: React.FC = () => {
  return (
    <div className="card-saas p-6 border border-slate-200/80 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-xl bg-blue-50 text-blue-700 border border-blue-100/80">
            <GitBranch className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900 tracking-tight">协同编排架构（DAG 异步并发拓扑）</h2>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/80 font-semibold flex items-center">
                <span className="relative flex h-2 w-2 mr-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
                </span>
                Fork-Join 并发协同
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              阶段 1、2 因果链强依赖串行推演；阶段 3 作业方案确定后，双路专业 Agent 异步并发求解
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 font-mono font-medium">
            串行 2 步 · 并行 2 路
          </span>
          <span className="text-xs px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-200/80 font-semibold font-mono">
            Promise.all 异步非阻塞
          </span>
        </div>
      </div>

      {/* 流程拓扑节点排版 */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3.5 pt-1">
        {/* 节点 1：故障诊断 */}
        <div className="flex-1 p-4 rounded-xl border border-blue-200/80 bg-gradient-to-b from-white to-blue-50/20 shadow-2xs hover:shadow-xs hover:border-blue-400 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 font-mono">
              阶段 1 · 串行推演
            </span>
            <Activity className="w-4 h-4 text-blue-600" />
          </div>
          <div className="font-bold text-xs text-slate-900">故障诊断推演</div>
          <div className="text-[11px] text-slate-500 mt-1">输入：遥测时序 + 故障现象</div>
          <div className="mt-2.5 pt-2 border-t border-slate-100 text-[11px] text-blue-700 font-medium">
            产出：故障根因与严重度判定
          </div>
        </div>

        {/* 串行连接 1 */}
        <div className="flex items-center justify-center text-blue-400 shrink-0 px-1">
          <div className="hidden lg:flex flex-col items-center">
            <span className="text-[10px] font-mono text-blue-600 font-semibold mb-1">推演结论</span>
            <ArrowRight className="w-4 h-4" />
          </div>
          <div className="text-center py-1 lg:hidden text-blue-500 text-xs font-medium">
            ↓ 强依赖推演产物
          </div>
        </div>

        {/* 节点 2：检修方案生成 */}
        <div className="flex-1 p-4 rounded-xl border border-indigo-200/80 bg-gradient-to-b from-white to-indigo-50/20 shadow-2xs hover:shadow-xs hover:border-indigo-400 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-700 font-mono">
              阶段 2 · 方案制定
            </span>
            <ClipboardList className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="font-bold text-xs text-slate-900">检修方案生成</div>
          <div className="text-[11px] text-slate-500 mt-1">输入：根因结论 + 知识库 SOP</div>
          <div className="mt-2.5 pt-2 border-t border-slate-100 text-[11px] text-indigo-700 font-medium">
            产出：作业指导书与执行步骤
          </div>
        </div>

        {/* 串行到并发 Fork 分发 */}
        <div className="flex items-center justify-center text-indigo-400 shrink-0 px-1">
          <div className="hidden lg:flex flex-col items-center">
            <span className="text-[10px] font-mono text-indigo-700 font-bold px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 mb-1">
              FORK 并发
            </span>
            <ArrowRight className="w-4 h-4" />
          </div>
          <div className="text-center py-1.5 lg:hidden text-indigo-600 text-xs font-bold">
            ↓ 触发异步并发 (Fork 2 路 Agent)
          </div>
        </div>

        {/* 并行分支区（双 Agent 异步并发） */}
        <div className="flex-1 flex flex-col gap-2 p-3 rounded-xl bg-slate-50/90 border border-slate-200/90 shadow-2xs">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-bold text-slate-800 flex items-center">
              <Layers className="w-3.5 h-3.5 mr-1.5 text-indigo-600" /> 阶段 3 · 双路并发协同
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 font-mono font-bold">
              Promise.all
            </span>
          </div>

          {/* 分支 3A */}
          <div className="p-2.5 rounded-lg border border-emerald-200/90 bg-white shadow-2xs hover:border-emerald-400 transition-all">
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold text-xs text-slate-800 flex items-center">
                <ShieldCheck className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
                安全风控 Agent
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono font-bold border border-emerald-200/60">
                并行路 1
              </span>
            </div>
            <p className="text-[11px] text-slate-500">JSA 风险等级评定、LOTO 能量隔离与防护措施</p>
          </div>

          {/* 分支 3B */}
          <div className="p-2.5 rounded-lg border border-purple-200/90 bg-white shadow-2xs hover:border-purple-400 transition-all">
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold text-xs text-slate-800 flex items-center">
                <UserCheck className="w-3.5 h-3.5 mr-1.5 text-purple-600" />
                智能派单 Agent
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 font-mono font-bold border border-purple-200/60">
                并行路 2
              </span>
            </div>
            <p className="text-[11px] text-slate-500">特种资质校验、排班工时与在办负载均衡</p>
          </div>
        </div>
      </div>
    </div>
  );
};
