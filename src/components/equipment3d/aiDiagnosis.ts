/**
 * AI 诊断相关的类型与归一化工具。
 *
 * 单独成文件（而不是留在 DeviceAnalysisPanel.tsx 里）有两个原因：
 * 1. 这里不依赖 three.js / React，可以被 node 环境的单测直接导入，成本极低；
 * 2. 该模块承载一个真实踩过的坑 —— 见 normalizeSafetyNotice 的注释。
 */

import { PART_OBSERVATION_ZONES, type PartObservationZone } from './partEvidence';

export interface AiDiagnosis {
  severity: string;
  urgencyScore: number;
  summary: string;
  probableCauses?: Array<{ cause: string; probability?: number; detail?: string }>;
  safetyPrecautions?: string[];
  recommendedActions?: Array<{ action: string; priority?: string }>;
}

/**
 * 服务端 detectSafetyNotice() 的返回结构
 * （见 src/server/services/promptVersion.ts）。
 *
 * 关键：它是**对象**，不是字符串。
 *   { required, level, reason, requiresConfirmation, riskTypes, degraded }
 */
export interface AiSafetyNotice {
  required: boolean;
  level: string;
  reason: string;
  requiresConfirmation: boolean;
  riskTypes: string[];
  degraded: boolean;
}

/**
 * 归一化 POST /api/v1/ai/diagnose 返回的 safetyNotice。
 *
 * 为什么必须归一化：
 * `await res.json()` 的类型是 any，`data.safetyNotice` 因此完全绕过 tsc 检查。
 * 早期 DeviceAnalysisPanel 把 state 声明成 `string | null`，却把接口返回的对象直接
 * `{aiSafety}` 渲染，结果 React 抛
 *   "Objects are not valid as a React child (found: object with keys
 *    {required, level, reason, requiresConfirmation, riskTypes, degraded})"
 * 整棵组件树被应用的错误边界卸载 —— 3D 画布与设备下拉框一起消失，表现得像"页面崩了"。
 * 这个 bug 既过得了 tsc（any 逃逸），也过得了单测（不渲染就没问题），只有端到端跑才会暴露。
 *
 * 所以这里统一收敛为对象，并容错处理将来可能被改成纯字符串的情况；
 * 渲染侧只允许取 reason / riskTypes / degraded 这些标量字段。
 */
export function normalizeSafetyNotice(raw: unknown): AiSafetyNotice | null {
  if (!raw) return null;

  if (typeof raw === 'string') {
    return {
      required: false,
      level: '',
      reason: raw,
      requiresConfirmation: false,
      riskTypes: [],
      degraded: false,
    };
  }

  if (typeof raw === 'object') {
    const o = raw as Partial<AiSafetyNotice>;
    return {
      required: !!o.required,
      level: typeof o.level === 'string' ? o.level : '',
      reason: typeof o.reason === 'string' ? o.reason : '',
      requiresConfirmation: !!o.requiresConfirmation,
      riskTypes: Array.isArray(o.riskTypes) ? o.riskTypes.filter((t): t is string => typeof t === 'string') : [],
      degraded: !!o.degraded,
    };
  }

  // number / boolean 等异常载荷：宁可丢弃，也绝不把非标量塞进渲染树。
  return null;
}

/**
 * 症状关键词表：把 AI 诊断的"可能原因"文本映射到该设备的观测部位。
 *
 * 口径约束：这是**关键词匹配的位置建议，不是部件级确诊**——
 * AI 看到的是设备级遥测，本来就得不出部件结论；这里只是把
 * "首要原因提到电机"翻译成"把 3D 定位标挪到电机部位"。
 * 匹配不到就返回 null，调用方保持原定位，绝不硬猜。
 *
 * 结构：键 = 部位词根（与 partLabel/部位语义对应），
 * 值 = 该词根在原因文本中的同义/关联词。
 */
const CAUSE_ZONE_KEYWORDS: ReadonlyArray<readonly [string, readonly string[]]> = Object.freeze([
  ['电机', ['电机', '马达', '绕组', '定子', '转子', '磁']],
  ['轴承', ['轴承', '游隙', '剥落', '滚道', '保持架']],
  ['联轴器', ['联轴器', '对轮', '对中', '同轴']],
  ['密封', ['密封', '泄漏', '渗漏', '机封', '盘根']],
  ['泵', ['泵', '蜗壳', '叶轮', '汽蚀', '气蚀', '扬程']],
  ['主轴', ['主轴', '刀柄', '刀具']],
  ['关节', ['关节', '机械臂', '臂']],
  ['风机', ['风机', '风罩', '风扇', '冷却风']],
  ['接线', ['接线', '端子', '接触器', '绝缘', '短路', '电气', 'PLC', '控制回路', '信号']],
  ['法兰', ['法兰', '管口']],
  ['冷凝', ['冷凝', '换热', '板片']],
  ['螺杆', ['螺杆', '压缩机主机']],
  ['润滑', ['润滑', '油路', '油质', '油位', '油罐']],
  ['轴', ['轴向', '窜动', '弯曲', '轴']],
  ['齿轮', ['齿轮', '齿面', '减速', '传动']],
]) as ReadonlyArray<readonly [string, readonly string[]]>;

/** 指标词：原因文本提到温升/振动时对相应观测指标的部位加权。 */
const METRIC_HINTS: ReadonlyArray<readonly [PartObservationZone['metric'], readonly string[]]> = Object.freeze([
  ['temp', ['温度', '过热', '温升', '发热', '烫']],
  ['vibration', ['振动', '异响', '抖动', '噪音']],
  ['loadRate', ['负载', '过载', '电流']],
]) as ReadonlyArray<readonly [PartObservationZone['metric'], readonly string[]]>;

/**
 * 从 AI 诊断的可能原因里挑选最匹配的观测部位（用于把 3D 故障定位标挪过去）。
 *
 * 打分：部位词根出现在原因文本 +2；指标词匹配该部位的观测指标 +1；
 * 得分最高的部位且得分 > 0 才返回，否则 null（保持原定位）。
 */
export function matchZoneForCauses(
  deviceId: string,
  causes: ReadonlyArray<{ cause?: string } | string> | undefined,
  summary?: string,
): PartObservationZone | null {
  const zones = PART_OBSERVATION_ZONES[deviceId];
  if (!zones || zones.length === 0) return null;
  const texts: string[] = [];
  for (const c of causes ?? []) {
    const s = typeof c === 'string' ? c : c?.cause;
    if (typeof s === 'string' && s.trim()) texts.push(s);
  }
  if (summary && summary.trim()) texts.push(summary);
  if (!texts.length) return null;
  const haystack = texts.join(' ');

  let best: PartObservationZone | null = null;
  let bestScore = 0;
  for (const zone of zones) {
    let score = 0;
    for (const [root, words] of CAUSE_ZONE_KEYWORDS) {
      // 词根与部位名任一命中即算该词根生效（部位名含"电机"或词根"轴"能对上"输入轴"）
      const rootHit = words.some((w) => haystack.includes(w));
      if (!rootHit) continue;
      if (zone.partLabel.includes(root) || root === '轴' && zone.partLabel.includes('轴')) score += 2;
    }
    for (const [metric, words] of METRIC_HINTS) {
      if (zone.metric === metric && words.some((w) => haystack.includes(w))) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = zone;
    }
  }
  return bestScore > 0 ? best : null;
}
