import * as THREE from 'three'
import type { EquipmentBuild } from './equipment'
import type { ScenePreset } from './styles'

type Palette = ScenePreset['palette']

export interface ExplodedPartData {
  key: string
  label: string
  targetPos: THREE.Vector3
  originalMatrix: THREE.Matrix4
  mesh: THREE.Mesh | null
  labelOffset: THREE.Vector3
  description: string
}

export interface ExplodedViewConfig {
  deviceId: string
  label: string
  buildOrder: string[]
  unfoldAxis: 'y' | 'x' | 'z'
  baseOffset: number
  staggerDelay: number
}

const EXPLODED_CONFIGS: Record<string, ExplodedViewConfig> = {
  'eq-103': {
    deviceId: 'eq-103',
    label: '3# 行星齿轮减速机',
    buildOrder: [
      'shell', 'topCap', 'inputShaft', 'sunGear', 'planetCarrier',
      'planetGears', 'ringGear', 'outputShaft', 'bearings', 'seals',
      'lubrication', 'basePlate', 'mountingBolts', 'coolingFins',
      'lubricationPipes', 'oilLevelSight', 'drainPlug', 'inspectionCover',
      'nameplate', 'vibrationSensor', 'temperatureSensor', 'oilFilter',
      'breatherCap', 'couplingGuard', 'flexibleCoupling'
    ],
    unfoldAxis: 'y',
    baseOffset: 0.6,
    staggerDelay: 80
  },
  'eq-105': {
    deviceId: 'eq-105',
    label: '5# 多级离心泵',
    buildOrder: [
      'lowerCasing', 'upperCasing', 'flanges', 'coupling', 'mainShaft',
      'mechanicalSeal', 'bearingHousing', 'impellerStage1', 'diffuserStage1',
      'impellerStage2', 'diffuserStage2', 'impellerStage3', 'diffuserStage3',
      'impellerStage4', 'diffuserStage4', 'impellerStage5', 'diffuserStage5',
      'impellerStage6', 'diffuserStage6', 'impellerStage7', 'diffuserStage7',
      'impellerStage8', 'diffuserStage8', 'dischargeHead', 'suctionNozzle',
      'baseplate', 'anchorBolts', 'shaftSeal', 'thrustBearing',
      'radialBearing', 'oilReservoir', 'coolingJacket', 'pressureGauge',
      'flowMeter', 'drainValve', 'ventingValve', 'alignmentShims',
      'couplingGuard', 'motorMount', 'flexibleElement', 'alignmentPins'
    ],
    unfoldAxis: 'y',
    baseOffset: 0.45,
    staggerDelay: 50
  },
  'eq-110': {
    deviceId: 'eq-110',
    label: '15# 六轴工业机械臂',
    buildOrder: [
      'robotBasePlate', 'anchorBolts', 'robotBaseFrame', 'waistSleeve',
      'j1ServoMotor', 'j1Reducer', 'j1Encoder',
      'lowerArmCasting', 'j2ServoMotor', 'j2Reducer', 'j2Encoder',
      'elbowJoint', 'j3ServoMotor', 'j3Reducer', 'j3Encoder',
      'upperArmCasting', 'cableHarness',
      'wristRollHousing', 'j4ServoMotor', 'j4Encoder',
      'wristPitchHousing', 'j5ServoMotor', 'j5Encoder',
      'wristYawFlange', 'j6ServoMotor', 'j6Encoder',
      'endEffector', 'gripperFingers', 'toolFlange',
      'controllerCabinet', 'teachPendant', 'safetyRelay'
    ],
    unfoldAxis: 'z',
    baseOffset: 0.35,
    staggerDelay: 45
  }
}

export function isExplodedViewSupported(deviceId: string): boolean {
  return deviceId in EXPLODED_CONFIGS
}

export function getExplodedConfig(deviceId: string): ExplodedViewConfig | undefined {
  return EXPLODED_CONFIGS[deviceId]
}

export function computeExplodedLayout(
  config: ExplodedViewConfig,
  build: EquipmentBuild,
  palette: Palette
): ExplodedPartData[] {
  const partInfo = build.getDevicePartInfo(config.deviceId)
  if (!partInfo) return []

  const layout: ExplodedPartData[] = []
  const seen = new Set<string>()

  for (const key of config.buildOrder) {
    const info = partInfo.find(p => p.key === key)
    if (!info) continue
    seen.add(key)

    const originalPos = new THREE.Vector3()
    originalPos.setFromMatrixPosition(info.matrix)

    const orderIndex = config.buildOrder.indexOf(key)
    const targetOffset = orderIndex * config.baseOffset
    const targetPos = originalPos.clone()

    if (config.unfoldAxis === 'y') {
      targetPos.y += targetOffset
    } else if (config.unfoldAxis === 'x') {
      targetPos.x += targetOffset
    } else {
      targetPos.z += targetOffset
    }

    const labelOffset = new THREE.Vector3(0, 0.15, 0)

    layout.push({
      key,
      label: formatPartLabel(key),
      targetPos,
      originalMatrix: info.matrix.clone(),
      mesh: null,
      labelOffset,
      description: getPartDescription(key, config.deviceId)
    })
  }

  for (const info of partInfo) {
    if (!seen.has(info.key)) {
      seen.add(info.key)
      const originalPos = new THREE.Vector3()
      originalPos.setFromMatrixPosition(info.matrix)
      const orderIndex = layout.length
      const targetOffset = orderIndex * config.baseOffset
      const targetPos = originalPos.clone()
      if (config.unfoldAxis === 'y') targetPos.y += targetOffset
      else if (config.unfoldAxis === 'x') targetPos.x += targetOffset
      else targetPos.z += targetOffset

      layout.push({
        key: info.key,
        label: formatPartLabel(info.key),
        targetPos,
        originalMatrix: info.matrix.clone(),
        mesh: null,
        labelOffset: new THREE.Vector3(0, 0.15, 0),
        description: getPartDescription(info.key, config.deviceId)
      })
    }
  }

  return layout
}

export function createExplodedMeshes(
  layout: ExplodedPartData[],
  partInfo: Array<{ key: string; geo: THREE.BufferGeometry; tint: string }>,
  palette: Palette,
  scene: THREE.Scene
): ExplodedPartData[] {
  const group = new THREE.Group()
  group.name = 'explodedView'
  scene.add(group)

  for (const part of layout) {
    const info = partInfo.find(p => p.key === part.key)
    if (!info) continue

    const paletteValue = palette[info.tint as keyof Palette]
    const color = typeof paletteValue === 'number' ? paletteValue : 0xcccccc
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.4,
      metalness: 0.6
    })

    const mesh = new THREE.Mesh(info.geo, mat)
    mesh.name = `exploded_${part.key}`
    mesh.position.setFromMatrixPosition(part.originalMatrix)
    mesh.quaternion.setFromRotationMatrix(part.originalMatrix)
    mesh.scale.setFromMatrixScale(part.originalMatrix)
    mesh.userData.origWorldPos = mesh.position.clone()

    group.add(mesh)
    part.mesh = mesh
  }

  return layout
}

export function animateExplodedUnfold(
  layout: ExplodedPartData[],
  config: ExplodedViewConfig,
  onComplete?: () => void
): () => void {
  let cancelled = false
  const startTime = performance.now()
  const totalDuration = layout.length * config.staggerDelay + 400

  function tick() {
    if (cancelled) return

    const elapsed = performance.now() - startTime
    const progress = Math.min(elapsed / totalDuration, 1)

    for (let i = 0; i < layout.length; i++) {
      const part = layout[i]
      const partStart = i * config.staggerDelay
      const partProgress = Math.max(0, Math.min((elapsed - partStart) / 400, 1))
      const eased = 1 - Math.pow(1 - partProgress, 3)

      if (part.mesh) {
        const original = new THREE.Vector3()
        original.setFromMatrixPosition(part.originalMatrix)

        part.mesh.position.lerpVectors(original, part.targetPos, eased)
      }
    }

    if (progress < 1) {
      requestAnimationFrame(tick)
    } else {
      onComplete?.()
    }
  }

  requestAnimationFrame(tick)

  return () => { cancelled = true }
}

export function animateExplodedFold(
  layout: ExplodedPartData[],
  config: ExplodedViewConfig,
  onComplete?: () => void
): () => void {
  let cancelled = false
  const startTime = performance.now()
  const totalDuration = layout.length * config.staggerDelay * 0.6 + 300

  function tick() {
    if (cancelled) return

    const elapsed = performance.now() - startTime

    for (let i = 0; i < layout.length; i++) {
      const part = layout[i]
      const reverseIndex = layout.length - 1 - i
      const partStart = reverseIndex * config.staggerDelay * 0.6
      const partProgress = Math.max(0, Math.min((elapsed - partStart) / 300, 1))
      const eased = 1 - Math.pow(1 - partProgress, 3)

      if (part.mesh) {
        const original = new THREE.Vector3()
        original.setFromMatrixPosition(part.originalMatrix)

        part.mesh.position.lerpVectors(part.targetPos, original, eased)
      }
    }

    if (elapsed < totalDuration) {
      requestAnimationFrame(tick)
    } else {
      onComplete?.()
    }
  }

  requestAnimationFrame(tick)

  return () => { cancelled = true }
}

export function removeExplodedMeshes(scene: THREE.Scene): void {
  const group = scene.getObjectByName('explodedView')
  if (group) {
    group.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose()
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose())
        } else {
          child.material?.dispose()
        }
      }
    })
    scene.remove(group)
  }
}

function formatPartLabel(key: string): string {
  const labelMap: Record<string, string> = {
    shell: '外壳', topCap: '顶盖', inputShaft: '输入轴', sunGear: '太阳轮',
    planetCarrier: '行星架', planetGears: '行星轮', ringGear: '齿圈',
    outputShaft: '输出轴', bearings: '轴承组', seals: '密封件',
    lubrication: '润滑系统', basePlate: '底座', mountingBolts: '安装螺栓',
    coolingFins: '散热片', lubricationPipes: '润滑油管', oilLevelSight: '油位视镜',
    drainPlug: '放油塞', inspectionCover: '检修盖', nameplate: '铭牌',
    vibrationSensor: '振动传感器', temperatureSensor: '温度传感器',
    oilFilter: '滤油器', breatherCap: '呼吸器', couplingGuard: '联轴器护罩',
    flexibleCoupling: '弹性联轴器',
    lowerCasing: '下泵体', upperCasing: '上泵体', flanges: '法兰盘',
    coupling: '联轴器', mainShaft: '主轴', mechanicalSeal: '机械密封',
    bearingHousing: '轴承座', impellerStage1: '叶轮-1级', diffuserStage1: '导叶-1级',
    impellerStage2: '叶轮-2级', diffuserStage2: '导叶-2级',
    impellerStage3: '叶轮-3级', diffuserStage3: '导叶-3级',
    impellerStage4: '叶轮-4级', diffuserStage4: '导叶-4级',
    impellerStage5: '叶轮-5级', diffuserStage5: '导叶-5级',
    impellerStage6: '叶轮-6级', diffuserStage6: '导叶-6级',
    impellerStage7: '叶轮-7级', diffuserStage7: '导叶-7级',
    impellerStage8: '叶轮-8级', diffuserStage8: '导叶-8级',
    dischargeHead: '排出端', suctionNozzle: '吸入管',
    baseplate: '底板', anchorBolts: '地脚螺栓', shaftSeal: '轴封',
    thrustBearing: '止推轴承', radialBearing: '径向轴承',
    oilReservoir: '油箱', coolingJacket: '冷却夹套', pressureGauge: '压力表',
    flowMeter: '流量计', drainValve: '排水阀', ventingValve: '排气阀',
    alignmentShims: '对中垫片', motorMount: '电机座', flexibleElement: '弹性元件',
    alignmentPins: '定位销',
    // 六轴工业机械臂零件
    robotBasePlate: '安装底板', robotBaseFrame: '基座框架', waistSleeve: '腰座套筒',
    j1ServoMotor: 'J1轴伺服电机', j1Reducer: 'J1轴RV减速器', j1Encoder: 'J1轴编码器',
    lowerArmCasting: '大臂铸件', j2ServoMotor: 'J2轴伺服电机', j2Reducer: 'J2轴RV减速器', j2Encoder: 'J2轴编码器',
    elbowJoint: '肘关节', j3ServoMotor: 'J3轴伺服电机', j3Reducer: 'J3轴RV减速器', j3Encoder: 'J3轴编码器',
    upperArmCasting: '小臂铸件', cableHarness: '内部线束',
    wristRollHousing: '腕部旋转座', j4ServoMotor: 'J4轴伺服电机', j4Encoder: 'J4轴编码器',
    wristPitchHousing: '腕部俯仰座', j5ServoMotor: 'J5轴伺服电机', j5Encoder: 'J5轴编码器',
    wristYawFlange: '腕部法兰', j6ServoMotor: 'J6轴伺服电机', j6Encoder: 'J6轴编码器',
    endEffector: '末端执行器', gripperFingers: '夹爪手指', toolFlange: '工具法兰',
    controllerCabinet: '控制柜', teachPendant: '示教器', safetyRelay: '安全继电器'
  }
  return labelMap[key] ?? key
}

function getPartDescription(key: string, deviceId: string): string {
  const descriptions: Record<string, string> = {
    shell: '减速机主体外壳，铸铁材质，承受内部齿轮啮合力',
    topCap: '顶盖密封，防止润滑油泄漏',
    inputShaft: '高速输入轴，连接电机，转速约1480rpm',
    sunGear: '太阳轮，20齿，渗碳淬火处理',
    planetCarrier: '行星架，承载3个行星轮',
    planetGears: '行星轮组，3个均匀分布，18齿',
    ringGear: '内齿圈，56齿，与壳体固定',
    outputShaft: '低速输出轴，转速约296rpm',
    bearings: '主轴承组， SKF 32220 J2',
    seals: '双唇口油封，防止润滑油泄漏',
    lubrication: '强制润滑系统，油压0.2-0.4MPa',
    basePlate: '安装底座，4个M20地脚螺栓',
    coolingFins: '散热翅片，增大散热面积',
    lowerCasing: '泵体下半部，水平剖分面',
    upperCasing: '泵体上半部，水平剖分面',
    mainShaft: '泵主轴，40Cr材质，调质处理',
    mechanicalSeal: '集装式机械密封，型号YZB-80',
    impellerStage1: '一级叶轮，闭式，铸钢材质',
    diffuserStage1: '一级导叶，将动能转化为压力能',
    baseplate: '公共底座，铸铁材质',
    anchorBolts: '地脚螺栓，M24×400，8.8级',
    // 六轴机械臂关键零件描述
    robotBasePlate: '机械臂安装底板，厚度20mm钢板，4颗M16地脚螺栓固定',
    robotBaseFrame: '基座框架，铸铝件，承受整机倾覆力矩',
    waistSleeve: '腰座套筒，连接基座与大臂，内置J1轴旋转轴承',
    j1ServoMotor: 'J1轴绝对式伺服电机，额定功率1.8kW，带抱闸',
    j1Reducer: 'J1轴RV减速器，减速比1:121，背隙<1弧分',
    j1Encoder: 'J1轴光电编码器，分辨率17位，反馈关节角度',
    lowerArmCasting: '大臂铸件，高强度铝合金，中空走管线',
    j2ServoMotor: 'J2轴伺服电机，额定功率2.2kW，带绝对编码器',
    j2Reducer: 'J2轴RV减速器，减速比1:161',
    elbowJoint: '肘关节连接结构，铸钢件，承受小臂全部载荷',
    upperArmCasting: '小臂铸件，铝合金轻量化设计，末端负载10kg',
    cableHarness: '内部线束组，包含动力线、编码器线、气动管，沿臂内侧走线',
    wristRollHousing: '腕部旋转座，J4轴回转轴，内置交叉滚子轴承',
    wristPitchHousing: '腕部俯仰座，J5轴，垂直方向摆动',
    wristYawFlange: '腕部末端法兰，J6轴，绕工具中心线旋转',
    endEffector: '末端执行器，两指气动夹爪，夹持力可调',
    gripperFingers: '夹爪手指，聚氨酯包覆，防夹伤工件',
    controllerCabinet: '机器人控制柜，含运动控制器、伺服驱动器、I/O模块',
    teachPendant: '示教器，10英寸触摸屏，用于手动编程与参数设置',
    safetyRelay: '安全继电器，双手启动+安全门联锁，急停回路冗余设计'
  }
  return descriptions[key] ?? '设备部件'
}

export function getExplodedViewLabel(deviceId: string): string {
  return EXPLODED_CONFIGS[deviceId]?.label ?? '设备拆解图'
}

export { EXPLODED_CONFIGS }
