/**
 * 厂区总览的厂房清单 + 分区定义：由台账真实字段派生（EquipmentScene.tsx 第六刀，2026-10-19）。
 *
 * 这里是**纯函数**：输入只有设备台账与工单台账，输出直接喂给 3D 引擎的 `buildFactory`
 * 与 HUD 的分区导航。切出来不是为了好看 —— 这一段原先占宿主 100 行，且是整份文件里
 * 唯一「业务口径密集、却不碰 ref / 不碰 effect」的块，最适合先离开工件。
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
import type { Equipment, WorkOrder } from '../../types';
import type { FactoryBuildingSpec, FactoryZoneSpec } from './factoryOverviewTypes';
import { aggregateZoneMetrics, estimateWorkshopMetrics } from './factoryMetrics';
import { resolveBuildingType, selectHallWorkshops } from './factoryBuildingTypes';
import { telemetryToStatus } from './statusMapping';
import { ZONE_NOTES } from './uiPrimitives';

export interface FacilityLedgerSpecs {
  buildingSpecs: FactoryBuildingSpec[] | undefined;
  zoneSpecs: FactoryZoneSpec[] | undefined;
}

export function buildFacilityLedgerSpecs(
  equipments: Equipment[],
  allOrders: WorkOrder[]
): FacilityLedgerSpecs {
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
}
