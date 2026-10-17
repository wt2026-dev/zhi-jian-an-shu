/**
 * 故障部位定位标 —— 设备详情层（场景密度优先版）。
 *
 * 设备处于故障状态时，在其故障部位生成**纯几何**红色高亮：
 *   1) 红色线框笼（EdgesGeometry 盒，优先包住真实零件包围盒）——
 *      对应验收口径"故障处红框"，**绝不带任何文字**；
 *   2) 红色实体高亮：光晕球 + 扫描环（depthTest 关闭，被外壳挡住也看得见）。
 *
 * ⚠️ 2026-09 口径变更：旧版的"故障位置 XXX"Sprite 文字标签与落地光柱已按
 *    「3D 画面里不飘任何文字 / 无光柱」的要求整体移除，部位名由右侧 DOM 面板展示。
 *
 * 数据约束：部位名称与坐标由调用方从真实台账 / 诊断结果传入，
 * 本模块不做任何随机生成；设备恢复后调用 clear(deviceId) 或 setFaults([]) 移除。
 */

import * as THREE from 'three';

export interface FaultAnchor {
  deviceId: string;
  /** 故障部位名称，如 "主轴轴承" —— 来自设备档案 / AI 诊断结果，供 DOM 面板使用 */
  partName: string;
  /** 世界坐标（场景坐标系） */
  x: number;
  y: number;
  z: number;
  /**
   * 可选：故障零件的世界包围盒（优先于锚点笼尺寸）。
   * 由 scene.showDeviceFault 用设备零件几何的真实 AABB 填入。
   */
  bounds?: { cx: number; cy: number; cz: number; sx: number; sy: number; sz: number };
}

interface FaultRecord {
  anchor: FaultAnchor;
  marker: THREE.Group;
  haloMat: THREE.MeshBasicMaterial;
  ringMat: THREE.MeshBasicMaterial;
  cageMat: THREE.LineBasicMaterial;
  phase: number;
  baseY: number;
  /**
   * 维修进度（0~1）：检修步骤每勾一条推进一档，红色高亮按比例减淡——
   * "勾一步消一层"，维修的推进在 3D 里看得见。
   */
  repairDim: number;
  /** 恢复动画状态：检修完工后红→绿扫过并整体淡出，结束后自动移除定位标。 */
  recovering: boolean;
  recoveryT: number;
  recoveryDur: number;
}

/** 恢复动画的红→绿两端（模块级预分配，update 里零分配）。 */
const RECOVERY_COLOURS = {
  haloFrom: new THREE.Color(0xef4444),
  haloTo: new THREE.Color(0x22c55e),
  ringFrom: new THREE.Color(0xf87171),
  ringTo: new THREE.Color(0x4ade80),
  cageFrom: new THREE.Color(0xff5a4d),
  cageTo: new THREE.Color(0x37e08a),
  scratch: new THREE.Color(),
};

export class FaultLocator {
  readonly group = new THREE.Group();
  private records = new Map<string, FaultRecord>();
  private paused = false;
  /**
   * 总开关（默认可见）。关掉后整层不渲染，同时跳过逐帧更新 ——
   * 隐藏的层不该继续吃 CPU（每帧几十次 sin/材质写入）。
   * 与 paused 的区别：paused 只冻结动画，仍然渲染。
   */
  private visible = true;
  /** 逐帧复用的投影向量（避免每帧 new）。 */
  private ndc = new THREE.Vector3();
  /** 共享几何体：所有定位标复用同一份球/环/笼盒，dispose 时统一释放。 */
  private geo = (() => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const cage = new THREE.EdgesGeometry(box);
    box.dispose();
    return {
      halo: new THREE.SphereGeometry(0.34, 16, 12),
      ring: new THREE.TorusGeometry(0.62, 0.05, 8, 32),
      cage,
    };
  })();

  constructor() {
    this.group.name = 'faultLocator';
  }

  /**
   * 全量替换故障定位标。同一设备重复调用会更新其部位与位置。
   * 传入空数组即清空（例如所有设备恢复正常，或退出聚焦）。
   */
  setFaults(anchors: FaultAnchor[]): void {
    const seen = new Set<string>();

    for (const a of anchors) {
      seen.add(a.deviceId);
      const existing = this.records.get(a.deviceId);
      if (existing) {
        existing.anchor = a;
        existing.baseY = a.y;
        this.placeMarker(existing, a);
        continue;
      }
      const marker = this.makeMarker(a.deviceId, a);
      this.group.add(marker);
      this.records.set(a.deviceId, {
        anchor: a,
        marker,
        haloMat: marker.userData.haloMat as THREE.MeshBasicMaterial,
        ringMat: marker.userData.ringMat as THREE.MeshBasicMaterial,
        cageMat: marker.userData.cageMat as THREE.LineBasicMaterial,
        phase: (a.x + a.z) * 0.31,
        baseY: a.y,
        repairDim: 0,
        recovering: false,
        recoveryT: 0,
        recoveryDur: 0,
      });
    }

    // 移除已恢复的设备
    for (const [id, rec] of Array.from(this.records.entries())) {
      if (seen.has(id)) continue;
      this.dropRecord(id, rec);
    }
  }

  /** 移除单台设备的定位标（设备恢复正常时调用）。 */
  clear(deviceId: string): void {
    const rec = this.records.get(deviceId);
    if (!rec) return;
    this.dropRecord(deviceId, rec);
  }

  /** 释放并摘除单条记录（红色高亮 + 线框笼）。 */
  private dropRecord(deviceId: string, rec: FaultRecord): void {
    this.group.remove(rec.marker);
    this.disposeMarker(rec.marker);
    this.records.delete(deviceId);
  }

  /**
   * 红色实体高亮：光晕球 + 扫描环 + 红色线框笼。
   *
   * 材质统一 `depthTest: false` —— 故障部位常常被设备外壳/管线挡住，
   * 关掉深度测试才能让"红色高亮"始终压在设备之上。
   */
  private makeMarker(deviceId: string, a: FaultAnchor): THREE.Group {
    const g = new THREE.Group();
    g.name = 'faultMarker';
    g.userData = { kind: 'faultMarker', deviceId, partName: a.partName };

    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.45,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const halo = new THREE.Mesh(this.geo.halo, haloMat);
    halo.renderOrder = 40;
    halo.userData = { kind: 'faultHalo', deviceId };
    g.add(halo);

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xf87171,
      transparent: true,
      opacity: 0.7,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const ring = new THREE.Mesh(this.geo.ring, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 41;
    ring.userData = { kind: 'faultRing', deviceId };
    g.add(ring);

    // 红色线框笼：优先包住真实零件包围盒，否则用锚点处的标准笼盒
    const cageMat = new THREE.LineBasicMaterial({
      color: 0xff5a4d,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const cage = new THREE.LineSegments(this.geo.cage, cageMat);
    cage.renderOrder = 42;
    cage.userData = { kind: 'faultCage', deviceId };
    g.add(cage);

    g.userData.haloMat = haloMat;
    g.userData.ringMat = ringMat;
    g.userData.cageMat = cageMat;
    g.userData.ring = ring;
    g.userData.cage = cage;

    this.placeGroup(g, a);
    return g;
  }

  /** 摆位：笼盒贴合零件包围盒（或锚点标准尺寸），扫描环放在锚点高度。 */
  private placeGroup(g: THREE.Group, a: FaultAnchor): void {
    const b = a.bounds;
    const sx = b ? Math.max(0.12, b.sx) : 0.85;
    const sy = b ? Math.max(0.12, b.sy) : 0.85;
    const sz = b ? Math.max(0.12, b.sz) : 0.85;
    const cx = b ? b.cx : a.x;
    const cy = b ? b.cy : a.y;
    const cz = b ? b.cz : a.z;
    g.position.set(cx, cy, cz);

    const cage = g.userData.cage as THREE.Mesh | undefined;
    if (cage) cage.scale.set(sx, sy, sz);

    const ring = g.userData.ring as THREE.Mesh | undefined;
    if (ring) {
      // 扫描环贴着笼盒底边，随零件尺寸走
      ring.position.set(0, -sy / 2 - 0.04, 0);
      ring.scale.setScalar(Math.max(0.6, Math.max(sx, sz) * 1.15));
    }

    // 光晕球压在笼盒中心，尺寸随零件走但不糊成大饼
    const halo = g.children.find((o) => o.userData?.kind === 'faultHalo') as THREE.Mesh | undefined;
    if (halo) halo.scale.setScalar(Math.max(0.5, Math.min(1.6, (sx + sy + sz) / 2.4)));
  }

  /** 锚点变化时重摆高亮。 */
  private placeMarker(rec: FaultRecord, a: FaultAnchor): void {
    this.placeGroup(rec.marker, a);
  }

  private disposeMarker(g: THREE.Group): void {
    this.group.remove(g);
    g.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        // 几何体是共享的，只释放材质
        const m = o.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m?.dispose();
      }
    });
    g.clear();
  }

  clearAll(): void {
    this.setFaults([]);
  }

  /**
   * 取该设备定位标的**对准点**（含抬升偏移），供相机聚焦时把镜头对准故障部位。
   * 没有定位标时返回 null，调用方应退回整机包围盒取景。
   */
  focusPointOf(deviceId: string): THREE.Vector3 | null {
    const rec = this.records.get(deviceId);
    if (!rec) return null;
    return new THREE.Vector3(rec.anchor.x, rec.anchor.y + 0.6, rec.anchor.z);
  }

  get activeDeviceIds(): string[] {
    return Array.from(this.records.keys());
  }

  /** 红色高亮的数量（= 有定位标的设备数），供 UI / 自检核对。 */
  get markerCount(): number {
    return this.records.size;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /**
   * 故障定位环总开关（HUD「可视化图层」里的"故障定位环"）。
   *
   * 只切可见性，**不动 records**：关掉再打开时，已登记的定位标原样回来
   * （含维修进度减淡状态与正在播放的恢复动画），不需要调用方重新 setFaults。
   */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.group.visible = visible;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /**
   * 维修进度：ratio ∈ [0,1]，红色高亮随检修步骤推进逐层减淡（最多减到 15%），
   * 全部勾完时定位标仍在——彻底消失要等"完工上报"触发的恢复动画。
   * @returns 该设备是否存在定位标
   */
  setRepairProgress(deviceId: string, ratio: number): boolean {
    const rec = this.records.get(deviceId);
    if (!rec) return false;
    const clamped = Math.max(0, Math.min(1, ratio));
    rec.repairDim = clamped;
    if (clamped >= 1) rec.recovering = false;
    return true;
  }

  /**
   * 检修完工恢复动画：红→绿扫过（约前 1/4 先增亮一次"完成闪"）再整体淡出，
   * 结束后自动移除定位标。设备状态色与相机推镜由 scene.playRepairRecovery 负责。
   */
  startRecovery(deviceId: string, duration = 2.4): boolean {
    const rec = this.records.get(deviceId);
    if (!rec) return false;
    rec.recovering = true;
    rec.recoveryT = 0;
    rec.recoveryDur = Math.max(0.8, duration);
    return true;
  }

  update(dt: number, t: number, _camera?: THREE.Camera): void {
    // 关掉的层不渲染也不更新：update 里每帧都要写材质，隐藏时白跑一遍没有意义。
    if (this.paused || !this.visible) return;
    for (const [id, rec] of Array.from(this.records.entries())) {
      const pulse = Math.sin(t * 2.6 + rec.phase) * 0.5 + 0.5;

      // 恢复动画：红→绿扫过 + 先增亮后淡出，播完自动移除定位标。
      if (rec.recovering) {
        rec.recoveryT += dt;
        const p = Math.min(1, rec.recoveryT / rec.recoveryDur);
        const eased = p * p * (3 - 2 * p); // smoothstep，颜色过渡更"扫过"
        RECOVERY_COLOURS.scratch.copy(RECOVERY_COLOURS.haloFrom).lerp(RECOVERY_COLOURS.haloTo, eased);
        rec.haloMat.color.copy(RECOVERY_COLOURS.scratch);
        rec.ringMat.color.copy(RECOVERY_COLOURS.ringFrom).lerp(RECOVERY_COLOURS.ringTo, eased);
        rec.cageMat.color.copy(RECOVERY_COLOURS.cageFrom).lerp(RECOVERY_COLOURS.cageTo, eased);
        // 前 20% 增亮一个"完成闪"，之后线性淡出到 0
        const envelope = p < 0.2 ? 1 + p * 1.5 : Math.max(0, 1 - (p - 0.2) / 0.8);
        rec.haloMat.opacity = (0.42 + pulse * 0.36) * envelope;
        rec.ringMat.opacity = (0.55 + pulse * 0.4) * envelope;
        rec.cageMat.opacity = Math.min(1, 0.75 + pulse * 0.25) * envelope;
        const ring = rec.marker.userData.ring as THREE.Mesh | undefined;
        if (ring) ring.rotation.z = t * 1.15 + rec.phase;
        if (p >= 1) this.dropRecord(id, rec);
        continue;
      }

      // 维修进度减淡：勾一步消一层，但保留 15% 底亮——定位标仍在，等完工上报收尾
      const dim = 1 - rec.repairDim * 0.85;

      // 红色实体高亮：光晕呼吸 + 扫描环自转。
      rec.haloMat.opacity = (0.32 + pulse * 0.26) * dim;
      // 口径（2026-09 可视化层收敛）：正常故障环不再抢眼 ——
      // 扫描环基准不透明度 0.5 → 0.35，脉冲幅度 0.35 → 0.25（峰值 0.85 → 0.6）。
      // 故障定位仍一眼可见（线框笼保持原亮度），但不再与介质流/轨迹抢视觉重心。
      // 恢复环（红→绿过渡）保持原有脉冲，见上面的 recovering 分支。
      rec.ringMat.opacity = (0.35 + pulse * 0.25) * dim;
      rec.cageMat.opacity = (0.8 + pulse * 0.2) * dim;
      const ring = rec.marker.userData.ring as THREE.Mesh | undefined;
      if (ring) ring.rotation.z = t * 1.15 + rec.phase;
    }
  }

  dispose(): void {
    for (const rec of this.records.values()) {
      this.disposeMarker(rec.marker);
    }
    this.records.clear();
    this.geo.halo.dispose();
    this.geo.ring.dispose();
    this.geo.cage.dispose();
    this.group.clear();
  }
}
