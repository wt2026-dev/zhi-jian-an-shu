// @vitest-environment jsdom
/**
 * 驾驶舱（CockpitDashboardView）的「别编数字」守卫。
 *
 * 背景（2026-10-17 实测）：这个文件是全屏展示面，却有一整簇兜底值会把
 * "没数据"渲染成"运行良好"：
 *
 *   onlineRate        = totalEquipments > 0 ? … : '98.5'     ← 一台设备都没有 → 在线率 98.5%
 *   woCompletionRate  = totalOrders   > 0 ? … : '87.5'       ← 没有工单 → 完成率 87.5%
 *   inspCompletionRate= … : '92.0'
 *   mistakeRate       = … : '2.8'                            ← 没有合规数据 → 违章率 2.8%
 *   eqStatusData      = runningEquipments || 7 / || 2 / || 1 ← 环形图凭空画出 7 台正常
 *   aiCallsCount      = aiStats?.totalCalls || (186 + …)      ← 用公式现算一个调用量
 *   knowledgeList.length || 8                                 ← 知识库 0 篇时显示 8 篇
 *   trendData         = 写死的 13 天（02-25…03-08）           ← 标题却写"14天走势"
 *
 * 这里同时钉两层：
 *   A. 渲染层：所有接口都失败/为空时，页面上不得出现 98.5% / 87.5% / 92.0% / 2.8%；
 *   B. 源码层：这些兜底字面量与写死的趋势表不得回来（渲染层断言抓不到图表内部的数）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';

vi.mock('recharts', () => {
  const Box = ({ children }: any) => <div>{children}</div>;
  return {
    ResponsiveContainer: Box,
    AreaChart: Box,
    Area: () => null,
    BarChart: Box,
    Bar: () => null,
    PieChart: Box,
    Pie: () => null,
    Cell: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    CartesianGrid: () => null,
    Legend: () => null,
  };
});

// three.js 场景在 jsdom 里没有 WebGL，直接空实现
vi.mock('../../src/components/digital-twin/TwinScene3D', () => ({
  TwinScene3D: () => null,
  Anchor3D: () => null,
  TwinDataSign: () => null,
}));

vi.mock('../../src/api', () => {
  // ⚠️ vi.mock 的工厂会被提升到文件顶部，不能引用外部变量（会 TDZ 报错），所以就地定义
  const rejected = () => Promise.reject(new Error('api down'));
  return {
    equipmentApi: { list: vi.fn(rejected) },
    workOrderApi: { list: vi.fn(rejected) },
    inspectionApi: { list: vi.fn(rejected) },
    hazardsApi: { list: vi.fn(rejected), getMetrics: vi.fn(rejected) },
    sparePartsApi: { list: vi.fn(rejected) },
    complianceApi: { getStats: vi.fn(rejected) },
    knowledgeApi: { list: vi.fn(rejected) },
    cockpitApi: { getAbnormal: vi.fn(rejected) },
    aiApi: {},
  };
});

import { CockpitDashboardView } from '../../src/components/CockpitDashboardView';

const SRC = readFileSync(
  path.resolve(process.cwd(), 'src/components/CockpitDashboardView.tsx'),
  'utf8',
);

// ⚠️ 源码断言必须**先剥掉注释**：修复说明里会引用被删掉的旧写法
//    （例如「原来是 `runningEquipments || 7`」），否则守卫会被自己的注释打红。
const SRC_CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('CockpitDashboardView：无数据时不得显示漂亮的兜底数字', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // /api/v1/ai-stats 也失败
    global.fetch = vi.fn(() => Promise.reject(new Error('ai-stats down'))) as any;
  });

  it('全部接口失败 → 四个比率显示 —，不得出现 98.5% / 87.5% / 92.0% / 2.8%', async () => {
    const { container } = render(<CockpitDashboardView />);
    await waitFor(() => {
      expect(container.textContent).toMatch(/—/);
    });
    const text = container.textContent || '';
    expect(text).not.toMatch(/98\.5%/);
    expect(text).not.toMatch(/87\.5%/);
    expect(text).not.toMatch(/92\.0%/);
    expect(text).not.toMatch(/2\.8%/);
  });

  it('源码里不得再有「分母为 0 就编一个漂亮值」的兜底字面量', () => {
    expect(SRC_CODE).not.toContain("'98.5'");
    expect(SRC_CODE).not.toContain("'87.5'");
    expect(SRC_CODE).not.toContain("'92.0'");
    expect(SRC_CODE).not.toContain(": '2.8'");
    expect(SRC_CODE).not.toMatch(/runningEquipments\s*\|\|\s*7/);
    expect(SRC_CODE).not.toMatch(/warningEquipments\s*\|\|\s*2/);
    expect(SRC_CODE).not.toMatch(/faultEquipments\s*\|\|\s*1/);
    expect(SRC_CODE).not.toMatch(/knowledgeList\.length\s*\|\|\s*8/);
  });

  it('趋势图不得再用写死的 13 天假数据（须按 workOrders.createdAt 真实分桶）', () => {
    // 旧表的第一行：{ day: '02-25', orders: 4, faults: 1, aiCalls: 8 }
    expect(SRC_CODE).not.toMatch(/day:\s*'02-25'/);
    expect(SRC_CODE).not.toMatch(/day:\s*'03-0[1-9]'/);
    // 必须真的从 createdAt 切日期
    expect(SRC_CODE).toContain('createdAt');
    expect(SRC_CODE).toMatch(/slice\(5,\s*10\)/);
  });

  it('AI 调用没有按日明细 → 不得再画 aiCalls 序列', () => {
    expect(SRC_CODE).not.toMatch(/dataKey="aiCalls"/);
    // 累计值仍展示，但取不到时是 —
    expect(SRC_CODE).toMatch(/aiCallsCount \?\? '—'/);
  });
});
