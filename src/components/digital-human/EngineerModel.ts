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
  /**
   * 工装裤色 —— 刻意比上衣更深：现场裤子蹲立蹭油，厂家发的成套工装本来就是
   * "上衣亮蓝、裤子藏青"，同色反而像穿了一件连体服（观感＝一块蓝色方块）。
   */
  trouserColor: number;
  bootColor: number;
  /** 帆布工具袋色（挂在右胯，是"这是个干活的人"最直接的记号） */
  bagColor: number;
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
 * 工装取成套「上衣亮蓝 + 裤子藏青」（现场真实的成套工装就是两套色，
 * 上衣裤子同色反而像一件连体服 → 用户看到的"蓝色方块身子"），
 * 反光背心荧光黄绿 + 银白反光带（GB 20653）。
 */
export const PERSONA_CONFIGS: Record<string, PersonaConfig> = {
  zhang: {
    helmetColor: 0xf0f0f0,      // 白帽 = 总工 / 技术管理，工地通行色
    overallColor: 0x2c4a76,     // 靛蓝工装上衣（真实厂家色，不是灰蓝）
    skinTone: 0xe3bd93,
    stripColor: 0xc3d92a,
    goggleTint: 0x38bdf8,       // 天蓝护目镜
    hasBeard: false,
    badgeAccent: 0x0ea5e9,
    gloveColor: 0x2d3436,
    hairColor: 0x161318,
    trouserColor: 0x1e3350,
    bootColor: 0x2a2119,
    bagColor: 0x5a4a33,
  },
  li: {
    helmetColor: 0x2563eb,      // 蓝帽 = 特种作业 / 技术工人
    overallColor: 0x24405f,
    skinTone: 0xe8c49c,
    stripColor: 0xc3d92a,
    goggleTint: 0x10b981,       // 翠绿护目镜
    hasBeard: false,
    badgeAccent: 0x10b981,
    gloveColor: 0x2d3436,
    hairColor: 0x141116,
    trouserColor: 0x18273f,
    bootColor: 0x241d16,
    bagColor: 0x3f4650,
  },
  zhi: {
    helmetColor: 0xf5b301,      // 黄帽 = 现场作业
    overallColor: 0x2d4a6f,     // 原来是 0x334155 灰蓝，投影上像穿了件水泥袋子
    skinTone: 0xe3bd93,
    stripColor: 0xc3d92a,
    goggleTint: 0x06b6d4,       // 青色护目镜
    hasBeard: false,
    badgeAccent: 0x06b6d4,
    gloveColor: 0x2d3436,
    hairColor: 0x181419,
    trouserColor: 0x203350,
    bootColor: 0x28211a,
    bagColor: 0x4b4234,
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
  // 把值为 undefined 的键剔掉再交给 three：`{ map: weave ?? undefined }` 在
  // node 环境（weave 为 null）会留下一个显式 undefined，触发
  // "THREE.Material: parameter 'map' has value of undefined" 刷屏。
  const clean: Record<string, unknown> = { color, roughness, metalness };
  for (const [k, v] of Object.entries(opts ?? {})) {
    if (v !== undefined) clean[k] = v;
  }
  return new THREE.MeshStandardMaterial(clean as THREE.MeshStandardMaterialParameters);
}

/**
 * 已废弃的卡通描边（保留函数名并置空，避免 4 处调用点逐一删改时漏删/误删）。
 * 反向外壳描边是二次元观感的头号来源，工程师形象不需要它。
 */
function addOutline(_parent: THREE.Object3D, _mesh: THREE.Mesh, _scaleFactor = 1.04): void {
  return;
}

/**
 * 工装布料纹理（斜纹 + 纱线噪点），纯 canvas 程序化生成，零网络请求。
 *
 * 为什么必须有：用户反馈的"方块身子"一半是几何（原来全身只有圆柱和方块），
 * 另一半是**布料没有任何纹理** —— 纯色 MeshStandardMaterial 在 286px 的舞台里
 * 就是塑料积木。这里画的是涤棉工装的 45° 斜纹（twill）再加一层极细的纱线噪点。
 *
 * ⚠ 底色必须是接近白的中性灰：`map` 是与 `color` **相乘**的，
 * 按料子本色画一遍、材质色再给一遍，出来就是暗两档的糊色。
 *
 * ⚠ 单测跑在 node 环境（无 `document`），取不到画布就返回 null 走纯色，
 * 不能在这里直接 new Canvas()，否则整份 EngineerModel 几何护栏全炸。
 */
function makeWeaveTexture(repeat = 5): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) return null;

  ctx2d.fillStyle = '#f2f2f0';
  ctx2d.fillRect(0, 0, size, size);

  // 斜纹：4px 一组明暗相间纱线，亮暗只差几个百分点——要的是"看得出是布"，不是条纹衫
  for (let x = -size; x < size * 2; x += 4) {
    const grad = ctx2d.createLinearGradient(x, 0, x + 4, size);
    grad.addColorStop(0, 'rgba(255,255,255,0.75)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.09)');
    grad.addColorStop(1, 'rgba(255,255,255,0.35)');
    ctx2d.strokeStyle = grad;
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    ctx2d.moveTo(x, 0);
    ctx2d.lineTo(x - size, size);
    ctx2d.stroke();
  }
  // 纱线噪点：确定性伪随机（不用 Math.random，否则每次换人设布纹都在跳）
  for (let i = 0; i < 1500; i++) {
    const px = (i * 37) % size;
    const py = (i * 91) % size;
    ctx2d.fillStyle = i % 3 === 0 ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.10)';
    ctx2d.fillRect(px, py, 1, 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
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

  // 下半身单独一组：呼吸动画只.scale torsoGroup，腿和脚必须钉在地上不动，
  // 否则整条腿跟着一起伸缩，人会在原地"忽高忽低"。
  const legsGroup = new THREE.Group();
  legsGroup.name = 'legsGroup';
  root.add(legsGroup);

  // === Torso ===
  // 三块布：上衣（领口/袖子）、工装裤、帆布工具袋，共用一张斜纹底图、各自调密度。
  const weave = makeWeaveTexture(4);
  const trouserWeave = weave ? weave.clone() : null;
  if (trouserWeave) { trouserWeave.repeat.set(5, 7); trouserWeave.needsUpdate = true; }
  const bagWeave = weave ? weave.clone() : null;
  if (bagWeave) { bagWeave.repeat.set(2, 2); bagWeave.needsUpdate = true; }

  // 胸段上沿抬到 0.68（原 0.60）：领口要接住下颌，否则脖子那一段全是裸皮肤
  const chestGeom = new THREE.CylinderGeometry(0.42, 0.36, 0.88, 16);
  const chestMat = pbrMat(config.overallColor, 0.88, 0, { map: weave ?? undefined }); // 工装布料：哑光、几乎无高光
  const chest = new THREE.Mesh(chestGeom, chestMat);
  chest.position.set(0, 0.24, 0);
  torsoGroup.add(chest);
  addOutline(torsoGroup, chest);

  const lowerTorsoGeom = new THREE.CylinderGeometry(0.36, 0.32, 0.45, 16);
  const lowerTorso = new THREE.Mesh(lowerTorsoGeom, chestMat);
  lowerTorso.position.set(0, -0.35, 0);
  torsoGroup.add(lowerTorso);

  const neckGeom = new THREE.CylinderGeometry(0.11, 0.128, 0.15, 12);
  const skinMat = pbrMat(config.skinTone, 0.78); // 皮肤：哑光微油，不要塑料感
  const neck = new THREE.Mesh(neckGeom, skinMat);
  neck.position.set(0, 0.715, 0);
  torsoGroup.add(neck);
  // 喉结：原来到处都是光滑圆柱/球，脖子给一个骨点，"人"的味道主要靠这些转折
  const adam = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), skinMat);
  adam.position.set(0, 0.73, 0.112);
  adam.scale.set(1, 1.25, 0.7);
  torsoGroup.add(adam);
  // 工装翻领：脖子根下直接是胸段圆柱，看着像"头插在瓶子里"。
  // 翻领把颈—肩这一段接上，领子也是现场工装最能读出"制服"的一块布。
  const collarMat = pbrMat(new THREE.Color(config.overallColor).multiplyScalar(1.12).getHex(), 0.86, 0, {
    map: weave ?? undefined,
    side: THREE.DoubleSide,
  });
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.27, 0.1, 16, 1, true), collarMat);
  collar.position.set(0, 0.735, 0.012);
  torsoGroup.add(collar);
  // 领尖：前襟翻折的两只尖角（不开 V 领，工装领口是合到胸前的）
  for (const side of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.075, 0.018), collarMat);
    tip.position.set(side * 0.1, 0.71, 0.155);
    tip.rotation.set(-0.5, side * 0.45, 0);
    torsoGroup.add(tip);
  }

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
  // 反光背心比躯干只大一圈（原来 0.455/0.395 快赶上肩宽）：
  // 截图里整块上身是一面平整的黄绿色墙，"方块身子"的观感有一半来自这里。
  // 收到 0.43/0.372 后两侧露出深蓝工装，背心才读作"套在外面的第二层"。
  const VEST = { rTop: 0.43, rBottom: 0.372, h: 0.78, y: 0.26 };
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

  // ── 工装细节：胸袋 + 门襟明线 ──
  // 「工装纹理」不是只有布纹就够：真正让人读出"这是件制服"的是口袋和缝线。
  // 胸袋挂在右胸（工牌在左胸，两者不叠），袋盖压出一道阴影边。
  // 颜色必须跟着**背心**走：原来用深蓝工装色，两颗深色方块漂在荧光黄上，
  // 截图里读作"贴在胸口的像素块"，是"方块人"观感的最后一个来源。
  const pocketMat = pbrMat(new THREE.Color(config.stripColor).multiplyScalar(0.86).getHex(), 0.92, 0, {
    map: weave ?? undefined,
  });
  const seamMat = pbrMat(new THREE.Color(config.overallColor).multiplyScalar(1.45).getHex(), 0.95);
  for (const px of [-0.155, 0.155]) {
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.11, 0.02), pocketMat);
    // 方位角 ±0.36rad，背心壳在该高度外半径约 0.41 → 袋体压出壳面 0.01 才有"缝在上面"的厚度
    pocket.position.set(px, 0.36, 0.383);
    pocket.rotation.y = px > 0 ? 0.36 : -0.36;
    torsoGroup.add(pocket);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.034, 0.024), pocketMat);
    flap.position.set(px, 0.432, 0.39);
    flap.rotation.x = 0.12;
    flap.rotation.y = px > 0 ? 0.36 : -0.36;
    torsoGroup.add(flap);
  }
  // 前中缝：从上领口直落到腰带的一条明线（背心拉链口，也是"衣服有中缝"的读数点）
  const placket = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.86, 0.012), seamMat);
  placket.position.set(0, 0.26, 0.435);
  torsoGroup.add(placket);

  // Tool Belt & Tools
  const beltMat = pbrMat(0x1a1a2e);
  // 腰带半径 0.36：必须同时外凸于下摆（0.322）与髋部（0.3345），否则腰带会陷进裤腰里
  const beltGeom = new THREE.CylinderGeometry(0.36, 0.36, 0.075, 16);
  const toolBelt = new THREE.Mesh(beltGeom, beltMat);
  toolBelt.position.set(0, -0.55, 0);
  torsoGroup.add(toolBelt);
  // 腰带扣 + 两段皮环：腰带原来是一整圈纯黑圆柱，正身看过去就是一条黑缝
  const buckleMat = pbrMat(0xb8bec6, 0.35, 0.85);
  const beltBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.085, 0.022), buckleMat);
  beltBuckle.position.set(0, -0.55, 0.366);
  torsoGroup.add(beltBuckle);
  for (const loopX of [-0.2, 0.24]) {
    const loop = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.028), beltMat);
    loop.position.set(loopX, -0.575, 0.315);
    loop.rotation.y = loopX > 0 ? -0.6 : 0.6;
    torsoGroup.add(loop);
  }

  // ── 工具袋（右胯，挂在腰带环上）──
  // 原来是扳手 + 螺丝刀直接插在腰带前后（±0.28, −0.65, 0.18），
  // 位置在躯干圆柱内部 → 投影上只露出两小截金属，看不出"带工具"，
  // 反而像身上长了两个方块。改成一只真正的帆布工具袋：袋体 + 袋盖 + 提带 + 露出的工具柄。
  // 挂在 legsGroup（下半身）而不是 torsoGroup：躯干呼吸缩放时袋子不该跟着一起拉长。
  const wrenchMat = pbrMat(0x6b7280, 0.34, 0.85); // 扳手：镀铬钢
  const wrenchHandleGeom = new THREE.BoxGeometry(0.035, 0.12, 0.018);
  const wrenchHeadGeom = new THREE.BoxGeometry(0.055, 0.04, 0.018);
  const wrenchGroup = new THREE.Group();
  const wrenchHandle = new THREE.Mesh(wrenchHandleGeom, wrenchMat);
  const wrenchHead = new THREE.Mesh(wrenchHeadGeom, wrenchMat);
  wrenchHead.position.set(0, 0.08, 0);
  wrenchGroup.add(wrenchHandle, wrenchHead);

  const sdShaftMat = pbrMat(0x9ca3af, 0.22, 0.9); // 螺丝刀杆：抛光金属
  const sdHandleMat = pbrMat(0xef4444);
  const sdShaftGeom = new THREE.CylinderGeometry(0.012, 0.012, 0.1);
  const sdHandleGeom = new THREE.CylinderGeometry(0.022, 0.022, 0.06);
  const screwdriverGroup = new THREE.Group();
  const sdShaft = new THREE.Mesh(sdShaftGeom, sdShaftMat);
  const sdHandle = new THREE.Mesh(sdHandleGeom, sdHandleMat);
  sdShaft.position.set(0, -0.05, 0);
  screwdriverGroup.add(sdShaft, sdHandle);

  const bagMat = pbrMat(config.bagColor, 0.92, 0, { map: bagWeave ?? undefined }); // 厚帆布：比工装更哑
  const bagTrimMat = pbrMat(new THREE.Color(config.bagColor).multiplyScalar(0.7).getHex(), 0.85);
  // 比大腿外沿（0.178 + 0.178）再往外 0.03：腿加粗后袋体不再嵌进裤子里
  const BAG_X = 0.352;
  const bagGroup = new THREE.Group();
  bagGroup.name = 'dh-toolbag';
  // 袋体贴着胯部朝外前方（腰侧到膝上这一段是工具袋的真实落位）
  const bagBody = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.27, 0.115), bagMat);
  bagBody.position.set(0, -0.735, 0);
  bagGroup.add(bagBody);
  // 袋口：加宽的一圈边 + 中间一道隔层，工具从隔层里露出来
  const bagMouth = new THREE.Mesh(new THREE.BoxGeometry(0.255, 0.045, 0.13), bagTrimMat);
  bagMouth.position.set(0, -0.605, 0);
  bagGroup.add(bagMouth);
  const bagDivider = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.05, 0.125), bagTrimMat);
  bagDivider.position.set(0.02, -0.6, 0);
  bagGroup.add(bagDivider);
  // 前贴袋（卷尺/记录本的位置）+ 一道缝线
  const bagPocket = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.13, 0.03), bagMat);
  bagPocket.position.set(-0.02, -0.79, 0.07);
  bagGroup.add(bagPocket);
  const bagSeam = new THREE.Mesh(
    new THREE.BoxGeometry(0.245, 0.008, 0.008),
    pbrMat(new THREE.Color(config.bagColor).multiplyScalar(1.5).getHex(), 0.95),
  );
  bagSeam.position.set(0, -0.855, 0.058);
  bagGroup.add(bagSeam);
  // 提带：从袋口两侧拱起来的一条，手能握、也能挂到腰带环上
  const strapMat = pbrMat(new THREE.Color(config.bagColor).multiplyScalar(0.55).getHex(), 0.9);
  const handleStrap = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 6, 16, Math.PI), strapMat);
  handleStrap.position.set(0, -0.6, 0);
  handleStrap.rotation.y = Math.PI / 2;
  bagGroup.add(handleStrap);
  // 挂带：两条从袋口回到腰带的织带（没有它们，袋子就是"悬空贴在胯上"）
  for (const hz of [-0.045, 0.045]) {
    const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.075, 0.022), strapMat);
    hanger.position.set(-0.06, -0.578, hz);
    bagGroup.add(hanger);
  }
  wrenchGroup.position.set(0.055, -0.565, 0.01);
  wrenchGroup.rotation.set(0.1, 0, 0.16);
  screwdriverGroup.position.set(-0.085, -0.575, -0.01);
  screwdriverGroup.rotation.set(0.16, 0, -0.22);
  bagGroup.add(wrenchGroup, screwdriverGroup);
  bagGroup.position.set(BAG_X, 0, 0.1);
  bagGroup.rotation.y = -0.42;
  legsGroup.add(bagGroup);

  // ── 下半身：髋 + 双腿（深藏蓝工装裤）+ 劳保鞋 ──
  // 头身比口径：颅底 y 0.77 → 颅顶 1.306 ⇒ 一个头高 0.536。
  // 全站高（鞋底线 −2.58 → 颅顶 1.306）= 3.886 ≈ **7.2 个头**，正常成年男性区间。
  // 原来的模型做到腰带（−0.575）就收口，下半身根本不存在 ——
  // 投在 286px 的舞台里就是"一截蓝色方块"，这也是用户说"方块人"的直接原因。
  const trouserMat = pbrMat(config.trouserColor, 0.9, 0, { map: trouserWeave ?? undefined });
  const trouserDarkMat = pbrMat(new THREE.Color(config.trouserColor).multiplyScalar(0.82).getHex(), 0.92);
  // 髋骨：上沿 −0.48 与躯干下摆（−0.575）交叠 0.095，躯干呼吸 ±1.5% 也不会张开裂缝
  const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.31, 0.3, 16), trouserMat);
  hips.position.set(0, -0.63, 0);
  legsGroup.add(hips);
  // 裆部接缝：一条竖明线，避免裤子在两条腿之间糊成一整块
  const flySeam = new THREE.Mesh(
    new THREE.BoxGeometry(0.012, 0.16, 0.012),
    pbrMat(new THREE.Color(config.trouserColor).multiplyScalar(1.4).getHex(), 0.95),
  );
  flySeam.position.set(0, -0.62, 0.315);
  legsGroup.add(flySeam);

  const bootMat = pbrMat(config.bootColor, 0.6, 0.04);
  const soleMat = pbrMat(new THREE.Color(config.bootColor).multiplyScalar(0.5).getHex(), 0.95);
  // 腿围整体加粗 ~9%：截图验收时两条腿是"两根水管"，因为大腿直径只有肩宽的 29%
  // （真人约 34%）。粗一点 + 两腿略微分开，站姿才像承重的人而不是圆规。
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.name = `dh-leg-${side > 0 ? 'r' : 'l'}`;
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.178, 0.142, 0.7, 14), trouserMat);
    thigh.position.set(0, -1.13, 0);
    leg.add(thigh);
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.142, 14, 10), trouserMat);
    knee.position.set(0, -1.48, 0.006);
    knee.scale.set(1, 1, 1.06);
    leg.add(knee);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.142, 0.104, 0.9, 14), trouserMat);
    shin.position.set(0, -1.97, 0);
    leg.add(shin);
    // 裤脚收口 + 小腿反光条（检修裤的标配，深色裤子上最能"读出是裤子"的两道细节）
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.113, 0.108, 0.06, 14), trouserDarkMat);
    cuff.position.set(0, -2.41, 0);
    leg.add(cuff);
    const legBand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.126, 0.122, 0.045, 14, 1, true),
      bandMat,
    );
    legBand.position.set(0, -2.16, 0);
    leg.add(legBand);
    // 膝部补强：蹲立磨损最多的地方，现场裤子这里都多一层布
    const kneePatch = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.13, 0.03), trouserDarkMat);
    kneePatch.position.set(0, -1.47, 0.142);
    leg.add(kneePatch);
    // 劳保鞋：鞋面 + 前掌钢包头 + 橡胶底（底比鞋身宽出一圈，站得住）
    const bootUpper = new THREE.Mesh(new THREE.BoxGeometry(0.215, 0.16, 0.3), bootMat);
    bootUpper.position.set(0.005, -2.49, 0.04);
    leg.add(bootUpper);
    const toeCap = new THREE.Mesh(new THREE.SphereGeometry(0.086, 12, 8), soleMat);
    toeCap.position.set(0.005, -2.52, 0.175);
    toeCap.scale.set(1.18, 0.72, 0.9);
    leg.add(toeCap);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.232, 0.05, 0.345), soleMat);
    sole.position.set(0.005, -2.557, 0.045);
    leg.add(sole);
    leg.position.set(side * 0.178, 0, 0);
    legsGroup.add(leg);
  }

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

  // ── 面部轮廓 ──
  // 一颗球加几个五官 = "气球上贴了眼睛"，这正是"简陋"的来源。
  // 真实男脸的识别点是**下颌角 + 颧骨 + 下巴**这三块骨点，
  // 所以在这里用同肤色的低幅度体块把下半张脸的转折做出来（不是换脸型，是给骨点）。
  // 落位一律压在眼睛（y 0.04）以下、嘴（y −0.22）以外，避免挡到护栏盯的眉眼口。
  const skinShadeMat = pbrMat(new THREE.Color(config.skinTone).multiplyScalar(0.96).getHex(), 0.8);
  for (const side of [-1, 1]) {
    // 颧骨 / 颊部：颅骨在该处表面 z≈0.38，给出 0.03 的起伏就够读出转折。
    // 原来 0.13 的球凸出太多，正脸看是两坨鼓包（像斗牛犬），骨点变成"贴球"。
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.112, 14, 10), skinMat);
    cheek.name = `dh-cheek-${side > 0 ? 'r' : 'l'}`;
    cheek.position.set(side * 0.235, -0.145, 0.302);
    cheek.scale.set(1, 0.9, 0.6);
    headGroup.add(cheek);
    // 下颌角：方脸的关键骨点，东亚中年男性尤其明显
    const jawCorner = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), skinMat);
    jawCorner.position.set(side * 0.352, -0.26, 0.14);
    jawCorner.scale.set(0.9, 1.15, 0.9);
    headGroup.add(jawCorner);
    // 耳廓内凹：耳朵不再是一个贴上去的扁球
    const concha = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.0075, 6, 12), skinShadeMat);
    concha.position.set(side * 0.474, 0.0, 0.005);
    concha.rotation.y = Math.PI / 2;
    concha.scale.set(1, 1.35, 1);
    headGroup.add(concha);
  }
  // 下巴：横向略宽（不是尖下巴），下沿比颅骨底再低一点，收住下半张脸。
  // 不要往前凸：凸出去就是一个独立的球（截图里像挂了撮山羊胡），下半张脸反而失真。
  const chin = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), skinMat);
  chin.name = 'dh-chin';
  chin.position.set(0, -0.40, 0.262);
  chin.scale.set(1.35, 0.9, 0.95);
  headGroup.add(chin);

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
  // 鼻翼：鼻梁低 + 鼻头圆宽是东亚鼻型，只给一个鼻头会像扣了颗珠子
  const alaMat = pbrMat(new THREE.Color(config.skinTone).multiplyScalar(0.94).getHex(), 0.8);
  for (const side of [-1, 1]) {
    const ala = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), alaMat);
    ala.position.set(side * 0.055, -0.1, 0.442);
    ala.scale.set(1, 0.85, 0.85);
    headGroup.add(ala);
  }

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
  // 臂长口径：肩峰→中指 = 0.44 × 站高 = 0.44 × 3.886 ≈ **1.71**。
  // 原实现（上臂 0.5 + 前臂 0.42 + 一只方块手套）只有 1.25，指尖停在腰上头——
  // 下半身补齐之后这个短板立刻显形（胳膊短 = 小孩/Q 版比例），所以整条手臂加长。
  const armGeom = new THREE.CylinderGeometry(0.095, 0.079, 0.75, 12);
  const elbowGeom = new THREE.SphereGeometry(0.08, 12, 8);
  const forearmGeom = new THREE.CylinderGeometry(0.078, 0.062, 0.62, 12);
  const gloveMat = pbrMat(config.gloveColor, 0.82);
  const cuffMat = pbrMat(new THREE.Color(config.overallColor).multiplyScalar(0.9).getHex(), 0.9, 0, {
    map: weave ?? undefined,
  });

  /**
   * 手：掌 + 四指 + 拇指 + 袖口。
   * 原来是一只 0.11×0.09×0.15 的方块手套 —— 用户说的"方块人"里有一半说的是它。
   * 低多边形下只要把掌、指、拇分给三个体块并让指节微微内收，
   * 手就立刻读作"手"而不是"一截管子末端"。
   */
  function createHand(side: number): THREE.Group {
    const hand = new THREE.Group();
    hand.name = `dh-hand-${side > 0 ? 'r' : 'l'}`;

    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.115, 0.05), gloveMat);
    palm.position.set(0, -0.058, 0);
    hand.add(palm);

    // 四指：中指最长、两侧递减，微微向前收（松弛垂手，不是十指僵直）
    const fingerLen = [0.082, 0.092, 0.088, 0.07];
    for (let i = 0; i < 4; i++) {
      const finger = new THREE.Mesh(new THREE.BoxGeometry(0.0185, fingerLen[i], 0.042), gloveMat);
      finger.position.set(-0.0295 + i * 0.0197, -0.115 - fingerLen[i] / 2, 0.004);
      finger.rotation.x = 0.16 + i * 0.015;
      hand.add(finger);
    }
    // 拇指：斜挂在掌内侧（缺了它，垂手时手掌会被读成一片板）
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.062, 0.038), gloveMat);
    thumb.position.set(-side * 0.048, -0.06, 0.022);
    thumb.rotation.set(0.28, 0, side * 0.72);
    hand.add(thumb);

    // 袖口：工装袖子卷到腕上，遮掉掌—腕接缝，同时多一块布料层次
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.074, 0.068, 0.055, 12), cuffMat);
    cuff.position.set(0, 0.012, 0);
    hand.add(cuff);
    return hand;
  }

  function createArm(side: number): THREE.Group {
    const armGroup = new THREE.Group();

    const upperArm = new THREE.Mesh(armGeom, chestMat);
    upperArm.position.set(0, -0.375, 0);
    armGroup.add(upperArm);
    addOutline(armGroup, upperArm);

    const elbow = new THREE.Mesh(elbowGeom, chestMat);
    elbow.position.set(0, -0.75, 0);
    armGroup.add(elbow);

    const forearm = new THREE.Mesh(forearmGeom, chestMat);
    forearm.position.set(0, -1.06, 0.05);
    forearm.rotation.x = -0.15;
    armGroup.add(forearm);

    // 上臂补一块肱二头肌体块：整条手臂只有一根锥台圆柱时，袖子看着像两根 PVC 管
    const biceps = new THREE.Mesh(new THREE.SphereGeometry(0.078, 12, 8), chestMat);
    biceps.position.set(side * 0.02, -0.3, 0.045);
    biceps.scale.set(0.85, 1.5, 0.9);
    armGroup.add(biceps);

    const hand = createHand(side);
    hand.position.set(0, -1.4, 0.085);
    hand.rotation.y = -side * 0.35;
    armGroup.add(hand);

    return armGroup;
  }

  const leftArmGroup = createArm(-1);
  // 肩线上移到 0.62（配合领口抬高），手臂挂点跟着上移，保持原来 0.07 的落差
  leftArmGroup.position.set(-0.52, 0.52, 0);
  leftArmGroup.rotation.z = 0.15;
  leftArmGroup.rotation.x = -0.06;
  torsoGroup.add(leftArmGroup);

  const rightArmGroup = createArm(1);
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
        // 布纹贴图必须一起释放：换人设时旧模型不丢纹理，切三次就是一份显存
        const disposeMat = (m: THREE.Material) => {
          const std = m as THREE.MeshStandardMaterial;
          std.map?.dispose();
          std.dispose();
        };
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach(disposeMat);
        } else {
          disposeMat(mesh.material);
        }
      }
    }
  });
}
