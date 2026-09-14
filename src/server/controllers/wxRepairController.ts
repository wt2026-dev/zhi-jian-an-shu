// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import { Request, Response } from "express";
import { STATUS_LABELS, pushWorkOrderLog } from "./workOrderController.ts";
import { pushNotification } from "../services/auditService.ts";
import { EquipmentRepository, WorkOrderRepository } from "../../db/repositories/index.ts";

// 接口④ POST /api/v1/wx/repairs 微信小程序免登录快速扫码报修创建
const wxRepairRateLimitMap = new Map<string, number[]>(); // key -> timestamps[]
export async function handleWxRepairCreate(req: Request, res: Response) {
  try {
    const { deviceId, desc, level = "normal", faultType = "扫码现场报修", images = [], reporter, phone, openid, userId } = req.body;
    const clientIp = req.ip || req.connection?.remoteAddress || "unknown_ip";
    const rateLimitKey = openid || userId || `dev_${deviceId}_${clientIp}`;

    // 1. 简单频率限制：同 openid / 设备 / IP 10 分钟内限 5 单
    const nowTime = Date.now();
    const tenMinutesAgo = nowTime - 10 * 60 * 1000;
    // 内存防护：限流 Map 按 key 累积（扫码来源不可枚举），规模超阈值时清扫全部过期 key，防止长期运行内存无限增长
    if (wxRepairRateLimitMap.size > 5000) {
      for (const [key, stamps] of wxRepairRateLimitMap) {
        if (!stamps.some((t) => t >= tenMinutesAgo)) wxRepairRateLimitMap.delete(key);
      }
    }
    const historyTimestamps = (wxRepairRateLimitMap.get(rateLimitKey) || []).filter((t) => t >= tenMinutesAgo);
    if (historyTimestamps.length >= 5) {
      return res.status(429).json({
        success: false,
        code: "RATE_LIMIT_EXCEEDED",
        error: "报修提交过于频繁，同账号/设备10分钟内最多创建5笔报修工单",
      });
    }
    historyTimestamps.push(nowTime);
    wxRepairRateLimitMap.set(rateLimitKey, historyTimestamps);

    // 2. 校验并获取设备详情（支持 ID 与编码模糊回填）
    const eq = await EquipmentRepository.getById(deviceId);
    if (!eq) {
      return res.status(404).json({
        success: false,
        code: "EQUIPMENT_NOT_FOUND",
        error: `设备【${deviceId}】不存在，请重新扫码或核对设备编码`,
      });
    }

    // 3. 重复提交拦截：同 openid 或同设备 10 分钟内已存在未闭环单则拦截
    const activeStatuses = ["created", "dispatched", "in_progress"];
    const allOrders = await WorkOrderRepository.getAll();
    const existingDuplicate = allOrders.find(
      (w: any) =>
        w.equipmentId === eq.id &&
        activeStatuses.includes(w.status) &&
        (Number(w.createdTimestamp) || 0) >= tenMinutesAgo &&
        (!openid ||
          w.wxOpenid === openid ||
          w.creator?.includes(openid) ||
          (typeof w.description === "string" && w.description.includes(openid)))
    );

    if (existingDuplicate) {
      const statusLabel = STATUS_LABELS[existingDuplicate.status] || existingDuplicate.status;
      return res.status(409).json({
        success: false,
        code: "DUPLICATE_WORK_ORDER",
        error: `已有进行中的报修单：设备【${eq.name}】当前已有未闭环工单【${existingDuplicate.orderNo}】(${statusLabel})，机电保全部正在处理中，请勿重复提交。`,
        orderNo: existingDuplicate.orderNo,
      });
    }

    // 4. 转换响应优先级
    let priority = "medium";
    const lvlStr = String(level).toLowerCase();
    if (lvlStr.includes("critical") || lvlStr.includes("特急")) {
      priority = "urgent";
    } else if (lvlStr.includes("urgent") || lvlStr.includes("high") || lvlStr.includes("紧急")) {
      priority = "high";
    } else {
      priority = "medium";
    }

    // 5. 生成单号并创建工单 (state=待派单/created, source=wx_scan)
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
    const orderNo = `WO-${dateStr}-${Math.floor(100 + Math.random() * 900)}`;
    const id = `wo-${Date.now()}`;
    const createdAtStr =
      now.toLocaleDateString("zh-CN") +
      " " +
      now.toLocaleTimeString("zh-CN", { hour12: false });

    const creatorName = reporter || (userId ? `用户(${userId})` : (openid ? `微信工友(${openid.slice(-4)})` : "微信扫码现场人员"));

    const newOrder: any = {
      id,
      orderNo,
      title: `【扫码报修】${eq.name} - ${faultType}`,
      equipmentId: eq.id,
      equipmentName: eq.name,
      equipmentCode: eq.code,
      workshop: eq.workshop,
      faultType,
      priority,
      status: "created",
      creator: creatorName,
      source: "wx_scan",
      createdAt: createdAtStr,
      description: `${desc.trim()}${phone ? ` (联系电话: ${phone})` : ""}${openid ? ` [openid: ${openid}]` : ""}`,
      safetyRequirements: ["穿戴劳保鞋与安全帽", "实施现场安全警示", "实施 LOTO 停电挂牌"],
      photos: images,
      repairLog: null,
      acceptance: null,
      version: 1,
      createdTimestamp: Date.now(),
      wxOpenid: openid || null,
    };

    const created = await WorkOrderRepository.create(newOrder);

    // 设备故障状态联动
    if (priority === "urgent" || priority === "high") {
      await EquipmentRepository.updateStatus(eq.id, "fault");
    }

    // 写入流转审计日志
    pushWorkOrderLog({
      id: `log-${Date.now()}`,
      workOrderId: id,
      action: "CREATE",
      previousStatus: null,
      newStatus: "created",
      operatorName: creatorName,
      comment: `微信扫码申报工单 [来源: wx_scan]: ${newOrder.title}`,
      createdAt: createdAtStr,
    });

    // 推送待办通知给网页端管理员
    pushNotification({
      title: priority === "urgent" ? `【特急扫码报修】${orderNo} 待派单` : `【扫码报修】${orderNo} 已创建待派单`,
      content: `设备 ${eq.name} (${eq.code}) 来自微信扫码报修，报修人 ${creatorName}，请尽快派发机电人员！`,
      type: priority === "urgent" ? "alert" : "info",
      refType: "work_order",
      refId: orderNo,
    });

    res.status(201).json({
      success: true,
      orderNo,
      id,
      status: "created",
      source: "wx_scan",
      message: "报修工单创建成功，已指派生产机电保全部待调度队列",
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: "创建报修单失败: " + err.message,
    });
  }
}
