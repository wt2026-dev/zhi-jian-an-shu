/**
 * 前端角色权限（RBAC）唯一真源。
 *
 * 为什么单独一个文件：
 *   - 菜单可见性在 `navConfig.ts`（那里只声明 `roles` 字段，不写判定逻辑）；
 *   - 页面内的按钮/操作权限、演示角色排序、各角色默认首页都要用同一套口径，
 *     散落在各组件里必然会长歪（历史上 `currentUser.role === 'admin' || === 'manager'`
 *     这种就地判断已经在 3 个组件里各写了一遍）。
 *
 * 口径说明（与后端 `src/server/middleware/auth.ts` 对齐，前端只做"藏起来/跳走"，
 * 真正的越权拦截永远由后端 403 兜底）：
 *   - 未声明 `roles` 的菜单 = 全员可见；
 *   - `admin`（总工）是超级用户：页面与操作全部放行；
 *   - `'user'` 这个历史角色值（周大伟 / 吊装司机，本质是操作岗）按 `operator` 归一，
 *     否则他会被所有显式 roles 菜单同时排除，连安全与LOTO都看不到，与岗位不符。
 */
import { NAV_GROUPS } from '../components/layout/navConfig';

/** 前端实际参与判定的角色（`'user'` 已归一为 `operator`） */
export type EffectiveRole = 'admin' | 'manager' | 'technician' | 'inspector' | 'operator' | 'archivist';

const ALL_ROLES: EffectiveRole[] = ['admin', 'manager', 'technician', 'inspector', 'operator', 'archivist'];

/** 无权限时的统一提示语（页面提示卡与 403 提示共用同一句） */
export const FORBIDDEN_HINT = '当前角色无权限访问，请切换角色';

/**
 * 归一化角色：`'user'` → `'operator'`；未知角色按最小权限 `operator` 处理；
 * 空值返回 null（表示"还没有身份"，一律拒绝）。
 */
export function normalizeRole(role?: string | null): EffectiveRole | null {
  if (!role) return null;
  if (role === 'user') return 'operator';
  return (ALL_ROLES as string[]).includes(role) ? (role as EffectiveRole) : 'operator';
}

/** 该页面（nav item id）对当前角色是否可见 */
export function isTabAllowed(tabId: string, role?: string | null): boolean {
  const effective = normalizeRole(role);
  if (!effective) return false;
  // 总工通行：保证"admin 所有页面都可见"
  if (effective === 'admin') return true;

  for (const group of NAV_GROUPS) {
    const item = group.items.find((i) => i.id === tabId);
    if (!item) continue;
    // 未声明 roles = 全员可见
    if (!item.roles || item.roles.length === 0) return true;
    return item.roles.includes(effective);
  }
  // 不在菜单里的 tab（如 'archives' 等别名）不做拦截，避免误伤既有路由
  return true;
}

/** 各角色默认首页：切换角色后自动落到这里 */
const ROLE_HOME: Record<EffectiveRole, string> = {
  admin: 'cockpit',
  manager: 'cockpit',
  technician: 'work_orders',
  inspector: 'inspections',
  operator: 'dashboard',
  archivist: 'knowledge',
};

/**
 * 角色的默认首页。返回值一定是该角色"看得见"的页面
 * （首页本身就在其 roles 里，或属于全员可见菜单）。
 */
export function getRoleHome(role?: string | null): string {
  const effective = normalizeRole(role);
  if (!effective) return 'dashboard';
  const home = ROLE_HOME[effective];
  return isTabAllowed(home, effective) ? home : 'dashboard';
}

/** 演示流程顺序：操作工报修 → 技师检修 → 点检核验 → 主管管理 → 总工全局 */
export const ROLE_DEMO_ORDER: EffectiveRole[] = ['operator', 'technician', 'inspector', 'manager', 'admin'];

/** 按演示流程给下拉里的用户排序（同角色内保持原顺序，未识别角色排最后） */
export function sortUsersForDemo<T extends { role?: string | null }>(users: T[]): T[] {
  const rank = (u: T) => {
    const r = normalizeRole(u?.role);
    const idx = r ? ROLE_DEMO_ORDER.indexOf(r) : -1;
    return idx === -1 ? ROLE_DEMO_ORDER.length : idx;
  };
  return [...users].sort((a, b) => rank(a) - rank(b));
}

/** 细粒度操作权限（页面内按钮级） */
export type ActionPerm =
  /** 创建/报修工单 */
  | 'workOrder:create'
  /** 技师认领（接单） */
  | 'workOrder:claim'
  /** 技师填写检修记录 / 申请完工 */
  | 'workOrder:complete'
  /** 主管审核 / 派发工单 */
  | 'workOrder:approve'
  /** 现场安全监护人初审会签 */
  | 'safety:guardianConfirm'
  /** 车间安全总监终审签发 */
  | 'safety:finalApprove'
  /** 3D 场景内操作设备（点选/派单/处置），operator 只能浏览 */
  | 'equipment3d:operate';

/**
 * 每项操作的授权角色。admin 不写在这里 —— 他在 `can()` 里作为超级用户直接放行。
 */
const ACTION_ROLES: Record<ActionPerm, EffectiveRole[]> = {
  'workOrder:create': ['operator'],
  'workOrder:claim': ['technician'],
  'workOrder:complete': ['technician'],
  'workOrder:approve': ['manager'],
  'safety:guardianConfirm': ['inspector'],
  'safety:finalApprove': ['manager'],
  'equipment3d:operate': ['manager', 'technician'],
};

/** 当前角色能否执行该操作（admin 恒为 true） */
export function can(action: ActionPerm, role?: string | null): boolean {
  const effective = normalizeRole(role);
  if (!effective) return false;
  if (effective === 'admin') return true;
  return ACTION_ROLES[action].includes(effective);
}

/** 该操作的授权角色中文说明，用于按钮禁用时的 tooltip */
export function describeActionOwner(action: ActionPerm): string {
  const owners = ACTION_ROLES[action];
  const labels: Record<EffectiveRole, string> = {
    admin: '总工',
    manager: '车间主管',
    technician: '检修技师',
    inspector: '点检工程师',
    operator: '操作工',
    archivist: '档案员',
  };
  return owners.map((r) => labels[r]).join(' / ');
}
