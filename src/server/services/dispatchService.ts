// 重构说明：内部师傅距离调度服务——就近派单推荐核心算法。
// 距离体系：真实厂区经纬度（geo_lng/geo_lat）+ Haversine 球面距离（米）。
//   旧 map_x/map_y（0~1000 画布）保留兼容：仅当某方缺少经纬度时才回退平面欧氏距离估算。
//   距离权重 40% + 空闲状态 30%（idle 优先于 online）+ 技能匹配 30%（轻量关键词映射，非 NLP）。
import { DispatchRepository } from "../../db/repositories/dispatchRepository.ts";
import { WorkOrderRepository } from "../../db/repositories/index.ts";
import { addAuditLog } from "./auditService.ts";

/** 兼容常量：旧平面坐标→米制估算（1 坐标单位 ≈ 2 米），仅无经纬度时兜底使用 */
export const METERS_PER_UNIT = 2;

/** 车间 → 区域左上角基准（0~1000 画布），与迁移 018 的分区保持一致（降级平面图用） */
export const WORKSHOP_REGIONS: Record<string, [number, number]> = {
  "公用工程车间": [80, 80],
  "动力一车间": [80, 430],
  "烧结车间": [360, 80],
  "连铸车间": [360, 430],
  "重型热轧车间": [360, 740],
  "冷轧精整车间": [650, 80],
  "机加工车间": [650, 430],
  "智能装配车间": [650, 740],
  "成品包装线": [860, 430],
};

/** 新建设备的确定性坐标标定：车间区域基准 + 设备编码散点（与迁移 018 的 SQL 逻辑等价） */
export function computeEquipmentCoords(workshop: string | null, code: string): { mapX: number; mapY: number } {
  const region = WORKSHOP_REGIONS[workshop || ""] || [500, 260]; // 未知车间落画布中部"未标定"临时区
  const hash = [...code].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const regionW = workshop && WORKSHOP_REGIONS[workshop] ? 160 : 160;
  const regionH = workshop && WORKSHOP_REGIONS[workshop] ? 160 : 160;
  return {
    mapX: Math.min(990, region[0] + 20 + (hash % (regionW - 40))),
    mapY: Math.min(990, region[1] + 20 + ((hash >> 3) % (regionH - 40))),
  };
}

/** 欧氏距离（厂区平面坐标，兼容兜底用） */
export function euclideanDistance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

/** Haversine 球面距离（米）：两点真实经纬度间的实际地面距离 */
export function haversineDistance(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number
): number {
  const R = 6371000; // 地球平均半径（米）
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** 真实米制距离文案：<1km 用"约 X 米"，≥1km 用"X.X 公里" */
export function distanceLabel(distance: number): string {
  if (distance >= 1000) return `约 ${(distance / 1000).toFixed(1)} 公里`;
  return `约 ${Math.max(1, Math.round(distance))} 米`;
}

/** 故障类型/方案工种 → 技能关键词的轻量映射（skills 标签与故障描述互相包含即算命中） */
const SKILL_KEYWORD_MAP: Record<string, string[]> = {
  "泵类检修": ["泵", "水泵", "给水", "循环水", "离心"],
  "轴承更换": ["轴承", "轴瓦", "保持架", "干摩擦"],
  "机械密封更换": ["密封", "渗漏", "泄漏"],
  "润滑保养": ["润滑", "注脂", "油质"],
  "对中校准": ["对中", "联轴器", "失衡", "振动"],
  "电气故障": ["电气", "电机", "绕组", "变频", "高压", "配电", "电流"],
  "电机检修": ["电机", "马达", "绕组", "转子"],
  "变频器调试": ["变频", "驱动", "调速"],
  "高压测试": ["高压", "10kv", "绝缘", "耐压"],
  "PLC 排查": ["plc", "联锁", "控制回路", "信号"],
  "振动监测": ["振动", "频谱", "rms"],
  "设备点检": ["点检", "巡检", "异常点位"],
  "隐患排查": ["隐患", "风险", "安全"],
  "状态监测": ["状态监测", "健康分", "劣化"],
  "温度测振": ["温度", "测温", "测振", "温升"],
  "巡检管理": ["巡检", "点检长"],
};

/** 从工单故障类型 + 设备类别 + 关联检修方案/AI 协同报告文本中提取需求关键词 */
function extractRequiredKeywords(faultType: string, equipmentCategory: string, extraText?: string): string[] {
  const raw = `${faultType || ""} ${equipmentCategory || ""} ${extraText || ""}`.toLowerCase();
  const keywords = new Set<string>();
  for (const [skill, keys] of Object.entries(SKILL_KEYWORD_MAP)) {
    for (const k of keys) {
      if (raw.includes(k.toLowerCase())) {
        keywords.add(skill);
        break;
      }
    }
  }
  return [...keywords];
}

/** 技能匹配度 0~1：需求关键词与师傅 skills 的交集占比 */
export function skillMatchScore(requiredKeywords: string[], skills: string[]): number {
  if (requiredKeywords.length === 0) return 0.5; // 无明确技能需求时给中性分
  const hit = requiredKeywords.filter((k) =>
    skills.some((s) => s === k || s.includes(k) || k.includes(s))
  ).length;
  return hit / requiredKeywords.length;
}

export interface DispatchRecommendation {
  technician: {
    id: string;
    name: string;
    roleTitle: string;
    skills: string[];
    mapX: number;
    mapY: number;
    geoLng: number | null;
    geoLat: number | null;
    status: string;
    lastLocationAt: string | null;
  };
  distance: number;
  distanceLabel: string;
  status: string;
  skillMatch: number;
  score: number;
  reason: string;
}

/**
 * 计算设备与师傅间的距离（米）：
 * 优先真实经纬度 Haversine 球面距离；任一方缺经纬度时回退平面坐标估算（兼容旧数据）。
 */
function computeDistanceInMeters(
  eq: { geoLng?: number | null; geoLat?: number | null; mapX?: number | null; mapY?: number | null },
  t: { geoLng?: number | null; geoLat?: number | null; mapX?: number | null; mapY?: number | null }
): number {
  if (
    eq.geoLng != null && eq.geoLat != null &&
    t.geoLng != null && t.geoLat != null
  ) {
    return haversineDistance(eq.geoLng, eq.geoLat, t.geoLng, t.geoLat);
  }
  // 兜底：旧平面坐标估算（100 单位 ≈ 200m）
  const ex = eq.mapX ?? 500;
  const ey = eq.mapY ?? 500;
  const tx = t.mapX ?? 500;
  const ty = t.mapY ?? 500;
  return euclideanDistance(ex, ey, tx, ty) * METERS_PER_UNIT;
}

/**
 * 核心推荐：对指定工单计算所有在岗师傅的加权得分并排序。
 * score = 距离分(40%) + 空闲分(30%) + 技能分(30%)，各自归一化到 0~1。
 */
export async function recommendForWorkOrder(
  workOrderId: string,
  req?: any
): Promise<{ workOrder: any; equipment: any; requiredKeywords: string[]; recommendations: DispatchRecommendation[] }> {
  const workOrder = await WorkOrderRepository.getById(workOrderId);
  if (!workOrder) throw new Error("工单不存在");
  if (!workOrder.equipmentId) throw new Error("工单未关联设备，无法计算距离");

  const equipment = await DispatchRepository.getEquipmentLocation(workOrder.equipmentId);
  if (!equipment) throw new Error("设备不存在");
  const hasGeo = equipment.geoLng != null && equipment.geoLat != null;
  if (!hasGeo && (equipment.mapX == null || equipment.mapY == null)) {
    throw new Error("该设备尚未标定坐标，无法就近推荐");
  }

  const technicians = await DispatchRepository.listDutyTechnicians();
  const requiredKeywords = extractRequiredKeywords(
    workOrder.faultType,
    equipment.category,
    workOrder.description
  );

  const recommendations: DispatchRecommendation[] = technicians
    .filter((t: any) => (t.geoLng != null && t.geoLat != null) || (t.mapX != null && t.mapY != null))
    .map((t: any) => {
      const distance = computeDistanceInMeters(equipment, t);
      // 距离分：0 距离=1 分，最大参考 1200 米（覆盖全厂区对角线）线性衰减
      const distanceScore = Math.max(0, 1 - distance / 1200);
      // 空闲分：idle（交接班空闲）1.0 > online（在岗巡检中）0.6
      const statusScore = t.onlineStatus === "idle" ? 1 : 0.6;
      const skill = skillMatchScore(requiredKeywords, t.skills || []);
      const score = Number((distanceScore * 0.4 + statusScore * 0.3 + skill * 0.3).toFixed(4));

      const reasons: string[] = [];
      if (distance < 120) reasons.push("距离最近");
      else if (distance < 400) reasons.push("距离较近");
      if (t.onlineStatus === "idle") reasons.push("当前空闲");
      const hitSkills = (t.skills || []).filter((s: string) => requiredKeywords.some((k) => s.includes(k) || k.includes(s)));
      if (hitSkills.length) reasons.push(`具备${hitSkills.slice(0, 2).join("、")}技能`);

      return {
        technician: {
          id: t.id,
          name: t.name,
          roleTitle: t.roleTitle,
          skills: t.skills || [],
          mapX: t.mapX,
          mapY: t.mapY,
          geoLng: t.geoLng ?? null,
          geoLat: t.geoLat ?? null,
          status: t.onlineStatus,
          lastLocationAt: t.lastLocationAt,
        },
        distance: Number(distance.toFixed(1)),
        distanceLabel: distanceLabel(distance),
        status: t.onlineStatus,
        skillMatch: Number(skill.toFixed(2)),
        score,
        reason: reasons.length ? `${reasons.slice(0, 3).join("，")}` : "综合距离与在岗状态推荐",
      };
    })
    .sort((a, b) => b.score - a.score);

  return { workOrder, equipment, requiredKeywords, recommendations };
}

/** 派单确认：复用 work_orders 现有派单字段与状态机（created → dispatched） */
export async function assignWorkOrder(params: {
  workOrderId: string;
  userId: string;
  dispatcherName: string;
  req?: any;
}): Promise<{ workOrder: any; technician: any }> {
  const workOrder = await WorkOrderRepository.getById(params.workOrderId);
  if (!workOrder) throw new Error("工单不存在");
  if (!["created"].includes(workOrder.status)) {
    throw new Error(`工单当前状态为「${workOrder.status}」，仅待派单（created）状态可就近派单`);
  }
  const technician = await DispatchRepository.getUserById(params.userId);
  if (!technician) throw new Error("目标师傅不存在");
  if (!["technician", "inspector"].includes(technician.role)) {
    throw new Error("只能派单给检修技师（technician）或点检员（inspector）");
  }

  const now = new Date();
  const dispatchedAt = now.toISOString();
  await WorkOrderRepository.update(workOrder.id, {
    status: "dispatched",
    dispatcher: params.dispatcherName,
    assignee: technician.name,
    assigneeId: technician.id,
    dispatchedAt,
    version: (workOrder as any).version,
  } as any);

  const updated = await WorkOrderRepository.getById(params.workOrderId);
  addAuditLog(params.req, {
    actionType: "WORK_ORDER_DISPATCH",
    module: "调度大屏",
    detail: `就近派单：工单 ${workOrder.orderNo} 派给 ${technician.name}（${technician.roleTitle}）`,
    status: "SUCCESS",
    metadata: { workOrderId: workOrder.id, assigneeId: technician.id, assignee: technician.name },
  });

  return { workOrder: updated || workOrder, technician };
}
