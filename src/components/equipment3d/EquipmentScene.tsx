/**
 * 设备 3D 场景 —— React 视图层。
 *
 * 分工：
 *   scene.ts      引擎（渲染器 / 相机 / 光照 / 构建管线 / 拾取 / 单台聚焦 / 资源释放）
 *   EquipmentScene.tsx  本文件，只负责 React 生命周期、真实数据接入、参数面板与设备分析面板
 *
 * 数据来源（全部走项目既有 API 客户端，token 由现有登录态提供）：
 *   equipmentApi.list()                     → /equipments              设备台账（决定 3D 设备数量与状态颜色）
 *   equipmentApi.getById(id)                → /equipments/:id          点击设备后的详情
 *   equipmentApi.getTelemetryHistory(id,48) → /equipments/:id/telemetry-history  48h 真实落库时序
 *   workOrderApi.list({ equipment_id })     → /work-orders             该设备的最近工单
 *   POST /api/v1/ai/diagnose                → AI 诊断（按钮触发，不随选中自动调用）
 * 接口不可用时：不伪造设备、不用随机数着色，降级为「仅展示厂房结构 + 空状态提示」。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Boxes,
  Eye,
  Gauge,
  Layers,
  LayoutGrid,
  Maximize2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Sun,
  Triangle,
  Wand2,
  X,
  CircleDot,
  Grid3x3,
  Waves,
  AlertTriangle,
  WifiOff,
  Loader2,
  Cpu,
  Wrench,
  Shield,
  User,
  Monitor,
  Building2,
} from 'lucide-react';
import { equipmentApi, workOrderApi, safetyPermitApi, dispatchApi, explodedViewApi, type DutyTechnician, type EquipmentPoint } from '../../api';
import type { Equipment, WorkOrder, LotoLock } from '../../types';
import { useAppData } from '../../context/AppDataContext';
import { useOptionalAuth } from '../../context/AuthContext';
import { logger } from '../../utils/logger';
import { EquipmentScene, DEFAULT_PARAMS, type SceneParams, type SceneStats, type ViewKey, type WorkOrderIndicatorStatus } from './scene';
import { SCENE_PRESETS, PRESET_ORDER, QUALITY, type QualityKey, type LayoutPattern } from './styles';
import { STATUS_META, type DeviceLike, type StatusKey } from './equipment';
import { DEVICE_RECIPES } from './deviceProfiles';
import { DeviceAnalysisPanel, type TelemetryHistory } from './DeviceAnalysisPanel';
import { ExplodedViewButton } from './ExplodedViewButton';
import { WorkshopZoneNav } from './WorkshopZoneNav';
import { ExplodedViewStage, type ExplodedViewWorkOrderContext } from './ExplodedViewStage';
import { hasExplodedView, setExplodedViewHost } from './explodedViewFiles';
import { RepairStepCard } from './RepairStepCard';
import { can } from '../../utils/rbac';
import type { ShellMode } from './hall';
import { telemetryToStatus } from './statusMapping';
import { ProductionHUD } from './ProductionHUD';
import { DrillTrail, type DrillCrumbNode } from './DrillTrail';
import { SceneLegend } from './SceneLegend';
import type { SceneLevel } from './scene';
import type { FactoryBuildingSpec, FactoryZoneSpec, FactoryZoneView, FactoryRankMetric } from './factoryOverview';
import { PART_OBSERVATION_ZONES } from './partEvidence';
import { matchZoneForCauses, type AiDiagnosis } from './aiDiagnosis';
import { toFocusDecorStatus, type FocusDecorTelemetrySample, type FocusDecorData } from './focusSceneDecor';
import { attachRoofLabels } from './factoryOverviewDecor';
import { attachPerimeterDecor, type PerimeterDecor } from './factoryPerimeterDecor';
import { estimateWorkshopMetrics, aggregateZoneMetrics } from './factoryMetrics';
import { resolveBuildingType, selectHallWorkshops } from './factoryBuildingTypes';
import './equipment-industrial.css';
import {
  isExplodedViewSupported,
  getExplodedConfig,
  computeExplodedLayout,
  createExplodedMeshes,
  animateExplodedUnfold,
  animateExplodedFold,
  removeExplodedMeshes,
  type ExplodedPartData
} from './ExplodedView';

/* ========================= 文案映射 ========================= */

const LAYOUT_OPTIONS: Array<{ key: LayoutPattern; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'grid', label: '网格', icon: LayoutGrid },
  { key: 'ring', label: '环形', icon: CircleDot },
  { key: 'wall', label: '沿墙', icon: Grid3x3 },
];

const VIEW_OPTIONS: Array<{ key: ViewKey; label: string }> = [
  { key: 'orbit', label: '环绕' },
  { key: 'overhead', label: '俯瞰' },
  { key: 'iso', label: '等轴' },
  { key: 'closeup', label: '特写' },
];

const QUALITY_OPTIONS: QualityKey[] = ['low', 'medium', 'high'];

const SHELL_OPTIONS: Array<{ key: ShellMode; label: string; hint: string }> = [
  { key: 'full', label: '完整', hint: '完整墙顶，适合看厂房外观' },
  { key: 'ghost', label: '半透明', hint: '墙顶半透明，默认：既能看见厂房体量也能看见内部设备' },
  { key: 'none', label: '隐藏', hint: '只留柱网与桁架，纯粹观察内部布局' },
];

/**
 * 分区"在建工程"标牌文案——对应厂区层里那台真实画出来的塔吊+脚手架，
 * 只是位置说明文案，不参与任何指标计算。
 */
const ZONE_NOTES = [
  '二期智能仓储与管廊工程（进度 85%）',
  '重型机加生产线扩建中',
  '微电网储能站调试并网中',
];

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

/** Clear gaps explicitly instead of retaining previous samples or estimating load. */
function telemetryFeed(status: string, sample?: { temperature?: number; vibration?: number; current?: number; loadRate?: number; rpm?: number } | null) {
  const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  return { status, temperature: finite(sample?.temperature), vibration: finite(sample?.vibration),
    current: finite(sample?.current), loadRate: finite(sample?.loadRate), rpm: finite(sample?.rpm) };
}

/* ========================= 组件 ========================= */

export interface Equipment3DViewProps {
  initialWorkOrderId?: string | null;
  /**
   * 拆解视图 ↔ 检修业务联动：点击拆解侧栏里的工单号 /「返回工单详情」时回调宿主
   * （App 把用户带回工单列表并自动展开那张单的详情抽屉）；不传则按 URL 深链兜底。
   */
  onOpenWorkOrderDetail?: (workOrderId: string) => void;
  /**
   * 地图轴（全国地图 / 城市 / 厂区）路径节点，由下钻壳给到；本层把它接在自己的
   * 「车间 / 单设备」两级之前，渲染成顶部唯一的那条下钻路径条。
   * 2026-09-23 用户「太拥挤了」：此前地图轴那条面包屑绝对定位浮在工具栏正中、厂区轴那条
   * 挤在大屏栏左侧，顶部有两条面包屑、当前层级名写两遍；合并成一条并放进工具栏的文档流里。
   */
  mapTrail?: DrillCrumbNode[];
}

export function Equipment3DView({ initialWorkOrderId, onOpenWorkOrderDetail, mapTrail }: Equipment3DViewProps = {}): React.ReactElement {
  const { equipments: contextEquipments, handleUpdateWorkOrder: contextUpdateWorkOrder } = useAppData();
  const auth = useOptionalAuth();
  const currentUser = auth?.currentUser ?? null;
  // 操作工（以及无身份）在 3D 场景内为只读浏览：禁止派单/接单/完工/验收/步骤勾选
  const readOnly3D = !can('equipment3d:operate', currentUser?.role);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const miniRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<EquipmentScene | null>(null);
  const fpsPushRef = useRef(0);
  const downRef = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  const readyRef = useRef(false);
  const selectionRequestRef = useRef(0);

  // 默认状态收敛（可视化层不再喧宾夺主）：介质粒子流默认关 —— 地面上的
  // 粒子最花，10 台设备同时流动会盖住设备本体；需要时在「可视化图层」里开。
  const [params, setParams] = useState<SceneParams>(() => ({ ...DEFAULT_PARAMS, fluidFlow: false }));
  const [stats, setStats] = useState<SceneStats | null>(null);
  const [fps, setFps] = useState(0);
  const [ready, setReady] = useState(false);
  const [building, setBuilding] = useState(true);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  // ---- 数据 ----
  const [remote, setRemote] = useState<Equipment[] | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [dataLoading, setDataLoading] = useState(true);

  // ---- 工单列表与指示环状态 ----
  const [allOrders, setAllOrders] = useState<WorkOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [activeOrderCard, setActiveOrderCard] = useState<WorkOrder | null>(null);

  // ---- 维修闭环（场景内工单操作：派单/接单/步骤勾选/完工上报/验收） ----
  const [orderActionBusy, setOrderActionBusy] = useState(false);
  const [orderActionError, setOrderActionError] = useState<string | null>(null);
  /** 检修步骤勾选进度（工单 id → 已勾数），重新选中设备不丢进度 */
  const stepProgressRef = useRef<Map<string, number>>(new Map());
  /** 聚焦层数据快照（handlePick 时缓存；工单状态变化后据此刷新五步卡片） */
  const focusDecorBaseRef = useRef<FocusDecorData | null>(null);
  /** 检修工单卡收起态：单台聚焦时默认收起为左缘窄 tab，给 3D 画布让位 */
  const [repairCardCollapsed, setRepairCardCollapsed] = useState(false);

  // ---- 选中设备 / 实时分析面板 ----
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 独占模式：当前独占显示的设备 id（null = 16 台总览） */
  const [isolationId, setIsolationId] = useState<string | null>(null);
  const [cardLoading, setCardLoading] = useState(false);
  const [detail, setDetail] = useState<Equipment | null>(null);
  const [recentOrders, setRecentOrders] = useState<WorkOrder[]>([]);
  const [cardError, setCardError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryHistory | null>(null);
  /** 右侧面板标签：场景参数 / 设备分析 / 拆解视图 */
  const [rightTab, setRightTab] = useState<'params' | 'analysis'>('analysis');

  // ---- 遥测回放 ----
  const [playbackPlaying, setPlaybackPlaying] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(-1);
  const playbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackIndexRef = useRef(-1);

  // ---- 拆解视图 ----
  /** 3D 场景内的拆解动画（零件分离，`ExplodedView.ts`）——与下面的 HTML 拆解页是两件事 */
  const [explodedDeviceId, setExplodedDeviceId] = useState<string | null>(null);
  const [explodedParts, setExplodedParts] = useState<ExplodedPartData[]>([]);
  const [isExplodedAnimating, setIsExplodedAnimating] = useState(false);
  const explodedCleanupRef = useRef<(() => void) | null>(null);

  /**
   * 当前正在**页内**展示的拆解视图 HTML 对应设备（`public/exploded/*.html`）。
   * 非 null 时主显示区域被 `ExplodedViewStage` 接管（3D 画布仍在下面，只是被盖住），
   * 右侧面板与顶部工具栏不动。用户口径（2026-10-16）：不新开窗口、不整页跳走。
   */
  const [explodedHtmlDeviceId, setExplodedHtmlDeviceId] = useState<string | null>(null);
  /**
   * 拆解视图 ↔ 检修业务联动上下文（F1）：从工单「查看拆解视图」跳入时，携带工单
   * 关键信息（左侧卡）与服务端按真实 parts_used/描述匹配出的目标零件位号（自动高亮、
   * 由 iframe 桥 selectPart 定位）。targetPart 未识别时明确显示"未识别到具体零件"。
   */
  const [explodedHtmlContext, setExplodedHtmlContext] = useState<ExplodedViewWorkOrderContext | null>(null);

  // ---- 安全边界可视化 ----
  const [showSafetyBoundary, setShowSafetyBoundary] = useState(true);
  const safetyDataRef = useRef<Map<string, { permits: any[]; locks: any[] }>>(new Map());

  // ---- 故障定位环（红色脉冲环 / 绿色恢复环）总开关，默认开 ----
  // 它是"哪台设备哪里坏了"的第一视觉线索，属于常开层；其余彩色层默认收敛。
  const [showFaultLocator, setShowFaultLocator] = useState(true);

  // ---- 超限观测 ----
  /** 预取全量遥测缓存（16 台最新48h），避免每次选中都重拉 */
  const allTelemetryRef = useRef<Map<string, any[]>>(new Map());

  // ---- 人员与工位动线 ----
  /** 默认关：技师轨迹 + 人形 + 指引虚线太密，需要时在「可视化图层」里开。
   *  例外：选中设备时该设备的派工指引虚线仍会出现（见下方人员动线 effect）。 */
  const [showWorkers, setShowWorkers] = useState(false);
  const [technicians, setTechnicians] = useState<DutyTechnician[]>([]);
  /** 轨迹缓存：Map<userId, {mapX,mapY}[]>（最多10个点） */
  const trajectoryRef = useRef<Map<string, Array<{ mapX: number; mapY: number }>>>(new Map());
  /** 坐标映射是否已建立 */
  const coordMapReadyRef = useRef(false);

  // ---- 三级层级（厂区 / 车间 / 单设备）与生产线开关 ----
  const [level, setLevel] = useState<SceneLevel>('factory');
  /** 当前层级的镜像。`selectZone` / `handlePick` 这类 useCallback 需要读"此刻"的层级，
   *  但又不能把 level 放进依赖（会把回调整体换新、连带重建下游 effect），故用 ref 镜像。 */
  const levelRef = useRef<SceneLevel>(level);
  useEffect(() => {
    levelRef.current = level;
  }, [level]);
  const [activeBuilding, setActiveBuilding] = useState<{ id: string; name: string } | null>(null);
  const [beltAnimation, setBeltAnimation] = useState(true);
  const [lineEnabled, setLineEnabled] = useState(true);
  const [animPaused, setAnimPaused] = useState(false);
  /** 大屏 HUD 覆盖层开关（开启时隐藏旧的左侧图例列，避免与 HUD 左菜单重叠） */
  const [hudOn, setHudOn] = useState(true);


  /* ---------- 1. 拉取真实设备台账 ---------- */
  useEffect(() => {
    let alive = true;
    setDataLoading(true);
    equipmentApi
      .list()
      .then((list) => {
        if (!alive) return;
        const raw = Array.isArray(list) ? list : [];
        // 多厂区扩展（025_factories）：3D 厂区场景仅展示广州主厂真实设备，
        // 演示分厂设备经 /api/v1/factories 系列接口在地图层/城市层呈现。
        const arr = raw.filter((e: any) => !e.factory_id || e.factory_id === 'factory_gz');
        setRemote(arr);
        setDataError(arr.length ? null : '接口返回的设备台账为空');
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('[equipment3d] 设备台账接口不可用，将尝试使用已加载数据:', msg);
        setRemote(null);
        setDataError(msg);
      })
      .finally(() => {
        if (alive) setDataLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reloadToken]);

  /* ---------- 1.1 拉取工单列表与聚合指示环状态 ---------- */
  const fetchWorkOrders = useCallback(() => {
    setOrdersLoading(true);
    workOrderApi
      .list({})
      .then((orders) => {
        const arr = Array.isArray(orders) ? orders : [];
        setAllOrders(arr);
      })
      .catch((err: unknown) => {
        logger.warn('[equipment3d] 工单列表获取失败:', err);
      })
      .finally(() => {
        setOrdersLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchWorkOrders();
  }, [fetchWorkOrders]);

  /** 优先用本次接口结果；失败则退回全局上下文里已加载的真实台账。 */
  const equipments = useMemo<Equipment[]>(() => {
    if (remote && remote.length) return remote;
    if (contextEquipments && contextEquipments.length) return contextEquipments;
    return [];
  }, [remote, contextEquipments]);

  /**
   * 厂区总览的厂房清单 + 分区定义。
   *
   * 台账可直接算的（本处不产生任何业务数值）：
   *   deviceCount   该车间设备台数
   *   abnormalCount 异常台数（台账 status ∈ {warning,fault}，或遥测阈值派生）
   *   failureRate   设备故障率 % = 异常台数 / 设备总数
   *   healthAvg     平均健康分
   *   openWorkOrders 该车间未闭环工单数
   * 台账里没有字段的经营指标（产值 / 良品率 / 在岗）：走 factoryMetrics 的
   * **估算口径**——由台数 × 厂房角色 × 运行状态与健康分测算，并置 `estimated`，
   * 标牌同步显示"按台账规模与角色定员测算，非采集读数"。台账为空的车间返回
   * null，标牌退回"未接入"，不写常量顶数。
   *
   * 分区（zone）只是**空间分组**视图概念，按车间顺序连续切分，名称用中性编号
   * （A 区 / B 区 / C 区），不臆造"精密制造区"这类业务含义。
   */
  const { buildingSpecs, zoneSpecs } = useMemo<{
    buildingSpecs: FactoryBuildingSpec[] | undefined;
    zoneSpecs: FactoryZoneSpec[] | undefined;
  }>(() => {
    const names = Array.from(new Set(equipments.map((e) => e.workshop).filter((w): w is string => !!w)));
    if (!names.length) return { buildingSpecs: undefined, zoneSpecs: undefined };

    const isAbnormal = (d: Equipment): boolean => {
      if (d.status === 'fault' || d.status === 'warning') return true;
      const derived = telemetryToStatus(d.telemetry);
      return derived === 'fault' || derived === 'warning' || derived === 'critical';
    };
    const eqIdToWorkshop = new Map<string, string>();
    for (const e of equipments) if (e.workshop) eqIdToWorkshop.set(e.id, e.workshop);

    /**
     * 厂区地块按 5 栋标定，真实台账有十几个车间 —— 挑哪几栋画成厂房走
     * `selectHallWorkshops`（按厂房角色轮转取，见 factoryBuildingTypes）。
     */
    const workshops = selectHallWorkshops(names);
    const zoneCount = Math.min(workshops.length, 3);
    const per = Math.ceil(workshops.length / Math.max(1, zoneCount));
    const letters = ['A', 'B', 'C'];
    const zoneIndexOf = (i: number) => Math.min(Math.floor(i / Math.max(1, per)), zoneCount - 1);
    /** 与 FactoryOverview 的几何外观同一套角色判定，避免估算口径和厂房画法分家 */
    const roleOf = (workshopName: string, zoneIndex: number, indexInZone: number) =>
      resolveBuildingType({
        zoneIndex,
        zoneName: `${letters[zoneIndex]} 区`,
        workshopName,
        indexInZone,
      }).role;

    // 逐车间：台账可算项 + 经营指标估算，一次算清后按分区聚合
    const workshopMetrics = workshops.map((w, i) => {
      const zoneIndex = zoneIndexOf(i);
      return estimateWorkshopMetrics({
        workshopName: w,
        devices: equipments.filter((e) => e.workshop === w),
        role: roleOf(w, zoneIndex, i - zoneIndex * per),
        isAbnormal,
      });
    });

    const zones: FactoryZoneSpec[] = Array.from({ length: zoneCount }, (_, zi) => {
      const agg = aggregateZoneMetrics(workshopMetrics.filter((_, i) => zoneIndexOf(i) === zi));
      return {
        id: `zone-${letters[zi].toLowerCase()}`,
        name: `${letters[zi]} 区`,
        outputValue: agg.outputValue ?? undefined,
        yieldRate: agg.yieldRate ?? undefined,
        estimated: agg.estimated,
        constructionNote: ZONE_NOTES[zi % ZONE_NOTES.length],
      };
    });

    const specs: FactoryBuildingSpec[] = workshopMetrics.map((m, i) => {
      const w = m.workshop;
      const openOrders = allOrders.filter(
        (o) =>
          o.status !== 'completed' &&
          o.status !== 'cancelled' &&
          !!o.equipmentId &&
          eqIdToWorkshop.get(o.equipmentId) === w
      ).length;
      return {
        id: `hall-${i + 1}`,
        name: `${i + 1} 号厂房・${w}`,
        zoneId: zones[zoneIndexOf(i)].id,
        workshopId: w,
        staffCount: m.staffCount ?? undefined,
        outputValue: m.outputValue ?? undefined,
        estimated: m.estimated,
        deviceCount: m.deviceCount,
        abnormalCount: m.abnormalCount,
        failureRate: m.failureRate ?? undefined,
        healthAvg: m.healthAvg ?? undefined,
        openWorkOrders: openOrders,
        status: m.abnormalCount > 0 ? ('warning' as const) : ('normal' as const),
      };
    });

    return { buildingSpecs: specs, zoneSpecs: zones };
  }, [equipments, allOrders]);

  /** HUD 用的选中设备对象（台账全字段） */
  const selectedEquipment = useMemo(
    () => equipments.find((e) => e.id === selectedId) ?? null,
    [equipments, selectedId]
  );

  /* ---------- 1.2 拉取安全许可证 + LOTO 锁具 → 安全边界3D数据 ---------- */
  useEffect(() => {
    let alive = true;
    async function fetch() {
      try {
        const [permits, locks] = await Promise.all([
          safetyPermitApi.list({}),
          safetyPermitApi.getLotoLocks({ status: 'locked' }),
        ]);
        if (!alive) return;
        const pArr = Array.isArray(permits) ? permits : [];
        const lArr = Array.isArray(locks) ? locks : [];

        // permitNo → equipmentId 映射（LOTO 锁具通过 permitNo 关联许可证，许可证再关联设备）
        const permitToEq = new Map<string, string>();
        for (const p of pArr) {
          if (p.permitNo && p.equipmentId) permitToEq.set(p.permitNo, p.equipmentId);
        }

        const map = new Map<string, { permits: typeof pArr; locks: typeof lArr }>();
        for (const p of pArr) {
          if (!p.equipmentId) continue;
          if (!map.has(p.equipmentId)) map.set(p.equipmentId, { permits: [], locks: [] });
          map.get(p.equipmentId)!.permits.push(p);
        }
        for (const lk of lArr) {
          const eqId = lk.permitNo ? permitToEq.get(lk.permitNo) : undefined;
          if (!eqId) continue;
          if (!map.has(eqId)) map.set(eqId, { permits: [], locks: [] });
          map.get(eqId)!.locks.push(lk);
        }
        safetyDataRef.current = map;
        sceneRef.current?.buildSafetyBoundaries(map);
        sceneRef.current?.setSafetyBoundaryVisible(showSafetyBoundary);
      } catch {
        logger.warn('[equipment3d] 安全数据获取失败，跳过安全边界');
      }
    }
    fetch();
    return () => { alive = false; };
  }, [equipments]);

  /** 安全边界开关切换时即时更新场景 */
  useEffect(() => {
    sceneRef.current?.setSafetyBoundaryVisible(showSafetyBoundary);
  }, [showSafetyBoundary]);

  /**
   * 故障定位环开关：随开关即时生效。
   * 依赖里带上 ready —— 场景是异步构建的，首帧 ready 之前 sceneRef 还是 null；
   * 重建（换画质/预设）后也要把当前开关状态重新推一次，否则会回到默认可见。
   */
  useEffect(() => {
    sceneRef.current?.setFaultLocatorVisible(showFaultLocator);
  }, [showFaultLocator, ready]);

  /* ---------- 1.3 预取全量遥测 → 超限观测缓存 ---------- */
  useEffect(() => {
    if (equipments.length === 0) return;
    let alive = true;
    // 并发拉取16台最新48h遥测（任一失败不影响其它）
    Promise.allSettled(
      equipments.map((eq) =>
        equipmentApi.getTelemetryHistory(eq.id, 48).then((r) => {
          const pts = (r as any)?.points;
          if (alive && Array.isArray(pts)) allTelemetryRef.current.set(eq.id, pts);
        }),
      ),
    ).catch(() => { /* swallow */ });
    return () => { alive = false; };
  }, [equipments]);

  /* ---------- 1.4 选中设备时构建超限观测（设备详情层除外） ---------- */
  useEffect(() => {
    const scene = sceneRef.current;
    // 「场景密度优先」口径：单台聚焦（设备详情层）里不允许任何 3D 飘字，
    // 超限观测链的浮空文字标签只在车间层展示。
    if (!selectedId || !scene || cardLoading || isolationId) {
      scene?.clearFaultChain();
      return;
    }
    // 等 telemetry + recentOrders 就绪后再构建
    const pts = allTelemetryRef.current.get(selectedId) ?? null;
    if (pts && pts.length > 0) {
      scene.buildFaultChain(selectedId, pts, recentOrders);
    } else if (telemetry?.points && telemetry.points.length > 0) {
      scene.buildFaultChain(selectedId, telemetry.points, recentOrders);
    } else {
      scene.clearFaultChain();
    }
  }, [selectedId, telemetry, recentOrders, cardLoading, isolationId]);

  /* ---------- 1.5 建立坐标映射（挂载时一次性） ---------- */
  useEffect(() => {
    if (coordMapReadyRef.current) return;
    dispatchApi.board().then((r: any) => {
      if (r?.equipmentPoints && Array.isArray(r.equipmentPoints)) {
        sceneRef.current?.setCoordMap(r.equipmentPoints);
        coordMapReadyRef.current = true;
      }
    }).catch(() => { /* 静默 */ });
  }, []);

  /* ---------- 1.6 人员动线轮询（15 秒） ---------- */
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetch = () => {
      dispatchApi.listTechnicians().then((r: any) => {
        if (!alive) return;
        const techs = Array.isArray(r?.technicians) ? r.technicians : [];
        setTechnicians(techs);
        // 更新轨迹缓存（只记录 online/idle 的位置）
        for (const t of techs) {
          if (t.onlineStatus === 'offline') continue;
          const prev = trajectoryRef.current.get(t.id) ?? [];
          // 避免重复点
          if (prev.length > 0) {
            const last = prev[prev.length - 1];
            if (last.mapX === t.mapX && last.mapY === t.mapY) continue;
          }
          const next = [...prev, { mapX: t.mapX, mapY: t.mapY }];
          if (next.length > 10) next.shift();
          trajectoryRef.current.set(t.id, next);
        }
      }).catch(() => { /* 失败静默，保留上次数据 */ });
    };

    fetch(); // 首次立即拉取
    timer = setInterval(fetch, 15000);
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, []);

  /* ---------- 1.7 选中设备时重建人员动线（含派工指引虚线） ---------- */
  /** 人员动线层是否建过：没建过就别清（清一次会顺带把巡检数字人也摘掉） */
  const workerLayerBuiltRef = useRef(false);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    // 选中设备时，即便"技师轨迹与指引线"总开关关着也要建这一层：
    // 需求口径是「选中哪台设备，就看它相关的那条链路」—— 聚焦层的派工指引虚线
    // （技师 → 设备）要照常出现。技师人形与历史轨迹仍跟随总开关
    // （scene 侧把指引虚线单独成层，见 scene.ts 的 guideGroup）。
    const needGuide = !!selectedId;
    if (!showWorkers && !needGuide) {
      if (workerLayerBuiltRef.current) {
        scene.clearWorkers();
        workerLayerBuiltRef.current = false;
      }
      scene.setWorkerVisible(false);
      return;
    }
    // 找当前选中设备工单的 assignee
    let assigneeId: string | null = null;
    let assigneeStatus: string | null = null;
    if (selectedId && recentOrders.length > 0) {
      // 优先找紧急/高优工单的 assignee
      const urgent = recentOrders.find(
        (o) => (o.priority === 'urgent' || o.priority === 'high') && o.assigneeId,
      );
      if (urgent) {
        assigneeId = urgent.assigneeId!;
        assigneeStatus = urgent.status;
      }
    }
    scene.buildWorkers(technicians, trajectoryRef.current, selectedId, assigneeId, assigneeStatus);
    workerLayerBuiltRef.current = true;
    scene.setWorkerVisible(showWorkers);
  }, [technicians, selectedId, recentOrders, showWorkers]);

  const { deviceOrderMap, orderCounts } = useMemo(() => {
    const map = new Map<string, WorkOrderIndicatorStatus>();
    let pending = 0;
    let inProgress = 0;
    let completed = 0;

    for (const eq of equipments) {
      const eqOrders = allOrders.filter(
        (o) => o.equipmentId === eq.id || (o as any).equipment_id === eq.id
      );
      if (!eqOrders.length) continue;

      // 优先级：待检修 (created/dispatched) > 检修中 (in_progress/pending_acceptance) > 已完成 (completed)
      const hasPending = eqOrders.some((o) => o.status === 'created' || o.status === 'dispatched');
      const hasInProgress = eqOrders.some((o) => o.status === 'in_progress' || o.status === 'pending_acceptance');
      const hasCompleted = eqOrders.some((o) => o.status === 'completed');

      if (hasPending) {
        map.set(eq.id, 'pending');
        pending++;
      } else if (hasInProgress) {
        map.set(eq.id, 'in_progress');
        inProgress++;
      } else if (hasCompleted) {
        map.set(eq.id, 'completed');
        completed++;
      }
    }

    return {
      deviceOrderMap: map,
      orderCounts: { pending, inProgress, completed, total: pending + inProgress + completed },
    };
  }, [equipments, allOrders]);

  // 当工单指示映射变化或场景构建完成后同步更新到 3D 场景引擎
  useEffect(() => {
    if (ready && sceneRef.current) {
      sceneRef.current.setWorkOrderIndicators(deviceOrderMap);
    }
  }, [deviceOrderMap, ready]);

  // 厂区总览层：厂房清单由台账真实 workshop 字段去重得出，初始进入厂区层
  const hasInitializedLevelRef = useRef(false);
  // 厂房屋顶标签装饰清理句柄（factoryOverviewDecor，纯加法）
  const roofLabelsCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene) return;
    if (buildingSpecs) {
      scene.buildFactory?.(buildingSpecs, zoneSpecs);
    }
    if (!hasInitializedLevelRef.current) {
      hasInitializedLevelRef.current = true;
      if (level === 'factory') {
        scene.enterFactoryLevel?.();
      }
    }
  }, [ready, buildingSpecs, zoneSpecs, level]);

  /* ---------- 厂区总览：分区视图同步（3D → HUD） ---------- */
  const [factoryZones, setFactoryZones] = useState<FactoryZoneView[]>([]);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const [rankMetric, setRankMetricState] = useState<FactoryRankMetric>('failureRate');

  const syncFactoryZones = useCallback(() => {
    const zs = sceneRef.current?.factoryZones?.() ?? [];
    setFactoryZones(zs);
    const m = zs[0]?.rankMetric;
    if (m) setRankMetricState(m);
  }, []);

  useEffect(() => {
    if (!ready) return;
    // buildFactory 之后同步一次（分区/排名在引擎内结算）
    syncFactoryZones();
  }, [ready, buildingSpecs, zoneSpecs, syncFactoryZones]);

  /**
   * 选中分区。**只有厂区总览层**才把选中动作转给 3D 引擎 —— 那一层才有「分区地块」可高亮/取景。
   *
   * 车间现场层现在也用同一个状态做「分区 → 车间 → 设备」导航（`WorkshopZoneNav`）。
   * 那一层里工厂组是隐藏的（`applyLevelVisibility`），再调 `scene.selectZone` 会把镜头
   * 按一块**看不见的地块**取景 —— 用户看到的是"镜头突然飞到空中乱转"。
   * 所以按层分流：厂区层交给引擎，其余层只做面板筛选。
   */
  const selectZone = useCallback(
    (zoneId: string | null) => {
      setActiveZoneId(zoneId);
      if (levelRef.current === 'factory') sceneRef.current?.selectZone?.(zoneId);
      syncFactoryZones();
    },
    [syncFactoryZones]
  );

  const changeRankMetric = useCallback(
    (metric: FactoryRankMetric) => {
      sceneRef.current?.setFactoryRankMetric?.(metric);
      setRankMetricState(metric);
      syncFactoryZones();
    },
    [syncFactoryZones]
  );

  // 生产线 / 传送带动画 / 动画暂停 三个开关。
  // 方法级可选调用：测试替身只实现了部分方法，硬调用会在 effect 里抛错并拖挂整个视图。
  useEffect(() => {
    sceneRef.current?.setProductionLineEnabled?.(lineEnabled);
  }, [lineEnabled, ready]);
  useEffect(() => {
    sceneRef.current?.setBeltAnimation?.(beltAnimation);
  }, [beltAnimation, ready]);
  useEffect(() => {
    sceneRef.current?.setLayerAnimationsPaused?.(animPaused);
  }, [animPaused, ready]);

  const dataMode: 'api' | 'cache' | 'empty' = useMemo(() => {
    if (remote && remote.length) return 'api';
    if (equipments.length) return 'cache';
    return 'empty';
  }, [remote, equipments.length]);

  /** 传给 3D 引擎的最小设备视图（只保留渲染需要的字段）。 */
  const deviceInputs = useMemo<DeviceLike[]>(
    () =>
      equipments.map((e) => ({
        id: e.id,
        code: e.code,
        name: e.name,
        category: e.category,
        status: e.status as string,
        healthScore: e.healthScore,
        workshop: e.workshop,
      })),
    [equipments]
  );

  /* ---------- 2. 引擎挂载（StrictMode 双挂载安全） ---------- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // 严格模式下 effect 会执行两次：先清掉可能残留的画布，保证初始化幂等
    host.querySelectorAll('canvas').forEach((c) => c.remove());
    let scene: EquipmentScene | null = null;
    try {
      scene = new EquipmentScene(host, params);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[equipment3d] WebGL 初始化失败:', err);
      setBuildError(`WebGL 初始化失败：${msg}`);
      return;
    }
    scene.onFrame = (f) => {
      const now = performance.now();
      if (now - fpsPushRef.current > 600) {
        fpsPushRef.current = now;
        setFps(f);
      }
    };
    sceneRef.current = scene;
    // 三级层级变化 → 同步 React 侧面包屑与 HUD
    scene.onLevelChange = (lvl) => setLevel(lvl);
    scene.attachMinimap(miniRef.current);
    // 第三层补细节：厂房屋顶悬浮标签（纯加法装饰）。包装实例的 buildFactory，
    // 无论引擎从哪条路径（数据刷新/懒建）重建厂区层，标签都自动重挂。
    // 测试环境的引擎 mock 可能未实现 buildFactory，需判空
    let perimeterDecor: PerimeterDecor | null = null;
    if (typeof scene.buildFactory === 'function') {
      const rawBuildFactory = scene.buildFactory.bind(scene);
      scene.buildFactory = ((...args: Parameters<EquipmentScene['buildFactory']>) => {
        rawBuildFactory(...args);
        roofLabelsCleanupRef.current?.();
        roofLabelsCleanupRef.current = scene.factory ? attachRoofLabels(scene.factory) : null;
        // 围墙/门卫道闸/路灯/罐区/停车划线/行人与过路车辆：厂区层的外围细节。
        // 动画走 FactoryOverview.addUpdater，由场景主循环驱动，不改 scene.ts。
        perimeterDecor?.dispose();
        perimeterDecor = scene.factory ? attachPerimeterDecor(scene.factory) : null;
      }) as typeof scene.buildFactory;
    }
    scene.start();
    (window as any).__equipmentScene = scene;
    return () => {
      delete (window as any).__equipmentScene;
      sceneRef.current = null;
      perimeterDecor?.dispose();
      perimeterDecor = null;
      roofLabelsCleanupRef.current?.();
      roofLabelsCleanupRef.current = null;
      scene?.dispose();
    };
    // 只在挂载时创建一次；参数变化走下方 build effect 复用同一渲染器
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  /* ---------- 3. 重建（防抖 + 双 rAF，先让 loading 画出来再阻塞主线程） ----------
   * 只有真正影响几何的参数才触发重建：预设 / 种子 / 画质 / 设备数 / 布局 /
   * 间距 / 高亮 / 外壳。光照强度、网格与介质流动走下面的 quickApply（零重建）。 */
  const { presetId, seed, quality, deviceCount, layout, spacing, highlight, showGrid, fluidFlow, shell, exposure } = params;
  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    setBuilding(true);
    const snapshot: SceneParams = {
      presetId, seed, quality, deviceCount, layout, spacing, highlight, showGrid,
      // 重建会顺带按快照写一次介质流动的可见性（scene.build → fluidFlow.setVisible）。
      // 这里必须与 quickApply 用同一个口径：聚焦层里选中设备的粒子要保留，
      // 否则"设备台账刷新触发的一次重建"会把选中设备的粒子静默关掉
      // （图例显示"在画"、画面上却没有 —— 实测出现过这种状态不一致）。
      fluidFlow: fluidFlow || isolationId !== null,
      shell, exposure,
    };
    const timer = window.setTimeout(() => {
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          const scene = sceneRef.current;
          if (!scene) return;
          try {
            const result = scene.build(snapshot, deviceInputs);
            // 重建产出的 stats 是**构建期**数字（恒为 16 台）。
            // 若此刻正处于单台独占模式，必须用「当前可见」的实时统计覆盖它，
            // 否则切一次画质，性能条就从「设备数 1」跳回「设备数 16」——
            // 数字与画面不符，评审会认为这些指标是摆设。
            const live = scene.liveStats();
            setStats({
              ...result,
              devices: live.devices,
              triangles: live.triangles,
              drawCalls: live.drawCalls,
            });
            setBuildError(null);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('[equipment3d] 场景重建失败:', err);
            setBuildError(`场景重建失败：${msg}`);
          } finally {
            setBuilding(false);
            readyRef.current = true;
            setReady(true);
          }
        });
      });
    }, 50);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId, seed, quality, deviceCount, layout, spacing, highlight, shell, deviceInputs]);

  /* ---------- 4. 光照 / 网格 / 介质流动等纯渲染参数：不重建几何体 ---------- */
  useEffect(() => {
    if (readyRef.current) {
      // 选中设备（聚焦层）时，该设备的介质粒子恢复可见：粒子系统在独占模式下只保留
      // 这一台设备的路径（FluidFlowSystem.setIsolation），所以这里只需在"渲染参数"这
      // 一层放行即可 —— **不改用户的开关状态本身**，退出聚焦后仍回到用户设定。
      // 其余图层（技师轨迹 / 安全边界）严格跟随各自开关，不做任何硬开。
      sceneRef.current?.quickApply({ ...params, fluidFlow: fluidFlow || isolationId !== null });
    }
    // building 由 true→false 代表一次重建结束：重建会把介质流动的可见性写回快照值，
    // 所以重建收尾时要按"当前是否选中设备"再推一次，否则聚焦层里粒子会被关掉。
  }, [exposure, showGrid, fluidFlow, params, isolationId, building]);

  // 同步台账真实遥测状态与负荷率到 3D 介质流速
  useEffect(() => {
    if (!ready || !sceneRef.current || !equipments.length) return;
    for (const eq of equipments) {
      sceneRef.current.setDeviceTelemetry(eq.id, telemetryFeed(eq.status, eq.telemetry));
    }
  }, [equipments, ready]);

  /* ---------- 5. 选中设备：平滑聚焦 + 拉取详情 / 遥测时序 / 最近工单 ---------- */
  /**
   * 独占切换后刷新性能条。
   * 被隐藏的设备不应再计入「设备数 / 三角面 / drawcall」——
   * 否则独占 1 台时性能条仍显示 16 台，评审会认为这些指标是摆设。
   */
  const refreshLiveStats = useCallback(() => {
    const live = sceneRef.current?.liveStats();
    if (!live) return;
    setStats((s) => (s ? { ...s, devices: live.devices, triangles: live.triangles, drawCalls: live.drawCalls } : s));
  }, []);

  const resetSelectionVisuals = useCallback(() => {
    setPlaybackPlaying(false);
    setPlaybackIndex(-1);
    playbackIndexRef.current = -1;
    if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
    explodedCleanupRef.current?.();
    explodedCleanupRef.current = null;
    const scene = sceneRef.current;
    if (explodedDeviceId && scene) {
      removeExplodedMeshes(scene.scene);
      scene.exitExplodedView(explodedDeviceId);
      scene.setSafetyBoundaryVisible(showSafetyBoundary);
      scene.setWorkerVisible(showWorkers);
    }
    setExplodedDeviceId(null);
    setExplodedParts([]);
    setIsExplodedAnimating(false);
    setActiveOrderCard(null);
    setOrderActionError(null);
    focusDecorBaseRef.current = null;
    scene?.clearFaultChain();
    scene?.clearStatusOverrides();
    for (const eq of equipments) {
      scene?.setDeviceTelemetry(eq.id, telemetryFeed(eq.status, eq.telemetry));
    }
  }, [explodedDeviceId, equipments, showSafetyBoundary, showWorkers]);

  const handlePick = useCallback(
    (id: string) => {
      const request = ++selectionRequestRef.current;
      resetSelectionVisuals();
      const scene = sceneRef.current;
      scene?.setSelected(id);
      // 单台独占：隐藏其余 15 台（含其光环/光柱），并按该设备包围盒重新取景，
      // 让设备占满画面约 75% —— 比单纯推近镜头更聚焦。
      // 取景失败（设备不在当前场景内）时回退到只推近镜头，保证不会"点了没反应"。
      const isolated = scene?.setIsolation(id) ?? false;
      if (!isolated) scene?.focusDevice(id);
      setIsolationId(isolated ? id : null);
      refreshLiveStats();
      setSelectedId(id);
      setRightTab('analysis');
      setPanelOpen(true);
      setCardLoading(true);
      setCardError(null);
      setDetail(null);
      setRecentOrders([]);
      setTelemetry(null);
      const local = equipments.find((e) => e.id === id) ?? null;
      // critical（紧急）同样需要故障定位标：台账里 critical 独立于 fault 存在，
      // 漏掉它会让"最该被看到故障部位"的设备反而不显示定位标。
      const isFaulty = local && (local.status === 'fault' || local.status === 'warning' || (local.status as string) === 'critical');
      const zones = PART_OBSERVATION_ZONES[id] ?? [];
      const partLabel = zones[0]?.partLabel ?? '关键监测部位';
      if (isFaulty) {
        scene?.showDeviceFault?.(id, partLabel, zones[0]?.partKey);
        // 定位标是**在 setIsolation 之后**才建的，所以这里必须回过头按故障部位
        // 再取景一次：否则镜头半径是按整机包围盒算的，故障点会飘到画面边缘。
        scene?.frameDeviceFault?.(id);
      } else {
        scene?.clearFaults?.(id);
      }

      // 三个接口互不依赖，并发拉取；任一失败不影响其余（allSettled）
      Promise.allSettled([
        equipmentApi.getById(id),
        equipmentApi.getTelemetryHistory(id, 48),
        workOrderApi.list({ equipment_id: id }),
      ])
        .then(([d, t, w]) => {
          if (request !== selectionRequestRef.current) return;
          let failed = 0;
          if (d.status === 'fulfilled' && d.value?.id === id) {
            setDetail(d.value as Equipment);
            sceneRef.current?.setDeviceTelemetry(id, telemetryFeed(d.value.status, d.value.telemetry));
          }
          else {
            setDetail(local);
            failed++;
          }
          if (t.status === 'fulfilled' && t.value && (t.value as TelemetryHistory).equipmentId === id && Array.isArray((t.value as TelemetryHistory).points)) {
            setTelemetry(t.value as TelemetryHistory);
          } else {
            failed++;
          }
          if (w.status === 'fulfilled' && Array.isArray(w.value)) {
            setRecentOrders(w.value as WorkOrder[]);
          } else {
            failed++;
          }
          // 聚焦层 3D 检修现场：复用上面这三个接口**已经拿到**的真实数据（不新增请求）。
          // 任一接口失败 → 对应字段为 null → 气泡渲染 "—"，绝不补零/估算。
          {
            const hist = t.status === 'fulfilled' && t.value && (t.value as TelemetryHistory).equipmentId === id
              ? (t.value as TelemetryHistory) : null;
            const pts = hist?.points ?? [];
            const last = pts.length > 0 ? pts[pts.length - 1] : null;
            const snap = (d.status === 'fulfilled' ? d.value?.telemetry : undefined) ?? local?.telemetry ?? null;
            const sample: FocusDecorTelemetrySample | null = last
              ? {
                temperature: last.temperature ?? null,
                vibration: last.vibration ?? null,
                current: last.current ?? null,
                pressure: last.pressure ?? null,
              }
              : snap
                ? {
                  temperature: snap.temperature ?? null,
                  vibration: snap.vibration ?? null,
                  current: snap.current ?? null,
                  pressure: snap.pressure ?? null,
                }
                : null;
            const orders = w.status === 'fulfilled' && Array.isArray(w.value) ? (w.value as WorkOrder[]) : [];
            // 展示口径：优先进行中的那张工单，没有则取最新一张（接口已按时间倒序）
            const active = orders.find((o) => o.status !== 'completed' && o.status !== 'cancelled') ?? orders[0] ?? null;
            const decorData: FocusDecorData = {
              deviceId: id,
              deviceName: (d.status === 'fulfilled' ? d.value?.name : undefined) ?? local?.name ?? null,
              status: toFocusDecorStatus((d.status === 'fulfilled' ? d.value?.status : undefined) ?? local?.status),
              telemetry: sample,
              workOrder: active ? { orderNo: active.orderNo, status: active.status, faultType: active.faultType } : null,
              faultPartName: isFaulty ? partLabel : null,
            };
            focusDecorBaseRef.current = decorData;
            sceneRef.current?.setFocusDecorData?.(decorData);
            // 维修闭环：选中设备带着可操作工单时自动弹出检修卡片，操作入口就在 3D 里
            const actionable = active && ['created', 'dispatched', 'in_progress', 'pending_acceptance'].includes(active.status);
            if (actionable) {
              setActiveOrderCard((prev) => prev ?? active!);
              // 单台聚焦下 3D 是主角：工单卡默认收起为窄 tab，点开再看
              setRepairCardCollapsed(true);
            }
          }
          setCardError(failed ? '部分详情、48h 时序或工单接口不可用；仅展示已获取的真实数据，缺失项不估算' : null);
        })
        .catch((err: unknown) => {
          if (request !== selectionRequestRef.current) return;
          setDetail(local);
          setCardError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => { if (request === selectionRequestRef.current) setCardLoading(false); });
    },
    [equipments, refreshLiveStats, resetSelectionVisuals]
  );

  const clearSelection = useCallback(() => {
    ++selectionRequestRef.current;
    resetSelectionVisuals();
    setCardLoading(false);
    setSelectedId(null);
    setDetail(null);
    setRecentOrders([]);
    setTelemetry(null);
    setCardError(null);
    setActiveOrderCard(null);
    setRightTab('analysis');
    sceneRef.current?.setSelected(null);
    sceneRef.current?.clearFaultChain();
    sceneRef.current?.clearFaults?.();
    // 退出独占 + 单台聚焦，回到16 台总览
    sceneRef.current?.setIsolation(null);
    sceneRef.current?.resetFocus();
    setIsolationId(null);
    refreshLiveStats();
  }, [refreshLiveStats, resetSelectionVisuals]);

  const drillIntoBuilding = useCallback((buildingId: string, buildingName?: string) => {
    const scene = sceneRef.current;
    if (!scene) return;
    clearSelection();
    scene.drillIntoBuilding(buildingId);
    setActiveBuilding({ id: buildingId, name: buildingName ?? buildingId });
    setLevel('workshop');
  }, [clearSelection]);

  useEffect(() => () => { ++selectionRequestRef.current; }, []);

  /* ---------- 5.1 工单跨页深度链接 (?view=equipment_3d&workOrderId=xxx) ---------- */
  const handledOrderIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !equipments.length) return;

    /**
     * ★ 一次性深链：**URL 上的 workOrderId 是唯一凭据**，兑现一次后立刻从 URL 摘掉。
     *
     * 用户实测的故障（2026-10-16）：从工单「3D 查看」进过一次 3D 之后，
     * 之后**每次**点「广州主厂」都被直接拽进单台设备聚焦 —— 看起来像"厂区总览跳步"。
     * 两个原因叠加：
     *   ① App 的 `targetWorkOrderIdFor3D` 是 sticky state，置上后再没清过（离开 3D 也不清）；
     *   ② 本组件在离开厂区层时被卸载，`handledOrderIdRef` 归零 ⇒ 每次重进厂区层都重新兑现一次。
     * 只认 props 就永远修不掉。改成只认 URL + 兑现即摘，语义变成"一次导航意图只兑现一次"：
     * 用户下一次主动点「广州主厂」时 URL 里已经没有凭据，自然落在厂区总览。
     */
    let urlOrderId: string | null = null;
    try {
      urlOrderId = new URLSearchParams(window.location.search).get('workOrderId');
    } catch {
      urlOrderId = null;
    }
    let wantExploded = false;
    try {
      // F1 深链：工单按钮会把 URL 写成 ?view=equipment_3d&workOrderId=…&showExplodedView=1
      wantExploded = new URLSearchParams(window.location.search).get('showExplodedView') === '1';
    } catch {
      wantExploded = false;
    }
    if (!urlOrderId) return;

    const targetOrderId = initialWorkOrderId || urlOrderId;
    if (handledOrderIdRef.current === targetOrderId) return;

    const findAndFocus = (order: WorkOrder) => {
      const eqId = order.equipmentId || (order as any).equipment_id;
      if (!eqId) return;
      // 层级不跳步：先把场景推进到「车间现场」（面包屑补上车间一级，用户能按层退回去），
      // 再聚焦该设备。直接 setIsolation 会让面包屑少一级、也无法退回车间。
      const eq = equipments.find((e) => e.id === eqId);
      if (eq?.workshop) setActiveBuilding({ id: eq.workshop, name: eq.workshop });
      sceneRef.current?.enterWorkshopLevel();
      setLevel('workshop');
      handlePick(eqId);
      setActiveOrderCard(order);
      setRepairCardCollapsed(true);
      // ---- F1：带 showExplodedView=1 深链时打开页内拆解视图，并迁入工单上下文（真实数据，服务端匹配目标零件） ----
      if (wantExploded && eqId && hasExplodedView(eqId)) {
        setExplodedHtmlDeviceId(eqId);
        const localPartsUsed = Array.isArray(order.repairLog?.partsUsed)
          ? order.repairLog.partsUsed.map((p) => ({ name: p.name, code: p.code, qty: p.qty, spec: p.spec }))
          : [];
        setExplodedHtmlContext({
          id: order.id,
          orderNo: order.orderNo,
          title: order.title,
          description: order.description ?? '',
          faultType: order.faultType ?? '',
          priority: order.priority ?? 'general',
          status: order.status ?? 'created',
          createdAt: order.createdAt ?? null,
          equipmentName: eq?.name ?? '',
          partsUsed: localPartsUsed,
          targetPart: null,
          briefLoading: true,
        });
        explodedViewApi
          .getWorkOrderBrief(order.id)
          .then((brief) => {
            setExplodedHtmlContext((prev) => {
              if (!prev || prev.id !== order.id) return prev;
              return { ...prev, partsUsed: brief.workOrder.partsUsed, targetPart: brief.targetPart, dataNote: brief.dataNote, briefLoading: false };
            });
          })
          .catch(() => {
            // 服务端未命中目标位号（或接口异常）：拆解页照常打开，只是不高亮 —— 卡片上会如实说明
            setExplodedHtmlContext((prev) => {
              if (!prev || prev.id !== order.id) return prev;
              return { ...prev, briefLoading: false };
            });
          });
      }
      // 兑现即摘 URL 凭据（放在真正聚焦成功之后：getById 失败时凭据保留，下次还能重试）
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('workOrderId');
        url.searchParams.delete('showExplodedView');
        window.history.replaceState(window.history.state, '', url.toString());
      } catch {
        /* ignore */
      }
    };

    // ⚠️ 时序：首次进入时 allOrders 往往还在请求中（空数组）。旧实现把
    // handledOrderIdRef 提前记为"已处理"，若首轮列表为空且 getById 失败/404，
    // 列表随后到位也不会再试 —— 深度链接永久失效。
    // 现在改为：列表未到就等下一次 allOrders 更新；列表确认没有这张单才走 getById。
    const existing = allOrders.find((o) => o.id === targetOrderId);
    if (existing) {
      handledOrderIdRef.current = targetOrderId;
      findAndFocus(existing);
      return;
    }
    if (allOrders.length > 0) {
      handledOrderIdRef.current = targetOrderId;
      workOrderApi
        .getById(targetOrderId)
        .then((order) => {
          if (order) findAndFocus(order);
        })
        .catch((err) => {
          logger.warn('[equipment3d] 工单深度链接匹配失败，静默回退到普通 3D 场景:', err);
        });
    }
  }, [ready, equipments, allOrders, initialWorkOrderId, handlePick]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    downRef.current = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  }, []);

  /* ---------- 5.2 维修闭环：场景内工单操作（派单/接单/步骤勾选/完工上报/验收） ---------- */

  const operatorName = useMemo(
    () => (currentUser ? `${currentUser.name} (${currentUser.roleTitle})` : undefined),
    [currentUser]
  );

  /** 只读模式统一闸门：操作工在 3D 场景内只能浏览，任何处置动作在此被拦下 */
  const guardReadOnly = useCallback(() => {
    if (!readOnly3D) return false;
    setOrderActionError('当前角色仅可浏览 3D 场景，不能操作设备或推进工单，请切换角色');
    return true;
  }, [readOnly3D]);

  /** 工单操作成功后的统一收口：当前卡片 + 选中设备工单列表 + 全局上下文 + 指示环 */
  const applyOrderUpdate = useCallback(
    (updated: WorkOrder) => {
      setActiveOrderCard((prev) => (prev && prev.id === updated.id ? updated : prev));
      setRecentOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      contextUpdateWorkOrder?.(updated);
      fetchWorkOrders();
    },
    [contextUpdateWorkOrder, fetchWorkOrders]
  );

  /** 刷新聚焦层五步卡片的工单状态（底版快照在 handlePick 时缓存） */
  const refreshFocusDecorOrder = useCallback((order: WorkOrder | null) => {
    const base = focusDecorBaseRef.current;
    if (!base || !sceneRef.current) return;
    sceneRef.current.setFocusDecorData({
      ...base,
      workOrder: order ? { orderNo: order.orderNo, status: order.status, faultType: order.faultType } : null,
    });
  }, []);

  const handleOrderDispatch = useCallback(async () => {
    const order = activeOrderCard;
    if (!order || orderActionBusy) return;
    if (guardReadOnly()) return;
    setOrderActionBusy(true);
    setOrderActionError(null);
    try {
      const rec = await dispatchApi.recommend(order.id);
      const top = rec?.recommendations?.[0]?.technician;
      if (!top?.id) throw new Error('调度推荐未返回可用技师');
      const res = await dispatchApi.assign({ workOrderId: order.id, userId: top.id });
      applyOrderUpdate((res?.workOrder ?? (res as unknown)) as WorkOrder);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setOrderActionError(`派单失败：${msg}`);
      logger.warn('[equipment3d] 场景内派单失败:', err);
    } finally {
      setOrderActionBusy(false);
    }
  }, [activeOrderCard, orderActionBusy, applyOrderUpdate]);

  const handleOrderClaim = useCallback(async () => {
    const order = activeOrderCard;
    if (!order || orderActionBusy) return;
    if (guardReadOnly()) return;
    setOrderActionBusy(true);
    setOrderActionError(null);
    try {
      const updated = await workOrderApi.claim(order.id, { operatorName, version: order.version });
      applyOrderUpdate(updated);
      const eqId = order.equipmentId || (order as any).equipment_id;
      // 接单即进场：设备状态切"检修中"蓝（只覆盖显示，台账不动）
      if (eqId) sceneRef.current?.setDeviceRepairPhase(eqId, 'repairing');
      refreshFocusDecorOrder(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setOrderActionError(`接单失败：${msg}`);
      logger.warn('[equipment3d] 场景内接单失败:', err);
    } finally {
      setOrderActionBusy(false);
    }
  }, [activeOrderCard, orderActionBusy, operatorName, applyOrderUpdate, refreshFocusDecorOrder]);

  const handleOrderComplete = useCallback(
    async (payload: { causeAnalysis: string; workHours: number; resolutionSteps: string }) => {
      const order = activeOrderCard;
      if (!order || orderActionBusy) return;
      if (guardReadOnly()) return;
      setOrderActionBusy(true);
      setOrderActionError(null);
      try {
        const updated = await workOrderApi.complete(order.id, {
          causeAnalysis: payload.causeAnalysis,
          resolutionSteps: payload.resolutionSteps,
          workHours: payload.workHours,
          completionPhotos: [],
          operatorName,
          version: order.version,
        });
        applyOrderUpdate(updated);
        const eqId = order.equipmentId || (order as any).equipment_id;
        // 修复完成：定位标红转绿淡出 + 设备复转 + 相机缓推
        if (eqId) sceneRef.current?.playRepairRecovery(eqId);
        refreshFocusDecorOrder(updated);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setOrderActionError(`完工上报失败：${msg}`);
        logger.warn('[equipment3d] 场景内完工上报失败:', err);
      } finally {
        setOrderActionBusy(false);
      }
    },
    [activeOrderCard, orderActionBusy, operatorName, applyOrderUpdate, refreshFocusDecorOrder]
  );

  const handleOrderAccept = useCallback(async () => {
    const order = activeOrderCard;
    if (!order || orderActionBusy) return;
    if (guardReadOnly()) return;
    setOrderActionBusy(true);
    setOrderActionError(null);
    try {
      const updated = await workOrderApi.accept(order.id, {
        inspectorName: operatorName,
        pass: true,
        score: 5,
        comment: '现场复测合格，具备复机条件',
        version: order.version,
      });
      applyOrderUpdate(updated);
      const eqId = order.equipmentId || (order as any).equipment_id;
      // 台账同步：沿用 AppDataContext「工单 completed → 设备 running」的既有口径，
      // 并把 running 合并进 3D 自己拉的 remote 台账，消除"验收完切回 3D 还是故障色"的时滞。
      if (eqId) {
        setRemote((prev) =>
          prev ? prev.map((e) => (e.id === eqId ? { ...e, status: 'running' } : e)) : prev
        );
        sceneRef.current?.setDeviceRepairPhase(eqId, 'operating');
      }
      refreshFocusDecorOrder(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setOrderActionError(`验收失败：${msg}`);
      logger.warn('[equipment3d] 场景内验收失败:', err);
    } finally {
      setOrderActionBusy(false);
    }
  }, [activeOrderCard, orderActionBusy, operatorName, applyOrderUpdate, refreshFocusDecorOrder]);

  /** 步骤勾选 → 3D 故障定位标逐层减淡（勾一步消一层） */
  const handleStepProgress = useCallback(
    (checked: number, total: number) => {
      const order = activeOrderCard;
      if (!order) return;
      if (guardReadOnly()) return;
      stepProgressRef.current.set(order.id, checked);
      const eqId = order.equipmentId || (order as any).equipment_id;
      if (eqId) sceneRef.current?.setDeviceRepairProgress(eqId, total > 0 ? checked / total : 0);
    },
    [activeOrderCard]
  );

  /** AI 诊断结果回写 3D：原因关键词匹配观测部位，把故障定位标挪过去 */
  const handleAiDiagnosis = useCallback(
    (diag: AiDiagnosis): string | null => {
      if (!selectedId) return null;
      const zone = matchZoneForCauses(selectedId, diag.probableCauses, diag.summary);
      if (!zone) return null;
      sceneRef.current?.showDeviceFault(selectedId, zone.partLabel, zone.partKey);
      sceneRef.current?.frameDeviceFault(selectedId);
      if (focusDecorBaseRef.current) {
        focusDecorBaseRef.current = { ...focusDecorBaseRef.current, faultPartName: zone.partLabel };
      }
      return zone.partLabel;
    },
    [selectedId]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = downRef.current;
      downRef.current = null;
      if (!d || d.id !== e.pointerId) return;
      // 拖动旋转 / 平移不应触发选中
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
      if (performance.now() - d.t > 600) return;
      const scene = sceneRef.current;
      if (!scene) return;
      // 三级拾取：厂房（下钻）/ 机械臂工作站（绑定设备）/ 台账设备。
      // pickScene 缺失时退回旧的 pick()，保证替身场景下点击选中仍然有效。
      const hit = scene.pickScene
        ? scene.pickScene(e.clientX, e.clientY)
        : (() => {
            const legacy = scene.pick(e.clientX, e.clientY);
            return legacy ? { kind: 'device' as const, id: legacy.id, index: legacy.index } : null;
          })();
      if (!hit) {
        clearSelection();
        return;
      }
      if (hit.kind === 'zone') {
        // 点击分区地块 → 选中该分区（HUD 展示分区成绩，相机取景到该分区）；不切换层级
        setActiveZoneId(hit.zoneId);
        scene.selectZone?.(hit.zoneId);
        syncFactoryZones();
        return;
      }
      if (hit.kind === 'building') {
        scene.drillIntoBuilding(hit.buildingId);
        setActiveBuilding({ id: hit.buildingId, name: hit.name });
        return;
      }
      if (hit.kind === 'station') {
        if (hit.deviceId) handlePick(hit.deviceId);
        return;
      }
      handlePick(hit.id);
    },
    [handlePick, clearSelection, syncFactoryZones]
  );

  /* ---------- 6. 参数更新 ---------- */
  const patch = useCallback((p: Partial<SceneParams>) => setParams((prev) => ({ ...prev, ...p })), []);

  const applyView = useCallback(
    (view: ViewKey) => {
      const scene = sceneRef.current;
      if (!scene) return;
      let index = 0;
      if (view === 'closeup') {
        const all = deviceInputs.map((d) => d.id);
        const i = selectedId ? all.indexOf(selectedId) : 0;
        index = i >= 0 ? i : 0;
      }
      scene.setView(view, index);
    },
    [selectedId, deviceInputs]
  );

  /** HUD 面包屑切层：厂区 ↔ 车间（相机走既有阻尼插值，平滑不跳变）。 */
  const changeLevel = useCallback(
    (target: SceneLevel) => {
      const scene = sceneRef.current;
      if (!scene) return;
      if (target === 'factory') {
        clearSelection();
        scene.enterFactoryLevel();
        setLevel('factory');
      } else {
        scene.enterWorkshopLevel();
        setLevel('workshop');
      }
    },
    [clearSelection]
  );

  const randomizeSeed = useCallback(() => {
    // 仅重掷「场景几何种子」——不参与任何设备状态着色
    patch({ seed: Math.floor(Math.random() * 1_000_000) });
  }, [patch]);

  /* ---------- 7. 遥测回放控制 ---------- */
  const points = telemetry?.points ?? [];
  const maxIndex = points.length - 1;

  const togglePlayback = useCallback(() => {
    setPlaybackPlaying((prev) => !prev);
  }, []);

  const seekPlayback = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(maxIndex, idx));
      setPlaybackIndex(clamped);
      playbackIndexRef.current = clamped;
      // 拖动时如果未在播放，也同步一次 3D 状态色（即时反馈）
      if (!playbackPlaying && selectedId && points.length > 0) {
        const point = points[clamped];
        const overStatus = telemetryToStatus(point);
        sceneRef.current?.setStatusOverride(selectedId, overStatus);
      }
    },
    [maxIndex, playbackPlaying, selectedId, points]
  );

  const resetPlayback = useCallback(() => {
    setPlaybackPlaying(false);
    setPlaybackIndex(-1);
    playbackIndexRef.current = -1;
    sceneRef.current?.clearStatusOverrides();
    const eq = equipments.find((item) => item.id === selectedId);
    if (eq) sceneRef.current?.setDeviceTelemetry(eq.id, telemetryFeed(eq.status, eq.telemetry));
  }, [selectedId, equipments]);

  /* ---------- 7.1 拆解视图控制 ---------- */

  /**
   * 注册"页内打开拆解视图 HTML"的宿主实现。
   *
   * `ExplodedViewButton` 在大屏 HUD 右栏与普通模式侧栏两处使用，两处都在本组件的子树里，
   * 但中间隔着 `ProductionHUD`（并行会话在维护，不宜再加一条 props 链）。所以用
   * `explodedViewFiles.setExplodedViewHost()` 做一层薄注册：按钮只管"请求打开"，
   * 由本组件决定"在页面内怎么显示"。宿主返回 true = 已接管，按钮不再走新标签页兜底。
   *
   * 卸载时注销，避免热更新后残留一个指向已卸载组件的闭包。
   */
  useEffect(() => {
    setExplodedViewHost((deviceId) => {
      if (!hasExplodedView(deviceId)) return false;
      setExplodedHtmlDeviceId(deviceId);
      return true;
    });
    return () => setExplodedViewHost(null);
  }, []);

  const enterExplodedView = useCallback(() => {
    if (!selectedId || !isExplodedViewSupported(selectedId)) return;
    const scene = sceneRef.current;
    if (!scene) return;

    const config = getExplodedConfig(selectedId);
    if (!config) return;

    // 停止回放
    if (playbackPlaying) {
      resetPlayback();
    }

    // 获取设备零件信息
    const partInfo = scene.getDevicePartInfo(selectedId);
    if (!partInfo || partInfo.length === 0) return;

    // 隐藏原始设备实例
    scene.enterExplodedView(selectedId);

    // 计算拆解布局
    const preset = SCENE_PRESETS[params.presetId] ?? SCENE_PRESETS.standard;
    const layout = computeExplodedLayout(config, {
      getDevicePartInfo: (id) => id === selectedId ? partInfo : null
    } as any, preset.palette);

    // 创建拆解零件网格
    const sceneThree = scene.scene;
    const partsWithMeshes = createExplodedMeshes(layout, partInfo, preset.palette, sceneThree);
    scene.syncExplodedFluid(selectedId);

    setExplodedDeviceId(selectedId);
    setExplodedParts(partsWithMeshes);
    setIsExplodedAnimating(true);

    // 播放展开动画
    const cancel = animateExplodedUnfold(partsWithMeshes, config, () => {
      setIsExplodedAnimating(false);
    });
    explodedCleanupRef.current = cancel;
  }, [selectedId, playbackPlaying, resetPlayback, params.presetId]);

  const exitExplodedView = useCallback(() => {
    if (!explodedDeviceId) return;
    const scene = sceneRef.current;
    if (!scene) return;

    const config = getExplodedConfig(explodedDeviceId);
    if (!config) return;

    // 取消进行中的动画
    if (explodedCleanupRef.current) {
      explodedCleanupRef.current();
      explodedCleanupRef.current = null;
    }

    setIsExplodedAnimating(true);

    // 播放折叠动画
    explodedCleanupRef.current = animateExplodedFold(explodedParts, config, () => {
      // 移除拆解零件网格
      removeExplodedMeshes(scene.scene);

      // 恢复原始设备实例
      scene.exitExplodedView(explodedDeviceId);

      setExplodedDeviceId(null);
      setExplodedParts([]);
      setIsExplodedAnimating(false);
      scene.setSafetyBoundaryVisible(showSafetyBoundary);
      // 恢复故障链（若选中设备仍在）
      if (selectedId) {
        const pts = allTelemetryRef.current.get(selectedId) ?? null;
        if (pts && pts.length > 0) scene.buildFaultChain(selectedId, pts, recentOrders);
      }
      // 恢复人员动线
      if (showWorkers) {
        let assigneeId: string | null = null;
        let assigneeStatus: string | null = null;
        if (selectedId && recentOrders.length > 0) {
          const urgent = recentOrders.find(
            (o) => (o.priority === 'urgent' || o.priority === 'high') && o.assigneeId,
          );
          if (urgent) { assigneeId = urgent.assigneeId!; assigneeStatus = urgent.status; }
        }
        scene.setWorkerVisible(true);
        scene.buildWorkers(technicians, trajectoryRef.current, selectedId, assigneeId, assigneeStatus);
      }
    });
  }, [explodedDeviceId, explodedParts, selectedId, recentOrders, showSafetyBoundary]);

  /**
   * 返回总览：退出单设备独占模式，恢复 16 台同框。
   * 若正处于拆解视图，先合拢复原（拆解零件与 16 台同框叠加会显得混乱）。
   * 定义位置必须在 exitExplodedView 之后 —— 否则触发 TDZ。
   */
  const exitIsolation = clearSelection;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selectedId) {
        event.preventDefault();
        exitIsolation();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, exitIsolation]);

  useEffect(() => {
    (window as any).__handlePick = handlePick;
    (window as any).__clearSelection = clearSelection;
    (window as any).__enterExplodedView = enterExplodedView;
    (window as any).__exitExplodedView = exitExplodedView;
    (window as any).__setParams = patch;
  }, [handlePick, clearSelection, enterExplodedView, exitExplodedView, patch]);

  // 播放定时器：1 秒 = 1 小时，总长 points.length 秒可循环
  // 画布上浮着两块 DOM，两侧一起挤聚焦层的屏幕槽位：
  //   - 右侧详情面板 / HUD（左缘会变，实测 CSS 1261 → 1116）
  //   - 左侧「检修步骤卡片」弹窗（w-[380px]，几乎满高，实测把左列气泡整列盖住）
  // 把两条"真正露出来"的边界换算成 NDC 喂给聚焦层检修现场，
  // 数据气泡 / 检修卡片 / 警示牌据此让位，不会被压在 DOM 底下。
  useEffect(() => {
    const measure = () => {
      const scene = sceneRef.current;
      const canvas = scene?.renderer?.domElement;
      if (!canvas) return;
      const cr = canvas.getBoundingClientRect();
      if (cr.width <= 0 || cr.height <= 0) return;

      // ⚠️ 别用"够宽、贴着某条边"那套启发式：实测它会把顶部 1304×45 的状态条
      //    当成整块侧栏（过度严格），又会漏掉真正压住左半边的工单弹窗。
      //    直接打 DOM 命中测试 —— 谁挡着就是谁，跟元素宽高/类名无关。
      const free = (x: number, y: number) => {
        const el = document.elementFromPoint(x, y);
        return !!el && (el === canvas || canvas.contains(el));
      };
      // ⚠️ 也不能"从最边缘往里扫到第一个可见点就停"：右侧面板是 right-2.5 内缩的，
      //    画布最右边那 10px 其实是空的 ⇒ 那样扫出来右缘永远是 cr.right（实测漏掉整块面板）。
      //    正确做法：扫整行，取**最宽的一段连续可见区间**，再跨行取交集。
      const W = cr.width;
      const step = 16;
      let leftEdge = 0;      // 画布内坐标
      let rightEdge = W;
      for (const fy of [0.2, 0.45, 0.6, 0.82]) {
        const y = cr.top + cr.height * fy;
        let bestA = -1, bestB = -1, a = -1;
        for (let x = 0; x <= W; x += step) {
          const ok = x < W && free(cr.left + x, y);
          if (ok && a < 0) a = x;
          if (!ok && a >= 0) {
            if (x - a > bestB - bestA) { bestA = a; bestB = x; }
            a = -1;
          }
        }
        if (bestA < 0 || bestB - bestA < W * 0.15) continue; // 整行被盖住的行不算数
        leftEdge = Math.max(leftEdge, bestA);
        rightEdge = Math.min(rightEdge, bestB);
      }
      const toNdc = (px: number) => (px / cr.width) * 2 - 1; // 0..1 → NDC(-1..1)
      const margin = (8 / cr.width) * 2; // 8px 余量，别贴着 DOM 边缘放
      const leftNdc = Math.min(0.6, toNdc(leftEdge) + margin);
      const rightNdc = Math.max(-0.6, toNdc(rightEdge) - margin);
      // 两侧同时量错（整行都被盖住）时不喂，免得安全带被压成 0
      if (rightNdc - leftNdc < 0.25) return;
      scene.setFocusDecorSafeArea?.(rightNdc);
      scene.setFocusDecorSafeAreaLeft?.(leftNdc);
    };
    // 首次延后 500ms：刚进聚焦层时镜头阻尼 + GLB 加载最吃 CPU，扫整块画布
    // 会把渲染线程卡到零帧；500ms 后扫既不影响最终安全线，又能避开那一波尖峰。
    const first = window.setTimeout(measure, 500);
    // ⚠️ 光靠 React deps 不够：右侧面板是**数据回来之后**才渲染出来的（实测点击后隔几秒才出现），
    //    那时 panelOpen/level/selectedId 都没变，effect 不会再跑。
    //    ⇒ 直接盯 DOM：面板出现/隐藏/变宽都要重新量。
    const host = sceneRef.current?.renderer?.domElement?.closest?.('.industrial-workspace')
      ?? sceneRef.current?.renderer?.domElement?.parentElement ?? null;
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (ro && host) ro.observe(host);
    let timer = 0;
    const mo = typeof MutationObserver === 'function' && host
      ? new MutationObserver(() => {
        clearTimeout(timer);
        timer = window.setTimeout(measure, 200); // 防抖：面板内容连变会刷很多次
      })
      : null;
    if (mo && host) mo.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(first);
      clearTimeout(timer);
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [panelOpen, hudOn, level, ready, selectedId]);

  useEffect(() => {
    if (playbackPlaying && points.length > 0) {
      playbackTimerRef.current = setInterval(() => {
        setPlaybackIndex((prev) => {
          const next = prev + 1;
          if (next > maxIndex) {
            // 播放结束：回到真实状态
            if (selectedId) sceneRef.current?.clearStatusOverrides();
            setPlaybackPlaying(false);
            playbackIndexRef.current = -1;
            return -1;
          }
          playbackIndexRef.current = next;
          return next;
        });
      }, 1000);
    }
    return () => {
      if (playbackTimerRef.current) {
        clearInterval(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
    };
  }, [playbackPlaying, points.length, maxIndex, selectedId]);

  // 回放时刻变化时：同步 3D 状态色覆盖与介质流速
  useEffect(() => {
    if (playbackIndex < 0 || playbackIndex >= points.length || !selectedId) return;
    const point = points[playbackIndex];
    const overStatus = telemetryToStatus(point);
    sceneRef.current?.setStatusOverride(selectedId, overStatus);
    const ledgerStatus = equipments.find((eq) => eq.id === selectedId)?.status ?? 'nodata';
    sceneRef.current?.setDeviceTelemetry(selectedId, telemetryFeed(overStatus ?? ledgerStatus, point));
  }, [playbackIndex, points, selectedId, equipments]);

  // 换设备 / 清选中时停止回放并清除覆盖
  useEffect(() => {
    if (!selectedId) {
      setPlaybackPlaying(false);
      setPlaybackIndex(-1);
      playbackIndexRef.current = -1;
      sceneRef.current?.clearStatusOverrides();
      // 退出拆解视图
      if (explodedDeviceId) {
        exitExplodedView();
      }
    }
  }, [selectedId, explodedDeviceId, exitExplodedView]);

  /**
   * 页内拆解视图是"某台设备的"视图：换设备 / 清选中时必须收起。
   * 否则右栏已经切到新设备、中间还停在旧设备的拆解页上 —— 数据与视图对不上。
   */
  useEffect(() => {
    if (!explodedHtmlDeviceId) return;
    if (selectedId !== explodedHtmlDeviceId) setExplodedHtmlDeviceId(null);
  }, [selectedId, explodedHtmlDeviceId]);
  // 工单上下文与舞台同生共死：舞台收起时一并清掉（分处独立 effect，便于各测各的）
  useEffect(() => {
    if (!explodedHtmlDeviceId && explodedHtmlContext) setExplodedHtmlContext(null);
  }, [explodedHtmlDeviceId, explodedHtmlContext]);

  /**
   * 拆解侧栏里的「返回工单详情」（F2 关联跳转）：
   * 优先走宿主回调（App 收尾联动工单列表自动展开那单的抽屉）；没给回调时按
   * work_orders 深链 URL 兜底。不切走也不关拆解视图 —— 用户可随时返回。
   */
  const handleOpenWorkOrderFromExploded = useCallback(
    (orderId: string) => {
      if (onOpenWorkOrderDetail) {
        onOpenWorkOrderDetail(orderId);
        return;
      }
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('view', 'work_orders');
        url.searchParams.set('workOrderId', orderId);
        url.searchParams.delete('showExplodedView');
        window.location.href = url.toString();
      } catch {
        /* ignore */
      }
    },
    [onOpenWorkOrderDetail]
  );

  /* ---------- 8. 选中设备的展示数据 ---------- */
  const selectedDevice = useMemo(
    () => equipments.find((e) => e.id === selectedId) ?? null,
    [equipments, selectedId]
  );
  const card = detail ?? selectedDevice;
  /** 选中设备的专属配方（16 台设备各自的辨识特征；未知设备为 null） */
  const selectedRecipe = useMemo(
    () => (selectedId ? DEVICE_RECIPES[selectedId] ?? null : null),
    [selectedId]
  );

  /* ---------- 8.5 顶部唯一的下钻路径条 ---------- */
  /**
   * 地图轴三级由下钻壳给（mapTrail），本层再接上自己的「车间 / 单设备」两级。
   * 2026-09-23 用户「太拥挤了」：原本地图轴那条绝对定位浮在工具栏正中、厂区轴那条挤在
   * 大屏栏左侧 —— 顶部两条面包屑、当前层级名写两遍。合成一条之后，它待在工具栏的
   * 正常文档流里（见下方 equipment3d-crumb-lane）：路径条折行时工具栏自己长高、
   * 工作区整体下移，所以「路径条压住大屏栏」在结构上不可能再发生
   * （上一版绝对定位 + width 撑满车道，1024px 下五级链路实测压出 -39px 重叠）。
   */
  const drillTrail = useMemo<DrillCrumbNode[]>(() => {
    const nodes = [...(mapTrail ?? [])];
    if (level !== 'factory') {
      nodes.push({
        key: 'workshop',
        label: activeBuilding?.name ?? '生产车间',
        active: level === 'workshop',
        onGo: level === 'device' ? () => changeLevel('workshop') : undefined,
      });
    }
    if (level === 'device' && selectedEquipment) {
      nodes.push({
        key: 'device',
        label: selectedEquipment.name,
        active: true,
        closable: !!isolationId,
        onGo: isolationId ? exitIsolation : undefined,
      });
    }
    return nodes;
  }, [mapTrail, level, activeBuilding?.name, selectedEquipment, isolationId, changeLevel, exitIsolation]);

  const preset = SCENE_PRESETS[params.presetId] ?? SCENE_PRESETS.standard;
  const showEmptyState = ready && !building && equipments.length === 0;

  /**
   * 拆解视图舞台：用户口径（2026-10-16 最新）：
   * 点进拆解视图后：
   * 1. 右边的设备详情面板（总览/参数/告警那些）全部隐藏
   * 2. 上面的"设备拆解视图"标题栏也去掉，不要
   * 3. 拆解视图 iframe 占满整个中间主区域，最大化显示，不要留边
   * 4. 只在右上角留一个小小的"返回 3D 设备视图"按钮就行
   * 5. 修复拆解视图内部的 BOM 表格：给表格区域加上下滚动条，让用户能上下滑动查看所有零件信息，不要卡住
   */
  const explodedStageInset = 'inset-0';

  return (
    <div className="equipment-industrial flex flex-col w-full h-full" style={{ minHeight: 620 }}>
      {/* 三段式：左区 / 下钻路径条 / 右区，用 grid 的 1fr·auto·1fr 钉住正中。
          2026-09-23 用户「太拥挤了」+ 上一轮实测：路径条原本是外壳里 absolute left-1/2 浮在
          画布上的药丸，窄窗口一折行就往下压大屏栏（五级链路 1024px 下重叠 -39px）；改成
          flex-1 车道又因为左右两簇不等宽（实测左 353 / 右 181）而整体偏右约 100px。
          现在它是工具栏正常的一员：折行只会让工具栏自己长高、工作区整体下移，
          **压住大屏栏在结构上不可能**；两侧轨道同为 1fr，路径条恒等于画布水平正中
          （minmax(0,…) 让轨道可小于内容，内容自己是 flex-wrap，所以只会折行不会溢出）。 */}
      <div className="equipment-industrial-header grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2 justify-self-start">
        <div className="flex items-center gap-2 pr-2">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-cyan-500/10 text-cyan-300">
            <Boxes className="w-4 h-4" />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-slate-100">工业设备 · 数字孪生</div>
            <div className="text-[11px] text-slate-500">{isolationId ? `聚焦 ${selectedDevice?.code ?? isolationId}` : `${equipments.length} 台真实台账`} · {dataMode === 'api' ? '接口数据' : dataMode === 'cache' ? '已加载台账' : '等待数据'}</div>
          </div>
        </div>

        {/* 状态芯片 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip icon={Layers} label="设备数" metric="devices" value={stats ? String(stats.devices) : '—'} />
          <Chip
            icon={AlertTriangle}
            label="故障数"
            metric="faults"
            value={stats ? String(stats.faults) : '—'}
            tone={stats && stats.faults > 0 ? 'danger' : 'default'}
          />
        </div>
        </div>

        {/* 下钻路径条：地图轴三级（外壳传来）+ 本层的车间 / 单设备两级，合成顶部唯一一条。
            独立挂载（tests 里 <Equipment3DView /> 无 mapTrail、厂区总览层）时节点为空，
            整格不渲染，避免留一个空药丸盒。 */}
        {drillTrail.length > 0 && (
          <div className="flex min-w-0 justify-self-center" data-testid="equipment3d-crumb-lane">
            <DrillTrail nodes={drillTrail} />
          </div>
        )}

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        {/* ---- 视图设置：可视化图层 + 渲染预设/画质 + 渲染统计，三合一 ----
              2026-09-23 用户「太拥挤了」：这一行原本并排三颗同款下拉（渲染统计 / 可视化图层 /
              渲染设置），光下拉就吃掉约 300px；「渲染统计」里的帧率还和大屏栏右上角的 FPS
              是同一个数说两遍。合成一颗、内部分三段，右侧簇立刻瘦下来。
              图层开关仍留在顶栏而不是右栏：右栏（场景参数/设备分析）在 HUD 模式下是隐藏的，
              这一组开关需要随时可达（各颜色含义见左下角 SceneLegend 图例）。 */}
          <details className="industrial-render-settings" data-testid="equipment3d-view-settings">
            <summary>视图设置</summary>
            <div className="industrial-popover">
            <div data-testid="equipment3d-layer-switches" className="flex flex-col gap-1.5">
              <div className="text-[10px] font-semibold tracking-wide text-cyan-300/90">可视化图层</div>
              <div className="text-[10px] leading-relaxed text-slate-400">
                地面彩色可视化层的独立开关；默认只保留「故障定位环 + 安全边界」。
                各颜色的含义见左下角图例。
              </div>
              <Toggle
                label="故障定位环（红色脉冲环 / 绿色恢复环）"
                testId="equipment3d-layer-fault-toggle"
                checked={showFaultLocator}
                onChange={setShowFaultLocator}
                icon={AlertTriangle}
              />
              <Toggle
                label="技师轨迹与指引线（蓝色线）"
                testId="equipment3d-layer-workers-toggle"
                checked={showWorkers}
                onChange={setShowWorkers}
                icon={User}
              />
              <Toggle
                label="介质流动（冷却水 / 油路粒子）"
                testId="equipment3d-layer-fluid-toggle"
                checked={!!params.fluidFlow}
                onChange={(v) => patch({ fluidFlow: v })}
                icon={Waves}
              />
              <Toggle
                label="安全边界（许可圈 / LOTO 隔离罩）"
                testId="equipment3d-layer-safety-toggle"
                checked={showSafetyBoundary}
                onChange={setShowSafetyBoundary}
                icon={Shield}
              />
            </div>

            {/* 渲染预设与画质（原独立「渲染设置」下拉，收进同一段） */}
            <div className="flex flex-col gap-1.5 border-t border-white/10 pt-2">
              <div className="text-[10px] font-semibold tracking-wide text-cyan-300/90">渲染预设与画质</div>
        {/* 预设切换 */}
        <div className="flex items-center gap-1 p-1 bg-slate-800 rounded-lg">
          {PRESET_ORDER.map((id) => {
            const p = SCENE_PRESETS[id];
            const active = params.presetId === id;
            return (
              <button
                key={id}
                type="button"
                data-preset={id}
                // 预设 = 完整配方（沿用参考生成器的设计）：切换预设时一并应用它自己的布局，
                // 否则三套预设只是换配色/尺寸，布局差异就丢了。用户之后仍可单独改布局覆盖。
                onClick={() =>
                  patch({ presetId: id, layout: SCENE_PRESETS[id]?.layout.pattern ?? params.layout })
                }
                title={p?.blurb}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  active ? 'bg-slate-700 text-cyan-300 shadow-sm' : 'text-slate-300 hover:text-white'
                }`}
              >
                {p?.name ?? id}
              </button>
            );
          })}
        </div>

        {/* 画质 */}
        <div className="flex items-center gap-1 p-1 bg-slate-800 rounded-lg">
          {QUALITY_OPTIONS.map((q) => (
            <button
              key={q}
              type="button"
              data-quality={q}
              onClick={() => patch({ quality: q })}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                params.quality === q ? 'bg-slate-700 text-cyan-300 shadow-sm' : 'text-slate-300 hover:text-white'
              }`}
            >
              {QUALITY[q].label}
            </button>
          ))}
        </div>
            </div>

            {/* 渲染统计（原独立「渲染统计」下拉，帧率与大屏栏右上角重复显示，收进弹层） */}
            <div className="flex flex-col gap-1.5 border-t border-white/10 pt-2">
              <div className="text-[10px] font-semibold tracking-wide text-cyan-300/90">渲染统计</div>
          <Chip
            icon={Triangle}
            label="三角面"
            metric="triangles"
            value={stats ? stats.triangles.toLocaleString('zh-CN') : '—'}
          />
          <Chip
            icon={Gauge}
            label="帧率"
            metric="fps"
            value={fps ? `${Math.round(fps)} fps` : '—'}
            tone={fps && fps < 30 ? 'warn' : 'default'}
          />
          {stats && (
            <Chip
              icon={Wand2}
              label="重建"
              metric="buildMs"
              value={`${stats.buildMs} ms`}
              tone={stats.buildMs > 80 ? 'warn' : 'default'}
            />
          )}
            </div>
            </div>
          </details>
        {/* 独占模式：返回 16 台总览 */}
        {isolationId && (
          <button
            type="button"
            data-testid="equipment3d-isolation-exit"
            onClick={exitIsolation}
            title="退出单设备聚焦，返回车间总览（Esc）"
            className="inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            返回总览 · Esc
          </button>
        )}

        {readOnly3D && (
          <span
            data-testid="equipment3d-readonly-badge"
            title="当前角色为只读浏览权限，无法在 3D 场景内操作设备"
            className="inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium rounded-lg border text-amber-200 bg-amber-500/15 border-amber-400/50"
          >
            <Eye className="w-3.5 h-3.5" />
            只读浏览
          </span>
        )}

        <button
          type="button"
          data-testid="equipment3d-hud-toggle"
          onClick={() => setHudOn((v) => !v)}
          title="切换大屏 HUD 覆盖层（顶栏 / 左菜单 / 右标签页）"
          className={`inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium rounded-lg border ${
            hudOn
              ? 'text-cyan-100 bg-cyan-600/25 border-cyan-400/60'
              : 'text-slate-300 bg-slate-800 border-slate-600'
          }`}
        >
          <Monitor className="w-3.5 h-3.5" />
          大屏 HUD
        </button>

        {!hudOn && (
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-slate-300 bg-slate-800 border border-slate-600 rounded-lg hover:text-slate-900 hover:border-slate-300"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {panelOpen ? '收起侧栏' : '设备与场景'}
          </button>
        )}
        </div>
      </div>

      {/* ================= 主区域 ================= */}
      <div className={`industrial-workspace relative flex-1 min-h-0 overflow-hidden bg-slate-900 ${panelOpen && !hudOn ? 'has-sidebar' : ''}`}>
        <div
          ref={hostRef}
          data-testid="equipment3d-host"
          className="industrial-viewport absolute inset-0"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
        />

        {/* ---- 拆解视图舞台：**在当前页面内**接管主显示区域 ----
            用户口径（2026-10-16）：点「拆解视图」不新开窗口、不整页跳走，而是把中间这块
            显示 3D 设备模型的区域换成拆解视图 HTML；右侧面板与顶部工具栏保留。
            第二次修正：中间那块要**完全填满**、不要留边、不要露出 3D 场景背景
            ⇒ 背板铺满整个主区域（不透明），只有内容列按 `explodedStageInset` 内缩。

            位置/层序：紧跟 canvas 之后 ⇒ 晚于它绘制，盖住 3D 画面；又**早于**后面的
            大屏 HUD / 左侧信息列 / 右侧详情面板 ⇒ 那些面板仍浮在它上面、照常可见可点。 */}
        {explodedHtmlDeviceId && (
          <ExplodedViewStage
            deviceId={explodedHtmlDeviceId}
            deviceName={equipments.find((e) => e.id === explodedHtmlDeviceId)?.name ?? null}
            deviceCode={equipments.find((e) => e.id === explodedHtmlDeviceId)?.code ?? null}
            onBack={() => {
              setExplodedHtmlDeviceId(null);
              setExplodedHtmlContext(null);
            }}
            className={explodedStageInset}
            workOrderBrief={explodedHtmlContext}
            targetPartPosNo={explodedHtmlContext?.targetPart?.posNo ?? null}
            onOpenWorkOrder={handleOpenWorkOrderFromExploded}
          />
        )}

        {/* ---- 首次构建遮罩 ---- */}
        {!ready && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/85 text-slate-200">
            <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
            <div className="text-sm">正在生成厂房与设备模型…</div>
          </div>
        )}

        {/* ---- 重建中（轻量，不遮挡） ----
            top 12→68：大屏 HUD 顶栏（ProductionHUD）占 workspace 内 20~61px，
            这颗居中徽章原来落在 12~37px，重建时会正正压在顶栏大标题上（2026-09-22 验收量出来的）。
            抬到 68px 后与顶栏留 7px 缝，且仍在画布上方空白区，不碰两栏卡片。 */}
        {ready && building && (
          <div className="absolute top-[68px] left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/70 text-[11px] text-slate-100 backdrop-blur">
            <Loader2 className="w-3 h-3 animate-spin" />
            重建中
          </div>
        )}

        {/* ---- 大屏 HUD 覆盖层：顶部标题栏 / 左侧功能菜单 / 右侧标签页（拆解视图激活时全部隐藏，让位给全屏拆解） ---- */}
        {ready && hudOn && (
          <div className={explodedHtmlDeviceId ? 'hidden' : 'contents'}>
            <ProductionHUD
              level={level}
              onLevelChange={changeLevel}
              onDrillBuilding={drillIntoBuilding}
              devices={equipments}
              selected={selectedEquipment}
              telemetry={telemetry}
              workOrders={recentOrders}
              technicians={technicians}
              onSelect={handlePick}
              fps={fps}
              beltAnimation={beltAnimation}
              onToggleBelt={setBeltAnimation}
              productionLine={lineEnabled}
              onToggleProductionLine={setLineEnabled}
              paused={animPaused}
              onTogglePaused={setAnimPaused}
              factoryZones={factoryZones}
              activeZoneId={activeZoneId}
              onSelectZone={selectZone}
              onRankMetricChange={changeRankMetric}
            />
          </div>
        )}

        {/* ---- 左侧信息列：工单状态图例 + 状态图例 + 俯视小地图 ---- */}
        <div className={`industrial-overview absolute top-3 left-3 flex flex-col gap-2 z-20 ${isolationId ? 'is-focused' : ''} ${hudOn || explodedHtmlDeviceId ? 'hidden' : ''}`}>
          {/* 工单状态图例 */}
          <div
            data-testid="equipment3d-workorder-legend"
            className="flex flex-col gap-1.5 p-2.5 rounded-lg bg-slate-900/62 backdrop-blur-sm border border-white/10 text-slate-100 min-w-[176px]"
          >
            <div className="flex items-center justify-between pb-1 border-b border-white/10">
              <div className="text-[10px] font-semibold tracking-wide text-slate-300 flex items-center gap-1">
                <Wrench className="w-3 h-3 text-cyan-400" />
                <span>工单状态指示</span>
              </div>
              <button
                type="button"
                onClick={fetchWorkOrders}
                disabled={ordersLoading}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="手动刷新工单数据"
              >
                <RefreshCw className={`w-3 h-3 ${ordersLoading ? 'animate-spin text-cyan-400' : ''}`} />
              </button>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                  </span>
                  <span>待检修</span>
                </div>
                <span className="tabular-nums font-mono text-[10px] text-rose-300 font-semibold bg-rose-500/10 px-1.5 py-0.2 rounded border border-rose-500/20">
                  {orderCounts.pending} 台
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                    <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                  </span>
                  <span>检修中</span>
                </div>
                <span className="tabular-nums font-mono text-[10px] text-amber-300 font-semibold bg-amber-500/10 px-1.5 py-0.2 rounded border border-amber-500/20">
                  {orderCounts.inProgress} 台
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 ml-0.5"></span>
                  <span>已完成</span>
                </div>
                <span className="tabular-nums font-mono text-[10px] text-emerald-300 font-semibold bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20">
                  {orderCounts.completed} 台
                </span>
              </div>
            </div>
          </div>

          {stats && stats.legend.length > 0 && (
            <div className="flex flex-col gap-1.5 p-2.5 rounded-lg bg-slate-900/62 backdrop-blur-sm border border-white/10">
              <div className="text-[10px] font-semibold tracking-wide text-slate-300">健康状态（真实数据）</div>
              {stats.legend.map((l) => (
                <div key={l.key} data-legend={l.key} className="flex items-center gap-2 text-[11px] text-slate-100">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm ring-1 ring-white/25"
                    style={{ background: hex(l.colour) }}
                  />
                  <span className="min-w-[38px]">{l.label}</span>
                  <span className="tabular-nums text-slate-300">{l.count}</span>
                </div>
              ))}
              <div className="mt-1 pt-1.5 border-t border-white/10 flex items-center justify-between text-[10px] text-slate-400">
                <span>
                  drawcall{' '}
                  <span data-metric="drawCalls" className="tabular-nums text-slate-300">
                    {stats.drawCalls}
                  </span>
                </span>
                <span>
                  动画{' '}
                  <span data-metric="animated" className="tabular-nums text-slate-300">
                    {stats.animated}
                  </span>
                </span>
              </div>
            </div>
          )}

          {/* 俯视小地图：颜色同样来自真实健康状态；厂房大、异常设备少时用于快速定位 */}
          <div className="rounded-lg bg-slate-900/62 backdrop-blur-sm border border-white/10 p-1.5">
            <canvas
              ref={miniRef}
              data-testid="equipment3d-minimap"
              className="block w-[176px] h-[132px] rounded"
            />
          </div>
        </div>

        {/* ---- 图例：讲清楚地面每一种颜色 / 线型代表什么 ----
            z-index 10 低于 HUD 面板（z-20）。停靠位按层级分：
              · 厂区层：右下角，但横向让开右侧「厂区核心运行指标」面板
                （面板 right 10px + 宽 240px，可长到容器底部上方 74px，压到它上面就是
                上一轮验收挂掉的点），所以取 right 262px；bottom 20 抬高到 KPI 卡片之上。
              · 车间 / 聚焦层：右栏是从 top 一直铺到 bottom-3 的详情面板，右下角没有空位，
                仍留在左侧菜单右边（left 262px = 10 + 240 + 12）。
              · HUD 关闭：右栏可能挂着分析面板（占 300px），回到真正的左下角。
            传入的是"画面上实际是否在画"的状态，而不是开关本身 —— 例如选中设备后
            派工指引虚线会出现在聚焦层，此时图例里那一行不再是「已关」。 */}
        {!explodedHtmlDeviceId && (
          <SceneLegend
            key={level === 'factory' ? 'factory' : 'detail'}
            defaultCollapsed={level === 'factory'}
            className={
              level === 'factory' && hudOn
                ? 'right-[262px] bottom-20'
                : hudOn
                  ? 'left-[262px] bottom-3'
                  : 'left-3 bottom-3'
            }
            layers={{
              faultLocator: showFaultLocator,
              workers: showWorkers,
              guide: showWorkers || !!isolationId,
              fluid: !!params.fluidFlow || !!isolationId,
              safety: showSafetyBoundary,
            }}
          />
        )}

        {/* ---- 数据来源提示 ----
            注意：参数面板同样位于 top-3 right-3（宽 248px），若提示也放右侧会被完全遮住。
            因此这里让出面板宽度（268px = 248 + 12 + 8 间隙），确保降级提示始终可见。 */}
        {dataMode === 'cache' && (
          <div
            data-testid="equipment3d-source-warning"
            className="absolute top-3 right-[268px] max-w-[240px] px-3 py-2 rounded-lg bg-amber-500/15 border border-amber-400/40 text-[11px] text-amber-100 backdrop-blur-sm"
          >
            设备台账接口不可用，当前使用已加载的真实台账数据展示。
          </div>
        )}

        {/* ---- 空状态 / 降级 ---- */}
        {showEmptyState && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-md w-full p-5 rounded-xl bg-slate-900/88 border border-white/12 text-center backdrop-blur" data-testid="equipment3d-empty">
              <WifiOff className="w-7 h-7 mx-auto mb-2.5 text-amber-400" />
              <div className="text-sm font-semibold text-slate-100 mb-1.5">未获取到设备台账</div>
              <p className="text-xs leading-relaxed text-slate-300">
                设备状态数据必须来自后端真实接口。接口当前不可用，场景已降级为
                <span className="text-slate-100 font-medium">仅展示厂房结构</span>
                ，不会用随机数模拟设备状态。
              </p>
              {dataError && (
                <p className="mt-2 text-[11px] text-amber-200/90 break-all">{dataError}</p>
              )}
              <button
                type="button"
                onClick={() => setReloadToken((v) => v + 1)}
                disabled={dataLoading}
                className="mt-3.5 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${dataLoading ? 'animate-spin' : ''}`} />
                重新加载设备台账
              </button>
            </div>
          </div>
        )}

        {/* ---- 构建失败 ---- */}
        {buildError && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 max-w-[560px] px-3 py-2 rounded-lg bg-rose-600/85 text-[11px] text-white">
            {buildError}
          </div>
        )}

        {/* ---- 右侧面板：场景参数 / 设备分析 两个标签（拆解视图激活时隐藏） ----
            设备分析放在右栏而不是浮在左下角：面板内容（档案 + 3 条 48h 曲线 + AI 结论 + 工单）
            远比原信息卡高，只有右栏的整列高度放得下，也不遮挡设备本体。
            注意本块在 hudOn=true 或 level==='factory' 时整体 hidden —— 即"关掉大屏 HUD"
            还不够，必须先下钻到车间/设备，这块面板才会出现。 */}
        {panelOpen && !explodedHtmlDeviceId && (
          <div className={`industrial-sidebar absolute top-3 right-3 flex flex-col gap-2 ${hudOn || level === 'factory' ? 'hidden' : ''}`}>
            {/* 设备快速切换：16 台设备逐一分析时不必在场景里找目标；
                选中后与「点击设备」走同一条 handlePick 通路（聚焦 + 拉取真实数据）。
                车间现场层例外 —— 那里改成「分区 → 车间 → 设备」三级导航：原来一个下拉框
                把全厂设备平铺出来，一进车间现场就能跳到任意设备（用户报的"跳步"）。 */}
            {equipments.length > 0 && level === 'workshop' ? (
              <div className="px-2 py-1.5 rounded-xl bg-slate-900/80 backdrop-blur border border-white/12 max-h-[46vh] overflow-y-auto">
                <WorkshopZoneNav
                  zones={factoryZones}
                  devices={equipments}
                  activeZoneId={activeZoneId}
                  onSelectZone={selectZone}
                  onSelectDevice={handlePick}
                  selectedDeviceId={selectedId}
                />
              </div>
            ) : equipments.length > 0 && (
              <div className="px-2 py-1.5 rounded-xl bg-slate-900/80 backdrop-blur border border-white/12">
                <select
                  aria-label="选择台账设备"
                  data-testid="equipment3d-device-select"
                  value={selectedId ?? ''}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id) handlePick(id);
                    else clearSelection();
                  }}
                  className="w-full bg-transparent text-[11px] text-slate-200 outline-none"
                >
                  <option value="">选择设备（共 {equipments.length} 台）…</option>
                  {equipments.map((e) => {
                    const k = String(e.status ?? 'nodata');
                    const label = (STATUS_META as Record<string, { label: string }>)[k]?.label ?? k;
                    return (
                      <option key={e.id} value={e.id} className="bg-slate-900">
                        {e.code} · {e.name} · {label}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            {/* 标签条 */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900/80 backdrop-blur border border-white/12">
              <button
                type="button"
                data-testid="equipment3d-tab-params"
                data-active={rightTab === 'params' ? 'true' : 'false'}
                onClick={() => setRightTab('params')}
                className={`flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                  rightTab === 'params' ? 'bg-white/12 text-slate-50' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Sparkles className="w-3 h-3" />
                场景参数
              </button>
              <button
                type="button"
                data-testid="equipment3d-tab-analysis"
                data-active={rightTab === 'analysis' ? 'true' : 'false'}
                onClick={() => setRightTab('analysis')}
                className={`flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                  rightTab === 'analysis' ? 'bg-white/12 text-slate-50' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Cpu className="w-3 h-3" />
                设备分析
                {selectedId && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
              </button>
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                className="shrink-0 px-1.5 text-slate-400 hover:text-slate-100"
                aria-label="收起右侧面板"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* 拆解视图入口：点它由本组件在**页内**把中间那块 3D 模型区换成拆解视图 HTML
                （`ExplodedViewStage`，同源 iframe）；不新开窗口、不整页跳走，右侧面板与
                顶部工具栏保留不动。没有对应拆解页的设备按钮置灰并给出原因（见 ExplodedViewButton）。 */}
            <div className="flex items-center gap-1.5 px-1">
              <span className="text-[10px] text-slate-500 truncate">
                {selectedDevice ? selectedDevice.code : '未选择设备'}
              </span>
              <ExplodedViewButton deviceId={selectedId} deviceName={selectedDevice?.name} className="ml-auto shrink-0" />
            </div>

            {rightTab === 'analysis' ? (
              <DeviceAnalysisPanel
                key={selectedId ?? 'overview'}
                equipment={selectedDevice}
                detail={detail}
                recipe={selectedRecipe}
                telemetry={telemetry}
                orders={recentOrders}
                loading={cardLoading}
                error={cardError}
                onFocus={() => selectedId && sceneRef.current?.focusDevice(selectedId)}
                onClose={clearSelection}
                onSelectOrder={(wo) => {
                  setActiveOrderCard(wo);
                  setRepairCardCollapsed(false);
                }}
                playing={playbackPlaying}
                playbackIndex={playbackIndex}
                onTogglePlayback={togglePlayback}
                onSeek={seekPlayback}
                onResetPlayback={resetPlayback}
                isExploded={explodedDeviceId !== null}
                isExplodedSupported={selectedId ? isExplodedViewSupported(selectedId) : false}
                onEnterExploded={enterExplodedView}
                onExitExploded={exitExplodedView}
                isExplodedAnimating={isExplodedAnimating}
                onDiagnosis={handleAiDiagnosis}
              />
            ) : (
              <div className="min-h-0 overflow-y-auto p-3 rounded-xl bg-slate-900/80 backdrop-blur border border-white/12 text-slate-200">
                <Section icon={Layers} title="设备密度">
              <Slider
                testId="deviceCount"
                value={params.deviceCount}
                min={4}
                max={Math.max(4, deviceInputs.length || 16)}
                step={1}
                onChange={(v) => patch({ deviceCount: v })}
                display={`${params.deviceCount} / ${deviceInputs.length || 16} 台`}
              />
              <Slider
                testId="spacing"
                value={params.spacing}
                min={0.7}
                max={1.6}
                step={0.05}
                onChange={(v) => patch({ spacing: v })}
                display={`间距 ${params.spacing.toFixed(2)}×`}
              />
            </Section>

            <Section icon={LayoutGrid} title="布局模式">
              <div className="grid grid-cols-3 gap-1">
                {LAYOUT_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => patch({ layout: o.key })}
                    className={`inline-flex flex-col items-center gap-1 py-1.5 rounded-md text-[10px] transition-colors ${
                      params.layout === o.key
                        ? 'bg-blue-500/25 text-blue-100 ring-1 ring-blue-400/50'
                        : 'bg-white/5 text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    <o.icon className="w-3.5 h-3.5" />
                    {o.label}
                  </button>
                ))}
              </div>
            </Section>

            <Section icon={Eye} title="视角预设">
              <div className="grid grid-cols-4 gap-1">
                {VIEW_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    data-view={o.key}
                    onClick={() => applyView(o.key)}
                    className="py-1.5 rounded-md text-[10px] bg-white/5 text-slate-300 hover:bg-white/10"
                    title={o.key === 'closeup' ? '特写当前选中设备' : undefined}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </Section>

            <Section icon={Sun} title="光照">
              <Slider
                value={params.exposure}
                min={0.6}
                max={1.6}
                step={0.05}
                onChange={(v) => patch({ exposure: v })}
                display={`强度 ${params.exposure.toFixed(2)}×`}
              />
            </Section>

            <Section icon={Waves} title="随机种子">
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  value={params.seed}
                  onChange={(e) => patch({ seed: Number(e.target.value) || 0 })}
                  className="flex-1 min-w-0 px-2 py-1 text-[11px] rounded-md bg-white/8 border border-white/12 text-slate-100 tabular-nums focus:outline-none focus:border-blue-400/60"
                />
                <button
                  type="button"
                  onClick={randomizeSeed}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded-md bg-white/8 text-slate-200 hover:bg-white/14"
                  title="重掷场景几何种子"
                >
                  <RotateCcw className="w-3 h-3" />
                  重掷
                </button>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                仅影响厂房几何与布局，不影响设备状态与颜色。
              </p>
            </Section>

            <Section icon={Grid3x3} title="显示">
              <div className="mb-1.5">
                <div className="text-[10px] text-slate-400 mb-1">厂房外壳</div>
                <div className="grid grid-cols-3 gap-1">
                  {SHELL_OPTIONS.map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      data-shell={o.key}
                      onClick={() => patch({ shell: o.key })}
                      title={o.hint}
                      className={`py-1.5 rounded-md text-[10px] transition-colors ${
                        params.shell === o.key
                          ? 'bg-blue-500/25 text-blue-100 ring-1 ring-blue-400/50'
                          : 'bg-white/5 text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <Toggle
                label="状态高亮（地面光环 / 异常光柱）"
                testId="highlight"
                checked={params.highlight}
                onChange={(v) => patch({ highlight: v })}
              />
              <Toggle
                label="地面参考网格"
                testId="grid"
                checked={params.showGrid}
                onChange={(v) => patch({ showGrid: v })}
              />
              {/* 以下四项与顶栏「可视化图层」开关组是同一组状态（同一份 useState），
                  两处入口保持一致；HUD 模式下本面板隐藏，用顶栏那一组。 */}
              <Toggle
                label="故障定位环（红色脉冲环）"
                testId="equipment3d-fault-locator-toggle"
                checked={showFaultLocator}
                onChange={setShowFaultLocator}
                icon={AlertTriangle}
              />
              <Toggle
                label="安全边界（许可圈 / LOTO 隔离罩）"
                testId="equipment3d-safety-boundary-toggle"
                checked={showSafetyBoundary}
                onChange={setShowSafetyBoundary}
                icon={Shield}
              />
              <Toggle
                label="人员动线（技师位置 / 移动轨迹）"
                testId="equipment3d-workers-toggle"
                checked={showWorkers}
                onChange={setShowWorkers}
                icon={User}
              />
              <Toggle
                label="介质内部流动（冷却水/润滑油/气流）"
                testId="equipment3d-fluid-toggle"
                checked={!!params.fluidFlow}
                onChange={(v) => patch({ fluidFlow: v })}
                icon={Waves}
              />
            </Section>
              </div>
            )}
          </div>
        )}

        {/* ---- 操作提示 ---- */}
        <div className="absolute bottom-3 right-3 px-2.5 py-1.5 rounded-lg bg-slate-900/62 backdrop-blur border border-white/10 text-[10px] text-slate-300 leading-relaxed">
          <div className="flex items-center gap-1.5">
            <Maximize2 className="w-3 h-3" />
            左键旋转 · 右键平移 · 滚轮缩放 · 点击设备聚焦 · Esc 返回总览
          </div>
        </div>

        {/* ---- 检修步骤卡片（含场景内工单操作：派单/接单/步骤勾选/完工上报/验收） ---- */}
        {activeOrderCard && (
          <RepairStepCard
            workOrder={activeOrderCard}
            collapsed={repairCardCollapsed && !!isolationId}
            onToggleCollapsed={() => setRepairCardCollapsed((v) => !v)}
            onClose={() => setActiveOrderCard(null)}
            currentUser={currentUser ? `${currentUser.name} (${currentUser.roleTitle})` : null}
            busy={orderActionBusy}
            actionError={orderActionError}
            initialCheckedCount={stepProgressRef.current.get(activeOrderCard.id) ?? 0}
            onDispatch={handleOrderDispatch}
            onClaim={handleOrderClaim}
            onComplete={handleOrderComplete}
            onAccept={handleOrderAccept}
            onStepProgress={handleStepProgress}
            onFocusDevice={() => {
              const eqId = activeOrderCard.equipmentId || (activeOrderCard as any).equipment_id;
              if (eqId) {
                sceneRef.current?.focusDevice(eqId);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

/* ========================= 小组件 ========================= */

function Chip({
  icon: Icon,
  label,
  value,
  metric,
  tone = 'default',
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  /** 供自动化验收脚本读取的稳定钩子（只读，不参与任何业务逻辑） */
  metric?: string;
  tone?: 'default' | 'warn' | 'danger';
}) {
  const toneCls =
    tone === 'danger'
      ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
      : tone === 'warn'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
        : 'border-slate-700 bg-slate-800 text-slate-200';
  return (
    <span
      data-metric={metric}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs ${toneCls}`}
    >
      <Icon className="w-3.5 h-3.5 opacity-70" />
      <span className="opacity-70">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="industrial-control-section mb-3 last:mb-0">
      <summary className="flex items-center gap-1.5 mb-1.5 text-[11px] font-semibold tracking-wide text-slate-300">
        <Icon className="w-3 h-3" />
        {title}
      </summary>
      <div className="space-y-1.5">{children}</div>
    </details>
  );
}

function Slider({
  value,
  min,
  max,
  step,
  onChange,
  display,
  testId,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display: string;
  testId?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
        <span className="tabular-nums">{display}</span>
      </div>
      <input
        type="range"
        aria-label={testId ?? display}
        data-slider={testId}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 rounded-full appearance-none bg-white/15 accent-blue-400 cursor-pointer"
      />
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  testId,
  icon: Icon,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-toggle={testId}
      aria-pressed={checked}
      data-checked={checked ? 'true' : 'false'}
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-2 text-[11px] text-slate-300 hover:text-slate-100"
    >
      <span className="text-left leading-tight flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3 shrink-0" />}
        {label}
      </span>
      <span
        className={`shrink-0 relative w-8 h-4 rounded-full transition-colors ${
          checked ? 'bg-blue-500' : 'bg-white/18'
        }`}
      >
        <span
          className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
            checked ? 'left-4' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
}
