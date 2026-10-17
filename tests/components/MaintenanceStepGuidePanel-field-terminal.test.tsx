// @vitest-environment jsdom
/**
 * 拆解作业终端的前端闸门与留痕交互。
 *
 * 这里只验"前端是否如实反映服务端"：
 *   · LOTO 未确认 → 记录按钮不可点，且服务端 403 会反过来把弹窗顶出来；
 *   · 每点一次记录就把服务端返回的**整份会话**交还宿主（本地不自己算进度）；
 *   · 跳过 / 有问题必须写原因才发请求；
 *   · 完工卡片显示的完工时间、实际维修人、工时全部读服务端留档。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MaintenanceStepGuidePanel } from '../../src/components/equipment3d/MaintenanceStepGuidePanel';
import { FieldLotoConfirmDialog } from '../../src/components/equipment3d/FieldLotoConfirmDialog';
import { fieldOpsApi } from '../../src/api';
import type { FieldSessionData } from '../../src/api';

vi.mock('../../src/api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../src/api');
  return {
    ...actual,
    fieldOpsApi: {
      getSession: vi.fn(),
      confirmLoto: vi.fn(),
      recordStep: vi.fn(),
      addMeasurement: vi.fn(),
      addPartPhoto: vi.fn(),
    },
  };
});

const mockedApi = fieldOpsApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

const LOTO_ITEMS = [
  { key: 'loto_power_locked', label: '设备已断电、上锁挂牌（LOTO）' },
  { key: 'residual_energy_released', label: '残余压力/能量已释放' },
  { key: 'hazardous_parts_isolated', label: '高温/高压/转动部件已隔离' },
  { key: 'workzone_barricaded', label: '作业区域已设置警示围栏' },
];

function makeSession(overrides: Partial<FieldSessionData> = {}): FieldSessionData {
  return {
    deviceId: 'eq-103',
    order: {
      id: 'wo-20240902-001',
      orderNo: 'WO-20260902-101',
      title: '3# 轧机行星减速箱输入轴振动超标抢修',
      description: '',
      faultType: '机械振动',
      priority: 'urgent',
      status: 'in_progress',
      statusLabel: '检修中',
      createdAt: '2026-09-02T00:30:15.000Z',
      assignee: '张建国 (高级技师)',
      completedAt: null,
    },
    canOperate: true,
    blockedReason: null,
    lotoItems: LOTO_ITEMS,
    loto: null,
    steps: [
      { index: 1, text: '激光对中复核', matchedPart: null, state: null, recordable: false },
      {
        index: 2,
        text: '液压拆卸受损轴承',
        matchedPart: { posNo: 'BOM-07', name: '高速输入端精密轴承座法兰端盖' },
        state: null,
        recordable: false,
      },
    ],
    progress: { total: 2, done: 0, skipped: 0, issue: 0, remaining: 2, current: 1 },
    measurements: [],
    partPhotos: [],
    events: [],
    measurementItems: [],
    autoCompleted: null,
    version: 3,
    dataNote: '现场记录写入检修工单 repair_log.fieldLog。',
    ...overrides,
  } as FieldSessionData;
}

const lotoed = {
  confirmedAt: '2026-10-17T02:10:00.000Z',
  by: { name: '张建国', role: 'technician' },
  items: LOTO_ITEMS.map((i) => ({ ...i, confirmed: true })),
} as FieldSessionData['loto'];

function renderPanel(session: FieldSessionData | null, props: Partial<React.ComponentProps<typeof MaintenanceStepGuidePanel>> = {}) {
  const onRunStep = vi.fn();
  const onSessionChange = vi.fn();
  const onRequestLoto = vi.fn();
  render(
    <MaintenanceStepGuidePanel
      session={session}
      activeStepIndex={null}
      onRunStep={onRunStep}
      onSessionChange={onSessionChange}
      onRequestLoto={onRequestLoto}
      {...props}
    />
  );
  return { onRunStep, onSessionChange, onRequestLoto };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LOTO 闸门（未确认不能开始拆解操作）', () => {
  it('检修中但未确认：给出强提示、记录按钮全灰，点「去确认」打开弹窗', () => {
    const { onRequestLoto } = renderPanel(makeSession());
    expect(screen.getByTestId('equipment3d-step-guide-loto-gate').textContent).toContain('不能开始拆解操作记录');
    expect((screen.getByTestId('equipment3d-step-guide-done-1') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('equipment3d-step-guide-skip-2') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('equipment3d-step-guide-locked-1').textContent).toContain('需先完成 LOTO 安全确认');
    fireEvent.click(screen.getByTestId('equipment3d-step-guide-open-loto'));
    expect(onRequestLoto).toHaveBeenCalledTimes(1);
  });

  it('工单不在检修中：整页只读并原样透出服务端原因', () => {
    const session = makeSession({
      canOperate: false,
      loto: lotoed,
      blockedReason: '工单已完工上报，等待质检验收（现场记录只读回看）。',
    });
    renderPanel(session);
    expect(screen.getByTestId('equipment3d-step-guide-readonly').textContent).toContain('等待质检验收');
    expect(screen.getByTestId('equipment3d-step-guide-locked-1').textContent).toContain('工单不在检修中');
  });

  it('服务端 403（FIELD_LOTO_REQUIRED）→ 前端把闸门文案顶上并自动开弹窗，不静默失败', async () => {
    mockedApi.recordStep.mockRejectedValueOnce({ message: '禁止操作', data: { code: 'FIELD_LOTO_REQUIRED' } });
    const session = makeSession({ loto: lotoed, steps: makeSession({ loto: lotoed }).steps.map((s) => ({ ...s, recordable: true })) });
    const { onRequestLoto } = renderPanel(session);
    fireEvent.click(screen.getByTestId('equipment3d-step-guide-done-1'));
    await waitFor(() => expect(onRequestLoto).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('equipment3d-step-guide-error').textContent).toContain('安全确认未完成');
  });
});

describe('边拆边记：一次点击 = 一条工单留痕', () => {
  it('点「✅ 完成这一步」→ 按真实工单号与序号提交，并把服务端返回的整份会话交回宿主', async () => {
    const fresh = makeSession({
      loto: lotoed,
      steps: [
        {
          index: 1,
          text: '激光对中复核',
          matchedPart: null,
          state: { status: 'done', by: { name: '张建国' }, at: '2026-10-17T02:20:00.000Z', elapsedMin: 10 },
        },
        { index: 2, text: '液压拆卸受损轴承', matchedPart: { posNo: 'BOM-07', name: '端盖' }, state: null },
      ],
      progress: { total: 2, done: 1, skipped: 0, issue: 0, remaining: 1, current: 2 },
      events: [{ at: '2026-10-17T02:20:00.000Z', kind: 'step', text: '步骤 1「激光对中复核」完成，距上一记录 10 分钟。', by: '张建国' }],
    } as Partial<FieldSessionData>);
    mockedApi.recordStep.mockResolvedValueOnce(fresh);
    const { onSessionChange } = renderPanel(makeSession({ loto: lotoed }));

    fireEvent.click(screen.getByTestId('equipment3d-step-guide-done-1'));
    await waitFor(() => expect(mockedApi.recordStep).toHaveBeenCalledWith('wo-20240902-001', { index: 1, action: 'done', note: undefined }));
    await waitFor(() => expect(onSessionChange).toHaveBeenCalledWith(fresh));
    // 面板不做本地乐观计数：宿主页收到服务端回包后重传，界面才跳到第 2 步
    expect(screen.getByTestId('equipment3d-step-guide-current').textContent).toContain('第 1 步');
    renderPanel(fresh);
    expect(screen.getAllByTestId('equipment3d-step-guide-current')[1].textContent).toContain('第 2 步');
  });

  it('点「跳过」：不写原因不发请求，写了原因才落一条带备注的留痕', async () => {
    const { onSessionChange } = renderPanel(makeSession({ loto: lotoed }));
    fireEvent.click(screen.getByTestId('equipment3d-step-guide-skip-2'));
    expect(screen.getByTestId('equipment3d-step-guide-note-form-2')).toBeTruthy();
    expect((screen.getByTestId('equipment3d-step-guide-note-submit-2') as HTMLButtonElement).disabled).toBe(true);
    expect(mockedApi.recordStep).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('equipment3d-step-guide-note-input-2'), {
      target: { value: '该步由上一班次完成，已核对无异常' },
    });
    const after = makeSession({
      loto: lotoed,
      steps: [
        { index: 1, text: '激光对中复核', matchedPart: null, state: null },
        {
          index: 2,
          text: '液压拆卸受损轴承',
          matchedPart: { posNo: 'BOM-07', name: '端盖' },
          state: { status: 'skip', note: '该步由上一班次完成，已核对无异常', by: { name: '张建国' }, at: '2026-10-17T02:25:00.000Z', elapsedMin: 5 },
        },
      ],
      progress: { total: 2, done: 0, skipped: 1, issue: 0, remaining: 1, current: 1 },
    } as Partial<FieldSessionData>);
    mockedApi.recordStep.mockResolvedValueOnce(after);
    fireEvent.click(screen.getByTestId('equipment3d-step-guide-note-submit-2'));
    await waitFor(() =>
      expect(mockedApi.recordStep).toHaveBeenCalledWith('wo-20240902-001', {
        index: 2,
        action: 'skip',
        note: '该步由上一班次完成，已核对无异常',
      })
    );
    await waitFor(() => expect(onSessionChange).toHaveBeenCalledWith(after));
  });

  it('汇总条如实显示总步数 / 已完成 / 还剩 / 进行到（全部取服务端 progress）', () => {
    renderPanel(
      makeSession({
        progress: { total: 5, done: 3, skipped: 1, issue: 0, remaining: 1, current: 5 },
      })
    );
    const summary = screen.getByTestId('equipment3d-step-guide-summary');
    expect(summary.textContent).toContain('5');
    expect(summary.textContent).toContain('总步骤');
    expect(summary.textContent).toContain('还剩');
    expect(screen.getByTestId('equipment3d-step-guide-current').textContent).toContain('第 5 步');
  });

  it('自动完工卡片：完工时间 / 实际维修人 / 工时读服务端留档，不显示假数字', () => {
    renderPanel(
      makeSession({
        canOperate: false,
        loto: lotoed,
        autoCompleted: { at: '2026-10-17T03:00:00.000Z', by: '张建国', workHours: 2.5, total: 2, done: 1, skipped: 1 },
      } as Partial<FieldSessionData>)
    );
    const card = screen.getByTestId('equipment3d-step-guide-complete');
    expect(card.textContent).toContain('维修流程结束 · 工单已自动完工');
    expect(card.textContent).toContain('张建国');
    expect(card.textContent).toContain('2.5 h');
    expect(card.textContent).toContain('repair_log.fieldLog');
  });

  it('时间线：按服务端事件条数显示，展开可回放每条留痕', () => {
    renderPanel(
      makeSession({
        loto: lotoed,
        events: [
          { at: '2026-10-17T02:10:00.000Z', kind: 'loto', text: 'LOTO 四项全部通过。', by: '张建国' },
          { at: '2026-10-17T02:20:00.000Z', kind: 'step', text: '步骤 1 完成。', by: '张建国' },
        ],
      } as Partial<FieldSessionData>)
    );
    expect(screen.getByTestId('equipment3d-step-guide-timeline-toggle').textContent).toContain('2 条留痕');
    fireEvent.click(screen.getByTestId('equipment3d-step-guide-timeline-toggle'));
    expect(screen.getByTestId('equipment3d-step-guide-timeline-list').textContent).toContain('LOTO 四项全部通过');
  });
});

describe('LOTO 确认弹窗', () => {
  function renderDialog(session: FieldSessionData, props: Partial<React.ComponentProps<typeof FieldLotoConfirmDialog>> = {}) {
    const onClose = vi.fn();
    const onConfirmed = vi.fn();
    const onDecline = vi.fn();
    render(
      <FieldLotoConfirmDialog session={session} open onClose={onClose} onConfirmed={onConfirmed} onDecline={onDecline} {...props} />
    );
    return { onClose, onConfirmed, onDecline };
  }

  it('清单只渲染服务端下发的四项；没勾满之前「确认」按钮不可点', () => {
    const { onConfirmed } = renderDialog(makeSession());
    for (const item of LOTO_ITEMS) {
      expect(screen.getByTestId(`equipment3d-loto-item-${item.key}`).textContent).toContain(item.label);
    }
    expect(screen.getByTestId('equipment3d-loto-count').textContent).toContain('0/4');
    expect((screen.getByTestId('equipment3d-loto-confirm') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId('equipment3d-loto-item-loto_power_locked'));
    expect((screen.getByTestId('equipment3d-loto-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect(mockedApi.confirmLoto).not.toHaveBeenCalled();
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it('四项勾满 → 提交四项 confirmed:true，成功后把服务端会话交还宿主', async () => {
    const confirmedSession = makeSession({ loto: lotoed });
    mockedApi.confirmLoto.mockResolvedValueOnce(confirmedSession);
    const { onConfirmed } = renderDialog(makeSession());
    for (const item of LOTO_ITEMS) fireEvent.click(screen.getByTestId(`equipment3d-loto-item-${item.key}`));
    expect(screen.getByTestId('equipment3d-loto-count').textContent).toContain('4/4');
    fireEvent.click(screen.getByTestId('equipment3d-loto-confirm'));
    await waitFor(() => expect(mockedApi.confirmLoto).toHaveBeenCalledTimes(1));
    expect(mockedApi.confirmLoto.mock.calls[0][0]).toBe('wo-20240902-001');
    expect(mockedApi.confirmLoto.mock.calls[0][1]).toEqual(LOTO_ITEMS.map((i) => ({ ...i, confirmed: true })));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith(confirmedSession));
  });

  it('已确认过的工单：只给留档与「继续作业」，不重复制造确认记录', () => {
    renderDialog(makeSession({ loto: lotoed }));
    expect(screen.getByTestId('equipment3d-loto-already').textContent).toContain('LOTO 安全确认已完成');
    expect(screen.queryByTestId('equipment3d-loto-confirm')).toBeNull();
    fireEvent.click(screen.getByTestId('equipment3d-loto-close'));
    expect(mockedApi.confirmLoto).not.toHaveBeenCalled();
  });

  it('放弃作业：走 onDecline，服务端一个字段都不写', () => {
    const { onDecline } = renderDialog(makeSession());
    fireEvent.click(screen.getByTestId('equipment3d-loto-decline'));
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(mockedApi.confirmLoto).not.toHaveBeenCalled();
  });

  it('关掉再打开必须清空勾选：留痕要求当场逐条确认，不能记住上次的勾', () => {
    const props = { session: makeSession(), onClose: vi.fn(), onConfirmed: vi.fn(), onDecline: vi.fn() };
    const view = render(<FieldLotoConfirmDialog {...props} open />);
    fireEvent.click(screen.getByTestId('equipment3d-loto-item-loto_power_locked'));
    fireEvent.click(screen.getByTestId('equipment3d-loto-item-residual_energy_released'));
    expect(screen.getByTestId('equipment3d-loto-count').textContent).toContain('2/4');

    view.rerender(<FieldLotoConfirmDialog {...props} open={false} />);
    expect(screen.queryByTestId('equipment3d-loto-dialog')).toBeNull();
    view.rerender(<FieldLotoConfirmDialog {...props} open />);
    expect(screen.getByTestId('equipment3d-loto-count').textContent).toContain('0/4');
    expect(screen.getByTestId('equipment3d-loto-item-loto_power_locked').getAttribute('aria-pressed')).toBe('false');
  });

  it('工单不可操作时弹窗原样透出服务端原因', () => {
    renderDialog(makeSession({ canOperate: false, blockedReason: '该设备当前没有检修中的检修工单。' }));
    expect(screen.getByTestId('equipment3d-loto-blocked').textContent).toContain('没有检修中');
  });
});
