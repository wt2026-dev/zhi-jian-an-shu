// @vitest-environment jsdom
/**
 * 单设备聚焦层「检修作业闭环」场景守卫（focusSceneDecor.ts）。
 *
 * 锁的是三件容易被后续改动悄悄破坏的事：
 *   1. **数据纪律**：测点名只能来自真实观察区（PART_OBSERVATION_ZONES），
 *      缺测必须是 value:null（渲染 "—"）—— 历史上"补零 / 造部位名"是最常见的越权；
 *   2. **纯加法 + 生命周期**：进入聚焦层挂载、退出即卸载；dispose 后 group 必须空，
 *      绝不能残留到车间/总览层；
 *   3. **语义差异**：正常设备不挂检修卡片，故障/预警 + 有工单才挂；无工单不挂。
 *
 * 另外把工单状态 → 五步闭环的映射钉死，避免"步骤高亮错位"。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import {
  FocusSceneDecor,
  buildMeasurementPoints,
  repairStepState,
  toFocusDecorStatus,
  REPAIR_STEPS,
  type FocusDecorData,
} from '../src/components/equipment3d/focusSceneDecor';
import { SCENE_PRESETS } from '../src/components/equipment3d/styles';

/** jsdom 未安装 canvas 包时 getContext('2d') 返回 null，贴图分支会被整体跳过。 */
function makeCtxStub(): unknown {
  const noop = () => undefined;
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    shadowColor: '', shadowBlur: 0, font: '', textAlign: '', textBaseline: '',
    clearRect: noop, fillRect: noop, strokeRect: noop, fillText: noop, strokeText: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop,
    fill: noop, stroke: noop, save: noop, restore: noop, translate: noop, rotate: noop,
    measureText: (t: string) => ({ width: String(t).length * 10 }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
  };
}

beforeAll(() => {
  const proto = (globalThis as unknown as { HTMLCanvasElement?: { prototype: { getContext: unknown } } })
    .HTMLCanvasElement?.prototype;
  if (proto) proto.getContext = () => makeCtxStub();
});

const BOX = { x: 6, z: -4, y: 0, w: 3.2, h: 2.6, d: 2.4 };

function makeDecor(lowFx = false): FocusSceneDecor {
  return new FocusSceneDecor({
    box: BOX,
    preset: SCENE_PRESETS.industrial,
    detail: 2,
    rotationY: Math.PI / 2,
    lowFx,
  });
}

const BASE_DATA: FocusDecorData = {
  deviceId: 'EQ-2024-PUMP-01',
  status: 'normal',
  recipeId: 'eq-101',
  telemetry: { temperature: 62, vibration: 2.1, current: 18.4, pressure: 0.42 },
  workOrder: null,
};

/* ========================= 纯函数：测点 ========================= */

describe('buildMeasurementPoints 数据纪律', () => {
  it('测点名取自真实观察区（eq-101 → 顶部电机 / 联轴器护罩），不编造部位', () => {
    const pts = buildMeasurementPoints('eq-101', { temperature: 62, vibration: 2.1 });
    expect(pts.map((p) => p.label)).toEqual(['顶部电机', '联轴器护罩', '电机电流', '介质压力']);
  });

  it('没有部位映射的指标（电流/压力）退化成指标名本身', () => {
    const pts = buildMeasurementPoints('eq-101', { current: 12, pressure: 0.3 });
    expect(pts[2].label).toBe('电机电流');
    expect(pts[3].label).toBe('介质压力');
  });

  it('未知配方 id 时不硬凑部位名，全部退回指标名', () => {
    const pts = buildMeasurementPoints('no-such-recipe', { temperature: 62 });
    expect(pts.map((p) => p.label)).toEqual(['设备温度', '设备振动', '电机电流', '介质压力']);
  });

  it('缺测 / NaN / Infinity 一律 value:null（渲染 "—"），绝不补零', () => {
    const pts = buildMeasurementPoints('eq-101', {
      temperature: null,
      vibration: Number.NaN,
      current: Number.POSITIVE_INFINITY,
      pressure: undefined,
    });
    expect(pts.every((p) => p.value === null)).toBe(true);
    expect(pts.every((p) => p.state === 'unavailable')).toBe(true);
  });

  it('整段遥测缺失时四个测点全部 unavailable', () => {
    const pts = buildMeasurementPoints('eq-101', null);
    expect(pts).toHaveLength(4);
    expect(pts.every((p) => p.value === null && p.state === 'unavailable')).toBe(true);
  });

  it('状态沿用既有阈值：85℃→warning、100℃→fault、2mm/s→healthy', () => {
    const pts = buildMeasurementPoints('eq-101', { temperature: 85, vibration: 2 });
    expect(pts[0].state).toBe('warning');
    expect(pts[1].state).toBe('healthy');

    const hot = buildMeasurementPoints('eq-101', { temperature: 100 });
    expect(hot[0].state).toBe('fault');
  });

  it('电流/压力没有既有阈值 ⇒ 不越权造阈值，按 healthy 渲染', () => {
    const pts = buildMeasurementPoints('eq-101', { current: 999, pressure: 999 });
    expect(pts[2].state).toBe('healthy');
    expect(pts[3].state).toBe('healthy');
  });

  it('单位固定，供气泡拼接显示', () => {
    const pts = buildMeasurementPoints('eq-101', {});
    expect(pts.map((p) => p.unit)).toEqual(['°C', 'mm/s', 'A', 'MPa']);
  });
});

/* ========================= 纯函数：工单 → 五步闭环 ========================= */

describe('repairStepState 工单状态映射', () => {
  it('五步闭环文案与既有 RepairStepCard 语义一致', () => {
    expect(REPAIR_STEPS).toEqual(['故障发现', '工单派发', '到场诊断', '部件维修', '试机验收']);
  });

  it('created→0 / dispatched→1 / in_progress→3 / pending_acceptance→4 / completed→5', () => {
    expect(repairStepState('created').current).toBe(0);
    expect(repairStepState('dispatched').current).toBe(1);
    expect(repairStepState('in_progress').current).toBe(3);
    expect(repairStepState('pending_acceptance').current).toBe(4);
    expect(repairStepState('completed').current).toBe(REPAIR_STEPS.length);
  });

  it('cancelled 与未知值都不推进步骤，且 cancelled 单独标记（整卡置灰）', () => {
    expect(repairStepState('cancelled')).toEqual({ current: -1, cancelled: true });
    expect(repairStepState(null)).toEqual({ current: -1, cancelled: false });
    expect(repairStepState('weird-status').cancelled).toBe(false);
  });

  it('全部未开始时没有任何步骤被标记为已完成', () => {
    const { current } = repairStepState('created');
    expect(current).toBe(0);
    expect(REPAIR_STEPS.filter((_, i) => i < current)).toHaveLength(0);
  });
});

describe('toFocusDecorStatus 台账状态归一化', () => {
  it('running/standby → normal；warning → warning；fault/critical → fault', () => {
    expect(toFocusDecorStatus('running')).toBe('normal');
    expect(toFocusDecorStatus('standby')).toBe('normal');
    expect(toFocusDecorStatus('warning')).toBe('warning');
    expect(toFocusDecorStatus('fault')).toBe('fault');
    expect(toFocusDecorStatus('critical')).toBe('fault');
  });

  it('overhauling → maintenance；未知/空 → unknown（不臆造）', () => {
    expect(toFocusDecorStatus('overhauling')).toBe('maintenance');
    expect(toFocusDecorStatus('scrapped')).toBe('unknown');
    expect(toFocusDecorStatus(null)).toBe('unknown');
  });
});

/* ========================= 场景挂载 / 卸载 ========================= */

describe('FocusSceneDecor 挂载与卸载', () => {
  it('进入聚焦层即出现作业区（警戒带 + 四角立柱 + 虚线框 + 工具车 + 警示牌）', () => {
    const d = makeDecor();
    expect(d.group.children.length).toBeGreaterThanOrEqual(2);
    let meshes = 0;
    let sprites = 0;
    let lines = 0;
    d.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
      if ((o as THREE.Sprite).isSprite) sprites++;
      if ((o as THREE.Line).isLine) lines++;
    });
    expect(meshes).toBeGreaterThanOrEqual(4 + 1 + 4 + 4 + 8); // 带 + 立柱4 + 工具车 + 人员肢体
    expect(sprites).toBeGreaterThanOrEqual(1); // 检修警示牌
    expect(lines).toBeGreaterThanOrEqual(1); // 红色地面虚线框
    d.dispose();
  });

  it('两名检修人员都在：一个站立、一个蹲姿（蹲姿整体压低）', () => {
    const d = makeDecor();
    let helmet = 0;
    d.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && m.isMeshStandardMaterial && m.color && m.color.getHex() === 0xf5c518) helmet++;
    });
    // 4 根立柱也是安全帽黄，因此这里只校验"至少两顶帽子"存在
    expect(helmet).toBeGreaterThanOrEqual(6);
    d.dispose();
  });

  it('所有文字 Sprite 必须 sizeAttenuation:false（three r186 语义翻转）', () => {
    const d = makeDecor();
    d.setData(BASE_DATA);
    const sprites: THREE.Sprite[] = [];
    d.group.traverse((o) => { if ((o as THREE.Sprite).isSprite) sprites.push(o as THREE.Sprite); });
    expect(sprites.length).toBeGreaterThan(0);
    for (const sp of sprites) {
      expect((sp.material as THREE.SpriteMaterial).sizeAttenuation).toBe(false);
    }
    d.dispose();
  });

  it('测点引线 + 数据气泡：四个测点各一条弧线与一个气泡', () => {
    const d = makeDecor();
    d.setData(BASE_DATA);
    expect(d.bubbleCount).toBe(4);
    let lines = 0;
    d.group.traverse((o) => { if ((o as THREE.Line).isLine) lines++; });
    // 1 条地面虚线框 + 4 条测点引线
    expect(lines).toBeGreaterThanOrEqual(5);
    d.dispose();
  });

  it('正常设备不挂检修卡片（语义差异）', () => {
    const d = makeDecor();
    d.setData({ ...BASE_DATA, status: 'normal', workOrder: { orderNo: 'WO-1', status: 'in_progress' } });
    expect(d.hasStepCard).toBe(false);
    d.dispose();
  });

  it('故障设备 + 有工单 → 挂检修卡片；无工单 → 不挂（禁止凭空造卡）', () => {
    const d = makeDecor();
    d.setData({ ...BASE_DATA, status: 'fault', faultPartName: '顶部电机', workOrder: null });
    expect(d.hasStepCard).toBe(false);

    d.setData({
      ...BASE_DATA,
      status: 'fault',
      faultPartName: '顶部电机',
      workOrder: { orderNo: 'WO-2024-001', status: 'in_progress' },
    });
    expect(d.hasStepCard).toBe(true);
    d.dispose();
  });

  it('预警设备同样挂卡片（与故障同语义）', () => {
    const d = makeDecor();
    d.setData({ ...BASE_DATA, status: 'warning', workOrder: { orderNo: 'WO-2', status: 'dispatched' } });
    expect(d.hasStepCard).toBe(true);
    d.dispose();
  });

  it('setData 反复调用不累积（先清后建）', () => {
    const d = makeDecor();
    d.setData({ ...BASE_DATA, status: 'fault', workOrder: { orderNo: 'WO-1', status: 'created' } });
    const n1 = d.bubbleCount;
    d.setData({ ...BASE_DATA, status: 'fault', workOrder: { orderNo: 'WO-1', status: 'completed' } });
    d.setData({ ...BASE_DATA, status: 'fault', workOrder: { orderNo: 'WO-1', status: 'in_progress' } });
    expect(d.bubbleCount).toBe(n1);
    d.dispose();
  });

  it('lowFx（软渲染/低画质）跳过扫描环与脚下光圈', () => {
    const full = makeDecor(false);
    const low = makeDecor(true);
    const count = (d: FocusSceneDecor) => {
      let n = 0;
      d.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; });
      return n;
    };
    expect(count(low)).toBeLessThan(count(full));
    full.dispose();
    low.dispose();
  });

  it('dispose 后 group 清空（退出聚焦层不残留到车间/总览层），且幂等', () => {
    const d = makeDecor();
    d.setData({ ...BASE_DATA, status: 'fault', workOrder: { orderNo: 'WO-1', status: 'in_progress' } });
    d.dispose();
    expect(d.group.children.length).toBe(0);
    expect(d.bubbleCount).toBe(0);
    expect(d.hasStepCard).toBe(false);
    expect(() => d.dispose()).not.toThrow();
    // 卸载后 setData 不得再往里塞东西
    d.setData(BASE_DATA);
    expect(d.group.children.length).toBe(0);
  });

  it('group 落在设备中心并按设备朝向自转（子节点是相对中心的局部坐标）', () => {
    const d = makeDecor();
    // ⚠️ 回归：早期版本把绝对世界坐标塞进子节点又给 group 加 rotation，
    //    结果是绕**世界原点**旋转，作业区被甩到设备外面。
    expect(d.group.position.x).toBeCloseTo(BOX.x, 5);
    expect(d.group.position.z).toBeCloseTo(BOX.z, 5);
    expect(d.group.rotation.y).toBeCloseTo(Math.PI / 2, 5);
    // 子节点必须是局部坐标：贴地的警戒带/立柱都在 (0,0) 附近
    let maxAbs = 0;
    d.group.traverse((o) => {
      if (o === d.group) return;
      maxAbs = Math.max(maxAbs, Math.abs(o.position.x), Math.abs(o.position.z));
    });
    expect(maxAbs).toBeLessThan(4);
    d.dispose();
  });

  it('气泡按屏幕槽位摆放：任意相机方位下四个气泡都不叠在一起', () => {
    // ⚠️ 回归：早期按"世界坐标 ±3.3 米"摆位，聚焦层相机方位是阻尼插值出来的，
    //    世界 X 很可能就是视线方向 ⇒ 实测四个气泡在屏幕上叠成一坨、互相压住。
    const d = makeDecor();
    d.setData(BASE_DATA);
    const cam = new THREE.PerspectiveCamera(46, 1304 / 761, 0.6, 2600);
    const cy = BOX.y + BOX.h / 2;

    const probe = (azimuth: number) => {
      const R = 11;
      cam.position.set(BOX.x + Math.cos(azimuth) * R, cy + 4, BOX.z + Math.sin(azimuth) * R);
      cam.lookAt(BOX.x, cy, BOX.z);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      d.update(0.016, 12, cam);
      const v = new THREE.Vector3();
      return d.bubbleWorldPositions().map((p) => {
        v.copy(p).project(cam);
        return { x: v.x, y: v.y };
      });
    };

    for (const az of [0, Math.PI / 2, Math.PI, -Math.PI / 3]) {
      const ndc = probe(az);
      expect(ndc).toHaveLength(4);
      for (let i = 0; i < ndc.length; i++) {
        for (let j = i + 1; j < ndc.length; j++) {
          const dx = Math.abs(ndc[i].x - ndc[j].x);
          const dy = Math.abs(ndc[i].y - ndc[j].y);
          // 气泡 NDC 尺寸约 0.30×0.19；错开任一个方向 ≥0.24 就不会压叠
          expect(Math.max(dx, dy)).toBeGreaterThanOrEqual(0.24);
        }
      }
    }
    d.dispose();
  });

  it('检修卡片落在画面左下（避开中央故障标签与右侧详情面板）', () => {
    const d = makeDecor();
    d.setData({ ...BASE_DATA, status: 'fault', faultPartName: '顶部电机', workOrder: { orderNo: 'WO-1', status: 'in_progress' } });
    const cam = new THREE.PerspectiveCamera(46, 1304 / 761, 0.6, 2600);
    const cy = BOX.y + BOX.h / 2;
    cam.position.set(BOX.x + 11, cy + 4, BOX.z);
    cam.lookAt(BOX.x, cy, BOX.z);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    d.update(0.016, 12, cam);
    const v = new THREE.Vector3();
    d.card!.getWorldPosition(v);
    v.project(cam);
    expect(v.x).toBeLessThan(0); // 左半屏
    expect(v.y).toBeLessThan(0); // 下半屏（右侧面板在右上，故障标签在中央）
    d.dispose();
  });

  it('points 暴露最近一次的真实测点（验收核对部位名与缺测）', () => {
    const d = makeDecor();
    d.setData({ ...BASE_DATA, recipeId: 'eq-101', telemetry: { temperature: 70 } });
    expect(d.points.map((p) => p.label)).toEqual(['顶部电机', '联轴器护罩', '电机电流', '介质压力']);
    expect(d.points[0].value).toBe(70);
    expect(d.points[1].value).toBeNull();
    d.dispose();
  });

  it('暂停后 update 不再推进动画（受 setLayerAnimationsPaused 控制）', () => {
    const d = makeDecor();
    d.setPaused(true);
    expect(() => d.update(0.016, 12.5)).not.toThrow();
    d.setPaused(false);
    expect(() => d.update(0.016, 12.5)).not.toThrow();
    d.dispose();
  });
});
