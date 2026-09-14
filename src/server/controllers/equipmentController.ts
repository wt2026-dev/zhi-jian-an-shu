// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import QRCode from "qrcode";
import { EquipmentRepository, TelemetryRepository } from "../../db/repositories/index.ts";
import { addAuditLog, pushNotification } from "../services/auditService.ts";

// 1. 获取设备台账列表
export async function handleGetEquipments(req: any, res: any) {
  try {
    const { workshop, status, search } = req.query;
    const result = await EquipmentRepository.getAll({
      workshop: workshop as string,
      status: status as string,
      search: search as string,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: "获取设备台账失败: " + err.message });
  }
}

// 2. 获取单个设备详情
export async function handleGetEquipmentById(req: any, res: any) {
  try {
    const eq = await EquipmentRepository.getById(req.params.id);
    if (!eq) return res.status(404).json({ error: "设备未找到" });
    res.json(eq);
  } catch (err: any) {
    res.status(500).json({ error: "获取设备详情失败: " + err.message });
  }
}

// 14. 设备专属二维码
export async function handleGetEquipmentQrcode(req: any, res: any) {
  const eq = (await EquipmentRepository.getById(req.params.id)) || (await EquipmentRepository.getAll())[0];
  if (!eq) return res.status(404).send("Equipment not found");
  const host = req.get("host") || "localhost:3000";
  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const scanJumpUrl = `${protocol}://${host}/?view=inspections&equipmentId=${eq.id}&scan=1`;

  try {
    const qrBuffer = await QRCode.toBuffer(scanJumpUrl, {
      type: "png",
      width: 360,
      margin: 2,
      color: {
        dark: "#0f172a",
        light: "#ffffff",
      },
    });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("X-Scan-Jump-Url", scanJumpUrl);
    res.send(qrBuffer);
  } catch (err: any) {
    console.error("[QRCode] 生成设备二维码失败:", err);
    res.status(500).send("生成二维码失败: " + err?.message);
  }
}

// 14. 设备历史时序监控接口
export async function handleGetEquipmentTelemetryHistory(req: any, res: any) {
  const eq = (await EquipmentRepository.getById(req.params.id)) || (await EquipmentRepository.getAll())[0];
  if (!eq) return res.status(404).json({ error: "设备未找到" });

  // 优先读取真实落库的遥测历史时序数据 (equipment_telemetry 表)
  try {
    const persisted = await TelemetryRepository.getHistory(eq.id, 24);
    if (persisted && persisted.length > 0) {
      return res.json({
        equipmentId: eq.id,
        equipmentCode: eq.code,
        equipmentName: eq.name,
        status: eq.status,
        healthScore: eq.healthScore,
        points: persisted,
      });
    }
  } catch (err: any) {
    console.warn("[Telemetry] 读取落库遥测历史失败，降级为实时生成:", err.message);
  }

  // 兜底：无落库数据时基于当前遥测值实时生成
  const telemetry = (eq.telemetry as any) || {};
  const baseTemp = telemetry.temperature || 72.0;
  const baseVib = telemetry.vibration || 3.2;
  const baseCurrent = telemetry.current || 65.0;
  const basePressure = telemetry.pressure || 1.2;

  const points: any[] = [];
  const now = Date.now();
  for (let i = 24; i >= 0; i--) {
    const t = new Date(now - i * 3600 * 1000);
    const noise = (Math.random() - 0.5) * 0.1;
    points.push({
      timestamp: `${t.getHours().toString().padStart(2, "0")}:00`,
      fullTime: t.toLocaleString("zh-CN"),
      temperature: Number((baseTemp * (1 + noise)).toFixed(1)),
      vibration: Number((baseVib * (1 + noise * 1.5)).toFixed(2)),
      current: Number((baseCurrent * (1 + noise)).toFixed(1)),
      pressure: Number((basePressure * (1 + noise * 0.5)).toFixed(2)),
      loadRate: Number((78 + noise * 15).toFixed(1)),
    });
  }

  res.json({
    equipmentId: eq.id,
    equipmentCode: eq.code,
    equipmentName: eq.name,
    status: eq.status,
    healthScore: eq.healthScore,
    points,
  });
}

// 新增设备档案 (仅限管理员 / 主管，真实落库 equipments 表)
export async function handleCreateEquipment(req: any, res: any) {
  try {
    const body = req.body;
    const existing = await EquipmentRepository.getAll({ search: body.code });
    if (existing.some((e: any) => e.code === body.code)) {
      return res.status(409).json({ error: `设备编码 ${body.code} 已存在`, code: "EQUIPMENT_CODE_CONFLICT" });
    }

    const now = new Date();
    const created = await EquipmentRepository.create({
      code: body.code,
      name: body.name,
      category: body.category,
      model: body.model,
      workshop: body.workshop,
      location: body.location,
      installDate: now.toISOString().split("T")[0],
      manufacturer: body.manufacturer,
      status: body.status || "running",
      healthScore: 100,
      criticality: body.criticality || "主要生产",
      telemetry: {
        temperature: 0,
        vibration: 0,
        voltage: 0,
        current: 0,
        loadRate: 0,
        lastUpdated: "待首次遥测上报",
      },
      specs: body.specs || { "安装工段": body.workshop || "未指定" },
      maintenanceHistory: [],
      nextInspectionDate: new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString().split("T")[0],
      qrCode: `EQUIP-${body.code}-${now.getTime().toString(36).toUpperCase()}`,
    });

    addAuditLog(req, {
      actionType: "EQUIPMENT_CREATE",
      module: "设备台账",
      detail: `${req.currentUser.name} 新增设备档案 [${body.name} / ${body.code}]`,
      status: "SUCCESS",
      metadata: { equipmentId: created?.id, code: body.code },
    });
    pushNotification({
      title: `【新设备建档】${body.name} (${body.code})`,
      content: `设备 ${body.name} (${body.code}) 已成功录入资产档案库，建档人 ${req.currentUser.name}。`,
      type: "info",
      refType: "equipment",
      refId: body.code,
    });

    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: "新增设备档案失败: " + err.message });
  }
}
