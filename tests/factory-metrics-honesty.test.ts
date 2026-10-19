// @vitest-environment jsdom
// 厂区/车间经营指标的"去假数"守卫。
//
// 背景：产值 / 良品率 / 在岗这三个指标一直没有数据源，历史版本用两组手段糊过去：
//   1) 调用方写一份常量表（ZONE_METRICS / WORKSHOP_METRICS）当读数传进 3D；
//   2) 标牌与 HUD 在拿到 undefined 时再兜底一个编出来的数（?? 3520、?? 99.1、
//      '产值: 1,280 万元'、各工序完成率 99.1/98.6/…）。
// 现在这三项统一走 factoryMetrics 的台账派生估算并标注"估算"，算不出就写"未接入"。
// 本文件把两件事钉住：兜底假数不得回归，聚合口径不得自己再算一套数。
import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { FactoryOverview } from '../src/components/equipment3d/factoryOverview';
import type { FactoryBuildingSpec, FactoryZoneSpec } from '../src/components/equipment3d/factoryOverview';

/** 从测试文件所在目录向上找到仓库根（含 package.json），避免依赖 __dirname 的层级写法 */
const findRoot = (start: string): string => {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('未找到仓库根目录');
};
const ROOT = findRoot(__dirname);
const read = (...rel: string[]) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8');

/** 曾经出现过的兜底假数（源码级回归守卫）。 */
const BANNED: Array<{ file: string; snippets: string[] }> = [
  {
    file: 'src/components/equipment3d/EquipmentScene.tsx',
    snippets: ['ZONE_METRICS', 'WORKSHOP_METRICS', 'list.length || 6', ': 95.2,', '{ output: 4860'],
  },
  {
    // 第六刀（2026-10-19）把台账派生整块搬进 facilityLedgerSpecs：兜底假数的禁令跟着搬，
    // 不然"不许写常量顶数"这条守卫会在新的落点上失去覆盖。
    file: 'src/components/equipment3d/facilityLedgerSpecs.ts',
    snippets: ['ZONE_METRICS', 'WORKSHOP_METRICS', 'list.length || 6', ': 95.2,', '{ output: 4860'],
  },
  {
    file: 'src/components/equipment3d/factoryOverview.ts',
    snippets: ['?? (3200 +', '99.2 - frVal', "'1,280 万元'", "'在岗: 26 人'", 'b.deviceCount ?? 6'],
  },
  {
    file: 'src/components/equipment3d/ProductionHUD.tsx',
    snippets: [
      '1180 + idx * 240',
      '?? 3520',
      '?? 99.1',
      ": '99.2%'",
      "v: '1,420'",
      "v: '99.4%'",
      "v: '438'",
      "name: '冲压', rate: 98.6",
      'percent={98.8}',
      '±0.02mm',
      // 第二轮布局修复时一并清掉的三处兜底：环形表盘 null 分支写死 98.5%、
      // 分区产值 null 分支写死 2,860 万元、设备健康分 ?? 96.5。
      '>98.5%<',
      "'2,860 万元'",
      '?? 96.5',
      // 第三轮减法整块删掉的三处"看起来像数据"的装饰：7 日产能走势（折线点位与
      // 日均件数全是字面量）、园区主干通道「畅通 / 进行中 68%」、在建工程的写死地名。
      // 要恢复这些卡片，必须先把真实排产 / 工程进度数据源接上。
      '日均 1,420 件',
      '进行中 68%',
      "'园区空闲地块 · 二期扩建'",
    ],
  },
];

describe('厂区指标去假数守卫', () => {
  for (const { file, snippets } of BANNED) {
    for (const s of snippets) {
      it(`${path.basename(file)} 不再出现兜底假数「${s}」`, () => {
        expect(read(...file.split('/')), file).not.toContain(s);
      });
    }
  }

  it('产值/良率/在岗必须经 factoryMetrics 口径，而不是本地常量', () => {
    // 第六刀之后派生口径住在 facilityLedgerSpecs，宿主只留 memo 壳：两边都要钉，
    // 少钉宿主那条就变成"谁都能把口径抄回组件里"的空门。
    const specs = read('src', 'components', 'equipment3d', 'facilityLedgerSpecs.ts');
    expect(specs).toContain('estimateWorkshopMetrics');
    expect(specs).toContain('aggregateZoneMetrics');
    // 角色判定与几何外观共用同一个 resolveBuildingType，不允许第二套判定
    expect(specs).toContain('resolveBuildingType');
    const host = read('src', 'components', 'equipment3d', 'EquipmentScene.tsx');
    expect(host).toContain('buildFacilityLedgerSpecs(equipments, allOrders)');
    expect(host).not.toContain('estimateWorkshopMetrics');
  });
});

/* ======================= 聚合口径（引擎侧只做汇总） ======================= */

const buildings = (over: Partial<FactoryBuildingSpec> = {}): FactoryBuildingSpec[] => [
  { id: 'hall-1', name: '1 号厂房・动力一车间', zoneId: 'zone-a', deviceCount: 12, outputValue: 900, staffCount: 18, estimated: true, ...over },
  { id: 'hall-2', name: '2 号厂房・重型热轧车间', zoneId: 'zone-a', deviceCount: 8, outputValue: 700, staffCount: 12, estimated: true, ...over },
  { id: 'hall-3', name: '3 号厂房・总装车间', zoneId: 'zone-b', deviceCount: 5, outputValue: 400, staffCount: 6, estimated: true, ...over },
];

const zones = (over: Partial<FactoryZoneSpec> = {}): FactoryZoneSpec[] => [
  { id: 'zone-a', name: 'A 区', ...over },
  { id: 'zone-b', name: 'B 区', ...over },
];

const build = (
  buildingSpecs: FactoryBuildingSpec[],
  zoneSpecs: FactoryZoneSpec[]
): FactoryOverview =>
  new FactoryOverview({
    seed: 7,
    buildings: buildingSpecs,
    zones: zoneSpecs,
    shadows: false,
    detail: 2,
  });

const viewOf = (fo: FactoryOverview, id: string) => {
  const v = fo.zones.find((z) => z.id === id);
  if (!v) throw new Error(`缺少分区视图 ${id}`);
  return v;
};

describe('FactoryOverview 分区指标聚合', () => {
  it('分区未直接给产值时，按车间级产值求和（不自己造数）', () => {
    const fo = build(buildings(), zones());
    expect(viewOf(fo, 'zone-a').outputValue).toBe(1600);
    expect(viewOf(fo, 'zone-b').outputValue).toBe(400);
  });

  it('分区自带产值优先于车间级汇总', () => {
    const fo = build(buildings(), zones({ outputValue: 5000 }));
    expect(viewOf(fo, 'zone-a').outputValue).toBe(5000);
  });

  it('两级都没有产值时返回 null，由标牌显示"未接入"', () => {
    const bare = buildings().map((b) => ({ ...b, outputValue: undefined, staffCount: undefined, estimated: false }));
    const fo = build(bare, zones());
    const v = viewOf(fo, 'zone-a');
    expect(v.outputValue).toBeNull();
    expect(v.staffCount).toBeNull();
    expect(v.estimated).toBe(false);
    // 可算项不受影响
    expect(v.deviceCount).toBe(20);
  });

  it('estimated：任一层标注估算即透传，供标牌/HUD 打角标', () => {
    expect(viewOf(build(buildings(), zones()), 'zone-a').estimated).toBe(true);
    const clean = buildings().map((b) => ({ ...b, estimated: false }));
    expect(viewOf(build(clean, zones()), 'zone-a').estimated).toBe(false);
    expect(viewOf(build(clean, zones({ estimated: true })), 'zone-a').estimated).toBe(true);
  });

  it('排名口径：有产值按产值，没产值退回故障率', () => {
    expect(viewOf(build(buildings(), zones()), 'zone-a').rankMetric).toBe('output');
    const bare = buildings().map((b) => ({ ...b, outputValue: undefined }));
    expect(viewOf(build(bare, zones()), 'zone-a').rankMetric).toBe('failureRate');
  });
});
