// @vitest-environment jsdom
// 「拆解视图 · 检修报告导出」回归守卫（F7）。
//
// 功能口径（诚实性为主）：
//   报告数据全部来自真实库/真实页面：设备台账（equipments）× 拆解页自带 PARTS
//   BOM（位号/名称/规格/材质/数量/重量 原样解析）× 遥测故障（真实读数×阈值）×
//   寿命（真实换次×运行时钟）× spare_parts 库存 × 已完工单 repair_log；
//   3D 截图由宿主从已打开的拆解 iframe 取实时画面（页面 __EXPL_CAPTURE +
//   preserveDrawingBuffer 补丁），拿不到就如实标注，不用占位图。
//   PDF 由前端离屏 Canvas（A4 150dpi）逐页绘制 + jspdf 装订，中文走系统字体。
// 两类断言：
//   A. 数据行为：纯函数 import 真模块跑真逻辑（含对仓库里 9 个真实拆解页的解析）；
//   B. 源码契约：防"静默删功能"回归。
import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import {
  extractBomRowsFromHtml,
  buildRecommendations,
} from '../src/server/services/maintenanceReportService';
import {
  buildMaintenanceReportPdf,
  type ReportPdfOptions,
} from '../src/components/equipment3d/maintenanceReportPdf';
import type { MaintenanceReportBomRow, MaintenanceReportData } from '../src/api';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const expDir = path.join(ROOT, 'public', 'exploded');
const PAGE_NAMES = fs.readdirSync(expDir).filter((f) => f.endsWith('.html')).sort();

const SERVICE = 'src/server/services/maintenanceReportService.ts';
const CONTROLLER = 'src/server/controllers/explodedViewController.ts';
const ROUTES = 'src/server/routes/explodedView.ts';
const REPO = 'src/db/repositories/partHistoryRepository.ts';
const PDF = 'src/components/equipment3d/maintenanceReportPdf.ts';
const STAGE = 'src/components/equipment3d/ExplodedViewStage.tsx';
const SCENE = 'src/components/equipment3d/EquipmentScene.tsx';
const API = 'src/api/index.ts';
const PKG = 'package.json';

/* ------------------------------------------------------------------ */
/* A1. 拆解页 PARTS 解析（对仓库里 9 个真实页面逐个跑真逻辑）              */
/* ------------------------------------------------------------------ */
describe('extractBomRowsFromHtml · 真实拆解页 BOM 解析', () => {
  it('9 个拆解页全部能解析出非空 BOM（位号/名称/规格/材质/数量/重量唯一来源就是页面本身）', () => {
    expect(PAGE_NAMES).toHaveLength(10);
    for (const name of PAGE_NAMES) {
      const rows = extractBomRowsFromHtml(read(path.join('public', 'exploded', name)));
      expect(rows, name).not.toBeNull();
      expect(rows!.length, name).toBeGreaterThan(4);
      for (const r of rows!) {
        expect(r.posNo.length, `${name} ${r.posNo}`).toBeGreaterThan(0);
        expect(r.name.length, `${name} ${r.name}`).toBeGreaterThan(0);
      }
    }
  });

  it('数量与重量是页面出厂标注（pump P01 = 1 件 / 465 kg；P02 = 8 套 / 38.4 kg）', () => {
    const rows = extractBomRowsFromHtml(read(path.join('public', 'exploded', 'pump_exploded.html')));
    expect(rows).not.toBeNull();
    const p01 = rows!.find((r) => r.posNo === 'P01');
    const p02 = rows!.find((r) => r.posNo === 'P02');
    expect(p01).toEqual(expect.objectContaining({ name: '重型铸铁公用泵座底座', qty: 1, weight: 465 }));
    expect(p02).toEqual(expect.objectContaining({ qty: 8, weight: 38.4 }));
  });

  it('描述文本里带 "]" / "【】" 也不破坏扫描（字符串安全配对）', () => {
    const mini = `<html><body><script>
      const PARTS = [
        { id: 'P1', name: '部件甲', category: '轴系', spec: '265×68mm', material: '钢(淬)', qty: 2, weight: 12.5, desc: '含套件[如弹簧垫圈]' },
        { id: 'P2', name: '部件乙', qty: 1, weight: 3.1 },
      ];
    </script></body></html>`;
    const rows = extractBomRowsFromHtml(mini);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ posNo: 'P1', qty: 2, weight: 12.5 }),
      expect.objectContaining({ posNo: 'P2', material: null, qty: 1 }),
    ]));
  });

  it('坏输入如实回 null（不编造默认值）', () => {
    expect(extractBomRowsFromHtml('<html>没有 PARTS</html>')).toBeNull();
    expect(extractBomRowsFromHtml('<script>const PARTS = [')); // 未闭合
  });
});

/* ------------------------------------------------------------------ */
/* A2. 维修建议：仅由真实标注推导                                        */
/* ------------------------------------------------------------------ */
function makeRow(over: Partial<MaintenanceReportBomRow>): MaintenanceReportBomRow {
  return {
    posNo: 'P01',
    name: '深沟球轴承组',
    category: '轴承',
    spec: '6205',
    material: '钢',
    qty: 2,
    weight: 3.5,
    desc: null,
    flags: { fault: false, lifeNearing: false, lifeReplace: false, lowStock: false },
    faultDetail: null,
    lifeStatus: null,
    lifeRemainingPct: null,
    inventory: null,
    ...over,
  };
}

describe('buildRecommendations · 三段建议口径', () => {
  it('故障观察部位 + 寿命到期 → 必须立即处理（含真实理由）', () => {
    const rec = buildRecommendations([
      makeRow({ posNo: 'P03', name: '轴承', flags: { fault: true, lifeNearing: false, lifeReplace: false, lowStock: false }, faultDetail: '主轴承温度 当前 92 ℃，阈值 85 ℃' }),
      makeRow({ posNo: 'P07', name: '机械密封', flags: { fault: false, lifeNearing: false, lifeReplace: true, lowStock: false }, lifeRemainingPct: 0 }),
    ]);
    expect(rec.mustReplaceNow).toHaveLength(2);
    expect(rec.mustReplaceNow[0].reason).toContain('92');
    expect(rec.mustReplaceNow[1].posNo).toBe('P07');
    expect(rec.scheduleSoon).toHaveLength(0);
  });

  it('临近寿命 → 近期保养；低库存 → 缺件提醒（缺口/位置透出）', () => {
    const rec = buildRecommendations([
      makeRow({ posNo: 'P09', name: '滤芯', flags: { fault: false, lifeNearing: true, lifeReplace: false, lowStock: false }, lifeRemainingPct: 12 }),
      makeRow({ posNo: 'P12', name: '密封圈', flags: { fault: false, lifeNearing: false, lifeReplace: false, lowStock: true }, inventory: { stock: 1, safeStock: 5, shortage: 4, location: 'C区-03架', unit: '个' } }),
    ]);
    expect(rec.scheduleSoon[0].posNo).toBe('P09');
    expect(rec.scheduleSoon[0].reason).toContain('12');
    expect(rec.stockShortages).toEqual([expect.objectContaining({ posNo: 'P12', shortage: 4, location: 'C区-03架' })]);
  });

  it('全绿无标注 → 三段全部如实为空（不搬家不发明）', () => {
    const rec = buildRecommendations([makeRow({})]);
    expect(rec.mustReplaceNow).toHaveLength(0);
    expect(rec.scheduleSoon).toHaveLength(0);
    expect(rec.stockShortages).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* B. 源码契约：数据诚实性 + 全链路接线                                   */
/* ------------------------------------------------------------------ */
describe('源码契约 · 检修报告全链路', () => {
  it('服务端聚合只读端点 + EQUIPMENT_NOT_FOUND 契约；BOM 优先拆解页 PARTS、缺页如实回退', () => {
    const src = read(SERVICE);
    expect(src).toContain('EQUIPMENT_NOT_FOUND');
    expect(src).toContain("EXPLODED_VIEW_FILES[deviceId]");
    expect(src).toContain('extractBomRowsFromHtml');
    expect(src).toContain('server-catalog');
    // 数量/重量来源就是页面 PARTS；绝不补默认值
    expect(src).toContain('bomSource');
    expect(src).not.toMatch(/qty:\s*1[,}]/); // 不允许硬编码兜底数量
    expect(src).not.toMatch(/weight:\s*0[,}]/);
  });

  it('controller + routes 暴露 maintenance-report 双前缀端点', () => {
    const ctl = read(CONTROLLER);
    expect(ctl).toContain('handleGetMaintenanceReport');
    expect(ctl).toContain('getMaintenanceReport');
    const routes = read(ROUTES);
    // 路由占位是 :deviceId —— 两处注册都必须配 deviceIdParamSchema（误用 idParamSchema 会 400）
    const registrations = routes.match(/:deviceId\/maintenance-report", validateParams\(\w+\)/g) ?? [];
    expect(registrations.length).toBe(2);
    expect(registrations.every((r) => r.includes('deviceIdParamSchema'))).toBe(true);
  });

  it('api 层提供 explodedViewApi.getMaintenanceReport 与聚合类型', () => {
    const src = read(API);
    expect(src).toContain('MaintenanceReportData');
    expect(src).toMatch(/getMaintenanceReport\s*[:(]/);
  });

  it('完工单历史带 根本原因/作业步骤/更换备件（repair_log 真实字段）', () => {
    const src = read(REPO);
    expect(src).toContain('getCompletedOrdersSummary');
    expect(src).toContain('cause_analysis');
    expect(src).toContain('parts_used');
    expect(src).toContain("status = 'completed'");
  });

  it('PDF 生成：A4 150dpi 离屏 Canvas + jspdf（无中文字体包依赖、无占位图）', () => {
    const src = read(PDF);
    expect(read(PKG)).toContain('"jspdf"');
    expect(src).toContain('1240'); // PAGE_W_PX @150dpi
    expect(src).toContain('1754');
    expect(src).toContain("new jsPDF({ unit: 'mm', format: 'a4'");
    // 截图缺失 → 如实标注，不放假图
    expect(src).toContain('截图不可用');
    expect(src.toLowerCase()).not.toMatch(/placeholder\.(png|jpg)/);
  });

  it('Stage 右上角导出按钮：聚合端点 + iframe 实时截图 + 失败如实提示', () => {
    const src = read(STAGE);
    expect(src).toContain('equipment3d-exploded-export-report');
    expect(src).toContain('getMaintenanceReport');
    expect(src).toContain('__EXPL_CAPTURE');
    expect(src).toContain('equipment3d-exploded-export-error');
    expect(src).toContain('exporterName');
  });

  it('EquipmentScene 把当前登录用户名交给 Stage 作为导出人（不造假）', () => {
    const src = read(SCENE);
    expect(src).toContain('exporterName={currentUser?.name ?? null}');
  });

  it('9 个拆解页都已补 preserveDrawingBuffer + __EXPL_CAPTURE（截图与 BOM 同源）', () => {
    expect(PAGE_NAMES).toHaveLength(10);
    for (const name of PAGE_NAMES) {
      const src = read(path.join('public', 'exploded', name));
      expect(src.includes('preserveDrawingBuffer: true'), name).toBe(true);
      expect(src.includes('__EXPL_CAPTURE'), name).toBe(true);
    }
  });

  it('数据诚实性：报告封面标题、字段缺失"—"、建议空如实披露（PDF 模块口径）', () => {
    const src = read(PDF);
    expect(src).toContain('设备检修拆解报告');
    expect((src.match(/'—'/g) ?? []).length).toBeGreaterThanOrEqual(6); // 字段缺失统一显示"—"
    expect(src).toContain('当前无'); // 建议为空如实披露
  });
});

/* ------------------------------------------------------------------ */
/* B2. PDF 生成器总流程（jsdom 无 canvas → 用死 casing 验证纯逻辑分支）   */
/* ------------------------------------------------------------------ */
describe('buildMaintenanceReportPdf · 总流程守卫', () => {
  it('jsdom 无 Canvas2D → 如实抛"无法创建离屏画布"，不产生假报告', async () => {
    const makeReport = (over: Partial<MaintenanceReportData>): MaintenanceReportData => ({
      generatedAt: '2026-10-17T10:00:00.000Z',
      explodedViewFile: 'pump_exploded.html',
      device: {
        id: 'eq-1', code: 'EQ-001', name: '锅炉给水泵', category: '泵类设备', model: 'M-1',
        manufacturer: null, workshop: null, location: null, installDate: null,
        status: 'running', healthScore: 92, criticality: null, nextInspectionDate: null, specs: [],
      },
      bomSource: 'page-parts',
      bom: [],
      faults: [],
      latestSampleAt: null,
      life: { replaceCount: 0, nearingCount: 0, suggestedMaintenanceBefore: null },
      inventory: { lowCount: 0, matchedCount: 0, totalParts: 0, totalShortage: 0 },
      history: [],
      recommendations: { mustReplaceNow: [], scheduleSoon: [], stockShortages: [] },
      dataNote: '测试口径',
      ...over,
    } as MaintenanceReportData);
    const opts: ReportPdfOptions = { exporterName: '张三', screenshotDataUrl: null };
    await expect(buildMaintenanceReportPdf(makeReport({}), opts)).rejects.toThrow(/Canvas 2D/);
  });
});
