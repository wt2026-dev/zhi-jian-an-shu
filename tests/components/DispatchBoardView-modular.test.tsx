// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import type {
  EquipmentPoint,
  PendingWorkOrder,
  DutyTechnician,
  DispatchRecommendationItem,
} from '../../src/api';

const mockBoard = vi.fn();
const mockListTechnicians = vi.fn();
const mockRecommend = vi.fn();
const mockAssign = vi.fn();
const mockMock = vi.fn();

vi.mock('../../src/api', () => ({
  dispatchApi: {
    board: (...args: unknown[]) => mockBoard(...args),
    listTechnicians: (...args: unknown[]) => mockListTechnicians(...args),
    recommend: (...args: unknown[]) => mockRecommend(...args),
    assign: (...args: unknown[]) => mockAssign(...args),
    mock: (...args: unknown[]) => mockMock(...args),
  },
}));

vi.mock('../../src/utils/demoMode', () => ({
  isDemoMode: () => true,
}));

vi.mock('../../src/components/AmapDispatchMap', () => ({
  AmapDispatchMap: ({ onFail }: { onFail: () => void }) => {
    React.useEffect(() => {
      onFail();
    }, [onFail]);
    return <div data-testid="amap-mock">高德地图加载中</div>;
  },
}));

import { DispatchBoardView } from '../../src/components/DispatchBoardView';

const MOCK_EQUIPMENT_POINTS: EquipmentPoint[] = [
  {
    id: 'eq-101',
    name: '循环水冷却泵 #1',
    code: 'PUMP-101',
    status: 'fault',
    healthScore: 42,
    openOrders: 1,
    workshop: '动力一车间',
    mapX: 200,
    mapY: 300,
    geoLng: 120.123,
    geoLat: 30.123,
  },
];

const MOCK_PENDING_ORDERS: PendingWorkOrder[] = [
  {
    id: 'wo-2026-001',
    orderNo: 'WO-2026-001',
    title: '循环泵轴承异常发热拆检',
    equipmentId: 'eq-101',
    equipmentName: '循环水冷却泵 #1',
    faultType: '机械振动/发热',
    priority: 'urgent',
  },
];

const MOCK_TECHNICIANS: DutyTechnician[] = [
  {
    id: 'u-tech1',
    username: 'tech_zhang',
    name: '张建国',
    role: 'technician',
    roleTitle: '高级电气技师',
    onlineStatus: 'idle',
    skills: ['机械振动', '轴承检修', '动平衡'],
    mapX: 250,
    mapY: 320,
    geoLng: 120.125,
    geoLat: 30.125,
    lastLocationAt: '2026-10-18 10:15',
  },
  {
    id: 'u-tech2',
    username: 'tech_li',
    name: '李四',
    role: 'technician',
    roleTitle: '机电维修工',
    onlineStatus: 'online',
    skills: ['通用电气'],
    mapX: 600,
    mapY: 700,
    geoLng: 120.150,
    geoLat: 30.150,
    lastLocationAt: '2026-10-18 10:12',
  },
];

const MOCK_RECOMMENDATIONS: DispatchRecommendationItem[] = [
  {
    technician: {
      id: MOCK_TECHNICIANS[0].id,
      name: MOCK_TECHNICIANS[0].name,
      roleTitle: MOCK_TECHNICIANS[0].roleTitle,
      skills: MOCK_TECHNICIANS[0].skills,
      mapX: MOCK_TECHNICIANS[0].mapX,
      mapY: MOCK_TECHNICIANS[0].mapY,
      geoLng: MOCK_TECHNICIANS[0].geoLng ?? null,
      geoLat: MOCK_TECHNICIANS[0].geoLat ?? null,
      status: 'idle',
      lastLocationAt: MOCK_TECHNICIANS[0].lastLocationAt,
    },
    distance: 53.8,
    distanceLabel: '约 108m',
    status: 'idle',
    skillMatch: 0.95,
    score: 92.4,
    reason: '距离最近 (108m) 且当前空闲，具备轴承检修专长',
  },
];

describe('DispatchBoardView - 模块化拆分与调度功能测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBoard.mockResolvedValue({
      equipmentPoints: MOCK_EQUIPMENT_POINTS,
      pendingOrders: MOCK_PENDING_ORDERS,
    });
    mockListTechnicians.mockResolvedValue({
      technicians: MOCK_TECHNICIANS,
    });
    mockRecommend.mockResolvedValue({
      recommendations: MOCK_RECOMMENDATIONS,
      workOrder: {
        orderNo: 'WO-2026-001',
        title: '循环泵轴承异常发热拆检',
        faultType: '机械振动/发热',
        priority: 'urgent',
      },
      equipment: {
        id: 'eq-101',
        name: '循环水冷却泵 #1',
        code: 'PUMP-101',
        workshop: '动力一车间',
        mapX: 200,
        mapY: 300,
      },
    });
  });

  it('展示大屏页头、4项统计卡片及平面调度图', async () => {
    render(<DispatchBoardView />);

    expect(screen.getByText('加载厂区数据…')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText('加载厂区数据…')).not.toBeInTheDocument();
    });

    // 统计栏
    expect(screen.getByText('在岗师傅')).toBeInTheDocument();
    expect(screen.getByText('当前空闲')).toBeInTheDocument();
    expect(screen.getByText('待派工单')).toBeInTheDocument();
    expect(screen.getByText('平均响应距离估算')).toBeInTheDocument();

    // 师傅名称及区域（降级为 SVG 平面图后渲染）
    await waitFor(() => {
      expect(screen.getByText('张建国')).toBeInTheDocument();
      expect(screen.getByText('动力一车间')).toBeInTheDocument();
    });
  });

  it('选择待派工单后自动请求推荐并显示最优师傅及派单按钮', async () => {
    render(<DispatchBoardView />);

    await waitFor(() => {
      expect(screen.getByText(/循环泵轴承异常发热拆检/)).toBeInTheDocument();
    });

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'wo-2026-001' } });

    await waitFor(() => {
      expect(mockRecommend).toHaveBeenCalledWith('wo-2026-001');
      expect(screen.getByText('最优')).toBeInTheDocument();
      expect(
        screen.getByText('距离最近 (108m) 且当前空闲，具备轴承检修专长')
      ).toBeInTheDocument();
    });
  });

  it('点击派单按钮调用 assign 接口并展示成功轻提示', async () => {
    mockAssign.mockResolvedValueOnce({
      success: true,
      message: '已派单给 张建国',
    });

    render(<DispatchBoardView presetWorkOrderId="wo-2026-001" />);

    await waitFor(() => {
      expect(screen.getByText('最优')).toBeInTheDocument();
    });

    const assignBtn = screen.getByRole('button', { name: /派单/ });
    fireEvent.click(assignBtn);

    await waitFor(() => {
      expect(mockAssign).toHaveBeenCalledWith({
        workOrderId: 'wo-2026-001',
        userId: 'u-tech1',
      });
      expect(screen.getByText('已派单给 张建国')).toBeInTheDocument();
    });
  });

  it('演示模式下点击演示模拟定位调用 mock 接口', async () => {
    mockMock.mockResolvedValueOnce({
      success: true,
      updated: 2,
      message: '已随机刷新 2 位师傅的坐标',
    });

    render(<DispatchBoardView />);

    await waitFor(() => {
      expect(screen.getByText('内部检修调度大屏')).toBeInTheDocument();
    });

    const mockBtn = screen.getByRole('button', { name: /演示模拟定位/ });
    fireEvent.click(mockBtn);

    await waitFor(() => {
      expect(mockMock).toHaveBeenCalled();
    });
  });
});
