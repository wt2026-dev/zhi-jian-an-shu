// @vitest-environment jsdom
// 「拆解视图 · 零件寿命预警」回归守卫（F5）。
//
// 功能口径（诚实性为主）：
//   真实零件更换记录（完工单 repair_log.parts_used 命中位号名）× 真实运行时钟
//   （上次更换 / 设备 install_date 起算，无运行小时计按时钟小时×运行系数如实折算）
//   → 预期寿命（优先 ≥2 次真实换次间隔均值，其次可调配置） → 正常/临近寿命/需更换，
//   临近零件黄色、到期零件暗红（拆解页原生 setLifeAlert 高亮）+ 保养建议建单预填。
// 两类断言：
//   A. 数据行为：纯函数 import 真模块跑真逻辑，严禁 mock 模块本身；
//   B. 源码契约：防"静默删功能"回归 —— tsc/lint 全绿但功能消失的形态。
import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import {
  computePartLife,
  matchLifeRule,
  findReplacedInOrder,
} from '../src/server/services/partLifeService';
import {
  DEFAULT_LIFE_RULES,
  getPartLifeRules,
  getPartLifeWarnFraction,
  getPartLifeRuntimeFactor,
  getPartLifeSchedulingHeadroomDays,
} from '../src/server/config/partLifeConfig';
import { partLifeToCreatePrefill, PART_LIFE_STATUS_META } from '../src/components/equipment3d/ExplodedPartLifePanel';
import type { ExplodedPartLifeDiagnostics } from '../src/api';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SERVICE = 'src/server/services/partLifeService.ts';
const REPO = 'src/db/repositories/partHistoryRepository.ts';
const CONTROLLER = 'src/server/controllers/explodedViewController.ts';
const ROUTES = 'src/server/routes/explodedView.ts';
const CONFIG = 'src/server/config/partLifeConfig.ts';
const PANEL = 'src/components/equipment3d/ExplodedPartLifePanel.tsx';
const STAGE = 'src/components/equipment3d/ExplodedViewStage.tsx';
const SCENE = 'src/components/equipment3d/EquipmentScene.tsx';
import { EXPLODED_VIEW_FILES } from '../src/components/equipment3d/explodedViewFiles';

const HOUR = 3_600_000;

/* ------------------------------------------------------------------ */
/* A1. 配置可调（环境变量集口径）                                       */
/* ------------------------------------------------------------------ */
describe('寿命配置 · 默认值与环境变量覆盖', () => {
  it('默认口径：临近判定线 20% / 运行系数 1.0（连续运行如实折算）/ 排程提前量 14 天', () => {
    expect(getPartLifeWarnFraction()).toBe(0.2);
    expect(getPartLifeRuntimeFactor()).toBe(1.0);
    expect(getPartLifeSchedulingHeadroomDays()).toBe(14);
    expect(DEFAULT_LIFE_RULES.length).toBeGreaterThan(3);
  });

  it('PART_LIFE_WARN_FRACTION / RUNTIME_FACTOR / HEADROOM 都可覆盖（含越界回落）', () => {
    const env = process.env;
    try {
      env.PART_LIFE_WARN_FRACTION = '0.35';
      expect(getPartLifeWarnFraction()).toBe(0.35);
      env.PART_LIFE_WARN_FRACTION = '1.5'; // 越界 → 回落默认
      expect(getPartLifeWarnFraction()).toBe(0.2);
      env.PART_LIFE_RUNTIME_FACTOR = '0.6';
      expect(getPartLifeRuntimeFactor()).toBe(0.6);
      env.PART_LIFE_RUNTIME_FACTOR = 'abc';
      expect(getPartLifeRuntimeFactor()).toBe(1.0);
      env.PART_LIFE_SCHEDULING_HEADROOM_DAYS = '7';
      expect(getPartLifeSchedulingHeadroomDays()).toBe(7);
    } finally {
      for (const k of ['PART_LIFE_WARN_FRACTION', 'PART_LIFE_RUNTIME_FACTOR', 'PART_LIFE_SCHEDULING_HEADROOM_DAYS']) delete env[k];
    }
  });

  it('PART_LIFE_RULES_JSON 整体覆盖；非法 JSON / 空数组回落内置默认（配置错误不打翻接口）', () => {
    const env = process.env;
    try {
      env.PART_LIFE_RULES_JSON = JSON.stringify([{ keywords: ['特制试件'], expectedLifeHours: 1234, label: '自定义规则' }]);
      const rules = getPartLifeRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].label).toBe('自定义规则');
      env.PART_LIFE_RULES_JSON = '{无效';
      expect(getPartLifeRules()).toBe(DEFAULT_LIFE_RULES);
      env.PART_LIFE_RULES_JSON = '[]';
      expect(getPartLifeRules()).toBe(DEFAULT_LIFE_RULES);
      env.PART_LIFE_RULES_JSON = '[{"keywords":["ok"],"expectedLifeHours":-5},{"keywords":["合格件"],"expectedLifeHours":100}]';
      const cleaned = getPartLifeRules();
      expect(cleaned).toHaveLength(1);
      expect(cleaned[0].keywords).toEqual(['合格件']);
    } finally {
      delete env.PART_LIFE_RULES_JSON;
    }
  });
});

/* ------------------------------------------------------------------ */
/* A2. 规则匹配与更换记录归属（真实 BOM 名称口径）                       */
/* ------------------------------------------------------------------ */
describe('寿命规则匹配 · 关键词先命中先赢', () => {
  it('机械密封/轴承/滤芯命中对应规则；无关零件如实返回 null（不硬配寿命）', () => {
    expect(matchLifeRule(DEFAULT_LIFE_RULES, { name: '集装式机械密封' })?.label).toContain('机械密封');
    expect(matchLifeRule(DEFAULT_LIFE_RULES, { name: '圆柱滚子轴承' })?.label).toContain('滚动轴承');
    expect(matchLifeRule(DEFAULT_LIFE_RULES, { name: '重型重载空气滤芯' })?.label).toContain('滤芯');
    expect(matchLifeRule(DEFAULT_LIFE_RULES, { name: '不明结构件' })).toBeNull();
  });

  it('完工单耗用备件 → 位号归属（归一化互含，与 partHistoryService 同口径）', () => {
    const tokens = ['机械密封', '集装式机械密封bur', 'BURGMANN-M7N/65'];
    expect(findReplacedInOrder([{ name: '集装式机械密封 (BURGMANN-M7N/65)' }], tokens)).not.toBeNull();
    expect(findReplacedInOrder([{ name: '完全无关的零件' }], tokens)).toBeNull();
    expect(findReplacedInOrder([], tokens)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* A3. 寿命计算核心（纯函数）                                           */
/* ------------------------------------------------------------------ */
describe('寿命计算 · 真实时钟 × 更换记录', () => {
  const NOW = Date.parse('2026-10-17T12:00:00Z');

  it('上次真实更换为基线：已用 = 日历时钟×系数；预期来自配置 → basis=config-threshold', () => {
    const r = computePartLife({
      now: NOW,
      runtimeFactor: 1.0,
      warnFraction: 0.2,
      installedMs: NOW - 800 * 24 * HOUR, // 设备投运很久，但上月刚真实更换
      lastReplacedMs: NOW - 20 * 24 * HOUR,
      realAvgLifeHours: null,
      configLifeHours: 1000, // 已用 480h → 剩余 520h = 52%
    });
    expect(r.basis).toBe('config-threshold');
    expect(r.status).toBe('healthy');
    expect(r.usedHours).toBeCloseTo(480, 0);
    expect(r.remainingPct).toBe(52);
    expect(r.usedSinceMs).toBe(NOW - 20 * 24 * HOUR);
    // 推算用尽时间 = now + remaining/系数
    expect(r.dueAtMs).toBe(Math.round(NOW + (1000 - 480) * HOUR));
  });

  it('≥2 次真实换次间隔均值优先于配置阈值 → basis=real-replacement-intervals', () => {
    const r = computePartLife({
      now: NOW,
      runtimeFactor: 1.0,
      warnFraction: 0.2,
      installedMs: null,
      lastReplacedMs: NOW - 100 * HOUR,
      realAvgLifeHours: 500, // 真实实测寿命，不等同于任何配置
      configLifeHours: 4000,
    });
    expect(r.expectedLifeHours).toBe(500);
    expect(r.basis).toBe('real-replacement-intervals');
    expect(r.remainingPct).toBe(80);
  });

  it('运行系数按比例折算已用小时（系数可调口径不虚标）', () => {
    const r = computePartLife({
      now: NOW,
      runtimeFactor: 0.5, // 间歇运行
      warnFraction: 0.2,
      installedMs: NOW - 1000 * HOUR,
      lastReplacedMs: null,
      realAvgLifeHours: null,
      configLifeHours: 1000,
    });
    expect(r.usedHours).toBeCloseTo(500, 0); // 1000 时钟小时 × 0.5
    expect(r.remainingPct).toBe(50);
  });

  it('无基线（从未更换且无 install_date）/ 无寿命口径 → 如实 unknown，不编数额', () => {
    const noBase = computePartLife({ now: NOW, runtimeFactor: 1, warnFraction: 0.2, installedMs: null, lastReplacedMs: null, realAvgLifeHours: null, configLifeHours: 500 });
    expect(noBase.status).toBe('unknown');
    expect(noBase.usedHours).toBeNull();
    expect(noBase.basis).toBe('missing');
    const noRule = computePartLife({ now: NOW, runtimeFactor: 1, warnFraction: 0.2, installedMs: NOW - 10 * HOUR, lastReplacedMs: null, realAvgLifeHours: null, configLifeHours: null });
    expect(noRule.status).toBe('unknown');
    expect(noRule.expectedLifeHours).toBeNull();
  });

  it('健康分级：耗尽 → replace（pct=0、dueAt=null）；落入判定线 → nearing；未来基线（坏钟）→ unknown', () => {
    const spent = computePartLife({ now: NOW, runtimeFactor: 1, warnFraction: 0.2, installedMs: NOW - 2000 * HOUR, lastReplacedMs: null, realAvgLifeHours: null, configLifeHours: 1000 });
    expect(spent.status).toBe('replace');
    expect(spent.remainingPct).toBe(0);
    expect(spent.dueAtMs).toBeNull();
    const nearing = computePartLife({ now: NOW, runtimeFactor: 1, warnFraction: 0.2, installedMs: NOW - 900 * HOUR, lastReplacedMs: null, realAvgLifeHours: null, configLifeHours: 1000 });
    expect(nearing.status).toBe('nearing');
    const badClock = computePartLife({ now: NOW, runtimeFactor: 1, warnFraction: 0.2, installedMs: NOW + 10 * HOUR, lastReplacedMs: null, realAvgLifeHours: null, configLifeHours: 1000 });
    expect(badClock.status).toBe('unknown');
  });
});

/* ------------------------------------------------------------------ */
/* A4. 保养建单预填（真实诊断 → 定期润滑维保工单）                       */
/* ------------------------------------------------------------------ */
describe('保养建议 · 建单预填链路', () => {
  const lifeFixture: ExplodedPartLifeDiagnostics = {
    deviceId: 'eq-112',
    deviceName: '12# 连铸结晶器冷却循环泵',
    deviceCode: '12#',
    explodedViewFile: 'cooling_pump_exploded_v3.html',
    generatedAt: '2026-10-17T12:00:00.000Z',
    runtimeFactor: 1,
    warnFraction: 0.2,
    parts: [
      { posNo: 'B10', name: '圆柱滚子', expectedLifeHours: 20000, usedHours: 21000, remainingHours: -1000, remainingPct: 0, status: 'replace', basis: 'config-threshold', lifeRuleLabel: '滚动轴承厂家寿命口径', lastReplacedAt: null, usedSince: '2021-06-01T00:00:00Z', dueAt: null },
      { posNo: 'B11', name: '轴承箱悬架体', expectedLifeHours: 20000, usedHours: 18000, remainingHours: 2000, remainingPct: 10, status: 'nearing', basis: 'real-replacement-intervals', lifeRuleLabel: '滚动轴承厂家寿命口径', lastReplacedAt: '2025-05-01T00:00:00Z', usedSince: '2025-05-01T00:00:00Z', dueAt: '2026-11-01T00:00:00Z' },
      { posNo: 'P20', name: '闭式离心叶轮', expectedLifeHours: 60000, usedHours: 9900, remainingHours: 50100, remainingPct: 84, status: 'healthy', basis: 'config-threshold', lifeRuleLabel: '叶轮主检修周期', lastReplacedAt: null, usedSince: null, dueAt: null },
    ],
    summary: { replaceCount: 1, nearingCount: 1, healthyCount: 1, unknownCount: 0 },
    suggestedMaintenanceBefore: '2026-10-18T00:00:00.000Z',
    dataNote: '寿命口径如实说明（测试样例）。',
  };

  it('预填类型用既有枚举「定期润滑维保」；有需更换 → 优先级 high；描述带位号/剩余%/建议时间/口径说明', () => {
    const prefill = partLifeToCreatePrefill(lifeFixture);
    expect(prefill.equipmentId).toBe('eq-112');
    expect(prefill.faultType).toBe('定期润滑维保');
    expect(prefill.priority).toBe('high');
    expect(prefill.title).toContain('12# 连铸结晶器冷却循环泵');
    expect(prefill.description).toContain('需更换 1 个 · 临近寿命 1 个');
    expect(prefill.description).toContain('圆柱滚子');
    expect(prefill.description).toContain('轴承箱悬架体');
    expect(prefill.description).toContain('建议保养时间');
    expect(prefill.description).toContain('数据说明');
  });

  it('只有临近寿命（无需更换）→ 优先级 medium；状态标签四档齐全', () => {
    const onlyNearing: ExplodedPartLifeDiagnostics = {
      ...lifeFixture,
      summary: { replaceCount: 0, nearingCount: 1, healthyCount: 1, unknownCount: 0 },
    };
    expect(partLifeToCreatePrefill(onlyNearing).priority).toBe('medium');
    expect(PART_LIFE_STATUS_META.replace.label).toBe('需更换');
    expect(PART_LIFE_STATUS_META.nearing.label).toBe('临近寿命');
    expect(PART_LIFE_STATUS_META.healthy.label).toBe('正常');
    expect(PART_LIFE_STATUS_META.unknown.label).toBe('暂无口径');
  });
});

/* ------------------------------------------------------------------ */
/* B. 源码契约（防静默删功能）                                           */
/* ------------------------------------------------------------------ */
describe('零件寿命预警 · 源码契约', () => {
  it('配置模块：全部阈值集中在 config（内置导出 + 环境变量 getter），注释声明真实折算口径', () => {
    const src = read(CONFIG);
    expect(src).toContain('PART_LIFE_RULES_JSON');
    expect(src).toContain('PART_LIFE_WARN_FRACTION');
    expect(src).toContain('PART_LIFE_RUNTIME_FACTOR');
    expect(src).toContain('getPartLifeSchedulingHeadroomDays');
  });

  it('服务端：真实完工单查询 + 位号归属 + 缺数据如实 unknown（不编造）', () => {
    const repo = read(REPO);
    expect(repo).toContain('getCompletedOrdersForEquipment');
    expect(repo).toContain("status = 'completed'"); // 只有真实完工单才计作更换
    const svc = read(SERVICE);
    expect(svc).toContain('getCompletedOrdersForEquipment');
    expect(svc).toContain('getCatalogForDevice'); // 位号必须来自真实 BOM
    expect(svc).toContain('EQUIPMENT_NOT_FOUND');
    expect(svc).toContain("status: 'unknown'");
    expect(svc).toContain('运行系数'); // dataNote 披露折算口径
  });

  it('HTTP 链路：/equipments/:id/part-life-diagnostics 双前缀注册 + api 客户端方法', () => {
    expect(read(CONTROLLER)).toContain('handleGetDevicePartLifeDiagnostics');
    const routes = read(ROUTES);
    expect(routes).toContain('/api/v1/equipments/:deviceId/part-life-diagnostics');
    expect(routes).toContain('/api/equipments/:deviceId/part-life-diagnostics');
    expect(read('src/api/index.ts')).toContain('getPartLifeDiagnostics');
  });

  it('10 份拆解页都有页面原生 setLifeAlert + 黄/暗红两档 + BOM 行 CSS（3D 颜色由页面自己渲染）', () => {
    for (const file of Object.values(EXPLODED_VIEW_FILES)) {
      const src = read(`public/exploded/${file}`);
      expect(src, `${file} 缺 setLifeAlert 入口`).toContain('function setLifeAlert');
      expect(src, `${file} 缺黄色（临近寿命）`).toContain('0xeab308');
      expect(src, `${file} 缺暗红（需更换）`).toContain('0xdc2626');
      expect(src, `${file} 缺寿命行 CSS`).toContain('lifeRowWarn');
      expect(src, `${file} 缺需更换行 CSS`).toContain('lifeRowReplace');
      // 优先级保证：寿命块在故障块之前赋值 → 故障红脉冲不被寿命色覆盖
      expect(src.indexOf('lifeAlertMap[part.id]')).toBeLessThan(src.indexOf('faultHighlightPartId === '));
    }
  });

  it('舞台：拉取寿命诊断 → 侧边寿命面板 + 宿主经页面原生 setLifeAlert 批量下发', () => {
    const stage = read(STAGE);
    expect(stage).toContain("from './ExplodedPartLifePanel'");
    expect(stage).toContain('<ExplodedPartLifePanel');
    expect(stage).toContain("win?.['setLifeAlert']"); // 批量下发入口
    expect(stage).toContain("p.status === 'nearing' || p.status === 'replace'"); // 只高亮预警零件
    expect(stage).toContain('life={lifeInfo}'); // 诊断数据透传给面板
    expect(stage).toContain('onCreateMaintenanceWorkOrder={onOpenWorkOrderCreate}'); // 建单走既有 App 深链
  });

  it('场景：拆解设备驱动寿命拉取（与故障诊断并列）并透传给舞台', () => {
    const scene = read(SCENE);
    expect(scene).toContain('getPartLifeDiagnostics');
    expect(scene).toContain('lifeInfo={explodedLifeInfo}');
  });

  it('面板契约：汇总 / 建议保养时间 / 四要素卡（预计·已用·剩余%·状态）/ 生成保养建议按钮 testid 齐全', () => {
    const panel = read(PANEL);
    expect(panel).toContain('data-testid="equipment3d-exploded-life-panel"');
    expect(panel).toContain('equipment3d-exploded-life-summary');
    expect(panel).toContain('equipment3d-exploded-life-schedule');
    expect(panel).toContain('equipment3d-exploded-life-metric-');
    expect(panel).toContain('equipment3d-exploded-life-status-');
    expect(panel).toContain('equipment3d-exploded-life-create');
    expect(panel).toContain('equipment3d-exploded-life-note'); // 数据诚实性说明位
    expect(panel).toContain('定期润滑维保'); // 保养工单类型枚举值
  });
});
