import * as THREE from 'three';

export interface PersonaConfig {
  helmetColor: number;
  overallColor: number;
  skinTone: number;
  stripColor: number;
  goggleTint: number;
  hasBeard: boolean;
  badgeAccent: number;
  gloveColor: number;
  /** 头发与眉毛同色系（东亚人种偏冷黑，不是欧美的棕褐） */
  hairColor: number;
}

export interface EngineerModelResult {
  group: THREE.Group;       // root group to add to scene
  headGroup: THREE.Group;   // yaw micro-motion target
  torsoGroup: THREE.Group;  // scale.y breathing target
  helmetGroup: THREE.Group; // 安全帽整组（遮挡校验用：帽不得压住眉眼）
  jaw: THREE.Mesh;          // scaleY for lip sync (0.15=closed, 1.0=open)
  leftEye: THREE.Group;     // scaleY for blink
  rightEye: THREE.Group;    // scaleY for blink
  leftArm: THREE.Group;     // rotation.z for arm gestures
  rightArm: THREE.Group;    // rotation.z for arm gestures
}

/**
 * 人设配色 —— 口径是「中国工业现场的检修总工」：
 * 肤色取东亚暖黄（不带欧美扫描脸的粉调），头发/眉毛冷黑，
 * 工装藏蓝（电力/机械行业通用色），反光背心荧光黄绿 + 银白反光带（GB 20653）。
 */
export const PERSONA_CONFIGS: Record<string, PersonaConfig> = {
  zhang: {
    helmetColor: 0xf0f0f0,      // 白帽 = 总工 / 技术管理，工地通行色
    overallColor: 0x2f4a63,
    skinTone: 0xe3bd93,
    stripColor: 0xc3d92a,
    goggleTint: 0x38bdf8,       // 天蓝护目镜
    hasBeard: false,
    badgeAccent: 0x0ea5e9,
    gloveColor: 0x2d3436,
    hairColor: 0x161318,
  },
  li: {
    helmetColor: 0x2563eb,      // 蓝帽 = 特种作业 / 技术工人
    overallColor: 0x1e3a5f,
    skinTone: 0xe8c49c,
    stripColor: 0xc3d92a,
    goggleTint: 0x10b981,       // 翠绿护目镜
    hasBeard: false,
    badgeAccent: 0x10b981,
    gloveColor: 0x2d3436,
    hairColor: 0x141116,
  },
  zhi: {
    helmetColor: 0xf5b301,      // 黄帽 = 现场作业
    overallColor: 0x334155,
    skinTone: 0xe3bd93,
    stripColor: 0xc3d92a,
    goggleTint: 0x06b6d4,       // 青色护目镜
    hasBeard: false,
    badgeAccent: 0x06b6d4,
    gloveColor: 0x2d3436,
    hairColor: 0x181419,
  }
};

/**
 * 写实/工业风材质（**不要改回 MeshToonMaterial**）。
 *
 * 历史教训：这里原先是 `MeshToonMaterial` + 3 级 `gradientMap`（赛璐璐明暗），
 * 再叠加 `addOutline()` 的黑色反向外壳描边 —— 整套是标准二次元渲染管线。
 * 结果就是：**模型明明是戴安全帽穿工装的工程师，观感却是动漫形象**（用户直接反馈
 * "数字人不要动漫形象"）。工业/工程类项目要的是"可信的技术形象"，
 * 卡通描边和色块明暗恰恰是最强的动漫信号，必须去掉。
 *
 * 现在统一走 PBR：靠 roughness / metalness 表达材质差异
 * （皮肤哑光偏粗糙、安全帽光滑带高光、反光条自发光、金属工具高金属度）。
 */
function pbrMat(
  color: number,
  roughness = 0.72,
  metalness = 0.0,
  opts?: Partial<THREE.MeshStandardMaterialParameters>
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...opts });
}

/**
 * 已废弃的卡通描边（保留函数名并置空，避免 4 处调用点逐一删改时漏删/误删）。
 * 反向外壳描边是二次元观感的头号来源，工程师形象不需要它。
 */
function addOutline(_parent: THREE.Object3D, _mesh: THREE.Mesh, _scaleFactor = 1.04): void {
  return;
}

// ── 写实比例常量（改这里就能整体调头身比，不要散落在代码里硬编码） ──
// 头肩比目标 ≈ 0.50（真实成年人 0.36~0.45；≥0.8 即 Q 版卡通）
const HEAD_SCALE = 0.6;
// 脖子：cylinder 中心 y=0.715、半高 0.075 → 顶端 0.79。
// 这里刻意压到 0.79：领口（工装胸段顶 0.68）到下颌只剩 0.09，
// 原来 0.86 会露出 0.24 的一截细脖子，数字人看着像长颈鹿、头显小。
const NECK_TOP_Y = 0.79;
// 颅骨：SphereGeometry 半径 0.48，y 轴缩放 0.93 → 半高 0.4464
const SKULL_HALF_HEIGHT = 0.48 * 0.93;

// ── 安全帽口径（headGroup 局部坐标，headGroup 整体再缩 0.6）──
// 眉毛在 y 0.168、眼睛在 y 0.04，所以帽壳前沿必须停在 0.22 以上，
// 否则数字人一开口只剩半张脸 —— 眉眼正是"这是个活人"的关键信号。
const HELMET_R = 0.534;
// 帽壳球心 y=0.175：帽壳口（球心 + r·cos84.6°）正好落在 head 局部 0.225，
// 即眉毛（0.168）上方 0.057；再往下 0.05 就开始吃眉毛了。
// 别按"颅顶 + 余量 − 半径"去算 —— 那样球心掉到 −0.03，整个帽壳会把半张脸罩住。
const HELMET_CENTER_Y = 0.175;
// 帽壳只取到极角 84.6° → 前沿下沿正好落在 y≈0.225（眉上 0.057）
const DOME_PHI_FRACTION = 84.6 / 180;
// 整圈帽檐：下沿接住帽壳口，再往外下倾 BRIM_DROOP
const BRIM_Y = HELMET_R * Math.cos(DOME_PHI_FRACTION * Math.PI);
const BRIM_DROOP = 0.045;

export function buildEngineerModel(personaId: string): EngineerModelResult {
  const config = PERSONA_CONFIGS[personaId] || PERSONA_CONFIGS['zhang'];
  
  const root = new THREE.Group();
  root.name = 'engineer-root';

  const torsoGroup = new THREE.Group();
  torsoGroup.name = 'torsoGroup';
  root.add(torsoGroup);

  // === Torso ===
  // 胸段上沿抬到 0.68（原 0.60）：领口要接住下颌，否则脖子那一段全是裸皮肤
  const chestGeom = new THREE.CylinderGeometry(0.42, 0.36, 0.88, 16);
  const chestMat = pbrMat(config.overallColor, 0.88); // 工装布料：哑光、几乎无高光
  const chest = new THREE.Mesh(chestGeom, chestMat);
  chest.position.set(0, 0.24, 0);
  torsoGroup.add(chest);
  addOutline(torsoGroup, chest);

  const lowerTorsoGeom = new THREE.CylinderGeometry(0.36, 0.32, 0.45, 16);
  const lowerTorso = new THREE.Mesh(lowerTorsoGeom, chestMat);
  lowerTorso.position.set(0, -0.35, 0);
  torsoGroup.add(lowerTorso);

  const neckGeom = new THREE.CylinderGeometry(0.11, 0.11, 0.15, 12);
  const skinMat = pbrMat(config.skinTone, 0.78); // 皮肤：哑光微油，不要塑料感
  const neck = new THREE.Mesh(neckGeom, skinMat);
  neck.position.set(0, 0.715, 0);
  torsoGroup.add(neck);

  const shoulderPadGeom = new THREE.BoxGeometry(0.22, 0.07, 0.18);
  const leftShoulderPad = new THREE.Mesh(shoulderPadGeom, chestMat);
  leftShoulderPad.position.set(-0.46, 0.62, 0);
  torsoGroup.add(leftShoulderPad);

  const rightShoulderPad = new THREE.Mesh(shoulderPadGeom, chestMat);
  rightShoulderPad.position.set(0.46, 0.62, 0);
  torsoGroup.add(rightShoulderPad);

  // ── 反光背心（GB 20653 口径：荧光黄绿基底 + 银白反光带，H 型布局）──
  // 躯干本身就是圆柱，所以背心用同心的开口圆柱壳就能贴合，不会像 GLB 那样悬空成一只桶。
  // 背心锥度集中在这组参数里，反光带半径一律用 vestRadiusAt() 推，
  // 不要再手写常量——之前带子飘出背心、工牌斜插进布里都是这么来的。
  const VEST = { rTop: 0.455, rBottom: 0.395, h: 0.78, y: 0.26 };
  const vestRadiusAt = (y: number) =>
    VEST.rBottom + (VEST.rTop - VEST.rBottom) * ((y - (VEST.y - VEST.h / 2)) / VEST.h);
  const vestMat = pbrMat(config.stripColor, 0.8, 0.0, { side: THREE.DoubleSide });
  const vest = new THREE.Mesh(
    new THREE.CylinderGeometry(VEST.rTop, VEST.rBottom, VEST.h, 20, 1, true),
    vestMat,
  );
  vest.name = 'dh-vest';
  vest.position.set(0, VEST.y, 0);
  torsoGroup.add(vest);

  // 反光带：自发光让它在不同光照下都保持"高能见度"的工业安全语义，同时保留哑光基底
  const bandMat = pbrMat(0xeef2f3, 0.42, 0.08, {
    emissive: new THREE.Color(0xb9c6cc),
    emissiveIntensity: 0.3,
    side: THREE.DoubleSide,
  });
  const BAND_H = 0.062;
  // 上带压在 0.42：领口那副护目镜挂在世界 y≈0.53，带子再高就和镜框叠成一片
  for (const by of [0.42, 0.16]) {
    const br = vestRadiusAt(by) + 0.004;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(br, br - 0.012, BAND_H, 20, 1, true), bandMat);
    band.position.set(0, by, 0);
    torsoGroup.add(band);
  }
  // 两条竖向反光带从前胸跨肩（H 型的两竖）
  for (const side of [-1, 1]) {
    const vStrip = new THREE.Mesh(
      new THREE.CylinderGeometry(
        VEST.rTop + 0.009,
        VEST.rBottom + 0.009,
        VEST.h,
        6,
        1,
        true,
        side * 0.42 - 0.07,
        0.14,
      ),
      bandMat,
    );
    vStrip.position.set(0, VEST.y, 0);
    torsoGroup.add(vStrip);
  }

  // Badge（工牌贴在背心左胸，随圆柱面朝向外法线，否则会斜插进背心）
  const badgeMat = pbrMat(0xffffff);
  const badgeGeom = new THREE.BoxGeometry(0.12, 0.15, 0.02);
  const badge = new THREE.Mesh(badgeGeom, badgeMat);
  // 左胸方位角 -0.49rad（≈28°），背心在该高度的外半径约 0.417 → 取 0.43 留出牌厚
  badge.position.set(-0.201, 0.13, 0.378);
  badge.rotation.y = -0.49;
  torsoGroup.add(badge);

  const badgeDetailMat = pbrMat(config.badgeAccent);
  const badgeDetailGeom = new THREE.BoxGeometry(0.08, 0.04, 0.01);
  const badgeDetail = new THREE.Mesh(badgeDetailGeom, badgeDetailMat);
  badgeDetail.position.set(-0.206, 0.11, 0.387);
  badgeDetail.rotation.y = -0.49;
  torsoGroup.add(badgeDetail);

  // Tool Belt & Tools
  const beltMat = pbrMat(0x1a1a2e);
  const beltGeom = new THREE.CylinderGeometry(0.34, 0.34, 0.06, 16);
  const toolBelt = new THREE.Mesh(beltGeom, beltMat);
  toolBelt.position.set(0, -0.55, 0);
  torsoGroup.add(toolBelt);

  const wrenchMat = pbrMat(0x6b7280, 0.34, 0.85); // 扳手：镀铬钢
  const wrenchHandleGeom = new THREE.BoxGeometry(0.035, 0.12, 0.018);
  const wrenchHeadGeom = new THREE.BoxGeometry(0.055, 0.04, 0.018);
  const wrenchGroup = new THREE.Group();
  const wrenchHandle = new THREE.Mesh(wrenchHandleGeom, wrenchMat);
  const wrenchHead = new THREE.Mesh(wrenchHeadGeom, wrenchMat);
  wrenchHead.position.set(0, 0.08, 0);
  wrenchGroup.add(wrenchHandle, wrenchHead);
  wrenchGroup.position.set(0.28, -0.65, 0.18);
  torsoGroup.add(wrenchGroup);

  const sdShaftMat = pbrMat(0x9ca3af, 0.22, 0.9); // 螺丝刀杆：抛光金属
  const sdHandleMat = pbrMat(0xef4444);
  const sdShaftGeom = new THREE.CylinderGeometry(0.012, 0.012, 0.1);
  const sdHandleGeom = new THREE.CylinderGeometry(0.022, 0.022, 0.06);
  const screwdriverGroup = new THREE.Group();
  const sdShaft = new THREE.Mesh(sdShaftGeom, sdShaftMat);
  const sdHandle = new THREE.Mesh(sdHandleGeom, sdHandleMat);
  sdShaft.position.set(0, -0.05, 0);
  screwdriverGroup.add(sdShaft, sdHandle);
  screwdriverGroup.position.set(-0.28, -0.65, 0.18);
  torsoGroup.add(screwdriverGroup);

  // === Head ===
  const headGroup = new THREE.Group();
  headGroup.name = 'headGroup';
  // 头身比修正：原实现头宽 0.96（skull 半径 0.48）对肩宽 1.14（护肩 ±0.46 + 半宽 0.11），
  // 头肩比 **0.84** —— 真实成年人约 0.36~0.45，0.8 以上就已经是 Q 版/大头卡通了。
  // 这是"明明戴安全帽穿工装、看着还是动漫"的核心原因（材质卡通化是第二大原因）。
  // 直接缩放 headGroup 可让颅骨/五官/安全帽/护目镜同步缩放，不会脱节。
  // 0.6 → 头肩比约 0.50：仍略带风格化（不至于刻板），但已是明确的成人工程师比例。
  headGroup.scale.setScalar(HEAD_SCALE);
  // 缩放后颅骨底部上移，必须同步下移 headGroup，否则头会浮在脖子上方（实测会脱开约 0.12）。
  // 脖子顶端在 NECK_TOP_Y（见上方常量注释），让颅骨底略低于它形成自然衔接。
  headGroup.position.set(0, NECK_TOP_Y + SKULL_HALF_HEIGHT * HEAD_SCALE - 0.02, 0);
  torsoGroup.add(headGroup);

  const skullGeom = new THREE.SphereGeometry(0.48, 32, 24);
  const skull = new THREE.Mesh(skullGeom, skinMat);
  skull.name = 'dh-skull';
  skull.scale.set(1, 0.93, 0.96);
  headGroup.add(skull);
  addOutline(headGroup, skull);

  // ── 头发 ──
  // 颅顶被安全帽压住，能看见的只有后脑、两侧和额前刘海，所以发形按这三块单独给：
  // 球壳的 phi=π/2 那一侧是正脸，取「绕开正脸的一段」做后脑 + 两侧。
  const hairMat = pbrMat(config.hairColor, 0.62, 0.06);
  const backHair = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 24, 18, Math.PI / 2 + 1.12, Math.PI * 2 - 2.24, Math.PI * 0.14, Math.PI * 0.6),
    hairMat,
  );
  backHair.scale.set(1, 0.96, 1);
  headGroup.add(backHair);

  // 刘海：只留帽檐下露出的那一窄条平直短发（东亚男工程师常见，不是卷曲发际线）。
  // 极角区间严格按「帽壳前沿 y 0.225 → 眉毛上沿 y 0.185」来取，
  // 再往下哪怕 0.02 就会把眉毛连眼睛一起糊住（那是绝对不可接受的）。
  const fringe = new THREE.Mesh(
    new THREE.SphereGeometry(0.497, 24, 6, Math.PI / 2 - 1.15, 2.30, 1.098, 0.082),
    hairMat,
  );
  fringe.name = 'dh-fringe';
  fringe.scale.set(1.01, 1, 1.02);
  headGroup.add(fringe);

  // 鬓角：耳前一小条，避免侧面看头皮反光
  for (const side of [-1, 1]) {
    const sideburn = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.13, 0.05), hairMat);
    sideburn.position.set(side * 0.455, 0.02, 0.14);
    sideburn.rotation.y = side * 0.5;
    headGroup.add(sideburn);
  }

  // 写实眼：去掉二次元"三件套"（纯白眼白 + 占眼球一半的瞳孔 + 悬空的白色高光小球）。
  // 高光不再用小球伪造，改为靠低 roughness 让场景灯光在眼白上自然产生湿润高光。
  const eyeWhiteMat = pbrMat(0xf2efe9, 0.14);
  const irisMat = pbrMat(0x241610, 0.3);   // 东亚虹膜深褐近黑，不是欧美的浅褐
  const pupilMat = pbrMat(0x0a0a0f, 0.08);

  function createEye(): THREE.Group {
    const eyeGroup = new THREE.Group();
    const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.072, 16, 12), eyeWhiteMat);
    // 真人虹膜直径约占眼球 46%（11.7mm / 24mm），瞳孔更小 —— 原实现是 55% + 无虹膜，一眼动漫
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.034, 16, 12), irisMat);
    iris.position.set(0, 0, 0.046);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 8), pupilMat);
    pupil.position.set(0, 0, 0.066);
    // 上眼皮：东亚眼型的关键是上睑略压、眼裂偏平，用一片同肤色球冠盖住眼球上缘。
    // 它挂在 eyeGroup 里，眨眼时随整组 scale.y 一起合上。
    const lidMat = pbrMat(new THREE.Color(config.skinTone).multiplyScalar(0.97).getHex(), 0.76);
    const lid = new THREE.Mesh(
      new THREE.SphereGeometry(0.082, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.42),
      lidMat,
    );
    lid.position.set(0, 0.012, 0.006);
    lid.scale.set(1.02, 0.8, 0.9);
    lid.rotation.x = -0.34;
    eyeGroup.add(eyeWhite, iris, pupil, lid);
    return eyeGroup;
  }

  // 眼球往前收到 0.385：颅骨在该处的表面 z≈0.429，留出约 0.03 的露出量。
  // 原值 0.42 是"护目镜罩着看不出"的将就值，眼镜露出来后就变成凸眼。
  const leftEyeGroup = createEye();
  leftEyeGroup.position.set(-0.17, 0.04, 0.385);
  headGroup.add(leftEyeGroup);

  const rightEyeGroup = createEye();
  rightEyeGroup.position.set(0.17, 0.04, 0.385);
  headGroup.add(rightEyeGroup);

  // 眉：与头发同色、更粗更平（东亚浓眉），不要欧美那种高挑棕眉
  const browMat = pbrMat(config.hairColor, 0.86);
  const browGeom = new THREE.BoxGeometry(0.155, 0.034, 0.045);
  const leftBrow = new THREE.Mesh(browGeom, browMat);
  leftBrow.name = 'dh-brow-left';
  leftBrow.position.set(-0.175, 0.168, 0.435);
  leftBrow.rotation.z = 0.05;
  headGroup.add(leftBrow);

  const rightBrow = new THREE.Mesh(browGeom, browMat);
  rightBrow.name = 'dh-brow-right';
  rightBrow.position.set(0.175, 0.168, 0.435);
  rightBrow.rotation.z = -0.05;
  headGroup.add(rightBrow);

  const noseTipColor = new THREE.Color(config.skinTone).multiplyScalar(0.92).getHex();
  const noseTipGeom = new THREE.SphereGeometry(0.055, 12, 8);
  const noseTip = new THREE.Mesh(noseTipGeom, pbrMat(noseTipColor));
  // 鼻型：东亚鼻梁偏低、鼻头偏圆宽，所以鼻头下移并横向加宽
  noseTip.position.set(0, -0.075, 0.45);
  noseTip.scale.set(1.16, 0.9, 0.95);
  headGroup.add(noseTip);

  const noseBridgeGeom = new THREE.CylinderGeometry(0.02, 0.03, 0.1, 8);
  const noseBridge = new THREE.Mesh(noseBridgeGeom, skinMat);
  noseBridge.position.set(0, 0.0, 0.44);
  noseBridge.rotation.x = -0.18;
  headGroup.add(noseBridge);

  // Ears
  const earGeom = new THREE.SphereGeometry(0.06, 8, 6);
  const earMat = pbrMat(new THREE.Color(config.skinTone).multiplyScalar(0.95).getHex());
  const leftEar = new THREE.Mesh(earGeom, earMat);
  leftEar.position.set(-0.46, 0.0, 0.0);
  leftEar.scale.set(0.5, 0.8, 0.6);
  headGroup.add(leftEar);
  const rightEar = new THREE.Mesh(earGeom, earMat);
  rightEar.position.set(0.46, 0.0, 0.0);
  rightEar.scale.set(0.5, 0.8, 0.6);
  headGroup.add(rightEar);

  // Mouth
  const mouthGroup = new THREE.Group();
  mouthGroup.position.set(0, -0.22, 0.38);
  headGroup.add(mouthGroup);

  const upperLipMat = pbrMat(0xc4956c);
  const upperLipGeom = new THREE.BoxGeometry(0.14, 0.025, 0.05);
  const upperLip = new THREE.Mesh(upperLipGeom, upperLipMat);
  upperLip.position.set(0, 0.02, 0);
  mouthGroup.add(upperLip);

  const jawMat = pbrMat(0x8b3a3a);
  const jawGeom = new THREE.SphereGeometry(0.08, 12, 8);
  const jaw = new THREE.Mesh(jawGeom, jawMat);
  jaw.name = 'dh-jaw';
  jaw.position.set(0, -0.01, 0);
  jaw.scale.set(1.4, 0.15, 0.9);
  mouthGroup.add(jaw);

  // Helmet —— GB 2811 口径：帽壳 + 一整圈帽檐，**帽壳前沿开在眉毛以上**。
  // 原实现把帽壳中心抬到颅顶（y 0.33）再挂一块往前伸 0.32 的方形帽檐，
  // 那片帽檐正好压在眉毛（y 0.168）上 —— 数字人是说话用的，眉毛一被挡，
  // 整张脸就没有表情了，而且"方檐"本身就不像安全帽（安全帽是整圈圆檐）。
  const helmetGroup = new THREE.Group();
  helmetGroup.position.set(0, HELMET_CENTER_Y, 0);
  headGroup.add(helmetGroup);

  // 安全帽是 ABS 工程塑料：光滑、有明显高光 —— 与工装的哑光形成材质对比
  const helmetMat = pbrMat(config.helmetColor, 0.26, 0.05);
  const domeGeom = new THREE.SphereGeometry(
    HELMET_R, 32, 20, 0, Math.PI * 2, 0, Math.PI * DOME_PHI_FRACTION,
  );
  const dome = new THREE.Mesh(domeGeom, helmetMat);
  helmetGroup.add(dome);
  addOutline(helmetGroup, dome);

  // 整圈帽檐：跟帽壳口径（中国工地安全帽基本都是全檐，不是棒球帽那种前檐）
  const brimMat = pbrMat(config.helmetColor, 0.3, 0.05, { side: THREE.DoubleSide });
  const brim = new THREE.Mesh(new THREE.RingGeometry(HELMET_R * 0.94, HELMET_R * 1.15, 36), brimMat);
  brim.rotation.x = -Math.PI / 2 + BRIM_DROOP;
  brim.position.set(0, BRIM_Y, 0);
  helmetGroup.add(brim);

  // 顶部加强筋：贴着球面走的一段圆环，不再是插在帽壳内部的直筒
  const ridgeColor = new THREE.Color(config.helmetColor).multiplyScalar(0.85).getHex();
  const ridgeArc = Math.PI * 0.62;
  const ridge = new THREE.Mesh(
    new THREE.TorusGeometry(HELMET_R, 0.022, 6, 28, ridgeArc),
    pbrMat(ridgeColor, 0.34, 0.05),
  );
  ridge.rotation.y = Math.PI / 2;          // 环面转到竖直面，走向为前后
  ridge.rotation.z = Math.PI / 2 - ridgeArc / 2; // 把弧段居中正对上方
  helmetGroup.add(ridge);

  // 侧面散热孔：直接按球坐标落在帽壳面上，左右各 3 个
  const ventGeom = new THREE.CircleGeometry(0.024, 10);
  const ventMat = new THREE.MeshBasicMaterial({ color: 0x141414 });
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const yaw = side * (1.05 + i * 0.35);   // 方位角，0 = 正脸
      const pitch = 0.86;                     // 与 +Y 的夹角
      const vent = new THREE.Mesh(ventGeom, ventMat);
      vent.position.set(
        HELMET_R * Math.sin(pitch) * Math.sin(yaw),
        HELMET_R * Math.cos(pitch),
        HELMET_R * Math.sin(pitch) * Math.cos(yaw),
      );
      vent.lookAt(vent.position.clone().multiplyScalar(2)); // 法线朝外
      helmetGroup.add(vent);
    }
  }

  // 下颏带：耳前 → 下颌角，用两点直接生成（靠欧拉角硬凑方向会钻进球体内部）。
  // 末端刻意收到侧后方而不是颏下正中：两条带子在前脖子汇合 + 一个方扣，
  // 出来的效果是"数字人戴了条项链"，而不是安全帽的束带。
  const chinStrapMat = pbrMat(0x374151, 0.9);
  const UP = new THREE.Vector3(0, 1, 0);
  for (const side of [-1, 1]) {
    const from = new THREE.Vector3(side * 0.46, 0.12, 0.10);
    const to = new THREE.Vector3(side * 0.20, -0.40, -0.06);
    const dir = to.clone().sub(from);
    const strap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, dir.length(), 6),
      chinStrapMat,
    );
    strap.position.copy(from.clone().add(to).multiplyScalar(0.5));
    strap.quaternion.setFromUnitVectors(UP, dir.normalize());
    headGroup.add(strap);
    // 束带滑扣落在下颌角两侧
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.035), chinStrapMat);
    buckle.position.copy(to);
    headGroup.add(buckle);
  }

  // 安全帽正前方工程身份标识徽章
  const emblemMat = pbrMat(config.badgeAccent, 0.4, 0.1, {
    emissive: new THREE.Color(config.badgeAccent),
    emissiveIntensity: 0.35,
  });
  const emblemGeom = new THREE.CylinderGeometry(0.045, 0.045, 0.015, 8);
  const emblem = new THREE.Mesh(emblemGeom, emblemMat);
  // 落在帽壳正前方 54° 处（工地帽的正面铭牌位），轴向对齐球面法线
  emblem.position.set(0, 0.3136, 0.4426);
  emblem.rotation.x = 0.953;
  helmetGroup.add(emblem);

  // Goggles - 工业护目镜：**挂在领口而不是罩在眼睛上**。
  // 这是发言用的数字人，眼睛被镜框盖住就等于把表情全抹掉了；
  // 现场工程师不测的时候本来就是把护目镜推到脖子上的。
  const gogglesGroup = new THREE.Group();
  // 挂点在锁骨：headGroup 缩放 0.6、原点在世界 y 1.038，局部 y=-0.85 → 世界 0.53，
  // 正好是背心领口；z 要给到 0.78（世界 0.47）才在背心外壳（该高度半径约 0.446）外面，
  // 原来写 0.42 是把护目镜埋进了躯干里，只能从开口圆柱的上沿露出半个身子。
  gogglesGroup.name = 'dh-goggles';
  gogglesGroup.position.set(0, -0.85, 0.78);
  gogglesGroup.rotation.x = -0.3;
  gogglesGroup.scale.setScalar(0.92);
  headGroup.add(gogglesGroup);

  const frameMat = pbrMat(0x111111);
  const lensMat = new THREE.MeshPhysicalMaterial({
    color: config.goggleTint,
    transmission: 0.72,
    roughness: 0.08,
    metalness: 0.1,
    ior: 1.45,
    transparent: true,
    opacity: 0.85,
  });

  const frameGeom = new THREE.BoxGeometry(0.2, 0.12, 0.018);
  const lensGeom = new THREE.BoxGeometry(0.16, 0.08, 0.015);

  const leftFrame = new THREE.Mesh(frameGeom, frameMat);
  leftFrame.position.set(-0.14, 0, 0.43);
  gogglesGroup.add(leftFrame);

  const leftLens = new THREE.Mesh(lensGeom, lensMat);
  leftLens.position.set(-0.14, 0, 0.44);
  gogglesGroup.add(leftLens);

  const rightFrame = new THREE.Mesh(frameGeom, frameMat);
  rightFrame.position.set(0.14, 0, 0.43);
  gogglesGroup.add(rightFrame);

  const rightLens = new THREE.Mesh(lensGeom, lensMat);
  rightLens.position.set(0.14, 0, 0.44);
  gogglesGroup.add(rightLens);

  const bridgeGeom = new THREE.BoxGeometry(0.05, 0.025, 0.018);
  const goggleBridge = new THREE.Mesh(bridgeGeom, frameMat);
  goggleBridge.position.set(0, 0, 0.43);
  gogglesGroup.add(goggleBridge);

  const templeGeom = new THREE.BoxGeometry(0.018, 0.018, 0.22);
  const leftTemple = new THREE.Mesh(templeGeom, frameMat);
  leftTemple.position.set(-0.25, 0, 0.32);
  gogglesGroup.add(leftTemple);

  const rightTemple = new THREE.Mesh(templeGeom, frameMat);
  rightTemple.position.set(0.25, 0, 0.32);
  gogglesGroup.add(rightTemple);

  // === Arms ===
  const armGeom = new THREE.CylinderGeometry(0.09, 0.08, 0.5, 12);
  const elbowGeom = new THREE.SphereGeometry(0.08, 12, 8);
  const forearmGeom = new THREE.CylinderGeometry(0.075, 0.065, 0.42, 12);
  const gloveGeom = new THREE.BoxGeometry(0.11, 0.09, 0.15);
  const gloveMat = pbrMat(config.gloveColor);

  function createArm(): THREE.Group {
    const armGroup = new THREE.Group();
    
    const upperArm = new THREE.Mesh(armGeom, chestMat);
    upperArm.position.set(0, -0.25, 0);
    armGroup.add(upperArm);
    addOutline(armGroup, upperArm);

    const elbow = new THREE.Mesh(elbowGeom, chestMat);
    elbow.position.set(0, -0.5, 0);
    armGroup.add(elbow);

    const forearm = new THREE.Mesh(forearmGeom, chestMat);
    forearm.position.set(0, -0.75, 0.05);
    forearm.rotation.x = -0.15;
    armGroup.add(forearm);

    const glove = new THREE.Mesh(gloveGeom, gloveMat);
    glove.position.set(0, -1.0, 0.08);
    armGroup.add(glove);

    return armGroup;
  }

  const leftArmGroup = createArm();
  // 肩线上移到 0.62（配合领口抬高），手臂挂点跟着上移，保持原来 0.07 的落差
  leftArmGroup.position.set(-0.52, 0.52, 0);
  leftArmGroup.rotation.z = 0.15;
  leftArmGroup.rotation.x = -0.06;
  torsoGroup.add(leftArmGroup);

  const rightArmGroup = createArm();
  rightArmGroup.position.set(0.52, 0.52, 0);
  rightArmGroup.rotation.z = -0.15;
  rightArmGroup.rotation.x = -0.06;
  torsoGroup.add(rightArmGroup);

  return {
    group: root,
    headGroup,
    torsoGroup,
    helmetGroup,
    jaw,
    leftEye: leftEyeGroup,
    rightEye: rightEyeGroup,
    leftArm: leftArmGroup,
    rightArm: rightArmGroup
  };
}

export function disposeEngineerModel(result: EngineerModelResult): void {
  result.group.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          mesh.material.dispose();
        }
      }
    }
  });
}
