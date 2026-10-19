import React from 'react';
import {
  ShieldCheck,
  ChevronRight,
} from 'lucide-react';
import { ComplianceStats } from '../../types';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface ComplianceAuditSectionProps {
  complianceStats: ComplianceStats | null;
  complianceLoadFailed: boolean;
  auditLogsLoadFailed: boolean;
  recentAuditLogs: any[];
  onNavigate: (tab: string) => void;
}

// 趋势为空时的兜底样例（与旧 echarts 实现的兜底数组一致）
const FALLBACK_TREND = [
  { date: '09-05', avgScore: 81, orders: 0 },
  { date: '09-06', avgScore: 52, orders: 1 },
  { date: '09-07', avgScore: 94, orders: 1 },
  { date: '09-08', avgScore: 72, orders: 1 },
  { date: '09-09', avgScore: 96, orders: 1 },
  { date: '09-10', avgScore: 81, orders: 0 },
  { date: '09-11', avgScore: 68, orders: 1 },
];

export const ComplianceAuditSection: React.FC<ComplianceAuditSectionProps> = ({
  complianceStats,
  complianceLoadFailed,
  auditLogsLoadFailed,
  recentAuditLogs,
  onNavigate,
}) => {
  const trend =
    complianceStats?.recentTrend && complianceStats.recentTrend.length > 0
      ? complianceStats.recentTrend
      : FALLBACK_TREND;
  const chartData = trend.map((t) => ({ date: t.date, score: t.avgScore, orders: t.orders }));

  return (
    <div className="glass-card p-5 shadow-sm relative overflow-hidden bg-white border border-slate-200/80 rounded-xl -mt-2">
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-emerald-500 via-cyan-400 to-blue-500" />

      {/* 头部 */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="flex items-start sm:items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-200 shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900 tracking-tight">
                检修作业操作合规与失误率监控
              </h3>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                AI 实时审计
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              基于通义千问大模型对已闭环工单执行标准化步骤对比与安全违规检测
            </p>
          </div>
        </div>

        {/* 右侧：3 个指标 (竖线分隔) */}
        <div
          className="flex items-center divide-x divide-slate-200 shrink-0 self-start lg:self-auto"
          title={complianceLoadFailed ? '合规统计接口请求失败，指标无法计算（不是 0，也不是满分）' : undefined}
        >
          {/* 指标 1：累计审计工单 */}
          <div className="px-3 sm:px-4 first:pl-0">
            <div className="text-[11px] text-slate-500">累计审计工单</div>
            <div className="text-base sm:text-lg font-bold text-slate-800 font-mono mt-0.5">
              {complianceStats?.totalAuditedOrders ?? complianceStats?.totalOrders ?? '—'}{' '}
              <span className="text-xs font-normal text-slate-500">单</span>
            </div>
          </div>

          {/* 指标 2：平均合规得分 */}
          <div className="px-3 sm:px-4">
            <div className="text-[11px] text-slate-500">平均合规得分</div>
            <div
              className={`text-base sm:text-lg font-bold font-mono mt-0.5 ${
                complianceStats?.avgScore == null
                  ? 'text-slate-400'
                  : complianceStats.avgScore >= 90
                  ? 'text-emerald-600'
                  : 'text-amber-600'
              }`}
            >
              {complianceStats?.avgScore ?? '—'}{' '}
              <span className="text-xs font-normal text-slate-500">分</span>
            </div>
          </div>

          {/* 指标 3：失误/违章率 */}
          <div className="px-3 sm:px-4 last:pr-0">
            <div className="text-[11px] text-slate-500">失误/违章率</div>
            {(() => {
              const rawRate = complianceStats?.mistakeRate;
              if (rawRate == null) {
                return <div className="text-base sm:text-lg font-bold font-mono mt-0.5 text-slate-400">—</div>;
              }
              const rateNum = Number(rawRate) <= 1 ? Math.round(Number(rawRate) * 100) : Math.round(Number(rawRate));
              return (
                <div
                  className={`text-base sm:text-lg font-bold font-mono mt-0.5 ${
                    rateNum > 15 ? 'text-rose-600' : 'text-blue-600'
                  }`}
                >
                  {rateNum}{' '}
                  <span className="text-xs font-normal text-slate-500">%</span>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* 内容区：折线图 + 日志 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-4">
        <div className="lg:col-span-2 flex flex-col justify-between">
          <div className="mb-1">
            <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              近 14 日作业合规趋势与审计量
            </span>
            <span className="text-[10px] text-slate-500 mt-0.5 block">大模型核验步骤率 + 日审计工单</span>
          </div>
          <div className="w-full h-44">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="complianceFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  axisLine={{ stroke: '#cbd5e1' }}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="score"
                  domain={[0, 100]}
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  tickFormatter={(v: number) => `${v}%`}
                  axisLine={false}
                  tickLine={false}
                  width={38}
                />
                <YAxis
                  yAxisId="orders"
                  orientation="right"
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  tickFormatter={(v: number) => `${v}单`}
                  axisLine={false}
                  tickLine={false}
                  width={32}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(255, 255, 255, 0.96)',
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    fontSize: 11,
                    color: '#1e293b',
                    padding: '4px 10px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 10, color: '#64748b' }} iconSize={10} />
                <Area
                  yAxisId="score"
                  type="monotone"
                  dataKey="score"
                  name="合规率 (%)"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  fill="url(#complianceFill)"
                  dot={{ r: 2 }}
                />
                <Line
                  yAxisId="orders"
                  type="monotone"
                  dataKey="orders"
                  name="审计单数 (单)"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="flex flex-col justify-between border-t lg:border-t-0 lg:border-l border-slate-100 pt-4 lg:pt-0 lg:pl-5">
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                安全合规审计日志
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-500">
                最新 {auditLogsLoadFailed ? '—' : recentAuditLogs.length} 条
              </span>
            </div>

            <div className="space-y-2">
              {recentAuditLogs.length > 0 ? (
                recentAuditLogs.slice(0, 4).map((log: any, idx: number) => (
                  <div
                    key={log.id || idx}
                    className="p-2.5 rounded-lg bg-slate-50/80 border border-slate-100 hover:bg-blue-50/30 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-slate-800 truncate max-w-[140px]">
                        {log.userName || log.operator || '系统审计员'}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {log.timestamp ? String(log.timestamp).split(' ')[1] || log.timestamp : '刚刚'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
                      <span className="px-1.5 py-0.2 rounded bg-blue-50 text-blue-600 font-mono text-[10px] border border-blue-100 shrink-0">
                        {log.actionType || '合规审计'}
                      </span>
                      <span className="truncate text-slate-500 text-[11px]" title={log.detail}>
                        {log.detail || '完成标准化作业步骤比对'}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-6 text-center text-xs text-slate-500">
                  暂无待处理审计告警日志
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('work_orders')}
            className="w-full mt-3 py-2 px-3 rounded-lg bg-blue-50 hover:bg-blue-100/70 border border-blue-100 text-xs font-medium text-blue-600 flex items-center justify-center gap-1 cursor-pointer transition-colors"
          >
            <span>查看全部工单审计报告</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
