// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SparePartsView } from '../../src/components/SparePartsView';
import { sparePartsApi } from '../../src/api';
import { SparePart, UserProfile } from '../../src/types';

vi.mock('../../src/api', () => ({
  sparePartsApi: {
    list: vi.fn(),
    inOut: vi.fn(),
    getMovements: vi.fn(),
    create: vi.fn(),
  },
}));

const mockUser: UserProfile = {
  id: 'u-tech',
  name: '张技师',
  role: 'technician',
  roleTitle: '机械主管',
  department: '动力车间',
  phone: '13800000002',
};

const mockParts: SparePart[] = [
  {
    id: 'sp-001',
    code: 'SP-BEAR-6312',
    name: '深沟球轴承 6312',
    specification: '6312-2RS/C3',
    category: '轴承传动',
    unit: '套',
    stock: 2,
    safe_stock: 5,
    price: 380,
    location: 'A区-01货架-02层',
    compatible_models: ['1#循环水主泵', '2#备用水泵'],
    created_at: '2026-01-01',
  },
  {
    id: 'sp-002',
    code: 'SP-SEAL-MG1',
    name: '机械密封环 MG1',
    specification: 'MG1-55/G60',
    category: '密封密封件',
    unit: '套',
    stock: 12,
    safe_stock: 4,
    price: 650,
    location: 'B区-02货架',
    compatible_models: ['离心机通用'],
    created_at: '2026-01-05',
  },
];

describe('SparePartsView 模块化重构验证', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sparePartsApi.list).mockResolvedValue(mockParts);
    vi.mocked(sparePartsApi.getMovements).mockResolvedValue([
      {
        id: 'mov-001',
        part_id: 'sp-001',
        type: 'out',
        quantity: 2,
        reason: '主泵大修领用',
        operator: '张技师',
        work_order_id: 'WO-2026-001',
        created_at: '2026-10-15T09:00:00Z',
      },
    ]);
    vi.mocked(sparePartsApi.inOut).mockResolvedValue({
      success: true,
      part: { ...mockParts[0], stock: 4 },
      movement: {
        id: 'mov-002',
        part_id: 'sp-001',
        type: 'in',
        quantity: 2,
        reason: '常规到货入库',
        operator: '张技师',
        created_at: '2026-10-18T10:00:00Z',
      },
    });
    vi.mocked(sparePartsApi.create).mockResolvedValue({
      id: 'sp-003',
      code: 'SP-O-RING-80',
      name: '氟胶O型密封圈',
      specification: '80x3.55',
      category: '密封密封件',
      unit: '个',
      stock: 50,
      safe_stock: 20,
      price: 15,
      location: 'C区-01盒',
      compatible_models: '通用工业标准件',
      created_at: '2026-10-18',
    });
  });

  it('1. 完整渲染页头、4项KPI指标、筛选工具栏与备件表格', async () => {
    render(<SparePartsView currentUser={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText('工业备品备件库存中枢')).toBeInTheDocument();
      expect(screen.getByText('深沟球轴承 6312')).toBeInTheDocument();
      expect(screen.getByText('机械密封环 MG1')).toBeInTheDocument();
      expect(screen.getByText('SP-BEAR-6312')).toBeInTheDocument();
      expect(screen.getByText('低库存')).toBeInTheDocument();
    });
  });

  it('2. 支持按关键词、类别及低库存红线快速过滤', async () => {
    render(<SparePartsView currentUser={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText('深沟球轴承 6312')).toBeInTheDocument();
    });

    // 关键词搜索
    const searchInput = screen.getByPlaceholderText(/搜索备件编号、名称、规格型号/);
    fireEvent.change(searchInput, { target: { value: '机械密封' } });

    expect(screen.getByText('机械密封环 MG1')).toBeInTheDocument();
    expect(screen.queryByText('深沟球轴承 6312')).not.toBeInTheDocument();

    // 清空搜索
    fireEvent.change(searchInput, { target: { value: '' } });
    expect(screen.getByText('深沟球轴承 6312')).toBeInTheDocument();

    // 仅看低库存
    const lowStockBtn = screen.getByRole('button', { name: /仅看低库存/ });
    fireEvent.click(lowStockBtn);

    expect(screen.getByText('深沟球轴承 6312')).toBeInTheDocument();
    expect(screen.queryByText('机械密封环 MG1')).not.toBeInTheDocument();
  });

  it('3. 支持打开出入库弹窗并提交库存变动', async () => {
    render(<SparePartsView currentUser={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText('深沟球轴承 6312')).toBeInTheDocument();
    });

    // 点击第一项的出入库按钮
    const inOutBtns = screen.getAllByRole('button', { name: '出入库' });
    fireEvent.click(inOutBtns[0]);

    expect(screen.getByText('备件出入库操作')).toBeInTheDocument();
    expect(screen.getAllByText(/深沟球轴承 6312/).length).toBeGreaterThanOrEqual(2);

    // 切换到到货入库
    const inBtn = screen.getByRole('button', { name: /到货入库 \/ 采购/ });
    fireEvent.click(inBtn);

    // 修改入库数量与事由
    const qtyInput = screen.getByRole('spinbutton');
    fireEvent.change(qtyInput, { target: { value: '3' } });

    const reasonInput = screen.getByPlaceholderText(/例: 批量采购补充安全库存/);
    fireEvent.change(reasonInput, { target: { value: '采购补充安全库存' } });

    // 提交
    fireEvent.click(screen.getByRole('button', { name: '确认核销' }));

    await waitFor(() => {
      expect(sparePartsApi.inOut).toHaveBeenCalledWith('sp-001', {
        type: 'in',
        quantity: 3,
        reason: '采购补充安全库存',
        operator: '张技师',
      });
    });
  });

  it('4. 点击明细查看出入库流水日志', async () => {
    render(<SparePartsView currentUser={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText('深沟球轴承 6312')).toBeInTheDocument();
    });

    const detailBtns = screen.getAllByRole('button', { name: '明细' });
    fireEvent.click(detailBtns[0]);

    await waitFor(() => {
      expect(sparePartsApi.getMovements).toHaveBeenCalledWith('sp-001');
      expect(screen.getByText(/出入库明细流水: 深沟球轴承 6312/)).toBeInTheDocument();
      expect(screen.getByText(/检修现场领用出库: 主泵大修领用/)).toBeInTheDocument();
      expect(screen.getByText('工单: WO-2026-001')).toBeInTheDocument();
    });
  });

  it('5. 支持打开并提交新增备件建档模态', async () => {
    render(<SparePartsView currentUser={mockUser} />);

    const createBtn = screen.getByRole('button', { name: /新增备件入库/ });
    fireEvent.click(createBtn);

    expect(screen.getByText('新增工业备件入库建档')).toBeInTheDocument();

    // 填写必填项
    fireEvent.change(screen.getByPlaceholderText(/例: SP-BEAR-6208/), {
      target: { value: 'SP-O-RING-80' },
    });
    fireEvent.change(screen.getByPlaceholderText(/例: 深沟球轴承/), {
      target: { value: '氟胶O型密封圈' },
    });

    fireEvent.click(screen.getByRole('button', { name: '确认建档' }));

    await waitFor(() => {
      expect(sparePartsApi.create).toHaveBeenCalled();
    });
  });

  it('6. 支持拆解视图库存预警一键联动预填 (F6)', async () => {
    const handleConsumed = vi.fn();
    render(
      <SparePartsView
        currentUser={mockUser}
        initialProcurePrefill={{
          partId: 'sp-001',
          partName: '深沟球轴承 6312',
          unit: '套',
          qty: 6,
          note: '3D拆解视图一键采购补库',
        }}
        onProcurePrefillConsumed={handleConsumed}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('备件出入库操作')).toBeInTheDocument();
      expect(handleConsumed).toHaveBeenCalled();
      const qtyInput = screen.getByRole('spinbutton') as HTMLInputElement;
      expect(qtyInput.value).toBe('6');
      const reasonInput = screen.getByPlaceholderText(/例: 批量采购补充安全库存/) as HTMLInputElement;
      expect(reasonInput.value).toBe('3D拆解视图一键采购补库');
    });
  });
});
