/**
 * 程序化数字人（EngineerModel）几何护栏。
 *
 * 背景：数字人从写实 GLB 切回自研程序化 3D 后，形象完全靠这些几何参数撑着。
 * 最容易踩、又最难在肉眼截图里发现的坑是「帽壳 / 刘海 / 护目镜把眉眼糊掉」——
 * 一旦眉眼被挡，观感立刻退回"没有表情的头"（用户此前两次反馈的核心痛点）。
 * 所以这里用相机视线求交把"正脸必须看得见"钉死。
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { buildEngineerModel, PERSONA_CONFIGS } from '../src/components/digital-human/EngineerModel';

/** 与 DigitalHuman3D.tsx 的 CAM_POS 保持一致（下面有一条源码字符串护栏盯着这两个数） */
const CAMERA_AT = new THREE.Vector3(0, -0.24, 7.9);
/** 同样取自 DigitalHuman3D.tsx：视线目标与竖直张角，用来算"画面能装下多高的人" */
const CAM_TARGET = new THREE.Vector3(0, -0.74, 0);
const CAM_FOV = 39;
/** 舞台实际像素（DigitalHumanAvatar 的 h-[286px] sm:h-[322px] × 262 宽），投影要按像素判 */
const STAGE_W = 262;
const STAGE_H = 322;

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

  it('有下半身：双腿 + 劳保鞋踩在同一地平线上', () => {
    const { model } = mount('zhang');
    const legs = model.group.getObjectByName('legsGroup');
    expect(legs, '找不到 legsGroup（下半身整段缺失 = 又是方块人）').toBeTruthy();
    for (const name of ['dh-leg-l', 'dh-leg-r']) {
      const leg = legs!.getObjectByName(name);
      expect(leg, `缺少 ${name}`).toBeTruthy();
    }
    const rootBox = new THREE.Box3().setFromObject(model.group);
    for (const name of ['dh-leg-l', 'dh-leg-r']) {
      const legBox = new THREE.Box3().setFromObject(legs!.getObjectByName(name)!);
      // 两只鞋底必须站在同一条线上，否则人物像在空中踩台阶
      expect(Math.abs(legBox.min.y - rootBox.min.y), `${name} 没有落地`).toBeLessThan(0.02);
    }
  });

  it('站高在 6.8~7.6 个头之间（正常成人，不是大头 Q 版）', () => {
    const { model } = mount('zhang');
    const rootBox = new THREE.Box3().setFromObject(model.group);
    // 解剖学站高＝颅顶→鞋底，不含安全帽（帽壳会让比例虚高 0.3）
    const headBox = new THREE.Box3().setFromObject(model.headGroup.getObjectByName('dh-skull')!);
    const headH = headBox.max.y - headBox.min.y;
    const ratio = (headBox.max.y - rootBox.min.y) / headH;
    expect(ratio).toBeGreaterThan(6.8);
    expect(ratio).toBeLessThan(7.6);
  });

  it('髋以下（腿+鞋）与髋以上到颅顶相当，腿不是装饰', () => {
    const { model } = mount('zhang');
    const rootBox = new THREE.Box3().setFromObject(model.group);
    const crownY = new THREE.Box3().setFromObject(model.headGroup.getObjectByName('dh-skull')!).max.y;
    const hipY = -0.63; // 髋骨中心，见 EngineerModel 下半身段落
    const belowHip = hipY - rootBox.min.y; // 髋 → 鞋底
    const aboveHip = crownY - hipY; // 髋 → 颅顶（不含帽）
    expect(belowHip, '髋以下不足 1.8，等于没有腿').toBeGreaterThan(1.8);
    expect(belowHip / aboveHip, '腿长/上身比明显失调').toBeGreaterThan(0.85);
    expect(belowHip / aboveHip, '腿长/上身比明显失调').toBeLessThan(1.15);
  });

  it('手有关节化的掌 + 四指 + 拇指，不是一只方块手套', () => {
    const { model } = mount('zhang');
    for (const [arm, handName] of [[model.leftArm, 'dh-hand-l'], [model.rightArm, 'dh-hand-r']] as const) {
      const hand = arm.getObjectByName(handName);
      expect(hand, `手臂末端没有手，只有管子（缺 ${handName}）`).toBeTruthy();
      let meshes = 0;
      hand!.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes++;
      });
      // 掌 + 4 指 + 拇指 + 袖口
      expect(meshes, '手指体块不足，仍是方块手套').toBeGreaterThanOrEqual(7);
    }
  });

  it('右胯挂着工具袋（干活的人最直接的记号）', () => {
    const { model } = mount('zhang');
    const bag = model.group.getObjectByName('dh-toolbag');
    expect(bag, '找不到工具袋').toBeTruthy();
    let meshes = 0;
    bag!.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    expect(meshes, '工具袋只剩一个壳，没有袋口/隔层/提带').toBeGreaterThanOrEqual(8);
    const box = new THREE.Box3().setFromObject(bag!);
    // 挂在右侧（+x）腰带以下、膝以上。上沿量到的是扳手/螺丝刀的手柄
    // （工具从袋口露出来是刻意的），所以卡 −0.42 而不是袋体自身的 −0.51。
    expect(box.min.x, '工具袋不在右胯').toBeGreaterThan(0);
    expect(box.max.y, '工具袋/工具高过腰带').toBeLessThan(-0.42);
    expect(box.min.y, '工具袋垂到膝盖以下').toBeGreaterThan(-2.58);
  });

  it('上衣 / 裤子 / 鞋三色分层（同色＝连体服观感，就是"一块蓝色方块"）', () => {
    for (const id of Object.keys(PERSONA_CONFIGS)) {
      const c = PERSONA_CONFIGS[id];
      expect(c.trouserColor, `${id} 裤子与上衣同色`).not.toBe(c.overallColor);
      expect(c.bootColor, `${id} 鞋与裤子同色`).not.toBe(c.trouserColor);
      const boot = new THREE.Color(c.bootColor);
      const trouser = new THREE.Color(c.trouserColor);
      const lum = (x: THREE.Color) => 0.2126 * x.r + 0.7152 * x.g + 0.0722 * x.b;
      expect(lum(boot), `${id} 鞋比裤子还亮，站不住`).toBeLessThan(lum(trouser));
    }
  });

  it('脸上有颧骨 / 下颌角 / 下巴骨点（不是气球贴五官）', () => {
    const { model } = mount('zhang');
    for (const name of ['dh-cheek-l', 'dh-cheek-r', 'dh-chin']) {
      expect(model.headGroup.getObjectByName(name), `缺少面部骨点 ${name}`).toBeTruthy();
    }
    // 骨点全部压在眼睛以下，不参与遮挡眉眼
    const eyeY = worldPos(model.leftEye).y;
    for (const name of ['dh-cheek-l', 'dh-cheek-r', 'dh-chin']) {
      expect(worldPos(model.headGroup.getObjectByName(name)!).y, `${name} 抬高到眉眼区间`).toBeLessThan(eyeY);
    }
  });

  it('呼吸动画不会拉长下半身（腿挂在 root 而不是 torsoGroup）', () => {
    const { model } = mount('zhang');
    expect(model.group.getObjectByName('legsGroup')?.parent).toBe(model.group);
    expect(model.torsoGroup.getObjectByName('legsGroup'), '腿在 torsoGroup 里 = 呼吸时腿会跟着伸缩').toBeUndefined();
  });

  it('整机位取景：从头到鞋全部入画（画面下沿留给声波条）', () => {
    const { model } = mount('zhang');
    const box = new THREE.Box3().setFromObject(model.group);
    // 与 DigitalHuman3D.tsx 同一口径，而且**必须用真投影**：上一版按视线中心平面手算，
    // 说帽顶留了 0.14 余量，截图实测却被上沿切掉 8.8px —— 帽檐前沿 z≈0.71 比该平面近 10%，
    // 投影比平面估计更靠外。凡是判"入不入画"，一律走 PerspectiveCamera.project。
    const cam = new THREE.PerspectiveCamera(CAM_FOV, STAGE_W / STAGE_H, 0.1, 100);
    cam.position.copy(CAMERA_AT);
    cam.lookAt(CAM_TARGET);
    // project() 读的是 matrixWorldInverse，不刷新矩阵就等于拿一台没转过去的相机算投影
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    // 取人体最靠前的一层（z = box.max.z），它最容易被画面边沿切掉
    const px = (y: number) =>
      ((1 - new THREE.Vector3(0, y, box.max.z).project(cam).y) / 2) * STAGE_H;
    const topPx = px(box.max.y);
    const footPx = px(box.min.y);
    expect(topPx, '安全帽顶被上沿切掉').toBeGreaterThanOrEqual(10);
    expect(STAGE_H - footPx, '鞋底压住画面下沿的声波条').toBeGreaterThanOrEqual(42);
    // 人是主角，不是缩在画面中间的小图标
    expect((footPx - topPx) / STAGE_H, '人体占画面高度不足').toBeGreaterThan(0.8);
  });

  it('机位常量没和组件漂移（改了 DigitalHuman3D 就必须同步这份护栏）', () => {
    const file = fileURLToPath(
      new URL('../src/components/digital-human/DigitalHuman3D.tsx', import.meta.url),
    );
    const src = fs.readFileSync(file, 'utf8');
    // 这份护栏拿 CAMERA_AT 去求交、判入画；组件用的是另一份数。两者一旦分叉，
    // 测试绿着而画面切头 —— 已经发生过一次，所以把"同步"从注释升级成断言。
    expect(src, 'CAM_POS 与测试 CAMERA_AT 不一致').toContain(
      `new THREE.Vector3(0, ${CAMERA_AT.y}, ${CAMERA_AT.z})`,
    );
    expect(src, 'CAM_TARGET 与测试 CAM_TARGET 不一致').toContain(
      `new THREE.Vector3(0, ${CAM_TARGET.y}, ${CAM_TARGET.z})`,
    );
    expect(src, 'FOV 与测试 CAM_FOV 不一致').toContain(`const FOV = ${CAM_FOV}`);
  });
});
