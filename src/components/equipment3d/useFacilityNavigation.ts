/**
 * 三级层级导航（EquipmentScene.tsx 第五刀，2026-10-19）。
 *
 * 自持：厂区 / 车间 / 单设备三层在 React 侧的那一份真相（`level` 与它的 ref 镜像）、
 * 当前厂房、厂区总览的分区读数（`factoryZones` / `activeZoneId` / `rankMetric`），
 * 四个动作（切层 / 下钻厂房 / 选分区 / 换排名口径），以及「进厂区层要先 buildFactory、
 * 建完再回读分区」这两条同步 effect。
 *
 * 外部只给三样：引擎 ref、厂房与分区清单（由台账真实 workshop 字段算出）、
 * 宿主的 `clearSelection`。
 *
 * 刻意**没搬**的两处，避免本 hook 反向依赖选择链：
 *   - `handlePointerUp` 的三级拾取派发（zone / building / station / device 四个分支属于
 *     输入链），它直接用这里暴露的 `setActiveZoneId` / `setActiveBuilding` /
 *     `syncFactoryZones`；
 *   - 工单深链里「先把层级推进到车间、再聚焦设备」那段跨链编排（仍由宿主按顺序调
 *     `setActiveBuilding` + `setLevel`）。
 *
 * `runClearSelection` 是个转发函数而不是 `clearSelection` 本身：本 hook 的调用点必须
 * 留在宿主 1.8 节原位（原 buildFactory 那条 effect 的位置，仍早于第 2 节引擎挂载），
 * 而 `clearSelection` 声明在一千行之后 —— 直接把它的值传进来会在 render 期读到一个尚未初始化的 const（TDZ）。
 * hook 内部再用「最新值 ref」转发，于是 `changeLevel` / `drillIntoBuilding` 的回调身份
 * 恒定（旧实现里它们随 clearSelection 一起每轮换新），动作语义不变：这两个动作只在
 * 用户事件里发生，那时 ref 早已同步到最新的 clearSelection。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SceneLevel } from './scene';
import type {
  FactoryBuildingSpec,
  FactoryRankMetric,
  FactoryZoneSpec,
  FactoryZoneView,
} from './factoryOverviewTypes';

/**
 * 导航只用到引擎的这几扇门，因此不必依赖整个 EquipmentScene 类型。
 * 可选与否照搬宿主原来的调用写法（宿主用 `?.()` 的这里写可选、直接调用的写必选）：
 * 本仓 tsconfig 没开 strictNullChecks，所以这不是编译期保证，而是「测试替身缺方法时
 * 行为与切分前一致」的记账 —— 别把 `?.` 顺手改成直调。
 */
export interface FacilitySceneTarget {
  buildFactory?(specs?: FactoryBuildingSpec[], zones?: FactoryZoneSpec[], rankMetric?: FactoryRankMetric): void;
  enterFactoryLevel?(diveFromSky?: boolean): boolean;
  enterWorkshopLevel(): void;
  drillIntoBuilding(buildingId: string): void;
  factoryZones?(): FactoryZoneView[];
  selectZone?(zoneId: string | null): void;
  setFactoryRankMetric?(metric: FactoryRankMetric): void;
}

export interface FacilityNavigationOptions {
  ready: boolean;
  buildingSpecs: FactoryBuildingSpec[] | undefined;
  zoneSpecs: FactoryZoneSpec[] | undefined;
  sceneRef: { current: FacilitySceneTarget | null };
  runClearSelection: () => void;
}

export function useFacilityNavigation({
  ready,
  buildingSpecs,
  zoneSpecs,
  sceneRef,
  runClearSelection,
}: FacilityNavigationOptions) {
  // ---- 三级层级（厂区 / 车间 / 单设备）----
  const [level, setLevel] = useState<SceneLevel>('factory');
  /** 当前层级的镜像。`selectZone` 这类 useCallback 需要读"此刻"的层级，
   *  但又不能把 level 放进依赖（会把回调整体换新、连带重建下游 effect），故用 ref 镜像。 */
  const levelRef = useRef<SceneLevel>(level);
  useEffect(() => {
    levelRef.current = level;
  }, [level]);
  const [activeBuilding, setActiveBuilding] = useState<{ id: string; name: string } | null>(null);

  /** 最新值 ref：宿主每轮传新箭头，但动作只该在用户事件里读到"此刻"的实现。 */
  const clearSelectionRef = useRef(runClearSelection);
  useEffect(() => {
    clearSelectionRef.current = runClearSelection;
  });

  // 厂区总览层：厂房清单由台账真实 workshop 字段去重得出，初始进入厂区层
  const hasInitializedLevelRef = useRef(false);
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
  }, [ready, buildingSpecs, zoneSpecs, level, sceneRef]);

  /* ---------- 厂区总览：分区视图同步（3D → HUD） ---------- */
  const [factoryZones, setFactoryZones] = useState<FactoryZoneView[]>([]);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  /** 排名口径当前没人渲染（HUD 自己从 zones[0].rankMetric 取），但写入仍要触发一次
   *  重渲染，切分时照搬不删。 */
  const [rankMetric, setRankMetricState] = useState<FactoryRankMetric>('failureRate');

  const syncFactoryZones = useCallback(() => {
    const zs = sceneRef.current?.factoryZones?.() ?? [];
    setFactoryZones(zs);
    const m = zs[0]?.rankMetric;
    if (m) setRankMetricState(m);
    // sceneRef 是宿主 useRef 出来的稳定对象，列进依赖不会让回调换新
  }, [sceneRef]);

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
    [sceneRef, syncFactoryZones]
  );

  const changeRankMetric = useCallback(
    (metric: FactoryRankMetric) => {
      sceneRef.current?.setFactoryRankMetric?.(metric);
      setRankMetricState(metric);
      syncFactoryZones();
    },
    [sceneRef, syncFactoryZones]
  );

  /** 下钻进某个厂房：先清掉当前选中，再让引擎切层，React 侧同步记住进了哪间。 */
  const drillIntoBuilding = useCallback(
    (buildingId: string, buildingName?: string) => {
      const scene = sceneRef.current;
      if (!scene) return;
      clearSelectionRef.current();
      scene.drillIntoBuilding(buildingId);
      setActiveBuilding({ id: buildingId, name: buildingName ?? buildingId });
      setLevel('workshop');
    },
    [sceneRef]
  );

  /** HUD 面包屑切层：厂区 ↔ 车间（相机走既有阻尼插值，平滑不跳变）。 */
  const changeLevel = useCallback(
    (target: SceneLevel) => {
      const scene = sceneRef.current;
      if (!scene) return;
      if (target === 'factory') {
        clearSelectionRef.current();
        scene.enterFactoryLevel();
        setLevel('factory');
      } else {
        scene.enterWorkshopLevel();
        setLevel('workshop');
      }
    },
    [sceneRef]
  );

  return {
    level,
    setLevel,
    activeBuilding,
    setActiveBuilding,
    factoryZones,
    activeZoneId,
    setActiveZoneId,
    rankMetric,
    syncFactoryZones,
    selectZone,
    changeRankMetric,
    drillIntoBuilding,
    changeLevel,
  };
}
