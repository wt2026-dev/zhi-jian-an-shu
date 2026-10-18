import React from 'react';
import {
  Navigation,
  CheckCircle2,
  Loader2,
  Route,
  Users,
  Send,
  Activity,
} from 'lucide-react';
import { PendingWorkOrder, DispatchRecommendationItem } from '../../api';
import { RecommendMeta } from './dispatchTypes';

interface DispatchRecommendPanelProps {
  pendingOrders: PendingWorkOrder[];
  selectedOrderId: string;
  recommendations: DispatchRecommendationItem[];
  recommendMeta: RecommendMeta | null;
  recLoading: boolean;
  assigningId: string | null;
  onSelectOrder: (orderId: string) => void;
  onAssign: (techId: string, techName: string) => void;
  onNavigateWorkOrders?: () => void;
}

export const DispatchRecommendPanel: React.FC<DispatchRecommendPanelProps> = ({
  pendingOrders,
  selectedOrderId,
  recommendations,
  recommendMeta,
  recLoading,
  assigningId,
  onSelectOrder,
  onAssign,
  onNavigateWorkOrders,
}) => {
  return (
    <div className="flex flex-col gap-4">
      {/* 待派工单选择与详情 */}
      <div className="glass-card p-4 shadow-sm">
        <h2 className="text-sm font-bold text-slate-900 flex items-center mb-3">
          <Navigation className="w-4 h-4 mr-1.5 text-blue-600" />
          就近派单推荐
        </h2>
        <label className="text-xs text-slate-500 block mb-1.5">选择待派工单</label>
        <select
          value={selectedOrderId}
          onChange={(e) => onSelectOrder(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
        >
          <option value="">— 请选择待派工单 —</option>
          {pendingOrders.map((o) => (
            <option key={o.id} value={o.id}>
              [{o.orderNo}] {o.title}（{o.equipmentName}）
            </option>
          ))}
        </select>

        {pendingOrders.length === 0 && (
          <p className="mt-3 text-xs text-emerald-600 flex items-center">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
            当前没有待派工单，全部工单已进入流转
          </p>
        )}

        {recommendMeta?.workOrder && (
          <div className="mt-3 p-3 rounded-xl bg-blue-50/60 border border-blue-100 text-xs">
            <p className="font-bold text-slate-800">
              [{recommendMeta.workOrder.orderNo}] {recommendMeta.workOrder.title}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              故障类型：{recommendMeta.workOrder.faultType || '未分类'} · 设备：
              {recommendMeta.equipment?.name}（
              {recommendMeta.equipment?.workshop || '未标定'}）
            </p>
          </div>
        )}
      </div>

      {/* 推荐师傅列表 */}
      <div className="glass-card p-4 shadow-sm flex-1">
        {recLoading ? (
          <div className="py-10 flex flex-col items-center text-slate-500 text-xs">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500 mb-2" />
            正在计算就近推荐…
          </div>
        ) : !selectedOrderId ? (
          <div className="py-8 text-center text-xs text-slate-500">
            <Route className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            选择待派工单后，自动按「距离 40% · 空闲 30% · 技能 30%」推荐在岗师傅
          </div>
        ) : recommendations.length === 0 ? (
          <div className="py-8 text-center">
            <Users className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            <p className="text-xs text-slate-500">
              当前无在岗师傅，可等待交班或到「检修工单」手动指派
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {recommendations.map((r, idx) => (
              <div
                key={r.technician.id}
                className={`p-3 rounded-xl border text-xs ${
                  idx === 0 ? 'bg-blue-50/60 border-blue-200' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {idx === 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-600 text-white text-[9px] font-bold">
                          最优
                        </span>
                      )}
                      <span className="font-bold text-slate-900">{r.technician.name}</span>
                      <span className="text-[10px] text-slate-500">
                        {r.technician.roleTitle}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 mt-1">{r.reason}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {r.technician.skills.slice(0, 4).map((s) => (
                        <span
                          key={s}
                          className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-500 text-[10px]"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[10px] text-slate-500 font-mono">
                      {r.distanceLabel} · 技能匹配 {(r.skillMatch * 100).toFixed(0)}% ·
                      综合得分 {r.score.toFixed(2)}
                      {r.technician.lastLocationAt
                        ? ` · 上报 ${r.technician.lastLocationAt}`
                        : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onAssign(r.technician.id, r.technician.name)}
                    disabled={assigningId === r.technician.id}
                    className="shrink-0 px-3 py-2 rounded-lg btn-gradient text-white text-[11px] font-semibold cursor-pointer disabled:opacity-60 flex items-center"
                  >
                    {assigningId === r.technician.id ? (
                      <Loader2 className="w-3 h-3 animate-spin mr-1" />
                    ) : (
                      <Send className="w-3 h-3 mr-1" />
                    )}
                    派单
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {onNavigateWorkOrders && (
          <button
            type="button"
            onClick={onNavigateWorkOrders}
            className="mt-3 w-full py-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-blue-600 text-xs font-medium cursor-pointer flex items-center justify-center"
          >
            <Activity className="w-3.5 h-3.5 mr-1.5" />
            前往检修工单查看派单结果
          </button>
        )}
      </div>
    </div>
  );
};
