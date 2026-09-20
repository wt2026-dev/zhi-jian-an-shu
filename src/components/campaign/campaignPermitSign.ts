/**
 * 第 5 幕「双人会签」接口层 —— 让作业票真的进入生效态，接单才不被安全联锁拦住。
 *
 * 服务端规则（`safetyController.handleApproveSafetyPermit` + 工单 claim 联锁）：
 * - 监护节点与主管终审节点必须由**两个不同账户**签署，同账户二次签 → 409；
 * - 终审签要求 admin / manager 角色；
 * - 作业票停在 pending_approval 时，该设备的工单 claim 一律 409 SAFETY_INTERLOCK_BLOCKED。
 * 所以本幕不能"一个人签两张名"，第二签必须换一个真实账号。
 *
 * 为什么全部走 `credentials: 'omit'` + 显式 Bearer：
 * `authApi.switchUser` 与 `/auth/refresh` 都会 Set-Cookie。走默认 cookie 会话时，
 * 一次切身份就把**全站**登录身份换成监护员（右上角头像、后续所有请求都跟着变），
 * 且 AppDataContext 重载会让整局游戏状态被冲掉——这是已经踩过的坑，不是假想。
 */
import { authApi, safetyPermitApi, ApiError, type ApiErrorResponse } from '../../api';
import type { UserProfile } from '../../types';

/** 会签结果：两枚真实签名的人 + 服务端回票状态 */
export interface CounterSignResult {
  guardianName: string;
  supervisorName: string;
  permitStatus: string;
}

/** 会签失败原因（供界面如实展示，不笼统报"操作失败"） */
export type CounterSignBlocker = 'no-guardian-candidate' | 'no-bearer' | 'request-failed';

export class CounterSignError extends Error {
  blocker: CounterSignBlocker;
  constructor(blocker: CounterSignBlocker, message: string) {
    super(message);
    this.name = 'CounterSignError';
    this.blocker = blocker;
  }
}

/**
 * 选第二签署人：优先"点检工程师 / 专职安全监护员"（inspector），退而求其次 manager。
 * 必须是 active 账号且不是当前登录人自己——同账户签两个节点会被服务端 409 拒绝。
 */
export function pickGuardianCandidate(users: UserProfile[], currentUserId?: string): UserProfile | null {
  const candidates = (users ?? []).filter((u) => u?.id && u.id !== currentUserId && (u.status ?? 'active') === 'active');
  return candidates.find((u) => u.role === 'inspector') ?? candidates.find((u) => u.role === 'manager') ?? null;
}

/** 会话 Bearer：内存里有真 JWT 就用；cookie 会话恢复时只剩哨兵值，走 /auth/refresh 现取一枚。 */
async function sessionBearer(): Promise<string> {
  const stored = authApi.getToken();
  if (stored && stored.split('.').length === 3) return stored;
  const res = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
  const data = await res.json().catch(() => null);
  const token = typeof data?.token === 'string' ? data.token : '';
  if (!res.ok || !token) {
    throw new CounterSignError('no-bearer', `无法取得当前会话凭据（/auth/refresh ${res.status}）：${String(data?.error ?? data?.message ?? '未返回 token')}`);
  }
  return token;
}

async function postJson<T>(path: string, body: unknown, bearer: string): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text.slice(0, 160) };
  }
  if (!res.ok) throw new ApiError(res.status, data as unknown as ApiErrorResponse);
  return data as T;
}

/**
 * 完成监护确认 + 主管终审两枚真实签名。
 * 监护签用一次性切换出来的监护员凭据；终审签沿用当前会话（当前登录人必须有 admin/manager 角色）。
 */
export async function countersignPermit(opts: {
  permitId: string;
  guardian: UserProfile;
  guardianComment: string;
  supervisorComment: string;
}): Promise<CounterSignResult> {
  const bearer = await sessionBearer();
  const minted = await postJson<{ token: string; user: UserProfile }>('/auth/switch-user', { userId: opts.guardian.id }, bearer);
  const guardianToken = minted?.token;
  if (!guardianToken) throw new CounterSignError('no-bearer', '身份切换接口未返回监护员凭据，监护节点无法签署');

  await postJson(
    `/safety-permits/${opts.permitId}/approve`,
    { step: 'guardian', pass: true, comment: opts.guardianComment, signatureMethod: 'quick_sign' },
    guardianToken
  );
  // 终审签走当前账号的正常会话：这样两枚签名分别属于两个真实账户，服务端防伪哈希各自落库
  const signed = await safetyPermitApi.approve(opts.permitId, {
    step: 'supervisor',
    pass: true,
    comment: opts.supervisorComment,
    signatureMethod: 'quick_sign',
  });
  return {
    guardianName: minted?.user?.name || opts.guardian.name,
    supervisorName: signed?.supervisorApproval?.name ?? '',
    permitStatus: String(signed?.status ?? ''),
  };
}
