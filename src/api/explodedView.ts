/**
 * 拆解视图 ↔ 检修业务联动 API 客户端（真实 DB 数据；接口定义见 server/routes/explodedView.ts）。
 *
 * 2026-10-20 从 api/index.ts 纯移动（第 1 刀），导出仍由 index.ts 桶转发，调用方零改动。
 * 只依赖 ./client 与同目录契约模块，不反向依赖桶，避免拆出后产生循环依赖。
 */
import { request } from './client';
import type {
  ExplodedWorkOrderBrief,
  ExplodedPartHistory,
  ExplodedFaultDiagnostics,
} from './explodedViewTypes';
import type {
  ExplodedPartLifeDiagnostics,
  ExplodedPartInventoryDiagnostics,
  MaintenanceReportData,
} from './explodedDiagnosticsTypes';

export const explodedViewApi = {
  /** 工单 → 拆解视图上下文（设备 + 真实 BOM 命中的目标位号） */
  getWorkOrderBrief: (workOrderId: string) =>
    request<ExplodedWorkOrderBrief>(`/work-orders/${workOrderId}/exploded-brief`),

  /** 拆解位号 → 真实维修历史（真实工单 / 备件库存 / 出入库流水） */
  getPartHistory: (deviceId: string, partId: string) =>
    request<ExplodedPartHistory>(`/equipments/${deviceId}/parts/${partId}/maintenance-history`),

  /** 设备 → 设备遥测故障诊断（拆解视图红色脉冲高亮「未处理故障」用） */
  getFaultDiagnostics: (deviceId: string) =>
    request<ExplodedFaultDiagnostics>(`/equipments/${deviceId}/fault-diagnostics`),

  /** 设备 → 真实零件寿命预警（真实更换记录 × 运行时钟；黄色/红色寿命高亮 + 保养建议用） */
  getPartLifeDiagnostics: (deviceId: string) =>
    request<ExplodedPartLifeDiagnostics>(`/equipments/${deviceId}/part-life-diagnostics`),

  /** 设备 → 真实备件库存联动（spare_parts 台账；库存四要素 + 采购申请用） */
  getPartInventory: (deviceId: string) =>
    request<ExplodedPartInventoryDiagnostics>(`/equipments/${deviceId}/part-inventory`),

  /** 设备 → 检修报告聚合数据（设备台账 + 拆解页 BOM + 故障/寿命/库存标注 + 完工单历史） */
  getMaintenanceReport: (deviceId: string) =>
    request<MaintenanceReportData>(`/equipments/${deviceId}/maintenance-report`),
};
