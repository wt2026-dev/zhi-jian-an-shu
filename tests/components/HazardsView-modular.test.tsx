// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { HazardsView } from '../../src/components/HazardsView';
import { hazardsApi } from '../../src/api';
import { Equipment, Hazard, UserProfile } from '../../src/types';

vi.mock('../../src/api', () => ({
  hazardsApi: {
    list: vi.fn(),
    getMetrics: vi.fn(),
    create: vi.fn(),
    assign: vi.fn(),
    verify: vi.fn(),
    update: vi.fn(),
  },
  equipmentApi: {
    list: vi.fn(),
  },
}));

const mockCurrentUser: UserProfile = {
  id: 'u-admin',
  name: '安全主管张三',
  role: 'manager',
  roleTitle: '安全环保主管',
  department: '安全环保部',
  phone: '13800000001',
};

const mockUsers: UserProfile[] = [
  mockCurrentUser,
  {
    id: 'u-tech1',
    name: '李技师',
    role: 'technician',
    roleTitle: '机械维保技师',
    department: '维保车间',
    phone: '13800000002',
  },
];

const mockEquipments: Equipment[] = [
  {
    id: 'eq-101',
    code: 'EQ-001',
    name: '1# 高压循环泵',
    type: '离心泵',
    category: '泵类设备',
    workshop: '一号车间',
    location: '循环泵房',
    status: 'running',
    healthScore: 88,
    criticality: '关键核心',
    installDate: '2022-01-01',
    manufacturer: '泵业制造',
    model: 'PUMP-500',
    specs: {},
    maintenanceHistory: [],
    nextInspectionDate: '2026-10-20',
    qrCode: 'QR-EQ-001',
    telemetry: {
      temperature: 45,
      vibration: 1.2,
      voltage: 380,
      current: 25,
      loadRate: 75,
      lastUpdated: '2026-10-18T00:00:00Z',
    },
  },
];

const mockHazards: Hazard[] = [
  {
    id: 'haz-001',
    code: 'HAZ-2026-001',
    title: '主循环泵轴承箱剧烈温升伴随异响',
    level: 'major',
    category: '机械安全',
    equipment_id: 'eq-101',
    equipment_name: '1# 高压循环泵',
    location: '循环泵房',
    description: '轴承温度持续上升至 82℃，接近跳停阈值',
    status: 'pending',
    reported_by: '张点检',
    deadline: '2026-10-19',
    created_at: '2026-10-18T08:00:00Z',
  },
  {
    id: 'haz-002',
    code: 'HAZ-2026-002',
    title: '法兰接头轻微油污渗漏',
    level: 'general',
    category: '腐蚀渗漏',
    equipment_id: 'eq-101',
    equipment_name: '1# 高压循环泵',
    location: '循环泵房',
    description: '密封垫片轻微渗油，需更换垫圈',
    status: 'verifying',
    reported_by: '李巡检',
    deadline: '2026-10-25',
    rectifier: '李技师',
    rectify_desc: '已更换耐油耐磨垫圈',
    created_at: '2026-10-17T08:00:00Z',
  },
];

const mockMetrics = {
  total: 2,
  closed: 0,
  major: 1,
  pending: 1,
  rectifying: 0,
};

describe('HazardsView 模块化重构验证', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (hazardsApi.list as any).mockResolvedValue(mockHazards);
    (hazardsApi.getMetrics as any).mockResolvedValue(mockMetrics);
    (hazardsApi.create as any).mockImplementation((data) =>
      Promise.resolve({
        id: 'haz-new-001',
        created_at: new Date().toISOString(),
        status: 'pending',
        ...data,
      })
    );
    (hazardsApi.assign as any).mockImplementation((id, data) =>
      Promise.resolve({
        hazard: {
          ...mockHazards[0],
          status: 'rectifying',
          work_order_id: 'WO-999',
          rectifier: '李技师',
        },
      })
    );
    (hazardsApi.verify as any).mockImplementation((id, data) =>
      Promise.resolve({
        hazard: {
          ...mockHazards[1],
          status: 'closed',
          verifier: data.verifier,
          verify_comment: data.comment,
        },
      })
    );
  });

  it('1. 完整渲染页头、KPI 指标卡与隐患列表', async () => {
    render(
      <HazardsView
        currentUser={mockCurrentUser}
        equipments={mockEquipments}
        allUsers={mockUsers}
      />
    );

    expect(screen.getByText('现场安全隐患闭环治理中枢')).toBeInTheDocument();
    expect(screen.getByText('现场上报新隐患')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('重大隐患 · 厂级督办')).toBeInTheDocument();
      expect(screen.getByText('主循环泵轴承箱剧烈温升伴随异响')).toBeInTheDocument();
      expect(screen.getByText('法兰接头轻微油污渗漏')).toBeInTheDocument();
    });
  });

  it('2. 支持按等级与状态进行过滤筛选', async () => {
    render(
      <HazardsView
        currentUser={mockCurrentUser}
        equipments={mockEquipments}
        allUsers={mockUsers}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('主循环泵轴承箱剧烈温升伴随异响')).toBeInTheDocument();
    });

    // Filter by general only
    fireEvent.click(screen.getByText('一般隐患'));
    expect(screen.queryByText('主循环泵轴承箱剧烈温升伴随异响')).not.toBeInTheDocument();
    expect(screen.getByText('法兰接头轻微油污渗漏')).toBeInTheDocument();

    // Filter by major only
    fireEvent.click(screen.getByText('重大隐患'));
    expect(screen.getByText('主循环泵轴承箱剧烈温升伴随异响')).toBeInTheDocument();
    expect(screen.queryByText('法兰接头轻微油污渗漏')).not.toBeInTheDocument();
  });

  it('3. 派发整改工单流程完整触发', async () => {
    render(
      <HazardsView
        currentUser={mockCurrentUser}
        equipments={mockEquipments}
        allUsers={mockUsers}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('下发整改单')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('下发整改单'));

    expect(screen.getByText('派发隐患整改工单')).toBeInTheDocument();
    const submitBtn = screen.getByText('确认下发工单');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(hazardsApi.assign).toHaveBeenCalledWith('haz-001', expect.objectContaining({
        assignee_id: 'u-tech1',
      }));
    });
  });

  it('4. 复核验收与闭环销号流程完整触发', async () => {
    render(
      <HazardsView
        currentUser={mockCurrentUser}
        equipments={mockEquipments}
        allUsers={mockUsers}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('复核销号')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('复核销号'));

    expect(screen.getByText('复核验收与隐患销号')).toBeInTheDocument();
    const confirmBtn = screen.getByText('确认复核归档');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(hazardsApi.verify).toHaveBeenCalledWith('haz-002', expect.objectContaining({
        verifier: '安全主管张三',
        passed: true,
      }));
    });
  });

  it('5. 现场上报新隐患模态表单提交', async () => {
    render(
      <HazardsView
        currentUser={mockCurrentUser}
        equipments={mockEquipments}
        allUsers={mockUsers}
      />
    );

    const createBtn = screen.getByText('现场上报新隐患');
    fireEvent.click(createBtn);

    expect(screen.getByText('现场安全隐患实时上报建档')).toBeInTheDocument();

    const titleInput = screen.getByPlaceholderText(/例: 2号给水泵盘根填料严重滴漏/);
    fireEvent.change(titleInput, { target: { value: '空压机油气分离器排温超标' } });

    const descInput = screen.getByPlaceholderText(/详细描述现场安全隐患位置/);
    fireEvent.change(descInput, { target: { value: '连续运行30分钟温度达到95度' } });

    const submitBtn = screen.getByText('提交建档督办');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(hazardsApi.create).toHaveBeenCalledWith(expect.objectContaining({
        title: '空压机油气分离器排温超标',
        description: '连续运行30分钟温度达到95度',
      }));
    });
  });
});
