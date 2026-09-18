// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { RepairStepCard } from '../src/components/equipment3d/RepairStepCard';
import type { WorkOrder, Equipment } from '../src/types';

describe('RepairStepCard component', () => {
  const sampleOrder: WorkOrder = {
    id: 'wo-test-101',
    orderNo: 'WO-2026-TEST',
    title: '给水泵轴承过热排查',
    equipmentId: 'eq-101',
    equipmentName: '1# 离心主循环给水泵',
    equipmentCode: 'PUMP-101',
    workshop: '动力车间',
    faultType: '轴承过热',
    priority: 'urgent',
    status: 'in_progress',
    creator: '张工',
    dispatcher: '李调度',
    assignee: '王技师',
    createdAt: '2026-09-16 10:00:00',
    description: '巡检发现轴承外圈红外测温达82℃，伴随微弱杂音。',
    safetyRequirements: ['佩戴防护眼镜', '执行LOTO断电上锁'],
    repairLog: {
      causeAnalysis: '润滑脂乳化变质，轴承滚动体微量磨损',
      resolutionSteps: '1. 停机上锁并红外复测温度\n2. 清除旧润滑脂并清洗轴承箱\n3. 注入耐高温复合锂基脂\n4. 试运转30分钟复测温升',
      partsUsed: [],
      workHours: 2.5,
      completionPhotos: [],
    },
  };

  it('renders work order details correctly', () => {
    const onClose = vi.fn();
    const onFocus = vi.fn();
    render(<RepairStepCard workOrder={sampleOrder} onClose={onClose} onFocusDevice={onFocus} />);

    expect(screen.getByText('WO-2026-TEST')).toBeTruthy();
    expect(screen.getByText('给水泵轴承过热排查')).toBeTruthy();
    expect(screen.getByText('1# 离心主循环给水泵')).toBeTruthy();
    expect(screen.getByText('李调度')).toBeTruthy();
    expect(screen.getByText('王技师')).toBeTruthy();
    expect(screen.getByText(/巡检发现轴承外圈红外测温达82℃/)).toBeTruthy();
    expect(screen.getByText(/润滑脂乳化变质/)).toBeTruthy();
    expect(screen.getByText('佩戴防护眼镜')).toBeTruthy();
  });

  it('parses custom resolution steps into list', () => {
    render(<RepairStepCard workOrder={sampleOrder} onClose={vi.fn()} />);

    expect(screen.getByText('工单执行排查步骤')).toBeTruthy();
    expect(screen.getByText('停机上锁并红外复测温度')).toBeTruthy();
    expect(screen.getByText('清除旧润滑脂并清洗轴承箱')).toBeTruthy();
    expect(screen.getByText('注入耐高温复合锂基脂')).toBeTruthy();
    expect(screen.getByText('试运转30分钟复测温升')).toBeTruthy();
  });

  it('falls back to standard operating procedures when no custom steps exist', () => {
    const orderWithoutSteps: WorkOrder = {
      ...sampleOrder,
      repairLog: undefined,
    };
    render(<RepairStepCard workOrder={orderWithoutSteps} onClose={vi.fn()} />);

    expect(screen.getByText('关联标准化作业指引要点')).toBeTruthy();
    expect(screen.getByText(/设备停机静置降温/)).toBeTruthy();
  });

  it('calls onClose and onFocusDevice callbacks', async () => {
    const onClose = vi.fn();
    const onFocus = vi.fn();
    render(<RepairStepCard workOrder={sampleOrder} onClose={onClose} onFocusDevice={onFocus} />);

    const focusBtn = screen.getByText('聚焦设备');
    await userEvent.click(focusBtn);
    expect(onFocus).toHaveBeenCalledTimes(1);

    const closeBtn = screen.getByText('关闭');
    await userEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Equipment Work Order Status Priority Aggregation Logic', () => {
  function aggregateStatus(orders: Array<{ status: string }>): 'pending' | 'in_progress' | 'completed' | null {
    if (!orders.length) return null;
    if (orders.some((o) => o.status === 'created' || o.status === 'dispatched')) {
      return 'pending';
    }
    if (orders.some((o) => o.status === 'in_progress' || o.status === 'pending_acceptance')) {
      return 'in_progress';
    }
    if (orders.some((o) => o.status === 'completed')) {
      return 'completed';
    }
    return null;
  }

  it('maps created and dispatched to pending (highest priority)', () => {
    expect(aggregateStatus([{ status: 'created' }])).toBe('pending');
    expect(aggregateStatus([{ status: 'dispatched' }])).toBe('pending');
    expect(aggregateStatus([{ status: 'completed' }, { status: 'created' }])).toBe('pending');
    expect(aggregateStatus([{ status: 'in_progress' }, { status: 'dispatched' }])).toBe('pending');
  });

  it('maps in_progress and pending_acceptance to in_progress', () => {
    expect(aggregateStatus([{ status: 'in_progress' }])).toBe('in_progress');
    expect(aggregateStatus([{ status: 'pending_acceptance' }])).toBe('in_progress');
    expect(aggregateStatus([{ status: 'completed' }, { status: 'in_progress' }])).toBe('in_progress');
  });

  it('maps completed to completed when no pending or in_progress', () => {
    expect(aggregateStatus([{ status: 'completed' }])).toBe('completed');
  });

  it('returns null when no active orders or only cancelled', () => {
    expect(aggregateStatus([])).toBeNull();
    expect(aggregateStatus([{ status: 'cancelled' }])).toBeNull();
  });
});
