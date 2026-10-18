import { UserRole } from '../../types';

export interface RoleDefinition {
  role: UserRole;
  title: string;
  desc: string;
  badgeColor: string;
}

export const ROLES_LIST: RoleDefinition[] = [
  {
    role: 'admin',
    title: '系统管理员 / 车间总工',
    desc: '具备全系统最高控制权，包含工单派发、安全作业票终审放行、设备建档与用户授权',
    badgeColor: 'bg-red-50 text-red-700 border-red-200',
  },
  {
    role: 'technician',
    title: '设备检修工程师 / 技师',
    desc: '负责工单接单响应、现场故障拆检修复、备件领用耗用填报与安全作业票申请',
    badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  {
    role: 'inspector',
    title: '现场点巡检员 / 质检员',
    desc: '负责日常巡检路线打卡、多参数现场抄表、设备异常发现与完工质检验收',
    badgeColor: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  },
  {
    role: 'operator',
    title: '车间操作员 / 普通用户',
    desc: '负责日常生产设备看护、突发异响报修申请、设备运行状态与知识规程查询',
    badgeColor: 'bg-slate-100 text-slate-600 border-slate-200',
  },
];

export interface PermissionMatrixItem {
  module: string;
  admin: boolean | string;
  technician: boolean | string;
  inspector: boolean | string;
  operator: boolean | string;
}

export const PERMISSIONS_MATRIX: PermissionMatrixItem[] = [
  {
    module: '设备档案与台账',
    admin: true,
    technician: true,
    inspector: true,
    operator: '仅查看',
  },
  {
    module: '设备实时健康遥测',
    admin: true,
    technician: true,
    inspector: true,
    operator: true,
  },
  {
    module: '工单创建与申报',
    admin: true,
    technician: true,
    inspector: true,
    operator: true,
  },
  {
    module: '工单调度派单权限',
    admin: true,
    technician: false,
    inspector: false,
    operator: false,
  },
  {
    module: '工单施工接单与维修报告',
    admin: true,
    technician: true,
    inspector: false,
    operator: false,
  },
  {
    module: '工单质检验收归档',
    admin: true,
    technician: false,
    inspector: true,
    operator: false,
  },
  {
    module: '现场点巡检打卡与抄表',
    admin: true,
    technician: true,
    inspector: true,
    operator: false,
  },
  {
    module: '高危安全作业票审批放行',
    admin: true,
    technician: false,
    inspector: false,
    operator: false,
  },
  {
    module: 'LOTO 能量隔离挂牌上锁',
    admin: true,
    technician: true,
    inspector: false,
    operator: false,
  },
  {
    module: 'AI 检修大脑与图像诊断',
    admin: true,
    technician: true,
    inspector: true,
    operator: true,
  },
  {
    module: '知识库发布与规程修订',
    admin: true,
    technician: true,
    inspector: false,
    operator: '仅检索',
  },
];

export interface NewUserFormState {
  name: string;
  username: string;
  role: UserRole;
  department: string;
  phone: string;
  email: string;
}

export const INITIAL_USER_FORM: NewUserFormState = {
  name: '',
  username: '',
  role: 'technician',
  department: '动力机电维保车间',
  phone: '',
  email: '',
};
