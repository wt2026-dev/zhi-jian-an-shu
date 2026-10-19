/**
 * 第六刀契约（2026-10-19）：厂区厂房清单 + 分区定义的台账派生从 EquipmentScene.tsx
 * 整块搬进 `facilityLedgerSpecs.buildFacilityLedgerSpecs`。
 *
 * 断言分两层，顺序有讲究：
 *   1. **先把函数真调起来**（行为等价）—— 机械切分最容易骗人的就是"grep 说搬走了、
 *      运行时算的是另一套"。这里给假台账，验车间去重、分区切分、hall 命名、
 *      未闭环工单计数、遥测派生异常、确定性这几条口径。
 *   2. **再钉源码接线**（宿主只剩 memo 壳、新模块不碰 React/引擎、口径不复制第二套）。
 *
 * 行尾必须归一：闸门把待提交的树检出一个全新 worktree，core.autocrlf=true ⇒ 检出来是
 * CRLF，而本地写的那份是 LF。多行断言不归一就会「本地全绿、闸门一条红」（第五刀踩过）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { buildFacilityLedgerSpecs } from '../src/components/equipment3d/facilityLedgerSpecs';
import { ZONE_NOTES } from '../src/components/equipment3d/uiPrimitives';
import type { Equipment, WorkOrder } from '../src/types';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const host = read('src/components/equipment3d/EquipmentScene.tsx');
const specsSrc = read('src/components/equipment3d/facilityLedgerSpecs.ts');

const eq = (id: string, workshop: string, over: Partial<Equipment> = {}): Equipment =>
  ({
    id,
    code: id,
    name: `设备${id}`,
    workshop,
    status: 'running',
    healthScore: 90,
    criticality: '主要生产',
    telemetry: null,
    ...over,
  }) as Equipment;

const wo = (equipmentId: string, status: string): WorkOrder =>
  ({ equipmentId, status }) as WorkOrder;

const HALLS = ['动力一车间', '重型热轧车间', '总装车间', '电子装配车间', '成品库'];

describe('buildFacilityLedgerSpecs：台账 → 厂房/分区（行为等价）', () => {
  it('空台账返回 undefined 而不是空数组（宿主据此跳过 buildFactory，画不出厂房就别画）', () => {
    expect(buildFacilityLedgerSpecs([], [])).toEqual({
      buildingSpecs: undefined,
      zoneSpecs: undefined,
    });
    const noWorkshop = [eq('1', ''), eq('2', '')];
    expect(buildFacilityLedgerSpecs(noWorkshop, []).buildingSpecs).toBeUndefined();
  });

  it('车间名去重后才编号，缺 workshop 的设备不占厂房名额', () => {
    const { buildingSpecs } = buildFacilityLedgerSpecs(
      [
        eq('1', '动力一车间'),
        eq('2', '动力一车间'),
        eq('3', '总装车间'),
        eq('4', ''),
      ],
      []
    );
    expect(buildingSpecs!.map((b) => b.workshopId)).toEqual(['动力一车间', '总装车间']);
    expect(buildingSpecs!.map((b) => b.id)).toEqual(['hall-1', 'hall-2']);
    expect(buildingSpecs![0].name).toBe('1 号厂房・动力一车间');
    expect(buildingSpecs![0].deviceCount).toBe(2);
  });

  it('分区最多 3 个、字母 A/B/C、id 小写，且每栋厂房的 zoneId 指回真实存在的分区', () => {
    const { buildingSpecs, zoneSpecs } = buildFacilityLedgerSpecs(
      HALLS.map((w, i) => eq(`e${i}`, w)),
      []
    );
    expect(zoneSpecs!.map((z) => z.id)).toEqual(['zone-a', 'zone-b', 'zone-c']);
    expect(zoneSpecs!.map((z) => z.name)).toEqual(['A 区', 'B 区', 'C 区']);
    const zoneIds = new Set(zoneSpecs!.map((z) => z.id));
    for (const b of buildingSpecs!) expect(zoneIds.has(b.zoneId)).toBe(true);
  });

  it('施工说明取 ZONE_NOTES 并按 zi 轮转，不在这里另写一套地名', () => {
    const { zoneSpecs } = buildFacilityLedgerSpecs(
      HALLS.map((w, i) => eq(`e${i}`, w)),
      []
    );
    // 5 栋 → 3 个分区，正好各取一条；轮转口径（zi % ZONE_NOTES.length）由这里钉住
    expect(zoneSpecs!.map((z) => z.constructionNote)).toEqual(ZONE_NOTES.slice(0, 3));
  });

  it('未闭环工单只数本车间的设备：completed/cancelled、无 equipmentId、别车间都不算', () => {
    const devices = [eq('d1', '动力一车间'), eq('d2', '总装车间'), eq('d3', '总装车间')];
    const orders = [
      wo('d1', 'created'),
      wo('d1', 'in_progress'),
      wo('d1', 'completed'),
      wo('d1', 'cancelled'),
      wo('d2', 'dispatched'),
      wo('', 'created'),
      wo('missing-device', 'created'),
    ];
    const { buildingSpecs } = buildFacilityLedgerSpecs(devices, orders);
    const byWorkshop = new Map(buildingSpecs!.map((b) => [b.workshopId, b]));
    expect(byWorkshop.get('动力一车间')!.openWorkOrders).toBe(2);
    expect(byWorkshop.get('总装车间')!.openWorkOrders).toBe(1);
  });

  it('厂房 status 由异常台数派生；台账 status 与遥测阈值两条路都算异常', () => {
    const { buildingSpecs } = buildFacilityLedgerSpecs(
      [
        eq('1', '动力一车间', { status: 'warning' }),
        eq('2', '动力一车间'),
        eq('3', '总装车间', { status: 'running', telemetry: { temperature: 120 } as Equipment['telemetry'] }),
        eq('4', '电子装配车间'),
      ],
      []
    );
    const byWorkshop = new Map(buildingSpecs!.map((b) => [b.workshopId, b]));
    expect(byWorkshop.get('动力一车间')!.abnormalCount).toBe(1);
    expect(byWorkshop.get('动力一车间')!.status).toBe('warning');
    // 台账写着 running，但轴温 120°C 已过 critical 阈值 —— 异常判定不能只看台账字段
    expect(byWorkshop.get('总装车间')!.abnormalCount).toBe(1);
    expect(byWorkshop.get('电子装配车间')!.status).toBe('normal');
    expect(byWorkshop.get('电子装配车间')!.failureRate).toBe(0);
  });

  it('经营指标是"派生 + estimated"，不是写死的常量', () => {
    const few = buildFacilityLedgerSpecs([eq('1', '动力一车间')], []);
    const many = buildFacilityLedgerSpecs(
      Array.from({ length: 6 }, (_, i) => eq(`d${i}`, '动力一车间', { healthScore: 99 })),
      []
    );
    expect(many.buildingSpecs![0].estimated).toBe(true);
    expect(many.buildingSpecs![0].outputValue!).toBeGreaterThan(
      few.buildingSpecs![0].outputValue!
    );
    expect(many.buildingSpecs![0].deviceCount).toBe(6);
  });

  it('同输入同输出（3D 侧重建时不跳数），且地块按 5 栋封顶', () => {
    const devices = Array.from({ length: 8 }, (_, i) => eq(`e${i}`, `车间${i + 1}`));
    const a = buildFacilityLedgerSpecs(devices, []);
    const b = buildFacilityLedgerSpecs(devices, []);
    expect(a).toEqual(b);
    expect(a.buildingSpecs!.length).toBe(5);
    expect(a.zoneSpecs!.length).toBe(3);
  });
});

describe('第六刀接线：宿主只留 memo 壳', () => {
  it('宿主改为调用派生模块，依赖数组仍是 [equipments, allOrders]', () => {
    expect(host).toContain("import { buildFacilityLedgerSpecs } from './facilityLedgerSpecs';");
    expect(host).toContain('() => buildFacilityLedgerSpecs(equipments, allOrders),');
    expect(host).toContain('    [equipments, allOrders]\n  );');
  });

  it('派生口径不再住在宿主里（这些标识符回来就说明有人把第二套算法抄回组件）', () => {
    for (const gone of [
      'estimateWorkshopMetrics',
      'aggregateZoneMetrics',
      'resolveBuildingType',
      'selectHallWorkshops',
      'telemetryToStatus',
      'ZONE_NOTES',
      'FactoryBuildingSpec',
      'FactoryZoneSpec',
      "hall-${'${i + 1}'}",
    ]) {
      expect(host, `EquipmentScene.tsx 不应再出现「${gone}」`).not.toContain(gone);
    }
  });

  it('新模块是纯函数：不碰 React、不碰引擎、不读 ref', () => {
    expect(specsSrc).not.toContain("from 'react'");
    for (const banned of ['useEffect', 'useMemo', 'useState', 'useRef', 'sceneRef', 'three']) {
      expect(specsSrc, `facilityLedgerSpecs.ts 不应出现「${banned}」`).not.toContain(banned);
    }
    expect(specsSrc).toContain('export function buildFacilityLedgerSpecs(');
  });

  it('口径单一来源：估算与角色判定都从原模块导入，本地不写系数', () => {
    expect(specsSrc).toContain("from './factoryMetrics'");
    expect(specsSrc).toContain("from './factoryBuildingTypes'");
    expect(specsSrc).toContain("from './statusMapping'");
    expect(specsSrc).toContain("from './uiPrimitives'");
    for (const banned of ['0.85', 'YIELD_BASE', 'UNIT_OUTPUT', 'STAFF_PER_DEVICE']) {
      expect(specsSrc, `不应把估算系数抄进派生模块：${banned}`).not.toContain(banned);
    }
  });

  it('数据诚实性：派生过程不掷随机也不取当前时间', () => {
    expect(specsSrc).not.toMatch(/Math\.random|Date\.now\(|new Date\(/);
  });
});
