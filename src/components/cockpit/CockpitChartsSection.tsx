import React from 'react';
import {
  Activity,
  Sparkles,
  Box,
  ArrowUpRight,
  TrendingUp,
  BarChart3,
  Database,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  BarChart,
  Bar,
} from 'recharts';
import { SparePart, Hazard } from '../../types';

export interface CockpitChartsSectionProps {
  runningEquipments: number;
  warningEquipments: number;
  faultEquipments: number;
  onlineRate: string | null;
  woCompletionRate: string | null;
  eqStatusData: { name: string; value: number; color: string }[];
  handleEqStatusClick: (entry: any) => void;
  spareParts: SparePart[];
  trendData: { day: string; orders: number; faults: number }[];
  handleTrendClick: (point: any) => void;
  workshopBarData: { name: string; 总设备: number; 在行机组: number }[];
  knowledgeList: any[];
  majorHazards: Hazard[];
  onNavigateTab?: (tab: string) => void;
  onAskAi?: (prompt: string) => void;
  fmtPct: (v: string | null) => string;
}

export const CockpitChartsSection: React.FC<CockpitChartsSectionProps> = ({
  runningEquipments,
  warningEquipments,
  faultEquipments,
  onlineRate,
  woCompletionRate,
  eqStatusData,
  handleEqStatusClick,
  spareParts,
  trendData,
  handleTrendClick,
  workshopBarData,
  knowledgeList,
  majorHazards,
  onNavigateTab,
  onAskAi,
  fmtPct,
}) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 mb-4">
      {/* Left Column (4 cols): Equipment Status Donut & Spare Parts Alert */}
      <div className="lg:col-span-4 flex flex-col gap-4">
        {/* Donut Chart: 设备状态占比 */}
        <div className="glass-card p-4 shadow-sm flex flex-col flex-1">
          <div className="mb-2 flex items-start justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-800 flex items-center">
                <span className="w-1 h-3.5 rounded-full bg-blue-500 mr-2" />
                <Activity className="w-3.5 h-3.5 mr-1.5 text-blue-500" />
                设备健康分布与在行状态
              </h3>
              <span className="text-[10px] text-slate-500 mt-0.5 block">动态传感器聚合</span>
            </div>
            {onAskAi && (
              <button
                type="button"
                onClick={() =>
                  onAskAi(
                    `解读一下当前设备健康分布与在行状态反映的设备状态趋势，3 句话以内。正常运行 ${runningEquipments} 台，预警 ${warningEquipments} 台，故障 ${faultEquipments} 台，在线率 ${fmtPct(
                      onlineRate
                    )}。`
                  )
                }
                className="chip-cyan shrink-0 text-[10px] px-2 py-1"
                title="问 AI 解读此图表"
              >
                <Sparkles className="w-3 h-3" />
                问 AI
              </button>
            )}
          </div>
          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={eqStatusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={65}
                  paddingAngle={4}
                  dataKey="value"
                  onClick={handleEqStatusClick}
                  style={{ cursor: 'pointer' }}
                >
                  {eqStatusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    boxShadow: '0 2px 8px rgba(15,23,42,0.08)',
                    color: '#0f172a',
                    fontSize: '11px',
                  }}
                />
                <Legend
                  verticalAlign="bottom"
                  iconSize={8}
                  wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-100 text-[11px]">
            <div className="bg-slate-50/80 p-2 rounded-lg border border-slate-100">
              <span className="text-slate-500 block">平均健康指数</span>
              <span className="text-blue-600 font-sans font-bold text-base">92.4 分</span>
            </div>
            <div className="bg-slate-50/80 p-2 rounded-lg border border-slate-100">
              <span className="text-slate-500 block">遥测振动超标</span>
              <span className="text-amber-600 font-sans font-bold text-base">
                {warningEquipments} 台预警
              </span>
            </div>
          </div>
        </div>

        {/* Low Stock Alert Box */}
        <div className="glass-card p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-slate-800 flex items-center">
              <span className="w-1 h-3.5 rounded-full bg-amber-500 mr-2" />
              <Box className="w-3.5 h-3.5 mr-1.5 text-amber-500" />
              关键备件库存预警 (低安全阈值)
            </h3>
            {onNavigateTab && (
              <button
                onClick={() => onNavigateTab('spare_parts')}
                className="text-[10px] text-blue-600 hover:text-blue-700 cursor-pointer flex items-center font-medium"
              >
                备件库 <ArrowUpRight className="w-3 h-3 ml-0.5" />
              </button>
            )}
          </div>
          <div className="space-y-2">
            {spareParts
              .filter((p) => p.stock <= p.safe_stock)
              .slice(0, 3)
              .map((part) => (
                <div
                  key={part.id}
                  className="p-2 rounded-lg bg-rose-50/60 border border-rose-200 flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="font-semibold text-rose-900">{part.name}</div>
                    <div className="text-[10px] text-slate-500 font-mono">
                      {part.specification} · {part.location}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold text-rose-600">
                      {part.stock} {part.unit}
                    </div>
                    <div className="text-[9px] text-slate-500 font-mono">
                      告警线 {part.safe_stock}
                    </div>
                  </div>
                </div>
              ))}
            {spareParts.filter((p) => p.stock <= p.safe_stock).length === 0 && (
              <p className="text-xs text-slate-500 py-3 text-center">所有核心备件余量均在安全线以上</p>
            )}
          </div>
        </div>
      </div>

      {/* Center Column (5 cols): 14-day Orders & Faults Trend + Workshop Load */}
      <div className="lg:col-span-5 flex flex-col gap-4">
        {/* Line Chart: 近 14 日检修工单与故障工单频次 */}
        <div className="glass-card p-4 shadow-sm flex flex-col flex-1">
          <div className="mb-2 flex items-start justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-800 flex items-center">
                <span className="w-1 h-3.5 rounded-full bg-emerald-500 mr-2" />
                <TrendingUp className="w-3.5 h-3.5 mr-1.5 text-emerald-500" />
                近 14 日检修工单下发与故障工单走势
              </h3>
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                按 workOrders.createdAt 真实分桶（AI 调用无按日明细，未画）
              </span>
            </div>
            {onAskAi && (
              <button
                type="button"
                onClick={() =>
                  onAskAi(
                    `解读一下当前近 14 日检修工单与故障工单走势反映的设备状态趋势，3 句话以内。工单完成率 ${fmtPct(
                      woCompletionRate
                    )}，在线率 ${fmtPct(onlineRate)}。`
                  )
                }
                className="chip-cyan shrink-0 text-[10px] px-2 py-1"
                title="问 AI 解读此图表"
              >
                <Sparkles className="w-3 h-3" />
                问 AI
              </button>
            )}
          </div>
          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={trendData}
                margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
                onClick={(state: any) => {
                  const p = state?.activePayload?.[0]?.payload;
                  if (p) handleTrendClick(p);
                }}
                style={{ cursor: 'pointer' }}
              >
                <defs>
                  <linearGradient id="orderGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="faultGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="day" stroke="#94a3b8" tick={{ fill: '#64748b', fontSize: 10 }} />
                <YAxis stroke="#94a3b8" tick={{ fill: '#64748b', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    boxShadow: '0 2px 8px rgba(15,23,42,0.08)',
                    color: '#0f172a',
                    fontSize: '11px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="orders"
                  name="检修工单"
                  stroke="#3b82f6"
                  fill="url(#orderGrad)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="faults"
                  name="故障工单"
                  stroke="#f59e0b"
                  fill="url(#faultGrad)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bar Chart: 车间产线负荷与在行设备分布 */}
        <div className="glass-card p-4 shadow-sm">
          <div className="mb-2 flex items-start justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-800 flex items-center">
                <span className="w-1 h-3.5 rounded-full bg-emerald-500 mr-2" />
                <BarChart3 className="w-3.5 h-3.5 mr-1.5 text-emerald-500" />
                各生产单元设备在役与负荷分布
              </h3>
              <span className="text-[10px] text-slate-500 mt-0.5 block">单元机组对账</span>
            </div>
            {onAskAi && (
              <button
                type="button"
                onClick={() =>
                  onAskAi(`解读一下当前各生产单元设备在役与负荷分布反映的产线健康状态，3 句话以内。`)
                }
                className="chip-cyan shrink-0 text-[10px] px-2 py-1"
                title="问 AI 解读此图表"
              >
                <Sparkles className="w-3 h-3" />
                问 AI
              </button>
            )}
          </div>
          <div className="h-36 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={workshopBarData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" stroke="#94a3b8" tick={{ fill: '#64748b', fontSize: 10 }} />
                <YAxis stroke="#94a3b8" tick={{ fill: '#64748b', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    boxShadow: '0 2px 8px rgba(15,23,42,0.08)',
                    color: '#0f172a',
                    fontSize: '11px',
                  }}
                />
                <Bar dataKey="总设备" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="在行机组" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Right Column (3 cols): Knowledge Base Stats & High Risk LOTO */}
      <div className="lg:col-span-3 flex flex-col gap-4">
        {/* Knowledge & AI Metrics */}
        <div className="glass-card p-4 shadow-sm">
          <h3 className="text-xs font-bold text-slate-800 flex items-center mb-3">
            <span className="w-1 h-3.5 rounded-full bg-violet-500 mr-2" />
            <Database className="w-3.5 h-3.5 mr-1.5 text-violet-500" />
            知识图谱与标准沉淀
          </h3>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50/80 border border-slate-100">
              <span className="text-slate-500">已入库 SOP 规程</span>
              <span className="font-mono font-bold text-slate-900">{knowledgeList.length} 篇</span>
            </div>
            <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50/80 border border-slate-100">
              <span className="text-slate-500">向量检索库 (Chroma/DashScope)</span>
              <span className="font-mono font-bold text-emerald-600">已联机 (1536维)</span>
            </div>
            <div className="flex justify-between items-center p-2 rounded-lg bg-slate-50/80 border border-slate-100">
              <span className="text-slate-500">专家审核与标注纠错</span>
              <span className="font-mono font-bold text-blue-600">12 条已沉淀</span>
            </div>
          </div>
        </div>

        {/* Major Hazards Watchlist */}
        <div className="glass-card p-4 shadow-sm flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-rose-700 flex items-center">
              <span className="w-1 h-3.5 rounded-full bg-rose-500 mr-2" />
              <AlertTriangle className="w-3.5 h-3.5 mr-1.5 text-rose-500" />
              重大隐患重点督办清单
            </h3>
            {onNavigateTab && (
              <button
                onClick={() => onNavigateTab('hazards')}
                className="text-[10px] text-rose-600 hover:text-rose-700 font-medium cursor-pointer flex items-center"
              >
                隐患库 <ArrowUpRight className="w-3 h-3 ml-0.5" />
              </button>
            )}
          </div>
          <div className="space-y-2 flex-1 overflow-y-auto max-h-48 pr-1">
            {majorHazards.map((h) => (
              <div
                key={h.id}
                className="p-2.5 rounded-lg bg-rose-50/70 border border-rose-200 text-xs space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-rose-900 line-clamp-1">{h.title}</span>
                  <span className="px-1.5 py-0.5 rounded text-[9px] bg-rose-100 text-rose-800 font-mono font-medium">
                    {h.status === 'pending'
                      ? '待整改'
                      : h.status === 'rectifying'
                      ? '整改中'
                      : '待复核'}
                  </span>
                </div>
                <div className="text-[10px] text-slate-600 line-clamp-2">{h.description}</div>
                <div className="text-[9px] text-slate-500 font-mono">
                  截止: {h.deadline || '今日下班前'}
                </div>
              </div>
            ))}
            {majorHazards.length === 0 && (
              <div className="py-6 text-center text-xs text-emerald-600">
                <CheckCircle2 className="w-6 h-6 mx-auto mb-1 text-emerald-500" />
                当前无重大挂牌督办隐患，安全状态良好
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
