/**
 * LOTO 隔离咨询域（自 businessLoopService.ts 机械切出，纯移动不改行为）。
 *
 * 内聚在此：环节 3 的 LOTO 隔离建议推演（buildLotoAdvisory：JSA 隔离点 →
 * 类别能量源清单兜底 + 库内真实锁具匹配，绝不编造锁号）、类别 → 通用能量源
 * 规则表（ENERGY_SOURCE_RULES）、LOTO 类型判定与隔离要求文案（classifyLotoType /
 * lotoRequirement）。依据口径：GB/T 33579-2017、GB 30871。
 */
import type { Equipment } from "../../types/index.ts";
import { LotoLockRepository } from "../../db/repositories/index.ts";

/** 去掉空白与中英文标点的规范化（供类型判定/别名匹配共用，自主文件随域迁入） */
export function compact(s: string): string {
  return String(s || "").replace(/[\s,，。·()（）\-_\/]/g, "");
}

/** 环节 3 核心：LOTO 隔离建议（safety-interlock 规则推演：JSA 隔离点 → 类别能量源兜底 + 库内真实锁具匹配） */
export async function buildLotoAdvisory(eq: Equipment | null, jsaAssessment: any, loopId: string) {
  const jsaPoints: string[] = Array.from(new Set((jsaAssessment?.lotoAdvice?.isolationPoints || []).map((s: any) => String(s))));
  // JSA（环节 2 的 AI 能力）未输出隔离点时，退到设备类别的通用能量源清单：
  // 只到「能量源 + 部位」粒度，不虚构点位编号与锁号，逐项人工确认的闸门一分不放。
  const ruleFallback = jsaPoints.length === 0;
  const seedItems = ruleFallback
    ? energySourceItemsFor(eq)
    : jsaPoints.map((point) => ({ type: classifyLotoType(point), point }));

  // 库内真实锁具按设备匹配（台账无 equipment_id 字段，按 pointName/energySource 归属判断）
  const locks = await LotoLockRepository.getAll();
  const eqLocks = eq
    ? locks.filter((l: any) => String(l.pointName || l.energySource || "").includes(eq.name || "\u0000"))
    : [];

  const lotoItems = seedItems.map((item: any, idx: number) => {
    // 锁具编号只取台账真实锁；未匹配到就留空，由现场登记（不编造锁号）
    const matchedLock = eqLocks.find((l: any) => classifyLotoType(l.pointName || l.energySource || "") === item.type);
    return {
      id: `loto-${loopId}-${idx + 1}`,
      type: item.type,
      point: item.point,
      requirement: lotoRequirement(item.type, item.point),
      lockNumber: matchedLock?.lockNo || "",
      basis: ruleFallback ? "类别规则兜底" : "JSA 评估输出",
      confirmed: false,
      operator: "待现场确认",
    };
  });

  const basisNote = ruleFallback
    ? (lotoItems.length
      ? `JSA 未输出隔离点，以下按设备类别「${eq?.category || "通用机组"}」的通用能量源清单推演（GB/T 33579），点位编号与锁号需现场核对后登记。`
      : "未识别到台账设备，无法按类别推演能量源；请依据 GB/T 33579 结合现场实际手动补充隔离点后再确认。")
    : "隔离点由 JSA 评估结果推演；锁具编号匹配设备台账真实锁具，未匹配项由现场登记后确认。";

  return {
    isolationPoints: lotoItems.map((i: any) => i.point),
    basis: ruleFallback ? "category-rule" : "jsa",
    lockRequired: jsaAssessment?.lotoAdvice?.required !== false,
    lockCount: jsaAssessment?.lotoAdvice?.lockCount || lotoItems.length,
    existingLocks: eqLocks.map((l: any) => ({ lockNo: l.lockNo, status: l.status, pointName: l.pointName })),
    lotoItems,
    standards: ["GB/T 33579-2017 机械安全 危险能量控制方法 锁定/挂牌", "GB 30871 危险化学品企业特殊作业安全规范"],
    note: basisNote,
  };
}

/** 类别 → 通用能量源清单（只在 JSA 降级时兜底；类型直接给定，避免关键字猜测） */
const ENERGY_SOURCE_RULES: Array<{ match: RegExp; items: Array<{ type: string; point: string }> }> = [
  {
    match: /压缩机/,
    items: [
      { type: "电气隔离", point: "主电源进线断路器与控制系统回路" },
      { type: "气源隔离", point: "排气总管与储气罐入口截止阀（压缩空气）" },
      { type: "残余能量", point: "停机后通气管路与油气分离腔泄放残压" },
      { type: "机械隔离", point: "联轴器与皮带传动部件" },
    ],
  },
  {
    match: /泵/,
    items: [
      { type: "电气隔离", point: "主电源进线断路器与控制系统回路" },
      { type: "液压隔离", point: "进口与出口隔离阀及管路介质" },
      { type: "残余能量", point: "泵腔与蓄能器泄放残压" },
      { type: "机械隔离", point: "联轴器与叶轮转动部件" },
    ],
  },
  {
    match: /齿轮|减速/,
    items: [
      { type: "电气隔离", point: "主电源进线断路器与控制系统回路" },
      { type: "液压隔离", point: "稀油站油泵与润滑管路" },
      { type: "机械隔离", point: "输入轴/输出轴联轴器与制动轮" },
      { type: "残余能量", point: "轴系残余应力与活动部件自重势能" },
    ],
  },
  {
    match: /电机/,
    items: [
      { type: "电气隔离", point: "主回路断路器与励磁、控制回路" },
      { type: "液压隔离", point: "冷却介质管路隔离阀与压力" },
      { type: "机械隔离", point: "联轴器与转子转动部件" },
    ],
  },
  {
    match: /机器人|机械臂/,
    items: [
      { type: "电气隔离", point: "控制柜主电源与伺服驱动器供电" },
      { type: "气源隔离", point: "气动夹爪与末端执行器气路截止阀" },
      { type: "残余能量", point: "各关节抱闸与弹簧残余力矩" },
      { type: "机械隔离", point: "机械臂各轴活动部件定位销与防坠支撑" },
    ],
  },
  {
    match: /换热|冷凝|加热器/,
    items: [
      { type: "电气隔离", point: "循环泵与风机主电源回路" },
      { type: "液压隔离", point: "一次侧与二次侧进出口隔离阀" },
      { type: "残余能量", point: "腔体余温与残余压力泄放（双表核读）" },
    ],
  },
  {
    match: /机床|数控/,
    items: [
      { type: "电气隔离", point: "总电源进线与伺服驱动回路" },
      { type: "气源隔离", point: "气动卡盘与换刀装置气路截止阀" },
      { type: "液压隔离", point: "液压站与管路残余压力" },
      { type: "机械隔离", point: "主轴与刀库传动部件" },
    ],
  },
];

const GENERIC_ENERGY_ITEMS = [
  { type: "电气隔离", point: "设备主电源进线断路器与控制回路" },
  { type: "机械隔离", point: "动力传动与活动部件" },
  { type: "残余能量", point: "停机后残余压力/张力泄放" },
];

export function energySourceItemsFor(eq: Equipment | null): Array<{ type: string; point: string }> {
  if (!eq) return [];
  const key = `${eq.category || ""}${eq.name || ""}`;
  const rule = ENERGY_SOURCE_RULES.find((r) => r.match.test(key));
  return rule ? rule.items : GENERIC_ENERGY_ITEMS;
}

export function classifyLotoType(point: string): string {
  const p = compact(point);
  if (/电|断路器|电源|开关|验电/.test(p)) return "电气隔离";
  if (/气|阀|压缩空气|气压/.test(p)) return "气源隔离";
  if (/压|泄|残余|蓄能/.test(p)) return "残余能量";
  if (/皮|带|旋转|联轴|机械|传动/.test(p)) return "机械隔离";
  return "其他隔离";
}

export function lotoRequirement(type: string, point: string): string {
  switch (type) {
    case "电气隔离":
      return "分闸断电，使用验电器三相验电确认无电压，挂「禁止合闸·有人工作」警示牌并上锁保管钥匙";
    case "气源隔离":
      return "沿时钟方向关闭隔离阀至全关位，加装锁闭夹具并挂牌，登记锁具编号，严禁擅自开阀";
    case "液压隔离":
      return "关闭进口与出口隔离阀至全关位并加装盲板/水封，挂牌上锁，登记锁具编号，严禁擅自开阀";
    case "残余能量":
      return "缓慢开启泄放阀至压力表归零（双表核读），现场拍照存证后挂牌";
    case "机械隔离":
      return "去除动力源并固定活动部件，插入定位销/皮带防护护罩摘除，挂牌上锁";
    default:
      return `按 GB/T 33579 对「${point}」实施能量隔离：上锁 → 挂牌 → 验证零能量 → 双人复核登记`;
  }
}
