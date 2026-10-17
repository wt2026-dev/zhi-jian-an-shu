import React, { useState } from 'react';
import { UserProfile, UserRole } from '../types';

export interface UserAvatarProps {
  user?: Partial<UserProfile> | null;
  name?: string;
  role?: string;
  roleTitle?: string;
  avatar?: string;
  size?: number | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '24' | '28' | '32' | '40' | '48';
  className?: string;
  showBorder?: boolean;
}

/**
 * 角色色渐变映射体系：
 * 管理员/总工：#3b82f6 蓝系
 * 机电部长：#06b6d4 青系
 * 点检工程师：#10b981 绿系
 * 操作工/技师：#f97316 橙系
 * 司机：#8b5cf6 紫系
 * 档案管理员：#6366f1 靛系
 * 兜底：白字、字重 600、高对比度
 */
export function getRoleGradient(role?: string, roleTitle?: string): string {
  const r = (role || '').toLowerCase().trim();
  const t = (roleTitle || '').toLowerCase().trim();

  // 1. 优先按 role 字段精确匹配
  if (r === 'archivist') return 'bg-gradient-to-br from-indigo-500 to-indigo-600';
  if (r === 'driver') return 'bg-gradient-to-br from-purple-500 to-purple-600';
  if (r === 'inspector') return 'bg-gradient-to-br from-emerald-500 to-emerald-600';
  if (r === 'operator' || r === 'technician' || r === 'user') return 'bg-gradient-to-br from-orange-500 to-amber-600';
  if (r === 'manager' || r === 'supervisor') return 'bg-gradient-to-br from-cyan-500 to-cyan-600';
  if (r === 'admin') return 'bg-gradient-to-br from-blue-500 to-blue-600';

  // 2. 仅当 role 缺失/未知时按 roleTitle 关键词长词优先兜底 (避免"档案管理员"被"管理员"误吃)
  if (t.includes('档案')) {
    return 'bg-gradient-to-br from-indigo-500 to-indigo-600';
  }
  if (t.includes('司机') || t.includes('驾驶') || t.includes('起重') || t.includes('吊装') || t.includes('行车')) {
    return 'bg-gradient-to-br from-purple-500 to-purple-600';
  }
  if (t.includes('点检') || t.includes('巡检') || t.includes('质检')) {
    return 'bg-gradient-to-br from-emerald-500 to-emerald-600';
  }
  if (t.includes('操作') || t.includes('技师') || t.includes('检修') || t.includes('维修')) {
    return 'bg-gradient-to-br from-orange-500 to-amber-600';
  }
  if (t.includes('机电') || t.includes('部长') || t.includes('主管') || t.includes('总监')) {
    return 'bg-gradient-to-br from-cyan-500 to-cyan-600';
  }
  if (t.includes('总工') || t.includes('管理员')) {
    return 'bg-gradient-to-br from-blue-500 to-blue-600';
  }

  return 'bg-gradient-to-br from-blue-500 to-blue-600';
}

export function getSizeClasses(size: number | string = 'sm'): { container: string; text: string } {
  if (typeof size === 'number') {
    if (size <= 24) return { container: 'w-6 h-6 min-w-[24px]', text: 'text-[11px]' };
    if (size <= 28) return { container: 'w-7 h-7 min-w-[28px]', text: 'text-xs' };
    if (size <= 32) return { container: 'w-8 h-8 min-w-[32px]', text: 'text-xs' };
    if (size <= 40) return { container: 'w-10 h-10 min-w-[40px]', text: 'text-sm' };
    if (size <= 48) return { container: 'w-12 h-12 min-w-[48px]', text: 'text-base' };
    return { container: 'w-8 h-8 min-w-[32px]', text: 'text-xs' };
  }
  switch (String(size)) {
    case '24':
    case 'xs':
      return { container: 'w-6 h-6 min-w-[24px]', text: 'text-[11px]' };
    case '28':
    case 'sm':
      return { container: 'w-7 h-7 min-w-[28px]', text: 'text-xs' };
    case '32':
    case 'md':
      return { container: 'w-8 h-8 min-w-[32px]', text: 'text-xs' };
    case '40':
    case 'lg':
      return { container: 'w-10 h-10 min-w-[40px]', text: 'text-sm' };
    case '48':
    case 'xl':
      return { container: 'w-12 h-12 min-w-[48px]', text: 'text-base' };
    default:
      return { container: 'w-7 h-7 min-w-[28px]', text: 'text-xs' };
  }
}

export function getFirstChar(name?: string, username?: string): string {
  const str = (name || username || '用').trim();
  if (!str) return '用';
  return str.charAt(0).toUpperCase();
}

/**
 * 6 套按岗位角色专属定制的工业风内置矢量头像
 */
export const BUILTIN_AVATAR_STYLES = [
  {
    id: 'admin_chip',
    name: '总工智能芯',
    roleLabel: '管理员 / 车间总工',
    colorHex: '#3b82f6',
    gradient: 'from-blue-500 to-blue-600',
    svgDataUri: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80"><defs><linearGradient id="bg_b" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="%233b82f6"/><stop offset="100%" stop-color="%231d4ed8"/></linearGradient></defs><rect width="80" height="80" rx="40" fill="url(%23bg_b)"/><path d="M40 20 L58 27 L58 43 C58 54 40 62 40 62 C40 62 22 54 22 43 L22 27 Z" fill="none" stroke="%23ffffff" stroke-width="3" stroke-linejoin="round"/><circle cx="40" cy="38" r="7" fill="%23ffffff"/><path d="M40 27 L40 31 M40 45 L40 49 M29 38 L33 38 M47 38 L51 38" stroke="%23ffffff" stroke-width="2.5" stroke-linecap="round"/></svg>`,
  },
  {
    id: 'cyan_meter',
    name: '机电测控枢',
    roleLabel: '机电部长 / 主管',
    colorHex: '#06b6d4',
    gradient: 'from-cyan-500 to-cyan-600',
    svgDataUri: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80"><defs><linearGradient id="bg_c" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="%2306b6d4"/><stop offset="100%" stop-color="%230891b2"/></linearGradient></defs><rect width="80" height="80" rx="40" fill="url(%23bg_c)"/><circle cx="40" cy="40" r="22" fill="none" stroke="%23ffffff" stroke-width="3.5"/><path d="M40 40 L52 30" stroke="%23ffffff" stroke-width="3" stroke-linecap="round"/><circle cx="40" cy="40" r="4.5" fill="%23ffffff"/><path d="M26 40 A14 14 0 0 1 54 40" fill="none" stroke="%23ffffff" stroke-width="2" stroke-dasharray="2 3"/></svg>`,
  },
  {
    id: 'emerald_scope',
    name: '点检精密探',
    roleLabel: '点检工程师 / 质检',
    colorHex: '#10b981',
    gradient: 'from-emerald-500 to-emerald-600',
    svgDataUri: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80"><defs><linearGradient id="bg_e" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="%2310b981"/><stop offset="100%" stop-color="%23059669"/></linearGradient></defs><rect width="80" height="80" rx="40" fill="url(%23bg_e)"/><circle cx="36" cy="36" r="16" fill="none" stroke="%23ffffff" stroke-width="3.5"/><line x1="48" y1="48" x2="62" y2="62" stroke="%23ffffff" stroke-width="4.5" stroke-linecap="round"/><circle cx="36" cy="36" r="6" fill="none" stroke="%23ffffff" stroke-width="2"/><circle cx="36" cy="36" r="2" fill="%23ffffff"/></svg>`,
  },
  {
    id: 'orange_wrench',
    name: '精修双工匠',
    roleLabel: '检修技师 / 操作工',
    colorHex: '#f97316',
    gradient: 'from-orange-500 to-amber-600',
    svgDataUri: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80"><defs><linearGradient id="bg_o" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="%23f97316"/><stop offset="100%" stop-color="%23d97706"/></linearGradient></defs><rect width="80" height="80" rx="40" fill="url(%23bg_o)"/><path d="M25 55 L45 35 M42 32 L48 26 C51 29 55 29 58 26 L54 22 C51 22 48 18 51 15 C46 15 41 18 39 23 L33 29 Z" fill="%23ffffff"/><circle cx="25" cy="55" r="4" fill="%23ffffff"/><circle cx="55" cy="55" r="7" fill="none" stroke="%23ffffff" stroke-width="3"/><path d="M55 48 L55 62 M48 55 L62 55" stroke="%23ffffff" stroke-width="2.5"/></svg>`,
  },
  {
    id: 'purple_crane',
    name: '重装行车手',
    roleLabel: '特种设备 / 司机',
    colorHex: '#8b5cf6',
    gradient: 'from-purple-500 to-purple-600',
    svgDataUri: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80"><defs><linearGradient id="bg_p" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="%238b5cf6"/><stop offset="100%" stop-color="%237c3aed"/></linearGradient></defs><rect width="80" height="80" rx="40" fill="url(%23bg_p)"/><circle cx="40" cy="40" r="21" fill="none" stroke="%23ffffff" stroke-width="3.5"/><circle cx="40" cy="40" r="7" fill="%23ffffff"/><line x1="19" y1="40" x2="33" y2="40" stroke="%23ffffff" stroke-width="3.5"/><line x1="47" y1="40" x2="61" y2="40" stroke="%23ffffff" stroke-width="3.5"/><line x1="40" y1="47" x2="40" y2="61" stroke="%23ffffff" stroke-width="3.5"/></svg>`,
  },
  {
    id: 'indigo_vault',
    name: '数字档案馆',
    roleLabel: '档案管理员 / 专家',
    colorHex: '#6366f1',
    gradient: 'from-indigo-500 to-indigo-600',
    svgDataUri: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80"><defs><linearGradient id="bg_i" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="%236366f1"/><stop offset="100%" stop-color="%234f46e5"/></linearGradient></defs><rect width="80" height="80" rx="40" fill="url(%23bg_i)"/><rect x="22" y="24" width="36" height="34" rx="4" fill="none" stroke="%23ffffff" stroke-width="3"/><path d="M22 34 L58 34" stroke="%23ffffff" stroke-width="2.5"/><circle cx="40" cy="45" r="3.5" fill="%23ffffff"/><path d="M40 48 L40 52" stroke="%23ffffff" stroke-width="2" stroke-linecap="round"/></svg>`,
  },
];

/**
 * 角色职业照片池映射表 (存储于 public/avatars/)
 * 支持第一套与第二套变体照片池
 */
export const ROLE_DEFAULT_PHOTOS: Record<string, string[]> = {
  admin: ['/avatars/admin.png', '/avatars/admin-b.png'],
  manager: ['/avatars/manager.png', '/avatars/manager-b.png'],
  // 池长按演示名册哈希校准：同角色多人必须落在不同下标（inspector 4 张、operator 3 张）
  inspector: ['/avatars/inspector.png', '/avatars/inspector-b.png', '/avatars/inspector-c.png', '/avatars/inspector-d.png'],
  operator: ['/avatars/operator.png', '/avatars/operator-b.png', '/avatars/operator-c.png'],
  technician: ['/avatars/technician.png', '/avatars/technician-b.png'],
  driver: ['/avatars/driver.png', '/avatars/driver-b.png'],
  archivist: ['/avatars/archivist.png', '/avatars/archivist-b.png'],
};

/**
 * 解析出归一化的角色 key (沿用现有长词优先过滤逻辑)
 */
export function resolveRoleKey(role?: string, roleTitle?: string): string {
  const r = (role || '').toLowerCase().trim();
  const t = (roleTitle || '').toLowerCase().trim();

  // 1. 优先按 role 字段精确匹配
  if (r === 'admin') return 'admin';
  if (r === 'manager' || r === 'supervisor') return 'manager';
  if (r === 'inspector') return 'inspector';
  if (r === 'operator' || r === 'user') return 'operator';
  if (r === 'technician') return 'technician';
  if (r === 'driver') return 'driver';
  if (r === 'archivist') return 'archivist';

  // 2. 仅当 role 缺失/未知时才用 roleTitle 关键词兜底（长词优先，避免"档案管理员"被"管理员"误吃）
  if (t.includes('档案')) {
    return 'archivist';
  }
  if (t.includes('司机') || t.includes('驾驶') || t.includes('起重') || t.includes('吊装') || t.includes('行车')) {
    return 'driver';
  }
  if (t.includes('点检') || t.includes('巡检') || t.includes('质检')) {
    return 'inspector';
  }
  if (t.includes('操作')) {
    return 'operator';
  }
  if (t.includes('技师') || t.includes('检修') || t.includes('维修')) {
    return 'technician';
  }
  if (t.includes('机电') || t.includes('部长') || t.includes('主管') || t.includes('总监')) {
    return 'manager';
  }
  if (t.includes('总工') || t.includes('管理员')) {
    return 'admin';
  }

  return 'admin';
}

/**
 * 稳定哈希分配照片：
 * 种子为「姓名#工号」联合串（两者任一缺失仍稳定），字符码累加 % 池长度；
 * 同一用户每次渲染同一张，同角色多人按池长错开（池长见 ROLE_DEFAULT_PHOTOS 注释）。
 */
export function pickRolePhoto(role?: string, roleTitle?: string, name?: string, username?: string): string {
  const roleKey = resolveRoleKey(role, roleTitle);
  const pool = ROLE_DEFAULT_PHOTOS[roleKey] || ROLE_DEFAULT_PHOTOS.admin;
  if (!pool || pool.length === 0) return '/avatars/admin.png';
  if (pool.length === 1) return pool[0];

  const seedStr = `${(name || '').trim()}#${(username || '').trim()}`;
  if (seedStr === '#') return pool[0];

  let sum = 0;
  for (let i = 0; i < seedStr.length; i++) {
    sum = (sum + seedStr.charCodeAt(i)) % 65535;
  }
  const index = Math.abs(sum) % pool.length;
  return pool[index];
}

export function getRoleDefaultPhoto(role?: string, roleTitle?: string, name?: string, username?: string): string {
  return pickRolePhoto(role, roleTitle, name, username);
}

/**
 * 12 套按岗位角色专属定制的内置职业照片头像（6 角色 × 2 套，分组为第一套与第二套）
 */
export const BUILTIN_ROLE_PHOTOS = [
  // 第一套经典款
  {
    id: 'photo_admin_a',
    series: 'set1',
    seriesLabel: '第一套标准职业照',
    name: '车间总工 / 管理员 (款 A)',
    roleKey: 'admin',
    roleLabel: '技术总负责人',
    photoUrl: '/avatars/admin.png',
  },
  {
    id: 'photo_manager_a',
    series: 'set1',
    seriesLabel: '第一套标准职业照',
    name: '机电部长 / 主管 (款 A)',
    roleKey: 'manager',
    roleLabel: '机电设备主管',
    photoUrl: '/avatars/manager.png',
  },
  {
    id: 'photo_inspector_a',
    series: 'set1',
    seriesLabel: '第一套标准职业照',
    name: '点检 / 巡检工程师 (款 A)',
    roleKey: 'inspector',
    roleLabel: '精密测点点检员',
    photoUrl: '/avatars/inspector.png',
  },
  {
    id: 'photo_operator_a',
    series: 'set1',
    seriesLabel: '第一套标准职业照',
    name: '检修技师 / 操作工 (款 A)',
    roleKey: 'operator',
    roleLabel: '机械设备精修技师',
    photoUrl: '/avatars/operator.png',
  },
  {
    id: 'photo_driver_a',
    series: 'set1',
    seriesLabel: '第一套标准职业照',
    name: '特种设备 / 司机 (款 A)',
    roleKey: 'driver',
    roleLabel: '重载行车与工程司机',
    photoUrl: '/avatars/driver.png',
  },
  {
    id: 'photo_archivist_a',
    series: 'set1',
    seriesLabel: '第一套标准职业照',
    name: '档案管理员 / 专家 (款 A)',
    roleKey: 'archivist',
    roleLabel: '技术标准与规程专家',
    photoUrl: '/avatars/archivist.png',
  },
  // 第二套多元变体款
  {
    id: 'photo_admin_b',
    series: 'set2',
    seriesLabel: '第二套多元变体照',
    name: '车间总工 / 管理员 (款 B)',
    roleKey: 'admin',
    roleLabel: '技术总负责人·现场督导',
    photoUrl: '/avatars/admin-b.png',
  },
  {
    id: 'photo_manager_b',
    series: 'set2',
    seriesLabel: '第二套多元变体照',
    name: '机电部长 / 主管 (款 B)',
    roleKey: 'manager',
    roleLabel: '机电设备主管·现场研讨',
    photoUrl: '/avatars/manager-b.png',
  },
  {
    id: 'photo_inspector_b',
    series: 'set2',
    seriesLabel: '第二套多元变体照',
    name: '点检 / 巡检工程师 (款 B)',
    roleKey: 'inspector',
    roleLabel: '精密测点点检员·作业风采',
    photoUrl: '/avatars/inspector-b.png',
  },
  {
    id: 'photo_operator_b',
    series: 'set2',
    seriesLabel: '第二套多元变体照',
    name: '检修技师 / 操作工 (款 B)',
    roleKey: 'operator',
    roleLabel: '机械设备精修技师·工装',
    photoUrl: '/avatars/operator-b.png',
  },
  {
    id: 'photo_driver_b',
    series: 'set2',
    seriesLabel: '第二套多元变体照',
    name: '特种设备 / 司机 (款 B)',
    roleKey: 'driver',
    roleLabel: '重载工程司机·出车标准',
    photoUrl: '/avatars/driver-b.png',
  },
  {
    id: 'photo_archivist_b',
    series: 'set2',
    seriesLabel: '第二套多元变体照',
    name: '档案管理员 / 专家 (款 B)',
    roleKey: 'archivist',
    roleLabel: '技术标准与规程专家·工装',
    photoUrl: '/avatars/archivist-b.png',
  },
  // 第三套扩池变体：technician 专属岗 + inspector/operator 多人错开补充款
  {
    id: 'photo_technician_a',
    series: 'set3',
    seriesLabel: '第三套扩池变体照',
    name: '电气维修技师 (款 A)',
    roleKey: 'technician',
    roleLabel: '电气专工·高压试验',
    photoUrl: '/avatars/technician.png',
  },
  {
    id: 'photo_technician_b',
    series: 'set3',
    seriesLabel: '第三套扩池变体照',
    name: '机电检修技师 (款 B)',
    roleKey: 'technician',
    roleLabel: '高级技师·机械精修',
    photoUrl: '/avatars/technician-b.png',
  },
  {
    id: 'photo_inspector_c',
    series: 'set3',
    seriesLabel: '第三套扩池变体照',
    name: '点检 / 巡检工程师 (款 C)',
    roleKey: 'inspector',
    roleLabel: '资深点检·仪表读数',
    photoUrl: '/avatars/inspector-c.png',
  },
  {
    id: 'photo_inspector_d',
    series: 'set3',
    seriesLabel: '第三套扩池变体照',
    name: '点检 / 巡检工程师 (款 D)',
    roleKey: 'inspector',
    roleLabel: '安全监护·现场巡检',
    photoUrl: '/avatars/inspector-d.png',
  },
  {
    id: 'photo_operator_c',
    series: 'set3',
    seriesLabel: '第三套扩池变体照',
    name: '现场操作工 (款 C)',
    roleKey: 'operator',
    roleLabel: '生产岗操作·行车现场',
    photoUrl: '/avatars/operator-c.png',
  },
];

/**
 * 判断当前头像尺寸是否允许显示右下角首字徽标 (>= 28px)
 */
function shouldShowBadge(size: number | string): boolean {
  if (typeof size === 'number') {
    return size >= 28;
  }
  const s = String(size).toLowerCase();
  if (s === '24' || s === 'xs') return false;
  return true;
}

/**
 * 徽标尺寸样式映射 (12-14px 左右)
 */
function getBadgeClasses(size: number | string): { badge: string; text: string } {
  const isLarge = typeof size === 'number' ? size >= 40 : ['40', '48', 'lg', 'xl'].includes(String(size));
  if (isLarge) {
    return {
      badge: 'w-4 h-4 min-w-[16px] -bottom-0.5 -right-0.5 ring-[1.5px] ring-white',
      text: 'text-[9px] font-bold leading-none',
    };
  }
  return {
    badge: 'w-3.5 h-3.5 min-w-[14px] -bottom-0.5 -right-0.5 ring-1 ring-white',
    text: 'text-[8.5px] font-bold leading-none',
  };
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  user,
  name: directName,
  role: directRole,
  roleTitle: directRoleTitle,
  avatar: directAvatar,
  size = 'sm',
  className = '',
  showBorder = false,
}) => {
  const name = directName ?? user?.name ?? user?.username ?? '用';
  const username = user?.username;
  const role = directRole ?? user?.role;
  const roleTitle = directRoleTitle ?? user?.roleTitle;
  const rawAvatar = directAvatar ?? user?.avatar;

  // 判断是否属于用户主动上传或设置的自定义头像（非空且非 unsplash）
  const hasCustomAvatar = Boolean(
    typeof rawAvatar === 'string' &&
    rawAvatar.trim() &&
    !rawAvatar.includes('unsplash.com') &&
    !rawAvatar.startsWith('/avatars/')
  );

  const defaultPhoto = pickRolePhoto(role, roleTitle, name, username);

  // 显示优先级：user.avatar（用户上传/选择）> 角色照片池（哈希分配）> 首字渐变圆
  const initialImgSrc = React.useMemo(() => {
    if (typeof rawAvatar === 'string' && rawAvatar.trim() && !rawAvatar.includes('unsplash.com')) {
      return rawAvatar.trim();
    }
    return defaultPhoto;
  }, [rawAvatar, defaultPhoto]);

  const [currentSrc, setCurrentSrc] = useState<string | null>(initialImgSrc);
  const [useFallbackInitial, setUseFallbackInitial] = useState<boolean>(false);

  React.useEffect(() => {
    setCurrentSrc(initialImgSrc);
    setUseFallbackInitial(false);
  }, [initialImgSrc]);

  const handleError = () => {
    if (currentSrc && currentSrc !== defaultPhoto) {
      // 第一级降级：自定义图片加载失败，优雅回退到角色照片池哈希分配照片
      setCurrentSrc(defaultPhoto);
    } else {
      // 最终兜底：角色职业照片也失败时，使用姓名首字+角色色渐变圆
      setUseFallbackInitial(true);
    }
  };

  const { container, text } = getSizeClasses(size);
  const gradientClass = getRoleGradient(role, roleTitle);
  const firstChar = getFirstChar(name, username);

  const borderClass = showBorder ? 'ring-1 ring-blue-500/40 shadow-xs' : 'ring-1 ring-black/5';

  // 渲染照片时叠加右下角姓名首字圆徽：
  // 规则：未上传自定义头像、且 size >= 28px 时展示，白字、角色色底（复用 getRoleGradient）、细白边框
  const canShowBadge = !hasCustomAvatar && shouldShowBadge(size);
  const { badge: badgeSizeClass, text: badgeTextClass } = getBadgeClasses(size);

  if (!useFallbackInitial && currentSrc) {
    return (
      <div className={`relative inline-flex shrink-0 select-none ${container} ${className}`}>
        {/* 底衬：照片未解码完/加载失败时露出角色色圆，避免出现空白白圈（不注入文字，避免污染 textContent） */}
        <div className={`absolute inset-0 rounded-full ${gradientClass}`} aria-hidden="true" />
        <img
          src={currentSrc}
          alt={name}
          onError={handleError}
          className={`relative w-full h-full rounded-full object-cover shrink-0 ${borderClass}`}
        />
        {canShowBadge && (
          <span
            className={`absolute ${badgeSizeClass} rounded-full flex items-center justify-center text-white shadow-xs ${gradientClass}`}
            title={`用户: ${name}`}
          >
            <span className={badgeTextClass}>{firstChar}</span>
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className={`${container} rounded-full flex items-center justify-center shrink-0 select-none font-semibold text-white ${gradientClass} ${borderClass} ${className}`}
      title={`${name} (${roleTitle || role || '用户'})`}
    >
      <span className={text}>{firstChar}</span>
    </div>
  );
};

