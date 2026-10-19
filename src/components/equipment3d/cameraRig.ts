/**
 * 相机轨道装置（CameraRig）：自研阻尼轨道 + 指针/滚轮/双指交互 + 每帧相机落位。
 *
 * 切分口径（2026-10-19，自 scene.ts 机械切出）：
 *   - 内聚在此：orbit 状态本体、「输入事件 → 轨道目标值」的交互链路、
 *     「轨道目标值 → 平滑值 → 相机位姿」的每帧阻尼、完工恢复推镜；
 *   - 留在 scene.ts：取景编排（framePreset / setView / frameIsolated / frameZone…），
 *     它们只写 rig.state 的目标值（target/phi/theta/radius），平滑过渡由这里完成。
 *
 * 相机对象本身仍归 scene 所有（composer / raycaster / 小地图 / 各细节层共用），
 * rig 构造时持有引用，只写 position 与 lookAt。
 */
import * as THREE from 'three';
import { clamp } from './rand';

/**
 * 设备详情层的滚轮/双指拉远上限（米）：雾内仍能看清整个作业区，
 * 再远就会掉进雾外"一片黑"。只约束用户缩放，不约束自动取景
 * （窄窗口自适应取景必须能拉到 need，否则角点溢出画面）。
 */
const FOG_ZOOM_CAP = 17;

/** 轨道状态：无后缀 = 目标值；s 前缀 = 每帧阻尼逼近的平滑值（相机实际使用）。 */
export interface OrbitState {
  target: THREE.Vector3;
  sTarget: THREE.Vector3;
  theta: number;
  sTheta: number;
  phi: number;
  sPhi: number;
  radius: number;
  sRadius: number;
  minPhi: number;
  maxPhi: number;
  minRadius: number;
  maxRadius: number;
}

export class CameraRig {
  readonly state: OrbitState = {
    target: new THREE.Vector3(0, 6, 0),
    sTarget: new THREE.Vector3(0, 80, 0),
    theta: Math.PI * 0.72,
    sTheta: Math.PI * 0.72,
    phi: 0.95,
    sPhi: 0.36,
    radius: 130,
    sRadius: 280,
    minPhi: 0.06,
    maxPhi: 1.52,
    // 下限放到 4 米：单台特写需要贴近观察（原来 10 米对 3 米高的设备太远）
    minRadius: 3,
    maxRadius: 620,
  };

  private pointers = new Map<number, { x: number; y: number }>();
  private dragMode: 'none' | 'rotate' | 'pan' = 'none';
  private lastPointer = { x: 0, y: 0 };
  private pinchStart = 0;
  private pinchRadius = 0;

  /** 完工恢复的相机缓推：{t, r0} 计时还原轨道半径；null = 无进行中的推镜。 */
  private recoveryPush: { t: number; r0: number } | null = null;

  private el: HTMLElement | null = null;

  /**
   * @param camera 场景持有的相机（只写 position / lookAt）
   * @param isolatedLongestSide 设备详情层（有雾）返回孤立设备包围盒最长边（米），
   *        否则返回 null —— 决定用户缩放区间是否收紧（见 userZoomRange）。
   */
  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly isolatedLongestSide: () => number | null,
  ) {}

  bind(el: HTMLElement): void {
    this.el = el;
    el.addEventListener('contextmenu', this.onContextMenu);
    el.addEventListener('pointerdown', this.onPointerDown, { passive: true });
    el.addEventListener('pointermove', this.onPointerMove, { passive: true });
    el.addEventListener('pointerup', this.onPointerUp, { passive: true });
    el.addEventListener('pointercancel', this.onPointerUp, { passive: true });
    el.addEventListener('pointerleave', this.onPointerUp, { passive: true });
    // wheel 必须非 passive，否则无法 preventDefault（参考实现同样处理）
    el.addEventListener('wheel', this.onWheel, { passive: false });
  }

  unbind(): void {
    const el = this.el;
    if (!el) return;
    el.removeEventListener('contextmenu', this.onContextMenu);
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    this.el = null;
  }

  private onContextMenu = (e: Event): void => {
    // 右键用于平移，必须屏蔽系统菜单
    e.preventDefault();
  };

  private onPointerDown = (e: PointerEvent): void => {
    // setPointerCapture 在合成事件（自动化/远程调试注入）下可能抛 NotFoundError，
    // 捕获失败不影响旋转/平移，因此这里必须容错，否则整个交互会中断。
    try {
      (this.el as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
    } catch {
      /* 忽略：无活动指针时无法捕获 */
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      // 左键旋转 / 右键或中键平移（与生成器一致）
      this.dragMode = e.button === 2 || e.button === 1 || e.shiftKey ? 'pan' : 'rotate';
      this.lastPointer = { x: e.clientX, y: e.clientY };
    } else if (this.pointers.size === 2) {
      this.dragMode = 'none';
      const [a, b] = Array.from(this.pointers.values());
      this.pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchRadius = this.state.radius;
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 2) {
      const [a, b] = Array.from(this.pointers.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchStart > 0) {
        const k = this.pinchStart / Math.max(1, d);
        const pzr = this.userZoomRange();
        this.state.radius = clamp(this.pinchRadius * k, pzr.min, pzr.max);
      }
      return;
    }
    if (this.dragMode === 'none') return;

    const dx = e.clientX - this.lastPointer.x;
    const dy = e.clientY - this.lastPointer.y;
    this.lastPointer = { x: e.clientX, y: e.clientY };

    if (this.dragMode === 'rotate') {
      this.state.theta -= dx * 0.0042;
      this.state.phi = clamp(this.state.phi - dy * 0.0034, this.state.minPhi, this.state.maxPhi);
    } else {
      // 平移：沿相机右向量 / 前向量在水平面移动
      const scale = this.state.radius * 0.0016;
      const sin = Math.sin(this.state.sTheta);
      const cos = Math.cos(this.state.sTheta);
      this.state.target.x -= (cos * dx - sin * dy * 0.6) * scale;
      this.state.target.z += (sin * dx + cos * dy * 0.6) * scale;
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) {
      this.dragMode = 'none';
      this.pinchStart = 0;
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const k = Math.exp(clamp(e.deltaY, -220, 220) * 0.0012);
    const zr = this.userZoomRange();
    this.state.radius = clamp(this.state.radius * k, zr.min, zr.max);
  };

  /**
   * 用户缩放（滚轮/双指）的有效区间（仅设备详情层收紧）：
   *   - 下限 ≥ 包围盒最长边 × 1.2 —— 防止缩过头把镜头怼回设备脸上；
   *   - 上限封顶在雾可见范围内 —— 拉远可看整个作业区，但不掉进雾外黑屏。
   * 自动取景（frameIsolated）不受此区间约束，保证任意纵横比都能正确框住设备。
   */
  private userZoomRange(): { min: number; max: number } {
    const longest = this.isolatedLongestSide();
    if (longest !== null) {
      return {
        min: Math.max(this.state.minRadius, longest * 1.2),
        max: Math.min(this.state.maxRadius, FOG_ZOOM_CAP),
      };
    }
    return { min: this.state.minRadius, max: this.state.maxRadius };
  }

  /**
   * 完工恢复推镜（"验收复机"的镜头语言）：先把目标半径收 12%，
   * 1.6s 后由 update() 还原；阻尼让收→放两段都平滑不跳变。
   */
  startRecoveryPush(): void {
    const o = this.state;
    const r0 = Math.max(o.radius, o.sRadius);
    if (r0 > o.minRadius * 1.5) {
      o.radius = Math.max(o.minRadius + 0.5, r0 * 0.88);
      this.recoveryPush = { t: 0, r0 };
    }
  }

  /** 阻尼轨道 + 相机落位（scene.update 每帧调用）。 */
  update(dt: number): void {
    // 完工恢复推镜：1.6s 后把轨道半径还原（收→放的阻尼过渡由下方插值完成）
    if (this.recoveryPush) {
      this.recoveryPush.t += dt;
      if (this.recoveryPush.t >= 1.6) {
        this.state.radius = this.recoveryPush.r0;
        this.recoveryPush = null;
      }
    }
    const o = this.state;
    const k = 1 - Math.exp(-dt * 9);
    o.sTheta += (o.theta - o.sTheta) * k;
    o.sPhi += (o.phi - o.sPhi) * k;
    o.sRadius += (o.radius - o.sRadius) * k;
    o.sTarget.lerp(o.target, k);

    const sinPhi = Math.sin(o.sPhi);
    this.camera.position.set(
      o.sTarget.x + o.sRadius * sinPhi * Math.sin(o.sTheta),
      o.sTarget.y + o.sRadius * Math.cos(o.sPhi),
      o.sTarget.z + o.sRadius * sinPhi * Math.cos(o.sTheta)
    );
    this.camera.lookAt(o.sTarget);
  }
}
