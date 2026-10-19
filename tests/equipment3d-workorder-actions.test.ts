// 「维修闭环 · 场景内工单操作」源码契约守卫（EquipmentScene.tsx 第五刀，2026-10-19）。
//
// 为什么要有这个文件：这一簇是**写库**的（派单/接单/完工/验收四条 POST 链 + 3D 状态色
// 与台账联动），但它的可测面只有 RepairStepCard 的按钮，切分成 useWorkOrderActions 之后
// 一旦接线断在半路 —— hook 被调用但返回值没人用、验收不再并台账、RBAC 闸门漏在某一条链上
// —— 页面照常渲染、卡片照常点，只是"点了不推进"或"操作工也能推进"。
// 本仓库反复挨过的就是这种静默删功能，所以按链路逐条钉，不放宽任何一条。
//
// 四类断言：
//   A. 接线契约：场景把卡片状态 / 台账 setter / 引擎 ref 喂给 hook，并把动作透传给
//      RepairStepCard（该组件 props 是三条会话共用的接口面，AGENTS.md 明令不许改）。
//   B. 闸门契约：四条动作链 + 步骤勾选都过 RBAC 只读闸门，乐观锁 version 一个都不许丢。
//   C. 联动契约：接单只覆盖显示色、完工播复机动画、验收才把 running 并进 3D 自己那份台账。
//   D. 边界契约：hook 不开第五扇引擎门（不 import scene.ts），失败只写回卡片不伪造成功。
import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SCENE = 'src/components/equipment3d/EquipmentScene.tsx';
const HOOK = 'src/components/equipment3d/useWorkOrderActions.ts';
const ENGINE = 'src/components/equipment3d/scene.ts';
const CARD = 'src/components/equipment3d/RepairStepCard.tsx';

const occurrences = (src: string, needle: string) => src.split(needle).length - 1;

describe('维修闭环 · 切分后接线契约（防静默删功能）', () => {
  it('场景把卡片状态 / 台账 setter / 聚焦层底版 / 引擎 ref 喂给 hook', () => {
    const src = read(SCENE);
    expect(src).toContain('useWorkOrderActions({');
    for (const opt of [
      'activeOrderCard,',
      'readOnly3D,',
      'currentUser,',
      'sceneRef,',
      'focusDecorBaseRef,',
      'setActiveOrderCard,',
      'setRecentOrders,',
      'setRemote,',
      'contextUpdateWorkOrder,',
      'fetchWorkOrders,',
    ]) {
      expect(src, `场景不再往 hook 注入 ${opt.replace(',', '')}`).toContain(opt);
    }
  });

  it('RepairStepCard 的六个动作入口 props 一个不少（缺一个就是按钮哑了）', () => {
    const src = read(SCENE);
    expect(src).toContain('busy={orderActionBusy}');
    expect(src).toContain('actionError={orderActionError}');
    expect(src).toContain('initialCheckedCount={stepProgressRef.current.get(activeOrderCard.id) ?? 0}');
    expect(src).toContain('onDispatch={handleOrderDispatch}');
    expect(src).toContain('onClaim={handleOrderClaim}');
    expect(src).toContain('onComplete={handleOrderComplete}');
    expect(src).toContain('onAccept={handleOrderAccept}');
    expect(src).toContain('onStepProgress={handleStepProgress}');
    // 卡片侧接口面不许被这一刀顺手改动（AGENTS.md：RepairStepCard props 是三条会话共用）
    const card = read(CARD);
    for (const prop of ['onDispatch', 'onClaim', 'onComplete', 'onAccept', 'onStepProgress', 'initialCheckedCount']) {
      expect(card, `RepairStepCard 不再暴露 ${prop}`).toContain(prop);
    }
  });

  it('动作状态归 hook：场景里不再自己持 busy / error / 步骤进度', () => {
    const src = read(SCENE);
    expect(src).not.toContain('const [orderActionBusy');
    expect(src).not.toContain('const [orderActionError');
    expect(src).not.toContain('const stepProgressRef = useRef');
    expect(src).not.toContain('setOrderActionBusy');
    expect(src).not.toContain('setOrderActionError');
    // 切换选中时清报错走 hook 的口径，不留一份本地 setState
    expect(src).toContain('clearOrderActionError();');
    expect(read(HOOK)).toContain('const clearOrderActionError = useCallback');
  });

  it('顺序契约：hook 调用点排在 resetSelectionVisuals 之前', () => {
    const src = read(SCENE);
    const hookCall = src.indexOf('useWorkOrderActions({');
    const reset = src.indexOf('const resetSelectionVisuals = useCallback');
    expect(hookCall).toBeGreaterThan(-1);
    expect(reset, 'resetSelectionVisuals 不见了').toBeGreaterThan(-1);
    expect(hookCall, 'hook 调用被挪到消费点之后会撞 TDZ（依赖数组在渲染期求值）').toBeLessThan(reset);
  });
});

describe('维修闭环 · 闸门与乐观锁（每条动作链都过）', () => {
  const src = read(HOOK);

  it('RBAC 只读闸门覆盖派单/接单/完工/验收/步骤勾选五条链', () => {
    expect(occurrences(src, 'if (guardReadOnly()) return;')).toBe(5);
    expect(src).toContain("if (!readOnly3D) return false;");
    expect(src).toContain('当前角色仅可浏览 3D 场景，不能操作设备或推进工单，请切换角色');
  });

  it('写库动作一律带乐观锁 version，串行闸门 busy 时直接返回', () => {
    expect(occurrences(src, 'version: order.version')).toBe(3); // claim / complete / accept
    expect(occurrences(src, 'if (!order || orderActionBusy) return;')).toBe(4);
  });

  it('并发防重：每个动作成功与失败都收口 setOrderActionBusy(false)', () => {
    expect(occurrences(src, 'setOrderActionBusy(false);')).toBe(4);
    expect(occurrences(src, 'setOrderActionBusy(true);')).toBe(4);
  });

  it('派单不前端挑人：只用调度真实推荐，无人可派就报错不assign', () => {
    expect(src).toContain('dispatchApi.recommend(order.id)');
    expect(src).toContain('dispatchApi.assign({ workOrderId: order.id, userId: top.id })');
    expect(src).toContain("throw new Error('调度推荐未返回可用技师')");
    expect(src).not.toMatch(/Math\.random/);
  });
});

describe('维修闭环 · 台账与 3D 联动口径', () => {
  const src = read(HOOK);

  it('接单即进场：只覆盖显示色为检修中，台账 status 不动', () => {
    expect(src).toContain("sceneRef.current?.setDeviceRepairPhase(eqId, 'repairing')");
    expect(src).not.toContain("status: 'repairing'");
  });

  it('完工播复机动画、验收才转绿并台账 running（显示层与数据层的分工）', () => {
    expect(src).toContain('sceneRef.current?.playRepairRecovery(eqId)');
    expect(src).toContain("sceneRef.current?.setDeviceRepairPhase(eqId, 'operating')");
    expect(src).toContain("{ ...e, status: 'running' }");
    // 只有验收这一条链碰台账，其余三条不许顺手改数据层
    expect(occurrences(src, 'setRemote(')).toBe(1);
  });

  it('工单状态变化后刷新聚焦层五步卡片（底版来自 handlePick 缓存）', () => {
    expect(src).toContain('focusDecorBaseRef.current');
    expect(src).toContain('sceneRef.current.setFocusDecorData({');
    // 接单/完工/验收三条链刷卡片；派单只换 assignee、状态文案没变，沿用切分前的口径
    expect(occurrences(src, 'refreshFocusDecorOrder(updated)')).toBe(3);
  });

  it('步骤勾选 → 定位标逐层减淡：勾一步消一层，比例由真实步数算', () => {
    expect(src).toContain('stepProgressRef.current.set(order.id, checked)');
    expect(src).toContain('setDeviceRepairProgress(eqId, total > 0 ? checked / total : 0)');
  });

  it('统一收口四份同步：当前卡片 + 选中设备工单列表 + 全局上下文 + 指示环', () => {
    expect(occurrences(src, 'applyOrderUpdate(updated)')).toBeGreaterThanOrEqual(3);
    expect(src).toContain('contextUpdateWorkOrder?.(updated)');
    expect(src).toContain('fetchWorkOrders();');
    expect(src).toContain('setRecentOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))');
  });

  it('失败只写回卡片错误并 logger，不 console、不伪造成功', () => {
    for (const label of ['派单失败', '接单失败', '完工上报失败', '验收失败']) {
      expect(src, '少了 ' + label + ' 的收口').toContain(label + '：${msg}');
      expect(src).toContain("logger.warn('[equipment3d] 场景内" + label + ":', err)");
    }
    expect(src).not.toMatch(/console\.(log|warn|error)/);
    expect(src).toContain("inspectorName: operatorName");
    expect(src).toContain('operatorName,'); // claim / complete 的操作人同样来自登录态
  });
});

describe('维修闭环 · 钩子边界', () => {
  it('只开四扇引擎门：不把 scene.ts 的类型整个拖进来', () => {
    const src = read(HOOK);
    expect(src).not.toContain("from './scene'");
    const iface = src.slice(src.indexOf('export interface RepairSceneTarget'), src.indexOf('export interface WorkOrderActionsOptions'));
    for (const door of ['setFocusDecorData', 'setDeviceRepairPhase', 'setDeviceRepairProgress', 'playRepairRecovery']) {
      expect(iface, `门面里没有 ${door}`).toContain(`${door}(`);
    }
    expect(occurrences(iface, '(')).toBe(4);
  });

  it('门面四扇门在引擎上真的存在（引擎改名 / 删方法会在这里红）', () => {
    const engine = read(ENGINE);
    expect(engine).toContain('setFocusDecorData(data: FocusDecorData)');
    expect(engine).toContain("setDeviceRepairPhase(deviceId: string, phase: 'repairing' | 'operating')");
    expect(engine).toContain('setDeviceRepairProgress(deviceId: string, ratio: number)');
    expect(engine).toContain('playRepairRecovery(deviceId: string)');
  });

  it('卡片状态留在宿主：handlePick / clearSelection / 跨页深链仍然直接写 activeOrderCard', () => {
    const src = read(SCENE);
    expect(src).toContain('const [activeOrderCard, setActiveOrderCard] = useState<WorkOrder | null>(null);');
    expect(occurrences(src, 'setActiveOrderCard(')).toBeGreaterThanOrEqual(5);
  });
});
