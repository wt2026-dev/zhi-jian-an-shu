/**
 * AppDataContext — 业务数据全局状态 Context
 *
 * 从 App.tsx（885行上帝组件）提取的业务数据状态管理层。
 *
 * 重构动机：
 *   原 App.tsx 将 equipments / workOrders / safetyPermits / inspections /
 *   articles / lotoLocks 等全局状态全部 useState 在根组件，导致：
 *   ① 任意子视图 setState 都会触发 App.tsx 整树 re-render
 *   ② 数据通过 prop-drilling 逐层透传给 18 个懒加载视图
 *   ③ 885 行的"上帝组件"：逻辑、UI、数据获取三类职责混在同一文件
 *
 *   提取为 Context 后：
 *   ✅ 各视图直接 useAppData() 消费所需数据，消除 prop-drilling
 *   ✅ App.tsx 只保留 UI 骨架（导航栏/侧边栏/路由），职责单一
 *   ✅ 状态变更只触发订阅该 Context 的子树 re-render（而非整个 App）
 *
 * 使用示例：
 *   const { equipments, handleAddWorkOrder } = useAppData();
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import {
  Equipment,
  WorkOrder,
  InspectionTask,
  InspectionItem,
  SafetyPermit,
  KnowledgeArticle,
  LotoLock,
  UserProfile,
} from '../types';
import {
  workOrderApi,
  equipmentApi,
  safetyPermitApi,
  knowledgeApi,
  inspectionApi,
  authApi,
} from '../api';
import { logger } from '../utils/logger';

// ─── Context 类型定义 ────────────────────────────────────────────────────────

export interface AppDataContextValue {
  // ── 业务数据 ────────────────────────────────────────────────────────────────
  equipments: Equipment[];
  workOrders: WorkOrder[];
  inspections: InspectionTask[];
  safetyPermits: SafetyPermit[];
  articles: KnowledgeArticle[];
  lotoLocks: LotoLock[];

  // ── 加载状态 ────────────────────────────────────────────────────────────────
  isInitialLoading: boolean;
  loadError: string | null;

  // ── 初始化与刷新 ────────────────────────────────────────────────────────────
  /** 全量拉取后端所有业务数据（登录成功后自动调用，也可手动重试） */
  loadAllBackendData: () => Promise<void>;

  // ── 设备 handlers ──────────────────────────────────────────────────────────
  handleAddEquipment: (eq: Equipment) => void;
  handleUpdateEquipment: (eq: Equipment) => void;
  handleDeleteEquipment: (id: string) => void;

  // ── 工单 handlers ──────────────────────────────────────────────────────────
  handleAddWorkOrder: (wo: WorkOrder) => void;
  handleUpdateWorkOrder: (wo: WorkOrder) => void;

  // ── 巡检 handlers ──────────────────────────────────────────────────────────
  handleUpdateInspection: (task: InspectionTask) => Promise<void>;
  handleConvertAbnormalToWorkOrder: (point: InspectionItem, equipmentName: string) => Promise<void>;

  // ── 安全作业票 handlers ────────────────────────────────────────────────────
  handleAddSafetyPermit: (permit: SafetyPermit) => void;
  handleUpdateSafetyPermit: (permit: SafetyPermit) => void;
  handleDeleteSafetyPermit: (id: string) => void;

  // ── 知识库 handlers ────────────────────────────────────────────────────────
  handleAddArticle: (article: KnowledgeArticle) => void;

  // ── AI 跨模块触发 ──────────────────────────────────────────────────────────
  /** 从 AI 诊断结果直接创建工单 */
  handleCreateWorkOrderFromAi: (
    title: string,
    equipmentName: string,
    description: string,
    currentUser: UserProfile,
    onNavigateWorkOrders: () => void
  ) => Promise<void>;
}

// ─── Context 实例 ────────────────────────────────────────────────────────────

const AppDataContext = createContext<AppDataContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

export const AppDataProvider: React.FC<{
  /** authToken 变化时（登录/登出）自动重新拉取数据 */
  authToken: string | null;
  /** 拉取数据成功后回传当前用户与全量用户列表（由 AuthContext 落库） */
  onDataLoaded?: (currentUser: UserProfile | null, allUsers: UserProfile[]) => void;
  /** 通知刷新函数（由 AuthContext 提供）；传入 userId 避免读到未同步的闭包值 */
  onRefreshNotifications?: (userId?: string) => void;
  children: React.ReactNode;
}> = ({ authToken, onDataLoaded, onRefreshNotifications, children }) => {
  const [equipments, setEquipments] = useState<Equipment[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [inspections, setInspections] = useState<InspectionTask[]>([]);
  const [safetyPermits, setSafetyPermits] = useState<SafetyPermit[]>([]);
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [lotoLocks, setLotoLocks] = useState<LotoLock[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 回调存入 ref：避免调用方传入内联箭头函数导致 loadAllBackendData 每次渲染都变化，
  // 进而触发 useEffect 无限重载（setState → re-render → 新函数 → effect 再跑）。
  const onDataLoadedRef = useRef(onDataLoaded);
  const onRefreshNotificationsRef = useRef(onRefreshNotifications);
  useEffect(() => {
    onDataLoadedRef.current = onDataLoaded;
    onRefreshNotificationsRef.current = onRefreshNotifications;
  }, [onDataLoaded, onRefreshNotifications]);

  const loadAllBackendData = useCallback(async () => {
    setIsInitialLoading(true);
    setLoadError(null);
    try {
      const [apiOrders, apiEquips, apiPermits, apiArticles, apiUsers, apiInspections, meUser, apiLotoLocks] =
        await Promise.all([
          workOrderApi.list(),
          equipmentApi.list(),
          safetyPermitApi.list(),
          knowledgeApi.list(),
          authApi.getUsers(),
          inspectionApi.list(),
          authApi.getCurrentUser(),
          safetyPermitApi.getLotoLocks(),
        ]);

      setWorkOrders(Array.isArray(apiOrders) ? apiOrders : []);
      setEquipments(Array.isArray(apiEquips) ? apiEquips : []);
      setSafetyPermits(Array.isArray(apiPermits) ? apiPermits : []);
      setArticles(Array.isArray(apiArticles) ? apiArticles : []);
      setInspections(Array.isArray(apiInspections) ? apiInspections : []);
      setLotoLocks(Array.isArray(apiLotoLocks) ? apiLotoLocks : []);

      // 当前用户与全量用户列表交回 AuthContext 落库（避免两份状态源）
      const usersList = Array.isArray(apiUsers) ? apiUsers : [];
      onDataLoadedRef.current?.(meUser || null, usersList);

      // 显式传 userId：此时 AuthContext 的 currentUser 尚未随 setState 生效，
      // 若依赖闭包读取会拿到旧值，导致通知按错误用户隔离。
      onRefreshNotificationsRef.current?.((meUser as any)?.id);
    } catch (err: any) {
      logger.error('AppDataContext: Backend API full sync error:', err);
      setLoadError(err?.message || '后端接口请求失败，无法加载真实业务数据');
    } finally {
      setIsInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authToken) {
      loadAllBackendData();
    } else {
      setIsInitialLoading(false);
      // 登出时清空所有数据
      setEquipments([]);
      setWorkOrders([]);
      setInspections([]);
      setSafetyPermits([]);
      setArticles([]);
      setLotoLocks([]);
    }
  }, [authToken, loadAllBackendData]);

  // ── 设备 handlers ──────────────────────────────────────────────────────────
  const handleAddEquipment = (eq: Equipment) => {
    setEquipments((prev) => [eq, ...prev]);
    onRefreshNotifications?.();
  };
  const handleUpdateEquipment = (eq: Equipment) => {
    setEquipments((prev) => prev.map((e) => (e.id === eq.id ? eq : e)));
  };
  const handleDeleteEquipment = (id: string) => {
    setEquipments((prev) => prev.filter((e) => e.id !== id));
  };

  // ── 工单 handlers ──────────────────────────────────────────────────────────
  const handleAddWorkOrder = (wo: WorkOrder) => {
    setWorkOrders((prev) => [wo, ...prev]);
    if (wo.priority === 'urgent' || wo.priority === 'high') {
      setEquipments((prev) =>
        prev.map((e) => (e.id === wo.equipmentId ? { ...e, status: 'fault' } : e))
      );
    }
    onRefreshNotifications?.();
  };
  const handleUpdateWorkOrder = (wo: WorkOrder) => {
    setWorkOrders((prev) => prev.map((w) => (w.id === wo.id ? wo : w)));
    if (wo.status === 'completed') {
      setEquipments((prev) =>
        prev.map((e) => (e.id === wo.equipmentId ? { ...e, status: 'running' } : e))
      );
    }
    onRefreshNotifications?.();
  };

  // ── 巡检 handlers ──────────────────────────────────────────────────────────
  const handleUpdateInspection = async (task: InspectionTask) => {
    setInspections((prev) => prev.map((t) => (t.id === task.id ? task : t)));
    try {
      await inspectionApi.update(task.id, task);
    } catch (err) {
      logger.warn('AppDataContext: 巡检数据后端同步失败:', err);
    }
  };

  const handleConvertAbnormalToWorkOrder = async (point: InspectionItem, equipmentName: string) => {
    const eq = equipments.find((e) => e.name === equipmentName || e.id === point.equipmentId) || equipments[0];
    const checkName = point.checkPoint || point.checkItem || '关键测点';
    const limitVal = point.maxLimit ?? point.maxVal ?? '标准限值';
    const unit = point.unit || '';
    const desc = `巡检中发现实测数值 ${point.recordedValue}${unit}，超出标准上限 ${limitVal}${unit}。巡检备注: ${point.notes || '无'}`;

    try {
      const created = await workOrderApi.create({
        title: `【巡检异常】${equipmentName} ${checkName} 实测超标`,
        equipmentId: eq.id,
        faultType: '机械振动',
        priority: 'high',
        description: desc,
        safetyRequirements: ['作业前实施现场停电上锁隔离', '穿戴劳保绝缘装备'],
        creator: '巡检员 (巡检现场转单)',
        forceSubmit: true,
      });
      handleAddWorkOrder(created);
    } catch (err: any) {
      alert(`巡检异常转工单失败: ${(err as any)?.message || '后端接口请求异常'}，请稍后重试`);
      throw err;
    }
  };

  // ── 安全作业票 handlers ────────────────────────────────────────────────────
  const handleAddSafetyPermit = (permit: SafetyPermit) => {
    setSafetyPermits((prev) => [permit, ...prev]);
    onRefreshNotifications?.();
  };
  const handleUpdateSafetyPermit = (permit: SafetyPermit) => {
    setSafetyPermits((prev) => prev.map((p) => (p.id === permit.id ? permit : p)));
    onRefreshNotifications?.();
  };
  const handleDeleteSafetyPermit = (id: string) => {
    setSafetyPermits((prev) => prev.filter((p) => p.id !== id));
    onRefreshNotifications?.();
  };

  // ── 知识库 handlers ────────────────────────────────────────────────────────
  const handleAddArticle = (article: KnowledgeArticle) => {
    setArticles((prev) => [article, ...prev]);
  };

  // ── AI 跨模块触发 ──────────────────────────────────────────────────────────
  const handleCreateWorkOrderFromAi = async (
    title: string,
    equipmentName: string,
    description: string,
    currentUser: UserProfile,
    onNavigateWorkOrders: () => void
  ) => {
    const eq = equipments.find((e) => e.name === equipmentName) || equipments[0];
    if (!eq) {
      alert('未找到匹配设备，无法创建工单，请先在设备档案中确认设备台账。');
      return;
    }
    try {
      const created = await workOrderApi.create({
        title,
        equipmentId: eq.id,
        faultType: '机械振动',
        priority: 'urgent',
        description,
        safetyRequirements: ['执行 MCC 动力柜 LOTO 挂牌上锁', '佩戴防飞溅护目镜与劳保手套'],
        creator: `${currentUser?.name || 'AI 助手'} (AI 诊断生成)`,
        forceSubmit: true,
      });
      handleAddWorkOrder(created);
      onNavigateWorkOrders();
    } catch (err: any) {
      alert(`AI 诊断转工单失败: ${(err as any)?.message || '后端接口请求异常'}`);
    }
  };

  const value: AppDataContextValue = {
    equipments,
    workOrders,
    inspections,
    safetyPermits,
    articles,
    lotoLocks,
    isInitialLoading,
    loadError,
    loadAllBackendData,
    handleAddEquipment,
    handleUpdateEquipment,
    handleDeleteEquipment,
    handleAddWorkOrder,
    handleUpdateWorkOrder,
    handleUpdateInspection,
    handleConvertAbnormalToWorkOrder,
    handleAddSafetyPermit,
    handleUpdateSafetyPermit,
    handleDeleteSafetyPermit,
    handleAddArticle,
    handleCreateWorkOrderFromAi,
  };

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
};

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * 消费 AppDataContext 的 hook。
 * 必须在 AppDataProvider 内部调用，否则抛出明确错误。
 */
export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) {
    throw new Error('useAppData() 必须在 <AppDataProvider> 内部调用');
  }
  return ctx;
}

export default AppDataContext;
