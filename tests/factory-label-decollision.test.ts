/**
 * 厂区总览层贴牌「去重叠」回归（第二轮布局验收 #49）。
 *
 * 浏览器面板 hidden → 截不到 3D，所以这里复刻 scene.frameFactory() 的取景相机
 * （FOV 46 / phi 0.92 / theta 0.72π / radius 反解），把每块贴牌投影成屏幕矩形，
 * 再两两做矩形相交测试。贴牌是恒定屏幕尺寸（sizeAttenuation:false），
 * 窄视口下相对更挤，故同时验收 16:9 与 4:3 两档。
 *
 * ⚠️ 相机参数与 factoryOverview.ts 的 ZONE_SIGN_ANCHORS / GATE_SIGN_OFFSET 是一对
 *    耦合常量：改了取景就得重跑 scratch/label-overlap-probe.ts 重新标定锚点。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import { FactoryOverview } from '../src/components/equipment3d/factoryOverview';
import type {
  FactoryBuildingSpec,
  FactoryZoneSpec,
} from '../src/components/equipment3d/factoryOverview';

const SPECS: FactoryBuildingSpec[] = [
  { id: 'h1', name: '1 号厂房・动力一车间', zoneId: 'zone-a', deviceCount: 8, outputValue: 900, staffCount: 14, estimated: true },
  { id: 'h2', name: '2 号厂房・重型热轧车间', zoneId: 'zone-a', deviceCount: 10, outputValue: 780, staffCount: 15, estimated: true },
  { id: 'h3', name: '3 号厂房・精密机加车间', zoneId: 'zone-b', deviceCount: 12, outputValue: 660, staffCount: 16, estimated: true },
  { id: 'h4', name: '4 号厂房・智能装配车间', zoneId: 'zone-b', deviceCount: 14, outputValue: 540, staffCount: 17, estimated: true },
  { id: 'h5', name: '5 号厂房・成品立体库', zoneId: 'zone-c', deviceCount: 16, outputValue: 420, staffCount: 18, estimated: true },
];
const ZONES: FactoryZoneSpec[] = [
  { id: 'zone-a', name: 'A 区' },
  { id: 'zone-b', name: 'B 区' },
  { id: 'zone-c', name: 'C 区' },
];

/** node 里够用就好的 canvas 桩：让贴牌真的建出 Sprite，而不是走 typeof document 兜底。 */
function installCanvasStub(): () => void {
  const g = globalThis as unknown as { document?: unknown };
  const prev = g.document;
  const ctx = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === 'measureText') return (text: string) => ({ width: String(text).length * 22 });
        if (key === 'canvas') return null;
        return () => ({ addColorStop: () => undefined });
      },
      set: () => true,
    }
  );
  g.document = {
    createElement: (tag: string) =>
      tag === 'canvas' ? { width: 1, height: 1, getContext: () => ctx } : {},
  };
  return () => {
    if (prev === undefined) delete g.document;
    else g.document = prev;
  };
}

interface ScreenBox {
  tag: string;
  cx: number;
  cy: number;
  hw: number;
  hh: number;
}

/** 两个屏幕矩形的净距（px）：负数 = 穿透深度，即重叠。 */
function gap(a: ScreenBox, b: ScreenBox): number {
  return Math.max(
    Math.abs(a.cx - b.cx) - (a.hw + b.hw),
    Math.abs(a.cy - b.cy) - (a.hh + b.hh)
  );
}

type Overview = {
  extent: { halfX: number; halfZ: number; height: number };
  group: THREE.Group;
  dispose: () => void;
};

/** 按 frameFactory() 的取景把可见贴牌投影成屏幕矩形。 */
function projectLabels(fo: Overview, viewW: number, viewH: number): ScreenBox[] {
  const { halfX, halfZ, height } = fo.extent;
  const FOV = 46;
  const vFov = (FOV * Math.PI) / 180;
  const aspect = viewW / viewH;
  const needZ = halfZ / Math.tan(vFov / 2);
  const needX = halfX / (Math.tan(vFov / 2) * Math.max(0.35, aspect));
  const radius = Math.min(900, Math.max(40, Math.max(needX, needZ) * 1.05));
  const phi = 0.92;
  const theta = Math.PI * 0.72;
  const target = new THREE.Vector3(0, height * 0.35, 0);
  const camera = new THREE.PerspectiveCamera(FOV, aspect, 1, 2600);
  camera.position.set(
    target.x + radius * Math.sin(phi) * Math.sin(theta),
    target.y + radius * Math.cos(phi),
    target.z + radius * Math.sin(phi) * Math.cos(theta)
  );
  camera.lookAt(target);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  // sizeAttenuation:false → three 在着色器里按 scale *= -mvPosition.z 补偿 →
  // 屏幕半宽 = P00·scale.x/2（NDC）· 视口半宽，与视深无关。
  const P00 = camera.projectionMatrix.elements[0];
  const P11 = camera.projectionMatrix.elements[5];

  const boxes: ScreenBox[] = [];
  fo.group.updateMatrixWorld(true);
  fo.group.traverse((o) => {
    if (!(o instanceof THREE.Sprite) || !o.visible) return;
    const world = new THREE.Vector3();
    o.getWorldPosition(world);
    const view = world.clone().applyMatrix4(camera.matrixWorldInverse);
    if (view.z >= -0.1) return; // 相机背后
    const ndc = world.clone().project(camera);
    const mat = o.material as THREE.SpriteMaterial;
    const depth = mat.sizeAttenuation ? 1 / -view.z : 1;
    const parentName = o.parent?.name ?? '';
    const tag = parentName.startsWith('factoryGate:')
      ? `gate:${parentName.slice('factoryGate:'.length)}`
      : parentName === 'plot:underConstruction'
        ? 'construction'
        : `zoneSign:${(o.userData as { zoneId?: string }).zoneId ?? '?'}`;
    boxes.push({
      tag,
      cx: ((ndc.x + 1) / 2) * viewW,
      cy: ((1 - ndc.y) / 2) * viewH,
      hw: ((P00 * o.scale.x * depth) / 2) * (viewW / 2),
      hh: ((P11 * o.scale.y * depth) / 2) * (viewH / 2),
    });
  });
  return boxes;
}

let restoreDom: () => void = () => undefined;

beforeAll(() => {
  restoreDom = installCanvasStub();
});
afterAll(() => restoreDom());

function build(): Overview {
  return new FactoryOverview({
    seed: 20260921,
    buildings: SPECS,
    zones: ZONES,
    shadows: false,
    detail: 2,
  });
}

describe('厂区总览贴牌布局', () => {
  /** [视口宽, 视口高, 该档要求的大字牌最小净距]；窄屏贴牌相对更大，门槛放低。 */
  const VIEWS: Array<[number, number, number]> = [
    [1920, 1080, 80],
    [1024, 768, 40],
    [860, 800, 40],
  ];

  for (const [w, h, minRequired] of VIEWS) {
    it(`${w}×${h}：3 分区牌 + 4 出入口牌 + 1 在建牌两两不重叠，净距 ≥${minRequired}px`, () => {
      const fo = build();
      const boxes = projectLabels(fo, w, h);
      fo.dispose();
      expect(boxes.length).toBe(8);
      const bad: string[] = [];
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const g = gap(boxes[i], boxes[j]);
          if (g < minRequired) bad.push(`${boxes[i].tag}↔${boxes[j].tag}=${g.toFixed(0)}`);
        }
      }
      expect(bad).toEqual([]);
    });

    it(`${w}×${h}：A/B/C 三块区牌互距 ≥80px（本轮验收点名要错开的一组）`, () => {
      const fo = build();
      const boxes = projectLabels(fo, w, h);
      fo.dispose();
      const zone = boxes.filter((b) => b.tag.startsWith('zoneSign'));
      expect(zone.length).toBe(3);
      for (let i = 0; i < zone.length; i++) {
        for (let j = i + 1; j < zone.length; j++) {
          expect(gap(zone[i], zone[j])).toBeGreaterThanOrEqual(80);
        }
      }
    });
  }

  it('三块分区牌落在三种不同的高度带上（同带就会挤成一条横线）', () => {
    const fo = build();
    const ys: number[] = [];
    fo.group.traverse((o) => {
      if ((o.userData as { kind?: string }).kind === 'zoneSign') ys.push(o.position.y);
    });
    fo.dispose();
    expect(ys.length).toBe(3);
    expect(new Set(ys).size).toBe(3);
  });
});
