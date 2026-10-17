// 第二层 · 城市层（省域地形视图 + 该城市全部厂区光柱）。
// 渲染：与全国层共用 createMapScene（同一套起伏材质、灯光、描边、状态光柱与 bloom），
//       入场即从高空 2s easeInOutCubic 落位；点光柱先本地俯冲，再交给下钻壳切层。
// 数据纪律：厂区/设备/工单全部来自 /api/v1/factories?city=xxx 与该厂设备明细，
//       不使用 /factories 的 stats 聚合列（详见 mapStats 的 FactoryTruth 注释）。
import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, BellRing, Factory, MapPinned, Wrench } from "lucide-react";
import { factoryApi, type FactorySummary } from "../../api/factoryApi";
import { workOrderApi } from "../../api";
import {
  buildMapDashboard,
  factoryPillarStatusOf,
  onlineRateOf,
  statusRowsOf,
  toFactoryTruth,
  truthTotals,
  type EquipmentLike,
  type FactoryTruth,
  type OrderLike,
} from "./mapStats";
import {
  HUD_BOTTOM_BAND,
  HUD_COLUMN_MARGIN,
  HUD_COLUMN_SPAN,
  HUD_COLUMN_W,
  HUD_TOP_BAND,
  PILLAR_PALETTE,
  pillarPaletteOf,
} from "./mapStyle";
import { createMapScene, type MapMarkerSpec, type MapSceneHandle } from "./mapScene";
import { PROVINCE_CODE_BY_CITY, PROVINCE_VIEW_BY_CODE } from "./provinceViews";
import { BarRow, Dot, EmptyNote, HudPanel, Metric } from "./MapHud";
import { pillarSizeFor, ringsSpan, statusLabel } from "./mapGeo";
import "./equipment-industrial.css";
import "./drilldown-transitions.css";

/**
 * 俯冲下钻落点半径：足够贴近厂区，与第三层厂区俯瞰视角衔接。
 * frame.radius 只在拿不到画布尺寸时兜底 —— 正常情况下落位半径由 frameFit
 * 按内容包围盒与 HUD 安全区反解（见下），写死值会把省域地图缩成中间一小块。
 */
const CITY_CAMERA = {
  lift: { radius: 96, phi: 0.3 },
  frame: { radius: 30, phi: 0.62 },
  minRadius: 8,
  maxRadius: 110,
  diveRadius: 9,
};

/** 柱顶名称标签 sprite 的一半高度（世界单位），取景时叠加在光柱顶之上 */
const CITY_LABEL_ABOVE = 3;

/** 浮层安全区（像素）：左右两栏 + 顶部面包屑带 + 底部图例带，地图只填剩下的中间区域 */
const cityInsets = (leftInset: number) => ({
  // 一栏占位（外边距 + 卡宽）再留 12px 呼吸，与底部图例的 324 同一口径
  left: leftInset + HUD_COLUMN_SPAN + HUD_COLUMN_MARGIN,
  right: HUD_COLUMN_SPAN + HUD_COLUMN_MARGIN,
  top: HUD_TOP_BAND,
  bottom: HUD_BOTTOM_BAND,
});

/** 光柱：柱高/柱宽按省幅归一（与全国层同一口径），柱顶名称标签由 heightAbove 承担 */
function markerOf(row: FactoryTruth, maxCount: number, spanX: number): MapMarkerSpec {
  const share = maxCount > 0 ? row.equipmentCount / maxCount : 0;
  const { height, radius } = pillarSizeFor(spanX, share, row.isDemo);
  return {
    key: row.id,
    lng: row.lng,
    lat: row.lat,
    status: factoryPillarStatusOf(row),
    height,
    radius,
    label: row.name,
    sub: `设备 ${row.equipmentCount} · 故障 ${row.faultCount} · 告警 ${row.alertCount}`,
  };
}

export function CityOverviewView({
  leftInset = 0,
  factory,
  onEnterFactory,
}: {
  leftInset?: number;
  factory: FactorySummary | null;
  onEnterFactory: (factory: FactorySummary) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<MapSceneHandle | null>(null);
  const [sceneReady, setSceneReady] = useState(0);
  const city = factory?.city ?? "";
  const [rows, setRows] = useState<FactoryTruth[]>([]);
  const [devices, setDevices] = useState<{ id: string; status: string; healthScore?: number; workshop: string }[]>([]);
  const [orders, setOrders] = useState<OrderLike[]>([]);
  const [failed, setFailed] = useState(false);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [hoverNdc, setHoverNdc] = useState({ x: 0, y: 0 });

  const rowsRef = useRef<FactoryTruth[]>([]);
  rowsRef.current = rows;
  const summaryRef = useRef<Map<string, FactorySummary>>(new Map());
  const enterRef = useRef(onEnterFactory);
  enterRef.current = onEnterFactory;

  const code = city ? PROVINCE_CODE_BY_CITY[city] : undefined;
  const view = code ? PROVINCE_VIEW_BY_CODE[code] : undefined;
  /** 省幅（世界单位）：光柱的柱高/柱宽按它归一，不能沿用全国层的绝对值 */
  const spanX = useMemo(() => (view ? ringsSpan(view.fill, view.center, view.scale).x : 18), [view]);

  // 该城市全部厂区（列表与点位均为数组渲染，多工厂扩展天然支持）
  useEffect(() => {
    if (!city) return;
    let alive = true;
    (async () => {
      try {
        const list = await factoryApi.list(city);
        const details = await Promise.all(list.map((f) => factoryApi.getById(f.id)));
        const wo = (await workOrderApi.list({})) as OrderLike[];
        if (!alive) return;
        summaryRef.current = new Map(list.map((f) => [f.id, f]));
        setDevices(
          details.flatMap((d) =>
            d.equipments.map((e) => ({ id: e.id, status: e.status, healthScore: e.health_score, workshop: e.workshop }))
          )
        );
        setOrders(wo);
        setRows(
          list.map((f, i) =>
            toFactoryTruth(
              f,
              details[i].equipments.map((e) => ({ id: e.id, status: e.status, healthScore: e.health_score })),
              wo
            )
          )
        );
        setFailed(false);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [city]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !view) return;
    const handle = createMapScene({
      host,
      fillRings: view.fill,
      lineRings: view.line,
      center: view.center,
      scale: view.scale,
      relief: { height: 1.5, frequency: 6.2, segX: 150, segZ: 130 },
      camera: CITY_CAMERA,
      frameFit: { insets: cityInsets(leftInset), heightAbove: CITY_LABEL_ABOVE },
      flowBounds: { minX: -14, maxX: 14, minZ: -11, maxZ: 11 },
      onHover: (key, ndc) => {
        setHoverKey(key);
        setHoverNdc(ndc);
      },
      onPick: (key) => {
        const row = rowsRef.current.find((r) => r.id === key);
        const summary = summaryRef.current.get(key);
        if (!row || !summary) return;
        sceneRef.current?.diveTo(key, () => enterRef.current(summary));
      },
    });
    sceneRef.current = handle;
    setSceneReady((n) => n + 1);
    return () => {
      handle.dispose();
      sceneRef.current = null;
    };
    // 同一城市内厂区数据变化不重建舞台，只换点位；leftInset 是布局常量，变化时安全区要重算
  }, [view, city, leftInset]);

  useEffect(() => {
    if (sceneReady === 0) return;
    const max = rows.reduce((m, r) => Math.max(m, r.equipmentCount), 0);
    sceneRef.current?.setMarkers(rows.map((r) => markerOf(r, max, spanX)));
  }, [sceneReady, rows, spanX]);

  const dash = useMemo(
    () => (rows.length > 0 ? buildMapDashboard({ factoryRows: rows, devices, orders, now: Date.now() }) : null),
    [rows, devices, orders]
  );
  const totals = truthTotals(rows);
  const statusRows = statusRowsOf(devices);
  const onlineRate = onlineRateOf(devices);
  const maxStatusShare = statusRows.length > 0 ? statusRows[0].share : 0;
  // 车间构成：设备明细里的 workshop 字段是真实归属，城市层不重复造层级
  const workshopRows = useMemo(() => {
    const groups = new Map<string, EquipmentLike[]>();
    for (const d of devices) groups.set(d.workshop, [...(groups.get(d.workshop) ?? []), d]);
    const list = [...groups.entries()].map(([workshop, list]) => ({
      workshop,
      total: list.length,
      fault: list.filter((d) => d.status === "fault" || d.status === "overhauling").length,
      running: list.filter((d) => d.status === "running").length,
    }));
    const max = list.reduce((m, r) => Math.max(m, r.total), 0);
    return list.sort((a, b) => b.total - a.total).map((r) => ({ ...r, share: max > 0 ? r.total / max : 0 }));
  }, [devices]);

  const hoverRow = hoverKey ? rows.find((r) => r.id === hoverKey) ?? null : null;
  const hoverScreen = hoverRow
    ? { left: `${((hoverNdc.x + 1) / 2) * 100}%`, top: `${((1 - hoverNdc.y) / 2) * 100}%` }
    : null;

  return (
    <div className="dd-sky absolute inset-0 overflow-hidden">
      <div ref={hostRef} className="absolute inset-0" />
      <div className="absolute inset-0 z-20 pointer-events-none select-none">
        {/* 左侧：城市运营统计（真实台账）。顶部从面包屑带下方起排，避免与居中面包屑重叠 */}
        <div
          className="absolute bottom-3 flex flex-col gap-2 overflow-y-auto pb-1"
          style={{ left: leftInset + HUD_COLUMN_MARGIN, width: HUD_COLUMN_W, top: HUD_TOP_BAND }}
        >
          <HudPanel icon={MapPinned} title={`${city || "—"} · 城市运营`} aside={`厂区 ${totals.factoryCount || "—"}`}>
            <div className="grid grid-cols-2 gap-2">
              <Metric label="设备总数" value={rows.length > 0 ? totals.equipmentCount : failed ? "无数据" : null} />
              <Metric label="故障 / 检修" value={rows.length > 0 ? totals.faultCount : null} tone="rose" />
              <Metric label="未闭环工单" value={dash?.openOrders ?? null} tone="amber" />
              <Metric label="平均健康分" value={totals.avgHealth} tone="emerald" />
            </div>
            {failed && <EmptyNote>数据服务未响应，面板暂无读数</EmptyNote>}
          </HudPanel>

          <HudPanel icon={Factory} title="厂区列表" aside="点击光柱或条目进入厂区">
            <div className="space-y-1.5">
              {rows.length === 0 && <EmptyNote>{city ? "加载中…" : "未指定城市"}</EmptyNote>}
              {rows.map((f) => {
                const palette = pillarPaletteOf(factoryPillarStatusOf(f));
                return (
                  <button
                    key={f.id}
                    onClick={() => {
                      const summary = summaryRef.current.get(f.id);
                      if (!summary) return;
                      sceneRef.current?.diveTo(f.id, () => enterRef.current(summary));
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-md border border-white/5 bg-white/[0.03] px-2.5 py-2 text-left text-xs transition-colors hover:border-cyan-400/40 hover:bg-cyan-400/5"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-slate-200">
                      <Dot color={palette.css} />
                      <span className="truncate">{f.name}</span>
                      {f.isDemo && <span className="rounded bg-amber-400/15 px-1 text-[10px] text-amber-300">演示</span>}
                    </span>
                    <span className="hud-tabular-nums flex-none text-slate-400">{f.equipmentCount} 台</span>
                  </button>
                );
              })}
            </div>
          </HudPanel>

          <HudPanel icon={Activity} title="设备运行状态分布" aside={`在线率 ${onlineRate != null ? `${onlineRate}%` : "—"}`}>
            <div className="space-y-2">
              {statusRows.map((s) => (
                <BarRow key={s.key} label={s.label} value={`${s.count} 台`} share={maxStatusShare > 0 ? s.share / maxStatusShare : 0} color={s.css} />
              ))}
              {statusRows.length === 0 && <EmptyNote>暂无设备台账</EmptyNote>}
            </div>
          </HudPanel>
        </div>

        {/* 右侧：车间构成 + 城市工单闭环（同样下移到面包屑带之下） */}
        <div
          className="absolute right-3 bottom-3 flex flex-col gap-2 overflow-y-auto pb-1"
          style={{ width: HUD_COLUMN_W, top: HUD_TOP_BAND }}
        >
          <HudPanel icon={Wrench} title="车间 / 工段构成" aside={`${workshopRows.length} 个`}>
            <div className="space-y-2">
              {workshopRows.map((w) => (
                <BarRow
                  key={w.workshop}
                  label={w.workshop}
                  value={`${w.total} 台 · ${w.fault > 0 ? `${w.fault} 故障` : `运行 ${w.running}`}`}
                  share={w.share}
                  color={w.fault > 0 ? PILLAR_PALETTE.fault.css : PILLAR_PALETTE.normal.css}
                />
              ))}
              {workshopRows.length === 0 && <EmptyNote>暂无车间明细</EmptyNote>}
            </div>
          </HudPanel>

          <HudPanel icon={BellRing} title="城市告警概览" aside={`紧急 ${dash?.urgentOrders ?? "—"}`}>
            <div className="grid grid-cols-2 gap-2">
              <Metric label="今日新增报修" value={dash ? dash.todayOrders : null} tone="rose" />
              <Metric label="近 24 小时" value={dash ? dash.last24hOrders : null} tone="amber" />
              <Metric label="累计工单" value={dash?.totalOrders ?? null} tone="sky" />
              <Metric label="本厂设备告警" value={totals.alertCount} tone="amber" />
            </div>
            <div className="mt-2 text-[10px] leading-relaxed text-slate-500">
              累计/今日为全网真实读数；本厂设备告警按设备 ID 归属，只计该城市厂区名下的未闭环工单。
            </div>
          </HudPanel>

          <HudPanel icon={MapPinned} title="城市说明">
            <div className="space-y-1 text-[11px] leading-relaxed text-slate-400">
              <div>省域轮廓为真实行政区划边界，底面起伏是程序化渲染效果，不代表真实高程。</div>
              <div>光柱高度按设备台数归一，颜色取该厂真实故障/告警读数。</div>
            </div>
          </HudPanel>
        </div>

        {/* 底部图例 */}
        <div
          className="pointer-events-auto absolute bottom-3 flex items-center gap-3 rounded-lg hud-data-card dd-hud-card px-3 py-2 text-[11px] text-slate-400"
          style={{ left: leftInset + HUD_COLUMN_SPAN + HUD_COLUMN_MARGIN, right: HUD_COLUMN_SPAN + HUD_COLUMN_MARGIN }}
        >
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
          <span className="text-slate-600">单击光柱俯冲进入厂区</span>
        </div>

        {/* hover 小卡片 */}
        {hoverRow && hoverScreen && (
          <div
            className="pointer-events-none absolute z-30 w-60 rounded-lg border border-cyan-400/40 bg-[rgba(8,15,30,0.88)] p-3 shadow-[0_0_24px_rgba(34,211,238,0.18)] backdrop-blur"
            style={{ ...hoverScreen, transform: "translate(14px, -50%)" }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-cyan-100">{hoverRow.name}</span>
              {hoverRow.isDemo && <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-300">演示</span>}
            </div>
            <div className="mt-1 text-[11px] text-slate-300">{statusLabel(hoverRow.status)} · {hoverRow.city}</div>
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
          </div>
        )}
      </div>
    </div>
  );
}
