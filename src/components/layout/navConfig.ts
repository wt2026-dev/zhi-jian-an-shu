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
  Wrench,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Search,
  Share2,
  UserCheck,
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

export const NAV_GROUPS: NavGroupConfig[] = [
  {
    id: 'overview',
    label: '综合看板',
    items: [
      { id: 'dashboard', label: '工作台', icon: Activity },
      { id: 'cockpit', label: '数据驾驶舱', icon: Tv, highlight: true },
    ],
  },
  {
    id: 'ai',
    label: '智能 AI',
    items: [
      { id: 'ai_assistant', label: 'AI数字人助手', icon: Sparkles, highlight: true },
      { id: 'ai_pipeline', label: 'AI 协同', icon: Workflow, highlight: true },
    ],
  },
  {
    id: 'assets',
    label: '设备资产',
    items: [
      { id: 'equipments', label: '设备档案', icon: Layers },
      { id: 'health', label: '健康监测', icon: Zap },
      { id: 'spare_parts', label: '备件库存', icon: Box },
    ],
  },
  {
    id: 'operations',
    label: '检修作业',
    items: [
      { id: 'work_orders', label: '检修工单', icon: Wrench },
      { id: 'dispatch', label: '调度大屏', icon: Route, roles: ['admin', 'manager', 'technician'] },
      { id: 'procedures', label: '作业指引', icon: BookOpen },
      { id: 'inspections', label: '巡检作业', icon: CheckCircle2 },
      { id: 'hazards', label: '隐患闭环', icon: AlertTriangle },
    ],
  },
  {
    id: 'safety_compliance',
    label: '安全合规',
    items: [
      { id: 'safety', label: '安全与LOTO', icon: ShieldCheck },
    ],
  },
  {
    id: 'knowledge_center',
    label: '知识中心',
    items: [
      { id: 'knowledge', label: '知识库RAG', icon: Search },
      { id: 'knowledge_graph', label: '知识图谱', icon: Share2 },
    ],
  },
  {
    id: 'system',
    label: '系统管理',
    items: [
      { id: 'users', label: '用户与权限', icon: UserCheck },
      { id: 'ai_reviews', label: 'AI 内容审核', icon: ScanSearch },
      { id: 'ai_models', label: 'AI 模型路由', icon: Route },
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
