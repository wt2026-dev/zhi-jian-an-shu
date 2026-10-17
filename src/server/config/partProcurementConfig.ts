/**
 * 备件采购前置期配置（procurement lead time）。
 *
 * 数据诚实性口径：spare_parts 表（已核 migrations/009）只有 stock / safe_stock /
 * location / price 等台账列，**没有采购前置期字段** —— 不编造 DB 数据，改用
 * 「按备件分类配置的前置期天数」给出参考值（行业常规采购周期，属采购策略配置，
 * 非测量数据），全部可经环境变量调整，并在面板 dataNote 里如实标注出处。
 */

export interface PurchaseLeadRule {
  /** 备件名称命中任一关键词即套用（先命中先赢；spec/model 兜底匹配） */
  keywords: string[];
  /** 采购前置期（天） */
  leadDays: number;
  /** 规则名（前端展示出处用） */
  label: string;
}

/** 内置默认前置期规则：行业常规采购周期口径 */
export const DEFAULT_PURCHASE_LEAD_RULES: PurchaseLeadRule[] = [
  { keywords: ['轴承'], leadDays: 14, label: '轴承类常规采购周期' },
  { keywords: ['密封'], leadDays: 7, label: '密封件类常规采购周期' },
  { keywords: ['滤芯', '过滤'], leadDays: 5, label: '滤芯类常规采购周期' },
  { keywords: ['电机', '绕组', '定子', '转子'], leadDays: 30, label: '电机类常规采购周期' },
  { keywords: ['润滑', '油品', '油脂'], leadDays: 3, label: '油品类常规采购周期' },
  { keywords: ['阀门', '阀'], leadDays: 21, label: '阀门类常规采购周期' },
];

function isNonNegInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** 前置期规则：默认内置，可用 PART_PROCUREMENT_LEAD_RULES_JSON 整体覆盖 */
export function getPurchaseLeadRules(): PurchaseLeadRule[] {
  const raw = process.env.PART_PROCUREMENT_LEAD_RULES_JSON;
  if (!raw) return DEFAULT_PURCHASE_LEAD_RULES;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_PURCHASE_LEAD_RULES;
    const rules = parsed
      .map((r: unknown) => {
        const o = r as Partial<PurchaseLeadRule>;
        if (!Array.isArray(o.keywords) || !o.keywords.every((k) => typeof k === 'string' && k)) return null;
        if (!isNonNegInt(o.leadDays)) return null;
        const normalized: PurchaseLeadRule = {
          keywords: o.keywords as string[],
          leadDays: o.leadDays!,
          label: typeof o.label === 'string' && o.label ? o.label : '自定义采购周期规则',
        };
        return normalized;
      })
      .filter((r): r is PurchaseLeadRule => r !== null);
    return rules.length ? rules : DEFAULT_PURCHASE_LEAD_RULES;
  } catch {
    // 配置写坏回落默认，不让库存联动接口 500
    return DEFAULT_PURCHASE_LEAD_RULES;
  }
}

/** 未命中分类规则时的兜底前置期（天，默认 10，可调） */
export function getDefaultPurchaseLeadDays(): number {
  const v = parseInt(process.env.PART_PROCUREMENT_DEFAULT_LEAD_DAYS || '', 10);
  return Number.isInteger(v) && v > 0 ? v : 10;
}
