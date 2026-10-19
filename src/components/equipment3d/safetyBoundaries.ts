/**
 * 安全边界层 —— 安全圈 + LOTO 能量隔离罩（车间层叠加物）。
 *
 * 由 EquipmentScene.buildSafetyBoundaries 在 API 数据就绪后调用：
 * 场景侧负责把设备 id 解析成世界坐标锚点（slot 位置 + 地形起伏 + 包围盒尺寸），
 * 本模块只负责按锚点生成/销毁网格与动画，不感知设备台账结构。
 *
 * 视觉口径：预定义作业类型配色（动火=琥珀、吊装=红、其他=橙），
 * LOTO 罩为绿色半透明圆柱；文字贴片沿用铭牌方案（深色底板 + 彩色边线）。
 */

import * as THREE from 'three';

export interface SafetyBoundaryInfo {
  permits: any[];
  locks: any[];
}

/** 单台设备的世界坐标锚点（由场景侧解析好再传入）。 */
export interface SafetyAnchor {
  x: number;
  y: number;
  z: number;
  /** 设备序号，用于动画相位错开 */
  phase: number;
  /** 设备包围盒尺寸（缺省时按 2.5/3/3 回退，与抽取前一致） */
  h?: number;
  w?: number;
  d?: number;
}

interface SafetyAnim {
  obj: THREE.Object3D;
  kind: 'rotate' | 'pulse';
  speed: number;
  phase: number;
  base?: number;
}

// 预定义颜色
const TYPE_COLOR: Record<string, number> = {
  '动火': 0xfbbf24,
  '吊装': 0xef4444,
};
const RING_SEG = 32;

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

export class SafetyBoundaries {
  readonly group = new THREE.Group();
  private anims: SafetyAnim[] = [];

  /**
   * 构建安全边界3D：安全圈 + 能量隔离罩。
   * 先整体销毁旧网格再按 anchors 重建（空 data 等价于清空）。
   */
  build(data: Map<string, SafetyBoundaryInfo>, anchors: Map<string, SafetyAnchor>): void {
    disposeChildren(this.group);
    this.anims = [];
    if (data.size === 0) return;

    for (const [eqId, info] of data) {
      const anchor = anchors.get(eqId);
      if (!anchor) continue;
      const { x, y, z } = anchor;
      const idx = anchor.phase;

      for (const permit of info.permits) {
        const pt = permit.permitType ?? '';
        const color = TYPE_COLOR[pt.includes('动火') ? '动火' : pt.includes('吊装') ? '吊装' : '其他'] ?? 0xf97316;
        const r = this.extractRadius(permit, 10);

        // 安全圈：共享几何（R=1, 段数32, 合并后 scale=r） + 旋转动画
        const ringGeo = new THREE.RingGeometry(0.92, 1.0, RING_SEG);
        ringGeo.rotateX(-Math.PI / 2);
        ringGeo.userData.shared = true;
        const ringMat = new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.42,
          side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.set(x, y + 0.07, z);
        ring.scale.setScalar(r);
        ring.name = `safety-ring:${eqId}`;
        this.group.add(ring);
        this.anims.push({ obj: ring, kind: 'rotate', speed: 0.12, phase: idx * 0.7 });

        // 安全圈内侧填充：半透明扇形垫底（视觉更饱满，不引入新几何）
        const fillGeo = new THREE.CircleGeometry(0.92, RING_SEG);
        fillGeo.rotateX(-Math.PI / 2);
        fillGeo.userData.shared = true;
        const fillMat = new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.06,
          side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
        });
        const fill = new THREE.Mesh(fillGeo, fillMat);
        fill.position.set(x, y + 0.06, z);
        fill.scale.setScalar(r);
        fill.name = `safety-fill:${eqId}`;
        this.group.add(fill);

        // 标签贴片：深色底板 + 彩色边线（现成 nameplate 方案）
        const permitCode = permit.permitNo ?? '';
        const permitLabel = pt.replace('作业票', '');
        if (permitCode || permitLabel) {
          const lbl = this.createLabel(`${permitCode} ${permitLabel}`, color, 1.2, 0.28);
          lbl.position.set(x + r + 1.8, y + 0.6, z);
          this.group.add(lbl);
        }
      }

      // LOTO 能量隔离罩：绿色半透明圆柱 + 顶部锁数
      if (info.locks.length > 0) {
        const h = (anchor.h ?? 2.5) * 0.7;
        const r = (Math.max(anchor.w ?? 3, anchor.d ?? 3) * 0.5) + 0.6;
        const cylGeo = new THREE.CylinderGeometry(r, r, h, 24, 1, true);
        cylGeo.userData.shared = true;
        const cylMat = new THREE.MeshBasicMaterial({
          color: 0x22c55e, transparent: true, opacity: 0.13,
          side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
        });
        const cyl = new THREE.Mesh(cylGeo, cylMat);
        cyl.position.set(x, y + h / 2 + 0.08, z);
        cyl.name = `safety-loto:${eqId}`;
        this.group.add(cyl);
        this.anims.push({ obj: cyl, kind: 'pulse', speed: 0.8, phase: idx * 1.3, base: 0.13 });

        // 锁具标记：每把挂锁一个 box + 环形锁扣
        for (let i = 0; i < Math.min(info.locks.length, 3); i++) {
          const a = (i / info.locks.length) * Math.PI * 2 + 0.5;
          const lx = x + Math.cos(a) * (r + 0.15);
          const lz = z + Math.sin(a) * (r + 0.15);
          const bodyGeo = new THREE.BoxGeometry(0.22, 0.28, 0.14);
          bodyGeo.userData.shared = true;
          const bodyMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.6, metalness: 0.3 });
          const body = new THREE.Mesh(bodyGeo, bodyMat);
          body.position.set(lx, y + 0.42, lz);
          this.group.add(body);
          const shackleGeo = new THREE.TorusGeometry(0.08, 0.018, 8, 12, Math.PI);
          shackleGeo.userData.shared = true;
          const shackleMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.3, metalness: 0.8 });
          const shackle = new THREE.Mesh(shackleGeo, shackleMat);
          shackle.position.set(lx, y + 0.62, lz);
          this.group.add(shackle);
        }

        // 锁数标签
        const lockLabel = this.createLabel(`${info.locks.length} 把锁`, 0x22c55e, 0.72, 0.22);
        lockLabel.position.set(x, y + h + 0.3, z);
        this.group.add(lockLabel);
      }
    }
  }

  /** 从 precautions 文本提取半径数值（如"半径 10 米"→ 10） */
  private extractRadius(permit: any, fallback: number): number {
    const list: string[] = permit.precautions ?? [];
    for (const s of list) {
      const m = s.match(/半径\s*(\d+(?:\.\d+)?)\s*米/);
      if (m) return parseFloat(m[1]);
    }
    return fallback;
  }

  /** 创建安全标签（深色底板 + 彩色边线，与铭牌同方案） */
  private createLabel(text: string, accentColor: number, w: number, h: number): THREE.Object3D {
    const group = new THREE.Group();
    group.name = 'safety-label';

    // 底板
    const bgGeo = new THREE.PlaneGeometry(w, h);
    bgGeo.userData.shared = true;
    const bgMat = new THREE.MeshBasicMaterial({
      color: 0x0f172a, transparent: true, opacity: 0.88,
      side: THREE.DoubleSide, toneMapped: false,
    });
    const bg = new THREE.Mesh(bgGeo, bgMat);
    bg.rotation.x = -Math.PI / 4;
    group.add(bg);

    // 上方彩色边线
    const borderGeo = new THREE.PlaneGeometry(w * 1.02, h * 0.08);
    borderGeo.userData.shared = true;
    const borderMat = new THREE.MeshBasicMaterial({
      color: accentColor, side: THREE.DoubleSide, toneMapped: false,
    });
    const border = new THREE.Mesh(borderGeo, borderMat);
    border.position.set(0, h * 0.44, 0.001);
    border.rotation.x = -Math.PI / 4;
    group.add(border);

    // Canvas 贴图
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
        ctx.font = `bold ${Math.round(ch * 0.42)}px ui-monospace, Menlo, Consolas, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, cw / 2, ch / 2);
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        const texGeo = new THREE.PlaneGeometry(w * 0.96, h * 0.8);
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

  /** 安全边界动画（合并进现有 RAF 循环） */
  animate(time: number): void {
    if (this.anims.length === 0) return;
    for (const a of this.anims) {
      const t = time + a.phase;
      if (a.kind === 'rotate') {
        (a.obj as THREE.Mesh).rotation.z = t * a.speed;
      } else if (a.kind === 'pulse' && a.base != null) {
        const mat = (a.obj as THREE.Mesh).material as THREE.MeshBasicMaterial;
        mat.opacity = a.base + Math.sin(t * Math.PI) * 0.04;
      }
    }
  }

  dispose(): void {
    disposeChildren(this.group);
    this.anims = [];
  }
}
