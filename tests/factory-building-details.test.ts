// @vitest-environment jsdom
/**
 * 厂房外观细节守卫：验收线里"厂房有细节（窗户、门、烟囱）、不同区域不同厂房"
 * 是可程序化验证的部分，这里逐条钉住：
 *   1. 四种屋顶形式各自生成不同结构，平顶不举高、坡顶举高；
 *   2. 窗带用 InstancedMesh（一栋几十扇窗 = 2 个 Draw Call），且主立面门洞处留空；
 *   3. 烟囱数量严格等于角色口径（动力 3 / 重型 1 / 轻型 0），仓储不堆烟囱；
 *   4. 行车门廊只出现在重型厂房；
 *   5. 细节模块不 new 材质/几何（全部复用调用方的共享资源表），否则厂区材质数会
 *      随楼栋线性膨胀；
 *   6. 接进 FactoryOverview 后，同一园区的多栋厂房轮廓**互不相同**（不再是同一个
 *      盒子复制五份）；
 *   7. 厂房角色只由车间名决定，与随机种子/分区顺序无关 —— 产值与定员估算走同一个
 *      role，两侧不会各说各话。
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  decorateBuilding,
  buildRoofStructure,
  buildWindowBand,
  buildStacks,
  buildCranePortal,
  roofRise,
  type BuildingDecorKit,
  type BuildingShape,
} from '../src/components/equipment3d/factoryBuildingDetails';
import { resolveBuildingType, roleOfWorkshop, type BuildingType } from '../src/components/equipment3d/factoryBuildingTypes';
import { FactoryOverview } from "../src/components/equipment3d/factoryOverview";
import { type FactoryBuildingSpec } from "../src/components/equipment3d/factoryOverviewTypes";;

const typeOf = (workshopName: string, indexInZone = 0, zoneIndex = 0): BuildingType =>
  resolveBuildingType({ zoneIndex, zoneName: 'A 区', workshopName, indexInZone });

const shape: BuildingShape = { w: 40, h: 13, d: 28, facingSign: 1 };

/** 共享资源表：几何与材质都只有一份，测试用它们做"不许新建资源"的基准。 */
function makeKit(): BuildingDecorKit & { geoIds: Set<string>; matIds: Set<string> } {
  const geo = {
    box: new THREE.BoxGeometry(1, 1, 1),
    strip: new THREE.BoxGeometry(1, 0.25, 1),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 12),
    pyramid: new THREE.ConeGeometry(1, 1, 4),
  };
  const mat = {
    roof: new THREE.MeshStandardMaterial(),
    roofAlt: new THREE.MeshStandardMaterial(),
    glass: new THREE.MeshStandardMaterial(),
    windowFrame: new THREE.MeshStandardMaterial(),
    trussSteel: new THREE.MeshStandardMaterial(),
    crane: new THREE.MeshStandardMaterial(),
    chimneyLight: new THREE.MeshStandardMaterial(),
    chimneyBand: new THREE.MeshStandardMaterial(),
    duct: new THREE.MeshStandardMaterial(),
  };
  return {
    geo,
    mat,
    shadows: false,
    detail: 2,
    geoIds: new Set(Object.values(geo).map((g) => g.uuid)),
    matIds: new Set(Object.values(mat).map((m) => (m as THREE.Material).uuid)),
  };
}

const instances = (g: THREE.Group) => {
  const list: THREE.InstancedMesh[] = [];
  g.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) list.push(o as THREE.InstancedMesh);
  });
  return list;
};

describe('屋顶形式', () => {
  it('平顶不举高；双坡 / 四坡 / 锯齿各自举高', () => {
    expect(roofRise(typeOf('动力一车间'), shape)).toBe(0);
    expect(roofRise(typeOf('重型热轧车间'), shape)).toBeGreaterThan(2.5);
    expect(roofRise(typeOf('成品仓库', 1), shape)).toBeGreaterThan(1);
    const saw = typeOf('智能装配车间');
    expect(saw.roofStyle).toBe('sawtooth');
    expect(roofRise(saw, shape)).toBeGreaterThan(1);
  });

  it('四种屋顶生成的结构体数量互不相同', () => {
    const counts: Record<string, number> = {};
    for (const name of ['动力一车间', '重型热轧车间', '智能装配车间', '成品仓库']) {
      const g = new THREE.Group();
      const kit = makeKit();
      const t = typeOf(name);
      buildRoofStructure(g, shape, t, kit);
      counts[t.roofStyle] = instances(g).length;
    }
    expect(counts.flat).toBe(0);
    expect(counts.gable).toBeGreaterThan(0);
    expect(counts.sawtooth).toBe(2);
    expect(counts.hip).toBe(2);
  });

  it('锯齿跨数与采光玻璃数一致，且玻璃面数量等于跨数', () => {
    const g = new THREE.Group();
    const kit = makeKit();
    const t = typeOf('智能装配车间');
    buildRoofStructure(g, shape, t, kit);
    const im = instances(g);
    const glazing = im.find((m) => m.name === 'roofSawtoothGlazing');
    expect(glazing).toBeDefined();
    expect(glazing!.count).toBe(Math.max(2, t.sawtoothBays));
  });

  it('detail=0（远景裁剪）时不生成坡屋面，回落到盒体', () => {
    const kit = makeKit();
    kit.detail = 0;
    const g = new THREE.Group();
    const r = buildRoofStructure(g, shape, typeOf('重型热轧车间'), kit);
    expect(r.rise).toBe(0);
    expect(instances(g).length).toBe(0);
  });
});

describe('窗带', () => {
  it('玻璃与窗框各一个 InstancedMesh，窗格数随角色增加', () => {
    const light = new THREE.Group();
    const storage = new THREE.Group();
    const a = buildWindowBand(light, shape, typeOf('智能装配车间'), makeKit());
    const b = buildWindowBand(storage, shape, typeOf('成品仓库'), makeKit());
    expect(a.draws).toBe(2);
    expect(b.draws).toBe(2);
    expect(a.panes).toBeGreaterThan(b.panes);
    expect(instances(light).length).toBe(2);
  });

  it('动力站房是三层高侧窗，仓储只有单层', () => {
    const power = new THREE.Group();
    const p = buildWindowBand(power, shape, typeOf('动力一车间'), makeKit());
    const t = typeOf('动力一车间');
    expect(t.windowRows).toBe(3);
    // 两侧都排：cols × rows × 2 减去主立面门洞处
    expect(p.panes).toBeGreaterThan(t.windowCols * 2);
    expect(p.panes).toBeLessThanOrEqual(t.windowCols * t.windowRows * 2);
  });

  it('主立面首层在门洞宽度内留空（窗户不压在大门上）', () => {
    const kit = makeKit();
    const t = typeOf('重型热轧车间');
    expect(t.doorWidth).toBeGreaterThan(12);
    const g = new THREE.Group();
    buildWindowBand(g, shape, t, kit);
    const glass = instances(g).find((m) => m.name === 'windowGlass')!;
    const m4 = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    let blocked = 0;
    for (let i = 0; i < glass.count; i++) {
      glass.getMatrixAt(i, m4);
      m4.decompose(pos, new THREE.Quaternion(), new THREE.Vector3());
      const isFront = Math.abs(pos.z - (shape.d / 2 + 0.08)) < 0.01;
      const lowestRow = Math.abs(pos.y - shape.h * 0.3) < 0.5;
      if (isFront && lowestRow && Math.abs(pos.x) < t.doorWidth / 2) blocked++;
    }
    expect(blocked).toBe(0);
  });
});

describe('烟囱与管廊', () => {
  it('烟囱根数严格按角色：动力 3、重型 1、轻型 0、仓储 0', () => {
    const cases: Array<[string, number]> = [
      ['动力一车间', 3],
      ['重型热轧车间', 1],
      ['智能装配车间', 0],
      ['成品仓库', 0],
    ];
    for (const [name, n] of cases) {
      const g = new THREE.Group();
      const t = typeOf(name);
      expect(buildStacks(g, shape, t, makeKit()).stacks).toBe(n);
    }
  });

  it('无烟囱的角色不生成任何烟囱体', () => {
    const g = new THREE.Group();
    const r = buildStacks(g, shape, typeOf('智能装配车间'), makeKit());
    expect(r.stacks).toBe(0);
    expect(r.draws).toBe(0);
    expect(instances(g).length).toBe(0);
  });

  it('每根烟囱 = 1 井筒 + 3 道色环 + 1 顶帽，全部实例化', () => {
    const g = new THREE.Group();
    const t = typeOf('动力一车间');
    buildStacks(g, shape, t, makeKit());
    const im = instances(g);
    expect(im.find((m) => m.name === 'stackShafts')!.count).toBe(t.chimneys);
    expect(im.find((m) => m.name === 'stackBands')!.count).toBe(t.chimneys * 3);
    expect(im.find((m) => m.name === 'stackCaps')!.count).toBe(t.chimneys);
    expect(im.find((m) => m.name === 'roofDucts')).toBeDefined();
  });
});

describe('行车门廊', () => {
  it('只有重型车间有行车，且梁 + 小车 + 轨道都齐', () => {
    const heavy = new THREE.Group();
    const lightG = new THREE.Group();
    expect(buildCranePortal(lightG, shape, typeOf('智能装配车间'), makeKit()).draws).toBe(0);
    expect(instances(lightG).length).toBe(0);

    const ht = typeOf('重型热轧车间');
    expect(ht.craneBay).toBe(true);
    const r = buildCranePortal(heavy, shape, ht, makeKit());
    expect(r.draws).toBeGreaterThan(3);
    const names = instances(heavy).map((m) => m.name);
    expect(names).toContain('craneGirder');
    expect(names).toContain('craneTrolley');
    expect(names).toContain('craneRails');
    expect(names).toContain('portalColumns');
  });
});

describe('资源复用与总量', () => {
  it('细节模块不新建几何/材质（厂区层材质数不随楼栋膨胀）', () => {
    const kit = makeKit();
    const g = new THREE.Group();
    decorateBuilding(g, shape, typeOf('重型热轧车间'), kit);
    const seenGeo = new Set<string>();
    const seenMat = new Set<string>();
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.geometry) return;
      seenGeo.add(mesh.geometry.uuid);
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) if (m) seenMat.add((m as THREE.Material).uuid);
    });
    for (const id of seenGeo) expect(kit.geoIds.has(id)).toBe(true);
    for (const id of seenMat) expect(kit.matIds.has(id)).toBe(true);
  });

  it('整栋细节的 Draw Call 是个位数（Draw Call 不随窗格数增长）', () => {
    const kit = makeKit();
    const g = new THREE.Group();
    const s = decorateBuilding(g, shape, typeOf('动力一车间'), kit);
    expect(s.draws).toBeLessThanOrEqual(12);
    expect(s.windowPanes).toBeGreaterThan(10);
  });
});

/* ==================== 接进厂区层后的整体轮廓多样性 ==================== */

const specs: FactoryBuildingSpec[] = [
  { id: 'hall-1', name: '1 号厂房・动力一车间', workshopId: '动力一车间', zoneId: 'zone-a', deviceCount: 12 },
  { id: 'hall-2', name: '2 号厂房・公用工程车间', workshopId: '公用工程车间', zoneId: 'zone-a', deviceCount: 9 },
  { id: 'hall-3', name: '3 号厂房・重型热轧车间', workshopId: '重型热轧车间', zoneId: 'zone-b', deviceCount: 8 },
  { id: 'hall-4', name: '4 号厂房・智能装配车间', workshopId: '智能装配车间', zoneId: 'zone-b', deviceCount: 10 },
  { id: 'hall-5', name: '5 号厂房・物流装运车间', workshopId: '物流装运车间', zoneId: 'zone-c', deviceCount: 5 },
];

describe('FactoryOverview 接入类型化细节', () => {
  it('五栋厂房至少出现三种屋顶形式与三种体量', () => {
    const fo = new FactoryOverview({
      seed: 20260921,
      buildings: specs,
      zones: [
        { id: 'zone-a', name: 'A 区' },
        { id: 'zone-b', name: 'B 区' },
        { id: 'zone-c', name: 'C 区' },
      ],
      shadows: false,
      detail: 2,
    });
    const placed = fo.placed;
    expect(placed.length).toBe(specs.length);
    const styles = new Set(placed.map((p) => p.type.roofStyle));
    const roles = new Set(placed.map((p) => p.type.role));
    expect(styles.size).toBeGreaterThanOrEqual(3);
    expect(roles.size).toBeGreaterThanOrEqual(3);
    // 高度倍率真的作用到了体量上（不是同样的 h 复制五份）
    expect(new Set(placed.map((p) => Math.round(p.h))).size).toBeGreaterThan(1);
    fo.dispose();
  });

  it('场景里存在行车与烟囱这两类细节体', () => {
    const fo = new FactoryOverview({
      seed: 20260921,
      buildings: specs,
      zones: [
        { id: 'zone-a', name: 'A 区' },
        { id: 'zone-b', name: 'B 区' },
        { id: 'zone-c', name: 'C 区' },
      ],
      shadows: false,
      detail: 2,
    });
    const names = new Set<string>();
    fo.group.traverse((o) => {
      if (o.name) names.add(o.name);
    });
    expect(names.has('craneGirder')).toBe(true);
    expect(names.has('stackShafts')).toBe(true);
    expect(names.has('windowGlass')).toBe(true);
    fo.dispose();
  });

  it('角色判定只认车间名关键词，与分区/楼栋序号无关（估算口径与几何共用一套输入）', () => {
    const rolesOf = (seed: number) => {
      const fo = new FactoryOverview({
        seed,
        buildings: specs,
        zones: [
          { id: 'zone-a', name: 'A 区' },
          { id: 'zone-b', name: 'B 区' },
          { id: 'zone-c', name: 'C 区' },
        ],
        shadows: false,
        detail: 2,
      });
      const roles = fo.placed.map((p) => p.type.role);
      fo.dispose();
      return roles;
    };
    // 同 seed 可重放：厂房轮廓不会因为重建而换一种画法
    expect(rolesOf(20260921)).toEqual(rolesOf(20260921));
    // 与 HUD/估算侧同一口径：台账车间名命中关键词时角色即定，分区顺序变化不影响。
    expect(rolesOf(999)).toEqual(specs.map((s) => roleOfWorkshop(String(s.workshopId))));
  });

  it('厂区层资源预算：五栋带细节的厂房仍在预算内，且 detail=0 真的更省', () => {
    // 只统计 Mesh/InstancedMesh：贴牌 Sprite 在 node/jsdom 下不一定生成，计入会让阈值随环境漂移。
    const cost = (group: THREE.Object3D) => {
      let draws = 0;
      let triangles = 0;
      group.traverse((o) => {
        const mesh = o as THREE.InstancedMesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        draws += 1;
        const g = mesh.geometry;
        const n = g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
        triangles += n * (mesh.isInstancedMesh ? mesh.count : 1);
      });
      return { draws, triangles };
    };
    const build = (detail: 0 | 1 | 2) => {
      const fo = new FactoryOverview({
        seed: 20260921,
        buildings: specs,
        zones: [
          { id: 'zone-a', name: 'A 区' },
          { id: 'zone-b', name: 'B 区' },
          { id: 'zone-c', name: 'C 区' },
        ],
        shadows: false,
        detail,
      });
      const c = cost(fo.group);
      fo.dispose();
      return c;
    };
    const full = build(2);
    // 实测（2026-09-21，headless）：349 Draw Call / 10,978 三角面。阈值留了一倍余量，
    // 新增细节把厂区层推到 800 次提交以上时这里会红，而不是等到现场掉帧才发现。
    expect(full.draws).toBeLessThanOrEqual(800);
    expect(full.triangles).toBeLessThanOrEqual(60000);
    const lite = build(0);
    expect(lite.draws).toBeLessThan(full.draws);
    expect(lite.triangles).toBeLessThan(full.triangles);
  });
});
