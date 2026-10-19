/**
 * 遥测数据摄入控制器（POST /api/v1/telemetry/ingest）。
 *
 * 诚实性边界（与 telemetryRepository.ts 文件头声明、README「遥测数据来源」段一致）：
 * 本端点接收「真实采集或模拟采集」的读数并落库 equipment_telemetry。落库后与种子
 * 仿真数据同表，消费方无法从数据本身区分来源；来源语义由调用方在 source 字段与
 * 审计日志中声明。UI 与文档一律不得据此表述为「产线实测」——接入真实 OT 数据源
 * 仍属 3.0 范围（协议级设计见 docs/工业化演进与硬件对接方案.md 第四节）。
 */
import { TelemetryRepository, EquipmentRepository } from "../../db/repositories/index.ts";
import { addAuditLog } from "../services/auditService.ts";

export async function handleIngestTelemetry(req: any, res: any) {
  try {
    const { source, points } = req.body;

    // 1. 设备存在性整体校验：任一设备不存在则整体拒绝（防脏数据混入健康曲线）
    const ids = [...new Set((points as { equipmentId: string }[]).map((p) => p.equipmentId))];
    const found = await Promise.all(ids.map((id) => EquipmentRepository.getById(id)));
    const missing = ids.filter((_, i) => !found[i]);
    if (missing.length > 0) {
      return res.status(404).json({
        error: `遥测摄入拒绝：设备不存在 ${missing.join(", ")}`,
        code: "EQUIPMENT_NOT_FOUND",
        missingEquipmentIds: missing,
      });
    }

    // 2. 落库（与种子共用 insertBatch 底层写入；记录时间缺省由数据库兜底）
    const ingested = await TelemetryRepository.insertBatch(points as any);

    // 3. 审计留痕（写操作必须可追溯；来源自述仅作口径，不伪造"实测"）
    addAuditLog(req, {
      actionType: "TELEMETRY_INGEST",
      module: "设备健康",
      detail: `遥测摄入 ${ingested} 条（${ids.length} 台设备${source ? `，来源 ${source}` : ""}）`,
      status: "SUCCESS",
      metadata: { source: source || null, equipmentIds: ids, pointCount: ingested },
    });

    return res.json({
      ingested,
      equipmentIds: ids,
      message: `已摄入 ${ingested} 条遥测读数（${ids.length} 台设备）`,
    });
  } catch (err: any) {
    return res.status(500).json({ error: "遥测摄入失败: " + err.message });
  }
}
