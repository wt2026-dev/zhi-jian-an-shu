/**
 * 聚焦层的「派工指引虚线」必须与技师人形/轨迹分开成层。
 *
 * 背景（本次可视化层收敛需求）：既有口径是"进详情层就整体隐藏 workerGroup"——
 * 技师人形与历史轨迹属于车间层信息，画面里只剩一台设备时它们只会添乱（该口径有
 * equipment3d-focus.test.ts 守护）。但需求同时要求「选中哪台设备，就看它相关的
 * 那条链路」，也就是这条虚线要在聚焦层保留。
 *
 * 这两件事无法同时满足，除非虚线单独成层 —— 本文件把这个分界钉死：
 *   workers.group（人形 + 轨迹）跟随总开关且在聚焦层隐藏；
 *   workers.guideGroup（虚线）在聚焦层保留。
 * （分层 2026-10-19 起由 workerFlow.ts 模块自持，scene 只留委托。）
 *
 * 用精简实例（Object.create(prototype)）而不是真渲染器：这里验的是分层与显隐口径，
 * 不是取景/渲染，避免把 WebGL 依赖拖进单测。
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EquipmentScene } from '../src/components/equipment3d/scene';
import { WorkerFlow } from '../src/components/equipment3d/workerFlow';

const TECH = { id: 'u-1', name: '张伟', onlineStatus: 'online' as const, mapX: 1, mapY: 2 };

function harness() {
  const s = Object.create(EquipmentScene.prototype) as any;
  Object.assign(s, {
    // buildWorkers 只依赖这五样：地面高度、设备索引、槽位、坐标映射、动线模块
    hall: { reliefAt: () => 0 },
    equipment: { indexById: new Map([['eq-105', 0]]) },
    slots: [{ x: 4, y: 0, z: 6, angle: 0, radius: 1.2 }],
    mapScaleX: 1, mapScaleZ: 1, mapOffsetX: 0, mapOffsetZ: 0,
    isolationId: null,
    isolationVisibility: new Map(),
    workers: new WorkerFlow(),
  });
  return s;
}

const guideLineOf = (s: any): THREE.Line | null => {
  const line = s.workers.guideGroup.children.find((o: THREE.Object3D) => /^guide:/.test(o.name));
  return (line as THREE.Line) ?? null;
};

describe('聚焦层：派工指引虚线独立成层', () => {
  it('选中设备时虚线画在 guideGroup 上，且不在 workerGroup 里', () => {
    const s = harness();
    s.isolationId = 'eq-105'; // 模拟已进入单设备聚焦层
    s.buildWorkers([TECH], new Map(), 'eq-105', 'u-1', 'dispatched');

    expect(s.workers.group.children.length).toBe(1); // 只有技师人形
    expect(s.workers.guideGroup.children.length).toBe(1); // 虚线单独一层
    const line = guideLineOf(s);
    expect(line).not.toBeNull();
    expect(line!.name).toBe('guide:u-1');
    // 必须是虚线（LineDashedMaterial），不是实线 —— 图例里"蓝色虚线 = 派工指引"
    const mat = line!.material as THREE.LineDashedMaterial;
    expect(mat.dashSize).toBeGreaterThan(0);
    expect(mat.color.getHex()).toBe(0x3b82f6); // 未完成工单 → 蓝色
  });

  it('总开关关掉时：人形/轨迹隐藏，虚线在聚焦层保留；退出聚焦后虚线才消失', () => {
    const s = harness();
    s.isolationId = 'eq-105';
    s.buildWorkers([TECH], new Map(), 'eq-105', 'u-1', 'dispatched');

    // 注意：聚焦层掩蔽人形**不是 buildWorkers 干的**（它只负责建），而是
    // setIsolation → applyIsolationChrome(true) 干的。setWorkerVisible 走
    // setChromeVisible：隔离中就把"请求的可见性"记进 isolationVisibility、
    // 同时把 group 掩掉，退出聚焦时按记录恢复 —— 所以这里断言的是"记录 + 掩蔽"。
    s.setWorkerVisible(true);
    expect(s.isolationVisibility.get(s.workers.group)).toBe(true);
    expect(s.workers.group.visible).toBe(false);
    // 但虚线要留下：这正是"选中设备即看见相关链路"
    expect(s.workers.guideGroup.visible).toBe(true);

    // 退出聚焦层（车间层没有选中设备）→ 虚线随之消失
    s.isolationId = null;
    s.setWorkerVisible(false);
    expect(s.workers.guideGroup.visible).toBe(false);
    expect(s.workers.group.visible).toBe(false);

    // 车间层打开总开关 → 虚线层恢复可见（有设备被派工时才有内容）
    s.setWorkerVisible(true);
    expect(s.workers.guideGroup.visible).toBe(true);
    expect(s.workers.group.visible).toBe(true);
  });

  it('清空人员动线时虚线一并销毁，不留悬挂的线', () => {
    const s = harness();
    s.isolationId = 'eq-105';
    s.buildWorkers([TECH], new Map(), 'eq-105', 'u-1', 'dispatched');
    expect(s.workers.guideGroup.children.length).toBe(1);

    s.clearWorkers();
    expect(s.workers.guideGroup.children.length).toBe(0);
    expect(s.workers.group.children.length).toBe(0);
    expect((s.workers as any).guideLine).toBeNull();
    expect((s.workers as any).guideTargetId).toBeNull();
  });

  it('工单已完成时虚线转绿（图例口径：绿色 = 已恢复/已完成）', () => {
    const s = harness();
    s.isolationId = 'eq-105';
    s.buildWorkers([TECH], new Map(), 'eq-105', 'u-1', 'completed');
    const mat = guideLineOf(s)!.material as THREE.LineDashedMaterial;
    expect(mat.color.getHex()).toBe(0x22c55e);
  });
});
