/**
 * 车间现场「分区优先」导航：分区（A/B/C 区）→ 该区的车间（厂房）→ 该车间的设备。
 *
 * ## 为什么需要这个组件（2026-10-16 用户报障）
 *
 * 进入「车间现场」层时，两个右侧/左侧面板给的都是一张**全厂设备的平铺清单**：
 *   - 大屏 HUD 左栏的「设备快选」（`ProductionHUD.tsx`，最多 40 台）；
 *   - 普通模式侧栏的设备下拉（`EquipmentScene.tsx` 的 `equipment3d-device-select`）。
 * 等于把「分区 → 车间 → 设备」三级压成了一级：一进车间现场就能点到任意车间里的任意设备，
 * 用户看到的就是"跳步"。
 *
 * 本组件把中间那两级补回来，并且**未选分区时一台设备都不渲染**（不给跳步留入口）：
 *   1. 先给 A/B/C 三个分区（分区数与名称来自 3D 引擎按真实台账聚合的 `FactoryZoneView`）；
 *   2. 选中分区后，列出该分区下属厂房（`buildingNames`），每个厂房下挂它自己的设备；
 *   3. 点设备行 → `onSelectDevice(id)`（走既有 `handlePick` 通路：独占取景 + 拉真实数据）。
 *
 * ## 数据纪律
 *
 * - 分区 / 厂房 / 设备归属全部来自真实台账，不做任何推算；
 * - 异常判定沿用项目唯一真源 `statusMapping.telemetryToStatus()`（台账 fault/warning，
 *   或遥测阈值派生出的 fault/warning/critical），**不在这里另立标准**；
 * - 台账里没有设备的厂房照常列出并显示「0 台」，不隐藏、不补数。
 */
import React, { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Factory, Layers } from 'lucide-react';
import type { Equipment } from '../../types';
import type { FactoryZoneView } from './factoryOverviewTypes';
import { telemetryToStatus } from './statusMapping';

export interface WorkshopZoneNavProps {
  /** 分区视图（含下属厂房清单），由 3D 引擎按真实台账聚合 */
  zones: FactoryZoneView[];
  /** 全厂台账设备（本组件自行按 `workshop` 字段归到厂房下） */
  devices: Equipment[];
  /** 当前选中的分区 id（null = 未选，此时不显示任何设备） */
  activeZoneId: string | null;
  /** 选中 / 取消选中分区 */
  onSelectZone: (zoneId: string | null) => void;
  /** 点设备行 → 聚焦该设备 */
  onSelectDevice: (deviceId: string) => void;
  /** 当前聚焦的设备（高亮用） */
  selectedDeviceId?: string | null;
  /** 窄栏（HUD 左栏）模式：压缩字号与内边距 */
  compact?: boolean;
  className?: string;
}

/** 台账 status / 遥测阈值派生 —— 与项目既有口径一致（唯一真源 telemetryToStatus）。 */
function isAbnormal(d: Equipment): boolean {
  if (d.status === 'fault' || d.status === 'warning') return true;
  const derived = telemetryToStatus(d.telemetry);
  return derived === 'fault' || derived === 'warning' || derived === 'critical';
}

/** 设备所属车间名（台账 `workshop` 缺失时与 HUD 其余处一致按「机加车间」兜底）。 */
const workshopOf = (d: Equipment) => d.workshop || '机加车间';

export const WorkshopZoneNav: React.FC<WorkshopZoneNavProps> = ({
  zones,
  devices,
  activeZoneId,
  onSelectZone,
  onSelectDevice,
  selectedDeviceId,
  compact = false,
  className = '',
}) => {
  /** 折叠起来的厂房 key（默认全展开：选中分区后「车间 + 设备」一起出现，正好是用户要的粒度） */
  const [collapsedHalls, setCollapsedHalls] = useState<Set<string>>(() => new Set());

  /** 台账里真实存在的车间名（去重），用于把「1 号厂房・动力一车间」标签对回 workshop 字段 */
  const workshopNames = useMemo(
    () => Array.from(new Set(devices.map(workshopOf))),
    [devices]
  );

  const activeZone = useMemo(
    () => zones.find((z) => z.id === activeZoneId) ?? null,
    [zones, activeZoneId]
  );

  /** 分区 → 该区厂房（每项带上自己的设备清单） */
  const halls = useMemo(() => {
    if (!activeZone) return [];
    return activeZone.buildingNames.map((label, i) => {
      const name = workshopNames.find((n) => label.includes(n)) ?? null;
      const list = name ? devices.filter((d) => workshopOf(d) === name) : [];
      return {
        key: activeZone.buildingIds[i] ?? `${activeZone.id}-${i}`,
        label,
        name,
        list,
        abnormal: list.filter(isAbnormal).length,
      };
    });
  }, [activeZone, workshopNames, devices]);

  const toggleHall = (key: string) =>
    setCollapsedHalls((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const fontTitle = compact ? 'text-[10px]' : 'text-[11px]';
  const fontBody = compact ? 'text-[9px]' : 'text-[10px]';

  return (
    <div
      data-testid="workshop-zone-nav"
      data-active-zone={activeZoneId ?? ''}
      className={`flex flex-col min-h-0 ${className}`}
    >
      {/* ---- 标题：明确这是「分区」这一步 ---- */}
      <div className="flex items-center justify-between pb-1 border-b border-cyan-500/20">
        <span className={`flex items-center gap-1 text-cyan-200 font-bold ${fontTitle}`}>
          <span className="hud-title-bar-indicator !h-2.5" />
          <Factory className="w-3 h-3 text-cyan-400" />
          <span className="hud-title-text">车间现场 · 分区</span>
        </span>
        <span className={`font-mono hud-tabular-nums text-cyan-400/90 bg-cyan-950/60 border-cyan-500/40 ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
          {zones.length} 区
        </span>
      </div>

      {/* ---- 第 1 级：分区 A/B/C ---- */}
      <div className="flex flex-col gap-0.5 pt-1 shrink-0">
        {zones.length === 0 ? (
          <div className={`${fontBody} text-slate-400 p-1 leading-relaxed`}>
            暂无分区数据
            <br />
            <span className="text-[9px]">台账为空时不推算、不模拟</span>
          </div>
        ) : (
          zones.map((z) => {
            const active = activeZoneId === z.id;
            return (
              <button
                key={z.id}
                type="button"
                data-testid="workshop-zone-btn"
                data-zone-id={z.id}
                data-active={active ? 'true' : 'false'}
                aria-pressed={active}
                title={`${z.name} · 设备 ${z.deviceCount} 台 · 异常 ${z.abnormalCount} 台`}
                onClick={() => onSelectZone(active ? null : z.id)}
                className={`w-full flex items-center gap-1.5 px-1.5 py-1 rounded border text-left transition ${fontBody} ${
                  active
                    ? 'border-cyan-400/70 bg-cyan-500/25 text-cyan-100 font-semibold shadow-[0_0_10px_rgba(34,211,238,0.3)]'
                    : 'border-transparent text-slate-400 hover:text-cyan-200 hover:bg-slate-900/40'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-sm shrink-0"
                  style={{ background: z.color, boxShadow: `0 0 6px ${z.color}` }}
                />
                <span className="truncate">{z.name}</span>
                {z.status !== 'normal' && <AlertTriangle className="w-2.5 h-2.5 text-amber-400 shrink-0" />}
                <span className="ml-auto shrink-0 font-mono hud-tabular-nums text-slate-400">
                  {z.deviceCount} 台
                  {z.abnormalCount > 0 && (
                    <strong className="text-rose-400 font-semibold ml-1">异常 {z.abnormalCount}</strong>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* ---- 未选分区：只给提示，**一台设备都不列** ---- */}
      {zones.length > 0 && !activeZone && (
        <div
          data-testid="workshop-zone-hint"
          className={`mt-1 p-1.5 rounded hud-data-card text-slate-400 leading-relaxed ${fontBody}`}
        >
          <span className="flex items-center gap-1 text-cyan-200 font-semibold mb-0.5">
            <Layers className="w-3 h-3 text-cyan-400" />
            先选分区
          </span>
          选择 A/B/C 区后，这里会列出该区的车间与其设备。
        </div>
      )}

      {/* ---- 第 2/3 级：选中分区的车间 → 车间内设备 ---- */}
      {activeZone && (
        <div className="mt-1 flex-1 min-h-0 overflow-y-auto space-y-1 pr-0.5">
          {halls.length === 0 ? (
            <div className={`p-1.5 rounded hud-data-card text-slate-400 ${fontBody}`}>
              该分区暂无厂房数据
            </div>
          ) : (
            halls.map((h) => {
              const collapsed = collapsedHalls.has(h.key);
              return (
                <div
                  key={h.key}
                  data-testid="workshop-hall-row"
                  data-hall={h.label}
                  className="rounded hud-data-card p-1 border border-cyan-500/15"
                >
                  <button
                    type="button"
                    data-testid="workshop-hall-toggle"
                    aria-expanded={!collapsed}
                    title={h.label}
                    onClick={() => toggleHall(h.key)}
                    className={`w-full flex items-center gap-1 text-left text-cyan-100 ${fontBody} hover:text-white`}
                  >
                    {collapsed ? (
                      <ChevronRight className="w-2.5 h-2.5 shrink-0 text-cyan-400" />
                    ) : (
                      <ChevronDown className="w-2.5 h-2.5 shrink-0 text-cyan-400" />
                    )}
                    <span className="truncate">{h.label}</span>
                    <span className="ml-auto shrink-0 font-mono hud-tabular-nums text-slate-400">
                      {h.list.length} 台
                      {h.abnormal > 0 && <strong className="text-rose-400 font-semibold ml-1">异常 {h.abnormal}</strong>}
                    </span>
                  </button>

                  {!collapsed && (
                    <div className="mt-0.5 space-y-0.5">
                      {h.list.length === 0 ? (
                        <div className={`px-1.5 py-0.5 text-slate-500 ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
                          该车间台账暂无设备
                        </div>
                      ) : (
                        h.list.map((d) => {
                          const bad = isAbnormal(d);
                          const on = selectedDeviceId === d.id;
                          return (
                            <button
                              key={d.id}
                              type="button"
                              data-testid="workshop-hall-device"
                              data-device-id={d.id}
                              title={`${d.code} · ${d.name} · ${d.workshop}`}
                              onClick={() => onSelectDevice(d.id)}
                              className={`w-full flex items-center gap-1 px-1.5 py-[2px] rounded text-left font-mono transition ${compact ? 'text-[9px]' : 'text-[10px]'} ${
                                on
                                  ? 'bg-cyan-500/30 text-cyan-100 border border-cyan-400/60 font-bold'
                                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-cyan-200 border border-transparent'
                              }`}
                            >
                              <span
                                className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                                  d.status === 'fault'
                                    ? 'bg-rose-400 shadow-[0_0_6px_#f43f5e]'
                                    : bad
                                      ? 'bg-amber-400 shadow-[0_0_6px_#f59e0b]'
                                      : 'bg-emerald-400 shadow-[0_0_6px_#10b981]'
                                }`}
                              />
                              <span className="truncate">{d.code}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default WorkshopZoneNav;
