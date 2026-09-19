// 五层下钻壳：全国地图(map) → 城市(city) → 厂区/车间/设备(factory，委托既有 Equipment3DView)。
// - 布局：壳根节点为常规文档流内的 relative 容器（填充 main 内容区），
//   三层均以 absolute inset-0 填充壳内——与其他页面一致，
//   侧边栏与顶栏天然不被遮挡（不再使用 fixed 全屏覆盖）。
// - 层间过渡：1.6s 交叉淡入淡出（easeInOutCubic + 轻微 scale 收敛模拟相机俯冲）。
// - 面包屑：全国地图 → XX市 → XX工厂（车间/设备层级由 ProductionHUD 内部面包屑承接）。
// 数据纪律：厂区名/城市名来自 /api/v1/factories 真实接口。
import { useCallback, useEffect, useState } from "react";
import { factoryApi, type FactorySummary } from "../../api/factoryApi";
import { MapOverviewView } from "./MapOverview";
import { CityOverviewView } from "./CityOverview";
import { Equipment3DView } from "./EquipmentScene";
import "./drilldown-transitions.css";
import "./equipment-industrial.css";

export type DrillLevel = "map" | "city" | "factory";

const DEFAULT_FACTORY_ID = "factory_gz";
/** 交叉淡入淡出总时长（ms），与 drilldown-transitions.css 的动画时序保持一致 */
const TRANSITION_MS = 1600;

function parseLevelFromUrl(): DrillLevel {
  const level = new URLSearchParams(window.location.search).get("level");
  if (level === "city" || level === "factory") return level;
  return "map";
}

export function Equipment3DShell({ initialWorkOrderId }: { initialWorkOrderId?: string | null }) {
  const [level, setLevel] = useState<DrillLevel>(() => parseLevelFromUrl());
  const [factory, setFactory] = useState<FactorySummary | null>(null);
  // 过渡状态：displayLevel 为当前渲染层；transition.from 为淡出中的旧层
  const [displayLevel, setDisplayLevel] = useState<DrillLevel>(() => parseLevelFromUrl());
  const [transition, setTransition] = useState<{ from: DrillLevel } | null>(null);

  // 层切换 → 交叉淡入淡出过渡（旧层淡出、新层淡入，TRANSITION_MS 后卸载旧层）
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

  const stageOf = (lvl: DrillLevel, keyPrefix: string) => (
    <div key={`${keyPrefix}-${lvl}`} className="absolute inset-0">
      {lvl === "map" && <MapOverviewView onDrillCity={drillCity} />}
      {lvl === "city" && <CityOverviewView factory={factory} onEnterFactory={enterFactory} />}
      {lvl === "factory" && <Equipment3DView initialWorkOrderId={initialWorkOrderId} />}
    </div>
  );

  const crumbs: { label: string; level: DrillLevel; active: boolean }[] = [
    { label: "全国地图", level: "map", active: level === "map" },
    { label: factory ? `${factory.city}` : "城市", level: "city", active: level === "city" },
    { label: factory ? factory.name : "厂区", level: "factory", active: level === "factory" },
  ];

  return (
    /* 常规文档流内的 relative 容器：填充 main 内容区（flex-1），
     * 侧边栏/顶栏由 App 正常布局承载，绝不被 3D 层覆盖 */
    <div className="relative h-full min-h-[620px] w-full">
      {/* 统一舞台：三层共用；深色科技蓝渐变底（与车间层风格一致，非纯黑） */}
      <div className="dd-sky absolute inset-0 overflow-hidden rounded-lg border border-white/10">
        {transition && (
          <div className="dd-stage-leaving absolute inset-0">{stageOf(transition.from, "leaving")}</div>
        )}
        <div className={transition ? "dd-stage-entering absolute inset-0" : "absolute inset-0"}>
          {stageOf(displayLevel, "current")}
        </div>
      </div>

      {/* 顶部面包屑（车间/设备层级由 ProductionHUD 内部面包屑承接） */}
      <div className="absolute left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-cyan-400/30 bg-[rgba(8,15,30,0.85)] px-2 py-1.5 text-xs backdrop-blur">
        {crumbs.map((c, i) => (
          <span key={c.level} className="flex items-center gap-1">
            {i > 0 && <span className="text-slate-600">›</span>}
            <button
              onClick={() => {
                if (c.level === "city" && !factory) return;
                setLevel(c.level);
              }}
              className={`rounded px-2 py-0.5 transition-colors ${c.active ? "bg-cyan-400/15 text-cyan-200" : "text-slate-400 hover:text-slate-200"}`}
            >
              {c.label}
              {factory?.isDemo && c.level === "factory" && <span className="ml-1 rounded bg-amber-400/15 px-1 text-[10px] text-amber-300">演示</span>}
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
