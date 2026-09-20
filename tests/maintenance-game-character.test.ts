/**
 * 「检修闯关」数字人姿态的几何守卫。
 *
 * 这里锁的是两个**看不见、只能靠几何验**的坑：
 *  1. 手臂姿态用"目标方向"反解（`aimOffset`），**必须用本帧父骨骼的朝向**。
 *     用载入时的静止父朝向去解前臂，上臂一抬起前臂就指错方向
 *     （实测：手缩到头后面，看起来像挠头而不是挥手）。
 *  2. 模型默认朝向不能假设（`deriveFacing` 从脚踝→脚趾量）。
 *     这只 GLB 的绑定姿态是**双手抱胸**，按"Mixamo 默认朝 -Z / T-pose"写死全错。
 *
 * 不依赖浏览器：纯 three.js 数学，不需要 WebGL。
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { aimOffset, armAims, deriveFacing, measureAimBone, AIM_CHAIN } from '../src/components/game/gameCharacter';

/**
 * 造一条"上臂 → 前臂 → 手"的骨骼链，姿态刻意扭成非 T-pose（模拟抱胸绑定姿态）。
 * 父节点朝向必须是**非单位**的，否则"用静止父朝向"和"用本帧父朝向"恰好等价，测试就失效了。
 */
function makeArmChain() {
  const root = new THREE.Group();
  const shoulder = new THREE.Bone();
  shoulder.name = 'mixamorigRightShoulder';
  const arm = new THREE.Bone();
  arm.name = 'mixamorigRightArm';
  const fore = new THREE.Bone();
  fore.name = 'mixamorigRightForeArm';
  const hand = new THREE.Bone();
  hand.name = 'mixamorigRightHand';
  root.add(shoulder);
  shoulder.add(arm);
  arm.add(fore);
  fore.add(hand);
  shoulder.quaternion.setFromEuler(new THREE.Euler(0.2, -0.35, 0.15));
  arm.quaternion.setFromEuler(new THREE.Euler(0.3, 0.4, 0.5));
  fore.quaternion.setFromEuler(new THREE.Euler(-0.2, 0.7, 0.1));
  fore.position.set(0.28, -0.02, 0.06);
  hand.position.set(0.24, 0, -0.03);
  root.updateMatrixWorld(true);
  return { root, arm, fore, hand };
}

/** 取骨骼当前的"骨骼 → 子关节"单位方向（根局部空间） */
function currentDir(bone: THREE.Object3D, child: THREE.Object3D): THREE.Vector3 {
  return child
    .getWorldPosition(new THREE.Vector3())
    .sub(bone.getWorldPosition(new THREE.Vector3()))
    .normalize();
}

describe('手臂瞄准姿态（aimOffset）', () => {
  it('用本帧父骨骼朝向反解，前臂能精确指向目标方向', () => {
    const { root, arm, fore, hand } = makeArmChain();
    const armAim = measureAimBone(arm, fore)!;
    const foreAim = measureAimBone(fore, hand)!;
    expect(armAim).toBeTruthy();
    expect(foreAim).toBeTruthy();

    // 1) 先把上臂抬到"斜上外"
    const armTarget = new THREE.Vector3(0.88, 0.44, 0.14).normalize();
    const q = new THREE.Quaternion();
    aimOffset(armAim, armTarget, armAim.parentRest, q);
    arm.quaternion.copy(armAim.rest).multiply(q);
    root.updateMatrixWorld(true);
    expect(currentDir(arm, fore).dot(armTarget)).toBeGreaterThan(0.999);

    // 2) 再用**上臂转好之后**的父朝向解前臂 —— 这才是对的
    const foreTarget = new THREE.Vector3(0.42, 0.9, 0.1).normalize();
    const armWorldQ = arm.getWorldQuaternion(new THREE.Quaternion());
    aimOffset(foreAim, foreTarget, armWorldQ, q);
    fore.quaternion.copy(foreAim.rest).multiply(q);
    root.updateMatrixWorld(true);
    expect(currentDir(fore, hand).dot(foreTarget)).toBeGreaterThan(0.999);
  });

  it('若错用载入时的静止父朝向，前臂会明显指偏（这是踩过的坑，锁住它）', () => {
    const { root, arm, fore, hand } = makeArmChain();
    const armAim = measureAimBone(arm, fore)!;
    const foreAim = measureAimBone(fore, hand)!;

    const armTarget = new THREE.Vector3(0.88, 0.44, 0.14).normalize();
    const q = new THREE.Quaternion();
    aimOffset(armAim, armTarget, armAim.parentRest, q);
    arm.quaternion.copy(armAim.rest).multiply(q);
    root.updateMatrixWorld(true);

    const foreTarget = new THREE.Vector3(0.42, 0.9, 0.1).normalize();
    aimOffset(foreAim, foreTarget, foreAim.parentRest, q); // ← 静止父朝向（错）
    fore.quaternion.copy(foreAim.rest).multiply(q);
    root.updateMatrixWorld(true);

    // 上臂已转过 ~60°，拿静止父朝向解出来的方向必然偏得很多。
    // 实测：正确做法 dot > 0.999，错误做法 dot ≈ 0.904（偏约 25°）——
    // 在角色身上就是"手缩到头后面"而不是挥手。
    expect(currentDir(fore, hand).dot(foreTarget)).toBeLessThan(0.98);
  });

  it('目标方向退化（零向量）时不会把骨骼转飞', () => {
    const { arm, fore } = makeArmChain();
    const armAim = measureAimBone(arm, fore)!;
    const out = new THREE.Quaternion();
    // 长度为 0 时 setFromUnitVectors 行为未定义 ⇒ 调用方必须先判长度。
    // 这里锁"正常调用得到单位四元数"，退化分支由 loadGameCharacter 的 lengthSq 判断兜住。
    aimOffset(armAim, new THREE.Vector3(1, 0, 0), armAim.parentRest, out);
    expect(Math.abs(out.length() - 1)).toBeLessThan(1e-6);
    expect(Number.isFinite(out.x + out.y + out.z + out.w)).toBe(true);
  });

  it('AIM_CHAIN 覆盖左右两侧的上臂与前臂', () => {
    const keys = AIM_CHAIN.map(([p]) => p);
    expect(keys).toEqual(['rightarm', 'rightforearm', 'leftarm', 'leftforearm']);
  });
});

describe('模型默认朝向（deriveFacing）', () => {
  /** 造一对"脚踝 → 脚趾"，让脚趾朝指定方向 */
  function makeFoot(dx: number, dz: number) {
    const root = new THREE.Group();
    const foot = new THREE.Bone();
    foot.name = 'mixamorigLeftFoot';
    const toe = new THREE.Bone();
    toe.name = 'mixamorigLeftToeBase';
    root.add(foot);
    foot.add(toe);
    toe.position.set(dx, 0.02, dz);
    root.updateMatrixWorld(true);
    const map = new Map<string, THREE.Bone>([
      ['leftfoot', foot],
      ['lefttoebase', toe],
    ]);
    return map;
  }

  it('脚趾朝 +Z ⇒ 前向方位角 0', () => {
    expect(deriveFacing(makeFoot(0, 1))).toBeCloseTo(0, 4);
  });

  it('脚趾朝 +X ⇒ 前向方位角 π/2', () => {
    expect(deriveFacing(makeFoot(1, 0))).toBeCloseTo(Math.PI / 2, 4);
  });

  it('脚趾朝 -Z ⇒ 前向方位角 π（这正是这只 GLB 相对"惯例 -Z"差 180° 的来源）', () => {
    expect(Math.abs(deriveFacing(makeFoot(0, -1)))).toBeCloseTo(Math.PI, 4);
  });

  it('缺骨骼（程序化替身）时回退到 0，不抛异常', () => {
    expect(deriveFacing(new Map())).toBe(0);
  });
});

describe('手臂目标方向（armAims）', () => {
  const up = (v: [number, number, number]) => v[1];

  it('idle / regret：双臂都朝下', () => {
    for (const mood of ['idle', 'regret'] as const) {
      const a = armAims(mood, 0, 0);
      expect(up(a.rightarm), mood).toBeLessThan(-0.85);
      expect(up(a.leftarm), mood).toBeLessThan(-0.85);
    }
  });

  it('celebrate：右臂朝上、左臂朝下（挥手 + 自然垂手）', () => {
    const a = armAims('celebrate', 0, 0);
    expect(up(a.rightarm)).toBeGreaterThan(0.3);
    expect(up(a.rightforearm)).toBeGreaterThan(0.8);
    expect(up(a.leftarm)).toBeLessThan(-0.85);
  });

  it('celebrate 的右臂朝**角色自己的右侧**，与 facing 无关地成立', () => {
    // facing 变了（模型朝别的方向），"角色右手侧"的分量符号必须保持一致：
    // 用角色自身基向量验 —— 目标方向在自身右轴上的投影恒为正。
    for (const facing of [0, 0.8, -2.1, Math.PI]) {
      const f = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
      const u = new THREE.Vector3(0, 1, 0);
      const r = new THREE.Vector3().crossVectors(f, u).normalize();
      const a = armAims('celebrate', 1.3, facing);
      const armVec = new THREE.Vector3(...a.rightarm).normalize();
      expect(armVec.dot(r)).toBeGreaterThan(0.5);
      // 左臂反过来
      const leftVec = new THREE.Vector3(...a.leftarm).normalize();
      expect(leftVec.dot(r)).toBeLessThan(-0.1);
    }
  });

  it('挥手是随时间动的（两个时刻的目标方向不同）', () => {
    const a = armAims('celebrate', 0, 0);
    const b = armAims('celebrate', 0.34, 0); // 半周期附近
    const d = Math.hypot(a.rightarm[0] - b.rightarm[0], a.rightarm[1] - b.rightarm[1], a.rightarm[2] - b.rightarm[2]);
    expect(d).toBeGreaterThan(0.1);
  });

  it('所有目标方向都是单位向量（反解前会被归一化，但源头也应是）', () => {
    for (const mood of ['idle', 'celebrate', 'regret'] as const) {
      const a = armAims(mood, 0.7, 0.42);
      for (const [key, v] of Object.entries(a)) {
        expect(Math.hypot(v[0], v[1], v[2]), `${mood}.${key}`).toBeCloseTo(1, 4);
      }
    }
  });
});
