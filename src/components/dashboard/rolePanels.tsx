/**
 * 工作台的角色专属面板（从 DashboardView.tsx 整块搬出，逐字节未改）。
 *
 * 背景：DashboardView.tsx 曾达 2282 行，其中 7 个 `{currentUser.role === 'x' && (…)}`
 * 区块占约 990 行。这些区块只依赖少量显式数据，抽出来之后宿主只剩"取数 + 分派"。
 *
 * ⚠️ 搬移约定：每个组件的 JSX 主体与拆分前**逐字节相同**（连缩进都没动），
 *    所以 `DashboardView.tsx` 的 includes() 自证是有效的。改样式请照常改，别指望缩进对齐。
 */
import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Wrench,
  ShieldCheck,
  Zap,
  TrendingUp,
  ChevronRight,
  ShieldAlert,
  History,
  Check,
  X,
  BookOpen,
  Share2,
  Flame,
  CheckSquare,
  FileCheck,
  Truck,
} from 'lucide-react';
import type {
  UserProfile,
  Equipment,
  WorkOrder,
  InspectionTask,
  SafetyPermit,
  Hazard,
  LotoLock,
} from '../../types';
import type { AiReport } from '../../api';

export interface AdminPanelsProps {
  currentUser: UserProfile;
  workOrders: WorkOrder[];
  pendingSafetyApprovals: SafetyPermit[];
  pendingHazardsList: Hazard[];
  recentAuditLogs: any[];
  activeLotoLocks: LotoLock[];
  hazardsLoadFailed: boolean;
  auditLogsLoadFailed: boolean;
  onNavigate: (tab: string) => void;
}

export const AdminPanels: React.FC<AdminPanelsProps> = ({
  currentUser,
  workOrders,
  pendingSafetyApprovals,
  pendingHazardsList,
  recentAuditLogs,
  activeLotoLocks,
  hazardsLoadFailed,
  auditLogsLoadFailed,
  onNavigate,
}) => (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 卡片 1: 全局待审批 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-amber-50 text-amber-600 border border-amber-200">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">全局高危待审批</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">
                    {pendingSafetyApprovals.length + workOrders.filter(w => w.status === 'pending_acceptance').length} 项待批
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-3">特种作业票终审与检修工单会签验收核准</p>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-100">
                    <span className="text-slate-600">待审批高危作业票</span>
                    <span className="font-bold text-amber-600 font-mono">{pendingSafetyApprovals.length} 份</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-100">
                    <span className="text-slate-600">待验收工单终审会签</span>
                    <span className="font-bold text-purple-600 font-mono">{workOrders.filter(w => w.status === 'pending_acceptance').length} 项</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-100">
                    <span className="text-slate-600">在控 LOTO 停电隔离锁</span>
                    <span className="font-bold text-emerald-600 font-mono">{activeLotoLocks.length} 组</span>
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3 flex items-center justify-between">
                <button
                  onClick={() => onNavigate('safety')}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center cursor-pointer"
                >
                  <span>会签作业票</span>
                  <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                </button>
                <button
                  onClick={() => onNavigate('work_orders')}
                  className="text-xs text-purple-600 hover:text-purple-700 font-medium flex items-center cursor-pointer"
                >
                  <span>会签工单</span>
                  <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                </button>
              </div>
            </div>

            {/* 卡片 2: 最近审计日志 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200">
                      <History className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">安全合规审计日志</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold">
                    实时留痕
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">全厂鉴权/提单/作业票审批合规记录</p>
                <div className="space-y-1.5 text-xs">
                  {recentAuditLogs.slice(0, 3).map((log, idx) => (
                    <div key={log.id || idx} className="p-2 rounded bg-slate-50 border border-slate-100 text-[11px]">
                      <div className="flex items-center justify-between text-slate-500">
                        <span className="font-semibold text-slate-800">{log.userName || log.userRole} · {log.actionType}</span>
                        <span className="font-mono text-[10px]">{log.createdAt ? new Date(log.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '刚刚'}</span>
                      </div>
                      <p className="text-slate-600 truncate mt-0.5">{log.detail || log.actionDesc || '操作合规留痕'}</p>
                    </div>
                  ))}
                  {recentAuditLogs.length === 0 && (
                    <div className="p-3 text-center text-slate-500 text-[11px]">
                      {auditLogsLoadFailed ? '审计日志加载失败，无法判断是否留有合规流水' : '暂无最近审计流水'}
                    </div>
                  )}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('users')}
                  className="w-full text-center text-xs text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                >
                  查看完整审计日志与用户花名册 →
                </button>
              </div>
            </div>

            {/* 卡片 3: 隐患未闭环督办 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-rose-50 text-rose-600 border border-rose-200">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">全厂隐患未闭环督办</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-100 text-rose-700 font-semibold">
                    {pendingHazardsList.length} 项在控
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">重大与一般隐患整改时限与闭环跟踪</p>
                <div className="space-y-1.5 text-xs">
                  {pendingHazardsList.slice(0, 2).map((h) => (
                    <div key={h.id} className="p-2 rounded bg-amber-50/50 border border-amber-200 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900 truncate max-w-[180px]">{h.title}</span>
                        <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${h.level === 'major' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                          {h.level === 'major' ? '重大' : '一般'}
                        </span>
                      </div>
                      <div className="text-slate-500 text-[10px] mt-1 flex justify-between">
                        <span>设备: {h.equipment_name || '通用区'}</span>
                        <span className="text-rose-600 font-mono">限期: {h.deadline || '本周内'}</span>
                      </div>
                    </div>
                  ))}
                  {pendingHazardsList.length === 0 && (
                    <div className="p-3 text-center text-slate-500 text-[11px]">
                      {hazardsLoadFailed ? '隐患数据加载失败，请刷新重试' : '当前全厂无未闭环隐患'}
                    </div>
                  )}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('hazards')}
                  className="w-full text-center text-xs text-amber-700 hover:text-amber-800 font-medium cursor-pointer"
                >
                  进入安全隐患闭环治理中枢 →
                </button>
              </div>
            </div>
          </div>
);

export interface ManagerPanelsProps {
  currentUser: UserProfile;
  equipments: Equipment[];
  workOrders: WorkOrder[];
  activeWorkOrders: WorkOrder[];
  urgentOrders: WorkOrder[];
  pendingSafetyApprovals: SafetyPermit[];
  onNavigate: (tab: string) => void;
}

export const ManagerPanels: React.FC<ManagerPanelsProps> = ({
  currentUser,
  equipments,
  workOrders,
  activeWorkOrders,
  urgentOrders,
  pendingSafetyApprovals,
  onNavigate,
}) => (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 卡片 1: 团队工单完成率 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200">
                      <TrendingUp className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">车间团队工单完成率</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                    达标 94.2%
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-3">动力车间运维班组抢修与例行维保执行效能</p>
                <div className="space-y-2 text-xs">
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div className="bg-emerald-500 h-2 rounded-full" style={{ width: '94.2%' }}></div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-2 text-center text-[11px]">
                    <div className="p-2 rounded bg-slate-50 border border-slate-100">
                      <div className="text-slate-500 text-[10px]">活动中</div>
                      <div className="font-bold text-blue-600 font-mono text-sm">{activeWorkOrders.length}</div>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-100">
                      <div className="text-slate-500 text-[10px]">紧急抢修</div>
                      <div className="font-bold text-rose-600 font-mono text-sm">{urgentOrders.length}</div>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-100">
                      <div className="text-slate-500 text-[10px]">已归档</div>
                      <div className="font-bold text-emerald-600 font-mono text-sm">{workOrders.filter(w => w.status === 'completed').length}</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('work_orders')}
                  className="w-full text-center text-xs text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                >
                  工单智能调度与派工中心 →
                </button>
              </div>
            </div>

            {/* 卡片 2: 待我审批列表 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-purple-50 text-purple-600 border border-purple-200">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">待我终审与会签</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-semibold">
                    {pendingSafetyApprovals.length} 项待签
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">高危作业票（动火/受限空间/高处）终审</p>
                <div className="space-y-1.5 text-xs">
                  {pendingSafetyApprovals.slice(0, 2).map((s) => (
                    <div key={s.id} className="p-2 rounded bg-purple-50/60 border border-purple-200 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-purple-900 truncate">{s.permitNo} · {s.permitType}</span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-200 text-purple-800 font-semibold">待审批</span>
                      </div>
                      <p className="text-slate-600 text-[10px] truncate mt-0.5">{(s as any).workContent || s.title || '车间特种作业会签'}</p>
                    </div>
                  ))}
                  {pendingSafetyApprovals.length === 0 && (
                    <div className="p-3 text-center text-slate-500 text-[11px]">当前无待审批作业票</div>
                  )}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('safety')}
                  className="w-full text-center text-xs text-purple-600 hover:text-purple-700 font-medium cursor-pointer"
                >
                  进入安全作业票审批中心 →
                </button>
              </div>
            </div>

            {/* 卡片 3: 预警设备 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-amber-50 text-amber-600 border border-amber-200">
                      <Zap className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">车间预警设备雷达</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">
                    {equipments.filter(e => (e.healthScore != null && e.healthScore < 80) || e.status === 'warning').length} 台重点关注
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">健康分&lt;80或遥测异常机组监控</p>
                <div className="space-y-1.5 text-xs">
                  {equipments.filter(e => (e.healthScore != null && e.healthScore < 80) || e.status === 'warning').slice(0, 2).map((eq) => (
                    <div key={eq.id} className="p-2 rounded bg-amber-50/50 border border-amber-200 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900 truncate">{eq.name}</span>
                        <span className="text-[10px] font-mono font-bold text-rose-600">{eq.healthScore ?? '—'}分</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1 flex justify-between">
                        <span>振动: {eq.telemetry?.vibration ?? "—"}mm/s</span>
                        <span>温度: {eq.telemetry?.temperature ?? "—"}°C</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('health')}
                  className="w-full text-center text-xs text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                >
                  进入健康监测遥测大屏 →
                </button>
              </div>
            </div>
          </div>
);

export interface TechnicianPanelsProps {
  currentUser: UserProfile;
  equipments: Equipment[];
  workOrders: WorkOrder[];
  recommendProcedures: any[];
  proceduresLoadFailed: boolean;
  onSelectWorkOrder: (wo: WorkOrder) => void;
  onNavigate: (tab: string) => void;
}

export const TechnicianPanels: React.FC<TechnicianPanelsProps> = ({
  currentUser,
  equipments,
  workOrders,
  recommendProcedures,
  proceduresLoadFailed,
  onSelectWorkOrder,
  onNavigate,
}) => (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 卡片 1: 分配给我的工单 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200">
                      <Wrench className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">分配给我的检修工单</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">
                    {workOrders.filter(w => (w.assignee && w.assignee.includes(currentUser.name)) || w.status === 'dispatched').length} 项待处
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">当前指派给您或维保班组负责的工单</p>
                <div className="space-y-1.5 text-xs">
                  {workOrders.filter(w => (w.assignee && w.assignee.includes(currentUser.name)) || w.status === 'dispatched').slice(0, 2).map((wo) => (
                    <div key={wo.id} onClick={() => onSelectWorkOrder(wo)} className="p-2 rounded bg-slate-50 border border-slate-200 hover:border-blue-300 transition-colors cursor-pointer text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900 truncate">{wo.title}</span>
                        <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${wo.priority === 'urgent' ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'}`}>
                          {wo.priority === 'urgent' ? '紧急抢修' : '检修'}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1 flex justify-between">
                        <span>{wo.equipmentName}</span>
                        <span className="text-blue-600">点击处理 →</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('work_orders')}
                  className="w-full text-center text-xs text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                >
                  查看全部维保工单 →
                </button>
              </div>
            </div>

            {/* 卡片 2: 设备健康度预警 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-amber-50 text-amber-600 border border-amber-200">
                      <Zap className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">负责机组遥测超标预警</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">
                    振动/温升偏高
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">需要现场紧固对中或润滑补油的机组</p>
                <div className="space-y-1.5 text-xs">
                  {equipments.filter(e => e.healthScore != null && e.healthScore < 85).slice(0, 2).map((eq) => (
                    <div key={eq.id} className="p-2 rounded bg-amber-50/50 border border-amber-200 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900 truncate">{eq.name}</span>
                        <span className="text-[10px] font-mono font-bold text-rose-600">{eq.healthScore ?? '—'}分</span>
                      </div>
                      <div className="text-[10px] text-slate-600 mt-1 flex justify-between">
                        <span>振动: {eq.telemetry?.vibration ?? "—"}mm/s</span>
                        <span>温升: {eq.telemetry?.temperature ?? "—"}°C</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('ai_assistant')}
                  className="w-full text-center text-xs text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                >
                  一键启动 AI 多维智能诊断 →
                </button>
              </div>
            </div>

            {/* 卡片 3: 常用作业指引 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-emerald-50 text-emerald-600 border border-emerald-200">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">推荐检修作业指引 SOP</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                    SOP标准化
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">机电拆装、对中调校、轴承更换规程</p>
                <div className="space-y-1.5 text-xs">
                  {recommendProcedures.slice(0, 2).map((proc) => (
                    <div key={proc.id} onClick={() => onNavigate('procedures')} className="p-2 rounded bg-slate-50 border border-slate-200 hover:border-emerald-300 transition-colors cursor-pointer text-[11px]">
                      <div className="font-semibold text-slate-900 truncate">{proc.title}</div>
                      <div className="text-[10px] text-slate-500 mt-1 flex justify-between">
                        <span>{proc.equipmentType || '通用机电'}</span>
                        <span className="text-emerald-600">查阅规程 →</span>
                      </div>
                    </div>
                  ))}
                  {recommendProcedures.length === 0 && (
                    // ⚠️ 这里原本硬编码渲染《硬齿面减速机高速轴轴承更换SOP规程》已就绪 ——
                    // 一条**库里不存在的规程**，长得跟真实推荐记录一模一样。空列表就该说空列表。
                    <div className="p-2 rounded bg-slate-50 text-slate-600 text-[11px]">
                      {proceduresLoadFailed ? '推荐规程加载失败，请刷新重试' : '暂无推荐规程'}
                    </div>
                  )}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('procedures')}
                  className="w-full text-center text-xs text-emerald-600 hover:text-emerald-700 font-medium cursor-pointer"
                >
                  进入标准化作业规程库 →
                </button>
              </div>
            </div>
          </div>
);

export interface InspectorPanelsProps {
  currentUser: UserProfile;
  inspections: InspectionTask[];
  onNavigate: (tab: string) => void;
}

export const InspectorPanels: React.FC<InspectorPanelsProps> = ({ currentUser, inspections, onNavigate }) => (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 卡片 1: 我的今日巡检任务 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-cyan-50 text-cyan-600 border border-cyan-200">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">我的今日巡检打卡任务</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-100 text-cyan-800 font-semibold">
                    进行中
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">关键动设备智能巡检路线与测点打卡</p>
                <div className="space-y-2 text-xs">
                  {inspections.slice(0, 2).map((t) => (
                    <div key={t.id} className="p-2 rounded bg-slate-50 border border-slate-200 text-[11px]">
                      <div className="flex items-center justify-between font-semibold text-slate-900">
                        <span className="truncate">{t.title}</span>
                        <span className="text-[10px] text-cyan-700 font-mono">{t.completedPoints}/{t.totalPoints} 测点</span>
                      </div>
                      <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden mt-1.5">
                        <div className="bg-cyan-500 h-1.5 rounded-full" style={{ width: `${Math.round(((t.completedPoints || 1) / (t.totalPoints || 1)) * 100)}%` }}></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('inspections')}
                  className="w-full text-center text-xs text-cyan-700 hover:text-cyan-800 font-medium cursor-pointer"
                >
                  进入巡检作业终端打卡 →
                </button>
              </div>
            </div>

            {/* 卡片 2: 安全监护待办 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-amber-50 text-amber-600 border border-amber-200">
                      <ShieldAlert className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">专职安全监护会签待办</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">
                    安全在控
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">动火作业气体检测与现场监护责任人会签</p>
                <div className="space-y-1.5 text-xs">
                  <div className="p-2 rounded bg-amber-50/60 border border-amber-200 text-[11px]">
                    <div className="font-semibold text-slate-900">动火票 SP-20260902-01 现场气体检测</div>
                    <div className="text-[10px] text-slate-600 mt-1">3# 轧机齿圈热喷涂补焊 · 可燃气体含量 0.05% 合格</div>
                  </div>
                  <div className="p-2 rounded bg-slate-50 border border-slate-200 text-[11px]">
                    <div className="font-semibold text-slate-900">高空与吊装作业安全隔离带核检</div>
                    <div className="text-[10px] text-slate-600 mt-1">起重半径警戒线、灭火器具摆放就位核验</div>
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('safety')}
                  className="w-full text-center text-xs text-amber-700 hover:text-amber-800 font-medium cursor-pointer"
                >
                  签署安全监护会签意见 →
                </button>
              </div>
            </div>

            {/* 卡片 3: 隐患上报入口 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-rose-50 text-rose-600 border border-rose-200">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">点检异常与现场隐患上报</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-50 text-rose-700 font-semibold border border-rose-200">
                    绿色通道
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">现场巡检发现跑冒滴漏或异常测点快速立项</p>
                <div className="p-3 rounded-lg bg-rose-50/50 border border-rose-100 text-xs text-slate-700 space-y-1.5">
                  <div className="text-[11px] font-semibold text-rose-800">点检异常转隐患规范：</div>
                  <div className="text-[10px] text-slate-600 leading-relaxed">
                    1. 拍照留存轴承异常发热或振动超标测温数据<br />
                    2. 评估隐患等级（一般隐患/重大隐患）<br />
                    3. 一键立项直通闭环治理，指派机械/电气专工排查
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('hazards')}
                  className="w-full text-center text-xs text-rose-600 hover:text-rose-700 font-medium cursor-pointer"
                >
                  前往隐患闭环登记新隐患 →
                </button>
              </div>
            </div>
          </div>
);

export interface OperatorPanelsProps {
  currentUser: UserProfile;
  workOrders: WorkOrder[];
  onOpenCreateWorkOrder: () => void;
  onSelectWorkOrder: (wo: WorkOrder) => void;
  onNavigate: (tab: string) => void;
}

export const OperatorPanels: React.FC<OperatorPanelsProps> = ({
  currentUser,
  workOrders,
  onOpenCreateWorkOrder,
  onSelectWorkOrder,
  onNavigate,
}) => (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 卡片 1: 我创建的工单 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-emerald-50 text-emerald-600 border border-emerald-200">
                      <Wrench className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">我上报的报修工单</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">
                    现场维保跟进
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">岗位操作报修实时流转节点跟踪</p>
                <div className="space-y-1.5 text-xs">
                  {workOrders.filter(w => (w.creator && w.creator.includes(currentUser.name)) || (w.assignee && w.assignee.includes(currentUser.name))).slice(0, 2).map((wo) => (
                    <div key={wo.id} onClick={() => onSelectWorkOrder(wo)} className="p-2 rounded bg-slate-50 border border-slate-200 text-[11px] cursor-pointer hover:border-emerald-300">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900 truncate">{wo.title}</span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-blue-100 text-blue-700">{wo.status}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1 flex justify-between">
                        <span>主修: {wo.assignee || '待派单'}</span>
                        <span className="text-emerald-600">查看进度 →</span>
                      </div>
                    </div>
                  ))}
                  {workOrders.filter(w => (w.creator && w.creator.includes(currentUser.name)) || (w.assignee && w.assignee.includes(currentUser.name))).length === 0 && (
                    <div className="p-3 text-center text-slate-500 text-[11px]">
                      WO-20260904-122 (离心风机皮带异响) 张技师已接单
                    </div>
                  )}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3 flex items-center justify-between">
                <button
                  onClick={onOpenCreateWorkOrder}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                >
                  快速故障报修 +
                </button>
                <button
                  onClick={() => onNavigate('work_orders')}
                  className="text-xs text-emerald-600 hover:text-emerald-700 font-medium cursor-pointer"
                >
                  查看我的工单 →
                </button>
              </div>
            </div>

            {/* 卡片 2: 我的作业指引 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">岗位日常标准作业指引</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold border border-blue-200">
                    岗位操作卡
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">生产机组启停、切换、日常点检规范</p>
                <div className="space-y-1.5 text-xs">
                  <div onClick={() => onNavigate('procedures')} className="p-2 rounded bg-slate-50 border border-slate-200 hover:border-blue-300 transition-colors cursor-pointer text-[11px]">
                    <div className="font-semibold text-slate-900">《离心式高压注水泵日常启停操作卡》</div>
                    <div className="text-[10px] text-slate-500 mt-1">开阀充水 · 盘车确认 · 启动升压五步法</div>
                  </div>
                  <div onClick={() => onNavigate('procedures')} className="p-2 rounded bg-slate-50 border border-slate-200 hover:border-blue-300 transition-colors cursor-pointer text-[11px]">
                    <div className="font-semibold text-slate-900">《现场机组轴承日常点检及润滑补油规程》</div>
                    <div className="text-[10px] text-slate-500 mt-1">油位视镜检查 · 油质沉淀排查要点</div>
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('procedures')}
                  className="w-full text-center text-xs text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                >
                  查阅全量标准作业规程 →
                </button>
              </div>
            </div>

            {/* 卡片 3: 今日安全须知 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-amber-50 text-amber-600 border border-amber-200">
                      <Flame className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">今日早班安全交底须知</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">
                    班前交底
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">生产一线安全禁令与个人劳保穿戴要求</p>
                <div className="space-y-1.5 text-xs">
                  <div className="p-2 rounded bg-amber-50/60 border border-amber-200 text-[11px]">
                    <span className="font-bold text-amber-900">防机械夹伤红线：</span>
                    <span className="text-slate-700"> 设备运转时严禁接触传动皮带与联轴器防护罩。</span>
                  </div>
                  <div className="p-2 rounded bg-slate-50 border border-slate-200 text-[11px]">
                    <span className="font-bold text-slate-800">动火区域隔离：</span>
                    <span className="text-slate-600"> 维保动火点周边 10 米内严禁堆放油棉纱及可燃包装物。</span>
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('safety')}
                  className="w-full text-center text-xs text-amber-700 hover:text-amber-800 font-medium cursor-pointer"
                >
                  查看车间在控高危作业票 →
                </button>
              </div>
            </div>
          </div>
);

export interface ArchivistPanelsProps {
  currentUser: UserProfile;
  pendingReviewArticles: any[];
  pendingReviewLoadFailed: boolean;
  knowledgeStats: { total: number; categories: Record<string, number> } | null;
  knowledgeLoadFailed: boolean;
  graphStats: { nodes: number; edges: number } | null;
  graphLoadFailed: boolean;
  isExtractingGraph: boolean;
  handleApproveKnowledge: (id: string) => Promise<void>;
  handleRejectKnowledge: (id: string) => Promise<void>;
  handleExtractGraph: () => Promise<void>;
  onNavigate: (tab: string) => void;
}

export const ArchivistPanels: React.FC<ArchivistPanelsProps> = ({
  currentUser,
  pendingReviewArticles,
  pendingReviewLoadFailed,
  knowledgeStats,
  knowledgeLoadFailed,
  graphStats,
  graphLoadFailed,
  isExtractingGraph,
  handleApproveKnowledge,
  handleRejectKnowledge,
  handleExtractGraph,
  onNavigate,
}) => (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 卡片 1: 待审核知识条目 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-indigo-50 text-indigo-600 border border-indigo-200">
                      <FileCheck className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">待审核知识规程队列</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 font-semibold">
                    {pendingReviewArticles.length} 篇待审
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">技师上报 SOP 与案例快速审批流</p>
                <div className="space-y-2 text-xs">
                  {pendingReviewArticles.slice(0, 2).map((art) => (
                    <div key={art.id} className="p-2 rounded bg-indigo-50/40 border border-indigo-200 text-[11px]">
                      <div className="font-semibold text-slate-900 truncate">{art.title}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">作者: {art.author || '现场维保人员'}</div>
                      <div className="flex items-center space-x-2 mt-2">
                        <button
                          onClick={() => handleApproveKnowledge(art.id)}
                          className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-medium flex items-center space-x-1 cursor-pointer"
                        >
                          <Check className="w-3 h-3" />
                          <span>批准入库</span>
                        </button>
                        <button
                          onClick={() => handleRejectKnowledge(art.id)}
                          className="px-2 py-0.5 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-medium flex items-center space-x-1 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                          <span>驳回修正</span>
                        </button>
                      </div>
                    </div>
                  ))}
                  {pendingReviewArticles.length === 0 && (
                    <div className="p-3 text-center text-slate-500 text-[11px]">
                      {pendingReviewLoadFailed
                        ? '待审列表加载失败，无法判断是否还有未审核条目'
                        : '暂无待审核知识条目，所有提交规程均已完成入库归档'}
                    </div>
                  )}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('knowledge')}
                  className="w-full text-center text-xs text-indigo-600 hover:text-indigo-700 font-medium cursor-pointer"
                >
                  进入知识库审核中心 →
                </button>
              </div>
            </div>

            {/* 卡片 2: 知识库数字化资产统计 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">数字知识中枢资产</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">
                    {/* 原先 `knowledgeStats.total || 8` —— 取不到就写死 8 篇 */}
                    已入库 {knowledgeLoadFailed || knowledgeStats == null ? '—' : `${knowledgeStats.total} 篇`}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">按库内真实分类统计（取篇数最多的 3 类）</p>
                <div className="space-y-1.5 text-xs">
                  {/* 原先这里是三个写死的行：标准化作业规程 4 篇 / 典型故障分析 3 篇 /
                      设备机械结构手册 2 篇 —— 三个分类名在 knowledge_articles 里一个都不存在，
                      而且 4+3+2=9 与上方的"8 篇"自相矛盾。 */}
                  {knowledgeStats == null || Object.keys(knowledgeStats.categories).length === 0 ? (
                    <div className="p-2 rounded bg-slate-50 text-slate-500 text-[11px]">
                      {knowledgeLoadFailed ? '知识库统计加载失败，无法判断资产规模' : '知识库暂无分类数据'}
                    </div>
                  ) : (
                    Object.entries(knowledgeStats.categories)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 3)
                      .map(([name, count], idx) => (
                        <div
                          key={name}
                          className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-100 text-[11px]"
                        >
                          <span className="text-slate-600 truncate">{name}</span>
                          <span
                            className={`font-bold font-mono shrink-0 ${
                              ['text-blue-600', 'text-indigo-600', 'text-emerald-600'][idx] || 'text-slate-600'
                            }`}
                          >
                            {count} 篇
                          </span>
                        </div>
                      ))
                  )}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('knowledge')}
                  className="w-full text-center text-xs text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                >
                  导入新文档或导出技术档案 →
                </button>
              </div>
            </div>

            {/* 卡片 3: 图谱更新 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-emerald-50 text-emerald-600 border border-emerald-200">
                      <Share2 className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">工业知识图谱动态维护</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                    {graphLoadFailed || graphStats == null ? '—' : graphStats.nodes} 实体节点
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">实体抽取: 设备-部件-故障现象-备件</p>
                <div className="p-3 rounded-lg bg-emerald-50/50 border border-emerald-100 text-xs text-slate-700 space-y-2">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-600">关联关系统计</span>
                    <span className="font-bold text-emerald-700 font-mono">
                      {graphLoadFailed || graphStats == null ? '—' : `${graphStats.edges} 条关联关系`}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-600">图谱覆盖设备种类</span>
                    {/* 原先写死「100% 核心动力设备」—— 没有任何接口提供覆盖率，属于凭空断言 */}
                    <span className="font-bold text-slate-800 font-mono">
                      {graphLoadFailed || graphStats == null ? '—' : '覆盖率未接入'}
                    </span>
                  </div>
                  <button
                    onClick={handleExtractGraph}
                    disabled={isExtractingGraph}
                    className="w-full mt-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-medium flex items-center justify-center space-x-1 cursor-pointer disabled:opacity-50 shadow-xs"
                  >
                    <Share2 className={`w-3.5 h-3.5 ${isExtractingGraph ? 'animate-spin' : ''}`} />
                    <span>{isExtractingGraph ? '正在抽取知识图谱...' : '一键抽取未处理规程图谱'}</span>
                  </button>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('knowledge_graph')}
                  className="w-full text-center text-xs text-emerald-600 hover:text-emerald-700 font-medium cursor-pointer"
                >
                  进入三维交互知识图谱中枢 →
                </button>
              </div>
            </div>
          </div>
);

export interface UserPanelsProps {
  currentUser: UserProfile;
  inspections: InspectionTask[];
  reportModalOpen: boolean;
  reportType: 'inspection' | 'maintenance' | 'monthly';
  reportRange: { start: string; end: string };
  reportState: { loading: boolean; error: string | null; degraded?: boolean; reviewId?: string | null; data?: AiReport | null };
  setReportModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setReportType: React.Dispatch<React.SetStateAction<'inspection' | 'maintenance' | 'monthly'>>;
  setReportRange: React.Dispatch<React.SetStateAction<{ start: string; end: string }>>;
  handleGenerateReport: () => Promise<void>;
  onNavigate: (tab: string) => void;
}

export const UserPanels: React.FC<UserPanelsProps> = ({
  currentUser,
  inspections,
  reportModalOpen,
  reportType,
  reportRange,
  reportState,
  setReportModalOpen,
  setReportType,
  setReportRange,
  handleGenerateReport,
  onNavigate,
}) => (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 卡片 1: 我的作业票 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-purple-50 text-purple-600 border border-purple-200">
                      <Truck className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">我的起重吊装作业票</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-semibold">
                    已核发在控
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">特种起重机械吊装作业安全许可证</p>
                <div className="p-3 rounded-lg bg-purple-50/50 border border-purple-200 text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-purple-900">SP-20260904-04 (吊装作业)</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">有效在控</span>
                  </div>
                  <div className="text-[11px] text-slate-600">
                    作业内容: 12# 结晶器冷却水泵电机起吊更换 (总重 2.8t)
                  </div>
                  <div className="text-[10px] text-slate-500 flex justify-between pt-1 border-t border-purple-100">
                    <span>监护人: 赵安全</span>
                    <span className="font-mono text-purple-700">吊车吨位: 16t 行车</span>
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('safety')}
                  className="w-full text-center text-xs text-purple-600 hover:text-purple-700 font-medium cursor-pointer"
                >
                  查看作业票安全隔离措施 →
                </button>
              </div>
            </div>

            {/* 卡片 2: 安全交底指引 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-amber-50 text-amber-600 border border-amber-200">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">起重作业《十不吊》交底</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">
                    安全红线
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">起重机械特种作业安全禁令与交底规范</p>
                <div className="p-2.5 rounded bg-amber-50/60 border border-amber-200 text-[11px] text-slate-700 space-y-1">
                  <div className="font-bold text-amber-900">特种起重核心红线要求：</div>
                  <div className="text-[10px] text-slate-600 leading-relaxed">
                    1. 信号不清或超载绝对不吊<br />
                    2. 斜拉斜拽、重物下有人绝对不吊<br />
                    3. 钢丝绳断丝超标、吊物捆绑不牢绝对不吊
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('procedures')}
                  className="w-full text-center text-xs text-amber-700 hover:text-amber-800 font-medium cursor-pointer"
                >
                  查阅起重设备标准化操作规程 →
                </button>
              </div>
            </div>

            {/* 卡片 3: 我的待办 */}
            <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 shadow-xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200">
                      <CheckSquare className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800">司机班前点检与会签待办</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">
                    2 项待办
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">起重设备日常点检打卡与工单配合</p>
                <div className="space-y-1.5 text-xs">
                  <div className="p-2 rounded bg-slate-50 border border-slate-200 text-[11px]">
                    <div className="flex items-center justify-between font-semibold text-slate-800">
                      <span>16t 桥式起重机制动器打卡</span>
                      <span className="text-[10px] text-blue-600">已完成</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">主钩开闭动作灵敏，限位器断火正常</div>
                  </div>
                  <div className="p-2 rounded bg-purple-50/50 border border-purple-200 text-[11px]">
                    <div className="flex items-center justify-between font-semibold text-purple-900">
                      <span>WO-20260904-128 配合会签</span>
                      <span className="text-[10px] text-purple-600">待签署</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">电机吊运找正完毕后配合技师签署验收</div>
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 mt-3">
                <button
                  onClick={() => onNavigate('inspections')}
                  className="w-full text-center text-xs text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                >
                  进入起重设备点检终端 →
                </button>
              </div>
            </div>
          </div>
);
