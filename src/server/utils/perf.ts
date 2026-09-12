import { logger } from "../../utils/logger.ts";

// ==================== 性能指标注册表（P2-8 监控，原 createApp 闭包逻辑模块化） ====================

export const perfRegistry: {
  requests: { path: string; method: string; status: number; ms: number; at: number }[];
  alerts: { at: number; message: string }[];
  lastAlertAt: number;
} = { requests: [], alerts: [], lastAlertAt: 0 };

export function recordPerf(path: string, method: string, status: number, ms: number) {
  perfRegistry.requests.push({ path: path, method: method, status: status, ms: ms, at: Date.now() });
  const cutoff = Date.now() - 10 * 60 * 1000;
  while (perfRegistry.requests.length > 0 && perfRegistry.requests[0].at < cutoff) perfRegistry.requests.shift();
  if (perfRegistry.requests.length >= 20 && Date.now() - perfRegistry.lastAlertAt > 10 * 60 * 1000) {
    const recent = perfRegistry.requests;
    const errors = recent.filter((r) => r.status >= 500).length;
    const errRate = errors / recent.length;
    const avgMs = recent.reduce((s, r) => s + r.ms, 0) / recent.length;
    let alertMsg = "";
    if (errRate > 0.05) alertMsg = `错误率 ${(errRate * 100).toFixed(1)}% 超过 5% 阈值（近 ${recent.length} 个请求，${errors} 个错误）`;
    else if (avgMs > 2000) alertMsg = `平均响应时间 ${(avgMs / 1000).toFixed(2)}s 超过 2s 阈值`;
    if (alertMsg) {
      perfRegistry.lastAlertAt = Date.now();
      perfRegistry.alerts.push({ at: Date.now(), message: alertMsg });
      logger.warn("[ALERT] " + alertMsg);
      const hook = process.env.ALERT_WEBHOOK_URL;
      if (hook) {
        fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "[工业检修系统告警] " + alertMsg }) }).catch(() => {});
      }
    }
  }
}
