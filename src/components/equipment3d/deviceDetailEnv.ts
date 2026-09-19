/**
 * 设备详情（单台聚焦）工业环境层 —— 「场景密度优先」。
 *
 * 只在 device 层挂载、退出聚焦即整体卸载（与 focusDecor 同生命周期）。
 * 本模块是纯物理环境：地面 / 立柱 / 屋架 / 管道 / 检修物料 / 工人 / 灯光，
 * **一律不产生任何文字、编号、箭头、引线** —— 数据全部由右侧 DOM 面板承担。
 *
 * 口径约束：
 *   - 全部尺寸由传入的设备包围盒（box）推导，不写死某台设备；
 *   - 不移动 / 不替换既有设备模型（盖板是叠加的独立网格）；
 *   - 相机与轨道手感零改动（本模块不触碰 orbit / camera）。
 */

import * as THREE from 'three';

export interface DeviceDetailEnvBox {
  x: number;
  z: number;
  y: number;
  w: number;
  h: number;
  d: number;
}

export interface DeviceDetailEnvOptions {
  box: DeviceDetailEnvBox;
  rotationY: number;
  /** 画质档位：low 时跳过阴影投射灯与部分小件 */
  lowFx: boolean;
}

const FLOOR_COLOUR = 0x1a2332;
const FOG_COLOUR = 0x0d1420;
const STEEL_DARK = 0x4a5765;
const PIPE_COLOUR = 0x5a7a9a;
const WORKER_BLUE = 0x3b82f6;
const DAYLIGHT_COLOUR = 0xbcd8f2;
/** 每根环境管道内的流体粒子数（示意用，单 Points 一次 draw call）。 */
const FLOW_DOTS_PER_RUN = 8;

/** 45° 黄黑警戒纹贴图（程序化 Canvas，无外部资源）。 */
function makeHazardTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#e2b100';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#151b26';
  ctx.save();
  ctx.translate(64, 64);
  ctx.rotate(Math.PI / 4);
  for (let i = -3; i <= 3; i++) {
    ctx.fillRect(i * 44 - 11, -140, 22, 280);
  }
  ctx.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export class DeviceDetailEnv {
  readonly group = new THREE.Group();
  private owned: Array<{ dispose(): void }> = [];
  private workLight: THREE.PointLight | null = null;
  private lampHeadMat: THREE.MeshStandardMaterial | null = null;
  private spot: THREE.SpotLight | null = null;
  /** 工人动画引用：呼吸（躯干）/ 头部转动 / 脚下光圈脉冲 */
  private workerAnims: Array<{
    torso: THREE.Mesh;
    head: THREE.Group;
    baseY: number;
    phase: number;
    footRing: THREE.Mesh;
    footMat: THREE.MeshBasicMaterial;
  }> = [];
  private sideLight: THREE.DirectionalLight | null = null;
  /** 两个工人的"待机"部件：躯干做呼吸起伏、头部左右环视。 */
  private readonly workerParts: Array<{ torso: THREE.Mesh; heads: THREE.Object3D[]; phase: number }> = [];
  /** 管内流体粒子（示意：沿管道轴向自左向右推进，不代表实测流量）。 */
  private flow: {
    points: THREE.Points;
    geo: THREE.BufferGeometry;
    mat: THREE.PointsMaterial;
    pos: Float32Array;
    x0: Float32Array;
    x1: Float32Array;
    y: Float32Array;
    prog: Float32Array;
  } | null = null;

  constructor(opts: DeviceDetailEnvOptions) {
    const { box, rotationY, lowFx } = opts;
    const cx = box.x;
    const cz = box.z;
    const halfW = box.w / 2;
    const halfD = box.d / 2;
    const baseY = box.y;

    this.group.name = 'deviceDetailEnv';

    /* ---------- 1. 深灰环氧地坪 + 地砖缝 + 警戒线 ---------- */
    const floorSize = Math.max(22, (box.w + box.d) * 2.2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: FLOOR_COLOUR,
      roughness: 0.85,
      metalness: 0.15,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorSize, floorSize), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, baseY + 0.012, cz);
    floor.receiveShadow = true;
    this.group.add(floor);
    this.owned.push(floorMat, floor.geometry);

    // 地砖缝：细网格线（比地面略高，避免 z-fight）
    const seamMat = new THREE.LineBasicMaterial({ color: 0x26344a, transparent: true, opacity: 0.7 });
    const seamPts: THREE.Vector3[] = [];
    const cell = 2.4;
    for (let i = -Math.ceil(floorSize / cell / 2); i <= Math.ceil(floorSize / cell / 2); i++) {
      seamPts.push(new THREE.Vector3(i * cell, 0, -floorSize / 2), new THREE.Vector3(i * cell, 0, floorSize / 2));
      seamPts.push(new THREE.Vector3(-floorSize / 2, 0, i * cell), new THREE.Vector3(floorSize / 2, 0, i * cell));
    }
    const seamGeo = new THREE.BufferGeometry().setFromPoints(seamPts.map((p) => p.clone()));
    const seams = new THREE.LineSegments(seamGeo, seamMat);
    seams.position.set(cx, baseY + 0.02, cz);
    this.group.add(seams);
    this.owned.push(seamGeo, seamMat);

    // 45° 斜纹警戒线围在设备周围（四条边框条带）
    const hazard = makeHazardTexture();
    if (hazard) {
      const bandW = 0.55;
      const pad = Math.max(halfW, halfD) + 1.35;
      const span = pad * 2 + bandW;
      hazard.repeat.set(span / 1.4, bandW / 1.4);
      const bandMat = new THREE.MeshStandardMaterial({
        map: hazard,
        roughness: 0.8,
        metalness: 0.05,
        transparent: true,
        opacity: 0.92,
      });
      const bandGeo = new THREE.PlaneGeometry(span, bandW);
      this.owned.push(bandMat, bandGeo, hazard);
      const bands: Array<[number, number, number]> = [
        [0, -pad, 0],
        [0, pad, 0],
        [-pad, 0, Math.PI / 2],
        [pad, 0, Math.PI / 2],
      ];
      for (const [bx, bz, rot] of bands) {
        const band = new THREE.Mesh(bandGeo, bandMat);
        band.rotation.x = -Math.PI / 2;
        band.rotation.z = rot;
        band.position.set(cx + bx, baseY + 0.024, cz + bz);
        this.group.add(band);
      }
    }

    /* ---------- 2. 混凝土基座 ---------- */
    const pedH = Math.min(0.22, box.h * 0.08 + 0.1);
    const pedMat = new THREE.MeshStandardMaterial({ color: 0x2b3542, roughness: 0.95, metalness: 0.02 });
    const pedGeo = new THREE.BoxGeometry(box.w + 0.9, pedH, box.d + 0.9);
    const pedestal = new THREE.Mesh(pedGeo, pedMat);
    pedestal.position.set(cx, baseY + pedH / 2 - 0.01, cz);
    pedestal.receiveShadow = true;
    this.group.add(pedestal);
    this.owned.push(pedMat, pedGeo);

    /* ---------- 3. 钢结构立柱（工字钢）×4 + 屋架 / 管道桥 ---------- */
    const colH = box.h + 9;
    const colPositions: Array<[number, number]> = [
      [-(halfW + 2.6), -(halfD + 2.6)],
      [halfW + 2.6, -(halfD + 2.6)],
      [-(halfW + 2.6), halfD + 2.6],
      [halfW + 2.6, halfD + 2.6],
    ];
    const steelMat = new THREE.MeshStandardMaterial({ color: STEEL_DARK, roughness: 0.6, metalness: 0.55 });
    const columnGroup = new THREE.Group();
    columnGroup.position.set(cx, 0, cz);
    columnGroup.rotation.y = rotationY;
    for (const [lx, lz] of colPositions) {
      columnGroup.add(makeIBeam(lx, lz, colH, steelMat));
    }
    this.group.add(columnGroup);
    this.owned.push(steelMat);

    // 屋架剪影：两根纵向桁架梁 + 斜腹杆 + 管道桥（画面上方，隐约可见）
    const roofY = baseY + box.h + 6.4;
    const roofSpan = Math.max(halfW, halfD) * 2 + 7;
    const roofGroup = new THREE.Group();
    roofGroup.position.set(cx, roofY, cz);
    roofGroup.rotation.y = rotationY;
    const trussMat = new THREE.MeshStandardMaterial({ color: 0x232c38, roughness: 0.7, metalness: 0.5 });
    for (const side of [-1, 1]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(roofSpan, 0.32, 0.32), trussMat);
      beam.position.set(0, 0, side * (halfD + 2.6));
      roofGroup.add(beam);
      // 竖杆 + 斜腹杆（剪影层次）
      const count = 7;
      for (let i = 0; i <= count; i++) {
        const x = -roofSpan / 2 + (roofSpan * i) / count;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 0.14), trussMat);
        post.position.set(x, -0.55, side * (halfD + 2.6));
        roofGroup.add(post);
      }
    }
    // 管道桥：三根长管横穿画面上方
    const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x516d87, roughness: 0.5, metalness: 0.55 });
    for (const [dy, r] of [[0.7, 0.2], [1.15, 0.15], [1.5, 0.11]] as const) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, roofSpan, 10), bridgeMat);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(0, dy, 0);
      roofGroup.add(pipe);
    }
    this.group.add(roofGroup);
    this.owned.push(trussMat, bridgeMat);

    /* ---------- 4. 管道连接（左右各 2-3 根，带球阀 / 法兰） ---------- */
    const pipeGroup = new THREE.Group();
    pipeGroup.position.set(cx, 0, cz);
    pipeGroup.rotation.y = rotationY;
    const pipeMat = new THREE.MeshStandardMaterial({ color: PIPE_COLOUR, roughness: 0.45, metalness: 0.6 });
    const flangeMat = new THREE.MeshStandardMaterial({ color: 0x6b7f92, roughness: 0.4, metalness: 0.7 });
    const valveMat = new THREE.MeshStandardMaterial({ color: 0x8a2f2f, roughness: 0.5, metalness: 0.4 });
    const reach = Math.max(9, floorSize / 2 - 1);
    const runs: Array<{ side: -1 | 1; y: number; r: number }> = [
      { side: -1, y: baseY + box.h * 0.62, r: 0.17 },
      { side: -1, y: baseY + box.h * 0.4, r: 0.12 },
      { side: 1, y: baseY + box.h * 0.66, r: 0.19 },
      { side: 1, y: baseY + box.h * 0.44, r: 0.13 },
    ];
    for (const run of runs) {
      const len = reach;
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(run.r, run.r, len, 12), pipeMat);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(run.side * (halfW + len / 2 - 0.2), run.y, 0);
      pipe.castShadow = !lowFx;
      pipeGroup.add(pipe);
      // 法兰盘：设备接口处 + 中段
      for (const fx of [halfW + 0.25, halfW + len * 0.55]) {
        const flange = new THREE.Mesh(new THREE.CylinderGeometry(run.r + 0.08, run.r + 0.08, 0.08, 14), flangeMat);
        flange.rotation.z = Math.PI / 2;
        flange.position.set(run.side * fx, run.y, 0);
        pipeGroup.add(flange);
      }
      // 球阀：小圆柱阀体 + 把手
      const vx = run.side * (halfW + len * 0.35);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(run.r + 0.1, run.r + 0.1, 0.42, 12), valveMat);
      body.rotation.z = Math.PI / 2;
      body.position.set(vx, run.y, 0);
      pipeGroup.add(body);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.14), valveMat);
      handle.position.set(vx, run.y + run.r + 0.24, 0);
      pipeGroup.add(handle);
      // 立管落地（延伸向下），不让管线悬空
      const drop = new THREE.Mesh(new THREE.CylinderGeometry(run.r, run.r, run.y - baseY, 10), pipeMat);
      drop.position.set(run.side * (halfW + len - 0.2), baseY + (run.y - baseY) / 2, 0);
      pipeGroup.add(drop);
    }

    // 管内流体：每根管道 8 颗青色光点沿轴向自左向右推进（单 Points，一次 draw call）
    const dotCount = runs.length * FLOW_DOTS_PER_RUN;
    const pos = new Float32Array(dotCount * 3);
    const x0 = new Float32Array(dotCount);
    const x1 = new Float32Array(dotCount);
    const py = new Float32Array(dotCount);
    const prog = new Float32Array(dotCount);
    let di = 0;
    for (const run of runs) {
      const a = run.side < 0 ? -(halfW + reach - 0.4) : halfW + 0.4;
      const b = run.side < 0 ? -(halfW + 0.4) : halfW + reach - 0.4;
      for (let k = 0; k < FLOW_DOTS_PER_RUN; k++, di++) {
        x0[di] = a;
        x1[di] = b;
        py[di] = run.y;
        prog[di] = k / FLOW_DOTS_PER_RUN;
        pos[di * 3] = a;
        pos[di * 3 + 1] = run.y;
        pos[di * 3 + 2] = 0;
      }
    }
    const flowGeo = new THREE.BufferGeometry();
    flowGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const flowMat = new THREE.PointsMaterial({
      size: 0.16,
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
      depthWrite: false,
      // 粒子在管道轴线上（被管壁挡住），开 depthTest 才看得见"管内流动"
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const flowPoints = new THREE.Points(flowGeo, flowMat);
    flowPoints.renderOrder = 3;
    flowPoints.name = 'deviceEnvFlow';
    flowPoints.frustumCulled = false;
    pipeGroup.add(flowPoints);
    this.flow = { points: flowPoints, geo: flowGeo, mat: flowMat, pos, x0, x1, y: py, prog };
    this.owned.push(flowGeo, flowMat);
    this.group.add(pipeGroup);
    this.owned.push(pipeMat, flangeMat, valveMat);

    /* ---------- 5. 检修物料（全部落地摆放） ---------- */
    const propGroup = new THREE.Group();
    propGroup.position.set(cx, 0, cz);
    propGroup.rotation.y = rotationY;
    const frontZ = halfD + 2.0;

    // 工具车：灰色双层层架手推车 + 轮子 + 工具箱
    propGroup.add(makeToolCart(-(halfW + 1.9), frontZ, baseY, lowFx));

    // 备件箱：蓝色塑料周转箱（两只错落）
    propGroup.add(makeCrate(halfW + 1.6, frontZ + 0.5, baseY, 0.78));
    propGroup.add(makeCrate(halfW + 2.5, frontZ - 0.4, baseY, 0.6));

    // 电缆盘：黄色圆盘 + 拖到设备的电缆
    propGroup.add(makeCableReel(-(halfW + 0.9), frontZ + 1.6, baseY, halfW + 0.9, lowFx));

    // 检修平台：铝制踏板搭在设备侧面
    propGroup.add(makePlatform(0, halfD + 1.15, baseY, Math.min(2.4, box.w * 0.7), box.h * 0.55, lowFx));

    // 临时工作灯：三脚架 + 暖黄灯头（真打一束暖光在检修部位）
    const lightX = -(halfW + 1.1);
    const lightZ = -(halfD + 1.4);
    const lamp = makeWorkLight(lightX, lightZ, baseY);
    propGroup.add(lamp.mesh);
    this.workLight = lamp.light;
    this.lampHeadMat = lamp.headMat;
    propGroup.add(lamp.light);

    // 工人 ×2：一个蹲在设备旁拿检测仪，一个站立观察
    propGroup.add(makeWorker(-(halfW + 0.75), halfD + 0.75, baseY, 'crouch', rotationY, this.workerParts));
    propGroup.add(makeWorker(halfW + 1.0, halfD + 1.5, baseY, 'stand', rotationY, this.workerParts));

    this.group.add(propGroup);

    /* ---------- 6. 检修状态：上盖板向上移开 30cm ---------- */
    this.group.add(this.buildOpenCover(box, rotationY));

    /* ---------- 6.5 侧墙采光带：窗户 + 从侧面照进来的自然光 ---------- */
    // 采光墙放在镜头的**正背景**（+Z 侧）：相机默认从 -X-Z 斜看设备，
    // 放 +X 侧时整面窗被甩到画面右缘外（实测截图里看不见窗）。
    const wallZ = cz + floorSize * 0.6;
    const wallH = box.h + 7;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x161f2c, roughness: 0.92, metalness: 0.05, side: THREE.DoubleSide });
    const wallGeo = new THREE.PlaneGeometry(floorSize * 1.1, wallH);
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(cx, baseY + wallH / 2, wallZ);
    // 法线转向设备（-Z），否则整面墙背对镜头看不见
    wall.rotation.y = Math.PI;
    wall.receiveShadow = !lowFx;
    this.group.add(wall);
    this.owned.push(wallMat, wallGeo);

    const paneMat = new THREE.MeshStandardMaterial({
      color: 0x101a26,
      emissive: DAYLIGHT_COLOUR,
      emissiveIntensity: 1.15,
      roughness: 0.35,
      metalness: 0.1,
    });
    const paneGeo = new THREE.PlaneGeometry(2.3, 1.7);
    const frameMat = new THREE.MeshStandardMaterial({ color: STEEL_DARK, roughness: 0.6, metalness: 0.5 });
    const frameGeo = new THREE.BoxGeometry(2.5, 1.9, 0.08);
    for (let i = 0; i < 4; i++) {
      const x = cx + (i - 1.5) * 3.4;
      const y = baseY + wallH * 0.42;
      const frame = new THREE.Mesh(frameGeo, frameMat);
      frame.position.set(x, y, wallZ - 0.05);
      this.group.add(frame);
      const pane = new THREE.Mesh(paneGeo, paneMat);
      pane.position.set(x, y, wallZ - 0.11);
      pane.rotation.y = Math.PI;
      this.group.add(pane);
    }
    this.owned.push(paneMat, paneGeo, frameMat, frameGeo);

    /* ---------- 7. 灯光：冷白主聚光 + 侧面自然光（低配只关阴影，绝不整盏撤掉） ---------- */
    const spot = new THREE.SpotLight(0xeaf2ff, 560, 30, 0.36, 0.92, 1.5);
    // 稍微偏置而非正对头顶：正上方平射会把顶盖照成一块死白，侧偏 2m 才有明暗层次
    spot.position.set(cx + 2.2, baseY + box.h + 6, cz - 1.8);
    spot.target.position.set(cx, baseY + box.h * 0.5, cz);
    spot.castShadow = !lowFx;
    if (!lowFx) {
      spot.shadow.mapSize.set(1024, 1024);
      spot.shadow.bias = -0.0004;
    }
    this.group.add(spot, spot.target);
    this.spot = spot;

    // 侧光：从窗户方向斜射进车间的自然光，把设备一侧打出亮面
    const side = new THREE.DirectionalLight(DAYLIGHT_COLOUR, 0.3);
    side.position.set(cx + 4, baseY + wallH * 0.8, wallZ + 6);
    side.target.position.set(cx, baseY + box.h * 0.55, cz);
    side.castShadow = !lowFx;
    this.group.add(side, side.target);
    this.sideLight = side;

    // 车间基础亮度：环境光 + 半球光（上深蓝下灰），保证四周不是一片死黑
    const envAmbient = new THREE.AmbientLight(0x9db4d8, 0.26);
    const envHemi = new THREE.HemisphereLight(0x2b3c58, 0x3f4650, 0.5);
    this.group.add(envAmbient, envHemi);

    /* ---------- 8. 远景剪影：fog 里隐约的其他设备 / 储罐轮廓 ---------- */
    const silMat = new THREE.MeshStandardMaterial({ color: 0x111a26, roughness: 0.95, metalness: 0.1 });
    const silGeo = new THREE.BoxGeometry(1, 1, 1);
    const silhouettes: Array<[number, number, number, number, number]> = [
      // [x 偏移, z 偏移, 宽, 高, 深]
      [-floorSize * 0.62, -floorSize * 0.3, 4.2, 3.4, 3],
      [-floorSize * 0.55, floorSize * 0.42, 3, 5.2, 2.6],
      [floorSize * 0.1, -floorSize * 0.62, 5.4, 2.4, 2.4],
      [-floorSize * 0.15, -floorSize * 0.72, 2.4, 6.6, 2.4],
    ];
    for (const [ox, oz, w, h, d] of silhouettes) {
      const m = new THREE.Mesh(silGeo, silMat);
      m.scale.set(w, h, d);
      m.position.set(cx + ox, baseY + h / 2, cz + oz);
      this.group.add(m);
    }
    this.owned.push(silMat, silGeo);

    // ── 左右侧墙 + 墙面照明灯亮点（灯为 emissive 小块，bloom 下呈光点）──
    const sideWallMat = new THREE.MeshStandardMaterial({ color: 0x222c3a, roughness: 0.92, metalness: 0.05 });
    const sideWallH = 11;
    for (const [wx, ry] of [[cx - floorSize * 0.62, Math.PI / 2], [cx + floorSize * 0.62, -Math.PI / 2]] as const) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(floorSize * 1.4, sideWallH), sideWallMat);
      wall.position.set(wx, baseY + sideWallH / 2, cz);
      wall.rotation.y = ry;
      this.group.add(wall);
    }
    this.owned.push(sideWallMat);

    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xfff2d8, emissive: 0xffd9a0, emissiveIntensity: 2.4,
      toneMapped: false, roughness: 0.4,
    });
    const lampGeo = new THREE.BoxGeometry(0.36, 0.16, 0.08);
    this.owned.push(lampMat, lampGeo);
    const lampSpots: Array<[number, number, number, number]> = [
      // 后墙 3 盏（错层）
      [cx - 9, baseY + 6.6, wallZ - 0.12, Math.PI],
      [cx + 0.5, baseY + 5.6, wallZ - 0.12, Math.PI],
      [cx + 10, baseY + 6.9, wallZ - 0.12, Math.PI],
      // 左右远端各 2 盏
      [cx - floorSize * 0.62 + 0.12, baseY + 6.2, cz - 7, Math.PI / 2],
      [cx - floorSize * 0.62 + 0.12, baseY + 5.4, cz + 6, Math.PI / 2],
      [cx + floorSize * 0.62 - 0.12, baseY + 6.2, cz + 7, -Math.PI / 2],
      [cx + floorSize * 0.62 - 0.12, baseY + 5.4, cz - 6, -Math.PI / 2],
    ];
    for (const [lx, ly, lz, ry] of lampSpots) {
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(lx, ly, lz);
      lamp.rotation.y = ry;
      this.group.add(lamp);
    }
  }

  /** 上盖板：从设备顶部向上移开 30cm，露出深色内腔。 */
  private buildOpenCover(box: DeviceDetailEnvBox, rotationY: number): THREE.Group {
    const g = new THREE.Group();
    g.name = 'deviceOpenCover';
    const cx = box.x;
    const cz = box.z;
    const coverW = box.w * 0.82;
    const coverD = box.d * 0.82;
    const coverH = Math.max(0.08, box.h * 0.06);
    const topY = box.y + box.h;

    const coverMat = new THREE.MeshStandardMaterial({ color: 0x2b333d, roughness: 0.88, metalness: 0.35 });
    const cover = new THREE.Mesh(new THREE.BoxGeometry(coverW, coverH, coverD), coverMat);
    cover.position.set(cx, topY + 0.3 + coverH / 2, cz);
    cover.rotation.y = rotationY;
    cover.castShadow = true;
    g.add(cover);

    // 内腔：盖板原位置露出的深色开口
    const cavityMat = new THREE.MeshStandardMaterial({ color: 0x0d1118, roughness: 0.95, metalness: 0.05 });
    const cavity = new THREE.Mesh(new THREE.BoxGeometry(coverW * 0.96, 0.06, coverD * 0.96), cavityMat);
    cavity.position.set(cx, topY - 0.02, cz);
    cavity.rotation.y = rotationY;
    g.add(cavity);

    this.owned.push(coverMat, cover.geometry, cavityMat, cavity.geometry);
    return g;
  }

  /** 暖黄工作灯轻微闪烁 + 工人待机呼吸/环视 + 管内流体推进；全部无文字无 UI。 */
  update(dt: number, t: number): void {
    if (this.workLight) {
      this.workLight.intensity = 30 + Math.sin(t * 7.3) * 2.1 + Math.sin(t * 13.7) * 1.2;
    }
    if (this.lampHeadMat) {
      this.lampHeadMat.emissiveIntensity = 1.5 + Math.sin(t * 7.3) * 0.18;
    }
    for (const w of this.workerParts) {
      const breath = Math.sin(t * 1.5 + w.phase);
      w.torso.scale.y = 1 + breath * 0.022;
      for (const h of w.heads) h.rotation.y = breath * 0.34;
    }
    const flow = this.flow;
    if (flow) {
      const step = Math.min(0.2, Math.max(0, dt)) * 0.22;
      for (let i = 0; i < flow.prog.length; i++) {
        let p = flow.prog[i] + step;
        if (p > 1) p -= 1;
        flow.prog[i] = p;
        flow.pos[i * 3] = flow.x0[i] + (flow.x1[i] - flow.x0[i]) * p;
        flow.pos[i * 3 + 1] = flow.y[i];
      }
      flow.geo.attributes.position.needsUpdate = true;
    }
  }

  dispose(): void {
    this.workerParts.length = 0;
    this.flow = null;
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
    this.workLight = null;
    this.lampHeadMat = null;
    this.spot = null;
    this.sideLight = null;
    this.group.clear();
  }
}

/* ========================= 造型构件 ========================= */

/** 工字钢立柱：两翼缘 + 腹板。 */
function makeIBeam(x: number, z: number, h: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const flange = new THREE.BoxGeometry(0.42, h, 0.06);
  const web = new THREE.BoxGeometry(0.06, h, 0.34);
  const f1 = new THREE.Mesh(flange, mat);
  f1.position.set(x, h / 2, z - 0.16);
  const f2 = new THREE.Mesh(flange, mat);
  f2.position.set(x, h / 2, z + 0.16);
  const w = new THREE.Mesh(web, mat);
  w.position.set(x, h / 2, z);
  g.add(f1, f2, w);
  return g;
}

/** 灰色双层工具车 + 轮子 + 工具箱。 */
function makeToolCart(x: number, z: number, baseY: number, lowFx: boolean): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, baseY, z);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x6e7986, roughness: 0.4, metalness: 0.65 });
  const shelfMat = new THREE.MeshStandardMaterial({ color: 0x828d99, roughness: 0.45, metalness: 0.6 });
  const toolboxMat = new THREE.MeshStandardMaterial({ color: 0xa03428, roughness: 0.55, metalness: 0.3 });
  const w = 1.0;
  const d = 0.62;
  const h = 1.05;
  for (const sy of [0.34, 0.78]) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(w, 0.045, d), shelfMat);
    shelf.position.y = sy;
    shelf.castShadow = !lowFx;
    g.add(shelf);
  }
  for (const [px, pz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]] as const) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, h, 8), frameMat);
    post.position.set(px, h / 2, pz);
    g.add(post);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10), frameMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(px, 0.07, pz);
    g.add(wheel);
  }
  const toolbox = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.26, 0.34), toolboxMat);
  toolbox.position.set(-0.1, 0.34 + 0.15, 0);
  toolbox.castShadow = !lowFx;
  g.add(toolbox);
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.3), frameMat);
  tray.position.set(0.12, 0.78 + 0.06, 0);
  g.add(tray);
  return g;
}

/** 蓝色塑料周转箱（备件箱）。 */
function makeCrate(x: number, z: number, baseY: number, size: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, baseY, z);
  g.rotation.y = (x > 0 ? 0.5 : -0.4);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.55, metalness: 0.15 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.62, size * 0.72), mat);
  box.position.y = size * 0.31;
  box.castShadow = true;
  g.add(box);
  // 箱口翻边
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.5, metalness: 0.15 });
  const rim = new THREE.Mesh(new THREE.BoxGeometry(size * 1.06, 0.06, size * 0.78), rimMat);
  rim.position.y = size * 0.62;
  g.add(rim);
  return g;
}

/** 黄色电缆盘 + 拖到设备的电缆段。 */
function makeCableReel(x: number, z: number, baseY: number, cableLen: number, lowFx: boolean): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, baseY, z);
  const drumMat = new THREE.MeshStandardMaterial({ color: 0xd8a614, roughness: 0.6, metalness: 0.2 });
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.85, metalness: 0.05 });
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.34, 18), drumMat);
  drum.rotation.z = Math.PI / 2;
  drum.position.y = 0.44;
  drum.castShadow = !lowFx;
  g.add(drum);
  const wind = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.11, 8, 20), cableMat);
  wind.position.y = 0.44;
  g.add(wind);
  // 拖在地上的电缆：从盘底拖向设备方向
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, cableLen, 8), cableMat);
  tail.rotation.z = Math.PI / 2;
  tail.rotation.y = Math.PI / 5;
  tail.position.set(-cableLen / 2 + 0.1, 0.05, 0.25);
  tail.rotation.y = -Math.PI / 5;
  g.add(tail);
  return g;
}

/** 铝制检修踏板（斜搭在设备侧面的工作平台）。 */
function makePlatform(x: number, z: number, baseY: number, w: number, topH: number, lowFx: boolean): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, baseY, z);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8f9aa6, roughness: 0.45, metalness: 0.65 });
  const plank = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, 0.66), mat);
  plank.position.y = topH;
  plank.castShadow = !lowFx;
  g.add(plank);
  // 花纹防滑条
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x77828e, roughness: 0.6, metalness: 0.5 });
  for (let i = -2; i <= 2; i++) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.02, 0.05), gripMat);
    strip.position.set(0, topH + 0.045, i * 0.14);
    g.add(strip);
  }
  // 支撑腿
  for (const [lx, lz] of [[-w / 2 + 0.15, -0.24], [w / 2 - 0.15, -0.24], [-w / 2 + 0.15, 0.24], [w / 2 - 0.15, 0.24]] as const) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, topH, 8), mat);
    leg.position.set(lx, topH / 2, lz);
    g.add(leg);
  }
  return g;
}

/** 临时工作灯：三脚架 + 暖黄灯头 + 真实点光源。 */
function makeWorkLight(x: number, z: number, baseY: number): {
  mesh: THREE.Group;
  light: THREE.PointLight;
  headMat: THREE.MeshStandardMaterial;
} {
  const g = new THREE.Group();
  g.position.set(x, baseY, z);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x4a545f, roughness: 0.5, metalness: 0.55 });
  const headH = 1.9;
  for (const [lx, lz] of [[-0.3, -0.2], [0.3, -0.2], [0, 0.32]] as const) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, headH + 0.25, 8), poleMat);
    leg.position.set(lx * 0.5, (headH + 0.25) / 2, lz * 0.5);
    leg.lookAt(g.position.x + lx * 2, headH + 0.25, g.position.z + lz * 2);
    g.add(leg);
  }
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xffd9a0,
    emissive: 0xffb95e,
    emissiveIntensity: 1.5,
    roughness: 0.4,
    metalness: 0.2,
  });
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.2, 14), headMat);
  head.position.set(0, headH, 0);
  head.rotation.x = 0.5;
  g.add(head);
  const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.1, 14), poleMat);
  hood.position.set(0, headH + 0.12, 0);
  g.add(hood);

  // 暖黄局部光在低配下同样保留（只省阴影），否则聚焦层只剩一盏顶光、检修部位没有层次
  const light = new THREE.PointLight(0xffc06a, 30, 8, 1.8);
  light.position.set(x, baseY + headH, z);
  light.castShadow = false;
  return { mesh: g, light, headMat };
}

/** 蓝色工人（低模）：crouch 蹲姿检测 / stand 站立观察。 */
function makeWorker(
  x: number,
  z: number,
  baseY: number,
  pose: 'crouch' | 'stand',
  rotationY: number,
  registry: Array<{ torso: THREE.Mesh; heads: THREE.Object3D[]; phase: number }>,
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, baseY, z);
  g.rotation.y = -rotationY + (pose === 'crouch' ? 0.6 : -0.4);
  const bodyMat = new THREE.MeshStandardMaterial({ color: WORKER_BLUE, roughness: 0.7, metalness: 0.05 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: 0xf2c327, roughness: 0.4, metalness: 0.15 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x27303b, roughness: 0.75, metalness: 0.1 });

  const crouch = pose === 'crouch';
  const bodyH = crouch ? 0.52 : 0.78;
  const bodyY = crouch ? 0.34 : 0.62;

  // 脚下光圈（呼吸脉冲，纯几何无文字）
  const footMat = new THREE.MeshBasicMaterial({
    color: 0x67e8f9, transparent: true, opacity: 0.4,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const footRing = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 24), footMat);
  footRing.rotation.x = -Math.PI / 2;
  footRing.position.y = 0.03;
  footRing.renderOrder = 30;
  footRing.name = 'footRing';
  g.add(footRing);

  // 躯干（胶囊感：圆柱 + 球头）
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, bodyH, 10), bodyMat);
  torso.position.y = bodyY;
  torso.castShadow = true;
  torso.name = 'torso';
  g.add(torso);
  const head = new THREE.Group();
  head.name = 'head';
  head.position.y = bodyY + bodyH / 2 + 0.1;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), darkMat);
  head.add(skull);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), helmetMat);
  helmet.position.y = 0.02;
  head.add(helmet);
  g.add(head);

  // 腿：蹲姿折叠（两段短腿），站姿直立
  if (crouch) {
    for (const side of [-1, 1]) {
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8), darkMat);
      thigh.rotation.x = Math.PI / 2.4;
      thigh.position.set(side * 0.1, 0.16, 0.1);
      g.add(thigh);
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.22, 8), darkMat);
      shin.position.set(side * 0.1, 0.09, -0.06);
      g.add(shin);
    }
  } else {
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.62, 8), darkMat);
      leg.position.set(side * 0.1, 0.31, 0);
      g.add(leg);
    }
  }

  // 手臂：蹲姿手持检测仪（朝前），站姿垂放
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, crouch ? 0.34 : 0.5, 8), bodyMat);
    if (crouch) {
      arm.rotation.x = Math.PI / 2.6;
      arm.position.set(side * 0.2, bodyY + 0.06, 0.14);
    } else {
      arm.rotation.z = side * 0.12;
      arm.position.set(side * 0.24, bodyY, 0);
    }
    g.add(arm);
  }
  // 手持检测仪（小深灰盒）
  if (crouch) {
    const device = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.06), darkMat);
    device.position.set(0, bodyY + 0.16, 0.3);
    g.add(device);
  }
  // 登记待机动画部件：呼吸起伏 + 头部环视（update() 逐帧驱动）
  // head 现在是组（头盔挂在里面），只转组即可，别再单独转头盔
  registry.push({ torso, heads: [head], phase: registry.length * 1.7 });
  return g;
}
