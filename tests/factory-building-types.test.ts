/**
 * 厂房类型口径单测（纯逻辑，node 环境即可）。
 *
 * 锁的是"厂区俯瞰层不再是一排同样的盒子"这条验收线的**可断言部分**：
 *   1. 角色判定优先级 —— 真实车间名关键词优先于分区序号；
 *   2. 兜底轮转 —— 名字全不命中时四类仍会出现，且同输入必同输出；
 *   3. 倍率边界 —— 任何输入都不能把厂房拉出相机取景框（clamp 生效）；
 *   4. 屋顶降级 —— 矮厂房不做锯齿采光带；
 *   5. 行车门廊 —— 只有"重型 + 宽门洞"才挂行车；
 *   6. 分区可读性 —— 一个典型园区（动力/重型/轻型/仓储混合）四类齐活。
 */

import { describe, it, expect } from 'vitest';
import {
  resolveBuildingType,
  roleOfWorkshop,
  roleLabel,
  type BuildingTypeInput,
} from '../src/components/equipment3d/factoryBuildingTypes';

const input = (patch: Partial<BuildingTypeInput>): BuildingTypeInput => ({
  zoneIndex: 0,
  zoneName: 'A 区',
  workshopName: '',
  indexInZone: 0,
  ...patch,
});

describe('roleOfWorkshop：车间名关键词优先', () => {
  it('四类关键词各自命中', () => {
    expect(roleOfWorkshop('动力一车间')).toBe('power');
    expect(roleOfWorkshop('重型热轧车间')).toBe('heavy');
    expect(roleOfWorkshop('总装车间')).toBe('light');
    expect(roleOfWorkshop('成品仓库')).toBe('storage');
  });

  it('STORAGE 组优先于其他组（综合楼不会被判成轻钢）', () => {
    // "综合办公楼"同时含"办公"（storage）；不得被 POWER/LIGHT 抢走
    expect(roleOfWorkshop('综合办公楼')).toBe('storage');
    expect(roleOfWorkshop('中心机房')).toBe('storage');
  });

  it('POWER 组优先于 HEAVY / LIGHT（动力机加车间仍是动力站房）', () => {
    expect(roleOfWorkshop('动力机加车间')).toBe('power');
    expect(roleOfWorkshop('空压装配站')).toBe('power');
  });

  it('HEAVY 组优先于 LIGHT（轻型轧线仍按重型判）', () => {
    expect(roleOfWorkshop('冷轧精整线')).toBe('heavy');
  });

  it('英文与大小写不敏感', () => {
    expect(roleOfWorkshop('Machining Bay')).toBe('heavy');
    expect(roleOfWorkshop('MACHINING')).toBe('heavy');
  });

  it('名字为空/缺失时按 zoneIndex + indexInZone 轮转，四类都能覆盖', () => {
    const seen = new Set(
      [0, 1, 2, 3].map((i) => roleOfWorkshop('', 0, i))
    );
    expect([...seen].sort()).toEqual(['heavy', 'light', 'power', 'storage']);
    expect(roleOfWorkshop(undefined as unknown as string, 1, 0)).toBe('heavy');
    expect(roleOfWorkshop(null as unknown as string, 0, 0)).toBe('power');
  });

  it('负序号不会把取模打成 undefined', () => {
    expect(roleOfWorkshop('不认识的产线', -5, -3)).toBe('power');
  });
});

describe('resolveBuildingType：外观类型与边界', () => {
  it('同一分区内做错落，第 2、3 栋与第 1 栋不同高', () => {
    const a = resolveBuildingType(input({ workshopName: '重型车间', indexInZone: 0 }));
    const b = resolveBuildingType(input({ workshopName: '重型车间', indexInZone: 1 }));
    const c = resolveBuildingType(input({ workshopName: '重型车间', indexInZone: 2 }));
    expect(new Set([a.heightScale, b.heightScale, c.heightScale]).size).toBe(3);
    // 错落不改变角色：仍然是重型
    expect([a.role, b.role, c.role]).toEqual(['heavy', 'heavy', 'heavy']);
  });

  it('倍率始终落在硬边界内（含极端 index）', () => {
    for (let zone = 0; zone < 8; zone++) {
      for (let idx = 0; idx < 12; idx++) {
        const t = resolveBuildingType(input({ zoneIndex: zone, indexInZone: idx }));
        expect(t.heightScale).toBeGreaterThanOrEqual(0.6);
        expect(t.heightScale).toBeLessThanOrEqual(1.4);
        expect(t.widthScale).toBeGreaterThanOrEqual(0.8);
        expect(t.widthScale).toBeLessThanOrEqual(1.2);
        expect(t.doorWidth).toBeGreaterThanOrEqual(5);
        expect(t.doorWidth).toBeLessThanOrEqual(18);
        expect(t.windowCols).toBeGreaterThanOrEqual(3);
        expect(t.windowCols).toBeLessThanOrEqual(10);
        expect(t.windowRows).toBeGreaterThanOrEqual(1);
        expect(t.windowRows).toBeLessThanOrEqual(3);
        expect(t.chimneys).toBeGreaterThanOrEqual(0);
        expect(t.chimneys).toBeLessThanOrEqual(3);
        expect(t.sawtoothBays).toBeGreaterThanOrEqual(0);
        expect(t.sawtoothBays).toBeLessThanOrEqual(6);
        expect(Number.isFinite(t.heightScale)).toBe(true);
      }
    }
  });

  it('非锯齿屋顶一律不产出采光跨', () => {
    for (const name of ['动力车间', '重型车间', '成品仓库', '']) {
      for (let idx = 0; idx < 3; idx++) {
        const t = resolveBuildingType(input({ workshopName: name, indexInZone: idx }));
        if (t.roofStyle !== 'sawtooth') expect(t.sawtoothBays).toBe(0);
      }
    }
  });

  it('矮厂房（heightScale<0.8）会把锯齿屋顶降级为平顶', () => {
    // light 基准 0.86，indexInZone=1 的 0.93 倍率 → 0.7998 < 0.8
    const t = resolveBuildingType(input({ workshopName: '总装车间', indexInZone: 1 }));
    expect(t.heightScale).toBeLessThan(0.8);
    expect(t.roofStyle).toBe('flat');
    expect(t.sawtoothBays).toBe(0);
  });

  it('A 区动力站房：最高、带烟囱、三层侧窗、无行车', () => {
    const t = resolveBuildingType(input({ workshopName: '动力一车间' }));
    expect(t.role).toBe('power');
    expect(t.roofStyle).toBe('flat');
    expect(t.chimneys).toBe(3);
    expect(t.windowRows).toBe(3);
    expect(t.craneBay).toBe(false);
    expect(t.heightScale).toBeGreaterThan(1.2);
  });

  it('B 区重型车间：宽门洞 + 行车 + 双坡顶；第 2 栋切四坡但仍留行车', () => {
    const b0 = resolveBuildingType(input({ workshopName: '重型机械加工厂', indexInZone: 0 }));
    expect(b0.role).toBe('heavy');
    expect(b0.roofStyle).toBe('gable');
    expect(b0.doorWidth).toBeGreaterThanOrEqual(12);
    expect(b0.craneBay).toBe(true);
    const b1 = resolveBuildingType(input({ workshopName: '重型机械加工厂', indexInZone: 1 }));
    expect(b1.roofStyle).toBe('hip');
    expect(b1.craneBay).toBe(true);
  });

  it('C 区标准轻钢车间：窗带最密且带锯齿采光带', () => {
    const t = resolveBuildingType(input({ workshopName: '电子装配车间' }));
    expect(t.role).toBe('light');
    expect(t.roofStyle).toBe('sawtooth');
    expect(t.windowCols).toBeGreaterThanOrEqual(8);
    expect(t.sawtoothBays).toBeGreaterThan(0);
  });

  it('仓储类：矮体量、四坡顶、无烟囱无行车、单层窗', () => {
    const t = resolveBuildingType(input({ workshopName: '成品库' }));
    expect(t.role).toBe('storage');
    expect(t.roofStyle).toBe('hip');
    expect(t.heightScale).toBeLessThan(0.8);
    expect(t.chimneys).toBe(0);
    expect(t.craneBay).toBe(false);
    expect(t.windowRows).toBe(1);
  });

  it('行车门廊只可能出现在重型厂房（其他角色即使 index 变化也不挂）', () => {
    for (let idx = 0; idx < 3; idx++) {
      for (const name of ['动力车间', '总装车间', '成品仓库']) {
        const t = resolveBuildingType(input({ workshopName: name, indexInZone: idx }));
        if (t.role !== 'heavy') expect(t.craneBay).toBe(false);
      }
    }
  });

  it('相同输入必得相同输出（确定性重放，3D 侧可放心在重建时调用）', () => {
    const cases: BuildingTypeInput[] = [];
    for (let zone = 0; zone < 3; zone++) {
      for (let idx = 0; idx < 5; idx++) {
        cases.push(input({ zoneIndex: zone, indexInZone: idx, workshopName: ['动力', '重型', '装配', '库房', ''][idx] }));
      }
    }
    const first = cases.map(resolveBuildingType);
    const second = cases.map(resolveBuildingType);
    expect(second).toEqual(first);
  });

  it('NaN / 非法 index 不会污染结果', () => {
    const t = resolveBuildingType(
      input({ zoneIndex: NaN, indexInZone: Number.NaN, workshopName: '重型车间' })
    );
    expect(Number.isFinite(t.heightScale)).toBe(true);
    expect(t.role).toBe('heavy');
  });
});

describe('整园区可读性', () => {
  it('典型混合园区里四类角色全部出现', () => {
    const workshops = ['动力一车间', '重型热轧车间', '电子装配车间', '成品仓库', '总装车间'];
    const roles = new Set(
      workshops.map((w, i) =>
        resolveBuildingType(input({ workshopName: w, zoneIndex: i % 3, indexInZone: i })).role
      )
    );
    expect([...roles].sort()).toEqual(['heavy', 'light', 'power', 'storage']);
  });

  it('全匿名车间名也能覆盖四类（不靠台账名字就画不出差异是缺陷）', () => {
    const roles = new Set(
      [0, 1, 2, 3, 4, 5, 6, 7].map(
        (i) => resolveBuildingType(input({ workshopName: `车间 ${i + 1}`, indexInZone: i })).role
      )
    );
    expect(roles.size).toBe(4);
  });

  it('四类角色的中文说明互不重复（HUD 图例直接用）', () => {
    const labels = (['power', 'heavy', 'light', 'storage'] as const).map(roleLabel);
    expect(new Set(labels).size).toBe(4);
    expect(labels).toContain('动力站房');
  });
});
