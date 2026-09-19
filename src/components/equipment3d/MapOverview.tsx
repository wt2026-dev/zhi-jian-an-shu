// 第一层 · 全国地图总览大屏（对标《智慧工业数字孪生可视化平台》0:03/0:15/1:50 帧）。
// 数据纪律：厂区/设备/故障/告警全部来自 /api/v1/factories* 真实聚合；
// 工业产值、研发投入、人员规模等运营指标系统未接入，一律显示「未接入」。
// 纯加法：本组件自带独立 three 场景，不改动 scene.ts 既有车间层。
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { CHINA_FILL_RINGS, CHINA_LINE_RINGS } from "./mapData/chinaOutline";
import { factoryApi, type FactoryGeoSummary, type FactorySummary } from "../../api/factoryApi";
import { workOrderApi } from "../../api";
import type { WorkOrder } from "../../types";
import {
  MAP_BG,
  buildBorderLines,
  buildFillMesh,
  buildMapGround,
  createDampedOrbit,
  createLightPillar,
  projectLngLat,
  statusDotColor,
  statusLabel,
  type LightPillar,
} from "./mapGeo";
import "./equipment-industrial.css";

const CHINA_CENTER: [number, number] = [104, 37];
const CHINA_SCALE = 0.92;

interface PillarEntry {
  factory: FactorySummary;
  pillar: LightPillar;
}

interface HoverCard {
  factory: FactorySummary;
  x: number;
  y: number;
}

function greetWord(hour: number): string {
  if (hour < 6) return "Good Night";
  if (hour < 12) return "Good Morning";
  if (hour < 18) return "Good Afternoon";
  return "Good Evening";
}

function NotConnected({ label }: { label?: string }) {
  return (
    <span className="text-[11px] text-slate-500" title={label ? `${label}：系统暂未接入该指标` : "系统暂未接入该指标"}>
      未接入
    </span>
  );
}

export function MapOverviewView({ leftInset = 0, onDrillCity }: { leftInset?: number; onDrillCity: (factory: FactorySummary) => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [factories, setFactories] = useState<FactorySummary[]>([]);
  const [summary, setSummary] = useState<FactoryGeoSummary | null>(null);
  const [anomaly, setAnomaly] = useState<{ today: number; total: number } | null>(null);
  const [hover, setHover] = useState<HoverCard | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [leftTab, setLeftTab] = useState("图分析");
  const [topTab, setTopTab] = useState("数据统计");
  const hoverRef = useRef<PillarEntry | null>(null);
  const drillRef = useRef(onDrillCity);
  drillRef.current = onDrillCity;

  // 真实数据：厂区列表 + 全国聚合 + 工单异常（今日/累计）
  useEffect(() => {
    let alive = true;
    factoryApi.geoSummary().then((s) => alive && setSummary(s)).catch(() => {});
    factoryApi.list().then((list) => alive && setFactories(list)).catch(() => {});
    workOrderApi
      .list({})
      .then((orders: WorkOrder[]) => {
        if (!alive) return;
        const today = new Date().toISOString().slice(0, 10);
        const todayCount = orders.filter((o) => (o.createdAt || "").slice(0, 10) === today).length;
        setAnomaly({ today: todayCount, total: orders.length });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setClearColor(MAP_BG);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(MAP_BG, 0.0075);
    const camera = new THREE.PerspectiveCamera(55, host.clientWidth / host.clientHeight, 0.1, 600);

    // 地面网格 + 全国轮廓（线框 + 深色半透明填充）
    scene.add(buildMapGround(160));
    const fill = buildFillMesh(CHINA_FILL_RINGS, { color: 0x0e2033, opacity: 0.82, center: CHINA_CENTER, scale: CHINA_SCALE });
    const border = buildBorderLines(CHINA_LINE_RINGS, { color: 0x36d3f0, opacity: 0.5, center: CHINA_CENTER, scale: CHINA_SCALE });
    const innerBorder = buildBorderLines(CHINA_LINE_RINGS, { color: 0x0b2c44, opacity: 0.9, center: CHINA_CENTER, scale: CHINA_SCALE });
    innerBorder.position.y = -0.002;
    scene.add(fill, border, innerBorder);

    // 相机：开场从高空俯冲拉近（指数阻尼），等距俯视
    const orbit = createDampedOrbit(camera, renderer.domElement, {
      theta: 0,
      phi: 0.35,
      radius: 118,
      damping: 1.9,
      minRadius: 14,
      maxRadius: 150,
    });
    orbit.target.radius = 46;
    orbit.target.phi = 0.62;

    // 光柱：厂区列表驱动（广州主厂最高最亮，演示分厂稍小）
    let pillars: PillarEntry[] = [];
    const pillarGroup = new THREE.Group();
    scene.add(pillarGroup);
    factoryApi
      .list()
      .then((list) => {
        if (disposed) return;
        for (const f of list) {
          const isMain = !f.isDemo;
          const pillar = createLightPillar({ height: isMain ? 9 : 5.2, radius: isMain ? 0.85 : 0.6 });
          const [px, pz] = projectLngLat(f.geo.lng, f.geo.lat, CHINA_CENTER, CHINA_SCALE);
          pillar.group.position.set(px, 0.02, pz);
          pillarGroup.add(pillar.group);
          pillars.push({ factory: f, pillar });
        }
      })
      .catch(() => {});

    // hover 拾取（光柱）
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDirty = false;
    let downAt = 0;
    let downXY = [0, 0];
    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      pointerDirty = true;
    };
    const onPointerDown = (e: PointerEvent) => {
      downAt = performance.now();
      downXY = [e.clientX, e.clientY];
    };
    const onPointerUp = (e: PointerEvent) => {
      const dx = e.clientX - downXY[0];
      const dy = e.clientY - downXY[1];
      if (performance.now() - downAt < 600 && dx * dx + dy * dy < 36 && hoverRef.current) {
        drillRef.current(hoverRef.current.factory);
      }
    };
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    const clock3d = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      if (disposed) return;
      const dt = Math.min(clock3d.getDelta(), 0.1);
      const t = clock3d.elapsedTime;
      orbit.update(dt);
      for (const p of pillars) p.pillar.update(t);

      if (pointerDirty) {
        pointerDirty = false;
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(pillars.map((p) => p.pillar.hitMesh), false);
        const hit = hits[0]?.object;
        const entry = hit ? pillars.find((p) => p.pillar.hitMesh === hit) ?? null : null;
        if (entry !== hoverRef.current) {
          hoverRef.current?.pillar.setHovered(false);
          if (entry) {
            entry.pillar.setHovered(true);
            setHover({ factory: entry.factory, x: pointer.x, y: pointer.y });
          } else {
            setHover(null);
          }
          hoverRef.current = entry ?? null;
        } else if (entry) {
          setHover({ factory: entry.factory, x: pointer.x, y: pointer.y });
        }
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => {
      if (!host.clientWidth || !host.clientHeight) return;
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(host);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      orbit.dispose();
      for (const p of pillars) p.pillar.dispose();
      pillars = [];
      fill.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
      });
      border.geometry.dispose();
      innerBorder.geometry.dispose();
      renderer.dispose();
      host.querySelectorAll("canvas").forEach((c) => c.remove());
    };
  }, []);

  const runRate = summary && summary.totals.equipmentCount > 0 ? Math.round(((summary.totals.equipmentCount - summary.totals.faultCount) / summary.totals.equipmentCount) * 1000) / 10 : null;

  const hoverScreen = hover
    ? {
        left: `${((hover.x + 1) / 2) * 100}%`,
        top: `${((1 - hover.y) / 2) * 100}%`,
      }
    : null;

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#0b1220]">
      <div ref={hostRef} className="absolute inset-0" />
      <div className="absolute inset-0 z-20 pointer-events-none select-none">
        {/* 顶部中央 tab：数据统计 / 工厂总览 / 智慧安防（下移避开下钻壳面包屑） */}
        <div className="pointer-events-auto absolute left-1/2 top-3 -translate-x-1/2 flex gap-1 rounded-lg border border-cyan-400/25 bg-[rgba(8,15,30,0.72)] px-1 py-1 backdrop-blur">
          {["数据统计", "工厂总览", "智慧安防"].map((t) => (
            <button
              key={t}
              onClick={() => setTopTab(t)}
              className={`rounded px-4 py-1.5 text-xs tracking-widest transition-colors ${topTab === t ? "bg-cyan-400/15 text-cyan-200" : "text-slate-400 hover:text-slate-200"}`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* 左上 tab + 左侧数据面板（leftInset 避开应用侧边栏） */}
        <div className="absolute top-3 bottom-3 flex w-[300px] flex-col gap-2" style={{ left: leftInset + 12 }}>
          <div className="pointer-events-auto flex gap-1 rounded-lg border border-cyan-400/25 bg-[rgba(8,15,30,0.72)] px-1 py-1 backdrop-blur">
            {["图分析", "重点工厂", "出口分析"].map((t) => (
              <button
                key={t}
                onClick={() => setLeftTab(t)}
                className={`flex-1 rounded px-2 py-1.5 text-xs transition-colors ${leftTab === t ? "bg-cyan-400/15 text-cyan-200" : "text-slate-400 hover:text-slate-200"}`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="pointer-events-auto hud-data-card rounded-lg p-3">
            <div className="text-[11px] tracking-widest text-cyan-300/80">总体运营指标 · 设备总数</div>
            <div className="hud-value-glow hud-tabular-nums mt-1 text-4xl font-semibold text-cyan-100">
              {summary ? summary.totals.equipmentCount : "—"}
            </div>
            <div className="mt-1 flex gap-3 text-[11px] text-slate-400">
              <span>厂区 {summary?.totals.factoryCount ?? "—"}</span>
              <span className="text-rose-300/90">故障 {summary?.totals.faultCount ?? "—"}</span>
              <span className="text-amber-300/90">告警 {summary?.totals.alertCount ?? "—"}</span>
            </div>
          </div>

          <div className="pointer-events-auto hud-data-card rounded-lg px-3 py-2 text-xs">
            {[
              ["工业研发投入"],
              ["加工总量"],
              ["新产品开发"],
              ["营销收入"],
            ].map(([label]) => (
              <div key={label} className="flex items-center justify-between border-b border-white/5 py-2 last:border-b-0">
                <span className="text-slate-300">{label}</span>
                <NotConnected label={label} />
              </div>
            ))}
          </div>

          <div className="pointer-events-auto grid flex-1 grid-cols-2 gap-2">
            {[
              { title: "工业研发投入", value: null as string | null, unit: "万元", yoy: null },
              { title: "人员规模", value: null, unit: "人", yoy: null },
              { title: "工厂分布", value: summary ? `${summary.totals.factoryCount}` : null, unit: "个厂区", yoy: null },
              { title: "24h 设备运行", value: runRate != null ? `${runRate}` : null, unit: "%", yoy: null },
            ].map((card) => (
              <div key={card.title} className="hud-data-card rounded-lg p-2.5">
                <div className="text-[11px] text-slate-400">{card.title}</div>
                <div className="mt-1 flex items-baseline gap-1">
                  {card.value != null ? (
                    <span className="hud-value-glow hud-tabular-nums text-xl font-semibold text-cyan-100">{card.value}</span>
                  ) : (
                    <NotConnected label={card.title} />
                  )}
                  {card.value != null && <span className="text-[10px] text-slate-500">{card.unit}</span>}
                </div>
                <div className="mt-0.5 text-[10px]">
                  {card.yoy != null ? <span className="text-emerald-400">同比 {card.yoy}%</span> : <span className="text-slate-600">同比 未接入</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 右侧数据面板 */}
        <div className="absolute right-3 top-3 bottom-3 flex w-[300px] flex-col gap-2">
          <div className="pointer-events-auto hud-data-card rounded-lg p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-semibold text-cyan-100">{greetWord(clock.getHours())}</span>
              <span className="hud-tabular-nums text-xs text-slate-300">
                {clock.toLocaleDateString("zh-CN")} {clock.toLocaleTimeString("zh-CN", { hour12: false })}
              </span>
            </div>
          </div>

          <div className="pointer-events-auto hud-data-card rounded-lg p-3">
            <div className="text-[11px] tracking-widest text-cyan-300/80">今日异常</div>
            <div className="mt-1 flex items-baseline gap-4">
              <div>
                <div className="hud-value-glow hud-tabular-nums text-2xl font-semibold text-rose-300">{anomaly ? anomaly.today : "—"}</div>
                <div className="text-[10px] text-slate-500">今日报修工单</div>
              </div>
              <div>
                <div className="hud-value-glow hud-tabular-nums text-2xl font-semibold text-amber-200">{anomaly ? anomaly.total : "—"}</div>
                <div className="text-[10px] text-slate-500">累计报修工单</div>
              </div>
            </div>
          </div>

          <div className="pointer-events-auto hud-data-card rounded-lg p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] tracking-widest text-cyan-300/80">工业产值</span>
              <NotConnected label="工业产值" />
            </div>
            <div className="mt-2 text-[11px] text-slate-500">柱状图（近 7 天时序）未接入</div>
          </div>

          <div className="pointer-events-auto hud-data-card rounded-lg p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] tracking-widest text-cyan-300/80">工业产出增长率</span>
              <NotConnected label="工业产出增长率" />
            </div>
            <div className="mt-2 text-[11px] text-slate-500">折线图 未接入</div>
          </div>

          <div className="pointer-events-auto mt-auto flex items-center gap-4 rounded-lg border border-cyan-400/20 bg-[rgba(8,15,30,0.6)] px-3 py-2 text-[11px] text-slate-300">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
              正常
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-rose-400" />
              异常
            </span>
          </div>
        </div>

        {/* hover 小卡片 */}
        {hover && hoverScreen && (
          <div
            className="pointer-events-none absolute z-30 w-56 rounded-lg border border-cyan-400/40 bg-[rgba(8,15,30,0.85)] p-3 shadow-[0_0_24px_rgba(34,211,238,0.18)] backdrop-blur"
            style={{ ...hoverScreen, transform: "translate(14px, -50%)" }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-cyan-100">{hover.factory.name}</span>
              {hover.factory.isDemo && <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-300">演示数据</span>}
            </div>
            <div className="mt-1.5 space-y-1 text-[11px] text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-500">城市</span>
                <span>{hover.factory.city}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">设备数</span>
                <span className="hud-tabular-nums">{hover.factory.stats.equipmentCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">运行状态</span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: statusDotColor(hover.factory.status) }} />
                  {statusLabel(hover.factory.status)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
