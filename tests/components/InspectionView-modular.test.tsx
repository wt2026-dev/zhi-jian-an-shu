// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { InspectionView } from '../../src/components/InspectionView';
import { InspectionTask, UserProfile, Equipment } from '../../src/types';

vi.mock('../../src/context/ToastContext', () => ({
  useToast: () => ({ show: vi.fn() }),
}));

vi.mock('../../src/api', () => ({
  aiApi: {
    generateReport: vi.fn().mockResolvedValue({ success: true, report: { title: 'AI 巡检报告', summary: '良好' } }),
    generateWorkOrder: vi.fn().mockResolvedValue({ success: true, draft: { title: '工单草稿' } }),
  },
  hazardsApi: {
    create: vi.fn().mockResolvedValue({ success: true }),
  },
}));

const mockCurrentUser: UserProfile = {
  id: 'USR-001',
  name: '张巡检',
  role: 'inspector',
  roleTitle: '专职点检员',
  department: '动力车间',
  phone: '13800000001',
};

const mockEquipments = [
  {
    id: 'EQ-001',
    code: 'EQ-001-CODE',
    name: '1号循环水泵',
    category: '泵类设备',
    model: 'ISG80-160',
    location: '水泵房A区',
    workshop: '动力车间',
    status: 'running',
    healthScore: 92,
  },
  {
    id: 'EQ-002',
    code: 'EQ-002-CODE',
    name: '2号空压机',
    category: '压缩机',
    model: 'SA-75A',
    location: '空压机房',
    workshop: '动力车间',
    status: 'warning',
    healthScore: 68,
  },
] as unknown as Equipment[];

const mockInspections = [
  {
    id: 'TASK-001',
    taskNo: 'INSP-2026-001',
    title: '动力车间日常点检路线',
    route: '动力车间水泵区 -> 空压站',
    inspectorId: 'USR-001',
    inspectorName: '张巡检',
    scheduledDate: '2026-03-10',
    workshop: '动力车间',
    type: 'daily',
    totalPoints: 2,
    completedPoints: 1,
    abnormalCount: 1,
    status: 'in_progress',
    items: [
      {
        id: 'PT-001',
        equipmentId: 'EQ-001',
        equipmentCode: 'EQ-001-CODE',
        equipmentName: '1号循环水泵',
        location: '水泵房A区',
        method: '测温仪',
        checkPoint: '电机前端轴承温度',
        standard: '≤ 65℃',
        maxLimit: 65,
        unit: '℃',
        recordedValue: 58.2,
        isPass: true,
        status: 'normal',
      },
      {
        id: 'PT-002',
        equipmentId: 'EQ-002',
        equipmentCode: 'EQ-002-CODE',
        equipmentName: '2号空压机',
        location: '空压机房',
        method: '压力表',
        checkPoint: '排气压力',
        standard: '0.7~0.85 MPa',
        maxLimit: 0.85,
        minLimit: 0.7,
        unit: 'MPa',
        recordedValue: 0.95,
        isPass: false,
        status: 'abnormal',
        notes: '排气压力超高',
      },
    ],
  },
  {
    id: 'TASK-002',
    taskNo: 'INSP-2026-002',
    title: '配电室周度专项点检',
    route: '1#高压配电室 -> 变压器室',
    inspectorId: 'USR-002',
    inspectorName: '李电工',
    scheduledDate: '2026-03-11',
    workshop: '配电车间',
    type: 'weekly',
    totalPoints: 4,
    completedPoints: 4,
    abnormalCount: 0,
    status: 'completed',
    items: [],
  },
] as unknown as InspectionTask[];

describe('InspectionView Modular Component Suite', () => {
  const onUpdateInspection = vi.fn();
  const onConvertAbnormalToWorkOrder = vi.fn();
  const onCreateWorkOrder = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders top KPI cards and current inspector tag', () => {
    render(
      <InspectionView
        currentUser={mockCurrentUser}
        inspections={mockInspections}
        equipments={mockEquipments}
        onUpdateInspection={onUpdateInspection}
        onConvertAbnormalToWorkOrder={onConvertAbnormalToWorkOrder}
        onCreateWorkOrder={onCreateWorkOrder}
      />
    );

    expect(screen.getByText('工业设备点巡检作业与异常一键闭环')).toBeInTheDocument();
    expect(screen.getByText(/张巡检 \(专职点检员\)/)).toBeInTheDocument();
    expect(screen.getByText('今日巡检测点')).toBeInTheDocument();
    expect(screen.getByText('打卡完成率')).toBeInTheDocument();
    expect(screen.getByText('发现异常测点')).toBeInTheDocument();
  });

  it('filters task list when toggling "只看我的任务"', () => {
    render(
      <InspectionView
        currentUser={mockCurrentUser}
        inspections={mockInspections}
        equipments={mockEquipments}
        onUpdateInspection={onUpdateInspection}
        onConvertAbnormalToWorkOrder={onConvertAbnormalToWorkOrder}
        onCreateWorkOrder={onCreateWorkOrder}
      />
    );

    // Initial inspector role defaults to only my tasks
    expect(screen.getByText('动力车间日常点检路线')).toBeInTheDocument();
    expect(screen.queryByText('配电室周度专项点检')).not.toBeInTheDocument();

    // Toggle filter
    const toggleBtn = screen.getByRole('button', { name: /只看我的任务/ });
    fireEvent.click(toggleBtn);

    // Now all tasks should show
    expect(screen.getByText('配电室周度专项点检')).toBeInTheDocument();
  });

  it('renders inspection points table and triggers reading record modal', async () => {
    render(
      <InspectionView
        currentUser={mockCurrentUser}
        inspections={mockInspections}
        equipments={mockEquipments}
        onUpdateInspection={onUpdateInspection}
        onConvertAbnormalToWorkOrder={onConvertAbnormalToWorkOrder}
        onCreateWorkOrder={onCreateWorkOrder}
      />
    );

    expect(screen.getByText('电机前端轴承温度')).toBeInTheDocument();
    expect(screen.getByText('排气压力')).toBeInTheDocument();

    // Click "修改读数" on the first item
    const readingButtons = screen.getAllByRole('button', { name: /修改读数/ });
    fireEvent.click(readingButtons[0]);

    // Modal should appear
    expect(screen.getByText('现场测点打卡与仪表抄表')).toBeInTheDocument();
    expect(screen.getByText('保存测点打卡')).toBeInTheDocument();

    // Save reading
    fireEvent.click(screen.getByRole('button', { name: /保存测点打卡/ }));

    await waitFor(() => {
      expect(onUpdateInspection).toHaveBeenCalled();
    });
  });

  it('triggers conversion to work order for abnormal point', () => {
    render(
      <InspectionView
        currentUser={mockCurrentUser}
        inspections={mockInspections}
        equipments={mockEquipments}
        onUpdateInspection={onUpdateInspection}
        onConvertAbnormalToWorkOrder={onConvertAbnormalToWorkOrder}
        onCreateWorkOrder={onCreateWorkOrder}
      />
    );

    const convertBtn = screen.getByRole('button', { name: /转工单/ });
    fireEvent.click(convertBtn);

    expect(onConvertAbnormalToWorkOrder).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'PT-002', checkPoint: '排气压力' }),
      '2号空压机'
    );
  });

  it('opens and closes the QR scanner modal', () => {
    render(
      <InspectionView
        currentUser={mockCurrentUser}
        inspections={mockInspections}
        equipments={mockEquipments}
        onUpdateInspection={onUpdateInspection}
        onConvertAbnormalToWorkOrder={onConvertAbnormalToWorkOrder}
        onCreateWorkOrder={onCreateWorkOrder}
      />
    );

    const qrBtn = screen.getByRole('button', { name: /扫码直达巡检/ });
    fireEvent.click(qrBtn);

    expect(screen.getByText('设备二维码扫码识别')).toBeInTheDocument();
    expect(screen.getByText('手动选择设备')).toBeInTheDocument();

    // Close button
    const closeBtn = screen.getByRole('button', { name: /关闭/ });
    fireEvent.click(closeBtn);

    expect(screen.queryByText('设备二维码扫码识别')).not.toBeInTheDocument();
  });
});
