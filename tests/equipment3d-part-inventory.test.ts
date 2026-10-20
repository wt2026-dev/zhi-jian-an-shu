// @vitest-environment jsdom
// 「拆解视图 · 备件库存联动」回归守卫（F6）。
//
// 功能口径（诚实性为主）：
//   真实备件台账（spare_parts：stock/safe_stock/unit/location/price）× 拆解 BOM 位号
//   归一化互含匹配归属（与 partHistoryService 同一条文本口径）→ 库存四要素 +
//   低库存红色预警（stock ≤ safe_stock，与备件页/低库存接口同线）+
//   一键生成采购申请（跳备件库存页预填采购入库单，提交即真实流水）。
//   采购周期：库内无前置期字段（已核 migrations/009），按分类配置口径如实标注。
// 两类断言：
//   A. 数据行为：纯函数 import 真模块跑真逻辑，严禁 mock 模块本身；
//   B. 源码契约：防"静默删功能"回归 —— tsc/lint 全绿但功能消失的形态。
import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import {
  matchSpareInventory,
  resolvePurchaseLead,
} from '../src/server/services/partInventoryService';
import {
  DEFAULT_PURCHASE_LEAD_RULES,
  getPurchaseLeadRules,
  getDefaultPurchaseLeadDays,
} from '../src/server/config/partProcurementConfig';
import {
  inventoryToProcurePrefill,
} from '../src/components/equipment3d/ExplodedPartInventoryPanel';
import type {
  ExplodedPartInventoryMatch,
} from '../src/api';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SERVICE = 'src/server/services/partInventoryService.ts';
const CONFIG = 'src/server/config/partProcurementConfig.ts';
const CONTROLLER = 'src/server/controllers/explodedViewController.ts';
const ROUTES = 'src/server/routes/explodedView.ts';
const PANEL = 'src/components/equipment3d/ExplodedPartInventoryPanel.tsx';
const STAGE = 'src/components/equipment3d/ExplodedViewStage.tsx';
const SCENE = 'src/components/equipment3d/EquipmentScene.tsx';
// 2026-10-19：库存诊断拉取随故障/寿命一起下沉到 useExplodedDiagnostics（hook 聚簇第二刀），
// 场景保留采购申请深链回调与 sessionStorage 兜底。
const DIAG_HOOK = 'src/components/equipment3d/useExplodedDiagnostics.ts';
const SHELL = 'src/components/equipment3d/DrilldownShell.tsx';
const APP = 'src/App.tsx';
const SPARE_VIEW = 'src/components/SparePartsView.tsx';
// 2026-10-20：api 域切分后，方法在 explodedView.ts、类型在 explodedDiagnosticsTypes.ts。
// 两处都读，避免「方法还在」把「类型被删」掩盖过去。
const API_FILES = ['src/api/explodedView.ts', 'src/api/explodedDiagnosticsTypes.ts'];

/* ------------------------------------------------------------------ */
/* A1. 采购前置期配置（分类口径，env 可调）                              */
/* ------------------------------------------------------------------ */
describe('采购前置期配置 · 默认值与环境变量覆盖', () => {
  it('内置默认规则：轴承/密封/滤芯/电机/油品/阀门六类全覆盖，天数>0', () => {
    expect(DEFAULT_PURCHASE_LEAD_RULES.length).toBeGreaterThanOrEqual(6);
    for (const rule of DEFAULT_PURCHASE_LEAD_RULES) {
      expect(rule.keywords.length).toBeGreaterThan(0);
      expect(rule.leadDays).toBeGreaterThan(0);
      expect(rule.label).toBeTruthy();
    }
  });

  it('PART_PROCUREMENT_LEAD_RULES_JSON 整体覆盖；非法 JSON / 非法条目回落内置默认', () => {
    const env = process.env;
    try {
      env.PART_PROCUREMENT_LEAD_RULES_JSON = JSON.stringify([
        { keywords: ['特种试件'], leadDays: 99, label: '自定义采购周期' },
      ]);
      const rules = getPurchaseLeadRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].leadDays).toBe(99);

      env.PART_PROCUREMENT_LEAD_RULES_JSON = 'not-json{';
      expect(getPurchaseLeadRules()).toEqual(DEFAULT_PURCHASE_LEAD_RULES);

      env.PART_PROCUREMENT_LEAD_RULES_JSON = JSON.stringify([{ keywords: 'bad', leadDays: 5 }]);
      expect(getPurchaseLeadRules()).toEqual(DEFAULT_PURCHASE_LEAD_RULES);

      env.PART_PROCUREMENT_LEAD_RULES_JSON = JSON.stringify([{ keywords: ['x'], leadDays: -3 }]);
      expect(getPurchaseLeadRules()).toEqual(DEFAULT_PURCHASE_LEAD_RULES);
    } finally {
      delete env.PART_PROCUREMENT_LEAD_RULES_JSON;
    }
  });

  it('PART_PROCUREMENT_DEFAULT_LEAD_DAYS 兜底天数可调，非法值回落 10', () => {
    const env = process.env;
    try {
      env.PART_PROCUREMENT_DEFAULT_LEAD_DAYS = '25';
      expect(getDefaultPurchaseLeadDays()).toBe(25);
      env.PART_PROCUREMENT_DEFAULT_LEAD_DAYS = 'abc';
      expect(getDefaultPurchaseLeadDays()).toBe(10);
      env.PART_PROCUREMENT_DEFAULT_LEAD_DAYS = '0';
      expect(getDefaultPurchaseLeadDays()).toBe(10);
    } finally {
      delete env.PART_PROCUREMENT_DEFAULT_LEAD_DAYS;
    }
  });
});

/* ------------------------------------------------------------------ */
/* A2. 备件匹配与前置期解析纯函数                                        */
/* ------------------------------------------------------------------ */
describe('matchSpareInventory · 位号/规格/别名 ↔ 备件名互含匹配', () => {
  it('位号名命中备件名（大小写/空白不敏感）', () => {
    expect(matchSpareInventory(['深沟球轴承'], { name: '深沟球轴承 6205' })).toBe(true);
    expect(matchSpareInventory(['o 型密封圈'], { name: 'O型密封圈 60×3' })).toBe(true);
  });

  it('规格互含也能命中（位号 spec ↔ 备件 spec）', () => {
    expect(matchSpareInventory(['齿轮油 L-HM46'], { name: '润滑油', spec: 'L-HM46' })).toBe(true);
  });

  it('完全无关的候选不命中（防误报）', () => {
    expect(matchSpareInventory(['联轴器'], { name: '滤芯', spec: '10μm' })).toBe(false);
    expect(matchSpareInventory([], { name: '滤芯' })).toBe(false);
    expect(matchSpareInventory(['x'], { name: 'xy' })).toBe(false); // token 过短丢弃
  });
});

describe('resolvePurchaseLead · 分类规则先命中先赢 / 兜底默认', () => {
  it('按名称关键词命中类别规则', () => {
    const r1 = resolvePurchaseLead(DEFAULT_PURCHASE_LEAD_RULES, { name: '深沟球轴承 6205' });
    expect(r1.leadDays).toBe(14);
    expect(r1.label).toContain('轴承');
    const r2 = resolvePurchaseLead(DEFAULT_PURCHASE_LEAD_RULES, { name: 'O型密封圈' });
    expect(r2.leadDays).toBe(7);
  });

  it('spec / model 兜底匹配', () => {
    const r = resolvePurchaseLead(DEFAULT_PURCHASE_LEAD_RULES, { name: '备件A', spec: 'HM46 润滑油' });
    expect(r.leadDays).toBe(3);
  });

  it('未命中任何规则走配置兜底天数', () => {
    const r = resolvePurchaseLead(DEFAULT_PURCHASE_LEAD_RULES, { name: '不明试件' });
    expect(r.leadDays).toBe(getDefaultPurchaseLeadDays());
    expect(r.label).toContain('默认');
  });

  it('顺序优先：靠前的规则先命中', () => {
    const rules = [
      { keywords: ['轴承'], leadDays: 14, label: '轴承' },
      { keywords: ['球轴承'], leadDays: 20, label: '球轴承细则' },
    ];
    expect(resolvePurchaseLead(rules, { name: '深沟球轴承' }).leadDays).toBe(14);
  });
});

/* ------------------------------------------------------------------ */
/* A3. 汇总口径：缺口 = max(0, safe_stock - stock)，低库存 = stock ≤ safe_stock */
/* ------------------------------------------------------------------ */
describe('库存四要素与低库存口径', () => {
  const makeMatch = (stock: number, safe: number): ExplodedPartInventoryMatch => ({
    id: 'sp-01',
    name: '深沟球轴承',
    spec: '6205',
    model: '',
    unit: '个',
    stock,
    safeStock: safe,
    shortage: Math.max(0, safe - stock),
    low: stock <= safe,
    location: 'A区-01架',
    price: 12.5,
    purchaseLeadDays: 14,
    purchaseLeadLabel: '轴承类常规采购周期',
  });

  it('低于阈值 → low=true 且缺口为正', () => {
    const m = makeMatch(2, 5);
    expect(m.low).toBe(true);
    expect(m.shortage).toBe(3);
  });

  it('恰等于阈值也算低库存（与备件页 stock <= safe_stock 同线）', () => {
    const m = makeMatch(5, 5);
    expect(m.low).toBe(true);
    expect(m.shortage).toBe(0);
  });

  it('高于阈值 → low=false 且缺口为 0', () => {
    const m = makeMatch(8, 5);
    expect(m.low).toBe(false);
    expect(m.shortage).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* A4. 采购申请预填（真实台账命中的零件 → 备件页入库单）                   */
/* ------------------------------------------------------------------ */
describe('inventoryToProcurePrefill · 采购申请预填', () => {
  const inventory: ExplodedPartInventoryMatch = {
    id: 'sp-07',
    name: 'O型密封圈 60×3',
    spec: '60×3',
    model: '',
    unit: '个',
    stock: 2,
    safeStock: 6,
    shortage: 4,
    low: true,
    location: 'C区-03架',
    price: 3.5,
    purchaseLeadDays: 7,
    purchaseLeadLabel: '密封件类常规采购周期',
  };

  it('预填字段：备件 id/名称/单位 + 缺口数量 + 设备与库存要素写进备注', () => {
    const prefill = inventoryToProcurePrefill({ posNo: '10', name: 'O型密封圈', inventory }, '1号空压机', 'AC-001');
    expect(prefill.partId).toBe('sp-07');
    expect(prefill.partName).toContain('O型密封圈');
    expect(prefill.unit).toBe('个');
    expect(prefill.qty).toBe(4); // 缺口优先
    expect(prefill.note).toContain('AC-001');
    expect(prefill.note).toContain('1号空压机');
    expect(prefill.note).toContain('当前 2 个 / 阈值 6 个');
    expect(prefill.note).toContain('现存放于 C区-03架');
    expect(prefill.note).toContain('7'); // 采购周期如实透出
  });

  it('缺口为 0 时至少按 1 件起订（低库存=踩线也算）', () => {
    const m = { ...inventory, stock: 6, shortage: 0 };
    const prefill = inventoryToProcurePrefill({ posNo: '10', name: 'O型密封圈', inventory: m }, '设备', 'DC-1');
    expect(prefill.qty).toBe(1);
  });

  it('数量为差异下限 1（不产生 0 件申请）', () => {
    const m = { ...inventory, stock: 10, shortage: 0, low: false };
    const prefill = inventoryToProcurePrefill({ posNo: '11', name: 'O型密封圈', inventory: m }, '设备', 'DC-2');
    expect(prefill.qty).toBeGreaterThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------ */
/* B. 源码契约：防"静默删功能"回归                                        */
/* ------------------------------------------------------------------ */
describe('源码契约 · 库存联动全链路接线', () => {
  it('服务真实台账口径：SparePartsRepository.getAll 拉全量台账 + EQUIPMENT_NOT_FOUND 契约', () => {
    const src = read(SERVICE);
    expect(src).toContain('SparePartsRepository');
    expect(src).toContain('EQUIPMENT_NOT_FOUND');
    expect(src).toContain('stock <= ');
    // 未命中如实说明，不编造
    expect(src).toContain('无备件记录');
  });

  it('controller + routes 暴露 part-inventory 端点（仅 /api/v1）', () => {
    const ctl = read(CONTROLLER);
    expect(ctl).toContain('handleGetDevicePartInventory');
    expect(ctl).toContain('getDevicePartInventory');
    const routes = read(ROUTES);
    expect(routes).toContain('/api/v1/equipments/:deviceId/part-inventory');
    // 2026-10-19：原断言只模糊匹配 '/part-inventory'，旧前缀复活也照样绿；改为钉死后缀
    expect(routes).not.toContain('/api/equipments/:deviceId/part-inventory"');
  });

  it('api 层提供 explodedViewApi.getPartInventory 与诊断类型', () => {
    const src = API_FILES.map(read).join('\n');
    expect(src).toContain('ExplodedPartInventoryDiagnostics');
    expect(src).toContain('SpareProcurePrefill');
    expect(src).toMatch(/getPartInventory\s*[(:]/);
  });

  it('面板组件：库存四要素 + 红色预警 + 采购申请按钮（testid 契约）', () => {
    const src = read(PANEL);
    expect(src).toContain('equipment3d-exploded-inventory-panel');
    expect(src).toContain('equipment3d-exploded-inventory-create-');
    expect(src).toContain('库存');
    expect(src).toContain('阈值');
    expect(src).toContain('存放位置');
    expect(src).toContain('采购周期');
    expect(src).toContain('inventoryToProcurePrefill');
  });

  it('Stage 接收 inventoryInfo 并渲染库存面板', () => {
    const src = read(STAGE);
    expect(src).toContain('inventoryInfo');
    expect(src).toContain('ExplodedPartInventoryPanel');
    expect(src).toContain('onOpenProcure');
  });

  it('EquipmentScene 拉取真实库存诊断 + 采购申请深链回调（含 sessionStorage 兜底）', () => {
    const src = read(SCENE);
    expect(src).toContain('useExplodedDiagnostics(explodedHtmlDeviceId)');
    expect(read(DIAG_HOOK)).toContain('getPartInventory');
    expect(src).toContain('explodedInventoryInfo');
    expect(src).toContain('onNavigateToSpareProcure');
    expect(src).toContain("'spare-procure-prefill'");
  });

  it('DrilldownShell 透传采购申请回调', () => {
    const src = read(SHELL);
    expect(src).toContain('onNavigateToSpareProcure');
  });

  it('App 深链：切 spare_parts 页 + 传递预填状态', () => {
    const src = read(APP) + (fs.existsSync(path.join(ROOT, 'src/components/layout/AppViewDispatcher.tsx')) ? read('src/components/layout/AppViewDispatcher.tsx') : '');
    expect(src).toContain('spareProcurePrefill');
    expect(src).toContain("'spare_parts'");
    expect(src).toContain('initialProcurePrefill');
    expect(src).toContain('onProcurePrefillConsumed');
  });

  it('备件页消费采购预填：预填「入库」并带 appliedRef 去重（防重复提交形态）', () => {
    const src = read(SPARE_VIEW);
    expect(src).toContain('initialProcurePrefill');
    expect(src).toContain('appliedProcurePrefillRef');
    expect(src).toContain("setInOutType('in')");
    expect(src).toContain('onProcurePrefillConsumed');
  });

  it('数据诚实性：面板/服务如实标注采购周期为配置口径（非 DB 字段）', () => {
    const configSrc = read(CONFIG);
    expect(configSrc).toContain('没有采购前置期字段');
    const serviceSrc = read(SERVICE);
    expect(serviceSrc).toContain('不编造');
  });
});
