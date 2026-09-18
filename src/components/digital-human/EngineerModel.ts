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
}

export interface EngineerModelResult {
  group: THREE.Group;       // root group to add to scene
  headGroup: THREE.Group;   // yaw micro-motion target
  torsoGroup: THREE.Group;  // scale.y breathing target
  jaw: THREE.Mesh;          // scaleY for lip sync (0.15=closed, 1.0=open)
  leftEye: THREE.Group;     // scaleY for blink
  rightEye: THREE.Group;    // scaleY for blink
  leftArm: THREE.Group;     // rotation.z for arm gestures
  rightArm: THREE.Group;    // rotation.z for arm gestures
}

export const PERSONA_CONFIGS: Record<string, PersonaConfig> = {
  zhang: {
    helmetColor: 0xf0f0f0,
    overallColor: 0x2f4a63,
    skinTone: 0xe8b48c,
    stripColor: 0xa3e635,
    goggleTint: 0x38bdf8,    // 天蓝护目镜
    hasBeard: false,
    badgeAccent: 0x0ea5e9,
    gloveColor: 0x2d3436,
  },
  li: {
    helmetColor: 0x2563eb,
    overallColor: 0x1e3a5f,
    skinTone: 0xf0c8a0,
    stripColor: 0xa3e635,
    goggleTint: 0x10b981,    // 翠绿护目镜
    hasBeard: false,
    badgeAccent: 0x10b981,
    gloveColor: 0x2d3436,
  },
  zhi: {
    helmetColor: 0xf5b301,
    overallColor: 0x334155,
    skinTone: 0xe8b48c,
    stripColor: 0xa3e635,
    goggleTint: 0x06b6d4,    // 青色护目镜
    hasBeard: false,
    badgeAccent: 0x06b6d4,
    gloveColor: 0x2d3436,
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
// 脖子：cylinder 中心 y=0.75、半高 0.11 → 顶端 0.86
const NECK_TOP_Y = 0.86;
// 颅骨：SphereGeometry 半径 0.48，y 轴缩放 0.93 → 半高 0.4464
const SKULL_HALF_HEIGHT = 0.48 * 0.93;

export function buildEngineerModel(personaId: string): EngineerModelResult {
  const config = PERSONA_CONFIGS[personaId] || PERSONA_CONFIGS['zhang'];
  
  const root = new THREE.Group();
  root.name = 'engineer-root';

  const torsoGroup = new THREE.Group();
  torsoGroup.name = 'torsoGroup';
  root.add(torsoGroup);

  // === Torso ===
  const chestGeom = new THREE.CylinderGeometry(0.42, 0.36, 0.8, 16);
  const chestMat = pbrMat(config.overallColor, 0.88); // 工装布料：哑光、几乎无高光
  const chest = new THREE.Mesh(chestGeom, chestMat);
  chest.position.set(0, 0.2, 0);
  torsoGroup.add(chest);
  addOutline(torsoGroup, chest);

  const lowerTorsoGeom = new THREE.CylinderGeometry(0.36, 0.32, 0.45, 16);
  const lowerTorso = new THREE.Mesh(lowerTorsoGeom, chestMat);
  lowerTorso.position.set(0, -0.35, 0);
  torsoGroup.add(lowerTorso);

  const neckGeom = new THREE.CylinderGeometry(0.11, 0.11, 0.22, 12);
  const skinMat = pbrMat(config.skinTone, 0.78); // 皮肤：哑光微油，不要塑料感
  const neck = new THREE.Mesh(neckGeom, skinMat);
  neck.position.set(0, 0.75, 0);
  torsoGroup.add(neck);

  const shoulderPadGeom = new THREE.BoxGeometry(0.22, 0.07, 0.18);
  const leftShoulderPad = new THREE.Mesh(shoulderPadGeom, chestMat);
  leftShoulderPad.position.set(-0.46, 0.55, 0);
  torsoGroup.add(leftShoulderPad);

  const rightShoulderPad = new THREE.Mesh(shoulderPadGeom, chestMat);
  rightShoulderPad.position.set(0.46, 0.55, 0);
  torsoGroup.add(rightShoulderPad);

  // Strips
  // 反光条：自发光让它在不同光照下都保持"高能见度"的工业安全语义，同时保留哑光基底
  const stripMat = pbrMat(config.stripColor, 0.6, 0.0, {
    emissive: new THREE.Color(config.stripColor),
    emissiveIntensity: 0.25,
  });
  const chestStripGeom = new THREE.BoxGeometry(0.6, 0.04, 0.03);
  const chestStrip = new THREE.Mesh(chestStripGeom, stripMat);
  chestStrip.position.set(0, 0.15, 0.37);
  torsoGroup.add(chestStrip);

  const shoulderStripGeom = new THREE.BoxGeometry(0.2, 0.04, 0.03);
  const leftShoulderStrip = new THREE.Mesh(shoulderStripGeom, stripMat);
  leftShoulderStrip.position.set(-0.43, 0.52, 0.12);
  torsoGroup.add(leftShoulderStrip);

  const rightShoulderStrip = new THREE.Mesh(shoulderStripGeom, stripMat);
  rightShoulderStrip.position.set(0.43, 0.52, 0.12);
  torsoGroup.add(rightShoulderStrip);

  // Badge
  const badgeMat = pbrMat(0xffffff);
  const badgeGeom = new THREE.BoxGeometry(0.12, 0.15, 0.02);
  const badge = new THREE.Mesh(badgeGeom, badgeMat);
  badge.position.set(-0.2, 0.35, 0.38);
  torsoGroup.add(badge);

  const badgeDetailMat = pbrMat(config.badgeAccent);
  const badgeDetailGeom = new THREE.BoxGeometry(0.08, 0.04, 0.01);
  const badgeDetail = new THREE.Mesh(badgeDetailGeom, badgeDetailMat);
  badgeDetail.position.set(-0.2, 0.33, 0.395);
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
  // 脖子顶端在 y=0.86（cylinder 中心 0.75 + 半高 0.11），让颅骨底略低于它形成自然衔接。
  headGroup.position.set(0, NECK_TOP_Y + SKULL_HALF_HEIGHT * HEAD_SCALE - 0.02, 0);
  torsoGroup.add(headGroup);

  const skullGeom = new THREE.SphereGeometry(0.48, 32, 24);
  const skull = new THREE.Mesh(skullGeom, skinMat);
  skull.scale.set(1, 0.93, 0.96);
  headGroup.add(skull);
  addOutline(headGroup, skull);

  // 写实眼：去掉二次元"三件套"（纯白眼白 + 占眼球一半的瞳孔 + 悬空的白色高光小球）。
  // 高光不再用小球伪造，改为靠低 roughness 让场景灯光在眼白上自然产生湿润高光。
  const eyeWhiteMat = pbrMat(0xf2efe9, 0.14);
  const irisMat = pbrMat(0x3b2418, 0.3);
  const pupilMat = pbrMat(0x0a0a0f, 0.08);

  function createEye(): THREE.Group {
    const eyeGroup = new THREE.Group();
    const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.072, 16, 12), eyeWhiteMat);
    // 真人虹膜直径约占眼球 46%（11.7mm / 24mm），瞳孔更小 —— 原实现是 55% + 无虹膜，一眼动漫
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.036, 16, 12), irisMat);
    iris.position.set(0, 0, 0.046);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), pupilMat);
    pupil.position.set(0, 0, 0.066);
    eyeGroup.add(eyeWhite, iris, pupil);
    return eyeGroup;
  }

  const leftEyeGroup = createEye();
  leftEyeGroup.position.set(-0.17, 0.04, 0.42);
  headGroup.add(leftEyeGroup);

  const rightEyeGroup = createEye();
  rightEyeGroup.position.set(0.17, 0.04, 0.42);
  headGroup.add(rightEyeGroup);

  const browMat = pbrMat(0x5c4033);
  const browGeom = new THREE.BoxGeometry(0.13, 0.028, 0.04);
  const leftBrow = new THREE.Mesh(browGeom, browMat);
  leftBrow.position.set(-0.17, 0.16, 0.44);
  leftBrow.rotation.z = 0.08;
  headGroup.add(leftBrow);

  const rightBrow = new THREE.Mesh(browGeom, browMat);
  rightBrow.position.set(0.17, 0.16, 0.44);
  rightBrow.rotation.z = -0.08;
  headGroup.add(rightBrow);

  const noseTipColor = new THREE.Color(config.skinTone).multiplyScalar(0.92).getHex();
  const noseTipGeom = new THREE.SphereGeometry(0.055, 12, 8);
  const noseTip = new THREE.Mesh(noseTipGeom, pbrMat(noseTipColor));
  noseTip.position.set(0, -0.06, 0.46);
  headGroup.add(noseTip);

  const noseBridgeGeom = new THREE.CylinderGeometry(0.02, 0.03, 0.12, 8);
  const noseBridge = new THREE.Mesh(noseBridgeGeom, skinMat);
  noseBridge.position.set(0, 0.02, 0.44);
  noseBridge.rotation.x = -0.25;
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
  jaw.position.set(0, -0.01, 0);
  jaw.scale.set(1.4, 0.15, 0.9);
  mouthGroup.add(jaw);

  // Helmet
  const helmetGroup = new THREE.Group();
  helmetGroup.position.set(0, 0.33, 0);
  headGroup.add(helmetGroup);

  // 安全帽是 ABS 工程塑料：光滑、有明显高光 —— 与工装的哑光形成材质对比
  const helmetMat = pbrMat(config.helmetColor, 0.26, 0.05);
  const domeGeom = new THREE.SphereGeometry(0.58, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const dome = new THREE.Mesh(domeGeom, helmetMat);
  helmetGroup.add(dome);
  addOutline(helmetGroup, dome);

  const brimGeom = new THREE.BoxGeometry(0.72, 0.04, 0.28);
  const brim = new THREE.Mesh(brimGeom, helmetMat);
  brim.position.set(0, -0.2, 0.32);
  brim.rotation.x = -0.1;
  helmetGroup.add(brim);

  const ridgeColor = new THREE.Color(config.helmetColor).multiplyScalar(0.85).getHex();
  const ridgeGeom = new THREE.CylinderGeometry(0.03, 0.03, 0.65, 8);
  const ridge = new THREE.Mesh(ridgeGeom, pbrMat(ridgeColor));
  ridge.position.set(0, 0.28, 0);
  ridge.rotation.x = Math.PI / 2;
  helmetGroup.add(ridge);

  const ventGeom = new THREE.CircleGeometry(0.022, 8);
  const ventMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  for (let i = 0; i < 6; i++) {
    const phi = Math.PI * 0.35;
    const theta = Math.PI * 0.3 + (i * 0.15);
    const r = 0.585;
    
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.cos(phi);
    const z = r * Math.sin(phi) * Math.sin(theta);
    
    const leftVent = new THREE.Mesh(ventGeom, ventMat);
    leftVent.position.set(x, y, z);
    leftVent.lookAt(0, 0, 0);
    leftVent.rotation.y += Math.PI; // Face outwards
    helmetGroup.add(leftVent);

    const rightVent = new THREE.Mesh(ventGeom, ventMat);
    rightVent.position.set(-x, y, z); // Mirror X
    rightVent.lookAt(0, 0, 0);
    rightVent.rotation.y += Math.PI;
    helmetGroup.add(rightVent);
  }

  const chinStrapMat = pbrMat(0x374151);
  const chinStrapGeom = new THREE.TorusGeometry(0.4, 0.012, 4, 16, Math.PI * 0.65);
  const chinStrap = new THREE.Mesh(chinStrapGeom, chinStrapMat);
  chinStrap.position.set(0, -0.38, 0.05);
  chinStrap.rotation.x = -0.15;
  chinStrap.rotation.z = Math.PI / 2 - (Math.PI * 0.65) / 2; // Center the arc
  helmetGroup.add(chinStrap);

  // 安全帽正前方工程身份标识徽章
  const emblemMat = pbrMat(config.badgeAccent, 0.4, 0.1, {
    emissive: new THREE.Color(config.badgeAccent),
    emissiveIntensity: 0.35,
  });
  const emblemGeom = new THREE.CylinderGeometry(0.045, 0.045, 0.015, 8);
  const emblem = new THREE.Mesh(emblemGeom, emblemMat);
  emblem.position.set(0, 0.08, 0.58);
  emblem.rotation.x = Math.PI / 2;
  helmetGroup.add(emblem);

  // Goggles - 工业专业护目镜
  const gogglesGroup = new THREE.Group();
  gogglesGroup.position.set(0, 0.06, 0.02);
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
  leftArmGroup.position.set(-0.52, 0.45, 0);
  leftArmGroup.rotation.z = 0.15;
  leftArmGroup.rotation.x = -0.06;
  torsoGroup.add(leftArmGroup);

  const rightArmGroup = createArm();
  rightArmGroup.position.set(0.52, 0.45, 0);
  rightArmGroup.rotation.z = -0.15;
  rightArmGroup.rotation.x = -0.06;
  torsoGroup.add(rightArmGroup);

  return {
    group: root,
    headGroup,
    torsoGroup,
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
