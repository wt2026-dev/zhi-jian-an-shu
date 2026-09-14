// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import { SparePartsRepository, WorkOrderRepository } from "../../db/repositories/index.ts";
import { addAuditLog } from "../services/auditService.ts";

// 1. 获取备件列表 (支持关键字/分类/低库存过滤)
export async function handleGetSpareParts(req: any, res: any) {
  const { query, category, lowStock } = req.query as any;
  const parts = await SparePartsRepository.getAll({
    query: query ? String(query) : undefined,
    category: category ? String(category) : undefined,
    lowStock: lowStock === "true" || lowStock === "1",
  });
  res.json(parts);
}

// 2. 低库存预警列表
export async function handleGetLowStockSpareParts(req: any, res: any) {
  const lowParts = await SparePartsRepository.getLowStock();
  res.json(lowParts);
}

// 3. 获取单项备件详情
export async function handleGetSparePartById(req: any, res: any) {
  const part = await SparePartsRepository.getById(req.params.id);
  if (!part) return res.status(404).json({ success: false, error: "备件不存在" });
  res.json(part);
}

// 4. 新增备件
export async function handleCreateSparePart(req: any, res: any) {
  const body = req.body;
  const part = await SparePartsRepository.create({
    name: body.name,
    spec: body.spec,
    model: body.model,
    category: body.category,
    stock: body.stock,
    safe_stock: body.safeStock ?? body.safe_stock,
    unit: body.unit,
    location: body.location,
    price: body.price,
    target_equipment_type: body.targetEquipmentType ?? body.target_equipment_type,
  });
  addAuditLog(req, {
    actionType: "CREATE_SPARE_PART",
    module: "备件管理",
    detail: `新增工业备件: ${part.name} (${part.id}), 初始库存 ${part.stock}`,
    status: "SUCCESS",
    metadata: { partId: part.id },
  });
  res.status(201).json(part);
}

// 5. 备件出入库操作 (原子扣减 + 流水日志)
export async function handleSparePartInOut(req: any, res: any) {
  const { type, quantity, operatorName, relatedWorkOrderId, notes } = req.body;
  try {
    const user = (req as any).user;
    const opName = operatorName || (user ? `${user.name} (${user.roleTitle || user.role})` : "现场维修班组");
    const result = await SparePartsRepository.inOutStock(req.params.id, {
      type,
      quantity,
      operatorName: opName,
      relatedWorkOrderId,
      notes,
    });

    // 若关联了工单，向工单追加配件使用记录
    if (relatedWorkOrderId && type === "out") {
      const wo = await WorkOrderRepository.getById(relatedWorkOrderId);
      if (wo) {
        const partsUsed = Array.isArray((wo as any).partsUsed) ? [...(wo as any).partsUsed] : [];
        partsUsed.push(`${result.part.name} × ${quantity}${result.part.unit} (经办: ${opName})`);
        await WorkOrderRepository.update(relatedWorkOrderId, { partsUsed } as any);
      }
    }

    addAuditLog(req, {
      actionType: type === "in" ? "SPARE_PART_IN" : "SPARE_PART_OUT",
      module: "备件管理",
      detail: `备件【${result.part.name}】${type === "in" ? "采购入库" : "领用出库"} ${quantity} ${result.part.unit}，余量: ${result.part.stock}`,
      status: "SUCCESS",
      metadata: { partId: result.part.id, type, quantity, relatedWorkOrderId },
    });

    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || "出入库处理失败" });
  }
}

// 6. 单备件出入库履历
export async function handleGetSparePartMovements(req: any, res: any) {
  const movements = await SparePartsRepository.getMovements(req.params.id);
  res.json(movements);
}
