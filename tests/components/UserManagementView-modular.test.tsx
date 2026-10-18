// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import type { UserProfile } from '../../src/types';

const mockUpdateUserStatus = vi.fn();
const mockCreateUser = vi.fn();

vi.mock('../../src/api', () => ({
  authApi: {
    updateUserStatus: (...args: unknown[]) => mockUpdateUserStatus(...args),
    createUser: (...args: unknown[]) => mockCreateUser(...args),
  },
}));

const mockShowToast = vi.fn();
vi.mock('../../src/context/ToastContext', () => ({
  useToast: () => ({ show: mockShowToast }),
}));

import { UserManagementView } from '../../src/components/UserManagementView';

const MOCK_USERS: UserProfile[] = [
  {
    id: 'u-admin',
    username: 'admin',
    name: '李总工',
    role: 'admin',
    roleTitle: '车间总工 / 系统管理员',
    department: '智能工程指挥中心',
    status: 'active',
    phone: '13800000001',
    email: 'admin@plant.com',
    permissions: ['read', 'write', 'admin'],
  },
  {
    id: 'u-tech1',
    username: 'tech_zhang',
    name: '张建国',
    role: 'technician',
    roleTitle: '高级电气技师',
    department: '动力机电维保车间',
    status: 'active',
    phone: '13800000002',
    email: 'tech1@plant.com',
    permissions: ['read', 'create_order'],
  },
  {
    id: 'u-insp1',
    username: 'insp_liu',
    name: '刘巡检',
    role: 'inspector',
    roleTitle: '现场点检员',
    department: '设备质量检测组',
    status: 'active',
    phone: '13800000003',
    email: 'insp1@plant.com',
    permissions: ['read'],
  },
  {
    id: 'u-op1',
    username: 'op_wang',
    name: '王小二',
    role: 'operator',
    roleTitle: '一号线操作员',
    department: '总装生产一部',
    status: 'disabled',
    phone: '13800000004',
    email: 'op1@plant.com',
    permissions: ['read'],
  },
];

describe('UserManagementView - 模块化拆分与角色权限交互测试', () => {
  const onAddUser = vi.fn();
  const onSwitchUser = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('展示页头、四级角色卡片、权限对照矩阵及运维人员花名册', () => {
    render(
      <UserManagementView
        currentUser={MOCK_USERS[0]}
        allUsers={MOCK_USERS}
        onAddUser={onAddUser}
        onSwitchUser={onSwitchUser}
      />
    );

    // 页头
    expect(screen.getByText('系统用户管理与四级 RBAC 角色权限矩阵')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /添加新系统人员/ })).toBeInTheDocument();

    // 角色卡片
    expect(screen.getByText('系统管理员 / 车间总工')).toBeInTheDocument();
    expect(screen.getByText('设备检修工程师 / 技师')).toBeInTheDocument();
    expect(screen.getByText('当前登录角色')).toBeInTheDocument();

    // 权限矩阵
    expect(screen.getByText('全业务功能模块权限对照矩阵 (RBAC Permission Matrix)')).toBeInTheDocument();
    expect(screen.getByText('设备实时健康遥测')).toBeInTheDocument();
    expect(screen.getByText('高危安全作业票审批放行')).toBeInTheDocument();

    // 花名册列表
    expect(screen.getByText('企业注册运维人员花名册 (4 人)')).toBeInTheDocument();
    expect(screen.getByText('李总工')).toBeInTheDocument();
    expect(screen.getByText('张建国')).toBeInTheDocument();
    expect(screen.getByText('刘巡检')).toBeInTheDocument();
    expect(screen.getByText('王小二')).toBeInTheDocument();
  });

  it('支持搜索框即时模糊过滤', () => {
    render(
      <UserManagementView
        currentUser={MOCK_USERS[0]}
        allUsers={MOCK_USERS}
        onAddUser={onAddUser}
        onSwitchUser={onSwitchUser}
      />
    );

    const searchInput = screen.getByPlaceholderText('搜索姓名、部门、工号...');
    fireEvent.change(searchInput, { target: { value: '建国' } });

    expect(screen.getByText('张建国')).toBeInTheDocument();
    expect(screen.queryByText('李总工')).not.toBeInTheDocument();
    expect(screen.queryByText('刘巡检')).not.toBeInTheDocument();
  });

  it('支持岗位角色下拉选择筛选', () => {
    render(
      <UserManagementView
        currentUser={MOCK_USERS[0]}
        allUsers={MOCK_USERS}
        onAddUser={onAddUser}
        onSwitchUser={onSwitchUser}
      />
    );

    const roleSelect = screen.getByRole('combobox');
    fireEvent.change(roleSelect, { target: { value: 'inspector' } });

    expect(screen.getByText('刘巡检')).toBeInTheDocument();
    expect(screen.queryByText('张建国')).not.toBeInTheDocument();
    expect(screen.queryByText('李总工')).not.toBeInTheDocument();
  });

  it('支持快速切换模拟登录身份', () => {
    render(
      <UserManagementView
        currentUser={MOCK_USERS[0]}
        allUsers={MOCK_USERS}
        onAddUser={onAddUser}
        onSwitchUser={onSwitchUser}
      />
    );

    const switchBtns = screen.getAllByRole('button', { name: '以此身份登录' });
    fireEvent.click(switchBtns[0]); // 张建国

    expect(onSwitchUser).toHaveBeenCalledWith(MOCK_USERS[1]);
  });

  it('管理员可启停成员账号并触发 updateUserStatus 接口', async () => {
    mockUpdateUserStatus.mockResolvedValueOnce({
      success: true,
      user: { ...MOCK_USERS[1], status: 'disabled' },
    });

    render(
      <UserManagementView
        currentUser={MOCK_USERS[0]}
        allUsers={MOCK_USERS}
        onAddUser={onAddUser}
        onSwitchUser={onSwitchUser}
      />
    );

    const stopButton = screen.getAllByRole('button', { name: '停用账号' })[0];
    fireEvent.click(stopButton);

    await waitFor(() => {
      expect(mockUpdateUserStatus).toHaveBeenCalledWith('u-tech1', 'disabled');
    });
  });

  it('支持弹出新增人员弹窗、填写表单并调用 createUser 提交授权', async () => {
    const newUser: UserProfile = {
      id: 'u-new',
      username: 'tech_zhao',
      name: '赵明远',
      role: 'technician',
      roleTitle: '设备检修工程师 / 技师',
      department: '一号动力车间电气维保组',
      status: 'active',
      phone: '13800138000',
      email: '',
      permissions: ['read', 'create_order'],
    };
    mockCreateUser.mockResolvedValueOnce(newUser);

    render(
      <UserManagementView
        currentUser={MOCK_USERS[0]}
        allUsers={MOCK_USERS}
        onAddUser={onAddUser}
        onSwitchUser={onSwitchUser}
      />
    );

    const openBtn = screen.getByRole('button', { name: /添加新系统人员/ });
    fireEvent.click(openBtn);

    expect(screen.getByText('新增运维成员与权限授权')).toBeInTheDocument();

    const nameInput = screen.getByPlaceholderText('例如: 赵明远');
    const usernameInput = screen.getByPlaceholderText('例如: tech_zhao');

    fireEvent.change(nameInput, { target: { value: '赵明远' } });
    fireEvent.change(usernameInput, { target: { value: 'tech_zhao' } });

    const submitBtn = screen.getByRole('button', { name: '保存授权' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateUser).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '赵明远',
          username: 'tech_zhao',
          role: 'technician',
        })
      );
      expect(onAddUser).toHaveBeenCalledWith(newUser);
    });
  });

  it('普通操作员身份访问时不展示添加成员与账号管理按钮', () => {
    render(
      <UserManagementView
        currentUser={MOCK_USERS[3]} // operator
        allUsers={MOCK_USERS}
        onAddUser={onAddUser}
        onSwitchUser={onSwitchUser}
      />
    );

    expect(screen.queryByRole('button', { name: /添加新系统人员/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '停用账号' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '启用账号' })).not.toBeInTheDocument();
  });
});
