// 五层下钻壳：全国地图(map) → 城市(city) → 厂区/车间/设备(factory，委托既有 Equipment3DView)。
// - 布局：壳根节点为常规文档流内的 relative 容器（填充 main 内容区），
//   三层均以 absolute inset-0 填充壳内——与其他页面一致，
//   侧边栏与顶栏天然不被遮挡（不再使用 fixed 全屏覆盖）。
// - 层间过渡：俯冲是真实相机运动，发生在「离开层」内部（createMapScene.diveTo，
//   DIVE_MS=2s、easeInOutCubic，其余光柱与标注同步淡出）；到达最大缩放后才交接图层，
//   壳这里只承担最后 0.65s 的交叉淡入淡出，新层再自高空阻尼落位 → 全程无硬切。
// - 面包屑：一条路径条承载完整下钻链路——全国地图 → XX市 → XX工厂 →（车间 → 单设备，
//   由厂区层把地图轴 mapTrail 接在自己的工具栏里）。2026-09-23 起 ProductionHUD 不再自带
//   第二条面包屑；厂区层在画布上时，壳这条绝对定位的路径条让位给它，避免叠两份。
// 数据纪律：厂区名/城市名来自 /api/v1/factories 真实接口。
import { useCallback, useEffect, useState } from "react";
import { factoryApi, type FactorySummary } from "../../api/factoryApi";
import { MapOverviewView } from "./MapOverview";
import { CityOverviewView } from "./CityOverview";
import { Equipment3DView } from "./EquipmentScene";
import { DrillTrail, type DrillCrumbNode } from "./DrillTrail";
import type { WorkOrderCreatePrefill } from "../../types";
import type { SpareProcurePrefill } from "../../api";
import "./drilldown-transitions.css";
import "./equipment-industrial.css";

export type DrillLevel = "map" | "city" | "factory";

const DEFAULT_FACTORY_ID = "factory_gz";
/** 旧层淡出 + 新层淡入的收尾时长（ms），与 drilldown-transitions.css 的动画时序一致；
 *  2s 相机俯冲在此之前于旧层内跑完，不计入本值 */
const TRANSITION_MS = 800;

function parseLevelFromUrl(): DrillLevel {
  const level = new URLSearchParams(window.location.search).get("level");
  if (level === "city" || level === "factory") return level;
  return "map";
}

export function Equipment3DShell({
  initialWorkOrderId,
  onOpenWorkOrderDetail,
  onNavigateToWorkOrderCreate,
  onNavigateToSpareProcure,
}: {
  initialWorkOrderId?: string | null;
  /** 拆解侧栏「返回工单详情」回调，原样透传给 Equipment3DView（App 收尾联动工单抽屉） */
  onOpenWorkOrderDetail?: (workOrderId: string) => void;
  /** 拆解故障面板「创建维修工单」回调，原样透传给 Equipment3DView（App 切工单页并预填） */
  onNavigateToWorkOrderCreate?: (prefill: WorkOrderCreatePrefill) => void;
  /** 拆解库存面板「一键生成采购申请」回调，原样透传给 Equipment3DView（App 切备件库存页并预填） */
  onNavigateToSpareProcure?: (prefill: SpareProcurePrefill) => void;
}) {
  const [level, setLevel] = useState<DrillLevel>(() => parseLevelFromUrl());
  const [factory, setFactory] = useState<FactorySummary | null>(null);
  // 过渡状态：displayLevel 为当前层；transition.from 为正在淡出的旧层（两层并行 650ms）
  const [displayLevel, setDisplayLevel] = useState<DrillLevel>(() => parseLevelFromUrl());
  const [transition, setTransition] = useState<{ from: DrillLevel } | null>(null);

  // 层切换 → 旧层淡出 / 新层淡入收尾（旧层的 2s 相机俯冲在此之前已跑完）
  useEffect(() => {
    if (level === displayLevel) return;
    setTransition({ from: displayLevel });
    setDisplayLevel(level);
    const timer = window.setTimeout(() => setTransition(null), TRANSITION_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  // 深链/刷新恢复：按 URL 的 factory 参数拉取厂区名与城市
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fid = params.get("factory") ?? (parseLevelFromUrl() === "factory" ? DEFAULT_FACTORY_ID : null);
    if (!fid) return;
    let alive = true;
    factoryApi
      .getById(fid)
      .then((detail) => {
        if (!alive) return;
        setFactory({
          id: detail.id,
          name: detail.name,
          city: detail.city,
          region: detail.region,
          geo: detail.geo,
          address: detail.address,
          status: detail.status,
          isDemo: detail.isDemo,
          stats: detail.stats,
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // URL 同步（replaceState + popstate，浏览器前进/后退可回到对应层）
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "equipment_3d");
    if (level === "map") {
      url.searchParams.delete("level");
      url.searchParams.delete("factory");
    } else {
      url.searchParams.set("level", level);
      const fid = factory?.id ?? DEFAULT_FACTORY_ID;
      url.searchParams.set("factory", fid);
    }
    window.history.replaceState(window.history.state, "", url.toString());
  }, [level, factory?.id]);

  useEffect(() => {
    const onPop = () => setLevel(parseLevelFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const drillCity = useCallback((f: FactorySummary) => {
    setFactory(f);
    setLevel("city");
  }, []);

  const enterFactory = useCallback((f: FactorySummary) => {
    setFactory(f);
    setLevel("factory");
  }, []);

  /**
   * 地图轴三级。厂区层拿到它之后接上自己的「车间 / 单设备」两级，
   * 顶部那条下钻路径全程只有一处（2026-09-23 用户「太拥挤了」：原来地图轴浮在工具栏正中、
   * 厂区轴挤在大屏栏左侧，同一行两条面包屑、当前层级名写两遍）。
   */
  const mapTrail: DrillCrumbNode[] = [
    { key: "map", label: "全国地图", active: level === "map", onGo: () => setLevel("map") },
    { key: "city", label: factory ? `${factory.city}` : "城市", active: level === "city", onGo: factory ? () => setLevel("city") : undefined },
    {
      key: "factory",
      label: factory ? factory.name : "厂区",
      active: level === "factory",
      onGo: factory ? () => setLevel("factory") : undefined,
      badge: factory?.isDemo ? "演示" : undefined,
    },
  ];

  /** key 只用层级名：过渡期间旧层只是换 className，不会被 React 卸载重建（避免重建 WebGL 场景） */
  const stageOf = (lvl: DrillLevel) => (
    <div key={lvl} className={lvl === transition?.from ? "dd-stage-leaving absolute inset-0" : transition ? "dd-stage-entering absolute inset-0" : "absolute inset-0"}>
      {lvl === "map" && <MapOverviewView onDrillCity={drillCity} />}
      {lvl === "city" && <CityOverviewView factory={factory} onEnterFactory={enterFactory} />}
      {lvl === "factory" && <Equipment3DView initialWorkOrderId={initialWorkOrderId} onOpenWorkOrderDetail={onOpenWorkOrderDetail} onNavigateToWorkOrderCreate={onNavigateToWorkOrderCreate} onNavigateToSpareProcure={onNavigateToSpareProcure} mapTrail={mapTrail} />}
    </div>
  );

  const visibleLevels: DrillLevel[] = transition ? [transition.from, displayLevel] : [displayLevel];

  // 厂区层把路径条放进自己的工具栏（正常文档流），壳这边就不再叠一份
  const showsFactory = visibleLevels.includes("factory");

  return (
    /* 常规文档流内的 relative 容器：填充 main 内容区（flex-1），
     * 侧边栏/顶栏由 App 正常布局承载，绝不被 3D 层覆盖 */
    <div className="relative flex-1 h-[calc(100vh-160px)] min-h-[620px] w-full">
      {/* 统一舞台：三层共用；深色科技蓝渐变底（带 16px 大圆角与柔和外阴影卡片） */}
      <div className="dd-sky absolute inset-0 overflow-hidden">
        {visibleLevels.map((lvl) => stageOf(lvl))}
      </div>

      {/* 全国 / 城市两层没有工具栏，路径条由壳绝对定位在画布水平正中（用户验收口径
          「面包屑放屏幕正中央」）；这两层下面没有别的控件，居中悬着不会压到任何东西。 */}
      {!showsFactory && (
        <div className="absolute left-1/2 top-3 z-40 max-w-[calc(100%-24px)] -translate-x-1/2">
          <DrillTrail nodes={mapTrail} />
        </div>
      )}
    </div>
  );
}
