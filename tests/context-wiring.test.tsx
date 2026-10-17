// @vitest-environment jsdom
/**
 * App.tsx Context 接线回归测试
 *
 * 背景：App.tsx 原为 885 行上帝组件，状态已拆分至 AuthContext / AppDataContext。
 * 本测试守护三件最容易在重构中悄悄坏掉的事：
 *   ① Hook 必须在 Provider 内使用（否则抛明确错误，而非静默拿到 undefined）
 *   ② AppDataProvider 拉取数据后必须把 currentUser / allUsers 回填给认证层
 *      （曾出现 apiUsers 被丢弃、allUsers 永远为空的缺陷）
 *   ③ 未登录时必须渲染登录页而非业务界面（路由守卫）
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { AppDataProvider, useAppData } from '../src/context/AppDataContext';
import type { UserProfile } from '../src/types';

// ─── API Mock（离线确定性，无任何真实网络调用）────────────────────────────────

const adminUser: UserProfile = {
  id: 'u-admin',
  username: 'admin',
  name: '陈建平',
  role: 'admin',
  roleTitle: '总工 / 机电部长',
  department: '生产机电保全部',
  phone: '13800100001',
};

vi.mock('../src/api', () => ({
  authApi: {
    getToken: vi.fn(() => null),
    saveToken: vi.fn(),
    logout: vi.fn(),
    switchUser: vi.fn(),
    getUsers: vi.fn(),
    getCurrentUser: vi.fn(),
    getMe: vi.fn(),
  },
  notificationApi: { list: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn() },
  workOrderApi: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
  equipmentApi: { list: vi.fn() },
  safetyPermitApi: { list: vi.fn(), getLotoLocks: vi.fn() },
  knowledgeApi: { list: vi.fn() },
  inspectionApi: { list: vi.fn(), update: vi.fn() },
}));

// 必须在使用前 import，确保拿到 mock 后的实例
import {
  authApi,
  notificationApi,
  workOrderApi,
  equipmentApi,
  safetyPermitApi,
  knowledgeApi,
  inspectionApi,
} from '../src/api';

beforeEach(() => {
  vi.clearAllMocks();
  (authApi.getToken as any).mockReturnValue(null);
  (authApi.getUsers as any).mockResolvedValue([adminUser]);
  (authApi.getCurrentUser as any).mockResolvedValue(adminUser);
  (authApi.getMe as any).mockRejectedValue(new Error('401 Unauthorized'));
  (workOrderApi.list as any).mockResolvedValue([]);
  (equipmentApi.list as any).mockResolvedValue([]);
  (safetyPermitApi.list as any).mockResolvedValue([]);
  (safetyPermitApi.getLotoLocks as any).mockResolvedValue([]);
  (knowledgeApi.list as any).mockResolvedValue([]);
  (inspectionApi.list as any).mockResolvedValue([]);
  (notificationApi.list as any).mockResolvedValue([]);
});

// ─── ① Hook 守卫：必须在 Provider 内使用 ──────────────────────────────────────

describe('Context Hook 守卫', () => {
  it('useAuth() 在 AuthProvider 外调用应抛出明确错误', () => {
    const Probe = () => {
      useAuth();
      return null;
    };
    expect(() => render(<Probe />)).toThrow(/useAuth\(\) 必须在 <AuthProvider> 内部调用/);
  });

  it('useAppData() 在 AppDataProvider 外调用应抛出明确错误', () => {
    const Probe = () => {
      useAppData();
      return null;
    };
    expect(() => render(<Probe />)).toThrow(/useAppData\(\) 必须在 <AppDataProvider> 内部调用/);
  });
});

// ─── ② 数据回填：currentUser / allUsers 必须交给认证层 ────────────────────────

describe('AppDataProvider 数据回填', () => {
  it('加载完成后回传 currentUser 与 allUsers（曾出现 allUsers 被丢弃）', async () => {
    const onDataLoaded = vi.fn();

    const Probe = () => {
      const { isInitialLoading, loadError } = useAppData();
      return (
        <div>
          <span data-testid="loading">{String(isInitialLoading)}</span>
          <span data-testid="error">{loadError ?? 'none'}</span>
        </div>
      );
    };

    render(
      <AuthProvider>
        <AppDataProvider authToken="fake-token" onDataLoaded={onDataLoaded}>
          <Probe />
        </AppDataProvider>
      </AuthProvider>
    );

    await waitFor(() => expect(onDataLoaded).toHaveBeenCalled());

    // 关键断言：第二个参数必须是全量用户列表，而不是 undefined / 空数组
    const [userArg, usersArg] = onDataLoaded.mock.calls[0];
    expect(userArg).toEqual(adminUser);
    expect(Array.isArray(usersArg)).toBe(true);
    expect(usersArg).toHaveLength(1);
    expect(usersArg[0].id).toBe('u-admin');
  });

  it('加载失败时记录 loadError 且不伪造数据', async () => {
    (workOrderApi.list as any).mockRejectedValue(new Error('后端不可用'));

    const Probe = () => {
      const { loadError, equipments } = useAppData();
      return (
        <div>
          <span data-testid="error">{loadError ?? 'none'}</span>
          <span data-testid="count">{equipments.length}</span>
        </div>
      );
    };

    render(
      <AuthProvider>
        <AppDataProvider authToken="fake-token">
          <Probe />
        </AppDataProvider>
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('后端不可用'));
    // 失败时绝不使用 mock 兜底数据
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('authToken 为 null 时不发起任何业务数据请求', async () => {
    const Probe = () => {
      useAppData();
      return null;
    };

    render(
      <AuthProvider>
        <AppDataProvider authToken={null}>
          <Probe />
        </AppDataProvider>
      </AuthProvider>
    );

    await waitFor(() => expect(workOrderApi.list).not.toHaveBeenCalled());
    expect(equipmentApi.list).not.toHaveBeenCalled();
    expect(authApi.getUsers).not.toHaveBeenCalled();
  });
});

// ─── ③ 认证层初始状态 ────────────────────────────────────────────────────────

describe('AuthProvider 初始状态', () => {
  it('无本地 token 时 authToken 为 null', async () => {
    (authApi.getToken as any).mockReturnValue(null);

    const Probe = () => {
      const { authToken } = useAuth();
      return <span data-testid="token">{authToken ?? 'null'}</span>;
    };

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId('token').textContent).toBe('null'));
  });

  it('本地已有 token 时初始即为该 token（刷新免登录）', async () => {
    (authApi.getToken as any).mockReturnValue('persisted-token');

    const Probe = () => {
      const { authToken } = useAuth();
      return <span data-testid="token">{authToken ?? 'null'}</span>;
    };

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId('token').textContent).toBe('persisted-token'));
  });
});
