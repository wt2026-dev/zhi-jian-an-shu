/**
 * 第 5 幕双人会签的选人口径 —— 纯函数单测（node 环境，不碰 DOM、不发请求）。
 *
 * 服务端规则：监护与主管终审两个节点必须由两个不同账户签署，
 * 所以"挑得到人"等价于"本幕能不能真的开工"，挑错人（挑到自己 / 挑到被停用账号）
 * 会直接让第 5 幕卡死，值得钉死。
 */
import { describe, expect, it } from 'vitest';
import { pickGuardianCandidate } from '../src/components/campaign/campaignPermitSign';
import type { UserProfile } from '../src/types';

const u = (id: string, role: UserProfile['role'], over: Partial<UserProfile> = {}): UserProfile =>
  ({ id, name: `${id}名`, role, roleTitle: `${id}岗`, department: '设备部', phone: '', ...over }) as UserProfile;

describe('pickGuardianCandidate（第 5 幕第二签署人）', () => {
  it('优先选专职安全监护员（inspector），而不是同角色的当前登录人', () => {
    const users = [u('u-admin', 'admin'), u('u-inspector', 'inspector'), u('u-manager', 'manager')];
    expect(pickGuardianCandidate(users, 'u-admin')?.id).toBe('u-inspector');
  });

  it('inspector 全部不可用时退到 manager', () => {
    const users = [u('u-admin', 'admin'), u('u-inspector', 'inspector', { status: 'disabled' }), u('u-manager', 'manager')];
    expect(pickGuardianCandidate(users, 'u-admin')?.id).toBe('u-manager');
  });

  it('当前登录人自己不能被选为第二签署人（同账户二次签会被服务端 409）', () => {
    const users = [u('u-inspector', 'inspector'), u('u-tech1', 'technician')];
    expect(pickGuardianCandidate(users, 'u-inspector')).toBeNull();
  });

  it('只剩操作工/技师等无审批权限的账号时返回 null，由界面如实说明开不了工', () => {
    const users = [u('u-admin', 'admin'), u('u-tech1', 'technician'), u('u-operator', 'operator')];
    expect(pickGuardianCandidate(users, 'u-admin')).toBeNull();
  });

  it('空名单与缺字段不抛异常', () => {
    expect(pickGuardianCandidate([], 'u-admin')).toBeNull();
    expect(pickGuardianCandidate(undefined as unknown as UserProfile[], 'u-admin')).toBeNull();
  });
});
