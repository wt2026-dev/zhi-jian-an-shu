/**
 * AuthContext — 用户认证与通知状态 Context
 *
 * 从 App.tsx 提取的认证相关状态管理层，与业务数据（AppDataContext）解耦。
 *
 * 职责边界：
 *   - authToken / currentUser / allUsers ← 登录状态
 *   - notifications ← 当前用户的通知列表
 *   - login / logout / switchUser ← 认证操作
 *   - refreshNotifications ← 通知刷新
 *
 * 不包含：设备、工单、巡检、安全票等业务数据（见 AppDataContext）
 *
 * 使用示例：
 *   const { currentUser, handleLogout } = useAuth();
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { UserProfile, NotificationItem } from '../types';
import { authApi, notificationApi } from '../api';
import { logger } from '../utils/logger';

// ─── Context 类型定义 ────────────────────────────────────────────────────────

export interface AuthContextValue {
  authToken: string | null;
  currentUser: UserProfile | null;
  allUsers: UserProfile[];
  notifications: NotificationItem[];

  setAuthToken: (token: string | null) => void;
  setCurrentUser: (user: UserProfile | null) => void;
  setAllUsers: (users: UserProfile[]) => void;

  handleLogout: () => void;
  handleSwitchUser: (user: UserProfile) => Promise<void>;
  refreshNotifications: (userId?: string) => Promise<void>;
  handleMarkNotificationRead: (id: string) => Promise<void>;
  handleMarkAllNotificationsRead: () => Promise<void>;
  handleAddUser: (user: UserProfile) => void;
}

// ─── Context 实例 ────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

// 模块级共享恢复 Promise：StrictMode 双挂载时复用同一请求，避免重复请求出错。
let restoreSessionPromise: Promise<unknown> | null = null;

/**
 * 花名册去重护栏：同 id 或同 username 只保留后出现的一条（后者通常带更新的 avatar/状态）。
 * 角色切换下拉与用户管理名册都吃这份数据，重复行会直接暴露成"同一个人出现两次"。
 */
function dedupeUsers(users: UserProfile[]): UserProfile[] {
  const merged = new Map<string, UserProfile>();
  const usernameToKey = new Map<string, string>();
  users.forEach((u, i) => {
    const uname = String(u.username || '').trim();
    const aliasKey = uname ? usernameToKey.get(uname) : undefined;
    const key = aliasKey || String(u.id || '').trim() || `#anon:${i}`;
    if (uname && !usernameToKey.has(uname)) usernameToKey.set(uname, key);
    const prev = merged.get(key);
    merged.set(key, prev ? { ...prev, ...u } : u);
  });
  return [...merged.values()];
}

// ─── Provider ────────────────────────────────────────────────────────────────

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authToken, setAuthToken] = useState<string | null>(() => {
    return authApi.getToken();
  });

  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [allUsers, setRawAllUsers] = useState<UserProfile[]>([]);
  const setAllUsers = useCallback((users: UserProfile[]) => {
    setRawAllUsers(dedupeUsers(users));
  }, []);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  // 挂载时用 httpOnly cookie 恢复会话（GET /api/v1/auth/me，走 credentials:include）。
  // 成功则回填 currentUser；失败（401/网络异常）静默保持未登录：只 logger.debug，
  // 不弹错、不跳转、不触发任何登出，且不引入任何 401 全局登出逻辑。
  const restoreAttemptedRef = useRef(false);
  useEffect(() => {
    // StrictMode 双挂载幂等：同一实例第二次 effect 直接返回。
    if (restoreAttemptedRef.current) {
      return;
    }
    restoreAttemptedRef.current = true;

    const restoreFromCookie = async () => {
      try {
        const getMeFn = (authApi as any).getMe as (() => Promise<unknown>) | undefined;
        if (typeof getMeFn !== 'function') {
          return;
        }
        // 双挂载并发时复用同一在途请求，避免重复请求。
        const pending = restoreSessionPromise ?? (restoreSessionPromise = getMeFn());
        let data: unknown;
        try {
          data = await pending;
        } finally {
          restoreSessionPromise = null;
        }

        // 后端 handleMe 直接返回脱敏 UserProfile 或 null；
        // 防御性兼容 { user } / { data } 包裹形态与可能携带的 token 字段。
        const record = data as Record<string, unknown> | null | undefined;
        const maybeToken = record && typeof record.token === 'string' ? (record.token as string) : null;
        const candidate =
          record && typeof record === 'object' && 'user' in record
            ? (record as { user: unknown }).user
            : record && typeof record === 'object' && 'data' in record && record.data && typeof record.data === 'object'
              ? (record as { data: unknown }).data
              : data;
        const user = candidate as UserProfile | null;
        if (user && typeof user === 'object' && typeof (user as UserProfile).id === 'string') {
          setCurrentUser(user);
          if (maybeToken) {
            authApi.saveToken(maybeToken);
            setAuthToken(maybeToken);
          } else {
            // cookie 会话恢复：request() 凭 credentials:include 的 httpOnly cookie 鉴权，
            // authToken 仅为前端门控（AppDataBridge 以其是否非空决定进工作台还是登录页），
            // 故用哨兵值恢复门控；已有内存 token 时优先保留。
            const existing = authApi.getToken();
            if (existing) {
              setAuthToken(existing);
            } else {
              const sentinel = 'cookie-session';
              authApi.saveToken(sentinel);
              setAuthToken(sentinel);
            }
          }
        }
      } catch (err) {
        logger.debug('AuthContext: cookie 会话恢复失败，保持未登录态', err);
      }
    };

    void restoreFromCookie();
    // 空依赖：仅挂载时恢复一次；setCurrentUser / setAuthToken 为稳定 setter，无需列入依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshNotifications = useCallback(async (userId?: string) => {
    try {
      const targetId = userId || currentUser?.id;
      const list = await notificationApi.list({ userId: targetId });
      setNotifications(Array.isArray(list) ? list : []);
    } catch (err) {
      logger.warn('AuthContext: 通知刷新失败:', err);
    }
  }, [currentUser?.id]);

  const handleLogout = () => {
    authApi.logout();
    setAuthToken(null);
    setCurrentUser(null);
    setNotifications([]);
  };

  const handleSwitchUser = async (user: UserProfile) => {
    setCurrentUser(user);
    try {
      const res = await authApi.switchUser(user.id);
      if (res?.token) {
        authApi.saveToken(res.token);
        setAuthToken(res.token);
      }
      const list = await notificationApi.list({ userId: user.id });
      setNotifications(Array.isArray(list) ? list : []);
    } catch (err) {
      logger.warn('AuthContext: 切换用户后端同步提示（已切换前端视图）:', err);
      try {
        const list = await notificationApi.list({ userId: user.id });
        setNotifications(Array.isArray(list) ? list : []);
      } catch (_) {}
    }
  };

  const handleMarkNotificationRead = async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try {
      await notificationApi.markRead(id);
    } catch (err) {
      logger.warn('AuthContext: 标记已读失败:', err);
      await refreshNotifications();
    }
  };

  const handleMarkAllNotificationsRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await notificationApi.markAllRead();
    } catch (err) {
      logger.warn('AuthContext: 全部已读失败:', err);
      await refreshNotifications();
    }
  };

  const handleAddUser = (user: UserProfile) => {
    // 幂等合并：同 id 或同 username 已存在时替换而非追加，避免角色下拉出现重复行
    setRawAllUsers((prev) => dedupeUsers([...prev, user]));
  };

  const value: AuthContextValue = {
    authToken,
    currentUser,
    allUsers,
    notifications,
    setAuthToken,
    setCurrentUser,
    setAllUsers,
    handleLogout,
    handleSwitchUser,
    refreshNotifications,
    handleMarkNotificationRead,
    handleMarkAllNotificationsRead,
    handleAddUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * 消费 AuthContext 的 hook。
 * 必须在 AuthProvider 内部调用，否则抛出明确错误。
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth() 必须在 <AuthProvider> 内部调用');
  }
  return ctx;
}

/**
 * 容错版 useAuth：Provider 外调用返回 null 而不是抛错。
 * 供 3D 视图这类"登录态只是锦上添花"的消费方使用——测试/独立渲染
 * 场景下没有 AuthProvider，缺用户只影响操作署名，不应炸掉整棵树。
 */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}

export default AuthContext;
