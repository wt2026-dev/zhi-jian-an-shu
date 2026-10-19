// 「三级层级导航」源码契约守卫（EquipmentScene.tsx 第五刀，2026-10-19）。
//
// 为什么要这个文件：切层/下钻是纯交互链（点面包屑、点厂房、点分区地块），tsc 测不到
// 「引擎被喂了什么」，组件测试也只测得到初次渲染。切分成 useFacilityNavigation 之后，
// 接线断在半路的形态很具体：hook 被调用但返回值没人用（HUD 的 level 永远停在 factory）、
// buildFactory 的 effect 被挪到引擎挂载之后（厂区层永远空着）、或者 selectZone 的
// 按层分流被抹平（车间层点分区 → 镜头飞到空中乱转，就是原来那条用户报过的 bug）。
//
// 四类断言：
//   A. 接线契约：宿主把 12 个名字全部解构出来，注入的是五个来源（含转发箭头）；
//   B. 位置契约：调用点仍夹在「工单指示环同步」与「生产线开关」两条 effect 之间；
//   C. hook 内的真实推进：buildFactory → 回读分区、按层分流、切层前的清选中；
//   D. 消费端契约：HUD / WorkshopZoneNav / 面包屑 / 三级拾取 / 工单深链 各拿到什么。
import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
// 行尾必须归一：闸门把待提交的树检出一个全新 worktree，core.autocrlf=true ⇒ 检出来是 CRLF，
// 而本地工作区里我刚写的那份是 LF。多行断言不归一就会「本地全绿、闸门一条红」
// （2026-10-19 第五刀实测踩过）。单行断言不受影响，所以兄弟守卫文件没这条。
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const HOST = 'src/components/equipment3d/EquipmentScene.tsx';
const HOOK = 'src/components/equipment3d/useFacilityNavigation.ts';
const SCENE = 'src/components/equipment3d/scene.ts';

const NAV_NAMES = [
  'level',
  'setLevel',
  'activeBuilding',
  'setActiveBuilding',
  'factoryZones',
  'activeZoneId',
  'setActiveZoneId',
  'syncFactoryZones',
  'selectZone',
  'changeRankMetric',
  'drillIntoBuilding',
  'changeLevel',
];

const occurrences = (text: string, needle: string) => text.split(needle).length - 1;

describe('三级层级导航 · 切分后接线契约（防静默删功能）', () => {
  it('宿主解构出全部 12 个导航名字（少一个就是某处 UI 静默失去响应）', () => {
    const host = read(HOST);
    const callAt = host.indexOf('} = useFacilityNavigation({');
    expect(callAt, '宿主里没有 useFacilityNavigation 调用点').toBeGreaterThan(-1);
    const destructure = host.slice(host.lastIndexOf('const {', callAt), callAt);
    for (const name of NAV_NAMES) {
      expect(destructure, `解构里少了 ${name}`).toContain(`\n    ${name},`);
    }
  });

  it('注入的五样：ready + 台账算出的厂房/分区清单 + 引擎 ref + clearSelection 的转发箭头', () => {
    const host = read(HOST);
    expect(host).toContain('    ready,\n    buildingSpecs,\n    zoneSpecs,\n    sceneRef,\n    runClearSelection: () => clearSelection(),');
    // 传值而不是传转发：clearSelection 声明在调用点之后，直接传会在 render 期撞 TDZ
    expect(host).not.toContain('runClearSelection,');
  });

  it('导航状态不再由宿主自己持有（旧那 5 个 useState + levelRef 整份搬走）', () => {
    const host = read(HOST);
    for (const gone of [
      "useState<SceneLevel>('factory')",
      'const levelRef',
      'const [factoryZones',
      'const [activeZoneId',
      'hasInitializedLevelRef',
      'const changeLevel = useCallback',
      'const drillIntoBuilding = useCallback',
    ]) {
      expect(host, `宿主里还留着 ${gone}`).not.toContain(gone);
    }
  });

  it('位置契约：调用点夹在「工单指示环同步」之后、「生产线开关」与引擎挂载之前', () => {
    const host = read(HOST);
    const after = host.indexOf('sceneRef.current.setWorkOrderIndicators(deviceOrderMap);');
    const callAt = host.indexOf('} = useFacilityNavigation({');
    const beltSwitch = host.indexOf('sceneRef.current?.setProductionLineEnabled?.(lineEnabled);');
    const engineMount = host.indexOf('2. 引擎挂载');
    expect(after, '工单指示环那段不见了').toBeGreaterThan(-1);
    expect(beltSwitch, '生产线开关那段不见了').toBeGreaterThan(-1);
    expect(engineMount, '引擎挂载分节标题不见了').toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(after);
    expect(callAt).toBeLessThan(beltSwitch);
    expect(callAt).toBeLessThan(engineMount);
  });
});

describe('导航推进 · hook 内自持的真实机制', () => {
  it('厂区层：先按台账清单 buildFactory，首帧才进厂区层，建完回读分区排名', () => {
    const hook = read(HOOK);
    expect(hook).toContain('      scene.buildFactory?.(buildingSpecs, zoneSpecs);');
    expect(hook).toContain('if (!hasInitializedLevelRef.current) {');
    expect(hook).toContain('        scene.enterFactoryLevel?.();');
    expect(hook).toContain('}, [ready, buildingSpecs, zoneSpecs, level, sceneRef]);');
    // 建完之后的同步 effect 必须排在 buildFactory 之后（effect 按声明顺序跑）
    expect(hook.indexOf('scene.buildFactory?.(buildingSpecs')).toBeLessThan(
      hook.indexOf('// buildFactory 之后同步一次（分区/排名在引擎内结算）')
    );
    expect(hook).toContain('    const zs = sceneRef.current?.factoryZones?.() ?? [];');
  });

  it('selectZone 按层分流：只有厂区层才把选中动作转给引擎，其余层只筛面板', () => {
    const hook = read(HOOK);
    expect(hook).toContain('      setActiveZoneId(zoneId);');
    expect(hook).toContain(
      "      if (levelRef.current === 'factory') sceneRef.current?.selectZone?.(zoneId);"
    );
    // 层级读的是镜像 ref：把 level 放进依赖会连带重建下游 effect
    expect(hook).toContain('    levelRef.current = level;');
    expect(hook).toContain('}, [level]);');
  });

  it('换排名口径同时通知引擎与本地，并回读一次分区', () => {
    const hook = read(HOOK);
    expect(hook).toContain('      sceneRef.current?.setFactoryRankMetric?.(metric);');
    expect(hook).toContain('      setRankMetricState(metric);');
    // 三处调用：建完厂区后同步、选分区后同步、换排名口径后同步
    expect(occurrences(hook, 'syncFactoryZones();')).toBe(3);
  });

  it('下钻与切层都先清选中，再让引擎动相机，最后回写 React 侧层级', () => {
    const hook = read(HOOK);
    const drill = hook.slice(hook.indexOf('const drillIntoBuilding'), hook.indexOf('const changeLevel'));
    expect(drill).toContain('      clearSelectionRef.current();');
    expect(drill).toContain('      scene.drillIntoBuilding(buildingId);');
    expect(drill).toContain('      setActiveBuilding({ id: buildingId, name: buildingName ?? buildingId });');
    expect(drill).toContain("      setLevel('workshop');");
    expect(drill.indexOf('clearSelectionRef.current();')).toBeLessThan(
      drill.indexOf('scene.drillIntoBuilding(buildingId);')
    );
    const change = hook.slice(hook.indexOf('const changeLevel'), hook.indexOf('return {'));
    expect(change).toContain("        clearSelectionRef.current();\n        scene.enterFactoryLevel();\n        setLevel('factory');");
    expect(change).toContain("        scene.enterWorkshopLevel();\n        setLevel('workshop');");
    // 两条动作各清一次，不多不少（多了就是把选中态清坏的重复）
    expect(occurrences(hook, 'clearSelectionRef.current();')).toBe(2);
  });

  it('clearSelection 走最新值 ref：初始就是宿主首轮的实现，每轮 render 后同步', () => {
    const hook = read(HOOK);
    expect(hook).toContain('  const clearSelectionRef = useRef(runClearSelection);');
    expect(hook).toContain('    clearSelectionRef.current = runClearSelection;');
  });

  it('数据诚实性：层级与分区读数全部来自引擎/台账，不掷随机也不补数', () => {
    const hook = read(HOOK);
    expect(hook).not.toMatch(/Math\.random|Date\.now\(\)/);
    const host = read(HOST);
    // 引擎是唯一能改层级到 device 的来源（聚焦/独占由引擎内部触发）
    expect(host).toContain('    scene.onLevelChange = (lvl) => setLevel(lvl);');
  });

  it('门面只有导航用得上的那几扇门，选择链的门窗没有跟过来', () => {
    const hook = read(HOOK);
    const iface = hook.slice(hook.indexOf('export interface FacilitySceneTarget'), hook.indexOf('export interface FacilityNavigationOptions'));
    for (const door of ['buildFactory', 'enterFactoryLevel', 'enterWorkshopLevel', 'drillIntoBuilding', 'factoryZones', 'selectZone', 'setFactoryRankMetric']) {
      expect(iface, `门面里少了 ${door}`).toContain(`${door}`);
    }
    for (const leak of ['setIsolation', 'resetFocus', 'setSelected', 'setDeviceRepairPhase']) {
      expect(iface, `门面里不该有选择/维修链的 ${leak}`).not.toContain(leak);
    }
    // 引擎确实声明了这些方法（防止 hook 对着一扇不存在的门喊话）
    const scene = read(SCENE);
    for (const sig of ['  buildFactory(', '  enterFactoryLevel(', '  enterWorkshopLevel(', '  drillIntoBuilding(', '  factoryZones(', '  selectZone(', '  setFactoryRankMetric(']) {
      expect(scene, `引擎里没有 ${sig} 这扇门`).toContain(sig);
    }
  });
});

describe('消费端 · 谁拿这些返回值', () => {
  it('大屏 HUD：层级、切层、下钻、分区读数与排名口径七条线全部透传', () => {
    const host = read(HOST);
    for (const prop of [
      'level={level}',
      'onLevelChange={changeLevel}',
      'onDrillBuilding={drillIntoBuilding}',
      'factoryZones={factoryZones}',
      'activeZoneId={activeZoneId}',
      'onSelectZone={selectZone}',
      'onRankMetricChange={changeRankMetric}',
    ]) {
      expect(host, `ProductionHUD 少了 ${prop}`).toContain(prop);
    }
  });

  it('车间现场层的分区导航复用同一份 factoryZones / activeZoneId（不再各存一份）', () => {
    const host = read(HOST);
    expect(host).toContain('                  zones={factoryZones}');
    expect(host).toContain('                  activeZoneId={activeZoneId}');
    expect(host).toContain('                  onSelectZone={selectZone}');
    expect(host).toContain("            {equipments.length > 0 && level === 'workshop' ? (");
  });

  it('顶部下钻路径条：厂区层不列车间一级，车间名取 activeBuilding', () => {
    const host = read(HOST);
    expect(host).toContain("    if (level !== 'factory') {");
    expect(host).toContain("        label: activeBuilding?.name ?? '生产车间',");
    expect(host).toContain("        active: level === 'workshop',");
    expect(host).toContain("        onGo: level === 'device' ? () => changeLevel('workshop') : undefined,");
    expect(host).toContain('  }, [mapTrail, level, activeBuilding?.name, selectedEquipment, isolationId, changeLevel, exitIsolation]);');
  });

  it('三级拾取仍由宿主派发：地块命中走引擎取景、厂房命中下钻但不越权清选中', () => {
    const host = read(HOST);
    expect(host).toContain('        setActiveZoneId(hit.zoneId);');
    expect(host).toContain('        scene.selectZone?.(hit.zoneId);');
    expect(host).toContain('        scene.drillIntoBuilding(hit.buildingId);');
    expect(host).toContain('        setActiveBuilding({ id: hit.buildingId, name: hit.name });');
    expect(host).toContain('    [handlePick, clearSelection, syncFactoryZones, setActiveZoneId, setActiveBuilding]');
  });

  it('工单深链：层级不跳步 —— 先记车间并推进到车间层，再聚焦设备', () => {
    const host = read(HOST);
    const deepLink = host.slice(host.indexOf('const findAndFocus = (order: WorkOrder) => {'), host.indexOf('handlePick(eqId);'));
    expect(deepLink).toContain('      if (eq?.workshop) setActiveBuilding({ id: eq.workshop, name: eq.workshop });');
    expect(deepLink).toContain('      sceneRef.current?.enterWorkshopLevel();');
    expect(deepLink).toContain("      setLevel('workshop');");
    expect(host).toContain('  }, [ready, equipments, allOrders, initialWorkOrderId, handlePick, setActiveBuilding, setLevel]);');
  });

  it('清选中仍归宿主（导航动作通过注入的转发箭头回到这里，两条链不互相重写）', () => {
    const host = read(HOST);
    const hook = read(HOOK);
    expect(host).toContain('  const clearSelection = useCallback(');
    expect(hook).toContain('  const clearSelectionRef = useRef(runClearSelection);');
    // 宿主的 clearSelection 只在 hook 的注入点被转发一次，别处仍是原有调用
    expect(occurrences(host, '() => clearSelection()')).toBe(1);
  });
});
