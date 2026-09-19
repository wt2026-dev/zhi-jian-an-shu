/**
 * 前端角色权限（菜单可见性 + 按钮级操作 + 默认首页 + 403 友好化）验收。
 *
 * 这些断言直接对应任务书的验收清单，任何一处菜单口径改动都会在这里红掉。
 * 注意：前端只负责"藏起来 / 跳走"，真正的越权拦截由后端 403 兜底（见 tests/rbac.test.ts）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NAV_GROUPS } from '../src/components/layout/navConfig';
import {
  isTabAllowed,
  getRoleHome,
  normalizeRole,
  sortUsersForDemo,
  can,
  FORBIDDEN_HINT,
} from '../src/utils/rbac';

/** 把某角色"实际看得见的 tab"算出来（与 Sidebar 用的是同一个 isTabAllowed） */
function visibleTabs(role: string | null): string[] {
  return NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id)).filter((id) => isTabAllowed(id, role));
}

const ALL_TABS = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));

describe('菜单角色矩阵（navConfig.roles）', () => {
  it('菜单项本身没有重复 id（口径表里每页只出现一次）', () => {
    expect(new Set(ALL_TABS).size).toBe(ALL_TABS.length);
  });

  it('admin 所有页面都可见', () => {
    expect(visibleTabs('admin').sort()).toEqual([...ALL_TABS].sort());
  });

  it('operator 看不到 系统管理 / 数据驾驶舱 / AI协同 / 3D场景', () => {
    const visible = visibleTabs('operator');
    for (const denied of ['cockpit', 'ai_pipeline', 'equipment_3d', 'users', 'ai_reviews', 'ai_models']) {
      expect(visible, `operator 不应看到 ${denied}`).not.toContain(denied);
    }
    // 全员可见页仍在
    for (const ok of ['dashboard', 'work_orders', 'procedures', 'knowledge', 'ai_assistant']) {
      expect(visible, `operator 应看到 ${ok}`).toContain(ok);
    }
  });

  it('technician 看不到 系统管理 / 用户权限 / AI内容审核', () => {
    const visible = visibleTabs('technician');
    for (const denied of ['users', 'ai_reviews', 'ai_models', 'cockpit', 'ai_pipeline', 'knowledge_graph']) {
      expect(visible, `technician 不应看到 ${denied}`).not.toContain(denied);
    }
    // 设备线 + 现场处置线仍在
    for (const ok of ['equipments', 'health', 'equipment_3d', 'spare_parts', 'dispatch', 'safety', 'work_orders']) {
      expect(visible, `technician 应看到 ${ok}`).toContain(ok);
    }
  });

  it('inspector 看不到 3D场景 / 备件库存 / 调度大屏，但能做巡检与隐患', () => {
    const visible = visibleTabs('inspector');
    for (const denied of ['equipment_3d', 'spare_parts', 'dispatch', 'users']) {
      expect(visible).not.toContain(denied);
    }
    for (const ok of ['inspections', 'hazards', 'safety', 'health', 'equipments']) {
      expect(visible).toContain(ok);
    }
  });

  it('archivist 只多做设备档案与知识图谱，不碰现场处置', () => {
    const visible = visibleTabs('archivist');
    expect(visible).toContain('equipments');
    expect(visible).toContain('knowledge_graph');
    for (const denied of ['health', 'equipment_3d', 'spare_parts', 'inspections', 'safety', 'users']) {
      expect(visible, `archivist 不应看到 ${denied}`).not.toContain(denied);
    }
  });

  it("'user'（周大伟 / 吊装司机这类操作岗）按 operator 处理", () => {
    expect(normalizeRole('user')).toBe('operator');
    expect(visibleTabs('user').sort()).toEqual(visibleTabs('operator').sort());
  });

  it('没有身份时一律拒绝受限页', () => {
    expect(isTabAllowed('users', null)).toBe(false);
    expect(isTabAllowed('users', undefined)).toBe(false);
    // 未登记 roles 的 tab（如路由别名）不误伤
    expect(isTabAllowed('some_unknown_tab', 'operator')).toBe(true);
  });
});

describe('切换角色后的默认首页', () => {
  it('每个角色都落到自己看得见的页面', () => {
    const homes: Array<[string, string]> = [
      ['operator', 'dashboard'],
      ['technician', 'work_orders'],
      ['inspector', 'inspections'],
      ['manager', 'cockpit'],
      ['admin', 'cockpit'],
      ['archivist', 'knowledge'],
    ];
    for (const [role, home] of homes) {
      expect(getRoleHome(role), `${role} 的默认首页`).toBe(home);
      expect(isTabAllowed(home, role), `${role} 必须看得见自己的首页 ${home}`).toBe(true);
    }
  });

  it('未知/空角色兜底到工作台', () => {
    expect(getRoleHome(null)).toBe('dashboard');
    expect(getRoleHome('user')).toBe('dashboard');
  });
});

describe('演示角色切换排序', () => {
  it('按 操作工 → 技师 → 点检 → 主管 → 总工 排列', () => {
    const users = [
      { id: 'u-admin', role: 'admin' },
      { id: 'u-tech1', role: 'technician' },
      { id: 'u-manager', role: 'manager' },
      { id: 'u-operator', role: 'operator' },
      { id: 'u-inspector', role: 'inspector' },
    ];
    expect(sortUsersForDemo(users).map((u) => u.role)).toEqual([
      'operator',
      'technician',
      'inspector',
      'manager',
      'admin',
    ]);
  });

  it("'user' 与 operator 同级（都排在 technician 之前）", () => {
    const users = [
      { id: 'a', role: 'technician' },
      { id: 'b', role: 'user' },
      { id: 'c', role: 'operator' },
    ];
    const order = sortUsersForDemo(users).map((u) => u.id);
    expect(order.slice(0, 2).sort()).toEqual(['b', 'c']);
    expect(order[2]).toBe('a');
  });

  it('不修改原数组', () => {
    const users = [{ id: 'x', role: 'admin' }, { id: 'y', role: 'operator' }];
    sortUsersForDemo(users);
    expect(users.map((u) => u.id)).toEqual(['x', 'y']);
  });
});

describe('按钮级操作权限', () => {
  it('工单：技师认领/完工，主管审核，操作工报修 —— 三者互不串台', () => {
    expect(can('workOrder:claim', 'technician')).toBe(true);
    expect(can('workOrder:complete', 'technician')).toBe(true);
    expect(can('workOrder:claim', 'manager')).toBe(false);
    expect(can('workOrder:complete', 'inspector')).toBe(false);

    expect(can('workOrder:approve', 'manager')).toBe(true);
    expect(can('workOrder:approve', 'technician')).toBe(false);
    expect(can('workOrder:approve', 'operator')).toBe(false);

    expect(can('workOrder:create', 'operator')).toBe(true);
    expect(can('workOrder:create', 'technician')).toBe(false);
    expect(can('workOrder:create', 'manager')).toBe(false);
  });

  it('安全许可：点检做监护确认，主管做终审签发', () => {
    expect(can('safety:guardianConfirm', 'inspector')).toBe(true);
    expect(can('safety:guardianConfirm', 'manager')).toBe(false);
    expect(can('safety:finalApprove', 'manager')).toBe(true);
    expect(can('safety:finalApprove', 'inspector')).toBe(false);
    expect(can('safety:finalApprove', 'operator')).toBe(false);
  });

  it('3D 场景：operator 只读（不能操作设备）', () => {
    expect(can('equipment3d:operate', 'operator')).toBe(false);
    expect(can('equipment3d:operate', 'technician')).toBe(true);
    expect(can('equipment3d:operate', 'manager')).toBe(true);
  });

  it('admin 是超级用户，操作权限全部放行', () => {
    const actions = [
      'workOrder:create',
      'workOrder:claim',
      'workOrder:complete',
      'workOrder:approve',
      'safety:guardianConfirm',
      'safety:finalApprove',
      'equipment3d:operate',
    ] as const;
    for (const a of actions) expect(can(a, 'admin'), a).toBe(true);
  });

  it('无身份一律拒绝', () => {
    expect(can('workOrder:create', null)).toBe(false);
    expect(can('workOrder:create', undefined)).toBe(false);
  });
});

describe('403 友好化（不把堆栈/技术细节抛给用户）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('403 时 err.message 是提示语，且原始后端载荷仍保留在 err.data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ code: 'RBAC_DELETE_FORBIDDEN', message: '技师无权删除作业票' }),
      } as unknown as Response)
    );

    const { request, ApiError } = await import('../src/api');
    let caught: any = null;
    try {
      await request('/safety-permits/xxx', { method: 'DELETE' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught.status).toBe(403);
    // ① 人话提示
    expect(caught.message).toContain(FORBIDDEN_HINT);
    expect(caught.message).not.toContain('Error:');
    // ② 后端细节没被覆盖，需要精确分支的页面照旧能读
    expect(caught.data.code).toBe('RBAC_DELETE_FORBIDDEN');
    expect(caught.data.message).toBe('技师无权删除作业票');
  });

  it('非 403 的错误保持原样，不被友好文案污染', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ message: '数据库炸了' }),
      } as unknown as Response)
    );

    const { request } = await import('../src/api');
    await expect(request('/anything')).rejects.toThrow('数据库炸了');
  });
});
