// @vitest-environment jsdom
// 「拆解视图 · 故障定位高亮」回归守卫（F4）。
//
// 功能口径（诚实性为主）：
//   遥测(equipment_telemetry 真实读数)超真实阈值(statusMapping 全系统唯一阈值口径)
//   → 服务端判定严重度与发生时间 → 观察部位按关键词在真实 BOM 里子串命中
//   → 拆解页 setFaultHighlight 红色脉冲（页面原生自发光，不是宿主后处理画面）。
// 本文件的两类断言：
//   A. 数据行为：纯函数 import 真模块跑真逻辑，严禁 mock 模块本身；
//   B. 源码契约：防"静默删功能"回归 —— tsc/lint 全绿但功能消失的形态。
import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import {
  classifyMetricFault,
  resolveObservationParts,
  OBSERVATION_HINTS,
} from '../src/server/services/equipmentFaultLocatorService';
import { getCatalogForDevice } from '../src/server/services/partMatchService';
import { EXPLODED_VIEW_FILES } from '../src/components/equipment3d/explodedViewFiles';
import {
  metricToFaultType,
  severityToPriority,
  faultToCreatePrefill,
} from '../src/components/equipment3d/ExplodedFaultPanel';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const STAGE = 'src/components/equipment3d/ExplodedViewStage.tsx';
const PANEL = 'src/components/equipment3d/ExplodedFaultPanel.tsx';
const SERVICE = 'src/server/services/equipmentFaultLocatorService.ts';
const CONTROLLER = 'src/server/controllers/explodedViewController.ts';
const ROUTES = 'src/server/routes/explodedView.ts';
const SCENE = 'src/components/equipment3d/EquipmentScene.tsx';
const WORKORDERS = 'src/components/WorkOrdersView.tsx';
const APP = 'src/App.tsx';
const SHELL = 'src/components/equipment3d/DrilldownShell.tsx';

describe('故障定位 · 遥测判定（真实阈值口径，复用 3D 场景同一份）', () => {
  it('最新读数超过 fault 阈值 → severity=fault，occurredAt=窗口内首次达到该级的采样', () => {
    const hit = classifyMetricFault('vibration', [
      { fullTime: '2026-10-17T00:00:00Z', vibration: 5.0 },
      { fullTime: '2026-10-17T01:00:00Z', vibration: 7.4 },
      { fullTime: '2026-10-17T02:00:00Z', vibration: 8.6 },
    ]);
    expect(hit).not.toBeNull();
    expect(hit!.severity).toBe('fault'); // 7.0 ≤ 8.6 < 10（critical 阈值）
    expect(hit!.value).toBe(8.6);
    expect(hit!.warningThreshold).toBe(4.5);
    expect(hit!.occurredAt).toBe('2026-10-17T01:00:00Z'); // 首次达到 fault 级的时间
  });

  it('critical 阈值命中 → critical；正常读数 → null（不产出无告警的故障条目）', () => {
    const critical = classifyMetricFault('vibration', [{ fullTime: 't1', vibration: 11.2 }]);
    expect(critical!.severity).toBe('critical');
    expect(critical!.occurredAt).toBe('t1');
    expect(classifyMetricFault('vibration', [{ vibration: 3.1 }])).toBeNull();
    expect(classifyMetricFault('temperature', [{ temperature: 82 }])).not.toBeNull();
    expect(classifyMetricFault('temperature', [{ temperature: 79 }])).toBeNull();
  });

  it('缺测值(null/NaN)不参与判定，也不被当 0；窗口全缺测 → 无故障条目', () => {
    expect(classifyMetricFault('loadRate', [{ loadRate: null }, { loadRate: Number.NaN }])).toBeNull();
    // null 缺测之后仍有更早读数：用"最后一个非缺测读数"判定（getHistoryInWindow 顺序语义）
    const hit = classifyMetricFault('loadRate', [{ loadRate: 90 }, { loadRate: null }]);
    expect(hit!.value).toBe(90);
  });
});

describe('故障定位 · 观察部位对齐（只认真实 BOM，不编位号）', () => {
  it('映射表只覆盖有拆解视图的 10 台设备', () => {
    expect(Object.keys(OBSERVATION_HINTS).sort()).toEqual(Object.keys(EXPLODED_VIEW_FILES).sort());
  });

  it('hint 关键词命中的位号必须真的在该设备拆解页 BOM 目录里，且 matchedBy 可解释', () => {
    for (const [deviceId, byMetric] of Object.entries(OBSERVATION_HINTS)) {
      for (const metric of Object.keys(byMetric) as Array<keyof typeof byMetric>) {
        const keywords = byMetric[metric]!;
        const parts = resolveObservationParts(deviceId, keywords);
        expect(parts.length, `${deviceId}·${metric} 应至少命中一处真实零件`).toBeGreaterThan(0);
        for (const part of parts) {
          const inCatalog = getCatalogForDevice(deviceId).some((p) => p.posNo === part.posNo);
          expect(inCatalog, `${part.posNo} 不在 ${deviceId} 的真实 BOM 里（编造位号）`).toBe(true);
          const usedKeyword = keywords.find((kw) => part.name.includes(kw));
          expect(usedKeyword).toBeTruthy();
          expect(part.matchedBy).toEqual([usedKeyword]);
        }
      }
    }
  });

  it('种子中的三台超标设备（eq-103 critical / eq-107 warning / eq-112 fault）每个指标都有可高亮部位', () => {
    for (const deviceId of ['eq-103', 'eq-107', 'eq-112']) {
      const hints = OBSERVATION_HINTS[deviceId];
      expect(hints, `${deviceId} 缺观察部位映射`).toBeTruthy();
      for (const metric of ['temperature', 'vibration', 'loadRate'] as const) {
        expect(resolveObservationParts(deviceId, hints![metric]!).length, `${deviceId}·${metric}`).toBeGreaterThan(0);
      }
    }
  });

  it('无拆解视图的设备不在映射表里（resolve 返回空 = 如实"未定位"，不硬造）', () => {
    expect(OBSERVATION_HINTS['eq-101']).toBeUndefined();
    expect(resolveObservationParts('eq-101', ['轴承'])).toEqual([]);
  });
});

describe('故障定位 · 建单预填（字段全部可溯源到真实遥测与真实阈值）', () => {
  const fault = {
    deviceId: 'eq-112',
    deviceName: '12# 连铸结晶器冷却循环泵',
    deviceCode: '12#',
    explodedViewFile: 'cooling_pump_exploded_v3.html',
    faults: [
      {
        metric: 'vibration',
        metricLabel: '设备振动',
        value: 8.6,
        unit: 'mm/s',
        warningThreshold: 4.5,
        severity: 'fault',
        occurredAt: '2026-10-16T22:00:00.000Z',
        observationParts: [{ posNo: 'B10', name: '轴承箱悬架体', matchedBy: ['轴承箱悬架体'] }],
        suggestion: '建议按频谱测点复核振值来源。',
      },
    ],
    latestSampleAt: '2026-10-17T08:00:00.000Z',
    dataNote: '故障由设备遥测真实读数与报警阈值判定。',
  };

  it('指标 → 建单 6 宫格分类 / 严重度 → 优先级的口径映射', () => {
    expect(metricToFaultType('vibration')).toBe('机械振动');
    expect(metricToFaultType('temperature')).toBe('轴承过热');
    expect(severityToPriority('critical')).toBe('urgent');
    expect(severityToPriority('fault')).toBe('high');
    expect(severityToPriority('warning')).toBe('medium');
  });

  it('faultToCreatePrefill：设备/标题/类型/优先级/描述直承真实诊断，不含编造结论', () => {
    const prefill = faultToCreatePrefill(fault as never, fault.faults[0] as never);
    expect(prefill.equipmentId).toBe('eq-112');
    expect(prefill.title).toContain('12# 连铸结晶器冷却循环泵');
    expect(prefill.title).toContain('8.6mm/s');
    expect(prefill.faultType).toBe('机械振动');
    expect(prefill.priority).toBe('high');
    expect(prefill.description).toContain('8.6mm/s');
    expect(prefill.description).toContain('轴承箱悬架体（B10）');
    expect(prefill.description).toContain('建议按频谱测点复核振值来源');
    expect(prefill.description).toContain('真实读数与报警阈值判定');
  });
});

describe('故障定位 · 源码契约（防静默删功能）', () => {
  it('服务端只读真实遥测窗口，且阈值与 3D 场景共用同一份（statusMapping 导出）', () => {
    const svc = read(SERVICE);
    expect(svc).toContain('getHistoryInWindow'); // 真实 DB 时序窗口
    expect(svc).toContain('statusMapping'); // 阈值单一口径
    expect(svc).toContain('getCatalogForDevice'); // 观察部位 = 真实 BOM 成员
    expect(svc).toContain('OBSERVATION_HINTS'); // 关键词映射表
  });

  it('HTTP 链路：/equipments/:id/fault-diagnostics 注册在 controller + 路由（/api/v1 与 /api 双份）', () => {
    expect(read(CONTROLLER)).toContain('handleGetDeviceFaultDiagnostics');
    const routes = read(ROUTES);
    expect(routes).toContain('/api/v1/equipments/:deviceId/fault-diagnostics');
    expect(routes).toContain('/api/equipments/:deviceId/fault-diagnostics');
    expect(read('src/api/index.ts')).toContain('getFaultDiagnostics');
  });

  it('10 份拆解页都有页面原生 setFaultHighlight + 红色脉动 + 行高亮 CSS（页面自己改自发光）', () => {
    for (const file of Object.values(EXPLODED_VIEW_FILES)) {
      const src = read(`public/exploded/${file}`);
      expect(src, `${file} 缺 setFaultHighlight 入口`).toContain('function setFaultHighlight');
      expect(src, `${file} 缺红色自发光脉动`).toContain('0xef4444');
      expect(src, `${file} 缺 faultRowPulse 行高亮动画`).toContain('faultRowPulse');
    }
  });

  it('舞台：拉取诊断 → 侧边故障面板 + 宿主经页面原生 setFaultHighlight 下发脉冲', () => {
    const stage = read(STAGE);
    expect(stage).toContain("from './ExplodedFaultPanel'");
    expect(stage).toContain('<ExplodedFaultPanel');
    expect(stage).toContain('setFaultHighlight'); // 页面原生 API 注入
    expect(stage).toContain('faultInfo');
    expect(stage).toContain('onOpenWorkOrderCreate');
    // 宿主绝不自己模拟 3D 画面（红色脉冲只能来自页面原生逻辑）
    expect(stage).not.toContain('0xef4444');
  });

  it('场景：拆解设备驱动诊断拉取 + 建单回调贯通 DrilldownShell 与 App', () => {
    const scene = read(SCENE);
    expect(scene).toContain('getFaultDiagnostics');
    expect(scene).toContain('faultInfo={explodedFaultInfo}');
    expect(scene).toContain('handleCreateWorkOrderFromFault');
    const shell = read(SHELL);
    expect(shell).toContain('onNavigateToWorkOrderCreate');
    const appAndDispatcher = read(APP) + (fs.existsSync(path.join(ROOT, 'src/components/layout/AppViewDispatcher.tsx')) ? read('src/components/layout/AppViewDispatcher.tsx') : '');
    expect(appAndDispatcher).toContain('initialCreatePrefill={workOrderCreatePrefill}');
  });

  it('工单页：预填进建单表单并消费（App 状态清空 + sessionStorage 清除），无权限不弹窗', () => {
    const src = read(WORKORDERS);
    expect(src).toContain('initialCreatePrefill');
    expect(src).toContain('appliedCreatePrefillRef');
    expect(src).toContain("sessionStorage.getItem('wo-create-prefill')");
    expect(src).toContain("sessionStorage.removeItem('wo-create-prefill')");
    expect(src).toContain('onCreatePrefillConsumed?.()');
    expect(src).toContain('if (canCreate) {');
  });

  it('面板契约：描述 / 发生时间 / 严重程度 / 建议处理方式 / 建单按钮的 testid 齐全', () => {
    const panel = read(PANEL);
    expect(panel).toContain('data-testid="equipment3d-exploded-fault-panel"');
    expect(panel).toContain('equipment3d-exploded-fault-metric-');
    expect(panel).toContain('equipment3d-exploded-fault-time-');
    expect(panel).toContain('equipment3d-exploded-fault-part-');
    expect(panel).toContain('equipment3d-exploded-fault-suggestion-');
    expect(panel).toContain('equipment3d-exploded-fault-create-');
    expect(panel).toContain('equipment3d-exploded-fault-none'); // 无活动故障的如实提示
    expect(panel).toContain('dataNote'); // 数据诚实性说明位
  });
});
