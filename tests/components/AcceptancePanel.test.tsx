// @vitest-environment jsdom
/**
 * 修后验收面板（验收清单 / 修前修后对比 / 双签字）。
 *
 * 断言口径（数据纪律优先，全部是"会被悄悄改坏"的点）：
 *   · unconfigured（额定电流无台账）绝不能渲染成"合格"，且必须显式提示"未判定"；
 *   · 修前无遥测样本 ⇒ 显示"未接入"，**不能**补一个 0 或看起来合理的数字；
 *   · 校验逻辑不在前端：面板上的 verdict 一律来自接口，前端不自行判定；
 *   · 同人不得签班组长：角色够格但和维修人是同一人时按钮禁用并给出原因；
 *   · 关单后才出现维修总结与只读态。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import React from 'react';

const get = vi.fn();
const check = vi.fn();
const sign = vi.fn();

vi.mock('../../src/api', () => ({
  acceptanceApi: {
    get: (...a: any[]) => get(...a),
    check: (...a: any[]) => check(...a),
    sign: (...a: any[]) => sign(...a),
  },
}));

import { AcceptancePanel } from '../../src/components/workorders/AcceptancePanel';

const TECH = { id: 'u-tech1', name: '张建国', username: 'tech1', role: 'technician', roleTitle: '检修技师' } as any;
const MANAGER = { id: 'u-manager', name: '陈主管', username: 'manager', role: 'manager', roleTitle: '车间主管' } as any;

function item(over: Partial<any> = {}) {
  return {
    itemKey: 'no_load_temp',
    itemLabel: '空载运行 30 分钟，轴承温度 ≤ 70℃',
    metric: 'temperature',
    unit: '℃',
    minLimit: null,
    maxLimit: 70,
    judgedBy: 'auto',
    standardSource: '待工程确认（需求方给出的修后验收指标，尚未取得设备手册佐证）',
    confidence: 'pending_engineering',
    note: null,
    record: null,
    verdict: 'pending',
    ...over,
  };
}

function makeSession(over: Partial<any> = {}) {
  const items = [
    item(),
    item({
      itemKey: 'vibration',
      itemLabel: '设备振动值 ≤ 2.8mm/s',
      metric: 'vibration',
      unit: 'mm/s',
      maxLimit: 2.8,
    }),
    item({
      itemKey: 'running_current',
      itemLabel: '运行电流在额定范围内',
      metric: 'current',
      unit: 'A',
      minLimit: null,
      maxLimit: null,
      standardSource: 'unconfigured（该设备额定电流台账缺失，不做推算）',
      verdict: 'unconfigured',
    }),
    item({
      itemKey: 'no_leak_noise',
      itemLabel: '无泄漏、无异响、无异常噪音',
      metric: 'visual',
      unit: null,
      maxLimit: null,
      judgedBy: 'manual',
    }),
    item({
      itemKey: 'safety_guard',
      itemLabel: '安全防护装置恢复正常',
      metric: 'switch',
      unit: null,
      maxLimit: null,
      judgedBy: 'manual',
    }),
  ];
  return {
    order: {
      id: 'wo-1',
      orderNo: 'WO-20240902-001',
      title: '减速箱异响',
      equipmentId: 'eq-103',
      equipmentName: '3# 轧机主传动行星减速箱',
      faultType: '轴承失效',
      status: 'pending_acceptance',
      statusLabel: '待验收',
      createdAt: '2026/09/02 08:30:15',
      assignee: '张建国',
    },
    canAccept: true,
    blockedReason: null,
    items,
    allPassed: false,
    failed: 0,
    unconfigured: 1,
    pending: 4,
    baselines: [
      { metric: 'temperature', label: '设备温度', unit: '℃', preMax: 92.4, preAvg: 84.1, samples: 24, windowFrom: '2026-09-01T00:00:00Z', windowTo: '2026-09-02T00:00:00Z', overLimitSamples: 12 },
      { metric: 'vibration', label: '设备振动', unit: 'mm/s', preMax: 4.8, preAvg: 3.9, samples: 24, windowFrom: '2026-09-01T00:00:00Z', windowTo: '2026-09-02T00:00:00Z', overLimitSamples: 9 },
      // 电流无数据 + 无报警阈值：samples=0、overLimitSamples=null
      { metric: 'current', label: '运行电流', unit: 'A', preMax: null, preAvg: null, samples: 0, windowFrom: null, windowTo: null, overLimitSamples: null },
    ],
    signatures: [],
    nextSigner: null,
    closedAt: null,
    summary: null,
    events: [],
    version: 3,
    dataNote: '验收阈值取 acceptance_standards（带来源与可信度，未配置项如实显示不可判定）。',
    ...over,
  };
}

beforeEach(() => {
  get.mockReset();
  check.mockReset();
  sign.mockReset();
});

describe('修后验收面板', () => {
  it('未配置项如实显示「未配置·未判定」，绝不渲染成合格', async () => {
    get.mockResolvedValue(makeSession());
    render(<AcceptancePanel orderId="wo-1" currentUser={TECH} />);

    await waitFor(() => expect(screen.getByTestId('acceptance-panel')).toBeTruthy());
    const cur = screen.getByTestId('acceptance-item-running_current');
    expect(cur.getAttribute('data-verdict')).toBe('unconfigured');
    expect(cur.textContent).toContain('未配置');
    expect(cur.textContent).not.toContain('合格');
    // 顶部必须说明"未判定"不计入合格
    expect(screen.getByTestId('acceptance-unconfigured-note').textContent).toContain('未判定');
  });

  it('修前无遥测样本 ⇒ 显示「未接入」，不补 0', async () => {
    get.mockResolvedValue(makeSession());
    render(<AcceptancePanel orderId="wo-1" currentUser={TECH} />);

    await waitFor(() => expect(screen.getByTestId('acceptance-panel')).toBeTruthy());
    const row = screen.getByTestId('acceptance-compare-current');
    expect(row.getAttribute('data-pre-samples')).toBe('0');
    const cells = within(row).getAllByRole('cell');
    // 第 2 列 = 修前最坏值
    expect(cells[1].textContent).toContain('未接入');
    expect(cells[1].textContent).not.toMatch(/^0/);
    expect(row.textContent).toContain('无遥测样本');
  });

  it('修前有数据 ⇒ 显示真实最坏值，并标出超报警线样本数', async () => {
    get.mockResolvedValue(makeSession());
    render(<AcceptancePanel orderId="wo-1" currentUser={TECH} />);
    await waitFor(() => expect(screen.getByTestId('acceptance-panel')).toBeTruthy());

    const row = screen.getByTestId('acceptance-compare-vibration');
    const cells = within(row).getAllByRole('cell');
    expect(cells[1].textContent).toContain('4.8mm/s');
    expect(cells[1].textContent).toContain('9/24');
  });

  it('录入实测值走接口；判定以后端返回为准（前端不自行判合格）', async () => {
    get.mockResolvedValue(makeSession());
    const after = makeSession({
      items: [
        item({ record: { itemKey: 'no_load_temp', value: 65, unit: '℃', maxLimit: 70, verdict: 'pass', at: '2026-10-18T02:00:00Z', by: TECH } as any, verdict: 'pass' }),
        ...makeSession().items.slice(1),
      ],
      pending: 3,
      failed: 0,
      allPassed: false,
    });
    check.mockResolvedValue(after);

    render(<AcceptancePanel orderId="wo-1" currentUser={TECH} />);
    await waitFor(() => expect(screen.getByTestId('acceptance-panel')).toBeTruthy());

    const input = screen.getByLabelText('空载运行 30 分钟，轴承温度 ≤ 70℃ 实测值') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '65' } });
    fireEvent.click(within(screen.getByTestId('acceptance-item-no_load_temp')).getByRole('button'));

    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    expect(check).toHaveBeenCalledWith('wo-1', { itemKey: 'no_load_temp', value: 65, confirmed: undefined });
    await waitFor(() => {
      expect(screen.getByTestId('acceptance-item-no_load_temp').getAttribute('data-verdict')).toBe('pass');
    });
  });

  it('前端不复算：后端返回 fail 就渲染超标（即使数值看似在范围内）', async () => {
    get.mockResolvedValue(makeSession());
    const after = makeSession({
      items: [
        makeSession().items[0],
        item({ itemKey: 'vibration', itemLabel: '设备振动值 ≤ 2.8mm/s', metric: 'vibration', unit: 'mm/s', maxLimit: 2.8, verdict: 'fail', record: { itemKey: 'vibration', value: 1.1, unit: 'mm/s' } as any }),
        ...makeSession().items.slice(2),
      ],
      failed: 1,
    });
    check.mockResolvedValue(after);

    render(<AcceptancePanel orderId="wo-1" currentUser={TECH} />);
    await waitFor(() => expect(screen.getByTestId('acceptance-panel')).toBeTruthy());
    const input = screen.getByLabelText('设备振动值 ≤ 2.8mm/s 实测值');
    fireEvent.change(input, { target: { value: '1.1' } });
    fireEvent.click(within(screen.getByTestId('acceptance-item-vibration')).getByRole('button'));

    await waitFor(() => {
      const card = screen.getByTestId('acceptance-item-vibration');
      expect(card.getAttribute('data-verdict')).toBe('fail');
      expect(card.textContent).toContain('超标');
    });
  });

  it('未填数值点「记录」→ 本地提示，不发请求', async () => {
    get.mockResolvedValue(makeSession());
    render(<AcceptancePanel orderId="wo-1" currentUser={TECH} />);
    await waitFor(() => expect(screen.getByTestId('acceptance-panel')).toBeTruthy());

    fireEvent.click(within(screen.getByTestId('acceptance-item-no_load_temp')).getByRole('button'));
    await waitFor(() => expect(screen.getByTestId('acceptance-notice').textContent).toContain('请先填写'));
    expect(check).not.toHaveBeenCalled();
  });

  it('未全部完成时不渲染签字按钮（先验收后签字）', async () => {
    get.mockResolvedValue(makeSession({ allPassed: false, nextSigner: null }));
    render(<AcceptancePanel orderId="wo-1" currentUser={TECH} />);
    await waitFor(() => expect(screen.getByTestId('acceptance-panel')).toBeTruthy());
    expect(screen.queryByTestId('acceptance-sign-technician')).toBeNull();
    expect(screen.getByText(/需先完成全部验收项/)).toBeTruthy();
  });

  it('全部合格后：维修人可签；班组长账号才可签下一步', async () => {
    const ready = makeSession({ allPassed: true, pending: 0, nextSigner: 'technician' });
    get.mockResolvedValue(ready);
    sign.mockResolvedValue({ ...ready, signatures: [{ step: 'technician', name: '张建国', userId: 'u-tech1', signedAt: '2026-10-18T03:00:00Z', signatureHash: 'aaaa1111bbbb2222' }], nextSigner: 'teamlead', justClosed: false, summaryRef: null });

    const { rerender } = render(<AcceptancePanel orderId="wo-1" currentUser={TECH} />);
    await waitFor(() => expect(screen.getByTestId('acceptance-sign-technician')).toBeTruthy());
    fireEvent.click(screen.getByTestId('acceptance-sign-technician'));

    await waitFor(() => expect(sign).toHaveBeenCalledWith('wo-1', { step: 'technician' }));
    await waitFor(() => {
      expect(screen.getByTestId('acceptance-signature-technician').getAttribute('data-signed')).toBe('yes');
    });
    // 签完维修人后，当前用户是 technician 角色 ⇒ 班组长按钮不可用
    const leadBtn = screen.getByTestId('acceptance-sign-teamlead') as HTMLButtonElement;
    expect(leadBtn.disabled).toBe(true);
    expect(screen.getByText(/不是班组长角色/)).toBeTruthy();

    rerender(<AcceptancePanel orderId="wo-1" currentUser={MANAGER} />);
    await waitFor(() => expect((screen.getByTestId('acceptance-sign-teamlead') as HTMLButtonElement).disabled).toBe(false));
  });

  it('同人不得兼签：维修人本身就是 manager 时，班组长按钮必须禁用', async () => {
    // 维修人签的是 manager 自己 ⇒ 即使他角色够格，也不能再签班组长
    const ready = makeSession({
      allPassed: true,
      pending: 0,
      nextSigner: 'teamlead',
      signatures: [{ step: 'technician', name: '陈主管', userId: 'u-manager', role: 'manager', roleTitle: '车间主管', signedAt: '2026-10-18T03:00:00Z', signatureHash: 'cccc3333dddd4444' }],
    });
    get.mockResolvedValue(ready);

    render(<AcceptancePanel orderId="wo-1" currentUser={MANAGER} />);
    await waitFor(() => expect(screen.getByTestId('acceptance-panel')).toBeTruthy());

    const btn = screen.getByTestId('acceptance-sign-teamlead') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/与已签字的维修人相同/)).toBeTruthy();
  });

  it('关单后：只读（无录入框/签字按钮），显示维修总结', async () => {
    const closed = makeSession({
      allPassed: true,
      pending: 0,
      canAccept: false,
      blockedReason: '工单已验收关单归档，验收记录只读回看。',
      closedAt: '2026-10-18T04:00:00Z',
      nextSigner: null,
      summary: { knowledgeId: 'kb-case-wo-1', title: '【维修案例】3# 轧机主传动行星减速箱 · 轴承失效（WO-20240902-001）', createdAt: '2026-10-18T04:00:00Z' },
      signatures: [
        { step: 'technician', name: '张建国', userId: 'u-tech1', signedAt: '2026-10-18T03:00:00Z', signatureHash: 'aaaa1111bbbb2222' },
        { step: 'teamlead', name: '陈主管', userId: 'u-manager', roleTitle: '车间主管', signedAt: '2026-10-18T04:00:00Z', signatureHash: 'eeee5555ffff6666' },
      ],
      items: makeSession().items.map((i) => (i.verdict === 'pending' ? { ...i, verdict: 'pass' } : i)),
    });
    get.mockResolvedValue(closed);

    render(<AcceptancePanel orderId="wo-1" currentUser={MANAGER} />);
    await waitFor(() => expect(screen.getByTestId('acceptance-panel')).toBeTruthy());

    expect(screen.getByTestId('acceptance-verdict-bar').getAttribute('data-state')).toBe('closed');
    expect(screen.queryByTestId('acceptance-sign-technician')).toBeNull();
    expect(screen.queryByTestId('acceptance-sign-teamlead')).toBeNull();
    // 关单后不再有可编辑输入框
    expect(screen.queryByLabelText('设备振动值 ≤ 2.8mm/s 实测值')).toBeNull();

    const sum = screen.getByTestId('acceptance-summary');
    expect(sum.getAttribute('data-knowledge-id')).toBe('kb-case-wo-1');
    expect(sum.textContent).toContain('维修案例');
    // 两人签字都在
    expect(screen.getByTestId('acceptance-signature-technician').getAttribute('data-signed')).toBe('yes');
    expect(screen.getByTestId('acceptance-signature-teamlead').getAttribute('data-signed')).toBe('yes');
  });

  it('检修中工单：显示真实阻塞原因，不出现任何录入控件', async () => {
    get.mockResolvedValue(
      makeSession({ canAccept: false, blockedReason: '现场维修尚未提交完工上报，先完成全部维修步骤再验收。', nextSigner: null })
    );
    render(<AcceptancePanel orderId="wo-1" currentUser={TECH} />);
    await waitFor(() => expect(screen.getByTestId('acceptance-panel')).toBeTruthy());
    expect(screen.getByTestId('acceptance-verdict-bar').textContent).toContain('现场维修尚未提交完工上报');
    expect(screen.queryByLabelText('空载运行 30 分钟，轴承温度 ≤ 70℃ 实测值')).toBeNull();
  });
});
