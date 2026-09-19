// 五层下钻壳：全国地图(map) → 城市(city) → 厂区/车间/设备(factory，委托既有 Equipment3DView)。
// - URL 深链：?view=equipment_3d&level=city&factory=factory_gz（level=map 可省略）
// - 相机俯冲：各层开场由 createDampedOrbit 高空→取景收敛实现；厂区层沿用 scene.ts 既有阻尼轨道。
// - 面包屑：全国地图 → XX市 → XX工厂（车间/设备层级由 ProductionHUD 内部面包屑承接）。
// 数据纪律：厂区名/城市名来自 /api/v1/factories 真实接口。
import { useCallback, useEffect, useState } from "react";
import { factoryApi, type FactorySummary } from "../../api/factoryApi";
import { MapOverviewView } from "./MapOverview";
import { CityOverviewView } from "./CityOverview";
import { Equipment3DView } from "./EquipmentScene";
import "./equipment-industrial.css";

export type DrillLevel = "map" | "city" | "factory";

const DEFAULT_FACTORY_ID = "factory_gz";

function parseLevelFromUrl(): DrillLevel {
  const level = new URLSearchParams(window.location.search).get("level");
  if (level === "city" || level === "factory") return level;
  return "map";
}

export function Equipment3DShell({ initialWorkOrderId }: { initialWorkOrderId?: string | null }) {
  const [level, setLevel] = useState<DrillLevel>(() => parseLevelFromUrl());
  const [factory, setFactory] = useState<FactorySummary | null>(null);

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

  // URL 同步（pushState + popstate，浏览器前进/后退可回到对应层）
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

  const crumbs: { label: string; level: DrillLevel; active: boolean }[] = [
    { label: "全国地图", level: "map", active: level === "map" },
    { label: factory ? `${factory.city}` : "城市", level: "city", active: level === "city" },
    { label: factory ? factory.name : "厂区", level: "factory", active: level === "factory" },
  ];

  return (
    <div className="absolute inset-0">
      {level === "map" && <MapOverviewView onDrillCity={drillCity} />}
      {level === "city" && <CityOverviewView factory={factory} onEnterFactory={enterFactory} />}
      {level === "factory" && <Equipment3DView initialWorkOrderId={initialWorkOrderId} />}

      {/* 顶部面包屑（车间/设备层级由 ProductionHUD 内部面包屑承接） */}
      <div className="absolute left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-cyan-400/30 bg-[rgba(8,15,30,0.78)] px-2 py-1.5 text-xs backdrop-blur">
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
