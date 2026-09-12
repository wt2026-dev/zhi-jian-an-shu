// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import { ComplianceCheckRepository } from "../../db/repositories/index.ts";

// ==================== 操作失误率与合规统计接口 ====================
export const handleGetComplianceStats = async (req: any, res: any) => {
  try {
    const operator = (req.query.operator || req.query.assignee || req.query.user || "") as string;
    const stats = await ComplianceCheckRepository.getStats(operator || undefined);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: "获取合规统计数据失败: " + err.message });
  }
};
