import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  dispatchApi,
  EquipmentPoint,
  PendingWorkOrder,
  DispatchRecommendationItem,
  DutyTechnician,
} from '../../api';
import {
  DispatchStats,
  DispatchToastState,
  RecommendMeta,
  RegionBox,
  REGION_COLORS,
} from './dispatchTypes';

interface UseDispatchBoardParams {
  presetWorkOrderId?: string | null;
  presetEquipmentId?: string | null;
}

export function useDispatchBoard({
  presetWorkOrderId,
  presetEquipmentId,
}: UseDispatchBoardParams = {}) {
  const [equipmentPoints, setEquipmentPoints] = useState<EquipmentPoint[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingWorkOrder[]>([]);
  const [technicians, setTechnicians] = useState<DutyTechnician[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [recommendations, setRecommendations] = useState<DispatchRecommendationItem[]>([]);
  const [recommendMeta, setRecommendMeta] = useState<RecommendMeta | null>(null);
  const [boardLoading, setBoardLoading] = useState(true);
  const [recLoading, setRecLoading] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<DispatchToastState | null>(null);
  const [amapFailed, setAmapFailed] = useState(false);
  const [hoverTech, setHoverTech] = useState<DutyTechnician | null>(null);
  const [hoverEq, setHoverEq] = useState<EquipmentPoint | null>(null);
  const [mocking, setMocking] = useState(false);
  const autoPickedRef = useRef(false);

  const showToast = useCallback((ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const fetchBoard = useCallback(async () => {
    try {
      const [boardRes, techRes] = await Promise.all([
        dispatchApi.board(),
        dispatchApi.listTechnicians(),
      ]);
      setEquipmentPoints(boardRes.equipmentPoints || []);
      setPendingOrders(boardRes.pendingOrders || []);
      setTechnicians(techRes.technicians || []);
      setError(null);
    } catch (e: unknown) {
      const err = e as { data?: { message?: string }; message?: string };
      setError(err?.data?.message || err?.message || '调度数据加载失败');
    } finally {
      setBoardLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    setBoardLoading(true);
    void fetchBoard();
  }, [fetchBoard]);

  // 初始挂载数据拉取
  useEffect(() => {
    let ignore = false;
    Promise.all([dispatchApi.board(), dispatchApi.listTechnicians()])
      .then(([boardRes, techRes]) => {
        if (!ignore) {
          const orders = boardRes.pendingOrders || [];
          setEquipmentPoints(boardRes.equipmentPoints || []);
          setPendingOrders(orders);
          setTechnicians(techRes.technicians || []);
          setError(null);
          setBoardLoading(false);

          // 预选：工单页带入 workOrderId；AI 协同带入设备 → 自动匹配该设备的待派工单
          if (!autoPickedRef.current && orders.length > 0) {
            if (presetWorkOrderId && orders.some((o) => o.id === presetWorkOrderId)) {
              setRecLoading(true);
              setSelectedOrderId(presetWorkOrderId);
              autoPickedRef.current = true;
            } else if (presetEquipmentId) {
              const match = orders.find((o) => o.equipmentId === presetEquipmentId);
              if (match) {
                setRecLoading(true);
                setSelectedOrderId(match.id);
                autoPickedRef.current = true;
              }
            }
          }
        }
      })
      .catch((e: unknown) => {
        if (!ignore) {
          const err = e as { data?: { message?: string }; message?: string };
          setError(err?.data?.message || err?.message || '调度数据加载失败');
          setBoardLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [presetEquipmentId, presetWorkOrderId]);

  // 选中工单后自动拉取推荐
  useEffect(() => {
    if (!selectedOrderId) return;
    let ignore = false;
    dispatchApi
      .recommend(selectedOrderId)
      .then((res) => {
        if (!ignore) {
          setRecommendations(res.recommendations || []);
          setRecommendMeta({ workOrder: res.workOrder, equipment: res.equipment });
          setError(null);
          setRecLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!ignore) {
          const err = e as { data?: { error?: string }; message?: string };
          setRecommendations([]);
          setRecommendMeta(null);
          setError(err?.data?.error || err?.message || '获取派单推荐失败');
          setRecLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [selectedOrderId]);

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
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      showToast(false, err?.data?.error || err?.message || '派单失败');
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
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      showToast(false, err?.data?.error || err?.message || '模拟位置生成失败');
    } finally {
      setMocking(false);
    }
  };

  // 统计
  const stats: DispatchStats = useMemo(() => {
    const onlineCount = technicians.length;
    const idleCount = technicians.filter((t) => t.onlineStatus === 'idle').length;
    const pendingCount = pendingOrders.length;
    const avgDistance =
      recommendations.length > 0
        ? Math.round(
            (recommendations.reduce((s, r) => s + r.distance, 0) / recommendations.length) * 2
          )
        : null;

    return { onlineCount, idleCount, pendingCount, avgDistance };
  }, [technicians, pendingOrders, recommendations]);

  // SVG 车间区域：按设备坐标聚类（workshop 去重 + 包围盒外扩）
  const regions: RegionBox[] = useMemo(() => {
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
  }, [equipmentPoints]);

  const selectedEquipment = recommendMeta?.equipment;
  const selectedEqPoint = equipmentPoints.find((p) => p.id === selectedEquipment?.id);

  const handleSelectOrder = useCallback((orderId: string) => {
    setSelectedOrderId(orderId);
    if (!orderId) {
      setRecommendations([]);
      setRecommendMeta(null);
    } else {
      setRecLoading(true);
    }
  }, []);

  return {
    equipmentPoints,
    pendingOrders,
    technicians,
    selectedOrderId,
    setSelectedOrderId,
    handleSelectOrder,
    recommendations,
    recommendMeta,
    boardLoading,
    recLoading,
    assigningId,
    error,
    toast,
    amapFailed,
    setAmapFailed,
    hoverTech,
    setHoverTech,
    hoverEq,
    setHoverEq,
    mocking,
    stats,
    regions,
    selectedEqPoint,
    refresh,
    fetchBoard,
    handleAssign,
    handleMock,
    showToast,
  };
}
