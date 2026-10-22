/**
 * 聚焦层环境层的"崩溃不黑屏"不变量。
 *
 * 背景：设备详情层进入时会隐藏车间灯光层并由环境层自带聚光灯照亮设备。
 * 环境层（DeviceDetailEnv）是 40 多个构件的堆叠，一旦某节构造抛错，
 * 旧实现会让整层既没有物件也没有灯 —— 用户看到的就是"点进设备后全黑"。
 * 这里用 mock 强制环境层抛错，验证：
 *   1) 场景自有的基础光（环境光 + 半球光 + 兜底补光）仍然存在并被抬起；
 *   2) 暗调氛围（雾 / 清屏色）照常生效；
 *   3) 退出聚焦时氛围与基础光成对还原，不把暗淡状态带回车间层。
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('../src/components/equipment3d/deviceDetailEnv', () => {
  class BrokenEnv {
    group = new THREE.Group();
    constructor() {
      throw new TypeError("Cannot read properties of undefined (reading 'group')");
    }
    update(): void {}
    dispose(): void {}
  }
  return { DeviceDetailEnv: BrokenEnv };
});

import { EquipmentScene, DEFAULT_PARAMS } from '../src/components/equipment3d/scene';

function harness() {
  const s = Object.create(EquipmentScene.prototype) as any;
  Object.assign(s, {
    params: { ...DEFAULT_PARAMS },
    slots: [{ angle: 0.4 }],
    scene: new THREE.Scene(),
    renderer: { setClearColor: vi.fn() },
    ambient: new THREE.AmbientLight(0xffffff, 0.6),
    hemi: new THREE.HemisphereLight(0xdfe6ea, 0x50555a, 0.7),
    sun: new THREE.DirectionalLight(0xffffff, 1),
    focusDecorGroup: new THREE.Group(),
    focusDecor: null,
    focusBaseLights: null,
    moodBackup: null,
    postFx: { isSoftwareRenderer: () => true },
  });
  s.ambient.intensity = 0.6;
  s.hemi.intensity = 0.7;
  s.sun.intensity = 1;
  return s;
}

const BOX = { x: 1, z: 2, y: 0, w: 3, h: 2, d: 2, centerX: 1, centerZ: 2, index: 0 } as any;

describe('focus layer survives a broken device environment', () => {
  it('keeps base lighting and mood when the env layer throws', () => {
    const s = harness();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    s.buildFocusDecor(BOX);

    expect(s.focusDecor).toBeNull();
    expect(err).toHaveBeenCalled();
    const lights = s.focusDecorGroup.getObjectByName('focusBaseLights');
    expect(lights).toBeTruthy();
    const kinds = lights.children.filter((o: THREE.Object3D) => (o as THREE.Light).isLight).map((o: THREE.Object3D) => o.type);
    expect(kinds).toEqual(expect.arrayContaining(['AmbientLight', 'HemisphereLight', 'SpotLight']));
    // 兜底补光必须顶上（环境层的那盏主聚光不会存在）
    const fill = lights.children.find((o: THREE.Object3D) => (o as THREE.SpotLight).isLight && o.type === 'SpotLight') as THREE.SpotLight;
    expect(fill.intensity).toBeGreaterThan(0);
    // 氛围照常：雾 + 压暗后的车间灯
    expect(s.scene.fog).toBeTruthy();
    expect(s.ambient.intensity).toBeLessThan(0.6);
    expect(s.renderer.setClearColor).toHaveBeenCalled();
    err.mockRestore();
  });

  it('restores mood and drops base lights on exit even without the env layer', () => {
    const s = harness();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    s.buildFocusDecor(BOX);
    s.disposeFocusDecor();
    expect(s.focusBaseLights).toBeNull();
    expect(s.focusDecorGroup.children).toHaveLength(0);
    expect(s.scene.fog).toBeNull();
    expect(s.ambient.intensity).toBeCloseTo(0.6);
    expect(s.moodBackup).toBeNull();
    err.mockRestore();
  });
});
