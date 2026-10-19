/**
 * 人员与工位动线层 —— 技师人形 + 历史轨迹 + 派工指引虚线 + 巡检数字人。
 *
 * 指引虚线刻意挂在独立的 guideGroup 而不是 group：聚焦层按既定口径
 * （有单测守护：聚焦时 workerGroup/安全边界层一律隐藏）整体隐藏人形与历史
 * 轨迹 —— 它们属于车间层信息，进详情层会与"画面里只剩这一台"冲突。
 * 而"选中哪台设备，就看它相关的那条链路"要求这条虚线在聚焦层保留，
 * 所以单独成层，并且不进 applyIsolationChrome 的隐藏表。
 * 生命周期与 group 一致：build / clear 里一起建、一起销毁，退出聚焦即清空。
 *
 * 场景侧负责坐标映射（DB 0–1000 → 3D）与设备 slot 解析，本模块不感知
 * 台账结构与地图回归参数。
 */

import * as THREE from 'three';

export interface WorkerTech {
  id: string;
  name: string;
  onlineStatus: 'online' | 'idle' | 'offline';
  mapX: number;
  mapY: number;
}

export interface WorkerFlowBuildOptions {
  selectedEqId: string | null;
  assigneeId: string | null;
  assigneeStatus: string | null;
  /** 独占模式：只显示与选中设备相关的技师 */
  isIsolation: boolean;
  /** DB 坐标 (mapX 0–1000, mapY 0–1000) → 3D 场景坐标 (x, z) */
  toScene: (mapX: number, mapY: number) => { x: number; z: number };
  /** 地形起伏高度 */
  reliefAt: (x: number, z: number) => number;
  /** 设备 id → slot 世界坐标（指引线终点） */
  equipmentSlot: (eqId: string) => { x: number; z: number } | null;
}

export interface WorkerFlowAnimateOptions {
  /** 厂区层不生成巡检数字人 */
  allowPatrol: boolean;
  reliefAt: (x: number, z: number) => number;
}

interface WorkerMeshes {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  label: THREE.Object3D;
  trail: THREE.Line | null;
  trailMat: THREE.LineBasicMaterial;
}

interface PatrolAvatar {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  pathIndex: number;
  progress: number;
}

/** 与 EquipmentScene.disposeGroup 同语义：共享几何不销毁，材质全销毁。 */
function disposeChildren(group: THREE.Object3D): void {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh & { isInstancedMesh?: boolean; dispose?: () => void };
    if (mesh.isInstancedMesh && typeof mesh.dispose === 'function') mesh.dispose();
    const g = mesh.geometry as THREE.BufferGeometry | undefined;
    if (g && !g.userData?.shared) g.dispose();
    const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (m) {
      const list = Array.isArray(m) ? m : [m];
      for (const mat of list) mat.dispose();
    }
  });
  group.clear();
}

export class WorkerFlow {
  readonly group = new THREE.Group();
  /** 派工指引虚线层（聚焦层保留，见模块头注释） */
  readonly guideGroup = new THREE.Group();

  private workerMeshes: Map<string, WorkerMeshes> = new Map();
  private guideLine: THREE.Line | null = null;
  private guideLineMat: THREE.LineDashedMaterial | null = null;
  /** 指引线目标技师 id */
  private guideTargetId: string | null = null;
  private patrolAvatar: PatrolAvatar | null = null;

  /**
   * 构建技师人形 + 轨迹 + 指引线（先整体清空重建）。
   * 由 React 层在 API 数据就绪后调用（防抖由 React 层控制，3D 层只消费不访问网络）。
   */
  build(
    technicians: WorkerTech[],
    trajectories: Map<string, Array<{ mapX: number; mapY: number }>>,
    opts: WorkerFlowBuildOptions,
  ): void {
    this.clear();

    for (const tech of technicians) {
      // 独占模式：只显示与选中设备相关的技师
      if (opts.isIsolation && tech.id !== opts.assigneeId) continue;

      const pos = opts.toScene(tech.mapX, tech.mapY);
      const y = opts.reliefAt(pos.x, pos.z);

      // 在线状态颜色
      const isOnline = tech.onlineStatus === 'online';
      const isIdle = tech.onlineStatus === 'idle';
      const bodyColor = isOnline ? 0x3b82f6 : isIdle ? 0x94a3b8 : 0x64748b;
      const opacity = tech.onlineStatus === 'offline' ? 0.4 : 0.9;

      // 创建人形组
      const group = new THREE.Group();
      group.name = `worker:${tech.id}`;

      // 身体（胶囊体简化为圆柱 + 两端半球）
      const bodyGeo = new THREE.CylinderGeometry(0.22, 0.18, 0.7, 8);
      bodyGeo.userData.shared = true;
      const bodyMat = new THREE.MeshStandardMaterial({
        color: bodyColor, transparent: true, opacity,
        roughness: 0.6, metalness: 0.2, toneMapped: false,
      });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = 0.55;
      group.add(body);

      // 头部
      const headGeo = new THREE.SphereGeometry(0.16, 8, 6);
      headGeo.userData.shared = true;
      const headMat = new THREE.MeshStandardMaterial({
        color: bodyColor, transparent: true, opacity,
        roughness: 0.5, metalness: 0.1, toneMapped: false,
      });
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.y = 1.08;
      group.add(head);

      // 姓名标签（头顶悬浮）
      const label = this.createLabel(tech.name, bodyColor, 0.72, 0.2);
      label.position.set(0, 1.4, 0);
      group.add(label);

      group.position.set(pos.x, y, pos.z);
      this.group.add(group);

      // 轨迹线
      const traj = trajectories.get(tech.id);
      let trail: THREE.Line | null = null;
      const trailMat = new THREE.LineBasicMaterial({
        color: 0x3b82f6, transparent: true, opacity: 0.35,
        toneMapped: false, depthWrite: false,
      });
      if (traj && traj.length >= 2) {
        const pts = traj.map((p) => {
          const sp = opts.toScene(p.mapX, p.mapY);
          return new THREE.Vector3(sp.x, opts.reliefAt(sp.x, sp.z) + 0.05, sp.z);
        });
        const trailGeo = new THREE.BufferGeometry().setFromPoints(pts);
        trailGeo.userData.shared = true;
        trail = new THREE.Line(trailGeo, trailMat);
        trail.name = `trail:${tech.id}`;
        this.group.add(trail);

        // 轨迹节点小球
        for (const p of pts) {
          const dotGeo = new THREE.SphereGeometry(0.04, 4, 3);
          dotGeo.userData.shared = true;
          const dotMat = new THREE.MeshBasicMaterial({
            color: 0x3b82f6, transparent: true, opacity: 0.5, toneMapped: false,
          });
          const dot = new THREE.Mesh(dotGeo, dotMat);
          dot.position.copy(p);
          this.group.add(dot);
        }
      }

      this.workerMeshes.set(tech.id, { group, body, head, label, trail, trailMat });
    }

    // 指引虚线：选中设备有 assignee 时显示
    if (opts.selectedEqId && opts.assigneeId) {
      const techData = technicians.find((t) => t.id === opts.assigneeId);
      const slot = techData ? opts.equipmentSlot(opts.selectedEqId) : null;
      if (techData && slot) {
        const techPos = opts.toScene(techData.mapX, techData.mapY);
        const techY = opts.reliefAt(techPos.x, techPos.z);
        const eqY = opts.reliefAt(slot.x, slot.z);
        const guideGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(techPos.x, techY + 1.2, techPos.z),
          new THREE.Vector3(slot.x, eqY + 0.5, slot.z),
        ]);
        guideGeo.userData.shared = true;
        // 工单完成/待验收 → 绿色，否则蓝色
        const guideColor = (opts.assigneeStatus === 'completed' || opts.assigneeStatus === 'pending_acceptance')
          ? 0x22c55e : 0x3b82f6;
        this.guideLineMat = new THREE.LineDashedMaterial({
          color: guideColor, transparent: true, opacity: 0.7,
          dashSize: 0.3, gapSize: 0.15,
          toneMapped: false, depthWrite: false,
        });
        this.guideLine = new THREE.Line(guideGeo, this.guideLineMat);
        this.guideLine.computeLineDistances();
        this.guideLine.name = `guide:${opts.assigneeId}`;
        this.guideGroup.add(this.guideLine);
        this.guideTargetId = opts.assigneeId;

        // 高亮该技师人形
        const wm = this.workerMeshes.get(opts.assigneeId);
        if (wm) {
          (wm.body.material as THREE.MeshStandardMaterial).color.set(0xfbbf24);
          (wm.head.material as THREE.MeshStandardMaterial).color.set(0xfbbf24);
        }
      }
    }
  }

  /** 创建工人姓名标签（深色底板 + 彩色边线 + canvas 文字） */
  private createLabel(name: string, accentColor: number, w: number, h: number): THREE.Object3D {
    const group = new THREE.Group();
    group.name = 'worker-label';

    const bgGeo = new THREE.PlaneGeometry(w, h);
    bgGeo.userData.shared = true;
    const bgMat = new THREE.MeshBasicMaterial({
      color: 0x0f172a, transparent: true, opacity: 0.88,
      side: THREE.DoubleSide, toneMapped: false,
    });
    const bg = new THREE.Mesh(bgGeo, bgMat);
    bg.rotation.x = -Math.PI / 4;
    group.add(bg);

    const borderGeo = new THREE.PlaneGeometry(w * 1.02, h * 0.06);
    borderGeo.userData.shared = true;
    const borderMat = new THREE.MeshBasicMaterial({
      color: accentColor, side: THREE.DoubleSide, toneMapped: false,
    });
    const border = new THREE.Mesh(borderGeo, borderMat);
    border.position.set(0, h * 0.45, 0.001);
    border.rotation.x = -Math.PI / 4;
    group.add(border);

    if (typeof document !== 'undefined') {
      const cw = Math.round(w * 256);
      const ch = Math.round(h * 256);
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, cw, ch);
        ctx.fillStyle = '#e8eef5';
        ctx.font = `bold ${Math.round(ch * 0.4)}px ui-monospace, Menlo, Consolas, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, cw / 2, ch / 2);
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        const texGeo = new THREE.PlaneGeometry(w * 0.96, h * 0.78);
        texGeo.userData.shared = true;
        const texMat = new THREE.MeshBasicMaterial({
          map: tex, transparent: true, side: THREE.DoubleSide, toneMapped: false, depthWrite: false,
        });
        const texMesh = new THREE.Mesh(texGeo, texMat);
        texMesh.position.set(0, 0, 0.002);
        texMesh.rotation.x = -Math.PI / 4;
        group.add(texMesh);
      }
    }
    return group;
  }

  /** 初始化或获取车间内自主走动巡检工程师数字人 */
  private ensurePatrolWorker(): void {
    if (this.patrolAvatar) return;
    const group = new THREE.Group();
    group.name = 'patrol_engineer_avatar';

    const blueSuit = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.6, metalness: 0.1 });
    const vestYellow = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.4, metalness: 0.2 });
    const darkPants = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7, metalness: 0.1 });
    const safetyHelmet = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.3, metalness: 0.3 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xffd1b3, roughness: 0.5, metalness: 0.05 });

    // 躯干（蓝色工装 + 反光背心）
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.65, 8), blueSuit);
    body.position.y = 0.95;
    group.add(body);
    const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.21, 0.38, 8), vestYellow);
    vest.position.y = 0.98;
    group.add(vest);

    // 头部 + 安全帽
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), skinMat);
    head.position.y = 1.42;
    group.add(head);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), safetyHelmet);
    helmet.position.y = 1.46;
    group.add(helmet);
    const helmetBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 10), safetyHelmet);
    helmetBrim.position.set(0, 1.44, 0.04);
    group.add(helmetBrim);

    // 双腿（可摆动）
    const leftLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.65, 6), darkPants);
    leftLeg.geometry.translate(0, -0.32, 0);
    leftLeg.position.set(-0.11, 0.65, 0);
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.65, 6), darkPants);
    rightLeg.geometry.translate(0, -0.32, 0);
    rightLeg.position.set(0.11, 0.65, 0);
    group.add(rightLeg);

    // 双臂（可摆动）
    const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.55, 6), blueSuit);
    leftArm.geometry.translate(0, -0.27, 0);
    leftArm.position.set(-0.28, 1.22, 0);
    group.add(leftArm);

    const rightArm = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.55, 6), blueSuit);
    rightArm.geometry.translate(0, -0.27, 0);
    rightArm.position.set(0.28, 1.22, 0);
    group.add(rightArm);

    // 巡检员头顶标牌
    const tag = this.createLabel('巡检工程师 · 张伟 [巡检中]', 0x22d3ee, 1.35, 0.24);
    tag.position.set(0, 1.78, 0);
    group.add(tag);

    group.position.set(-14, 0, -6);
    this.group.add(group);

    this.patrolAvatar = {
      group,
      body,
      head,
      leftLeg,
      rightLeg,
      leftArm,
      rightArm,
      pathIndex: 0,
      progress: 0,
    };
  }

  /** 人员动画：数字人在车间安全通道持续巡检走动 + 迈步摆臂 */
  animate(time: number, dt: number, opts: WorkerFlowAnimateOptions): void {
    // 确保巡检数字人存在
    if (!this.patrolAvatar && opts.allowPatrol) {
      this.ensurePatrolWorker();
    }

    if (this.patrolAvatar && this.group.visible) {
      const p = this.patrolAvatar;
      const waypoints = [
        { x: -16, z: -6 },
        { x: 16, z: -6 },
        { x: 16, z: 6 },
        { x: -16, z: 6 },
      ];
      const p0 = waypoints[p.pathIndex];
      const nextIdx = (p.pathIndex + 1) % waypoints.length;
      const p1 = waypoints[nextIdx];
      const dist = Math.hypot(p1.x - p0.x, p1.z - p0.z);

      // 巡检移速 2.4 m/s
      const speed = 2.4;
      p.progress += (speed * dt) / Math.max(1, dist);
      if (p.progress >= 1) {
        p.progress = 0;
        p.pathIndex = nextIdx;
      }

      const curX = p0.x + (p1.x - p0.x) * p.progress;
      const curZ = p0.z + (p1.z - p0.z) * p.progress;
      const gy = opts.reliefAt(curX, curZ);
      const targetAng = Math.atan2(p1.x - p0.x, p1.z - p0.z);

      p.group.position.set(curX, gy + Math.abs(Math.sin(time * 6.5)) * 0.04, curZ);
      p.group.rotation.y = targetAng;

      // 双腿双臂前后正弦交替摆动
      const legSwing = Math.sin(time * 6.5) * 0.45;
      p.leftLeg.rotation.x = legSwing;
      p.rightLeg.rotation.x = -legSwing;
      p.leftArm.rotation.x = -legSwing * 0.85;
      p.rightArm.rotation.x = legSwing * 0.85;
    }

    // 既有人形呼吸灯
    this.workerMeshes.forEach((wm) => {
      const s = 1.0 + 0.04 * Math.sin(time * 2.0);
      wm.body.scale.setScalar(s);
      wm.head.scale.setScalar(s);
    });
    // 指引虚线脉冲
    if (this.guideLineMat) {
      this.guideLineMat.opacity = 0.45 + 0.35 * Math.sin(time * 3.0);
    }
  }

  /** 清空人员动线与派工指引虚线 */
  clear(): void {
    disposeChildren(this.group);
    disposeChildren(this.guideGroup);
    this.workerMeshes.clear();
    // 巡检数字人也挂在 group 下，连同被 dispose —— 不清引用的话
    // animate 会一直动画一个已经脱离场景的 group，数字人再也不回来。
    this.patrolAvatar = null;
    this.guideLine = null;
    this.guideLineMat = null;
    this.guideTargetId = null;
  }
}
