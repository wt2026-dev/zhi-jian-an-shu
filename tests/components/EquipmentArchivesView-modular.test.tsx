// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { EquipmentArchivesView } from '../../src/components/EquipmentArchivesView';
import { equipmentApi, aiApi } from '../../src/api';
import { Equipment, UserProfile } from '../../src/types';

vi.mock('../../src/api', () => ({
  equipmentApi: {
    create: vi.fn(),
  },
  aiApi: {
    equipmentSummary: vi.fn(),
  },
}));

// Mock global fetch for wechat token check
global.fetch = vi.fn().mockResolvedValue({
  json: () => Promise.resolve({ configured: true }),
} as any);

const mockAdminUser: UserProfile = {
  id: 'u-admin',
  name: '设备厂长',
  role: 'admin',
  roleTitle: '设备总监',
  department: '生产设备部',
  phone: '13900000001',
};

const mockEquipments: Equipment[] = [
  {
    id: 'eq-101',
    code: 'PUMP-101',
    name: '1# 循环水主泵',
    type: '离心泵',
    category: '泵类设备',
    workshop: '一号动力车间',
    location: 'A区-01机位',
    status: 'running',
    healthScore: 92,
    criticality: '关键核心',
    installDate: '2023-05-10',
    manufacturer: '凯泉泵业',
    model: 'KQ-PUMP-500',
    specs: { '额定扬程': '45m', '额定流量': '320m³/h' },
    maintenanceHistory: [
      {
        id: 'rec-1',
        orderNo: 'WO-2026-001',
        date: '2026-01-10',
        type: '定期大修',
        technician: '张技师',
        cost: 3500,
        durationHours: 6,
        summary: '更换主轴承与填料密封',
        partsReplaced: ['6312轴承'],
      },
    ],
    nextInspectionDate: '2026-10-30',
    qrCode: 'QR-PUMP-101',
    telemetry: {
      temperature: 52,
      vibration: 2.1,
      voltage: 380,
      current: 45,
      loadRate: 80,
      lastUpdated: '2026-10-18T00:00:00Z',
    },
  },
  {
    id: 'eq-102',
    code: 'COMP-201',
    name: '2# 螺杆式空压机',
    type: '螺杆机',
    category: '压缩机',
    workshop: '储运与气体动力站',
    location: '压缩机房',
    status: 'warning',
    healthScore: 72,
    criticality: '主要生产',
    installDate: '2022-08-15',
    manufacturer: '阿特拉斯',
    model: 'GA-75VSD',
    specs: { '排气压力': '0.85MPa' },
    maintenanceHistory: [],
    nextInspectionDate: '2026-10-22',
    qrCode: 'QR-COMP-201',
    telemetry: {
      temperature: 78,
      vibration: 3.8,
      voltage: 380,
      current: 110,
      loadRate: 85,
      lastUpdated: '2026-10-18T00:00:00Z',
    },
  },
];

describe('EquipmentArchivesView 模块化重构验证', () => {
  const onAddEquipment = vi.fn();
  const onUpdateEquipment = vi.fn();
  const onDeleteEquipment = vi.fn();
  const onOpenWorkOrder = vi.fn();
  const onOpenAiDiagnose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (equipmentApi.create as any).mockImplementation((data) =>
      Promise.resolve({
        id: 'eq-new-999',
        healthScore: 90,
        maintenanceHistory: [],
        nextInspectionDate: '2026-11-01',
        qrCode: 'QR-NEW',
        telemetry: { temperature: 30, vibration: 0.5, voltage: 380, current: 0, loadRate: 0, lastUpdated: '' },
        ...data,
      })
    );
    (aiApi.equipmentSummary as any).mockResolvedValue({
      success: true,
      summary: {
        healthOverview: '运行平稳，轻度磨损',
        riskFactors: ['轴承温度接近关注线'],
        recommendations: ['补充高温润滑油脂'],
      },
    });
  });

  it('1. 完整渲染页头、设备数量统计与卡片列表', async () => {
    render(
      <EquipmentArchivesView
        currentUser={mockAdminUser}
        equipments={mockEquipments}
        onAddEquipment={onAddEquipment}
        onUpdateEquipment={onUpdateEquipment}
        onDeleteEquipment={onDeleteEquipment}
        onOpenWorkOrderForEquipment={onOpenWorkOrder}
        onOpenAiDiagnoseForEquipment={onOpenAiDiagnose}
      />
    );

    expect(screen.getByText('工业设备资产档案与全生命周期台账')).toBeInTheDocument();
    expect(screen.getByText('新增设备档案')).toBeInTheDocument();
    expect(screen.getByText('1# 循环水主泵')).toBeInTheDocument();
    expect(screen.getByText('2# 螺杆式空压机')).toBeInTheDocument();
  });

  it('2. 支持卡片视图与表格视图自由切换', async () => {
    render(
      <EquipmentArchivesView
        currentUser={mockAdminUser}
        equipments={mockEquipments}
        onAddEquipment={onAddEquipment}
        onUpdateEquipment={onUpdateEquipment}
        onDeleteEquipment={onDeleteEquipment}
        onOpenWorkOrderForEquipment={onOpenWorkOrder}
        onOpenAiDiagnoseForEquipment={onOpenAiDiagnose}
      />
    );

    expect(screen.getByText('卡片视图')).toBeInTheDocument();
    expect(screen.getByText('表格视图')).toBeInTheDocument();

    fireEvent.click(screen.getByText('表格视图'));
    expect(screen.getByText('位号编码')).toBeInTheDocument();
    expect(screen.getByText('关键遥测 (温/振/电)')).toBeInTheDocument();

    fireEvent.click(screen.getByText('卡片视图'));
    expect(screen.queryByText('关键遥测 (温/振/电)')).not.toBeInTheDocument();
  });

  it('3. 搜索与车间/分类/状态过滤交互', async () => {
    render(
      <EquipmentArchivesView
        currentUser={mockAdminUser}
        equipments={mockEquipments}
        onAddEquipment={onAddEquipment}
        onUpdateEquipment={onUpdateEquipment}
        onDeleteEquipment={onDeleteEquipment}
        onOpenWorkOrderForEquipment={onOpenWorkOrder}
        onOpenAiDiagnoseForEquipment={onOpenAiDiagnose}
      />
    );

    const searchInput = screen.getByPlaceholderText(/搜索设备名称、位号编码/);
    fireEvent.change(searchInput, { target: { value: '螺杆' } });

    expect(screen.queryByText('1# 循环水主泵')).not.toBeInTheDocument();
    expect(screen.getByText('2# 螺杆式空压机')).toBeInTheDocument();

    // Clear search
    fireEvent.change(searchInput, { target: { value: '' } });
    expect(screen.getByText('1# 循环水主泵')).toBeInTheDocument();
  });

  it('4. 点击设备卡片展开详细档案抽屉与扫码报修区块', async () => {
    render(
      <EquipmentArchivesView
        currentUser={mockAdminUser}
        equipments={mockEquipments}
        onAddEquipment={onAddEquipment}
        onUpdateEquipment={onUpdateEquipment}
        onDeleteEquipment={onDeleteEquipment}
        onOpenWorkOrderForEquipment={onOpenWorkOrder}
        onOpenAiDiagnoseForEquipment={onOpenAiDiagnose}
      />
    );

    fireEvent.click(screen.getByText('1# 循环水主泵'));

    expect(screen.getByText('基础制造与安装参数')).toBeInTheDocument();
    expect(screen.getByText('实时遥测数据流 (IoT Gateway)')).toBeInTheDocument();
    expect(screen.getByText('关键技术规格与易损备件标准')).toBeInTheDocument();
    expect(screen.getByText('设备专属扫码报修码')).toBeInTheDocument();

    // Open AI summary
    const aiSummaryBtn = screen.getByText('AI 健康画像');
    fireEvent.click(aiSummaryBtn);

    await waitFor(() => {
      expect(aiApi.equipmentSummary).toHaveBeenCalledWith({ equipmentId: 'eq-101' });
    });
  });

  it('5. 管理员点击新增设备档案并成功提交', async () => {
    render(
      <EquipmentArchivesView
        currentUser={mockAdminUser}
        equipments={mockEquipments}
        onAddEquipment={onAddEquipment}
        onUpdateEquipment={onUpdateEquipment}
        onDeleteEquipment={onDeleteEquipment}
        onOpenWorkOrderForEquipment={onOpenWorkOrder}
        onOpenAiDiagnoseForEquipment={onOpenAiDiagnose}
      />
    );

    fireEvent.click(screen.getByText('新增设备档案'));
    expect(screen.getByText('录入新工业设备资产档案')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/例如: 2#循环水冷却泵/), {
      target: { value: '3# 液压柱塞泵' },
    });
    fireEvent.change(screen.getByPlaceholderText(/例如: PUMP-B202/), {
      target: { value: 'PUMP-H303' },
    });

    fireEvent.click(screen.getByText('保存建档'));

    await waitFor(() => {
      expect(equipmentApi.create).toHaveBeenCalledWith(expect.objectContaining({
        name: '3# 液压柱塞泵',
        code: 'PUMP-H303',
      }));
      expect(onAddEquipment).toHaveBeenCalled();
    });
  });
});
