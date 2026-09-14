/**
 * 全局演示模式 (Demo Mode) 判定工具
 *
 * 规范：参赛演示功能必须"默认关闭 + 显式标识 + 环境隔离"。
 * 判断来源（任一满足即开启）：
 *   1. 浏览器 URL 参数：?demo=1 或 ?demo=true
 *   2. 前端构建/运行时环境变量：VITE_DEMO_MODE=true
 *
 * 默认返回 false。
 */
export function isDemoMode(): boolean {
  try {
    if (typeof window !== 'undefined' && window.location?.search) {
      const params = new URLSearchParams(window.location.search);
      const demo = params.get('demo')?.toLowerCase();
      if (demo === '1' || demo === 'true') {
        return true;
      }
    }
  } catch {}

  try {
    if (import.meta.env?.VITE_DEMO_MODE === 'true' || import.meta.env?.VITE_DEMO_MODE === '1') {
      return true;
    }
  } catch {}

  return false;
}
