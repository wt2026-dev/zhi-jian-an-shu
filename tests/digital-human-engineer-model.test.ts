/**
 * 程序化数字人（EngineerModel）几何护栏。
 *
 * 背景：数字人从写实 GLB 切回自研程序化 3D 后，形象完全靠这些几何参数撑着。
 * 最容易踩、又最难在肉眼截图里发现的坑是「帽壳 / 刘海 / 护目镜把眉眼糊掉」——
 * 一旦眉眼被挡，观感立刻退回"没有表情的头"（用户此前两次反馈的核心痛点）。
 * 所以这里用相机视线求交把"正脸必须看得见"钉死。
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildEngineerModel, PERSONA_CONFIGS } from '../src/components/digital-human/EngineerModel';

/** 与 DigitalHuman3D.tsx 的 CAM_POS 保持一致（机位不许随手改） */
const CAMERA_AT = new THREE.Vector3(0, 0.6, 3.45);

function mount(personaId: string) {
  const model = buildEngineerModel(personaId);
  const scene = new THREE.Scene();
  scene.add(model.group);
  scene.updateMatrixWorld(true);
  return { model, scene };
}

/** 从机位朝目标点打一条视线，返回第一个命中的物体 */
function firstHitOn(model: ReturnType<typeof buildEngineerModel>, target: THREE.Vector3) {
  const ray = new THREE.Raycaster();
  ray.set(CAMERA_AT, target.clone().sub(CAMERA_AT).normalize());
  const hits = ray.intersectObject(model.group, true);
  return hits[0]?.object ?? null;
}

function isDescendantOf(obj: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = obj;
  while (p) {
    if (p === ancestor) return true;
    p = p.parent;
  }
  return false;
}

function worldPos(obj: THREE.Object3D): THREE.Vector3 {
  return obj.getWorldPosition(new THREE.Vector3());
}

describe('程序化数字人：正脸遮挡护栏', () => {
  for (const personaId of Object.keys(PERSONA_CONFIGS)) {
    it(`${personaId}：双眼从机位看得见（不被帽/发/镜框挡住）`, () => {
      const { model } = mount(personaId);
      for (const eye of [model.leftEye, model.rightEye]) {
        const hit = firstHitOn(model, worldPos(eye));
        expect(hit, '眼睛方向打不到任何物体').not.toBeNull();
        expect(isDescendantOf(hit!, eye), `视线被 ${hit!.name || hit!.type} 挡住`).toBe(true);
      }
    });

    it(`${personaId}：双眉不被帽壳、帽檐、刘海盖住`, () => {
      const { model } = mount(personaId);
      const brows = model.headGroup.children.filter((c) => c.name.startsWith('dh-brow-'));
      expect(brows.length).toBe(2);
      for (const brow of brows) {
        const hit = firstHitOn(model, worldPos(brow));
        expect(hit, '眉毛方向打不到任何物体').not.toBeNull();
        expect(hit!.name, `眉被 ${hit!.name || hit!.type} 挡住`).toBe(brow.name);
      }
    });

    it(`${personaId}：嘴（口型驱动体）看得见`, () => {
      const { model } = mount(personaId);
      const hit = firstHitOn(model, worldPos(model.jaw));
      expect(hit).not.toBeNull();
      expect(hit!.name, `嘴被 ${hit!.name || hit!.type} 挡住`).toBe('dh-jaw');
    });

    it(`${personaId}：安全帽整体悬在眉毛以上，且有整圈帽檐`, () => {
      const { model } = mount(personaId);
      const browY = Math.min(
        worldPos(model.headGroup.getObjectByName('dh-brow-left')!).y,
        worldPos(model.headGroup.getObjectByName('dh-brow-right')!).y,
      );
      // 只量帽壳 + 帽檐，不含贴在球面上的徽章/通风孔（它们的边缘本来就绕到眉侧）
      const shell = model.helmetGroup.children.filter(
        (c) => (c as THREE.Mesh).geometry?.type === 'SphereGeometry' ||
          (c as THREE.Mesh).geometry?.type === 'RingGeometry',
      );
      expect(shell.length, '帽壳 / 帽檐缺一不可').toBe(2);
      const box = new THREE.Box3();
      for (const s of shell) box.expandByObject(s);
      expect(box.min.y, `帽壳下沿 ${box.min.y} 已压到眉毛上沿 ${browY + 0.011}`).toBeGreaterThan(browY + 0.011);
      expect(box.max.y, '帽顶应高于颅顶').toBeGreaterThan(1.3);
    });

    it(`${personaId}：护目镜挂在领口而不是罩在眼睛上`, () => {
      const { model } = mount(personaId);
      const goggles = model.headGroup.getObjectByName('dh-goggles')!;
      const goggleBox = new THREE.Box3().setFromObject(goggles);
      const eyeY = worldPos(model.leftEye).y;
      expect(goggleBox.max.y, '护目镜高过眼睛 = 又罩回脸上了').toBeLessThan(eyeY);
      // 不能整块埋进躯干：护目镜前沿必须在身体表面之外
      const torsoBox = new THREE.Box3().setFromObject(model.torsoGroup);
      expect(goggleBox.min.z, '护目镜陷进胸腔').toBeGreaterThan(-torsoBox.max.z);
    });

    it(`${personaId}：有头发（黑发 + 刘海 + 鬓角），不再是光头戴帽`, () => {
      const { model } = mount(personaId);
      const hairHex = new THREE.Color(PERSONA_CONFIGS[personaId].hairColor).getHexString();
      let hairMeshes = 0;
      model.headGroup.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat?.color?.getHexString() === hairHex) hairMeshes++;
      });
      expect(hairMeshes, '头部找不到同色系头发网格').toBeGreaterThanOrEqual(4);
      expect(model.headGroup.getObjectByName('dh-fringe')).toBeTruthy();
    });

    it(`${personaId}：东亚虹膜深褐近黑，且带同肤色上睑`, () => {
      const { model } = mount(personaId);
      const colors: THREE.Color[] = [];
      model.leftEye.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if ((o as THREE.Mesh).isMesh && mat?.color) colors.push(mat.color.clone());
      });
      // 眼白 / 虹膜 / 瞳孔 / 上睑
      expect(colors.length).toBe(4);
      const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      expect(lum(colors[1]), '虹膜太浅，成了欧美瞳色').toBeLessThan(0.05);
      expect(lum(colors[0]), '眼白不该是死白').toBeLessThan(1);
      const skin = new THREE.Color(PERSONA_CONFIGS[personaId].skinTone);
      const dl = colors[3].clone().sub(skin);
      expect(Math.hypot(dl.r, dl.g, dl.b), '上睑肤色与脸部脱节').toBeLessThan(0.06);
    });
  }
});

describe('程序化数字人：比例与结构不变量', () => {
  it('头肩比保持在写实区间（颅宽 / 肩宽 <0.56，≥0.8 即 Q 版）', () => {
    const { model } = mount('zhang');
    const skull = model.headGroup.getObjectByName('dh-skull')!;
    const headBox = new THREE.Box3().setFromObject(skull);
    const shoulderBox = new THREE.Box3();
    model.torsoGroup.children.forEach((c) => {
      if (Math.abs(c.position.y - 0.55) < 0.01) shoulderBox.union(new THREE.Box3().setFromObject(c));
    });
    const headWidth = headBox.max.x - headBox.min.x;
    const shoulderWidth = shoulderBox.max.x - shoulderBox.min.x;
    expect(headWidth / shoulderWidth).toBeLessThan(0.56);
  });

  it('反光背心是贴合躯干的圆柱壳，不是悬空的桶', () => {
    const { model } = mount('zhang');
    const vest = model.torsoGroup.getObjectByName('dh-vest') as THREE.Mesh | undefined;
    expect(vest, '找不到背心网格').toBeTruthy();
    const geo = vest!.geometry as THREE.CylinderGeometry;
    expect(geo.type).toBe('CylinderGeometry');
    expect(geo.parameters.openEnded).toBe(true);
    // 背心半径必须大于躯干（0.42），否则会陷进工装里
    expect(geo.parameters.radiusTop).toBeGreaterThan(0.42);
  });
});
