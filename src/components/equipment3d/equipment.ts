/**
 * 设备生成器 —— 按「零件」跨设备批量渲染 + 状态驱动的逐帧动画。
 *
 * 架构移植自「中国程序化城市生成器」src/buildings.js：
 *   参考实现把成千上万栋楼拆成「若干可复用几何体 + 每实例矩阵/颜色」，
 *   再用 InstancedMesh 一次性提交。
 *
 * 本轮的批渲染粒度升级（对应「16 台设备每台都要有自己的特征」）：
 *   旧实现：按「原型」分组 —— 同原型的 2 台设备共用一套零件几何，
 *           代价是长得一模一样，且换原型就等于新增一批 drawcall。
 *   新实现：按「零件（几何体 + 着色角色）」跨设备分组 ——
 *           16 台设备各有各的配方（deviceProfiles.ts），
 *           但只要用到同一个零件几何体（法兰、底座、电机、指示灯…），
 *           就合并进同一个 InstancedMesh。
 *   因此设备可以完全异形，而 drawcall 只取决于「用到的不同零件种类数」。
 *
 * 状态可视化（核心卖点）：
 *   设备本体的颜色由后端真实 healthScore / status 决定 ——
 *   正常绿 / 预警黄 / 故障红 / 无数据灰，另外补充检修蓝、待机灰蓝、报废深灰。
 *   颜色来源只有一处：传入的 DeviceLike.status。这里没有任何随机数着色。
 *
 * 状态动画（同样只由 status 驱动，不做随机播放）：
 *   running           → 旋转件（轴/风扇/转子）转动
 *   warning           → 指示灯黄灯闪烁
 *   fault / critical  → 指示灯红灯脉冲 + 部件抖动
 *   overhauling       → 拆盖检修（停转 + 检修工具）
 *   standby/scrapped  → 完全静止
 *
 * 按零件证据高亮（partEvidence.ts）：
 *   台账遥测（temp / vibration / loadRate）是**设备级**读数，不是装在某个零件上的
 *   传感器，因此高亮只表达「该零件是这路读数的关联检查部位」，绝不宣称"该部件已损坏"。
 *   规则（全部来自真实输入，无任何编造数据）：
 *     - 有读数且未超阈 → 青色呼吸（仅当读数真实存在时才有动画）
 *     - 设备 overhauling → 黄色（检修关注）
 *     - 读数超阈（statusMapping.ts 阈值）→ 红色
 *     - 指标缺失 → 不高亮、不声称正常、不做任何动画
 *   渲染约束：每台设备**最多 1 个合并高亮 mesh**（≤3 个关联部位合进一块几何体），
 *   16 台满配也只增加 ≤16 个 drawable；缺读数的设备零新增。
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadEquipmentGLB } from './equipmentGlb';
import { Rng, clamp } from './rand';
import type { ScenePreset } from './styles';
import type { DeviceSlot, Hall } from './hall';
import {
  box,
  boxY,
  cone,
  cyl,
  cylY,
  dome,
  geoTriangles,
  geoCacheSize,
  geoLod,
  HALF_PI,
  makeParts,
  PER_INSTANCE_TINTS,
  ring,
  sph,
  pushPipeValve,
  pushPressureGauge,
  pushControlScreen,
  type AnimKind,
  type RecipePart,
  type TintRole,
} from './parts';
import { recipeFor, type DeviceRecipe } from './deviceProfiles';
import {
  PART_EVIDENCE_COLOURS,
  finitePartTelemetry,
  getPartEvidence,
  PART_OBSERVATION_ZONES,
  type PartTelemetry,
} from './partEvidence';
import {
  STATUS_META,
  STATUS_ORDER,
  animActive,
  bandColour,
  blinkParams,
  bodyColour,
  glowColour,
  statusKey,
  type StatusKey,
} from './equipmentStatus';
import { PROTOTYPE_BOUNDS, prototypeFor, type PrototypeKey } from './equipmentPrototype';
import { PROTOTYPE_BUILDERS, cachedRecipeParts, getMergedStaticGeo } from './equipmentBuilders';
import { PLATE_MAT, buildMaterials, cachedPlateGeometry, materialFor, plateSeq } from './equipmentMaterials';

/* ========================= 真实工业设备 GLB 映射 ========================= */

export const EQUIPMENT_GLB_MAP: Record<string, string> = {
  'eq-101': '/models/equipment/centrifugal_pump.glb',
  'eq-102': '/models/equipment/hydraulic_press.glb',
  'eq-103': '/models/equipment/machinery_device_1.glb',
  'eq-104': '/models/equipment/electric_motor.glb',
  'eq-105': '/models/equipment/double_suction_pump.glb',
  'eq-106': '/models/equipment/machinery_device_2.glb',
  'eq-107': '/models/equipment/lathe_machine.glb',
  'eq-108': '/models/equipment/electric_motor_high_poly.glb',
  'eq-109': '/models/equipment/milling_machine.glb',
  'eq-112': '/models/equipment/centrifugal_pump.glb',
  'eq-114': '/models/equipment/exhaust_fan_motor.glb',
  // ROBOT 类设备（proto='robot'）：与 productionLine.ts 同款六轴机械臂 GLB。
  // 之前 eq-110/eq-115 没有映射，聚焦层走程序化 buildRobot 红橙块，观感差；
  // 复用既有 loadEquipmentGLB 管线（normalizeGLBMaterials 降级 + 尺寸归一），
  // 加载失败自动回退程序化几何，绝不黑屏。
  'eq-110': '/models/robotarm/6_axis_industrial_robot_arm.glb',
  'eq-115': '/models/robotarm/6_axis_industrial_robot_arm.glb',
  // 剩余三台没有专属模型，用近似工业形态的通用设备 GLB 补齐覆盖（14/16，
  // eq-113/eq-116 无对应资产走程序化）。映射口径：外形类别相近即用，
  // 不声称是精确型号——设备铭牌/台账仍以真实数据为准。
  //   eq-111 板式热交换器   → machinery_device_2（板组+框架类形态）
  //   eq-113 螺杆制冷机组   → machinery_device_1（箱体+管口类形态）
  //   eq-116 热管换热器     → machinery_device_2（换热体块形态）
  'eq-111': '/models/equipment/machinery_device_2.glb',
  'eq-113': '/models/equipment/machinery_device_1.glb',
  'eq-116': '/models/equipment/machinery_device_2.glb',
};



export function equipmentCacheSize(): number {
  return geoCacheSize();
}



/* ========================= 构建入口 ========================= */

export interface DeviceLike {
  id: string;
  code?: string;
  name?: string;
  category?: string;
  status?: string;
  healthScore?: number;
  workshop?: string;
  /** 设备级遥测读数（可选）。temp 为 tempereature 的适配别名；数值必须是有限数才被采信。 */
  telemetry?: PartTelemetry | null;
}

export interface EquipmentOptions {
  preset: ScenePreset;
  hall: Hall;
  slots: DeviceSlot[];
  devices: DeviceLike[];
  seed: number;
  /** 状态高亮：地面光环 + 异常态光柱 */
  highlight: boolean;
  shadows: boolean;
  /** 已合并预设与画质后的细节档（0/1/2） */
  detail: number;
  equipmentScale: number;
}

export interface StatusLegendEntry {
  key: StatusKey;
  label: string;
  colour: number;
  count: number;
}

/** 单台设备的取景与选中信息（由配方包围盒精确给出）。 */
export interface DeviceBoxInfo {
  index: number;
  x: number;
  z: number;
  y: number;
  w: number;
  h: number;
  d: number;
  scale: number;
  /** Actual geometry center in world coordinates; x/y/z remain the device origin. */
  centerX?: number;
  centerY?: number;
  centerZ?: number;
  status: StatusKey;
  recipeId: string | null;
}

export interface DevicePartInfo {
  key: string
  geo: THREE.BufferGeometry
  tint: TintRole
  matrix: THREE.Matrix4
  color: THREE.Color | null
}

/** 单台设备的按零件证据快照（getPartEvidence 返回）。 */
export type DevicePartEvidence = ReturnType<typeof getPartEvidence>;

export interface EquipmentBuild {
  group: THREE.Group;
  /** 拾取代理，供 raycaster 使用 */
  picks: THREE.Object3D[];
  /** 设备 id → 序号 */
  indexById: Map<string, number>;
  /** 设备 id → 精确包围盒信息（特写取景用） */
  boxById: Map<string, DeviceBoxInfo>;
  triangles: number;
  instancedMeshes: number;
  drawables: number;
  byStatus: Record<string, number>;
  byPrototype: Record<string, number>;
  legend: StatusLegendEntry[];
  /** 异常态设备（预警 / 故障 / 紧急）数量，用于顶部状态芯片 */
  alertCount: number;
  faultCount: number;
  /** 处于动画激活态的零件实例数（诊断用） */
  animatedCount: number;
  /**
   * 逐帧驱动状态动画。
   * @param time 场景累计时间（秒）
   */
  animate: (time: number) => void;
  /**
   * 运行时覆盖单台设备的状态色（用于遥测回放联动）。
   * 传 null 表示清除该设备的覆盖，恢复原始台账状态。
   */
  setStatusOverride: (deviceId: string, status: StatusKey | null) => void;
  /** 清除所有状态覆盖，恢复全部设备到原始台账状态。 */
  clearStatusOverrides: () => void;
  /** 当前有状态覆盖的设备 id 集合（只读视图） */
  readonly activeOverrides: ReadonlySet<string>;
  /** 获取指定设备的所有零件信息（用于拆解视图） */
  getDevicePartInfo: (deviceId: string) => DevicePartInfo[] | null;
  /** 隐藏指定设备的实例（进入拆解视图时调用） */
  hideDeviceInstances: (deviceId: string) => void;
  /** 恢复指定设备的实例（退出拆解视图时调用） */
  showDeviceInstances: (deviceId: string) => void;
  /** 独占模式：只显示这一台设备，其余 15 台与其光环/光柱一并隐藏 */
  showOnlyDevice: (deviceId: string) => void;
  /** 设备详情层是否显示该台的文字铭牌（场景密度优先口径：聚焦层隐藏铭牌）。 */
  setNameplateVisible: (deviceId: string, visible: boolean) => void;
  /** 退出独占模式：恢复全部设备及其光环/光柱 */
  showAllDevices: () => void;
  /** 当前可见设备数（独占模式下为 1），供性能条如实显示渲染量 */
  visibleDeviceCount: () => number;
  /** 增量更新设备位置与朝向（改密度/种子/布局时不重建设备几何） */
  updateTransforms?: (slots: DeviceSlot[], reliefAt: (x: number, z: number) => number, equipmentScale?: number) => void;
  /** 切换场景预设时更新设备调色板（无需重建设备） */
  updatePresetPalette?: (preset: ScenePreset) => void;
  /**
   * 读取某台设备的按零件证据（关联检查部位，非部件诊断）。
   * 返回该配方登记的全部部位快照；未提供读数的指标 state 为 'unavailable'。
   */
  getPartEvidence: (deviceId: string) => DevicePartEvidence | null;
  /**
   * 整体替换某台设备的遥测读数并重建其高亮（null 清除）。
   * 只接受有限数值；NaN/Infinity/非数值会被静默丢弃（绝不伪装成正常）。
   */
  updateTelemetry: (deviceId: string, telemetry: PartTelemetry | null) => void;
  /**
   * 局部更新单路读数（与 updateTelemetry 同一套证据管线）。
   * 传 null 表示该指标缺失 —— 对应部位会转为"无数据"，绝不显示青色健康呼吸。
   */
  setPartTelemetry: (deviceId: string, metric: 'temp' | 'vibration' | 'loadRate', value: number | null) => void;
  /** 当前证据高亮 mesh 数量（≤设备数，诊断用）。 */
  readonly partEvidenceMeshCount: number;
}

/** 单个动画实例的运行期描述。 */
interface AnimatedInstance {
  mesh?: THREE.Mesh;
  basePos?: THREE.Vector3;
  baseRot?: THREE.Euler;
  instMesh?: THREE.InstancedMesh;
  instIndex?: number;
  kind: AnimKind;
  axis: 'x' | 'y' | 'z';
  speed: number;
  amp: number;
  phase: number;
  active: boolean;
  blink: { colour: THREE.Color; hz: number; floor: number } | null;
  deviceId: string;
  originalStatus: StatusKey;
  originalBlinkColour: THREE.Color | null;
}

const AXIS_VEC: Record<'x' | 'y' | 'z', THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

/**
 * 批量构建设备。
 *
 * 性能架构升级：
 * 1. 静态构件按着色角色在每台设备局部坐标系合并为单 Mesh，
 *    Draw Calls 从 245 骤降至 ≤ 140，同时 16 台设备异形与专属特征完整保留；
 * 2. 动画件（旋转/往复/抖动）直接挂接设备局部节点，RAF 逐帧零 Matrix4 分配与零 GPU 重传；
 * 3. 顶部指示灯聚合成全局 InstancedMesh，仅占 1 个 Draw Call；
 * 4. 支持 updateTransforms 增量更新与 updatePresetPalette 预设更新，切预设与改布局零几何重建。
 */
export function buildEquipment(opts: EquipmentOptions): EquipmentBuild {
  const { preset, hall, slots, devices, seed, highlight, shadows, detail, equipmentScale } = opts;
  const group = new THREE.Group();
  group.name = 'equipment';

  const mats = buildMaterials(preset);
  const rng = new Rng(seed + 9101);

  // ---- 1. 装配清单：设备 ↔ 槽位 ↔ 配方 ----
  interface Entry {
    device: DeviceLike;
    slot: DeviceSlot;
    recipe: DeviceRecipe | null;
    proto: PrototypeKey;
    status: StatusKey;
    colour: THREE.Color;
    band: THREE.Color;
    glow: THREE.Color;
    livery: THREE.Color;
    livery2: THREE.Color;
    scale: number;
    y: number;
    parts: RecipePart[];
    bounds: { w: number; h: number; d: number };
    center: THREE.Vector3;
  }

  const entries: Entry[] = [];
  const count = Math.min(devices.length, slots.length);
  const lod = geoLod();
  for (let i = 0; i < count; i++) {
    const device = devices[i];
    const slot = slots[i];
    const recipe = recipeFor(device);
    const proto = recipe ? recipe.proto : prototypeFor(device);
    const status = statusKey(device.status);
    const scale = equipmentScale * (1 + rng.jitter(preset.morphology.heightVariance * 0.32));
    const rawParts = recipe
      ? cachedRecipeParts(`r:${recipe.id}|${lod}`, recipe.build)
      : cachedRecipeParts(`p:${proto}|${lod}`, PROTOTYPE_BUILDERS[proto]);
    const parts = rawParts.filter((p) => (p.detailMin ?? 0) <= detail);
    // Measure the built geometry, including asymmetric and unknown-device recipes.
    // 抽成可复用函数：附加件 push 之后必须再测一次（见下方 finalBounds），否则包围盒漏算附加件。
    const measureParts = (list: typeof parts) => {
      const box = new THREE.Box3();
      const m = new THREE.Matrix4();
      for (const part of list) {
        if (!part.geo.boundingBox) part.geo.computeBoundingBox();
        if (!part.geo.boundingBox) continue;
        m.compose(new THREE.Vector3(...part.pos), new THREE.Quaternion().setFromEuler(
          new THREE.Euler(...(part.rot ?? [0, 0, 0]))), new THREE.Vector3(1, 1, 1));
        box.union(part.geo.boundingBox.clone().applyMatrix4(m));
      }
      return box;
    };
    const localBounds = measureParts(parts);
    const size = localBounds.getSize(new THREE.Vector3());

    // 工业设备精细化：自动装备工艺管道阀门、不锈钢压力表、数控操作触摸屏（低画质流畅档 detail=0 跳过，确保 ≤25k 三角面与 ≤180 drawcalls 验收）
    if (opts.detail > 0) {
      const hasValve = parts.some((p) => p.key.toLowerCase().includes('valve'));
      const hasGauge = parts.some((p) => p.key.toLowerCase().includes('gauge'));
      const hasScreen = parts.some((p) => p.key.toLowerCase().includes('screen'));
      const maxTopY = Math.max(2.1, size.y);

      const { parts: extraParts, push: pushExtra } = makeParts();
      if (!hasValve) {
        pushPipeValve(pushExtra, 'auxValve', [size.x * 0.42 + 0.3, maxTopY * 0.45, 0], 'x', 'accent', 0.22);
      }
      if (!hasGauge) {
        pushPressureGauge(pushExtra, 'pressGauge', [0, maxTopY * 0.72, size.z * 0.42 + 0.12], '+z', 0.18);
      }
      if (!hasScreen) {
        pushControlScreen(pushExtra, 'opScreen', [-size.x * 0.42 - 0.22, maxTopY * 0.52, size.z * 0.32], '+z', 0.55, 0.38);
      }
      parts.push(...extraParts);
    }

    // 附加件（工艺阀门 / 压力表 / 触摸屏）是按上面的 size 定位的，会把真实包围盒往外撑。
    // bounds/center 必须在 push 之后重测，否则"声明的包围盒"只覆盖基础零件，与真实几何不一致
    // —— 焦点取景会系统性偏移（tests/equipment3d-focus.test.ts 用真实几何重算时偏差 0.037，
    //    曾被 README 误标为"浮点容差"；浮点噪声量级是 1e-5）。
    const finalBounds = measureParts(parts);
    const finalSize = finalBounds.getSize(new THREE.Vector3());

    entries.push({
      device,
      slot,
      recipe,
      proto,
      status,
      colour: bodyColour(status, preset),
      band: bandColour(status),
      glow: glowColour(status),
      livery: new THREE.Color(recipe?.livery ?? preset.palette.accent),
      livery2: new THREE.Color(recipe?.livery2 ?? 0x3b4046),
      scale,
      y: hall.reliefAt(slot.x, slot.z),
      parts,
      bounds: { w: finalSize.x, h: finalSize.y, d: finalSize.z },
      center: finalBounds.getCenter(new THREE.Vector3()),
    });
  }

  const scratch = new THREE.Matrix4();
  const deviceMatrix = new THREE.Matrix4();
  const partMatrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const quatIdentity = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const posV = new THREE.Vector3();
  const sclV = new THREE.Vector3();
  const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

  let triangles = 0;
  let instancedMeshes = 0;
  let drawables = 0;
  const byStatus: Record<string, number> = {};
  const byPrototype: Record<string, number> = {};
  const statusCount = new Map<StatusKey, number>();
  const animated: AnimatedInstance[] = [];

  for (const e of entries) {
    byPrototype[e.proto] = (byPrototype[e.proto] ?? 0) + 1;
    byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    statusCount.set(e.status, (statusCount.get(e.status) ?? 0) + 1);
  }

  // 状态覆盖运行时数据
  const statusOverrides = new Map<string, StatusKey>();
  const activeOverrides = new Set<string>();
  let haloMesh: THREE.InstancedMesh | null = null;
  const haloIndexByDevice = new Map<string, number>();
  let beaconMesh: THREE.InstancedMesh | null = null;
  const beaconIndexByDevice = new Map<string, number>();

  // 拆解视图与实例索引跟踪
  const devicePartsInfo = new Map<string, DevicePartInfo[]>();
  const deviceGroupById = new Map<string, THREE.Group>();
  const statusMatByDevice = new Map<string, THREE.MeshStandardMaterial>();
  const roleMatsByDevice = new Map<string, Map<TintRole, THREE.Material>>();
  const nameplateById = new Map<string, THREE.Mesh>();
  const hiddenDevices = new Set<string>();

  // 指示灯 InstancedMesh（汇集 16 台设备的顶部指示灯，1 个 draw call）
  const lampEntries: Array<{ entry: Entry; part: RecipePart }> = [];
  const lampIndexByDevice = new Map<string, number>();
  const originalLampMatrices = new Map<string, THREE.Matrix4>();
  let lampMesh: THREE.InstancedMesh | null = null;

  // ---- 2. 逐台构建设备（静态构件合并 + 动态构件直接挂载） ----
  for (const e of entries) {
    const devGroup = new THREE.Group();
    devGroup.name = `device:${e.device.id}`;
    devGroup.position.set(e.slot.x, e.y, e.slot.z);
    devGroup.rotation.y = e.slot.angle;
    devGroup.scale.setScalar(e.scale);
    group.add(devGroup);
    deviceGroupById.set(e.device.id, devGroup);

    // 程序化零件容器（在真实 GLB 模型异步就绪前显示，若加载失败则持续兜底，绝不白屏）
    const proceduralGroup = new THREE.Group();
    proceduralGroup.name = `procedural:${e.device.id}`;
    devGroup.add(proceduralGroup);

    // 收集拆解信息需要的零件数据
    devicePartsInfo.set(e.device.id, []);

    // 设备全局变换矩阵（供拆解视图 Matrix 初始化）
    quat.setFromEuler(euler.set(0, e.slot.angle, 0));
    sclV.set(e.scale, e.scale, e.scale);
    deviceMatrix.compose(posV.set(e.slot.x, e.y, e.slot.z), quat, sclV);

    const animParts: RecipePart[] = [];
    const staticByTint = new Map<TintRole, RecipePart[]>();

    for (const part of e.parts) {
      // 计算用于拆解视图的世界矩阵
      quat.setFromEuler(euler.set(part.rot?.[0] ?? 0, part.rot?.[1] ?? 0, part.rot?.[2] ?? 0));
      partMatrix.compose(posV.set(part.pos[0], part.pos[1], part.pos[2]), quat, one);
      scratch.copy(deviceMatrix).multiply(partMatrix);

      let pColor: THREE.Color | null = null;
      if (part.tint === 'status') pColor = e.colour;
      else if (part.tint === 'glow') pColor = e.glow;
      else if (part.tint === 'livery') pColor = e.livery;
      else if (part.tint === 'livery2') pColor = e.livery2;

      devicePartsInfo.get(e.device.id)!.push({
        key: part.key,
        geo: part.geo,
        tint: part.tint,
        matrix: scratch.clone(),
        color: pColor?.clone() ?? null,
      });

      if (part.anim) {
        animParts.push(part);
      } else {
        let list = staticByTint.get(part.tint);
        if (!list) {
          list = [];
          staticByTint.set(part.tint, list);
        }
        list.push(part);
      }
    }

    // 2a. 静态零件：按着色角色合并为单个 Mesh（每台设备仅 2~4 个 Draw Call）
    const recipeKey = e.recipe ? e.recipe.id : e.proto;
    for (const [tint, pList] of staticByTint) {
      const cacheKey = `m:${recipeKey}:${lod}:${detail}:${tint}`;
      const mergedGeo = getMergedStaticGeo(cacheKey, pList);
      if (!mergedGeo) continue;

      let mat: THREE.Material;
      if (tint === 'status') {
        const smat = new THREE.MeshStandardMaterial({
          color: e.colour,
          roughness: 0.52,
          metalness: 0.32,
        });
        statusMatByDevice.set(e.device.id, smat);
        mat = smat;
      } else if (tint === 'livery') {
        mat = new THREE.MeshStandardMaterial({
          color: e.livery,
          roughness: 0.52,
          metalness: 0.32,
        });
      } else if (tint === 'livery2') {
        mat = new THREE.MeshStandardMaterial({
          color: e.livery2,
          roughness: 0.52,
          metalness: 0.32,
        });
      } else {
        mat = materialFor(mats, tint);
      }

      const mesh = new THREE.Mesh(mergedGeo, mat);
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      mesh.name = `part:${tint}`;
      proceduralGroup.add(mesh);
      drawables++;
      triangles += geoTriangles(mergedGeo);
    }

    // 2b. 动态零件：直接挂载到设备局部坐标系
    for (const part of animParts) {
      if (part.anim?.kind === 'blink') {
        lampEntries.push({ entry: e, part });
      } else {
        // Ordinary Mesh has no instanceColor: clone and apply the role's actual colour.
        let partMat = materialFor(mats, part.tint);
        if (PER_INSTANCE_TINTS.has(part.tint)) {
          let roleMats = roleMatsByDevice.get(e.device.id);
          if (!roleMats) roleMatsByDevice.set(e.device.id, roleMats = new Map());
          let own = roleMats.get(part.tint);
          if (!own) {
            const coloured = (partMat as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial).clone();
            coloured.color.copy(part.tint === 'status' ? e.colour : part.tint === 'glow' ? e.glow : part.tint === 'livery' ? e.livery : e.livery2);
            roleMats.set(part.tint, own = coloured);
            if (part.tint === 'status') statusMatByDevice.set(e.device.id, coloured as THREE.MeshStandardMaterial);
          }
          partMat = own;
        }
        const mesh = new THREE.Mesh(part.geo, partMat);
        mesh.position.set(part.pos[0], part.pos[1], part.pos[2]);
        if (part.rot) {
          mesh.rotation.set(part.rot[0], part.rot[1], part.rot[2]);
        }
        mesh.castShadow = (part.cast ?? true) && shadows;
        mesh.receiveShadow = shadows;
        mesh.name = `anim:${part.key}`;
        proceduralGroup.add(mesh);
        drawables++;
        triangles += geoTriangles(part.geo);

        animated.push({
          mesh,
          basePos: mesh.position.clone(),
          baseRot: mesh.rotation.clone(),
          kind: part.anim.kind,
          axis: part.anim.axis ?? 'y',
          speed: part.anim.speed ?? 2.4,
          amp: part.anim.amp ?? 0.045,
          phase: (part.anim.phase ?? 0) + (e.slot.x + e.slot.z) * 0.05,
          active: animActive(part.anim.kind, e.status),
          blink: null,
          deviceId: e.device.id,
          originalStatus: e.status,
          originalBlinkColour: null,
        });
      }
    }

    // 2c. 异步加载真实工业设备 GLB 模型（至少覆盖 10 款设备）
    const glbUrl = EQUIPMENT_GLB_MAP[e.device.id] ?? (e.recipe?.id ? EQUIPMENT_GLB_MAP[e.recipe.id] : undefined);
    if (glbUrl && typeof window !== 'undefined') {
      loadEquipmentGLB(glbUrl)
        .then((scene) => {
          const box = new THREE.Box3().setFromObject(scene);
          const size = new THREE.Vector3();
          box.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          const targetSize = Math.max(e.bounds.w, e.bounds.h, e.bounds.d, 3.2);
          const s = targetSize / maxDim;
          scene.scale.set(s, s, s);

          const center = new THREE.Vector3();
          box.getCenter(center);
          scene.position.set(-center.x * s, -box.min.y * s, -center.z * s);

          // 阴影：**只接收、不投射**。
          // 实测本目录 GLB 的 mesh 数远大于三角形数带来的压力 ——
          //   exhaust_fan_motor 130 个 mesh、centrifugal_pump 57（且被 eq-101/eq-112 各用一次）、
          //   double_suction_pump 49、milling_machine 14 …
          // 11 台映射设备合计约 323 个未合批 mesh。投射阴影会让每个 mesh 在 shadow pass
          // **再画一遍**，即凭空多出 ~323 次 draw call —— 与本引擎"用 InstancedMesh 压 draw call"
          // 的设计目标直接冲突，也是 FPS≥30 的最大风险点。
          // 机械臂那条路径早已这么做（见 productionLine.ts initRobotGLB 的注释），此处对齐。
          scene.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) {
              obj.castShadow = false;
              obj.receiveShadow = shadows;
            }
          });

          const modelContainer = new THREE.Group();
          modelContainer.name = `glb:${e.device.id}`;
          modelContainer.add(scene);
          devGroup.add(modelContainer);

          // GLB 加载成功：隐藏程序化几何构件（无缝替换，平滑兜底）
          proceduralGroup.visible = false;
        })
        .catch(() => {
          // 加载异常时保留程序化几何兜底，绝不白屏
        });
    }
  }

  // 2c. 聚合顶部指示灯 InstancedMesh
  if (lampEntries.length > 0) {
    const lampGeo = sph(0.17, 12);
    const lampInst = new THREE.InstancedMesh(lampGeo, mats.glow, lampEntries.length);
    for (let i = 0; i < lampEntries.length; i++) {
      const { entry: e, part: p } = lampEntries[i];
      quat.setFromEuler(euler.set(0, e.slot.angle, 0));
      sclV.set(e.scale, e.scale, e.scale);
      deviceMatrix.compose(posV.set(e.slot.x, e.y, e.slot.z), quat, sclV);
      partMatrix.compose(posV.set(p.pos[0], p.pos[1], p.pos[2]), quatIdentity, one);
      scratch.copy(deviceMatrix).multiply(partMatrix);
      lampInst.setMatrixAt(i, scratch);
      lampInst.setColorAt(i, e.glow);
      lampIndexByDevice.set(e.device.id, i);
      originalLampMatrices.set(e.device.id, scratch.clone());

      const bp = blinkParams(e.status);
      animated.push({
        instMesh: lampInst,
        instIndex: i,
        kind: 'blink',
        axis: 'y',
        speed: 0,
        amp: 0,
        phase: (p.anim?.phase ?? 0) + (e.slot.x + e.slot.z) * 0.05,
        active: animActive('blink', e.status),
        blink: { colour: e.glow.clone(), hz: bp.hz, floor: bp.floor },
        deviceId: e.device.id,
        originalStatus: e.status,
        originalBlinkColour: e.glow.clone(),
      });
    }
    lampInst.instanceMatrix.needsUpdate = true;
    if (lampInst.instanceColor) lampInst.instanceColor.needsUpdate = true;
    lampInst.frustumCulled = false;
    lampInst.name = 'equip:lamps';
    group.add(lampInst);
    lampMesh = lampInst;
    instancedMeshes++;
    drawables++;
    triangles += geoTriangles(lampGeo) * lampEntries.length;
  }

  // One overlay per device; parts remain in the original tint merge to preserve identity.
  // Per-vertex colour/alpha keeps different metrics independent without material groups/draw calls.
  const telemetryById = new Map(entries.map((e) => [e.device.id, finitePartTelemetry(e.device.telemetry)]));
  const evidenceById = new Map<string, DevicePartEvidence>();
  const evidenceOverlays = new Map<string, {
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    ranges: Array<{ key: string; start: number; count: number }>;
    breathing: boolean;
  }>();
  for (const e of entries) {
    const zones = PART_OBSERVATION_ZONES[e.recipe?.id ?? ''] ?? [];
    const chunks: THREE.BufferGeometry[] = [];
    const ranges: Array<{ key: string; start: number; count: number }> = [];
    let start = 0;
    for (const zone of zones) {
      const p = e.parts.find((part) => part.key === zone.partKey && !part.anim);
      if (!p) continue;
      const geo = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      quat.setFromEuler(euler.set(p.rot?.[0] ?? 0, p.rot?.[1] ?? 0, p.rot?.[2] ?? 0));
      partMatrix.compose(posV.set(...p.pos), quat, one);
      geo.applyMatrix4(partMatrix);
      ranges.push({ key: p.key, start, count: geo.attributes.position.count });
      start += geo.attributes.position.count;
      chunks.push(geo);
    }
    if (!chunks.length) continue;
    const geometry = mergeGeometries(chunks, false)!;
    for (const chunk of chunks) chunk.dispose();
    geometry.setAttribute('evidenceColor', new THREE.BufferAttribute(new Float32Array(start * 4), 4));
    geometry.setAttribute('evidenceBreath', new THREE.BufferAttribute(new Float32Array(start), 1));
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      uniforms: { time: { value: 0 } },
      vertexShader: `
        attribute vec4 evidenceColor;
        attribute float evidenceBreath;
        varying vec4 vEvidence;
        varying float vBreath;
        void main() {
          vEvidence = evidenceColor; vBreath = evidenceBreath;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float time;
        varying vec4 vEvidence;
        varying float vBreath;
        void main() {
          if (vEvidence.a == 0.0) discard;
          float pulse = mix(1.0, 0.68 + 0.22 * sin(time * 1.8), vBreath);
          gl_FragColor = vec4(vEvidence.rgb, vEvidence.a * pulse);
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `evidence:${e.device.id}`;
    mesh.userData.relation = 'observation-zone';
    mesh.renderOrder = 1;
    deviceGroupById.get(e.device.id)!.add(mesh);
    evidenceOverlays.set(e.device.id, { mesh, ranges, breathing: false });
    triangles += geoTriangles(geometry);
    drawables++;
  }
  const refreshEvidence = (e: Entry): void => {
    const evidence = getPartEvidence(e.recipe?.id ?? '', telemetryById.get(e.device.id), statusOverrides.get(e.device.id) ?? e.status);
    evidenceById.set(e.device.id, evidence);
    const overlay = evidenceOverlays.get(e.device.id);
    if (!overlay) return;
    const colours = overlay.mesh.geometry.getAttribute('evidenceColor') as THREE.BufferAttribute;
    const breath = overlay.mesh.geometry.getAttribute('evidenceBreath') as THREE.BufferAttribute;
    let visible = false;
    let breathing = false;
    for (const range of overlay.ranges) {
      const item = evidence.find((item) => item.partKey === range.key)!;
      // 缺测 / 健康不强调；warning 及以上（含保养）的观测部位持续脉冲提醒。
      const active = item.state === 'warning' || item.state === 'maintenance' || item.state === 'fault';
      const visiblePart = active || (item.state === 'healthy' && item.value !== null);
      const color = visiblePart ? new THREE.Color(PART_EVIDENCE_COLOURS[item.state as keyof typeof PART_EVIDENCE_COLOURS]) : new THREE.Color(0);
      visible ||= visiblePart;
      breathing ||= active;
      for (let i = range.start; i < range.start + range.count; i++) {
        colours.setXYZW(i, color.r, color.g, color.b, visiblePart ? 0.56 : 0);
        breath.setX(i, active ? 1 : 0);
      }
    }
    overlay.breathing = breathing;
    overlay.mesh.visible = visible;
    colours.needsUpdate = true;
    breath.needsUpdate = true;
  };
  for (const e of entries) refreshEvidence(e);
  const updateTelemetry = (deviceId: string, telemetry: PartTelemetry | null): void => {
    const e = entries.find((e) => e.device.id === deviceId);
    if (!e) return;
    telemetryById.set(deviceId, finitePartTelemetry(telemetry));
    refreshEvidence(e);
  };
  const setPartTelemetry: EquipmentBuild['setPartTelemetry'] = (id, metric, value) => {
    if (!telemetryById.has(id)) return;
    const field = metric === 'temp' ? 'temperature' : metric;
    updateTelemetry(id, { ...telemetryById.get(id), [field]: value });
  };

  // ---- 3. 铭牌（**全档位**展示，纯几何） ----
  // 验收要求「每台正面可见编号铭牌 / 总览下第一眼看到编号差异」，因此不按档位省略。
  // 铭牌不含字体/贴图：livery2 色板 + 白色七段数字，板色字色烘焙成顶点色合并进
  // 同一块几何体，所以仍是 16 个 mesh = 16 draw call（与改造前持平）。
  {
    for (const e of entries) {
      const code = e.device.code?.trim() || e.recipe?.code;
      if (!code) continue;
      const seq = plateSeq(code, e.device.id);
      if (!seq) continue;
      const geo = cachedPlateGeometry(seq, e.recipe?.livery2 ?? e.recipe?.livery ?? 0x94a3b8);
      const plate = new THREE.Mesh(geo, PLATE_MAT);
      const b = e.bounds;
      plate.position.set(e.slot.x, e.y + Math.min(b.h * 0.28, 1.6) * e.scale, e.slot.z);
      const dx = Math.sin(e.slot.angle);
      const dz = Math.cos(e.slot.angle);
      const off = (b.d * 0.5 + 0.1) * e.scale;
      plate.position.x += dx * off;
      plate.position.z += dz * off;
      plate.rotation.y = e.slot.angle;
      plate.name = `plate:${e.device.id}`;
      group.add(plate);
      nameplateById.set(e.device.id, plate);
      drawables++;
      triangles += geoTriangles(geo);
    }
  }

  // ---- 4. 状态光环（地面）+ 异常态光柱 ----
  if (highlight && entries.length > 0) {
    const haloInst = new THREE.InstancedMesh(ring(0.74, 1.0, 30), mats.halo, entries.length);
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const r = e.slot.radius * 1.35;
      scratch.compose(posV.set(e.slot.x, e.y + 0.07, e.slot.z), quatIdentity, sclV.set(r, 1, r));
      haloInst.setMatrixAt(i, scratch);
      haloInst.setColorAt(i, e.glow);
      haloIndexByDevice.set(e.device.id, i);
    }
    haloInst.instanceMatrix.needsUpdate = true;
    if (haloInst.instanceColor) haloInst.instanceColor.needsUpdate = true;
    haloInst.frustumCulled = false;
    haloInst.name = 'equip:halo';
    group.add(haloInst);
    haloMesh = haloInst;
    instancedMeshes++;
    drawables++;
    triangles += geoTriangles(ring(0.74, 1.0, 30)) * entries.length;

    const alerts = entries.filter((e) => STATUS_META[e.status].alert);
    if (alerts.length > 0) {
      const beam = cylY(0.1, 1, 8);
      const beaconInst = new THREE.InstancedMesh(beam, mats.halo, alerts.length);
      for (let i = 0; i < alerts.length; i++) {
        const e = alerts[i];
        const h = e.bounds.h * e.scale * 1.25 + 4;
        scratch.compose(posV.set(e.slot.x, e.y, e.slot.z), quatIdentity, sclV.set(1.6, h, 1.6));
        beaconInst.setMatrixAt(i, scratch);
        beaconInst.setColorAt(i, e.glow);
        beaconIndexByDevice.set(e.device.id, i);
      }
      beaconInst.instanceMatrix.needsUpdate = true;
      if (beaconInst.instanceColor) beaconInst.instanceColor.needsUpdate = true;
      beaconInst.frustumCulled = false;
      beaconInst.name = 'equip:beacon';
      group.add(beaconInst);
      beaconMesh = beaconInst;
      instancedMeshes++;
      drawables++;
      triangles += geoTriangles(beam) * alerts.length;
    }
  }

  // ---- 4b. 检修态工具 ----
  const overhauling = entries.filter((e) => e.status === 'overhauling');
  if (overhauling.length > 0) {
    const toolParts: Array<[THREE.BufferGeometry, TintRole, [number, number, number]]> = [
      [box(0.9, 0.5, 0.6), 'accent', [0, 0, 0]],
      [box(0.16, 0.16, 1.3), 'dark', [0, 0.62, 0]],
      [box(0.5, 0.5, 0.12), 'copper', [0.62, 0.3, 0.42]],
    ];
    for (const [geo, tint, off] of toolParts) {
      const mat = materialFor(mats, tint);
      const im = new THREE.InstancedMesh(geo, mat, overhauling.length);
      for (let i = 0; i < overhauling.length; i++) {
        const e = overhauling[i];
        const b = e.bounds;
        quat.setFromEuler(euler.set(0, e.slot.angle, 0));
        scratch.compose(
          posV.set(e.slot.x + off[0], e.y + off[1], e.slot.z + b.d * 0.5 + 0.9 + off[2]),
          quat,
          sclV.set(1, 1, 1)
        );
        im.setMatrixAt(i, scratch);
      }
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;
      im.castShadow = false;
      im.receiveShadow = shadows;
      im.name = `equip:overhaul-tool:${tint}`;
      group.add(im);
      instancedMeshes++;
      drawables++;
      triangles += geoTriangles(geo) * overhauling.length;
    }
  }

  // ---- 5. 拾取代理 ----
  const pickMat = new THREE.MeshBasicMaterial({ visible: false });
  mats.all.push(pickMat);
  const picks: THREE.Object3D[] = [];
  const indexById = new Map<string, number>();
  const boxById = new Map<string, DeviceBoxInfo>();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const b = e.bounds;
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(b.w * 1.1, b.h * 1.05, b.d * 1.1), pickMat);
    proxy.position.copy(e.center).multiplyScalar(e.scale)
      .applyAxisAngle(AXIS_VEC.y, e.slot.angle).add(new THREE.Vector3(e.slot.x, e.y, e.slot.z));
    proxy.rotation.y = e.slot.angle;
    proxy.scale.setScalar(e.scale);
    proxy.name = `pick:${e.device.id}`;
    proxy.userData.equipmentId = e.device.id;
    proxy.userData.slotIndex = i;
    proxy.userData.prototype = e.proto;
    proxy.userData.recipeId = e.recipe?.id ?? null;
    proxy.userData.status = e.status;
    group.add(proxy);
    picks.push(proxy);
    indexById.set(e.device.id, i);
    boxById.set(e.device.id, {
      index: i,
      x: e.slot.x,
      z: e.slot.z,
      y: e.y,
      w: b.w * e.scale,
      h: b.h * e.scale,
      d: b.d * e.scale,
      scale: e.scale,
      // Transformed actual geometry center (rotation around the slot angle + device scale).
      centerX: e.slot.x + (Math.cos(e.slot.angle) * e.center.x + Math.sin(e.slot.angle) * e.center.z) * e.scale,
      centerY: e.y + e.center.y * e.scale,
      centerZ: e.slot.z + (-Math.sin(e.slot.angle) * e.center.x + Math.cos(e.slot.angle) * e.center.z) * e.scale,
      status: e.status,
      recipeId: e.recipe?.id ?? null,
    });
    drawables++;
  }

  // ---- 6. 图例与计数 ----
  const legend: StatusLegendEntry[] = STATUS_ORDER.filter((k) => (statusCount.get(k) ?? 0) > 0).map((k) => ({
    key: k,
    label: STATUS_META[k].label,
    colour: STATUS_META[k].colour,
    count: statusCount.get(k) ?? 0,
  }));

  let alertCount = 0;
  let faultCount = 0;
  for (const [k, n] of statusCount) {
    if (STATUS_META[k].alert) alertCount += n;
    if (k === 'fault' || k === 'critical') faultCount += n;
  }

  /* ---- 7. 动画驱动器（逐帧零 GC、零矩阵乘法、极速驱动） ---- */
  const blinkColour = new THREE.Color();

  const animate = (time: number): void => {
    for (const [id, overlay] of evidenceOverlays) {
      if (overlay.breathing && overlay.mesh.visible && !hiddenDevices.has(id)) {
        overlay.mesh.material.uniforms.time.value = time;
      }
    }
    if (!animated.length && activeOverrides.size === 0) return;
    let lampUpdated = false;

    for (const a of animated) {
      const overrideStatus = statusOverrides.get(a.deviceId);
      let isActive: boolean;
      let blinkHz: number;
      let blinkFloor: number;
      let blinkBaseColour: THREE.Color | null;

      if (overrideStatus !== undefined) {
        isActive = animActive(a.kind, overrideStatus);
        const bp = a.kind === 'blink' ? blinkParams(overrideStatus) : { hz: 0, floor: 1 };
        blinkHz = bp.hz;
        blinkFloor = bp.floor;
        blinkBaseColour = a.kind === 'blink' ? glowColour(overrideStatus) : null;
      } else {
        isActive = a.active;
        blinkHz = a.blink?.hz ?? 0;
        blinkFloor = a.blink?.floor ?? 1;
        blinkBaseColour = a.blink?.colour ?? null;
      }

      if (!isActive) continue;
      const t = time + a.phase;

      if (a.kind === 'blink' && a.instMesh && typeof a.instIndex === 'number') {
        if (!blinkBaseColour) continue;
        const wave = 0.5 + 0.5 * Math.sin(t * blinkHz * Math.PI * 2);
        const k = blinkFloor + (1 - blinkFloor) * wave;
        blinkColour.copy(blinkBaseColour).multiplyScalar(k);
        a.instMesh.setColorAt(a.instIndex, blinkColour);
        lampUpdated = true;
        continue;
      }

      if (!a.mesh || !a.basePos || !a.baseRot) continue;

      if (a.kind === 'spin') {
        const ax = a.axis;
        if (ax === 'x') a.mesh.rotation.x = a.baseRot.x + t * a.speed;
        else if (ax === 'y') a.mesh.rotation.y = a.baseRot.y + t * a.speed;
        else a.mesh.rotation.z = a.baseRot.z + t * a.speed;
      } else if (a.kind === 'slide') {
        const off = Math.sin(t * a.speed * Math.PI * 2) * 0.62;
        const ax = a.axis;
        if (ax === 'x') a.mesh.position.x = a.basePos.x + off;
        else if (ax === 'y') a.mesh.position.y = a.basePos.y + off;
        else a.mesh.position.z = a.basePos.z + off;
      } else if (a.kind === 'shake') {
        a.mesh.position.x = a.basePos.x + Math.sin(t * a.speed) * a.amp;
        a.mesh.position.y = a.basePos.y + Math.sin(t * a.speed * 1.37 + 1.1) * a.amp * 0.7;
        a.mesh.position.z = a.basePos.z + Math.sin(t * a.speed * 0.83 + 2.2) * a.amp;
      }
    }

    if (lampUpdated && lampMesh && lampMesh.instanceColor) {
      lampMesh.instanceColor.needsUpdate = true;
    }

    // 状态覆盖：更新光环与光柱颜色
    if (activeOverrides.size > 0) {
      for (const devId of activeOverrides) {
        const overStatus = statusOverrides.get(devId);
        if (!overStatus) continue;
        const newGlow = glowColour(overStatus);

        const hIdx = haloIndexByDevice.get(devId);
        if (typeof hIdx === 'number' && haloMesh) {
          haloMesh.setColorAt(hIdx, newGlow);
          if (haloMesh.instanceColor) haloMesh.instanceColor.needsUpdate = true;
        }

        const bIdx = beaconIndexByDevice.get(devId);
        if (typeof bIdx === 'number' && beaconMesh) {
          if (STATUS_META[overStatus].alert) {
            beaconMesh.setColorAt(bIdx, newGlow);
          } else {
            beaconMesh.setColorAt(bIdx, newGlow.setScalar(0));
          }
          if (beaconMesh.instanceColor) beaconMesh.instanceColor.needsUpdate = true;
        }
      }
    }
  };

  /** 设置单台设备的状态覆盖（遥测回放联动入口）。传 null 清除覆盖。 */
  const setStatusOverride = (deviceId: string, status: StatusKey | null): void => {
    if (status === null) {
      if (statusOverrides.delete(deviceId)) {
        activeOverrides.delete(deviceId);
      }
      const entry = entries.find((e) => e.device.id === deviceId);
      if (entry) {
        const smat = statusMatByDevice.get(deviceId);
        if (smat) smat.color.copy(entry.colour);
      }
    } else {
      statusOverrides.set(deviceId, status);
      activeOverrides.add(deviceId);
      const smat = statusMatByDevice.get(deviceId);
      if (smat) smat.color.copy(bodyColour(status, preset));
    }
    const entry = entries.find((e) => e.device.id === deviceId);
    if (entry) refreshEvidence(entry);
  };

  /** 获取指定设备的所有零件信息（用于拆解视图） */
  const getDevicePartInfo = (deviceId: string): DevicePartInfo[] | null => {
    return devicePartsInfo.get(deviceId) ?? null;
  };

  /** 隐藏指定设备的实例（进入拆解视图时调用） */
  const hideDeviceInstances = (deviceId: string): void => {
    if (hiddenDevices.has(deviceId)) return;
    hiddenDevices.add(deviceId);

    const devGroup = deviceGroupById.get(deviceId);
    if (devGroup) devGroup.visible = false;

    const plate = nameplateById.get(deviceId);
    if (plate) plate.visible = false;

    const lampIdx = lampIndexByDevice.get(deviceId);
    if (typeof lampIdx === 'number' && lampMesh) {
      lampMesh.setMatrixAt(lampIdx, zeroMatrix);
      lampMesh.instanceMatrix.needsUpdate = true;
    }
  };

  /** 恢复指定设备的实例（退出拆解视图时调用） */
  const showDeviceInstances = (deviceId: string): void => {
    if (!hiddenDevices.has(deviceId)) return;
    hiddenDevices.delete(deviceId);

    const devGroup = deviceGroupById.get(deviceId);
    if (devGroup) devGroup.visible = true;

    const plate = nameplateById.get(deviceId);
    if (plate) plate.visible = true;

    const lampIdx = lampIndexByDevice.get(deviceId);
    if (typeof lampIdx === 'number' && lampMesh) {
      const origMat = originalLampMatrices.get(deviceId);
      if (origMat) {
        lampMesh.setMatrixAt(lampIdx, origMat);
        lampMesh.instanceMatrix.needsUpdate = true;
      }
    }
  };

  /**
   * 独占模式：只保留目标设备的地面光环与告警光柱，其余置零。
   *
   * 为什么不能靠 visible 开关：光环/光柱是**全场景合批**的 InstancedMesh
   * （16 台共用 1 个 draw call），单个实例没有独立的 visible，
   * 只能把它的矩阵缩成 0 来"隐藏"。
   */
  const setChromeFocus = (deviceId: string | null): void => {
    if (haloMesh) {
      for (const e of entries) {
        const idx = haloIndexByDevice.get(e.device.id);
        if (typeof idx !== 'number') continue;
        if (deviceId === null || e.device.id === deviceId) {
          const r = e.slot.radius * 1.35;
          scratch.compose(posV.set(e.slot.x, e.y + 0.07, e.slot.z), quatIdentity, sclV.set(r, 1, r));
          haloMesh.setMatrixAt(idx, scratch);
        } else {
          haloMesh.setMatrixAt(idx, zeroMatrix);
        }
      }
      haloMesh.instanceMatrix.needsUpdate = true;
    }
    if (beaconMesh) {
      for (const e of entries) {
        const idx = beaconIndexByDevice.get(e.device.id);
        if (typeof idx !== 'number') continue;
        // 独占（单设备详情）层连本机这台的光柱也一并收掉：
        // 用户规格明确"3D 场景上方不许有光柱/箭头"，退出独占时 deviceId 传 null 还原。
        if (deviceId === null) {
          const h = e.bounds.h * e.scale * 1.25 + 4;
          scratch.compose(posV.set(e.slot.x, e.y, e.slot.z), quatIdentity, sclV.set(1.6, h, 1.6));
          beaconMesh.setMatrixAt(idx, scratch);
        } else {
          beaconMesh.setMatrixAt(idx, zeroMatrix);
        }
      }
      beaconMesh.instanceMatrix.needsUpdate = true;
    }
  };

  /** 独占模式：只显示这一台（含铭牌 / 指示灯 / 光环），其余 15 台全部隐藏。 */
  const showOnlyDevice = (deviceId: string): void => {
    for (const e of entries) {
      if (e.device.id === deviceId) showDeviceInstances(e.device.id);
      else hideDeviceInstances(e.device.id);
    }
    setChromeFocus(deviceId);
  };

  /**
   * 显示/隐藏单台设备的文字铭牌。
   * 铭牌是贴在设备顶部的 canvas 文字牌 —— 设备详情层按"3D 不飘任何文字"口径隐藏，
   * 回到车间/总览层即还原。
   */
  const setNameplateVisible = (deviceId: string, visible: boolean): void => {
    const plate = nameplateById.get(deviceId);
    if (plate) plate.visible = visible;
  };

  /** 退出独占：恢复全部设备及其光环 / 光柱。 */
  const showAllDevices = (): void => {
    for (const e of entries) showDeviceInstances(e.device.id);
    setChromeFocus(null);
  };

  /**
   * 当前**可见**设备数（独占模式下为 1）。
   * 性能条据此如实反映"此刻真正在渲染几台"，而不是构建期登记了几台。
   */
  const visibleDeviceCount = (): number => {
    let n = 0;
    for (const e of entries) {
      if (deviceGroupById.get(e.device.id)?.visible !== false) n++;
    }
    return n;
  };

  /** 清除所有状态覆盖，恢复全部设备到原始台账状态。 */
  const clearStatusOverrides = (): void => {
    for (const a of animated) {
      if (activeOverrides.has(a.deviceId)) {
        a.active = animActive(a.kind, a.originalStatus);
        if (a.blink && a.originalBlinkColour) {
          a.blink.colour.copy(a.originalBlinkColour);
          const bp = blinkParams(a.originalStatus);
          a.blink.hz = bp.hz;
          a.blink.floor = bp.floor;
        }
      }
    }
    for (const devId of activeOverrides) {
      const entry = entries.find((e) => e.device.id === devId);
      if (entry) {
        const smat = statusMatByDevice.get(devId);
        if (smat) smat.color.copy(entry.colour);
        const origGlow = glowColour(entry.status);
        const hIdx = haloIndexByDevice.get(devId);
        if (typeof hIdx === 'number' && haloMesh) {
          haloMesh.setColorAt(hIdx, origGlow);
        }
        const bIdx = beaconIndexByDevice.get(devId);
        if (typeof bIdx === 'number' && beaconMesh) {
          if (STATUS_META[entry.status].alert) {
            beaconMesh.setColorAt(bIdx, origGlow);
          } else {
            beaconMesh.setColorAt(bIdx, origGlow.setScalar(0));
          }
        }
      }
    }
    if (activeOverrides.size > 0 && (haloMesh || beaconMesh)) {
      if (haloMesh && haloMesh.instanceColor) haloMesh.instanceColor.needsUpdate = true;
      if (beaconMesh && beaconMesh.instanceColor) beaconMesh.instanceColor.needsUpdate = true;
    }
    statusOverrides.clear();
    activeOverrides.clear();
    for (const entry of entries) refreshEvidence(entry);
  };

  /** 增量更新设备位置、朝向与高度（改密度/种子/布局时零几何重建，极速完成） */
  let currentEquipmentScale = equipmentScale;
  const updateTransforms = (
    newSlots: DeviceSlot[],
    reliefAt: (x: number, z: number) => number,
    eqScale?: number
  ): void => {
    const scaleMultiplier = eqScale !== undefined ? eqScale / (currentEquipmentScale || 1) : 1;
    if (eqScale !== undefined) currentEquipmentScale = eqScale;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const slot = newSlots[i];
      if (!slot) continue;
      e.slot = slot;
      e.y = reliefAt(slot.x, slot.z);
      e.scale *= scaleMultiplier;
      const effectiveScale = e.scale;

      const devGroup = deviceGroupById.get(e.device.id);
      if (devGroup) {
        devGroup.position.set(slot.x, e.y, slot.z);
        devGroup.rotation.y = slot.angle;
        devGroup.scale.setScalar(effectiveScale);
      }

      const center = e.center.clone().multiplyScalar(effectiveScale)
        .applyAxisAngle(AXIS_VEC.y, slot.angle).add(new THREE.Vector3(slot.x, e.y, slot.z));
      const pick = picks[i];
      if (pick) {
        pick.position.copy(center);
        pick.rotation.y = slot.angle;
        pick.scale.setScalar(effectiveScale);
      }

      const box = boxById.get(e.device.id);
      if (box) {
        box.x = slot.x;
        box.z = slot.z;
        box.y = e.y;
        box.scale = effectiveScale;
        box.w = e.bounds.w * effectiveScale;
        box.h = e.bounds.h * effectiveScale;
        box.d = e.bounds.d * effectiveScale;
        box.centerX = center.x;
        box.centerY = center.y;
        box.centerZ = center.z;
      }

      const plate = nameplateById.get(e.device.id);
      if (plate) {
        const b = e.bounds;
        plate.position.set(slot.x, e.y + Math.min(b.h * 0.28, 1.6) * effectiveScale, slot.z);
        const dx = Math.sin(slot.angle);
        const dz = Math.cos(slot.angle);
        const off = (b.d * 0.5 + 0.1) * effectiveScale;
        plate.position.x += dx * off;
        plate.position.z += dz * off;
        plate.rotation.y = slot.angle;
      }

      const lampIdx = lampIndexByDevice.get(e.device.id);
      if (typeof lampIdx === 'number' && lampMesh) {
        const lampEntry = lampEntries[lampIdx];
        if (lampEntry) {
          quat.setFromEuler(euler.set(0, slot.angle, 0));
          sclV.set(effectiveScale, effectiveScale, effectiveScale);
          deviceMatrix.compose(posV.set(slot.x, e.y, slot.z), quat, sclV);
          partMatrix.compose(posV.set(lampEntry.part.pos[0], lampEntry.part.pos[1], lampEntry.part.pos[2]), quatIdentity, one);
          scratch.copy(deviceMatrix).multiply(partMatrix);
          lampMesh.setMatrixAt(lampIdx, scratch);
          originalLampMatrices.set(e.device.id, scratch.clone());
        }
      }

      if (haloMesh) {
        const r = slot.radius * 1.35;
        scratch.compose(posV.set(slot.x, e.y + 0.07, slot.z), quatIdentity, sclV.set(r, 1, r));
        haloMesh.setMatrixAt(i, scratch);
      }
    }

    if (lampMesh) lampMesh.instanceMatrix.needsUpdate = true;
    if (haloMesh) haloMesh.instanceMatrix.needsUpdate = true;

    if (beaconMesh) {
      const alerts = entries.filter((e) => STATUS_META[e.status].alert);
      for (let i = 0; i < alerts.length; i++) {
        const e = alerts[i];
        const effectiveScale = e.scale;
        const h = e.bounds.h * effectiveScale * 1.25 + 4;
        scratch.compose(posV.set(e.slot.x, e.y, e.slot.z), quatIdentity, sclV.set(1.6, h, 1.6));
        beaconMesh.setMatrixAt(i, scratch);
      }
      beaconMesh.instanceMatrix.needsUpdate = true;
    }

    // 同步拆解视图矩阵
    for (const e of entries) {
      const effectiveScale = e.scale;
      quat.setFromEuler(euler.set(0, e.slot.angle, 0));
      sclV.set(effectiveScale, effectiveScale, effectiveScale);
      deviceMatrix.compose(posV.set(e.slot.x, e.y, e.slot.z), quat, sclV);
      const pList = devicePartsInfo.get(e.device.id);
      if (pList) {
        for (let j = 0; j < pList.length && j < e.parts.length; j++) {
          const part = e.parts[j];
          quat.setFromEuler(euler.set(part.rot?.[0] ?? 0, part.rot?.[1] ?? 0, part.rot?.[2] ?? 0));
          partMatrix.compose(posV.set(part.pos[0], part.pos[1], part.pos[2]), quat, one);
          pList[j].matrix.copy(deviceMatrix).multiply(partMatrix);
        }
      }
    }
  };

  /** 场景预设切换时极速更新材质调色板（零几何重建） */
  const updatePresetPalette = (newPreset: ScenePreset): void => {
    mats.steel.color.set(newPreset.palette.steel);
    mats.accent.color.set(newPreset.palette.accent);
    for (const e of entries) {
      e.colour = bodyColour(e.status, newPreset);
      const smat = statusMatByDevice.get(e.device.id);
      if (smat) smat.color.copy(e.colour);
    }
  };

  return {
    group,
    picks,
    indexById,
    boxById,
    triangles,
    instancedMeshes,
    drawables,
    byStatus,
    byPrototype,
    legend,
    alertCount,
    faultCount,
    animatedCount: animated.filter((a) => a.active).length,
    animate,
    setStatusOverride,
    clearStatusOverrides,
    activeOverrides,
    getDevicePartInfo,
    hideDeviceInstances,
    showDeviceInstances,
    showOnlyDevice,
    showAllDevices,
    setNameplateVisible,
    visibleDeviceCount,
    updateTransforms,
    updatePresetPalette,
    getPartEvidence: (id) => evidenceById.get(id) ?? null,
    updateTelemetry,
    setPartTelemetry,
    get partEvidenceMeshCount() { return evidenceOverlays.size; },
  };
}

/** 三角面计数：索引几何取 index.count，非索引取顶点数，再除以 3。 */
export { geoTriangles };

/** 单台设备的取景信息（特写视角用；无配方时回退到原型包围盒）。 */
export function deviceBoundsFor(
  proto: PrototypeKey,
  scale: number
): { radius: number; height: number } {
  const b = PROTOTYPE_BOUNDS[proto];
  const radius = Math.max(b.w, b.d) * scale * 0.5;
  return { radius: clamp(radius, 2, 40), height: b.h * scale };
}

/** 供测试与诊断：当前配方覆盖的设备 id 列表。 */
export { RECIPE_IDS } from './deviceProfiles';
