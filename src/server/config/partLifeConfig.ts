/**
 * 零件寿命预警的阈值配置（单一配置口径，可运行时经环境变量调整）。
 *
 * 配置来源与可调性：
 *   · 预期寿命规则（按零件名关键词 → 寿命小时）支持 `PART_LIFE_RULES_JSON` 整体覆盖，
 *     未配置时用内置默认规则（行业常用检修周期口径，属"维护策略配置"，非测量数据）；
 *   · 临近寿命判定线 `PART_LIFE_WARN_FRACTION`（剩余比例 ≤ 该值 → 临近寿命，默认 0.2）；
 *   · 运行系数 `PART_LIFE_RUNTIME_FACTOR`：数据库没有设备运行小时计（已核实 equipments 表
 *     与 equipment_telemetry 全部无运行小时字段），"已用小时"只能用**日历时钟小时 × 运行
 *     系数**折算（默认 1.0 = 连续运行口径），系数可调，且服务端会在 dataNote 里如实披露。
 */
export interface PartLifeRule {
  /** 零件名称（真实 BOM 原词）命中任一关键词即套用该条规则（先命中先赢） */
  keywords: string[];
  /** 预期使用寿命（运行小时） */
  expectedLifeHours: number;
  /** 规则名（前端展示阈值出处用） */
  label: string;
}

/** 内置默认寿命规则：按行业常用检修/更换周期给出，可在环境变量里整体替换 */
export const DEFAULT_LIFE_RULES: PartLifeRule[] = [
  { keywords: ['机械密封', '密封集装件'], expectedLifeHours: 8760, label: '机械密封常规检修周期' },
  { keywords: ['密封环', '密封件', '密封圈', 'O 型圈', '盘根'], expectedLifeHours: 8760, label: '密封件常规更换周期' },
  { keywords: ['耐磨环'], expectedLifeHours: 25000, label: '耐磨环常规检修周期' },
  { keywords: ['轴瓦', '剖分瓦', '推力瓦'], expectedLifeHours: 30000, label: '滑动轴承瓦常规检修周期' },
  { keywords: ['轴承'], expectedLifeHours: 20000, label: '滚动轴承厂家寿命口径' },
  { keywords: ['滤芯', '过滤器', '空滤'], expectedLifeHours: 4000, label: '滤芯常规更换周期' },
  { keywords: ['润滑油', '润滑脂', '油品'], expectedLifeHours: 4000, label: '换油常规周期' },
  { keywords: ['叶轮'], expectedLifeHours: 60000, label: '叶轮主检修周期' },
  { keywords: ['同步带', '皮带'], expectedLifeHours: 8000, label: '传动带常规更换周期' },
  { keywords: ['联轴器'], expectedLifeHours: 40000, label: '联轴器常规检修周期' },
  { keywords: ['行星轮', '齿轮'], expectedLifeHours: 50000, label: '齿轮副常规检修周期' },
  { keywords: ['减速器', '减速机'], expectedLifeHours: 30000, label: '减速机常规检修周期' },
  { keywords: ['定子', '转子', '绕组', '电机'], expectedLifeHours: 60000, label: '电机主检修周期' },
];

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** 寿命规则：默认内置，可用 PART_LIFE_RULES_JSON 整体覆盖（JSON 数组，同 PartLifeRule 形状） */
export function getPartLifeRules(): PartLifeRule[] {
  const raw = process.env.PART_LIFE_RULES_JSON;
  if (!raw) return DEFAULT_LIFE_RULES;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_LIFE_RULES;
    const rules = parsed
      .map((r: unknown) => {
        const o = r as Partial<PartLifeRule>;
        if (!Array.isArray(o.keywords) || !o.keywords.every((k) => typeof k === 'string' && k)) return null;
        if (!isFinitePositive(o.expectedLifeHours)) return null;
        const normalized: PartLifeRule = {
          keywords: o.keywords as string[],
          expectedLifeHours: o.expectedLifeHours!,
          label: typeof o.label === 'string' && o.label ? o.label : '自定义寿命规则',
        };
        return normalized;
      })
      .filter((r): r is PartLifeRule => r !== null);
    return rules.length ? rules : DEFAULT_LIFE_RULES;
  } catch {
    // 配置写错时回落到内置默认，而不是让整个诊断接口 500（配置错误不应打翻寿命预警）
    return DEFAULT_LIFE_RULES;
  }
}

/** 临近寿命判定线：剩余寿命比例 ≤ 该值 → 临近寿命（默认 20%） */
export function getPartLifeWarnFraction(): number {
  const v = parseFloat(process.env.PART_LIFE_WARN_FRACTION || '');
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.2;
}

/** 运行系数：已用小时 = 日历时钟小时 × 该系数（默认 1.0 = 连续运行口径，如实折算） */
export function getPartLifeRuntimeFactor(): number {
  const v = parseFloat(process.env.PART_LIFE_RUNTIME_FACTOR || '');
  return Number.isFinite(v) && v > 0 && v <= 24 ? v : 1.0;
}

/** 保养排程提前量（天）：建议保养时间 = 最早零件到期日 − 该提前量（默认 14 天） */
export function getPartLifeSchedulingHeadroomDays(): number {
  const v = parseFloat(process.env.PART_LIFE_SCHEDULING_HEADROOM_DAYS || '');
  return Number.isFinite(v) && v >= 0 ? Math.round(v) : 14;
}
