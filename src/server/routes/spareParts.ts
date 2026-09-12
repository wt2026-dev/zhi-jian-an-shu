// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import express from "express";
import { requireAuth } from "../middleware/auth.ts";
import { validateBody } from "../middleware/validate.ts";
import { createSparePartSchema, sparePartInOutSchema } from "../schemas/sparePart.ts";
import {
  handleGetSpareParts,
  handleGetLowStockSpareParts,
  handleGetSparePartById,
  handleCreateSparePart,
  handleSparePartInOut,
  handleGetSparePartMovements,
} from "../controllers/sparePartsController.ts";

export function registerSparePartsRoutes(app: express.Express) {
  // 1. 获取备件列表 (支持关键字/分类/低库存过滤)
  app.get("/api/v1/spare-parts", requireAuth, handleGetSpareParts);

  // 2. 低库存预警列表
  app.get("/api/v1/spare-parts/low-stock", requireAuth, handleGetLowStockSpareParts);

  // 3. 获取单项备件详情
  app.get("/api/v1/spare-parts/:id", requireAuth, handleGetSparePartById);

  // 4. 新增备件
  app.post("/api/v1/spare-parts", requireAuth, validateBody(createSparePartSchema), handleCreateSparePart);

  // 5. 备件出入库操作 (原子扣减 + 流水日志)
  app.post("/api/v1/spare-parts/:id/in-out", requireAuth, validateBody(sparePartInOutSchema), handleSparePartInOut);

  // 6. 单备件出入库履历
  app.get("/api/v1/spare-parts/:id/movements", requireAuth, handleGetSparePartMovements);
}
