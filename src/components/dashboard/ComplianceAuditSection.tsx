import React, { useRef, useEffect } from 'react';
import {
  ShieldCheck,
  ChevronRight,
} from 'lucide-react';
import { ComplianceStats } from '../../types';
import * as echarts from 'echarts';

export interface ComplianceAuditSectionProps {
  complianceStats: ComplianceStats | null;
  complianceLoadFailed: boolean;
  auditLogsLoadFailed: boolean;
  recentAuditLogs: any[];
  onNavigate: (tab: string) => void;
}

export const ComplianceAuditSection: React.FC<ComplianceAuditSectionProps> = ({
  complianceStats,
  complianceLoadFailed,
  auditLogsLoadFailed,
  recentAuditLogs,
  onNavigate,
}) => {
  const complianceChartRef = useRef<HTMLDivElement>(null);
  const complianceChartInstance = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!complianceChartRef.current) return;
    if (!complianceChartInstance.current) {
      complianceChartInstance.current = echarts.init(complianceChartRef.current);
    }
    const chart = complianceChartInstance.current;
    const trend = complianceStats?.recentTrend || [];
    const dates = trend.map((t) => t.date);
    const scores = trend.map((t) => t.avgScore);
    const orders = trend.map((t) => t.orders);

    const option: echarts.EChartsOption = {
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(255, 255, 255, 0.96)',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        textStyle: { color: '#1e293b', fontSize: 11 },
        padding: [6, 10],
      },
      legend: {
        data: ['合规率 (%)', '审计单数 (单)'],
        top: 0,
        right: 10,
        textStyle: { fontSize: 10, color: '#64748b' },
        itemWidth: 10,
        itemHeight: 6,
        itemGap: 16,
      },
      grid: {
        top: 32,
        right: 30,
        bottom: 12,
        left: 12,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: dates.length ? dates : ['09-05', '09-06', '09-07', '09-08', '09-09', '09-10', '09-11'],
        axisLine: { lineStyle: { color: '#cbd5e1' } },
        axisLabel: { color: '#64748b', fontSize: 10 },
      },
      yAxis: [
        {
          type: 'value',
          name: '合规率%',
          min: 0,
          max: 100,
          splitLine: { lineStyle: { color: '#f1f5f9', type: 'dashed' } },
          axisLabel: { color: '#64748b', fontSize: 10, formatter: '{value}%' },
        },
        {
          type: 'value',
          name: '审计单数',
          min: 0,
          splitLine: { show: false },
          axisLabel: { color: '#64748b', fontSize: 10, formatter: '{value}单' },
        },
      ],
      series: [
        {
          name: '合规率 (%)',
          type: 'line',
          yAxisIndex: 0,
          smooth: true,
          showSymbol: true,
          symbolSize: 4,
          itemStyle: { color: '#10b981' },
          lineStyle: { width: 2.5, color: '#10b981' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(16, 185, 129, 0.18)' },
              { offset: 1, color: 'rgba(16, 185, 129, 0.01)' },
            ]),
          },
          data: scores.length ? scores : [81, 52, 94, 72, 96, 81, 68],
        },
        {
          name: '审计单数 (单)',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          showSymbol: true,
          symbolSize: 4,
          itemStyle: { color: '#3b82f6' },
          lineStyle: { width: 2, color: '#3b82f6' },
          data: orders.length ? orders : [0, 1, 1, 1, 1, 0, 1],
        },
      ],
    };

    chart.setOption(option);

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [complianceStats]);

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
          <div ref={complianceChartRef} className="w-full h-44" />
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
