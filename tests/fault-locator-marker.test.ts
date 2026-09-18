// @vitest-environment jsdom
/**
 * L3 单设备故障定位标回归守卫（对标参考图 r3）。
 *
 * 锁的是"看得见"这件事的可程序化部分：
 *   1. 除了 Sprite 文字标，还必须有**红色实体高亮**（光晕球 + 扫描环 + 落地光柱）——
 *      早期实现只有 Sprite，对照 r3 的"故障件发红"是缺的；
 *   2. 高亮材质一律 depthTest:false —— 故障部位常被外壳/管线挡住，
 *      不关深度测试就永远看不见；
 *   3. Sprite 材质必须 sizeAttenuation:false —— three r186 把该语义翻转过
 *      （true = 世界尺寸，远景缩成亚像素），漏写等于标签不存在；
 *   4. 定位标与镜头对准点之间的偏移固定为 +0.6，聚焦逻辑依赖它；
 *   5. clear / setFaults([]) / dispose 必须把 Sprite 与实体高亮一起摘干净，不留悬挂引用。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { FaultLocator, type FaultAnchor } from '../src/components/equipment3d/faultLocator';

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
  };
}

beforeAll(() => {
  const proto = (globalThis as unknown as { HTMLCanvasElement?: { prototype: { getContext: unknown } } })
    .HTMLCanvasElement?.prototype;
  if (proto) proto.getContext = () => makeCtxStub();
});

const ANCHOR: FaultAnchor = { deviceId: 'eq-101', partName: '主轴轴承', x: 12, y: 5, z: -8 };

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); });
  return out;
}

describe('FaultLocator 红色实体高亮', () => {
  it('一条定位标 = 1 个 Sprite 标签 + 3 个红色网格（光晕/扫描环/光柱）', () => {
    const fl = new FaultLocator();
    fl.setFaults([ANCHOR]);
    expect(fl.markerCount).toBe(1);

    const sprites: THREE.Sprite[] = [];
    fl.group.traverse((o) => { if ((o as THREE.Sprite).isSprite) sprites.push(o as THREE.Sprite); });
    expect(sprites.length).toBe(1);
    // Sprite 与实体高亮都挂在 group 下：早期只有 1 个子节点。
    expect(fl.group.children.length).toBe(2);
    const marker = fl.group.children.find((o) => o.userData?.kind === 'faultMarker');
    expect(marker).toBeTruthy();

    const meshes = meshesOf(marker!);
    expect(meshes.length).toBe(3);
    fl.dispose();
  });

  it('高亮材质为红色且 depthTest 关闭（被外壳挡住时也看得见）', () => {
    const fl = new FaultLocator();
    fl.setFaults([ANCHOR]);
    const marker = fl.group.children.find((o) => o.userData?.kind === 'faultMarker')!;
    for (const m of meshesOf(marker)) {
      const mat = m.material as THREE.MeshBasicMaterial;
      expect(mat.depthTest, '高亮必须 depthTest:false，否则被设备外壳挡住就看不见').toBe(false);
      expect(mat.color.r).toBeGreaterThan(0.6);
      expect(mat.color.g).toBeLessThan(0.6);
      expect(mat.color.b).toBeLessThan(0.6);
    }
    fl.dispose();
  });

  it('Sprite 标签必须 sizeAttenuation:false（r186 语义翻转，漏写等于标签不可见）', () => {
    const fl = new FaultLocator();
    fl.setFaults([ANCHOR]);
    const sp = fl.group.children.find((o) => (o as THREE.Sprite).isSprite) as THREE.Sprite;
    expect((sp.material as THREE.SpriteMaterial).sizeAttenuation).toBe(false);
    fl.dispose();
  });

  it('标签贴图为 640×260 两行布局（单行长文本会把部位名挤出画面）', () => {
    const fl = new FaultLocator();
    fl.setFaults([ANCHOR]);
    const sp = fl.group.children.find((o) => (o as THREE.Sprite).isSprite) as THREE.Sprite;
    const img = (sp.material as THREE.SpriteMaterial).map?.image as { width: number; height: number } | undefined;
    expect(img).toBeTruthy();
    expect(img!.width).toBe(640);
    expect(img!.height).toBe(260);
    fl.dispose();
  });

  it('标签尺寸受控 + 锚点落在图标上（否则标签会超出画面 / 准星偏离故障点）', () => {
    const fl = new FaultLocator();
    fl.setFaults([ANCHOR]);
    const sp = fl.group.children.find((o) => (o as THREE.Sprite).isSprite) as THREE.Sprite;
    // sizeAttenuation:false ⇒ 屏幕宽度占比 ≈ scale/(2·aspect·tan(fov/2))，
    // scale 到 1 就已经接近半个屏宽了；历史值 2.6/3.4 会让标签宽到 1.8 个屏、
    // 右半截必然被裁掉（实测 1304px 画布上标签宽 2373px）。
    expect(sp.scale.x).toBeLessThan(1);
    // 锚点必须与圆圈图标对齐（贴图 X=100/640），文字才能从故障点向右展开；
    // 默认的 (0.5,0.5) 会把准星甩到故障点左边约 0.34 个标签宽处。
    expect(sp.center.x).toBeCloseTo(100 / 640, 5);
    expect(sp.center.y).toBeCloseTo(0.5, 5);
    // 脉冲放大后仍不得失控
    for (let t = 0; t < 40; t++) fl.update(0.016, t * 0.2);
    expect(sp.scale.x).toBeLessThan(1);
    fl.dispose();
  });

  it('光柱从地面指到锚点：高度随锚点 y 走', () => {
    const fl = new FaultLocator();
    fl.setFaults([{ ...ANCHOR, y: 5 }]);
    const marker = fl.group.children.find((o) => o.userData?.kind === 'faultMarker')!;
    const beam = marker.children.find((o) => o.userData?.kind === 'faultBeam') as THREE.Mesh;
    expect(beam.scale.y).toBeCloseTo(5, 5);
    expect(beam.position.y).toBeCloseTo(-2.5, 5);

    // 同一台设备换部位：锚点抬高后光柱要跟着变，不能沿用旧高度
    fl.setFaults([{ ...ANCHOR, y: 9 }]);
    expect(beam.scale.y).toBeCloseTo(9, 5);
    fl.dispose();
  });

  it('focusPointOf 返回锚点 +0.6 抬升（相机聚焦依赖该偏移）', () => {
    const fl = new FaultLocator();
    fl.setFaults([ANCHOR]);
    const p = fl.focusPointOf('eq-101');
    expect(p).not.toBeNull();
    expect(p!.x).toBe(12);
    expect(p!.y).toBeCloseTo(5.6, 5);
    expect(p!.z).toBe(-8);
    expect(fl.focusPointOf('eq-999')).toBeNull();
    fl.dispose();
  });

  it('update 会呼吸/自转（不是静止贴图）', () => {
    const fl = new FaultLocator();
    fl.setFaults([ANCHOR]);
    const marker = fl.group.children.find((o) => o.userData?.kind === 'faultMarker')!;
    const [halo, ring] = meshesOf(marker);
    const haloMat = halo.material as THREE.MeshBasicMaterial;
    const before = haloMat.opacity;
    const ringRot = ring.rotation.z;
    fl.update(0.016, 1.7);
    expect(haloMat.opacity).not.toBe(before);
    expect(ring.rotation.z).not.toBe(ringRot);
    // 亮度上限：太亮会糊成一块红饼，看不出"是哪个零件"
    for (let t = 0; t < 40; t++) fl.update(0.016, t * 0.13);
    expect(haloMat.opacity).toBeLessThan(0.85);
    fl.dispose();
  });

  it('clear / setFaults([]) / dispose 都把 Sprite 与实体高亮一起摘干净', () => {
    const fl = new FaultLocator();
    fl.setFaults([ANCHOR, { ...ANCHOR, deviceId: 'eq-102' }]);
    expect(fl.group.children.length).toBe(4);

    fl.clear('eq-101');
    expect(fl.activeDeviceIds).toEqual(['eq-102']);
    expect(fl.group.children.length).toBe(2);

    fl.setFaults([]);
    expect(fl.markerCount).toBe(0);
    expect(fl.group.children.length).toBe(0);

    fl.setFaults([ANCHOR]);
    fl.dispose();
    expect(fl.group.children.length).toBe(0);
    expect(fl.markerCount).toBe(0);
  });

  it('右侧放不下时标签翻到左侧展开（预生成镜像贴图 + 锚点换到镜像图标）', () => {
    const fl = new FaultLocator();
    // 相机在 +Z 看向原点：锚点 x>0 ⇒ 投影在画面右半 ⇒ 应翻到左侧
    fl.setFaults([{ ...ANCHOR, x: 5, y: 0, z: 0 }]);
    const sp = fl.group.children.find((o) => (o as THREE.Sprite).isSprite) as THREE.Sprite;
    const mat = sp.material as THREE.SpriteMaterial;
    const normalMap = mat.map;

    const cam = new THREE.PerspectiveCamera(50, 1.6, 0.1, 200);
    cam.position.set(0, 0, 14);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();

    fl.update(0.016, 0, cam);
    const mirroredMap = mat.map;
    expect(mirroredMap).not.toBe(normalMap);            // 换成了镜像贴图
    expect(sp.center.x).toBeCloseTo((640 - 100) / 640, 5); // 锚点挪到右侧图标上
    const mirroredCenter = sp.center.x;

    // 锚点明显偏左时回到右侧展开
    fl.setFaults([{ ...ANCHOR, x: -9, y: 0, z: 0 }]);
    fl.update(0.016, 0, cam);
    expect(sp.center.x).toBeCloseTo(100 / 640, 5);
    expect(sp.center.x).not.toBeCloseTo(mirroredCenter, 3);
    fl.dispose();
  });

  it('重复 setFaults 不累积节点（同一设备只更新不新增）', () => {
    const fl = new FaultLocator();
    for (let i = 0; i < 5; i++) fl.setFaults([{ ...ANCHOR, y: 3 + i }]);
    expect(fl.markerCount).toBe(1);
    expect(fl.group.children.length).toBe(2);
    fl.dispose();
  });
});
