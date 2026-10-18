import React from 'react';
import { GitBranch, Zap, ArrowRight, Route, Repeat, ShieldAlert } from 'lucide-react';

export const AiModelsFailoverBanner: React.FC = () => {
  return (
    <div className="glass-card p-5 shadow-sm mb-4 border border-blue-100/70 bg-gradient-to-r from-blue-50/20 via-white/50 to-indigo-50/20">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 flex-wrap gap-2">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 rounded-lg bg-blue-100/80 text-blue-700">
            <GitBranch className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">多模型容灾与路由降级机制</h2>
            <p className="text-[11px] text-slate-500">优先级路由分发 · 异常自动故障转移 (Failover) · 规则引擎专家库底线兜底</p>
          </div>
        </div>
        <span className="text-[11px] px-3 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-medium">
          多模型容灾 · 故障转移 · 审计可溯 · 零单点故障
        </span>
      </div>

      {/* 横向步骤链路 */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2.5">
        {/* 步骤 1 */}
        <div className="flex-1 p-3 rounded-xl border border-slate-200 bg-white/90 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-mono">
                步骤 1
              </span>
              <Zap className="w-3.5 h-3.5 text-blue-600" />
            </div>
            <div className="font-bold text-xs text-slate-800">业务请求发起</div>
            <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
              诊断/方案/报告等业务模块统一调用 AI 网关入口
            </p>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 text-[9px] text-slate-500 font-mono">
            入参校验与上下文装配
          </div>
        </div>

        {/* 连接箭头 1 */}
        <div className="flex items-center justify-center text-blue-400 shrink-0">
          <ArrowRight className="w-4 h-4 hidden lg:block" />
          <div className="text-center py-0.5 lg:hidden text-blue-500 text-[11px] font-medium">↓</div>
        </div>

        {/* 步骤 2 */}
        <div className="flex-1 p-3 rounded-xl border border-blue-200 bg-white/90 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-mono">
                步骤 2
              </span>
              <Route className="w-3.5 h-3.5 text-blue-600" />
            </div>
            <div className="font-bold text-xs text-slate-800">候选 #1 优先尝试</div>
            <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
              按 Priority 优先级顺序路由首选已启用模型
            </p>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 text-[9px] text-emerald-600 font-mono font-semibold">
            成功：直接返回并记健康
          </div>
        </div>

        {/* 连接箭头 2 */}
        <div className="flex items-center justify-center text-amber-400 shrink-0">
          <ArrowRight className="w-4 h-4 hidden lg:block" />
          <div className="text-center py-0.5 lg:hidden text-amber-500 text-[11px] font-medium">↓ 失败（超时/5xx/鉴权）</div>
        </div>

        {/* 步骤 3 */}
        <div className="flex-1 p-3 rounded-xl border border-amber-200 bg-amber-50/30 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-mono">
                步骤 3
              </span>
              <Repeat className="w-3.5 h-3.5 text-amber-600" />
            </div>
            <div className="font-bold text-xs text-slate-800">切换候选 #2 … #N</div>
            <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
              前序异常熔断，自动故障转移至次级候选重试
            </p>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 text-[9px] text-amber-700 font-mono">
            回写首选 unhealthy 状态
          </div>
        </div>

        {/* 连接箭头 3 */}
        <div className="flex items-center justify-center text-rose-400 shrink-0">
          <ArrowRight className="w-4 h-4 hidden lg:block" />
          <div className="text-center py-0.5 lg:hidden text-rose-500 text-[11px] font-medium">↓ 全部候选失效</div>
        </div>

        {/* 步骤 4 */}
        <div className="flex-1 p-3 rounded-xl border border-rose-200 bg-rose-50/30 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-mono">
                步骤 4
              </span>
              <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
            </div>
            <div className="font-bold text-xs text-slate-800">规则引擎专家降级</div>
            <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
              全部模型不可用时，无缝回退专家规则库安全执行
            </p>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 text-[9px] text-rose-700 font-mono font-medium">
            degraded 标记 + FAILOVER 审计
          </div>
        </div>
      </div>
    </div>
  );
};
