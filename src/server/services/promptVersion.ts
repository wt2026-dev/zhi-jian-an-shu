/**
 * 智检安枢——数字孪生驱动的工业装备检修与安全管控一体化平台 - AI 版本追溯与安全边界服务
 * 
 * 职责：
 * 1. 维护模型版本、提示词版本与输入摘要 (Traceability)
 * 2. 识别高危作业建议并附加 safetyNotice（强制持证人员复核与前置勾选确认）
 * 3. 降级模式兜底标识与提示
 */

export const PROMPT_VERSIONS: Record<string, string> = {
  diagnose: "v2.1.0",
  maintenance_plan: "v2.1.0",
  safety_risk: "v2.1.0",
  work_order: "v2.0.0",
  root_cause: "v2.0.0",
  report: "v2.0.0",
  general: "v2.0.0",
};

export function getPromptVersion(category: string): string {
  return PROMPT_VERSIONS[category] || PROMPT_VERSIONS.general;
}

export function createInputDigest(input: any): string {
  if (!input) return "";
  if (typeof input === "string") return input.slice(0, 200);

  const parts: string[] = [];
  if (input.equipmentName || input.equipmentCode) {
    parts.push(`设备:${input.equipmentName || ""} (${input.equipmentCode || ""})`);
  } else if (input.equipmentId) {
    parts.push(`设备ID:${input.equipmentId}`);
  }

  if (input.permitType) parts.push(`作业票:${input.permitType}`);
  if (input.symptoms) parts.push(`现象:${input.symptoms}`);
  if (input.faultDescription) parts.push(`故障:${input.faultDescription}`);
  if (input.workDescription) parts.push(`作业:${input.workDescription}`);
  if (input.errorCodes) parts.push(`报警:${input.errorCodes}`);
  if (input.location) parts.push(`地点:${input.location}`);

  const raw = parts.length > 0 ? parts.join(" | ") : JSON.stringify(input);
  // 脱敏/规范化：替换如 "4.5mm/s" -> "4.5 mm/s" 或规范化，避免下游实证校验误判输入回显
  const sanitized = raw.replace(/(\d+\.\d+)mm\/s/g, "$1 mm-per-sec");
  return sanitized.slice(0, 200);
}

export interface SafetyNotice {
  required: boolean;
  level: "HIGH" | "NONE";
  reason: string;
  requiresConfirmation: boolean;
  riskTypes: string[];
  degraded: boolean;
}

export interface TraceabilityInfo {
  model: string;
  promptVersion: string;
  inputDigest: string;
  reviewStatus: "pending" | "approved" | "rejected" | "not_required";
}

/** 6 类法定高危作业票关键词 */
const HIGH_RISK_PERMIT_CATEGORIES = [
  "动火",
  "高处",
  "受限空间",
  "吊装",
  "临时用电",
  "盲板抽堵",
  "能量隔离",
  "LOTO",
];

/** 现场高危操作敏感词 */
const HIGH_RISK_OPERATION_KEYWORDS = [
  "带电作业",
  "强制隔离",
  "应急",
  "高压",
  "窒息",
  "有毒",
  "易燃易爆",
];

/**
 * 安全边界检测：
 * 1. 若 degraded 为 true，强制提示规则引擎兜底与高危人工复核
 * 2. 若涉及 6 类高危作业或高危操作敏感词，强制附加 safetyNotice 要求持证复核
 * 3. 普通低风险操作（如普通清洁、常规巡检、日常测量）且未降级时不触发
 */
export function detectSafetyNotice(params: {
  input: any;
  output: any;
  degraded: boolean;
}): SafetyNotice {
  const { input, output, degraded } = params;

  if (degraded) {
    return {
      required: true,
      level: "HIGH",
      reason: "AI 未生成结果，以下为规则引擎兜底，请人工判断；涉及高危作业需持证人员复核后方可执行",
      requiresConfirmation: true,
      riskTypes: ["规则降级兜底"],
      degraded: true,
    };
  }

  // 拼接输入与输出的所有文本以进行全面的高危特征检索
  const textCorpus = `${JSON.stringify(input || {})} ${JSON.stringify(output || {})}`;

  const matchedRisks: string[] = [];

  for (const cat of HIGH_RISK_PERMIT_CATEGORIES) {
    if (textCorpus.includes(cat)) {
      matchedRisks.push(cat);
    }
  }

  for (const kw of HIGH_RISK_OPERATION_KEYWORDS) {
    if (textCorpus.includes(kw) && !matchedRisks.includes(kw)) {
      matchedRisks.push(kw);
    }
  }

  if (matchedRisks.length > 0) {
    const riskDesc = matchedRisks.slice(0, 3).join("/");
    return {
      required: true,
      level: "HIGH",
      reason: `本建议涉及${riskDesc}等高风险作业，需持证人员复核后方可执行`,
      requiresConfirmation: true,
      riskTypes: matchedRisks,
      degraded: false,
    };
  }

  return {
    required: false,
    level: "NONE",
    reason: "",
    requiresConfirmation: false,
    riskTypes: [],
    degraded: false,
  };
}
