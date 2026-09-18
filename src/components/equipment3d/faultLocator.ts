/**
 * 故障部位定位标 —— 对标视频 r3。
 *
 * 设备处于故障状态时，在其**具体故障部位**（轴承 / 关节 / 电机位等）生成红色定位标：
 *   圆圈 + 十字 + "故障位置：xxx" 发光标签，用 Sprite 实现（恒定朝向相机，远景可读）。
 *
 * 数据约束：部位名称与坐标由调用方从真实台账 / 诊断结果传入，
 * 本模块不做任何随机生成；设备恢复后调用 clear(deviceId) 或 setFaults([]) 移除。
 */

import * as THREE from 'three';

export interface FaultAnchor {
  deviceId: string;
  /** 故障部位名称，如 "主轴轴承" —— 直接来自设备档案 / AI 诊断结果 */
  partName: string;
  /** 世界坐标（场景坐标系） */
  x: number;
  y: number;
  z: number;
}

interface FaultRecord {
  anchor: FaultAnchor;
  sprite: THREE.Sprite;
  phase: number;
  baseY: number;
}

export class FaultLocator {
  readonly group = new THREE.Group();
  private records = new Map<string, FaultRecord>();
  private ownedTextures: THREE.Texture[] = [];
  private paused = false;

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
        existing.sprite.position.set(a.x, a.y, a.z);
        existing.baseY = a.y;
        // 部位文字变了要重画贴图
        const tex = this.makeFaultTexture(a.partName);
        if (tex) {
          const mat = existing.sprite.material as THREE.SpriteMaterial;
          mat.map?.dispose();
          mat.map = tex;
          mat.needsUpdate = true;
          this.ownedTextures.push(tex);
        }
        continue;
      }
      const tex = this.makeFaultTexture(a.partName);
      if (!tex) continue;
      this.ownedTextures.push(tex);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        })
      );
      const aspect = 200 / 640;
      sprite.scale.set(3.4, 3.4 * aspect, 1);
      sprite.position.set(a.x, a.y, a.z);
      sprite.renderOrder = 50;
      sprite.userData = { kind: 'faultLocator', deviceId: a.deviceId, partName: a.partName };
      this.group.add(sprite);
      this.records.set(a.deviceId, {
        anchor: a,
        sprite,
        phase: (a.x + a.z) * 0.31,
        baseY: a.y,
      });
    }

    // 移除已恢复的设备
    for (const [id, rec] of Array.from(this.records.entries())) {
      if (seen.has(id)) continue;
      this.group.remove(rec.sprite);
      const m = rec.sprite.material as THREE.SpriteMaterial;
      m.map?.dispose();
      m.dispose();
      this.records.delete(id);
    }
  }

  /** 移除单台设备的定位标（设备恢复正常时调用）。 */
  clear(deviceId: string): void {
    const rec = this.records.get(deviceId);
    if (!rec) return;
    this.group.remove(rec.sprite);
    const m = rec.sprite.material as THREE.SpriteMaterial;
    m.map?.dispose();
    m.dispose();
    this.records.delete(deviceId);
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

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  update(_dt: number, t: number): void {
    if (this.paused) return;
    for (const rec of this.records.values()) {
      const pulse = Math.sin(t * 2.6 + rec.phase) * 0.5 + 0.5;
      const aspect = 200 / 640;
      const s = 3.4 * (1 + pulse * 0.09);
      rec.sprite.scale.set(s, s * aspect, 1);
      rec.sprite.position.y = rec.baseY + Math.sin(t * 1.7 + rec.phase) * 0.16;
      const m = rec.sprite.material as THREE.SpriteMaterial;
      m.opacity = 0.82 + pulse * 0.18;
    }
  }

  /** 圆圈 + 十字 + "故障位置：xxx" 发光标签。 */
  private makeFaultTexture(partName: string): THREE.CanvasTexture | null {
    if (typeof document === 'undefined') return null;
    const W = 640;
    const H = 200;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) return null;

    ctx.clearRect(0, 0, W, H);

    const cx = 100;
    const cy = H / 2;
    const r = 62;

    // 外发光晕
    ctx.shadowColor = '#f87171';
    ctx.shadowBlur = 26;

    // 圆圈（双环，脉冲感）
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(248,113,113,0.55)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 16, 0, Math.PI * 2);
    ctx.stroke();

    // 十字（贯穿圆内 + 露出末端）
    ctx.strokeStyle = '#fecaca';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(cx - r + 8, cy);
    ctx.lineTo(cx + r - 8, cy);
    ctx.moveTo(cx, cy - r + 8);
    ctx.lineTo(cx, cy + r - 8);
    ctx.stroke();

    // 圆心
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // 右侧标签底板
    const bx = 196;
    const bw = W - bx - 8;
    ctx.fillStyle = 'rgba(69,10,10,0.86)';
    ctx.fillRect(bx, 44, bw, H - 88);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 5;
    ctx.strokeRect(bx, 44, bw, H - 88);

    // 文字："故障位置：xxx"
    const text = `故障位置：${partName}`;
    let fontPx = 62;
    ctx.font = `700 ${fontPx}px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif`;
    while (ctx.measureText(text).width > bw - 32 && fontPx > 20) {
      fontPx -= 2;
      ctx.font = `700 ${fontPx}px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#fca5a5';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#fee2e2';
    ctx.fillText(text, bx + bw / 2, H / 2);
    ctx.shadowBlur = 0;

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  dispose(): void {
    for (const rec of this.records.values()) {
      const m = rec.sprite.material as THREE.SpriteMaterial;
      m.map?.dispose();
      m.dispose();
    }
    this.records.clear();
    for (const t of this.ownedTextures) t.dispose();
    this.ownedTextures.length = 0;
    this.group.clear();
  }
}
