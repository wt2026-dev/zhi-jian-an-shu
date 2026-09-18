import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEVICE_RECIPES, RECIPE_IDS } from '../src/components/equipment3d/deviceProfiles';
import { buildEquipment, type DeviceLike, type EquipmentBuild } from '../src/components/equipment3d/equipment';
import { Hall } from '../src/components/equipment3d/hall';
import {
  finitePartTelemetry,
  getPartEvidence,
  PART_EVIDENCE_COLOURS,
  PART_OBSERVATION_ZONES,
  type PartEvidenceState,
  type PartTelemetry,
} from '../src/components/equipment3d/partEvidence';
import { geoLod, setGeoLod } from '../src/components/equipment3d/parts';
import { SCENE_PRESETS } from '../src/components/equipment3d/styles';

const LEDGER_IDS = Array.from({ length: 16 }, (_, i) => `eq-${101 + i}`);
const HEALTHY = { temperature: 40, vibration: 1, loadRate: 50 };
const ABNORMAL = { temperature: 110, vibration: 4.5, loadRate: 95 };
type EvidenceMesh = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
const builds: EquipmentBuild[] = [];
let previousLod: number;

beforeEach(() => {
  previousLod = geoLod();
  setGeoLod(0);
});

afterEach(() => {
  // No renderer/GPU is needed. Release per-build objects without disposing shared recipe/plate caches.
  for (const build of builds.splice(0)) {
    const materials = new Set<THREE.Material>();
    build.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (!object.geometry.userData.shared) object.geometry.dispose();
      if (!object.name.startsWith('plate:')) {
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(material);
        }
      }
    });
    materials.forEach((material) => material.dispose());
    build.group.clear();
  }
  setGeoLod(previousLod);
});

function industrialBuild(devices: DeviceLike[], detail = 0): EquipmentBuild {
  setGeoLod(detail);
  const preset = SCENE_PRESETS.industrial;
  const seed = 20240914;
  const hall = new Hall(preset, { seed, spacing: 1, highlight: true, quality: 'low' }, seed);
  const build = buildEquipment({
    preset, hall, devices, seed, detail,
    slots: hall.layout(devices.length, preset.layout.pattern, 1, preset.morphology.equipmentScale),
    highlight: true,
    shadows: false,
    equipmentScale: preset.morphology.equipmentScale,
  });
  builds.push(build);
  return build;
}

function overlay(build: EquipmentBuild, id: string): EvidenceMesh {
  const mesh = build.group.getObjectByName(`evidence:${id}`);
  expect(mesh, `${id} evidence overlay`).toBeInstanceOf(THREE.Mesh);
  return mesh as EvidenceMesh;
}

function visibleOverlays(build: EquipmentBuild): string[] {
  const names: string[] = [];
  build.group.traverseVisible((object) => {
    if (object.name.startsWith('evidence:')) names.push(object.name);
  });
  return names.sort();
}

function expectZoneRendering(build: EquipmentBuild, id: string, states: PartEvidenceState[]): void {
  const mesh = overlay(build, id);
  const colours = mesh.geometry.getAttribute('evidenceColor');
  const breath = mesh.geometry.getAttribute('evidenceBreath');
  const parts = build.getDevicePartInfo(id)!;
  let offset = 0;
  expect(states).toHaveLength(PART_OBSERVATION_ZONES[id].length);
  PART_OBSERVATION_ZONES[id].forEach((zone, index) => {
    const geo = parts.find((part) => part.key === zone.partKey)!.geo;
    const count = geo.index?.count ?? geo.getAttribute('position').count;
    const state = states[index];
    const available = state !== 'unavailable';
    const colour = new THREE.Color(available ? PART_EVIDENCE_COLOURS[state] : 0);
    const valid = Array.from({ length: count }, (_, i) => offset + i).every((i) =>
      Math.abs(colours.getX(i) - colour.r) < 1e-6
      && Math.abs(colours.getY(i) - colour.g) < 1e-6
      && Math.abs(colours.getZ(i) - colour.b) < 1e-6
      && Math.abs(colours.getW(i) - (available ? 0.56 : 0)) < 1e-6
      && breath.getX(i) === (['warning', 'maintenance', 'fault'].includes(state) ? 1 : 0));
    expect(valid, `${id}/${zone.partKey} colour, alpha and breathing`).toBe(true);
    offset += count;
  });
  expect(colours.count).toBe(offset);
  expect(breath.count).toBe(offset);
  expect(mesh.visible).toBe(states.some((state) => state !== 'unavailable'));
}

function values(build: EquipmentBuild, id: string): Array<number | null> {
  return build.getPartEvidence(id)!.map((item) => item.value);
}

describe('part evidence observation zones and finite readings', () => {
  it('covers exactly all 16 recipes with existing static keys available even at low detail', () => {
    expect(Object.keys(PART_OBSERVATION_ZONES).sort()).toEqual(LEDGER_IDS);
    expect(RECIPE_IDS.slice().sort()).toEqual(LEDGER_IDS);
    for (const id of LEDGER_IDS) {
      const zones = PART_OBSERVATION_ZONES[id];
      const parts = DEVICE_RECIPES[id].build();
      expect(zones.length).toBeGreaterThan(0);
      expect(zones.length).toBeLessThanOrEqual(3);
      expect(new Set(zones.map((zone) => zone.partKey)).size).toBe(zones.length);
      for (const zone of zones) {
        const matches = parts.filter((part) => part.key === zone.partKey);
        expect(matches, `${id}/${zone.partKey}`).toHaveLength(1);
        expect(matches[0].anim).toBeUndefined();
        expect(matches[0].detailMin ?? 0).toBe(0);
        expect(['temp', 'vibration', 'loadRate']).toContain(zone.metric);
      }
      for (const evidence of getPartEvidence(id, HEALTHY)) {
        expect(evidence.source).toBe('device-telemetry');
        expect(evidence.relation).toBe('observation-zone');
        expect(evidence.label).toContain('非部件诊断');
      }
    }
    expect(getPartEvidence('eq-999', HEALTHY)).toEqual([]);
  });

  it.each([undefined, null, NaN, Infinity, -Infinity, '0', '', false])(
    'rejects invalid reading %s without inventing a healthy zero', (value) => {
      const point = { temperature: value, vibration: value, loadRate: value } as unknown as PartTelemetry;
      expect(finitePartTelemetry(point)).toEqual({});
      for (const item of getPartEvidence('eq-101', point, 'running')) {
        expect(item).toMatchObject({ value: null, state: 'unavailable', thresholdStatus: null });
        expect(item.label).toContain('暂无读数');
      }
    },
  );

  it('keeps finite zero and negative values, honours temperature precedence, and copies input', () => {
    expect(finitePartTelemetry(null)).toEqual({});
    expect(finitePartTelemetry(undefined)).toEqual({});
    const point = { temp: 65, temperature: 0, vibration: 0, loadRate: 0 };
    const copy = finitePartTelemetry(point);
    expect(copy).toEqual({ temperature: 0, vibration: 0, loadRate: 0 });
    point.temperature = 120;
    expect(copy.temperature).toBe(0);
    expect(finitePartTelemetry({ temp: -5 })).toEqual({ temperature: -5 });
    expect(finitePartTelemetry({ temp: 65, temperature: NaN })).toEqual({});
    expect(getPartEvidence('eq-101', copy).map((item) => [item.value, item.state]))
      .toEqual([[0, 'healthy'], [0, 'healthy'], [0, 'healthy']]);
  });

  it('classifies each metric independently and preserves fault evidence during maintenance', () => {
    const point = { temperature: 110, vibration: 4.5, loadRate: 0 };
    expect(getPartEvidence('eq-101', point).map((item) => [item.state, item.thresholdStatus]))
      .toEqual([['fault', 'critical'], ['warning', 'warning'], ['healthy', null]]);
    for (const status of ['overhauling', 'maintenance', 'repair', 'overhaul', ' MAINTENANCE ']) {
      expect(getPartEvidence('eq-101', point, status).map((item) => item.state))
        .toEqual(['fault', 'maintenance', 'maintenance']);
      expect(getPartEvidence('eq-101', null, status).every((item) =>
        item.value === null && item.state === 'unavailable' && item.thresholdStatus === null
        && item.label.includes('暂无读数') && item.label.includes('非部件诊断'))).toBe(true);
    }
  });
});

describe('industrial equipment evidence refresh and isolation', () => {
  it.each([0, 1, 2])('builds all 16 devices at detail %i with at most one single-material overlay per device', (detail) => {
    const build = industrialBuild(LEDGER_IDS.map((id) => ({ id, status: 'running', telemetry: HEALTHY })), detail);
    expect(build.boxById.size).toBe(16);
    expect(build.partEvidenceMeshCount).toBe(16);
    expect(visibleOverlays(build)).toHaveLength(16);
    const meshes: THREE.Object3D[] = [];
    build.group.traverse((object) => { if (object.name.startsWith('evidence:')) meshes.push(object); });
    expect(meshes).toHaveLength(16);
    for (const id of LEDGER_IDS) {
      const mesh = overlay(build, id);
      expect(mesh.parent?.name).toBe(`device:${id}`);
      expect(Array.isArray(mesh.material)).toBe(false);
      expect(mesh.geometry.groups).toHaveLength(0);
      expect(build.boxById.get(id)?.scale).toBe(SCENE_PRESETS.industrial.morphology.equipmentScale);
      expectZoneRendering(build, id, PART_OBSERVATION_ZONES[id].map(() => 'healthy'));
    }
  });

  it('keeps missing readings hidden even in maintenance, and real zero visible but static', () => {
    const build = industrialBuild([{ id: 'eq-101', status: 'running' }]);
    const mesh = overlay(build, 'eq-101');
    expectZoneRendering(build, 'eq-101', ['unavailable', 'unavailable', 'unavailable']);
    expect(visibleOverlays(build)).toEqual([]);
    build.animate(3);
    expect(mesh.material.uniforms.time.value).toBe(0);
    build.setStatusOverride('eq-101', 'overhauling');
    expectZoneRendering(build, 'eq-101', ['unavailable', 'unavailable', 'unavailable']);
    build.animate(4);
    expect(mesh.material.uniforms.time.value).toBe(0);
    build.clearStatusOverrides();
    build.updateTelemetry('eq-101', { temperature: 0, vibration: 0, loadRate: 0 });
    expectZoneRendering(build, 'eq-101', ['healthy', 'healthy', 'healthy']);
    build.animate(5);
    expect(mesh.material.uniforms.time.value).toBe(0);
  });

  it.each([
    { state: 'warning', status: 'running', temperature: 80 },
    { state: 'fault', status: 'running', temperature: 110 },
    { state: 'maintenance', status: 'overhauling', temperature: 40 },
  ] as const)('animates $state evidence and stops immediately when healthy or missing', ({ state, status, temperature }) => {
    const build = industrialBuild([{ id: 'eq-101', status, telemetry: { temperature } }]);
    const mesh = overlay(build, 'eq-101');
    expectZoneRendering(build, 'eq-101', [state, 'unavailable', 'unavailable']);
    build.animate(2);
    expect(mesh.material.uniforms.time.value).toBe(2);
    build.animate(4);
    expect(mesh.material.uniforms.time.value).toBe(4);
    build.setStatusOverride('eq-101', 'running');
    build.updateTelemetry('eq-101', HEALTHY);
    expectZoneRendering(build, 'eq-101', ['healthy', 'healthy', 'healthy']);
    build.animate(6);
    expect(mesh.material.uniforms.time.value).toBe(4);
    build.updateTelemetry('eq-101', null);
    expectZoneRendering(build, 'eq-101', ['unavailable', 'unavailable', 'unavailable']);
    build.animate(8);
    expect(mesh.material.uniforms.time.value).toBe(4);
  });

  it('fully replaces telemetry, clears stale metrics and nulls, and does not mutate earlier snapshots', () => {
    const build = industrialBuild([{ id: 'eq-101', telemetry: HEALTHY }]);
    const before = build.getPartEvidence('eq-101')!;
    const replacement = { temp: 110 };
    build.updateTelemetry('eq-101', replacement);
    replacement.temp = 0;
    expect(values(build, 'eq-101')).toEqual([110, null, null]);
    expect(before.map((item) => item.value)).toEqual([40, 1, 50]);
    expect(Object.isFrozen(before)).toBe(true);
    expect(before.every(Object.isFrozen)).toBe(true);
    expectZoneRendering(build, 'eq-101', ['fault', 'unavailable', 'unavailable']);
    build.updateTelemetry('eq-101', { vibration: 1 });
    expect(values(build, 'eq-101')).toEqual([null, 1, null]);
    build.updateTelemetry('eq-101', null);
    expect(values(build, 'eq-101')).toEqual([null, null, null]);
    expectZoneRendering(build, 'eq-101', ['unavailable', 'unavailable', 'unavailable']);
    build.updateTelemetry('eq-101', HEALTHY);
    build.updateTelemetry('eq-101', { temperature: NaN, vibration: Infinity, loadRate: -Infinity });
    expectZoneRendering(build, 'eq-101', ['unavailable', 'unavailable', 'unavailable']);
  });

  it('patches one metric without clearing others and never changes another device or build', () => {
    const devices = [{ id: 'eq-101', telemetry: HEALTHY }, { id: 'eq-102', telemetry: HEALTHY }];
    const build = industrialBuild(devices);
    const otherBuild = industrialBuild(devices);
    const otherSnapshot = build.getPartEvidence('eq-102');
    expect(overlay(build, 'eq-101').geometry).not.toBe(overlay(otherBuild, 'eq-101').geometry);
    expect(overlay(build, 'eq-101').material).not.toBe(overlay(otherBuild, 'eq-101').material);
    build.setPartTelemetry('eq-101', 'temp', 110);
    expect(values(build, 'eq-101')).toEqual([110, 1, 50]);
    build.setPartTelemetry('eq-101', 'vibration', null);
    build.setPartTelemetry('eq-101', 'loadRate', NaN);
    expect(values(build, 'eq-101')).toEqual([110, null, null]);
    expectZoneRendering(build, 'eq-101', ['fault', 'unavailable', 'unavailable']);
    expect(build.getPartEvidence('eq-102')).toBe(otherSnapshot);
    expectZoneRendering(build, 'eq-102', ['healthy', 'healthy', 'healthy']);
    expectZoneRendering(otherBuild, 'eq-101', ['healthy', 'healthy', 'healthy']);
    expect(values(otherBuild, 'eq-101')).toEqual([40, 1, 50]);
    build.updateTelemetry('unknown', HEALTHY);
    build.setPartTelemetry('unknown', 'temp', 0);
    expect(build.getPartEvidence('unknown')).toBeNull();
    expect(build.partEvidenceMeshCount).toBe(2);
  });

  it('refreshes colours and breathing immediately on override, single clear and clear-all', () => {
    const build = industrialBuild([
      { id: 'eq-101', status: 'running', telemetry: { temperature: 110, vibration: 0 } },
      { id: 'eq-102', status: 'overhauling', telemetry: HEALTHY },
    ]);
    build.setStatusOverride('eq-101', 'overhauling');
    expectZoneRendering(build, 'eq-101', ['fault', 'maintenance', 'unavailable']);
    expect(build.getPartEvidence('eq-101')!.map((item) => item.state))
      .toEqual(['fault', 'maintenance', 'unavailable']);
    build.setStatusOverride('eq-101', null);
    expectZoneRendering(build, 'eq-101', ['fault', 'healthy', 'unavailable']);
    expect(build.activeOverrides.size).toBe(0);
    build.setStatusOverride('eq-101', 'overhauling');
    build.setStatusOverride('eq-102', 'running');
    expectZoneRendering(build, 'eq-102', ['healthy', 'healthy', 'healthy']);
    expect(build.activeOverrides.size).toBe(2);
    build.clearStatusOverrides();
    expect(build.activeOverrides.size).toBe(0);
    expectZoneRendering(build, 'eq-101', ['fault', 'healthy', 'unavailable']);
    expectZoneRendering(build, 'eq-102', ['maintenance', 'maintenance', 'maintenance']);
    build.animate(7);
    expect(overlay(build, 'eq-101').material.uniforms.time.value).toBe(7);
    expect(overlay(build, 'eq-102').material.uniforms.time.value).toBe(7);
  });

  it('reuses the bounded overlay set and isolates visibility and breathing across refreshes', () => {
    const build = industrialBuild(LEDGER_IDS.map((id) => ({ id, status: 'running', telemetry: ABNORMAL })));
    const original = LEDGER_IDS.map((id) => overlay(build, id));
    const drawables = build.drawables;
    build.animate(1);
    build.showOnlyDevice('eq-112');
    expect(build.visibleDeviceCount()).toBe(1);
    expect(visibleOverlays(build)).toEqual(['evidence:eq-112']);
    for (const id of LEDGER_IDS) {
      build.updateTelemetry(id, null);
      build.updateTelemetry(id, ABNORMAL);
    }
    build.animate(2);
    for (const id of LEDGER_IDS) {
      expect(overlay(build, id).material.uniforms.time.value).toBe(id === 'eq-112' ? 2 : 1);
    }
    expect(visibleOverlays(build)).toEqual(['evidence:eq-112']);
    build.hideDeviceInstances('eq-112');
    expect(visibleOverlays(build)).toEqual([]);
    build.animate(3);
    expect(overlay(build, 'eq-112').material.uniforms.time.value).toBe(2);
    build.showDeviceInstances('eq-112');
    expect(visibleOverlays(build)).toEqual(['evidence:eq-112']);
    build.showAllDevices();
    expect(build.visibleDeviceCount()).toBe(16);
    expect(visibleOverlays(build)).toHaveLength(16);
    build.animate(4);
    LEDGER_IDS.forEach((id, index) => {
      expect(overlay(build, id)).toBe(original[index]);
      expect(overlay(build, id).material.uniforms.time.value).toBe(4);
    });
    expect(build.partEvidenceMeshCount).toBe(16);
    expect(build.drawables).toBe(drawables);
  });
});
