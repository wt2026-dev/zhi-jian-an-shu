import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { buildEquipment } from '../src/components/equipment3d/equipment';
import { EquipmentScene, DEFAULT_PARAMS } from '../src/components/equipment3d/scene';
import { FaultChain } from '../src/components/equipment3d/faultChain';
import { WorkerFlow } from '../src/components/equipment3d/workerFlow';
import { CameraRig } from '../src/components/equipment3d/cameraRig';
import { SCENE_PRESETS } from '../src/components/equipment3d/styles';
import { Hall } from '../src/components/equipment3d/hall';
import { setGeoLod } from '../src/components/equipment3d/parts';

function fixture() {
  setGeoLod(1);
  const preset = SCENE_PRESETS.industrial;
  const hall = new Hall(preset, { seed: 3, spacing: 1, highlight: false, quality: 'medium' }, 3);
  const devices = [{ id: 'eq-105', status: 'running' }, { id: 'unknown', category: '泵类设备', status: 'overhauling' }];
  const slots = hall.layout(2, 'grid', 1, 1);
  const eq = buildEquipment({ preset, hall, slots, devices, seed: 3, highlight: true, shadows: false, detail: 1, equipmentScale: 1 });
  return { eq, hall, slots, devices };
}
function harness() {
  const f = fixture();
  const s = Object.create(EquipmentScene.prototype) as any;
  const camera = new THREE.PerspectiveCamera(46, 1.6, 0.6, 2600);
  Object.assign(s, {
    equipment: f.eq, hall: f.hall, slots: f.slots, devices: f.devices,
    isolationId: null, focusedId: null, isolationVisibility: new Map(),
    params: { ...DEFAULT_PARAMS }, camera,
    rig: new CameraRig(camera, () => null),
    hallGroup: new THREE.Group(), propsGroup: new THREE.Group(),
    workOrderGroup: new THREE.Group(), safety: { group: new THREE.Group() }, helperGroup: new THREE.Group(),
    faultChain: new FaultChain(), workers: new WorkerFlow(), grid: new THREE.Group(), selectionRing: new THREE.Group(),
    fluidFlow: { setIsolation: vi.fn() }, fitRadius: 100,
    renderer: { setSize: vi.fn(), setPixelRatio: vi.fn() }, container: { clientWidth: 960, clientHeight: 600 },
    postFx: { syncComposerSize: vi.fn(), isSoftwareRenderer: () => false },
    lights: { ambient: null, hemi: null, sun: null, skyMesh: null },
  });
  for (const name of ['floor', 'apron', 'structure', 'lanes', 'piperacks']) {
    const obj = new THREE.Group(); obj.name = name; s.hallGroup.add(obj);
  }
  return { ...f, s };
}
afterEach(() => vi.unstubAllGlobals());

// Reconstruct a local AABB from actual part geometry, independent of the production box metadata.
function localBounds(eq: ReturnType<typeof buildEquipment>, id: string) {
  eq.group.updateMatrixWorld(true);
  const dev = eq.group.getObjectByName(`device:${id}`)!;
  const inverse = dev.matrixWorld.clone().invert();
  const bounds = new THREE.Box3();
  for (const part of eq.getDevicePartInfo(id)!) {
    if (!part.geo.boundingBox) part.geo.computeBoundingBox();
    bounds.union(part.geo.boundingBox!.clone().applyMatrix4(inverse.clone().multiply(part.matrix)));
  }
  return { bounds, dev };
}

describe('actual geometry focus bounds', () => {
  it('keeps asymmetric recipe and fallback centers, proxy extents, and repeated scaling synchronized', () => {
    const { eq, slots } = fixture();
    for (const scale of [1, 2.5, 0.7, 0.7]) {
      const moved = slots.map((slot, i) => ({ ...slot, x: 13 + i * 20, z: -7, angle: 1.2 }));
      eq.updateTransforms!(moved, () => 4, scale);
      eq.group.updateMatrixWorld(true);
      for (const id of ['eq-105', 'unknown']) {
        const info = eq.boxById.get(id)!;
        const { bounds, dev } = localBounds(eq, id);
        const center = bounds.getCenter(new THREE.Vector3()).applyMatrix4(dev.matrixWorld);
        const size = bounds.getSize(new THREE.Vector3()).multiplyScalar(info.scale);
        expect([info.centerX, info.centerY, info.centerZ]).toEqual(expect.arrayContaining([expect.any(Number)]));
        expect(new THREE.Vector3(info.centerX, info.centerY, info.centerZ).distanceTo(center)).toBeLessThan(1e-5);
        expect(info.w).toBeCloseTo(size.x); expect(info.h).toBeCloseTo(size.y); expect(info.d).toBeCloseTo(size.z);
        const pick = eq.picks[info.index] as THREE.Mesh;
        expect(pick.position.distanceTo(center)).toBeLessThan(1e-5);
        const proxySize = new THREE.Box3().setFromBufferAttribute(pick.geometry.getAttribute('position') as THREE.BufferAttribute).getSize(new THREE.Vector3()).multiply(pick.scale);
        expect(proxySize.x).toBeCloseTo(info.w * 1.1);
        expect(proxySize.y).toBeCloseTo(info.h * 1.05);
        const ray = new THREE.Raycaster(center.clone().add(new THREE.Vector3(0, 0, 100)), new THREE.Vector3(0, 0, -1));
        expect(ray.intersectObject(pick).length).toBeGreaterThan(0);
      }
    }
  });

  it('focuses the actual center, refits narrow resize, and restores overview zoom limits', () => {
    const { s, eq } = harness();
    s.setIsolation('eq-105');
    const b = eq.boxById.get('eq-105')!;
    expect(s.rig.state.target.toArray()).toEqual([b.centerX, b.centerY, b.centerZ]);
    const oldRadius = s.rig.state.radius;
    expect(s.rig.state.minRadius).toBeLessThan(oldRadius);
    expect(s.rig.state.maxRadius).toBeLessThan(620);
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    s.container.clientWidth = 180;
    s.resize();
    expect(s.rig.state.radius).toBeGreaterThan(oldRadius);
    // Every rotated box corner must fit the actual aspect, not a clamped landscape aspect.
    s.update(10); s.camera.updateMatrixWorld(true);
    for (const x of [-b.w / 2, b.w / 2]) for (const y of [-b.h / 2, b.h / 2]) for (const z of [-b.d / 2, b.d / 2]) {
      const corner = new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.slots[b.index].angle).add(s.rig.state.target).project(s.camera);
      // FILL 已按「场景密度优先」调到 1.0（设备约占画面高度 40-50%）；
      // 雾内缩放上限只约束用户滚轮/双指，不约束自动取景，角点仍须精确适配。
      expect(Math.abs(corner.x)).toBeLessThanOrEqual(1.06); expect(Math.abs(corner.y)).toBeLessThanOrEqual(1.06);
    }
    s.setIsolation(null);
    expect(s.rig.state.minRadius).toBe(3); expect(s.rig.state.maxRadius).toBe(620);
  });

  it('hides clutter while retaining floor and restores visibility plus latest toggles', () => {
    const { s } = harness();
    s.propsGroup.visible = false;
    s.setIsolation('eq-105'); s.setIsolation('unknown');
    for (const key of ['propsGroup', 'workOrderGroup', 'helperGroup']) expect(s[key].visible).toBe(false);
    expect(s.workers.group.visible).toBe(false);
    expect(s.safety.group.visible).toBe(false);
    expect(s.hallGroup.getObjectByName('floor').visible).toBe(true);
    expect(s.hallGroup.getObjectByName('structure').visible).toBe(false);
    s.setWorkerVisible(true); s.setSafetyBoundaryVisible(true);
    expect(s.workers.group.visible).toBe(false); expect(s.safety.group.visible).toBe(false);
    s.setSafetyBoundaryVisible(false); s.params.showGrid = false;
    s.setIsolation(null);
    expect(s.propsGroup.visible).toBe(false); expect(s.workers.group.visible).toBe(true);
    expect(s.workOrderGroup.visible).toBe(true); expect(s.safety.group.visible).toBe(false);
    expect(s.grid.visible).toBe(false); expect(s.helperGroup.visible).toBe(true);
    expect(s.hallGroup.getObjectByName('structure').visible).toBe(true);
  });

  it('shows independent real observations without causal lines or flow nodes', () => {
    const { s } = harness();
    const texts: string[] = [];
    s.createFaultLabel = (text: string) => { texts.push(text); return new THREE.Group(); };
    s.buildFaultChain('eq-105', [{ temperature: 110, vibration: 12, loadRate: 99 }], [{ priority: 'urgent' }]);
    expect(texts.length).toBeGreaterThan(1);
    expect(texts.every(text => text.includes('观测'))).toBe(true);
    expect(texts.some(text => text.includes('非部件故障结论'))).toBe(true);
    expect(s.faultChain.group.children.some((obj: THREE.Object3D) => /fault-(line|flow|node)/.test(obj.name) || obj.type === 'Line')).toBe(false);
    texts.length = 0;
    s.buildFaultChain('eq-105', [{ temperature: NaN }], [{ priority: 'urgent' }]);
    expect(s.faultChain.group.children).toHaveLength(0);
  });
});
