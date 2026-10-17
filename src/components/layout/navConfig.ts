import React from 'react';
import {
  Activity,
  Tv,
  Sparkles,
  Workflow,
  ScanSearch,
  Route,
  Layers,
  Zap,
  Box,
  Boxes,
  Wrench,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Search,
  Share2,
  UserCheck,
  // Gamepad2, // 检修闯关模块已下线：图标随菜单项一并注释，恢复时取消注释即可
  Compass,
  Swords,
} from 'lucide-react';

export interface NavItemConfig {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  highlight?: boolean;
  /** 限定可见角色（不设置则全员可见）；用于内部调度等受限页面 */
  roles?: string[];
}

export interface NavGroupConfig {
  id: string;
  label: string;
  items: NavItemConfig[];
}

// ── 角色集合速记（只为可读性，roles 字段里仍然写全量数组）──────────────────────
/** 管理层视图：总工 + 车间主管 */
const MGMT = ['admin', 'manager'];
/** 设备技术线：主管 + 技师 + 点检（档案员不参与现场处置） */
const ASSET_TECH = ['admin', 'manager', 'technician', 'inspector'];
/** 含档案员的设备档案（档案员管台账但不管现场） */
const ASSET_ARCHIVE = ['admin', 'manager', 'technician', 'inspector', 'archivist'];
/** 现场处置线：主管 + 技师 */
const FIELD = ['admin', 'manager', 'technician'];
/** 安全监督线：主管 + 点检 */
const SAFETY_AUDIT = ['admin', 'manager', 'inspector'];
/** 仅总工（系统管理） */
const ADMIN_ONLY = ['admin'];

export const NAV_GROUPS: NavGroupConfig[] = [
  {
    id: 'overview',
    label: '综合看板',
    items: [
      { id: 'dashboard', label: '工作台', icon: Activity }, // 全员可见
      { id: 'cockpit', label: '数据驾驶舱', icon: Tv, highlight: true, roles: [...MGMT] },
    ],
  },
  {
    id: 'ai',
    label: '智能 AI',
    items: [
      { id: 'ai_assistant', label: 'AI数字人助手', icon: Sparkles, highlight: true }, // 全员可见
      { id: 'ai_pipeline', label: 'AI 协同', icon: Workflow, highlight: true, roles: [...MGMT] },
    ],
  },
  {
    id: 'assets',
    label: '设备资产',
    items: [
      { id: 'equipments', label: '设备档案', icon: Layers, roles: [...ASSET_ARCHIVE] },
      { id: 'health', label: '健康监测', icon: Zap, roles: [...ASSET_TECH] },
      { id: 'equipment_3d', label: '3D 场景', icon: Boxes, roles: [...FIELD] },
      { id: 'spare_parts', label: '备件库存', icon: Box, roles: [...FIELD] },
    ],
  },
  {
    id: 'operations',
    label: '检修作业',
    items: [
      { id: 'work_orders', label: '检修工单', icon: Wrench }, // 全员可见
      { id: 'dispatch', label: '调度大屏', icon: Route, roles: [...FIELD] },
      { id: 'procedures', label: '作业指引', icon: BookOpen }, // 全员可见
      // { id: 'maintenance_game', label: '检修闯关', icon: Gamepad2 }, // 全员可见 —— 模块已下线，恢复时取消本行注释
      { id: 'maintenance_maze', label: '故障侦探', icon: Compass }, // 全员可见：俯视角工业迷宫
      { id: 'campaign', label: '智检修士', icon: Swords }, // 全员可见：七幕主线＝一遍完整业务流程
      { id: 'inspections', label: '巡检作业', icon: CheckCircle2, roles: [...SAFETY_AUDIT] },
      { id: 'hazards', label: '隐患闭环', icon: AlertTriangle, roles: [...SAFETY_AUDIT] },
    ],
  },
  {
    id: 'safety_compliance',
    label: '安全合规',
    items: [
      { id: 'safety', label: '安全与LOTO', icon: ShieldCheck, roles: [...ASSET_TECH] },
    ],
  },
  {
    id: 'knowledge_center',
    label: '知识中心',
    items: [
      { id: 'knowledge', label: '知识库RAG', icon: Search }, // 全员可见
      { id: 'knowledge_graph', label: '知识图谱', icon: Share2, roles: ['admin', 'manager', 'archivist'] },
    ],
  },
  {
    id: 'system',
    label: '系统管理',
    items: [
      { id: 'users', label: '用户与权限', icon: UserCheck, roles: [...ADMIN_ONLY] },
      { id: 'ai_reviews', label: 'AI 内容审核', icon: ScanSearch, roles: [...ADMIN_ONLY] },
      { id: 'ai_models', label: 'AI 模型路由', icon: Route, roles: [...ADMIN_ONLY] },
    ],
  },
];

/** 根据 activeTab 获取面包屑信息：[分组名, 页面名] */
export function getBreadcrumb(activeTab: string): { group: string; label: string } {
  for (const group of NAV_GROUPS) {
    const item = group.items.find((i) => i.id === activeTab);
    if (item) {
      return { group: group.label, label: item.label };
    }
  }
  return { group: '综合看板', label: '工作台' };
}
