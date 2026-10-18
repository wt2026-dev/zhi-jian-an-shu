// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SafetyManagementView } from '../../src/components/SafetyManagementView';
import { SafetyPermit, UserProfile, Equipment, LotoLock } from '../../src/types';

vi.mock('../../src/api', () => ({
  safetyPermitApi: {
    create: vi.fn().mockImplementation((data) =>
      Promise.resolve({
        id: 'SP-NEW-001',
        permitNo: 'SP-2026-999',
        status: 'pending_approval',
        applicant: '当前用户',
        appliedAt: '2026-03-10',
        ...data,
      })
    ),
    approve: vi.fn().mockImplementation((id, data) =>
      Promise.resolve({
        id,
        permitNo: 'SP-2026-001',
        status: data.pass ? 'approved' : 'rejected',
        title: '动力车间主管道气割作业',
        riskLevel: '极大风险 (Level 1)',
        permitType: '动火作业票',
        workshop: '一号动力车间',
        location: '水泵房旁',
        applicant: '李焊工',
        appliedAt: '2026-03-01 08:30',
        validUntil: '2026-03-01 17:30',
        precautions: ['专人看火'],
        guardianApproval: { signed: true, name: '张点检', signedAt: '2026-03-01' },
      })
    ),
    delete: vi.fn().mockResolvedValue({ success: true }),
    getLotoLocks: vi.fn().mockResolvedValue([]),
    registerLotoLock: vi.fn().mockResolvedValue({ success: true }),
    releaseLotoLock: vi.fn().mockResolvedValue({ success: true }),
  },
  aiApi: {
    safetyRiskAssessment: vi.fn().mockResolvedValue({
      success: true,
      assessment: {
        riskLevel: '较大风险 (Level 2)',
        jsaMeasures: [{ hazard: '高温飞溅', control: '配备灭火器和防火毯' }],
      },
    }),
  },
}));

const mockCurrentUser: UserProfile = {
  id: 'USR-001',
  name: '王主管',
  role: 'manager',
  roleTitle: '车间安全主管',
  department: '安全环保部',
  phone: '13900000002',
};

const mockEquipments: Equipment[] = [
  {
    id: 'EQ-001',
    code: 'EQ-001-CODE',
    name: '1号循环水泵',
    category: '泵类设备',
    model: 'ISG80-160',
    location: '水泵房A区',
    workshop: '一号动力车间',
    status: 'running',
    healthScore: 92,
  },
] as unknown as Equipment[];

const mockPermits: SafetyPermit[] = [
  {
    id: 'SP-001',
    permitNo: 'SP-2026-001',
    title: '动力车间主管道气割作业',
    permitType: '动火作业票',
    riskLevel: '极大风险 (Level 1)',
    status: 'pending_approval',
    workshop: '一号动力车间',
    location: '水泵房旁',
    applicant: '李焊工',
    appliedAt: '2026-03-01 08:30',
    validUntil: '2026-03-01 17:30',
    precautions: ['作业现场配备 2 具 4kg ABC 干粉灭火器'],
    lotoNumber: 'LOCK-001',
    guardianApproval: { signed: true, name: '张点检', signedAt: '2026-03-01', signatureHash: 'HASH123' },
  },
  {
    id: 'SP-002',
    permitNo: 'SP-2026-002',
    title: '二号机加车间行车检修高处作业',
    permitType: '高处作业票',
    riskLevel: '一般风险 (Level 3)',
    status: 'approved',
    workshop: '二号机加车间',
    location: '跨线天车',
    applicant: '赵电工',
    appliedAt: '2026-03-02 09:00',
    validUntil: '2026-03-02 16:00',
    precautions: ['系挂五点式双钩安全带'],
  },
] as unknown as SafetyPermit[];

const mockLotoLocks: LotoLock[] = [
  {
    id: 'LOCK-REC-001',
    lockNo: 'LOCK-001',
    permitNo: 'SP-2026-001',
    pointName: '循环泵主电源断路器',
    energySource: '380V交流电',
    location: '配电柜1号柜',
    status: 'locked',
    lockedBy: '张点检',
    lockedAt: '2026-03-01 08:00',
  },
] as unknown as LotoLock[];

describe('SafetyManagementView Modular Component Suite', () => {
  const onAddSafetyPermit = vi.fn();
  const onUpdateSafetyPermit = vi.fn();
  const onDeleteSafetyPermit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders header, LOTO banner and risk filter chips', () => {
    render(
      <SafetyManagementView
        currentUser={mockCurrentUser}
        safetyPermits={mockPermits}
        equipments={mockEquipments}
        lotoLocks={mockLotoLocks}
        onAddSafetyPermit={onAddSafetyPermit}
        onUpdateSafetyPermit={onUpdateSafetyPermit}
        onDeleteSafetyPermit={onDeleteSafetyPermit}
      />
    );

    expect(screen.getByText('工业现场高危作业安全管控与作业票审批中心')).toBeInTheDocument();
    expect(screen.getByText('LOTO 能量隔离人工台账')).toBeInTheDocument();
    expect(screen.getByText('全部风险级别')).toBeInTheDocument();
    expect(screen.getByText('🔴 极大风险 (Level 1)')).toBeInTheDocument();
  });

  it('filters permits by clicking risk filter chip', () => {
    render(
      <SafetyManagementView
        currentUser={mockCurrentUser}
        safetyPermits={mockPermits}
        equipments={mockEquipments}
        lotoLocks={mockLotoLocks}
        onAddSafetyPermit={onAddSafetyPermit}
        onUpdateSafetyPermit={onUpdateSafetyPermit}
        onDeleteSafetyPermit={onDeleteSafetyPermit}
      />
    );

    expect(screen.getByText('动力车间主管道气割作业')).toBeInTheDocument();
    expect(screen.getByText('二号机加车间行车检修高处作业')).toBeInTheDocument();

    // Click Level 1 filter
    fireEvent.click(screen.getByText('🔴 极大风险 (Level 1)'));

    // Only Level 1 permit shows
    expect(screen.getByText('动力车间主管道气割作业')).toBeInTheDocument();
    expect(screen.queryByText('二号机加车间行车检修高处作业')).not.toBeInTheDocument();
  });

  it('opens detail modal and displays LOTO and precautions', () => {
    render(
      <SafetyManagementView
        currentUser={mockCurrentUser}
        safetyPermits={mockPermits}
        equipments={mockEquipments}
        lotoLocks={mockLotoLocks}
        onAddSafetyPermit={onAddSafetyPermit}
        onUpdateSafetyPermit={onUpdateSafetyPermit}
        onDeleteSafetyPermit={onDeleteSafetyPermit}
      />
    );

    // Click on the first permit card
    fireEvent.click(screen.getByText('动力车间主管道气割作业'));

    // Detail modal opens
    expect(screen.getByText('能量隔离与 LOTO 锁具编码')).toBeInTheDocument();
    expect(screen.getByText('LOCK-001')).toBeInTheDocument();
    expect(screen.getByText('安全交底与现场必选防控措施 (作业前逐项核验)')).toBeInTheDocument();
    expect(screen.getByText('作业现场配备 2 具 4kg ABC 干粉灭火器')).toBeInTheDocument();
  });

  it('handles permit approval action', async () => {
    render(
      <SafetyManagementView
        currentUser={mockCurrentUser}
        safetyPermits={mockPermits}
        equipments={mockEquipments}
        lotoLocks={mockLotoLocks}
        onAddSafetyPermit={onAddSafetyPermit}
        onUpdateSafetyPermit={onUpdateSafetyPermit}
        onDeleteSafetyPermit={onDeleteSafetyPermit}
      />
    );

    fireEvent.click(screen.getByText('动力车间主管道气割作业'));

    // Click "终审签发准许令"
    const approveBtn = screen.getByRole('button', { name: /终审签发准许令/ });
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(onUpdateSafetyPermit).toHaveBeenCalled();
    });
  });

  it('opens create permit modal and closes on cancel', () => {
    render(
      <SafetyManagementView
        currentUser={mockCurrentUser}
        safetyPermits={mockPermits}
        equipments={mockEquipments}
        lotoLocks={mockLotoLocks}
        onAddSafetyPermit={onAddSafetyPermit}
        onUpdateSafetyPermit={onUpdateSafetyPermit}
        onDeleteSafetyPermit={onDeleteSafetyPermit}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /申请高危安全作业票/ }));

    expect(screen.getByText('申请工业高危安全作业票 (SOP 审查)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /取消/ }));

    expect(screen.queryByText('申请工业高危安全作业票 (SOP 审查)')).not.toBeInTheDocument();
  });
});
