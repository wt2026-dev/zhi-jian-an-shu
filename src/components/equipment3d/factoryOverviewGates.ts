/**
 * 厂区总览 —— 园区门与地块界域（自 FactoryOverview 类机械切出，纯移动不改行为）。
 *
 * 内聚在此：厂房地块的分区色描边（buildLotBoundaries）、四向园区出入口的
 * 门柱 / 横梁 / 脉冲光环 / 光柱信标 / 出口标牌 / 通路虚线（buildGates）。
 *
 * 类方法 → 自由函数：原 this 依赖（场景根组 / 园区范围 / 台账落位与分区 / 门登记表 /
 * 拾取回收表 / 虚线材质 / 公告牌工厂）收拢为上下文对象，由宿主在调用点组装。
 */
import * as THREE from 'three';
import { hexOf, type FactoryGate, type PlacedBuilding, type ResolvedZone } from './factoryOverviewTypes';

/** 公告牌工厂签名（宿主 makeBillboard 方法，内部做纹理回收登记）。 */
export type BillboardFactory = (
  paint: (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void,
  w: number,
  h: number
) => THREE.Sprite | null;

export interface LotBoundaryCtx {
  group: THREE.Group;
  placed: PlacedBuilding[];
  zonesResolved: ResolvedZone[];
}

/** 厂房地块的分区色描边（贴地矩形线框，颜色取所属分区）。 */
export function buildLotBoundaries(ctx: LotBoundaryCtx): void {
  const { group, placed, zonesResolved } = ctx;
  for (const b of placed) {
    const zone = zonesResolved.find((z) => z.id === b.zoneId) ?? zonesResolved[0];
    const pad = 3.5;
    const lw = b.w + pad * 2;
    const ld = b.d + pad * 2;
    const hx = lw / 2;
    const hz = ld / 2;

    const pts = [
      new THREE.Vector3(-hx, 0.04, -hz),
      new THREE.Vector3(hx, 0.04, -hz),
      new THREE.Vector3(hx, 0.04, hz),
      new THREE.Vector3(-hx, 0.04, hz),
      new THREE.Vector3(-hx, 0.04, -hz),
    ];
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: zone.color, transparent: true, opacity: 0.5 })
    );
    line.position.set(b.x, 0, b.z);
    group.add(line);
  }
}

export interface GatesCtx {
  group: THREE.Group;
  extent: { halfX: number; halfZ: number };
  /** 门登记表（宿主 readonly gates，dispose 时清空） */
  gates: FactoryGate[];
  gateRings: THREE.Mesh[];
  gateBeacons: THREE.Mesh[];
  gateSprites: THREE.Sprite[];
  /** 通路虚线共享材质（逐门 clone 后改色） */
  gateLink: THREE.LineDashedMaterial;
  makeBillboard: BillboardFactory;
}

/** 园区出入口（标记点 + 连线）。 */
export function buildGates(ctx: GatesCtx): void {
  const { group, extent, gates, gateRings, gateBeacons, gateSprites, makeBillboard } = ctx;
  const { halfX, halfZ } = extent;
  const defs: Array<Omit<FactoryGate, 'heading' | 'linkTo'> & { heading: number; linkTo: { x: number; z: number } }> = [
    {
      id: 'gate-north',
      name: '厂区主出入口 · 北门',
      kind: 'main',
      x: 0,
      z: -halfZ * 0.99,
      heading: 0,
      linkTo: { x: 0, z: -halfZ * 0.55 },
    },
    {
      id: 'gate-east',
      name: '物流货运口 · 东门',
      kind: 'logistics',
      x: halfX * 0.99,
      z: 0,
      heading: Math.PI / 2,
      linkTo: { x: halfX * 0.55, z: 0 },
    },
    {
      id: 'gate-south',
      name: '人流出入口 · 南门',
      kind: 'person',
      x: 0,
      z: halfZ * 0.99,
      heading: Math.PI,
      linkTo: { x: 0, z: halfZ * 0.55 },
    },
    {
      id: 'gate-west',
      name: '物料周转口 · 西门',
      kind: 'buffer',
      x: -halfX * 0.99,
      z: halfZ * 0.42,
      heading: -Math.PI / 2,
      linkTo: { x: -halfX * 0.55, z: halfZ * 0.42 },
    },
  ];

  const GATE_COLOR: Record<FactoryGate['kind'], number> = {
    main: 0x22d3ee,
    logistics: 0x38bdf8,
    person: 0x10b981,
    buffer: 0xf59e0b,
  };
  const GATE_TAG: Record<FactoryGate['kind'], string> = {
    main: '主出入口',
    logistics: '物流口',
    person: '人流口',
    buffer: '周转口',
  };
  /**
   * 出口立牌的落位旋钮（世界系）：out=沿"园区中心→门"外推米数，
   * side=沿道路横向的倍数（正=绕 Y 逆时针让开），band=离地高度带。
   * 三个值都是拿 scratch/label-overlap-probe.ts 按真实取景相机投影试出来的：
   * 目的只有一个 —— 16:9 与窄屏下都不与分区牌 / 在建牌 / 厂房屋顶名叠字。
   */
  const DEFAULT_GATE_SIGN_OFFSET = { out: 15, side: 0, band: 12.5 };
  const GATE_SIGN_OFFSET: Record<string, { out: number; side: number; band: number }> = {
    'gate-north': { out: 15, side: 0, band: 12.5 },
    'gate-east': { out: 15, side: 0, band: 12.5 },
    // 南门与 C 区同在 x=0 视线上：沿道路横向让开 27m，落到 C 区牌下方的高度带
    'gate-south': { out: 15, side: -1.8, band: 9 },
    // 西门正对在建工程牌：外推 24m 并抬到 60m 带，从在建牌与 A 区牌中间穿过去
    'gate-west': { out: 24, side: 1.1, band: 60 },
  };

  for (const d of defs) {
    const gate: FactoryGate = { ...d };
    gates.push(gate);

    const color = GATE_COLOR[gate.kind];
    const g = new THREE.Group();
    g.name = `factoryGate:${gate.id}`;
    g.position.set(gate.x, 0, gate.z);
    g.rotation.y = gate.heading;

    // 门柱 + 横梁（标记点本体）
    const postGeo = new THREE.BoxGeometry(0.8, 6, 0.8);
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x1f3a56,
      roughness: 0.6,
      metalness: 0.35,
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.22,
    });
    const postL = new THREE.Mesh(postGeo, postMat);
    postL.position.set(-6, 3, 0);
    const postR = new THREE.Mesh(postGeo, postMat);
    postR.position.set(6, 3, 0);
    g.add(postL, postR);

    const beam = new THREE.Mesh(new THREE.BoxGeometry(13.2, 0.7, 0.9), postMat);
    beam.position.set(0, 6, 0);
    g.add(beam);

    // 脉冲光环（标记点）
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(5.4, 6.6, 40),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.14;
    ring.renderOrder = 3;
    g.add(ring);
    gateRings.push(ring);

    // 竖直光柱信标（远处也能看见"出口在哪"）
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 26, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      })
    );
    beacon.position.set(0, 13, 0);
    g.add(beacon);
    gateBeacons.push(beacon);

    // 出口标牌
    const sp = makeBillboard(
      (ctx2, c) => {
        ctx2.fillStyle = 'rgba(6, 20, 36, 0.9)';
        ctx2.fillRect(0, 0, c.width, c.height);
        ctx2.strokeStyle = hexOf(color);
        ctx2.lineWidth = 4;
        ctx2.strokeRect(2, 2, c.width - 4, c.height - 4);
        ctx2.fillStyle = '#e0f7ff';
        ctx2.font = '700 36px "Microsoft YaHei", sans-serif';
        ctx2.textAlign = 'center';
        ctx2.fillText(`${GATE_TAG[gate.kind]} · ${gate.name.split(' · ')[1] ?? ''}`, c.width / 2, 54);
        ctx2.fillStyle = hexOf(color);
        ctx2.font = '500 22px monospace';
        ctx2.fillText('GATE / 24H 智能道闸', c.width / 2, 100);
      },
      560,
      130
    );
    if (sp) {
      sp.scale.set(0.15, 0.15 * (130 / 560), 1);
      // 标牌停在"道路端点外侧"：沿出入口→园区外的方向外推一段，再沿道路横向让开，
      // 并抬到各自的高度带。四道门里有两道正落在 C 区牌的视线轴上（南/北门与 C 区同在
      // x=0），贴着闸机立牌就会和分区牌叠成一条；西门则与在建工程牌同高。
      // ⚠️ 位移在**世界系**里算（闸机组各自 rotation.y 不同，写局部轴会随朝向翻转）。
      const off = GATE_SIGN_OFFSET[gate.id] ?? DEFAULT_GATE_SIGN_OFFSET;
      const dist = Math.hypot(gate.x, gate.z) || 1;
      const ox = (gate.x / dist) * off.out;
      const oz = (gate.z / dist) * off.out;
      // 横向 = 外向向量绕 Y 转 90°（世界系）
      const sx = -oz * off.side;
      const sz = ox * off.side;
      const wx = ox + sx;
      const wz = oz + sz;
      // 世界偏移 → 闸机局部：再绕 Y 反转正对 heading
      const c = Math.cos(gate.heading);
      const s = Math.sin(gate.heading);
      sp.position.set(wx * c - wz * s, off.band, wx * s + wz * c);
      g.add(sp);
      gateSprites.push(sp);
    }

    // 通向园区主路的虚线连线
    const linkPts = [
      new THREE.Vector3(gate.x, 0.16, gate.z),
      new THREE.Vector3(gate.linkTo.x, 0.16, gate.linkTo.z),
    ];
    const linkLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(linkPts),
      ctx.gateLink.clone()
    );
    (linkLine.material as THREE.LineDashedMaterial).color = new THREE.Color(color);
    linkLine.computeLineDistances();
    group.add(linkLine);

    group.add(g);
  }
}
