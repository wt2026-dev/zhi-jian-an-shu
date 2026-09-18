/**
 * AI 诊断相关的类型与归一化工具。
 *
 * 单独成文件（而不是留在 DeviceAnalysisPanel.tsx 里）有两个原因：
 * 1. 这里不依赖 three.js / React，可以被 node 环境的单测直接导入，成本极低；
 * 2. 该模块承载一个真实踩过的坑 —— 见 normalizeSafetyNotice 的注释。
 */

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
