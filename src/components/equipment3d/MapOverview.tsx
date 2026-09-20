// 第一层 · 全国地图总览大屏（对标《智慧工业数字孪生可视化平台》0:03 / 0:15 / 1:50 帧）。
// 渲染：与城市层共用 createMapScene（同一套地形起伏材质、状态光柱、灯光与 bloom），
//       点光柱先跑 2s easeInOutCubic 真实相机俯冲，再由下钻壳交接图层，避免硬切。
// 数据纪律：面板读数全部由 /factories、/factories/:id 设备明细与 /work-orders 真实载荷推导；
//       系统未采集的运营指标（工业产值、研发投入、人员规模、出口额等）不在面板出现。
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Activity,
  BellRing,
  Factory,
  GaugeCircle,
  MapPinned,
  TrendingUp,
  Wrench,
} from "lucide-react";
import { CHINA_FILL_RINGS, CHINA_LINE_RINGS } from "./mapData/chinaOutline";
import { factoryApi, type FactorySummary } from "../../api/factoryApi";
import { workOrderApi } from "../../api";
import {
  buildMapDashboard,
  factoryPillarStatusOf,
  toFactoryTruth,
  type EquipmentLike,
  type FactoryTruth,
  type MapDashboard,
  type OrderLike,
} from "./mapStats";
import { MAJOR_CITIES, PILLAR_PALETTE, pillarPaletteOf } from "./mapStyle";
import { createMapScene, type MapMarkerSpec, type MapSceneHandle } from "./mapScene";
import { BarRow, Dot, EmptyNote, HudPanel, Metric, TrendChart } from "./MapHud";
import { statusDotColor, statusLabel } from "./mapGeo";
import "./equipment-industrial.css";
import "./drilldown-transitions.css";

const CHINA_CENTER: [number, number] = [104, 37];
const CHINA_SCALE = 0.92;

const greetWord = (hour: number) => (hour < 6 ? "Good Night" : hour < 12 ? "Good Morning" : hour < 18 ? "Good Afternoon" : "Good Evening");

/** 厂区真实台账 → 光柱参数：柱高随设备台数增长，颜色由故障/告警数决定 */
function markerOf(row: FactoryTruth, maxCount: number): MapMarkerSpec {
  const share = maxCount > 0 ? row.equipmentCount / maxCount : 0;
  const height = 4.4 + 4.6 * share;
  return {
    key: row.id,
    lng: row.lng,
    lat: row.lat,
    status: factoryPillarStatusOf(row),
    height: row.isDemo ? height * 0.86 : height,
    radius: row.isDemo ? 0.64 : 0.86,
    label: row.name,
    sub: `设备 ${row.equipmentCount} · 故障 ${row.faultCount} · 告警 ${row.alertCount}`,
  };
}

export function MapOverviewView({
  leftInset = 0,
  onDrillCity,
}: {
  leftInset?: number;
  onDrillCity: (factory: FactorySummary) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<MapSceneHandle | null>(null);
  const [sceneReady, setSceneReady] = useState(0);
  const [rows, setRows] = useState<FactoryTruth[]>([]);
  const [devices, setDevices] = useState<EquipmentLike[]>([]);
  const [orders, setOrders] = useState<OrderLike[]>([]);
  const [failed, setFailed] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [clock, setClock] = useState(() => new Date());
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [hoverNdc, setHoverNdc] = useState({ x: 0, y: 0 });
  const [leftTab, setLeftTab] = useState<"factory" | "status">("factory");

  const rowsRef = useRef<FactoryTruth[]>([]);
  rowsRef.current = rows;
  const summaryRef = useRef<Map<string, FactorySummary>>(new Map());
  const drillRef = useRef(onDrillCity);
  drillRef.current = onDrillCity;

  // 真实数据：厂区列表 → 逐厂设备明细 → 未闭环工单归属（一次拉齐，避免高频打接口）
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await factoryApi.list();
        const details = await Promise.all(list.map((f) => factoryApi.getById(f.id)));
        const wo = (await workOrderApi.list({})) as OrderLike[];
        if (!alive) return;
        summaryRef.current = new Map(list.map((f) => [f.id, f]));
        const deviceRows = details.flatMap((d) =>
          d.equipments.map((e) => ({ id: e.id, status: e.status, healthScore: e.health_score }))
        );
        setDevices(deviceRows);
        setOrders(wo);
        setRows(list.map((f, i) => toFactoryTruth(f, details[i].equipments.map((e) => ({ id: e.id, status: e.status, healthScore: e.health_score })), wo)));
        setFailed(false);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 时钟 1s 一跳；趋势/今日口径 60s 重算一次（不重复请求接口）
  useEffect(() => {
    const tick = window.setInterval(() => setClock(new Date()), 1000);
    const roll = window.setInterval(() => setNowMs(Date.now()), 60000);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(roll);
    };
  }, []);

  const dash: MapDashboard | null = useMemo(
    () => (rows.length > 0 ? buildMapDashboard({ factoryRows: rows, devices, orders, now: nowMs }) : null),
    [rows, devices, orders, nowMs]
  );

  // 舞台挂载一次（全国层与城市层走同一条渲染路径，保证风格一致）
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handle = createMapScene({
      host,
      fillRings: CHINA_FILL_RINGS,
      lineRings: CHINA_LINE_RINGS,
      center: CHINA_CENTER,
      scale: CHINA_SCALE,
      relief: { height: 2.6, frequency: 7.2 },
      camera: {
        lift: { radius: 148, phi: 0.3 },
        frame: { radius: 62, phi: 0.62 },
        minRadius: 18,
        maxRadius: 165,
        diveRadius: 15,
      },
      flowBounds: { minX: -26, maxX: 26, minZ: -18, maxZ: 14 },
      onHover: (key, ndc) => {
        setHoverKey(key);
        setHoverNdc(ndc);
      },
      onPick: (key) => {
        const row = rowsRef.current.find((r) => r.id === key);
        const summary = summaryRef.current.get(key);
        if (!row || !summary) return;
        sceneRef.current?.diveTo(key, () => drillRef.current(summary));
      },
    });
    sceneRef.current = handle;
    // 主要城市名称标注：厂区所在城市由光柱标签承担，避免同名文字重叠
    handle.setLabels(MAJOR_CITIES.filter((c) => !c.plant).map((c) => ({ text: c.name, lng: c.lng, lat: c.lat })));
    setSceneReady((n) => n + 1);
    return () => {
      handle.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (sceneReady === 0) return;
    const max = rows.reduce((m, r) => Math.max(m, r.equipmentCount), 0);
    sceneRef.current?.setMarkers(rows.map((r) => markerOf(r, max)));
  }, [sceneReady, rows]);

  const hoverRow = hoverKey ? rows.find((r) => r.id === hoverKey) ?? null : null;
  const hoverScreen = hoverRow
    ? { left: `${((hoverNdc.x + 1) / 2) * 100}%`, top: `${((1 - hoverNdc.y) / 2) * 100}%` }
    : null;
  const totals = dash?.totals ?? null;
  const maxStatusShare = dash && dash.statusRows.length > 0 ? dash.statusRows[0].share : 0;
  const completionRate = dash && dash.totalOrders > 0 ? Math.round((dash.completedOrders / dash.totalOrders) * 1000) / 10 : null;

  return (
    <div className="dd-sky absolute inset-0 overflow-hidden">
      <div ref={hostRef} className="absolute inset-0" />
      <div className="absolute inset-0 z-20 pointer-events-none select-none">
        {/* 左侧：总体运营 + 区域分布 + 厂区/状态切换 */}
        <div className="absolute top-3 bottom-3 flex w-[300px] flex-col gap-2 overflow-y-auto pb-1" style={{ left: leftInset + 12 }}>
          <HudPanel icon={Factory} title="总体运营指标 · 设备总数" aside={`厂区 ${totals?.factoryCount ?? "—"}`}>
            <div className="flex items-end justify-between gap-2">
              <div className="hud-value-glow hud-tabular-nums text-[40px] font-semibold leading-none text-cyan-100">
                {totals ? totals.equipmentCount : failed ? "无数据" : "—"}
              </div>
              <div className="pb-1 text-right text-[11px] leading-relaxed">
                <div className="flex items-center justify-end gap-1.5 text-rose-300/90">
                  <AlertTriangle className="h-3 w-3" /> 故障 {totals?.faultCount ?? "—"}
                </div>
                <div className="flex items-center justify-end gap-1.5 text-amber-300/90">
                  <BellRing className="h-3 w-3" /> 告警 {totals?.alertCount ?? "—"}
                </div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Metric size="sm" label="平均健康分" value={totals?.avgHealth ?? null} tone="emerald" />
              <Metric size="sm" label="工单总数" value={dash?.totalOrders ?? null} tone="sky" />
            </div>
            {failed && <EmptyNote>数据服务未响应，面板暂无读数</EmptyNote>}
          </HudPanel>

          <HudPanel icon={MapPinned} title="设备区域分布" aside="按台数">
            <div className="space-y-2">
              {dash?.regionRows.map((r) => (
                <BarRow key={r.region} label={r.region} value={`${r.equipmentCount} 台`} share={r.share} color={PILLAR_PALETTE.normal.css} />
              ))}
              {!dash && <EmptyNote>{failed ? "数据服务未响应" : "加载中…"}</EmptyNote>}
            </div>
          </HudPanel>

          <HudPanel
            icon={leftTab === "factory" ? Factory : Activity}
            title={leftTab === "factory" ? "重点厂区" : "设备运行状态分布"}
            className="flex-1"
            aside={
              <span className="flex gap-1">
                {(["factory", "status"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setLeftTab(t)}
                    className={`rounded px-1.5 py-0.5 text-[10px] tracking-normal transition-colors ${
                      leftTab === t ? "bg-cyan-400/15 text-cyan-200" : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {t === "factory" ? "厂区" : "状态"}
                  </button>
                ))}
              </span>
            }
          >
            {leftTab === "factory" ? (
              <div className="space-y-2">
                {dash?.factoryRows.map((f) => {
                  const palette = pillarPaletteOf(factoryPillarStatusOf(f));
                  return (
                    <BarRow
                      key={f.id}
                      label={f.name}
                      tag={f.isDemo ? <span className="rounded bg-amber-400/15 px-1 text-[9px] text-amber-300">演示</span> : null}
                      value={`${f.equipmentCount} 台 · ${f.alertCount} 告警`}
                      share={f.share}
                      color={palette.css}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2">
                {dash?.statusRows.map((s) => (
                  <BarRow key={s.key} label={s.label} value={`${s.count} 台`} share={s.share} color={s.css} />
                ))}
              </div>
            )}
          </HudPanel>
        </div>

        {/* 右侧：报修闭环 + 在线率 + 真实趋势 */}
        <div className="absolute right-3 top-3 bottom-3 flex w-[300px] flex-col gap-2 overflow-y-auto pb-1">
          <div className="pointer-events-auto hud-data-card dd-hud-card dd-hud-panel rounded-lg">
            <div className="flex items-baseline justify-between">
              <span className="text-base font-semibold text-cyan-100">{greetWord(clock.getHours())}</span>
              <span className="hud-tabular-nums text-[11px] text-slate-300">
                {clock.toLocaleDateString("zh-CN")} {clock.toLocaleTimeString("zh-CN", { hour12: false })}
              </span>
            </div>
          </div>

          <HudPanel icon={Wrench} title="检修工单闭环" aside={`紧急 ${dash?.urgentOrders ?? "—"}`}>
            <div className="grid grid-cols-2 gap-2">
              <Metric label="今日新增报修" value={dash ? dash.todayOrders : failed ? "无数据" : null} tone="rose" />
              <Metric label="近 24 小时报修" value={dash ? dash.last24hOrders : null} tone="amber" />
              <Metric label="未闭环工单" value={dash?.openOrders ?? null} tone="sky" />
              <Metric label="归档完成率" value={completionRate != null ? `${completionRate}%` : null} tone="emerald" />
            </div>
            <div className="mt-2 text-[10px] text-slate-500">
              {dash && dash.last24hOrders === 0 ? "近 24 小时无新增报修（真实读数，非未接入）" : `累计 ${dash?.totalOrders ?? "—"} 单 · 完成 ${dash?.completedOrders ?? "—"} 单`}
            </div>
          </HudPanel>

          <HudPanel icon={GaugeCircle} title="设备在线率" aside={`运行 ${dash ? dash.statusRows.find((s) => s.key === "running")?.count ?? 0 : "—"} 台`}>
            <div className="flex items-end gap-3">
              <div className="hud-value-glow hud-tabular-nums text-[34px] font-semibold leading-none text-emerald-300">
                {dash?.onlineRate != null ? `${dash.onlineRate}` : "—"}
                {dash?.onlineRate != null && <span className="ml-0.5 text-xs font-normal text-slate-500">%</span>}
              </div>
              <div className="flex-1 space-y-1.5 pb-1">
                {dash?.statusRows.slice(0, 4).map((s) => (
                  <BarRow key={s.key} label={s.label} value={s.count} share={maxStatusShare > 0 ? s.share / maxStatusShare : 0} color={s.css} />
                ))}
              </div>
            </div>
            <div className="mt-1.5 text-[10px] text-slate-500">口径：运行台数 / 台账台数，预警与检修不计入在线</div>
          </HudPanel>

          <HudPanel icon={TrendingUp} title={`报修趋势 · 近 ${dash?.trend.length ?? 14} 天`} aside="按创建日归集">
            {dash?.trendHasData ? <TrendChart buckets={dash.trend} /> : <EmptyNote>近 14 天窗口外无报修记录</EmptyNote>}
          </HudPanel>
        </div>

        {/* 底部：工厂分布条 + 光柱图例（与 3D 状态色同一口径） */}
        <div
          className="pointer-events-auto absolute bottom-3 flex items-center gap-3 rounded-lg hud-data-card dd-hud-card px-3 py-2"
          style={{ left: leftInset + 324, right: 324 }}
        >
          <div className="flex flex-1 items-end gap-4">
            {(dash?.factoryRows ?? []).map((f) => {
              const color = pillarPaletteOf(factoryPillarStatusOf(f)).css;
              return (
                <div key={f.id} className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[11px] text-slate-300">{f.name}</span>
                    <span className="hud-tabular-nums flex-none text-[11px] text-slate-400">{f.equipmentCount} 台</span>
                  </div>
                  <div className="dd-bar-track mt-1">
                    <div
                      className="dd-bar-fill"
                      style={{ width: `${Math.max(3, Math.min(1, f.share) * 100)}%`, background: color, boxShadow: `0 0 6px ${color}66` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-none items-center gap-3 border-l border-white/10 pl-3 text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <Dot color={PILLAR_PALETTE.normal.css} />
              正常
            </span>
            <span className="flex items-center gap-1.5">
              <Dot color={PILLAR_PALETTE.alert.css} />
              告警
            </span>
            <span className="flex items-center gap-1.5">
              <Dot color={PILLAR_PALETTE.fault.css} />
              故障
            </span>
            <span className="text-slate-600">柱高＝设备台数</span>
          </div>
        </div>

        {/* hover 小卡片：厂区名称 + 设备数 + 故障数（真实台账） */}
        {hoverRow && hoverScreen && (
          <div
            className="pointer-events-none absolute z-30 w-60 rounded-lg border border-cyan-400/40 bg-[rgba(8,15,30,0.88)] p-3 shadow-[0_0_24px_rgba(34,211,238,0.18)] backdrop-blur"
            style={{ ...hoverScreen, transform: "translate(14px, -50%)" }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-cyan-100">{hoverRow.name}</span>
              {hoverRow.isDemo && <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-300">演示</span>}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-300">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: statusDotColor(hoverRow.status) }} />
              {statusLabel(hoverRow.status)} · {hoverRow.region} · {hoverRow.city}
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <span className="text-slate-500">设备数</span>
              <span className="hud-tabular-nums text-right">{hoverRow.equipmentCount} 台</span>
              <span className="text-slate-500">故障 / 检修</span>
              <span className="hud-tabular-nums text-right text-rose-300">{hoverRow.faultCount} 台</span>
              <span className="text-slate-500">未闭环工单</span>
              <span className="hud-tabular-nums text-right text-amber-200">{hoverRow.alertCount} 单</span>
              <span className="text-slate-500">平均健康分</span>
              <span className="hud-tabular-nums text-right text-emerald-300">{hoverRow.avgHealth ?? "—"}</span>
            </div>
            <div className="mt-1.5 border-t border-white/10 pt-1.5 text-[10px] text-slate-500">单击光柱俯冲下钻至城市层</div>
          </div>
        )}
      </div>
    </div>
  );
}
