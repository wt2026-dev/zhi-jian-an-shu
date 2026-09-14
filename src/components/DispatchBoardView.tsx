import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Clock,
  Crosshair,
  Gauge,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
  Route,
  Send,
  Users,
  Zap,
} from 'lucide-react';
import {
  dispatchApi,
  EquipmentPoint,
  PendingWorkOrder,
  DispatchRecommendationItem,
  DutyTechnician,
} from '../api';
import { AmapDispatchMap } from './AmapDispatchMap';
import { isDemoMode } from '../utils/demoMode';

/**
 * 内部师傅距离调度大屏：
 * 默认渲染高德真实地图（真实经纬度 + Haversine 球面距离）；无 Key / 离线时自动降级为
 * 厂区平面 SVG 示意图（0~1000 归一化坐标），不白屏。在岗师傅绿点 + 故障设备红点 + 就近派单推荐。
 */

interface DispatchBoardViewProps {
  /** 从工单页 / AI 协同页跳转时预选的工单或设备 */
  presetWorkOrderId?: string | null;
  presetEquipmentId?: string | null;
  /** 返回检修工单页（派单成功后引导） */
  onNavigateWorkOrders?: () => void;
}

/** 车间区域底色（明亮高科技浅色系） */
const REGION_COLORS = [
  'rgba(59,130,246,0.10)',
  'rgba(16,185,129,0.10)',
  'rgba(245,158,11,0.10)',
  'rgba(139,92,246,0.10)',
  'rgba(6,182,212,0.10)',
  'rgba(236,72,153,0.10)',
  'rgba(132,204,22,0.10)',
  'rgba(244,114,182,0.10)',
  'rgba(148,163,184,0.12)',
];

export const DispatchBoardView: React.FC<DispatchBoardViewProps> = ({
  presetWorkOrderId,
  presetEquipmentId,
  onNavigateWorkOrders,
}) => {
  const [equipmentPoints, setEquipmentPoints] = useState<EquipmentPoint[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingWorkOrder[]>([]);
  const [technicians, setTechnicians] = useState<DutyTechnician[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [recommendations, setRecommendations] = useState<DispatchRecommendationItem[]>([]);
  const [recommendMeta, setRecommendMeta] = useState<{
    workOrder?: { orderNo: string; title: string; faultType: string | null; priority: string };
    equipment?: { id: string; name: string; code: string; workshop: string | null; mapX: number; mapY: number };
  } | null>(null);
  const [boardLoading, setBoardLoading] = useState(true);
  const [recLoading, setRecLoading] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  /** 高德地图加载失败（无 Key / 离线 / Key 无效）→ 降级为平面 SVG 示意图 */
  const [amapFailed, setAmapFailed] = useState(false);
  /** 是否具备高德 Key（VITE_AMAP_KEY），用于地图模式/降级模式标题与角标切换 */
  const hasAmapKey = Boolean((import.meta.env.VITE_AMAP_KEY as string) || '');
  const [hoverTech, setHoverTech] = useState<DutyTechnician | null>(null);
  const [hoverEq, setHoverEq] = useState<EquipmentPoint | null>(null);
  const [mocking, setMocking] = useState(false);
  const autoPickedRef = useRef(false);

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 3200);
  };

  const fetchBoard = useCallback(async () => {
    setBoardLoading(true);
    try {
      const [boardRes, techRes] = await Promise.all([
        dispatchApi.board(),
        dispatchApi.listTechnicians(),
      ]);
      setEquipmentPoints(boardRes.equipmentPoints || []);
      setPendingOrders(boardRes.pendingOrders || []);
      setTechnicians(techRes.technicians || []);
      setError(null);
    } catch (e: any) {
      setError(e?.data?.message || e?.message || '调度数据加载失败');
    } finally {
      setBoardLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBoard();
  }, [fetchBoard]);

  // 预选：工单页带入 workOrderId；AI 协同带入设备 → 自动匹配该设备的待派工单
  useEffect(() => {
    if (boardLoading || autoPickedRef.current || pendingOrders.length === 0) return;
    if (presetWorkOrderId && pendingOrders.some((o) => o.id === presetWorkOrderId)) {
      setSelectedOrderId(presetWorkOrderId);
      autoPickedRef.current = true;
      return;
    }
    if (presetEquipmentId) {
      const match = pendingOrders.find((o) => o.equipmentId === presetEquipmentId);
      if (match) {
        setSelectedOrderId(match.id);
        autoPickedRef.current = true;
      }
    }
  }, [boardLoading, pendingOrders, presetWorkOrderId, presetEquipmentId]);

  // 选中工单后自动拉取推荐
  const fetchRecommend = useCallback(async (orderId: string) => {
    if (!orderId) return;
    setRecLoading(true);
    setRecommendations([]);
    try {
      const res = await dispatchApi.recommend(orderId);
      setRecommendations(res.recommendations || []);
      setRecommendMeta({ workOrder: res.workOrder, equipment: res.equipment });
      setError(null);
    } catch (e: any) {
      setRecommendations([]);
      setRecommendMeta(null);
      setError(e?.data?.error || e?.message || '获取派单推荐失败');
    } finally {
      setRecLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedOrderId) fetchRecommend(selectedOrderId);
  }, [selectedOrderId, fetchRecommend]);

  const handleAssign = async (techId: string, techName: string) => {
    setAssigningId(techId);
    try {
      const res = await dispatchApi.assign({ workOrderId: selectedOrderId, userId: techId });
      showToast(true, res.message || `已派单给 ${techName}`);
      setRecommendations((prev) => prev.filter((r) => r.technician.id !== techId));
      // 刷新待派工单（该单已流转）与师傅状态
      const boardRes = await dispatchApi.board();
      setPendingOrders(boardRes.pendingOrders || []);
      const techRes = await dispatchApi.listTechnicians();
      setTechnicians(techRes.technicians || []);
      setSelectedOrderId('');
      setRecommendations([]);
      setRecommendMeta(null);
    } catch (e: any) {
      showToast(false, e?.data?.error || e?.message || '派单失败');
    } finally {
      setAssigningId(null);
    }
  };

  const handleMock = async () => {
    setMocking(true);
    try {
      const res = await dispatchApi.mock();
      showToast(true, `【演示数据】${res.message || `已刷新 ${res.updated} 位师傅的演示位置`}`);
      await fetchBoard();
    } catch (e: any) {
      showToast(false, e?.data?.error || e?.message || '模拟位置生成失败');
    } finally {
      setMocking(false);
    }
  };

  // 统计
  const onlineCount = technicians.length;
  const idleCount = technicians.filter((t) => t.onlineStatus === 'idle').length;
  const pendingCount = pendingOrders.length;
  const avgDistance =
    recommendations.length > 0
      ? Math.round((recommendations.reduce((s, r) => s + r.distance, 0) / recommendations.length) * 2)
      : null; // × METERS_PER_UNIT(2) 估算平均响应距离（米）

  // SVG 车间区域：按设备坐标聚类（workshop 去重 + 包围盒外扩）
  const regions = (() => {
    const byWs: Record<string, EquipmentPoint[]> = {};
    equipmentPoints.forEach((p) => {
      const key = p.workshop || '未标定区域';
      (byWs[key] = byWs[key] || []).push(p);
    });
    return Object.entries(byWs).map(([name, pts], idx) => {
      const xs = pts.map((p) => p.mapX);
      const ys = pts.map((p) => p.mapY);
      const pad = 55;
      const x = Math.max(8, Math.min(...xs) - pad);
      const y = Math.max(8, Math.min(...ys) - pad);
      const w = Math.min(1000 - x - 4, Math.max(...xs) + pad - x);
      const h = Math.min(1000 - y - 4, Math.max(...ys) + pad - y);
      return { name, x, y, w, h, color: REGION_COLORS[idx % REGION_COLORS.length] };
    });
  })();

  const selectedEquipment = recommendMeta?.equipment;
  const selectedEqPoint = equipmentPoints.find((p) => p.id === selectedEquipment?.id);

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      {/* 页头 */}
      <div className="glass-card p-5 shadow-sm mb-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center">
              <Route className="w-5 h-5 mr-2 text-blue-600" />
              内部检修调度大屏
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              师傅在岗位置上报 → 新工单就近推荐（距离 40% · 空闲 30% · 技能 30%）→ 一键派单，全流程仅面向内部工区调度
            </p>
          </div>
          <div className="flex items-center space-x-2">
            {isDemoMode() && (
              <button
                onClick={handleMock}
                disabled={mocking}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-amber-50 border border-amber-300 text-amber-800 hover:bg-amber-100 flex items-center space-x-1.5 cursor-pointer disabled:opacity-60 shadow-xs"
                title="演示模式：在厂区真实经纬度范围内随机扰动在岗师傅位置（仅参赛演示使用）"
              >
                {mocking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Crosshair className="w-3.5 h-3.5" />}
                <span>演示模拟定位</span>
              </button>
            )}
            <button
              onClick={fetchBoard}
              className="p-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-blue-600 transition-colors cursor-pointer"
              title="刷新调度数据"
            >
              <RefreshCw className={`w-4 h-4 ${boardLoading ? 'animate-spin text-blue-600' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p className="mb-3 text-xs text-rose-600 flex items-center">
          <Zap className="w-3.5 h-3.5 mr-1" />
          {error}
        </p>
      )}

      {/* 顶部统计条 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="glass-card p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>在岗师傅</span>
            <Users className="w-4 h-4 text-blue-500" />
          </div>
          <div className="mt-1.5 data-number text-lg">{onlineCount}<span className="text-xs text-slate-500 font-sans"> 人</span></div>
        </div>
        <div className="glass-card p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>当前空闲</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="mt-1.5 data-number text-lg text-emerald-700">{idleCount}<span className="text-xs text-slate-500 font-sans"> 人</span></div>
        </div>
        <div className="glass-card p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>待派工单</span>
            <ClipboardIcon />
          </div>
          <div className="mt-1.5 data-number text-lg text-amber-700">{pendingCount}<span className="text-xs text-slate-500 font-sans"> 单</span></div>
        </div>
        <div className="glass-card p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>平均响应距离估算</span>
            <Gauge className="w-4 h-4 text-cyan-500" />
          </div>
          <div className="mt-1.5 data-number text-lg text-cyan-700">
            {avgDistance != null ? `约 ${avgDistance}m` : '—'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* 厂区平面图 */}
        <div className="lg:col-span-7">
          <div className="glass-card p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="text-sm font-bold text-slate-900 flex items-center">
                <MapPin className="w-4 h-4 mr-1.5 text-blue-600" />
                {hasAmapKey && !amapFailed ? '厂区地图调度' : '厂区平面调度图'}
                <span className="ml-2 text-[10px] text-slate-500 font-mono">
                  {hasAmapKey && !amapFailed ? '高德地图 · 真实经纬度 · 球面距离' : '0~1000 归一化坐标 · 降级示意图'}
                </span>
              </h2>
              <div className="flex items-center gap-3 text-[10px] text-slate-500">
                <span className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-rose-500 mr-1 animate-pulse" />故障设备</span>
                <span className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 mr-1" />空闲师傅</span>
                <span className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 mr-1" />在岗巡检</span>
              </div>
            </div>

            {boardLoading ? (
              <div className="h-[420px] flex items-center justify-center text-slate-500 text-xs">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500 mr-2" />
                加载厂区数据…
              </div>
            ) : hasAmapKey && !amapFailed ? (
              <AmapDispatchMap
                equipmentPoints={equipmentPoints}
                technicians={technicians}
                selectedEqPoint={selectedEqPoint}
                recommendations={recommendations}
                onFail={() => setAmapFailed(true)}
                onHoverTech={setHoverTech}
                onHoverEq={setHoverEq}
              />
            ) : (
              <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-[#f1f5f9]">
                {hasAmapKey && amapFailed && (
                  <div className="absolute top-2 left-2 z-10 px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-[10px] text-amber-700">
                    地图加载失败（离线或无权限），已回退平面示意图
                  </div>
                )}
                <svg viewBox="0 0 1000 1000" className="w-full h-[420px] md:h-[480px]" style={{ transform: 'scaleY(1)' }}>
                  {/* 网格底纹 */}
                  <defs>
                    <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
                      <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#e2e8f0" strokeWidth="1" />
                    </pattern>
                    <radialGradient id="faultGlow">
                      <stop offset="0%" stopColor="rgba(239,68,68,0.45)" />
                      <stop offset="100%" stopColor="rgba(239,68,68,0)" />
                    </radialGradient>
                  </defs>
                  <rect width="1000" height="1000" fill="url(#grid)" />

                  {/* 车间区域块 */}
                  {regions.map((r) => (
                    <g key={r.name}>
                      <rect x={r.x} y={r.y} width={Math.max(r.w, 60)} height={Math.max(r.h, 60)} rx={16} fill={r.color} stroke="#cbd5e1" strokeWidth={1.2} strokeDasharray="6 4" />
                      <text x={r.x + 10} y={r.y + 20} fontSize={17} fill="#64748b" fontWeight="600">{r.name}</text>
                    </g>
                  ))}

                  {/* 推荐连线：选中设备 → 推荐师傅（虚线 + 距离） */}
                  {selectedEqPoint &&
                    recommendations.slice(0, 3).map((r) => (
                      <g key={`line-${r.technician.id}`}>
                        <line
                          x1={selectedEqPoint.mapX} y1={selectedEqPoint.mapY}
                          x2={r.technician.mapX} y2={r.technician.mapY}
                          stroke={r === recommendations[0] ? '#3b82f6' : '#94a3b8'}
                          strokeWidth={r === recommendations[0] ? 2.5 : 1.2}
                          strokeDasharray="7 5"
                        />
                        <text
                          x={(selectedEqPoint.mapX + r.technician.mapX) / 2}
                          y={(selectedEqPoint.mapY + r.technician.mapY) / 2 - 6}
                          fontSize={15} fill="#475569" textAnchor="middle"
                        >
                          {r.distanceLabel}
                        </text>
                      </g>
                    ))}

                  {/* 故障设备点位（红色脉冲） */}
                  {equipmentPoints.map((p) => {
                    const isFaulty = p.openOrders > 0 || ['fault', 'warning', 'overhauling'].includes(p.status);
                    return (
                      <g
                        key={p.id}
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={() => setHoverEq(p)}
                        onMouseLeave={() => setHoverEq(null)}
                      >
                        {isFaulty && <circle cx={p.mapX} cy={p.mapY} r={26} fill="url(#faultGlow)" />}
                        <circle
                          cx={p.mapX} cy={p.mapY} r={isFaulty ? 9 : 5.5}
                          fill={isFaulty ? '#ef4444' : '#cbd5e1'}
                          stroke="#fff" strokeWidth={2}
                        />
                        {isFaulty && (
                          <circle cx={p.mapX} cy={p.mapY} r={15} fill="none" stroke="#ef4444" strokeWidth={2} opacity={0.6}>
                            <animate attributeName="r" values="11;20;11" dur="1.8s" repeatCount="indefinite" />
                            <animate attributeName="opacity" values="0.7;0.15;0.7" dur="1.8s" repeatCount="indefinite" />
                          </circle>
                        )}
                      </g>
                    );
                  })}

                  {/* 在岗师傅（绿点 + 名字 + 状态角标） */}
                  {technicians.map((t) => (
                    <g
                      key={t.id}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={() => setHoverTech(t)}
                      onMouseLeave={() => setHoverTech(null)}
                    >
                      <circle
                        cx={t.mapX} cy={t.mapY} r={10}
                        fill={t.onlineStatus === 'idle' ? '#10b981' : '#3b82f6'}
                        stroke="#fff" strokeWidth={2.5}
                      />
                      <text x={t.mapX} y={t.mapY - 18} fontSize={17} fill="#0f172a" fontWeight="700" textAnchor="middle">
                        {t.name}
                      </text>
                      <rect
                        x={t.mapX + 10} y={t.mapY - 6} width={30} height={15} rx={7}
                        fill={t.onlineStatus === 'idle' ? '#d1fae5' : '#dbeafe'}
                        stroke={t.onlineStatus === 'idle' ? '#10b981' : '#3b82f6'} strokeWidth={1}
                      />
                      <text x={t.mapX + 25} y={t.mapY + 5} fontSize={11} textAnchor="middle" fill="#334155">
                        {t.onlineStatus === 'idle' ? '空闲' : '在岗'}
                      </text>
                    </g>
                  ))}
                </svg>

                {/* 悬浮卡片：师傅 */}
                {hoverTech && (
                  <div className="absolute top-3 left-3 glass-card p-3 text-xs shadow-lg max-w-[240px] pointer-events-none">
                    <p className="font-bold text-slate-800">{hoverTech.name} · {hoverTech.roleTitle}</p>
                    <p className="text-[11px] text-slate-500 mt-1">位置：{hoverTech.geoLng != null && hoverTech.geoLat != null ? `(${hoverTech.geoLng.toFixed(5)}, ${hoverTech.geoLat.toFixed(5)})` : `(${Math.round(hoverTech.mapX)}, ${Math.round(hoverTech.mapY)})`} · {hoverTech.onlineStatus === 'idle' ? '空闲' : '在岗'}</p>
                    <p className="text-[11px] text-slate-500">最近上报：{hoverTech.lastLocationAt || '无记录'}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {(hoverTech.skills || []).map((s) => (
                        <span key={s} className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700 text-[10px]">{s}</span>
                      ))}
                    </div>
                  </div>
                )}
                {/* 悬浮卡片：设备 */}
                {hoverEq && !hoverTech && (
                  <div className="absolute top-3 left-3 glass-card p-3 text-xs shadow-lg max-w-[240px] pointer-events-none">
                    <p className="font-bold text-slate-800">{hoverEq.name}</p>
                    <p className="text-[11px] text-slate-500 font-mono">{hoverEq.code} · {hoverEq.workshop || '未标定'}</p>
                    <p className="text-[11px] text-slate-500 mt-1">健康分 {hoverEq.healthScore} · 未完结工单 {hoverEq.openOrders}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 右列：工单选择 + 推荐列表 */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <div className="glass-card p-4 shadow-sm">
            <h2 className="text-sm font-bold text-slate-900 flex items-center mb-3">
              <Navigation className="w-4 h-4 mr-1.5 text-blue-600" />
              就近派单推荐
            </h2>
            <label className="text-xs text-slate-500 block mb-1.5">选择待派工单</label>
            <select
              value={selectedOrderId}
              onChange={(e) => setSelectedOrderId(e.target.value)}
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
                  故障类型：{recommendMeta.workOrder.faultType || '未分类'} · 设备：{recommendMeta.equipment?.name}
                  （{recommendMeta.equipment?.workshop || '未标定'}）
                </p>
              </div>
            )}
          </div>

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
                <p className="text-xs text-slate-500">当前无在岗师傅，可等待交班或到「检修工单」手动指派</p>
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
                            <span className="px-1.5 py-0.5 rounded bg-blue-600 text-white text-[9px] font-bold">最优</span>
                          )}
                          <span className="font-bold text-slate-900">{r.technician.name}</span>
                          <span className="text-[10px] text-slate-500">{r.technician.roleTitle}</span>
                        </div>
                        <p className="text-[11px] text-slate-600 mt-1">{r.reason}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {r.technician.skills.slice(0, 4).map((s) => (
                            <span key={s} className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-500 text-[10px]">{s}</span>
                          ))}
                        </div>
                        <p className="mt-1.5 text-[10px] text-slate-500 font-mono">
                          {r.distanceLabel} · 技能匹配 {(r.skillMatch * 100).toFixed(0)}% · 综合得分 {r.score.toFixed(2)}
                          {r.technician.lastLocationAt ? ` · 上报 ${r.technician.lastLocationAt}` : ''}
                        </p>
                      </div>
                      <button
                        onClick={() => handleAssign(r.technician.id, r.technician.name)}
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
                onClick={onNavigateWorkOrders}
                className="mt-3 w-full py-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-blue-600 text-xs font-medium cursor-pointer flex items-center justify-center"
              >
                <Activity className="w-3.5 h-3.5 mr-1.5" />
                前往检修工单查看派单结果
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 全局轻提示 */}
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-xl shadow-lg text-xs font-medium max-w-[90vw] ${
            toast.ok ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
          }`}
          role="status"
        >
          <span className="flex items-center">
            {toast.ok ? <CheckCircle2 className="w-4 h-4 mr-1.5" /> : <AlertTriangleIcon />}
            {toast.text}
          </span>
        </div>
      )}
    </div>
  );
};

const ClipboardIcon = () => <ClipboardSvg />;
const AlertTriangleIcon = () => (
  <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
  </svg>
);
const ClipboardSvg = () => (
  <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
  </svg>
);
