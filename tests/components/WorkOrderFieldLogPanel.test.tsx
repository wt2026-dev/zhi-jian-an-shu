// @vitest-environment jsdom
/**
 * 工单详情「现场维修过程留痕」面板。
 *
 * 这一块是档案回看的最后一段链路：数据早就写进 repair_log.fieldLog，但工单详情过去
 * 只渲染工时/原因/步骤，没有入口能看到 LOTO、逐步留痕、测量与照片。
 *
 * 断言口径（数据纪律优先）：
 *   · 没有 fieldLog → 整个面板不渲染（不造占位卡片）；
 *   · 测量 ok=null（点检标准无限值）必须显示"仅留痕"，**不能**被当成"合格"；
 *   · 超差 ok=false 必须显式标红；LOTO 四项如实列出取消勾选的那项；
 *   · 步骤按序号的**数值**排序（"10" 不能排到 "2" 前面）。
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { WorkOrderFieldLogPanel } from '../../src/components/workorders/WorkOrderFieldLogPanel';
import type { FieldWorkLog } from '../../src/types';

const OP = { name: '张建国', username: 'u-tech1' };

function makeLog(overrides: Partial<FieldWorkLog> = {}): FieldWorkLog {
  return {
    events: [
      { at: '2026-10-18T01:00:00.000Z', kind: 'loto', text: 'LOTO 安全确认：四项强制检查全部通过。', by: '张建国' },
      { at: '2026-10-18T01:10:00.000Z', kind: 'step', text: '步骤 1 完成。', by: '张建国' },
      { at: '2026-10-18T02:30:00.000Z', kind: 'complete', text: '工单自动完工闭环。', by: '张建国' },
    ],
    loto: {
      confirmedAt: '2026-10-18T01:00:00.000Z',
      by: OP,
      items: [
        { key: 'loto_power_locked', label: '设备已断电、上锁挂牌（LOTO）', confirmed: true },
        { key: 'residual_energy_released', label: '残余压力/能量已释放', confirmed: true },
        { key: 'hazardous_parts_isolated', label: '高温/高压/转动部件已隔离', confirmed: true },
        { key: 'workzone_barricaded', label: '作业区域已设置警示围栏', confirmed: true },
      ],
    },
    steps: {
      '1': { status: 'done', by: OP, at: '2026-10-18T01:10:00.000Z', elapsedMin: 10 },
      '2': { status: 'skip', note: '上一班次已完成', by: OP, at: '2026-10-18T01:20:00.000Z', elapsedMin: 10 },
      '10': { status: 'issue', note: '轴承室拉伤', by: OP, at: '2026-10-18T01:40:00.000Z', elapsedMin: 20 },
    },
    measurements: [
      {
        id: 'fm-1', posNo: 'BOM-07', checkPoint: '轴承间隙', standard: '0.03~0.08mm', unit: 'mm',
        minLimit: 0.03, maxLimit: 0.08, value: 0.05, ok: true, by: OP, at: '2026-10-18T01:15:00.000Z',
      },
      {
        id: 'fm-2', posNo: 'BOM-07', checkPoint: '轴承间隙', standard: '0.03~0.08mm', unit: 'mm',
        minLimit: 0.03, maxLimit: 0.08, value: 0.21, ok: false, by: OP, at: '2026-10-18T01:16:00.000Z',
      },
      {
        id: 'fm-3', posNo: 'BOM-09', checkPoint: '外观检查', standard: null, unit: null,
        minLimit: null, maxLimit: null, value: 1, ok: null, by: OP, at: '2026-10-18T01:17:00.000Z',
      },
    ],
    partPhotos: [
      { id: 'fp-1', posNo: 'BOM-07', url: '/uploads/parts/bom07.jpg', filename: 'bom07.jpg', size: 1024, by: OP, at: '2026-10-18T01:18:00.000Z' },
    ],
    completed: { at: '2026-10-18T02:30:00.000Z', by: '张建国', workHours: 1.5, total: 5, done: 4, skipped: 1 },
    ...overrides,
  };
}

describe('工单详情：现场维修过程留痕面板', () => {
  it('没有 fieldLog → 整个面板不渲染（不造占位）', () => {
    const { container } = render(<WorkOrderFieldLogPanel log={null} />);
    expect(container.querySelector('[data-testid="work-order-field-log"]')).toBeNull();
    expect(screen.queryByText('现场维修过程留痕（拆解作业终端）')).toBeNull();
  });

  it('空对象（没有任何真实记录）同样不渲染', () => {
    const { container } = render(
      <WorkOrderFieldLogPanel log={{ events: [], steps: {}, measurements: [], partPhotos: [], loto: null, completed: null }} />
    );
    expect(container.querySelector('[data-testid="work-order-field-log"]')).toBeNull();
  });

  it('LOTO 四项如实列出，确认人与时间读留档', () => {
    render(<WorkOrderFieldLogPanel log={makeLog()} />);
    const loto = screen.getByTestId('work-order-field-log-loto');
    expect(loto.textContent).toContain('设备已断电、上锁挂牌（LOTO）');
    expect(loto.textContent).toContain('作业区域已设置警示围栏');
    expect(loto.textContent).toContain('张建国');
  });

  it('测量：ok=null 显示「仅留痕」，绝不冒充「合格」', () => {
    render(<WorkOrderFieldLogPanel log={makeLog()} />);
    const only = screen.getByTestId('work-order-field-log-measure-fm-3');
    expect(only.textContent).toContain('仅留痕');
    // 只对"结果徽标"断言：该卡片本来就不含"合格"文案，别用"整卡不含合格"这种
    // 永远为真的弱断言（把 null 当合格时它一样会通过）。
    expect(only.textContent).not.toMatch(/超标准差/);
    expect(only.querySelector('[data-testid^="fieldlog-result-"]')?.getAttribute('data-result')).toBe('only-record');
  });

  it('测量：超差 ok=false 显式标红「超标准差」，合格项显示合格', () => {
    render(<WorkOrderFieldLogPanel log={makeLog()} />);
    const bad = screen.getByTestId('work-order-field-log-measure-fm-2');
    expect(bad.textContent).toContain('超标准差');
    expect(bad.textContent).toContain('0.03 ~ 0.08');
    expect(bad.querySelector('[data-testid="fieldlog-result-fm-2"]')?.getAttribute('data-result')).toBe('over-limit');
    const good = screen.getByTestId('work-order-field-log-measure-fm-1');
    expect(good.textContent).toContain('合格');
    expect(good.querySelector('[data-testid="fieldlog-result-fm-1"]')?.getAttribute('data-result')).toBe('pass');
  });

  it('步骤按序号数值排序（步骤 10 排在步骤 2 之后）', () => {
    const { container } = render(<WorkOrderFieldLogPanel log={makeLog()} />);
    const nodes = Array.from(container.querySelectorAll('[data-testid^="work-order-field-log-step-"]'));
    expect(nodes.map((n) => n.getAttribute('data-testid'))).toEqual([
      'work-order-field-log-step-1',
      'work-order-field-log-step-2',
      'work-order-field-log-step-10',
    ]);
  });

  it('跳过与问题步骤必须显示现场备注；带原因是服务端硬校验', () => {
    render(<WorkOrderFieldLogPanel log={makeLog()} />);
    expect(screen.getByTestId('work-order-field-log-step-2').textContent).toContain('上一班次已完成');
    expect(screen.getByTestId('work-order-field-log-step-10').textContent).toContain('轴承室拉伤');
  });

  it('自动完工留档显示完工时间 / 实际维修人 / 工时', () => {
    render(<WorkOrderFieldLogPanel log={makeLog()} />);
    const done = screen.getByTestId('work-order-field-log-completed');
    expect(done.textContent).toContain('张建国');
    expect(done.textContent).toContain('1.5 h');
    expect(done.textContent).toContain('完成 4 / 跳过 1');
  });

  it('现场照片用真实 /uploads/ 地址，并标出关联位号', () => {
    render(<WorkOrderFieldLogPanel log={makeLog()} />);
    const link = screen.getByTestId('work-order-field-log-photo-fp-1') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/uploads/parts/bom07.jpg');
    expect(link.textContent).toContain('BOM-07');
    expect(link.querySelector('img')?.getAttribute('src')).toBe('/uploads/parts/bom07.jpg');
  });

  it('时间线默认展开，条数与事件一致，可折叠', () => {
    render(<WorkOrderFieldLogPanel log={makeLog()} />);
    const list = screen.getByTestId('work-order-field-log-timeline-list');
    expect(list.querySelectorAll('li')).toHaveLength(3);
    fireEvent.click(screen.getByText(/全过程时间线/));
    expect(screen.queryByTestId('work-order-field-log-timeline-list')).toBeNull();
  });

  it('没有 LOTO 留档时如实提示，而不是假装已确认', () => {
    render(<WorkOrderFieldLogPanel log={makeLog({ loto: null })} />);
    expect(screen.getByTestId('work-order-field-log-no-loto').textContent).toContain('没有 LOTO');
    expect(screen.queryByTestId('work-order-field-log-loto')).toBeNull();
  });
});
