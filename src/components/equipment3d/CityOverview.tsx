// 第二层 · 城市层（对标《智慧工业数字孪生可视化平台》：城市轮廓 + 工厂点位下钻）。
// 数据纪律：工厂列表/设备数/运行状态来自 /api/v1/factories?city=xxx 真实接口；
// 每城市当前实际只有 1 个厂区（多工厂扩展预留：列表与点位均为数组渲染）。
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { factoryApi, type FactorySummary } from "../../api/factoryApi";
import {
  buildBorderLines,
  buildFillMesh,
  buildMapGround,
  createDampedOrbit,
  createFlowDots,
  createLightPillar,
  makeTextSprite,
  projectLngLat,
  statusDotColor,
  statusLabel,
  type LightPillar,
} from "./mapGeo";
import { PROVINCE_CODE_BY_CITY, PROVINCE_VIEW_BY_CODE, type ProvinceCode } from "./provinceViews";
import "./equipment-industrial.css";

interface HoverCard {
  factory: FactorySummary;
  x: number;
  y: number;
}

interface PillarEntry {
  factory: FactorySummary;
  pillar: LightPillar;
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
  const city = factory?.city ?? "";
  const [cityFactories, setCityFactories] = useState<FactorySummary[]>([]);
  const [hover, setHover] = useState<HoverCard | null>(null);
  const hoverRef = useRef<PillarEntry | null>(null);
  const drillRef = useRef(onEnterFactory);
  drillRef.current = onEnterFactory;

  useEffect(() => {
    if (!city) return;
    let alive = true;
    factoryApi
      .list(city)
      .then((list) => alive && setCityFactories(list))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [city]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !city) return;
    const code = PROVINCE_CODE_BY_CITY[city];
    if (!code) return;
    const view = PROVINCE_VIEW_BY_CODE[code];
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0c1a30, 0.016);
    const camera = new THREE.PerspectiveCamera(55, host.clientWidth / host.clientHeight, 0.1, 600);

    scene.add(buildMapGround(120));
    const fill = buildFillMesh(view.fill, { color: 0x12283f, opacity: 0.94, center: view.center, scale: view.scale, depth: 0.55 });
    const border = buildBorderLines(view.line, { color: 0x36d3f0, opacity: 0.55, center: view.center, scale: view.scale });
    border.position.y = 0.6;
    scene.add(fill, border);

    // 移动光点流（人车流动画）
    const flow = createFlowDots(10, { minX: -18, maxX: 18, minZ: -14, maxZ: 14 });
    scene.add(flow.group);

    // 开场俯冲：高空 → 城市取景
    const orbit = createDampedOrbit(camera, renderer.domElement, {
      theta: 0,
      phi: 0.3,
      radius: 90,
      damping: 2.0,
      minRadius: 8,
      maxRadius: 110,
    });
    orbit.target.radius = 30;
    orbit.target.phi = 0.6;

    // 工厂光柱 + 悬浮标签（由厂区列表驱动，多工厂扩展留口）
    const pillarGroup = new THREE.Group();
    const labelGroup = new THREE.Group();
    scene.add(pillarGroup, labelGroup);
    let pillars: PillarEntry[] = [];
    const build = (list: FactorySummary[]) => {
      if (disposed) return;
      for (const f of list) {
        const pillar = createLightPillar({ height: f.isDemo ? 4.5 : 6.5, radius: 0.7 });
        const [px, pz] = projectLngLat(f.geo.lng, f.geo.lat, view.center, view.scale);
        pillar.group.position.set(px, 0.55, pz);
        pillarGroup.add(pillar.group);
        const label = makeTextSprite(
          f.name,
          `设备 ${f.stats.equipmentCount} · ${statusLabel(f.status)}${f.isDemo ? " · 演示" : ""}`,
          f.isDemo ? "#fbbf24" : "#67e8f9",
          statusDotColor(f.status)
        );
        label.position.set(px, f.isDemo ? 6.8 : 9.4, pz);
        labelGroup.add(label);
        pillars.push({ factory: f, pillar });
      }
    };
    if (cityFactories.length > 0) build(cityFactories);

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
      flow.update(dt);
      if (pointerDirty) {
        pointerDirty = false;
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(pillars.map((p) => p.pillar.hitMesh), false);
        const hit = hits[0]?.object;
        const entry = hit ? pillars.find((p) => p.pillar.hitMesh === hit) ?? null : null;
        if (entry !== hoverRef.current) {
          hoverRef.current?.pillar.setHovered(false);
          if (entry) entry.pillar.setHovered(true);
          hoverRef.current = entry ?? null;
          setHover(entry ? { factory: entry.factory, x: pointer.x, y: pointer.y } : null);
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
      flow.dispose();
      labelGroup.traverse((o) => {
        const s = o as THREE.Sprite;
        s.material?.map?.dispose?.();
        s.material?.dispose?.();
      });
      renderer.dispose();
      host.querySelectorAll("canvas").forEach((c) => c.remove());
    };
    // cityFactories 就绪后挂载场景，保证点位一次建齐
  }, [city, cityFactories.length]);

  // 城市运营聚合（真实数据）
  const totals = cityFactories.reduce(
    (acc, f) => ({
      equipment: acc.equipment + f.stats.equipmentCount,
      fault: acc.fault + f.stats.faultCount,
      alert: acc.alert + f.stats.alertCount,
      healthSum: acc.healthSum + f.stats.avgHealth,
    }),
    { equipment: 0, fault: 0, alert: 0, healthSum: 0 }
  );
  const avgHealth = cityFactories.length > 0 ? Math.round((totals.healthSum / cityFactories.length) * 10) / 10 : 0;

  const hoverScreen = hover
    ? { left: `${((hover.x + 1) / 2) * 100}%`, top: `${((1 - hover.y) / 2) * 100}%` }
    : null;

  return (
    <div className="dd-sky absolute inset-0 overflow-hidden">
      <div ref={hostRef} className="absolute inset-0" />
      <div className="absolute inset-0 z-20 pointer-events-none select-none">
        {/* 左侧工厂列表（leftInset 避开应用侧边栏） */}
        <div className="absolute top-3 w-[280px]" style={{ left: leftInset + 12 }}>
          <div className="pointer-events-auto hud-data-card dd-hud-card rounded-lg p-3">
            <div className="text-[11px] tracking-widest text-cyan-300/80">{city || "—"} · 工厂列表</div>
            <div className="mt-2 space-y-1.5">
              {cityFactories.length === 0 && <div className="py-4 text-center text-xs text-slate-500">加载中…</div>}
              {cityFactories.map((f) => (
                <button
                  key={f.id}
                  onClick={() => onEnterFactory(f)}
                  className="flex w-full items-center justify-between rounded-md border border-white/5 bg-white/[0.03] px-2.5 py-2 text-left text-xs transition-colors hover:border-cyan-400/40 hover:bg-cyan-400/5"
                >
                  <span className="flex items-center gap-2 text-slate-200">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: statusDotColor(f.status) }} />
                    {f.name}
                    {f.isDemo && <span className="rounded bg-amber-400/15 px-1 text-[10px] text-amber-300">演示</span>}
                  </span>
                  <span className="hud-tabular-nums text-slate-400">{f.stats.equipmentCount} 台</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 右侧城市运营面板 */}
        <div className="absolute right-3 top-3 w-[280px]">
          <div className="pointer-events-auto hud-data-card dd-hud-card rounded-lg p-3">
            <div className="text-[11px] tracking-widest text-cyan-300/80">{city || "—"} · 城市运营</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <div className="hud-value-glow hud-tabular-nums text-2xl font-semibold text-cyan-100">{totals.equipment}</div>
                <div className="text-[10px] text-slate-500">设备总数</div>
              </div>
              <div>
                <div className="hud-value-glow hud-tabular-nums text-2xl font-semibold text-rose-300">{totals.fault}</div>
                <div className="text-[10px] text-slate-500">故障数</div>
              </div>
              <div>
                <div className="hud-value-glow hud-tabular-nums text-2xl font-semibold text-amber-200">{totals.alert}</div>
                <div className="text-[10px] text-slate-500">告警数（进行中工单）</div>
              </div>
              <div>
                <div className="hud-value-glow hud-tabular-nums text-2xl font-semibold text-emerald-300">{avgHealth || "—"}</div>
                <div className="text-[10px] text-slate-500">平均健康分</div>
              </div>
            </div>
          </div>
        </div>

        {/* hover 小卡片 */}
        {hover && hoverScreen && (
          <div
            className="pointer-events-none absolute z-30 w-52 rounded-lg border border-cyan-400/40 bg-[rgba(8,15,30,0.85)] p-3 backdrop-blur"
            style={{ ...hoverScreen, transform: "translate(14px, -50%)" }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-cyan-100">{hover.factory.name}</span>
              {hover.factory.isDemo && <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-300">演示</span>}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-300">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: statusDotColor(hover.factory.status) }} />
              {statusLabel(hover.factory.status)} · 设备 {hover.factory.stats.equipmentCount} 台
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
