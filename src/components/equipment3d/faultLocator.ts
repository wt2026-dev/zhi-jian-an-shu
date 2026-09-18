/**
 * 故障部位定位标 —— 对标视频 r3。
 *
 * 设备处于故障状态时，在其**具体故障部位**（轴承 / 关节 / 电机位等）生成红色定位标，
 * 由两部分组成：
 *   1) 红色实体高亮（对标 r3 里"故障件本身发红"）：
 *      光晕球 + 扫描环 + 落地光柱，depthTest 关闭，保证被外壳挡住时也看得见；
 *   2) "故障位置：xxx" 发光标签（Sprite，恒定朝向相机，远景可读）。
 *
 * 数据约束：部位名称与坐标由调用方从真实台账 / 诊断结果传入，
 * 本模块不做任何随机生成；设备恢复后调用 clear(deviceId) 或 setFaults([]) 移除。
 *
 * ⚠️ 标签尺寸/锚点的两次踩坑（都表现为"部位名看不见"）：
 *   1) 单行长文本 "故障位置：顶部电机" 横向撑满标签，聚焦相机下右半截被挤出可视区
 *      → 改成 640×260 两行布局（第一行"故障位置"，第二行部位名）；
 *   2) sizeAttenuation:false 下 sprite 是**恒定屏幕尺寸**，scale 直接决定它占屏幕
 *      多宽。实测 scale=2.6 时标签宽约 2373px、画布只有 1304px —— 等于 1.8 个屏宽，
 *      右半截必然被裁掉；同时 sprite 默认以**贴图中心**对齐锚点，而图标在贴图左侧
 *      15.6% 处，于是十字准星离故障点差了约 800px。
 *      → scale 降到 LABEL_SCALE（约占屏宽 40%），并用 sprite.center 把锚点挪到图标上：
 *        图标压在故障点上，文字向右侧展开。
 */

import * as THREE from 'three';

/** 标签贴图尺寸（两行布局）。 */
const LABEL_TEX_W = 640;
const LABEL_TEX_H = 260;
/** 贴图中圆圈图标圆心的 X（对齐到故障点时以它为锚）。 */
const LABEL_ICON_CX = 100;
/**
 * sprite 横向 scale。sizeAttenuation:false 下屏幕宽度占比约为
 * `scale / (2·aspect·tan(fov/2))`。聚焦相机把故障点投影到画布**水平中心**，
 * 文字从锚点向右展开 0.844·sw；1600×1000 实测（1304 设备像素画布）：
 *   scale=0.58 → sprite 右缘 CSS≈1354，越过右侧面板左缘 1261，底板右边被裁；
 *   scale=0.44 → 右缘 ≈1249，完整落在面板之左（余量 ~12px），第一行字高仍 ≈44px。
 * ⚠️ 这个值一旦调大就会重新出现"标签被右侧面板遮挡"，改动前请跑
 *    `scratch/verify-fault-label.mjs`（像素级量标签包围盒）。
 */
const LABEL_SCALE = 0.44;

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
  /** 红色实体高亮（光晕球 + 扫描环 + 光柱），与 sprite 同锚点 */
  marker: THREE.Group;
  haloMat: THREE.MeshBasicMaterial;
  ringMat: THREE.MeshBasicMaterial;
  beamMat: THREE.MeshBasicMaterial;
  phase: number;
  baseY: number;
}

export class FaultLocator {
  readonly group = new THREE.Group();
  private records = new Map<string, FaultRecord>();
  private ownedTextures: THREE.Texture[] = [];
  private paused = false;
  /** 共享几何体：所有定位标复用同一份球/环/柱，dispose 时统一释放。 */
  private geo = {
    halo: new THREE.SphereGeometry(0.46, 18, 12),
    ring: new THREE.TorusGeometry(0.78, 0.055, 8, 32),
    beam: new THREE.CylinderGeometry(0.11, 0.16, 1, 12, 1, true),
  };

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
        this.placeMarker(existing, a);
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
          // ⚠️ three r186 起 sizeAttenuation 语义被"扶正"了（见 sprite.glsl.js 的
          //    #ifndef USE_SIZEATTENUATION）：true（默认）按**世界尺寸**渲染 →
          //    远景缩成亚像素等于看不见；false 才做 scale *= -mvPosition.z 透视补偿
          //    → 恒定屏幕尺寸。故障标签要"远看也读得清"，必须显式关掉。
          sizeAttenuation: false,
        })
      );
      const aspect = LABEL_TEX_H / LABEL_TEX_W;
      sprite.scale.set(LABEL_SCALE, LABEL_SCALE * aspect, 1);
      // 锚点落在圆圈图标上（而不是贴图中心），文字从故障点向右展开。
      sprite.center.set(LABEL_ICON_CX / LABEL_TEX_W, 0.5);
      sprite.position.set(a.x, a.y, a.z);
      sprite.renderOrder = 50;
      sprite.userData = { kind: 'faultLocator', deviceId: a.deviceId, partName: a.partName };

      const marker = this.makeMarker(a.deviceId, a.partName, a);

      this.group.add(sprite);
      this.group.add(marker);
      this.records.set(a.deviceId, {
        anchor: a,
        sprite,
        marker,
        haloMat: marker.userData.haloMat as THREE.MeshBasicMaterial,
        ringMat: marker.userData.ringMat as THREE.MeshBasicMaterial,
        beamMat: marker.userData.beamMat as THREE.MeshBasicMaterial,
        phase: (a.x + a.z) * 0.31,
        baseY: a.y,
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

  /** 释放并摘除单条记录（sprite + 红色实体高亮）。 */
  private dropRecord(deviceId: string, rec: FaultRecord): void {
    this.group.remove(rec.sprite);
    const m = rec.sprite.material as THREE.SpriteMaterial;
    m.map?.dispose();
    m.dispose();
    this.disposeMarker(rec.marker);
    this.records.delete(deviceId);
  }

  /**
   * 红色实体高亮：光晕球 + 扫描环 + 落地光柱。
   *
   * 材质统一 `depthTest: false` —— 故障部位常常被设备外壳/管线挡住，
   * 关掉深度测试才能让"红色高亮"始终压在设备之上（对标 r3 的故障件发红）。
   */
  private makeMarker(deviceId: string, partName: string, a: FaultAnchor): THREE.Group {
    const g = new THREE.Group();
    g.name = 'faultMarker';
    g.userData = { kind: 'faultMarker', deviceId, partName };

    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.55,
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
      opacity: 0.8,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const ring = new THREE.Mesh(this.geo.ring, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 41;
    ring.userData = { kind: 'faultRing', deviceId };
    g.add(ring);

    // 落地光柱：从地面指到故障部位，远景也能一眼定位到是哪一台的哪一处。
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xdc2626,
      transparent: true,
      opacity: 0.24,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const beam = new THREE.Mesh(this.geo.beam, beamMat);
    beam.renderOrder = 39;
    beam.userData = { kind: 'faultBeam', deviceId };
    g.add(beam);

    g.userData.haloMat = haloMat;
    g.userData.ringMat = ringMat;
    g.userData.beamMat = beamMat;
    g.userData.ring = ring;
    g.userData.beam = beam;

    // ⚠️ 新建时就要摆位：光柱几何体是单位高的，靠 scale.y 撑到锚点高度。
    //    只在"锚点变化"分支里摆位的话，首次创建的光柱会是 1 米长的悬空短柱。
    this.placeGroup(g, a);
    return g;
  }

  /** 锚点变化时重摆高亮（光柱高度随锚点高度走）。 */
  private placeMarker(rec: FaultRecord, a: FaultAnchor): void {
    this.placeGroup(rec.marker, a);
  }

  private placeGroup(g: THREE.Group, a: FaultAnchor): void {
    g.position.set(a.x, a.y, a.z);
    const beam = g.userData.beam as THREE.Mesh;
    const h = Math.max(0.4, a.y);
    beam.scale.set(1, h, 1);
    beam.position.set(0, -h / 2, 0);
  }

  private disposeMarker(g: THREE.Group): void {
    this.group.remove(g);
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        // 几何体是共享的，只释放材质
        const m = o.material as THREE.MeshBasicMaterial | THREE.MeshBasicMaterial[];
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

  /** 红色实体高亮的数量（= 有定位标的设备数），供 UI / 自检核对。 */
  get markerCount(): number {
    return this.records.size;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  update(_dt: number, t: number): void {
    if (this.paused) return;
    for (const rec of this.records.values()) {
      const pulse = Math.sin(t * 2.6 + rec.phase) * 0.5 + 0.5;
      const aspect = LABEL_TEX_H / LABEL_TEX_W;
      const s = LABEL_SCALE * (1 + pulse * 0.09);
      rec.sprite.scale.set(s, s * aspect, 1);
      rec.sprite.position.y = rec.baseY + Math.sin(t * 1.7 + rec.phase) * 0.16;
      const m = rec.sprite.material as THREE.SpriteMaterial;
      m.opacity = 0.82 + pulse * 0.18;

      // 红色实体高亮：光晕呼吸 + 扫描环自转 + 光柱明暗。
      // 呼吸范围收在 0.42~0.78：太亮会糊成一块红饼，看不出"是哪个零件"。
      rec.haloMat.opacity = 0.42 + pulse * 0.36;
      rec.ringMat.opacity = 0.55 + pulse * 0.4;
      rec.beamMat.opacity = 0.16 + pulse * 0.18;
      const ring = rec.marker.userData.ring as THREE.Mesh | undefined;
      if (ring) ring.rotation.z = t * 1.15 + rec.phase;
    }
  }

  /** 圆圈 + 十字 + "故障位置：xxx" 发光标签。 */
  private makeFaultTexture(partName: string): THREE.CanvasTexture | null {
    if (typeof document === 'undefined') return null;
    const W = 640;
    const H = 260;
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
    ctx.fillRect(bx, 34, bw, H - 68);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 5;
    ctx.strokeRect(bx, 34, bw, H - 68);

    // 文字：两行布局 —— 第一行"故障位置"，第二行部位名（避免单行长文本被裁切）
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#fca5a5';
    ctx.fillStyle = '#fee2e2';
    let fontPx = 58;
    const line1 = '故障位置';
    ctx.font = `700 ${fontPx}px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif`;
    while (ctx.measureText(line1).width > bw - 32 && fontPx > 24) {
      fontPx -= 2;
      ctx.font = `700 ${fontPx}px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif`;
    }
    ctx.shadowBlur = 18;
    ctx.fillText(line1, bx + bw / 2, 84);
    ctx.shadowBlur = 0;
    let namePx = 52;
    ctx.font = `700 ${namePx}px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif`;
    while (ctx.measureText(partName).width > bw - 32 && namePx > 22) {
      namePx -= 2;
      ctx.font = `700 ${namePx}px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif`;
    }
    ctx.shadowBlur = 14;
    ctx.fillText(partName, bx + bw / 2, 172);
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
      this.disposeMarker(rec.marker);
    }
    this.records.clear();
    for (const t of this.ownedTextures) t.dispose();
    this.ownedTextures.length = 0;
    this.geo.halo.dispose();
    this.geo.ring.dispose();
    this.geo.beam.dispose();
    this.group.clear();
  }
}
