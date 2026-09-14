import path from "path";
import dotenv from "dotenv";

// 必须在读取环境变量之前加载 .env（与原 server.ts 顶层 dotenv.config() 行为一致）
dotenv.config();

// Secrets & Environment Variables strictly read from process.env (No hardcoding)
// 生产级要求：JWT_SECRET 必须显式配置，缺失时拒绝启动（fail-fast），禁止使用弱默认密钥。
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error(
    "[配置错误] 环境变量 JWT_SECRET 未配置，拒绝启动。请复制 .env.example 为 .env 并设置强随机密钥（可执行 openssl rand -hex 32 生成）。"
  );
}
export { JWT_SECRET };

// ==================== Agnes AI 视频生成配置 ====================
export const AGNES_BASE_URL = process.env.AGNES_BASE_URL || "https://apihub.agnes-ai.cn/v1";
export const AGNES_API_KEY = process.env.AGNES_API_KEY;
// AI 视频生成为外部付费能力，默认关闭；演示/生产按需开启
export const AGNES_ENABLED = process.env.AGNES_ENABLED === "true";
export function isAgnesEnabled(): boolean { return process.env.AGNES_ENABLED === "true"; }
// 并发上限（同时在途的最大视频生成任务数）
export const AGNES_MAX_CONCURRENT = Math.max(1, parseInt(process.env.AGNES_MAX_CONCURRENT || "2", 10) || 2);
export function getAgnesMaxConcurrent(): number { return Math.max(1, parseInt(process.env.AGNES_MAX_CONCURRENT || "2", 10) || 2); }
// 全局超时（分钟），超时则终止任务
export const AGNES_TOTAL_TIMEOUT_MIN = Math.max(10, parseInt(process.env.AGNES_TOTAL_TIMEOUT_MIN || "60", 10) || 60);
export function getAgnesTotalTimeoutMin(): number { return Math.max(10, parseInt(process.env.AGNES_TOTAL_TIMEOUT_MIN || "60", 10) || 60); }
// 下载域名单词白名单（逗号分隔），为空则仅做协议+内网校验
export const AGNES_DOWNLOAD_HOST_WHITELIST = (process.env.AGNES_DOWNLOAD_HOST_WHITELIST || "").split(",").map((s) => s.trim()).filter(Boolean);
export function getAgnesDownloadHostWhitelist(): string[] { return (process.env.AGNES_DOWNLOAD_HOST_WHITELIST || "").split(",").map((s) => s.trim()).filter(Boolean); }

// ==================== 魔珐星云数字人服务配置 (环境变量注入，缺失时优雅降级) ====================
export const XINGYUN_APP_ID = process.env.XINGYUN_APP_ID || "";
export const XINGYUN_APP_SECRET = process.env.XINGYUN_APP_SECRET || "";
export const XINGYUN_BASE_URL = process.env.XINGYUN_BASE_URL || "https://api.xingyun.mofa.ai";

// ==================== 微信小程序服务配置 (环境变量注入，严禁暴露前端) ====================
export const WECHAT_APP_ID = process.env.WECHAT_APP_ID || "";
export const WECHAT_APP_SECRET = process.env.WECHAT_APP_SECRET || "";

// ==================== AI 预算控制 ====================
export function isAiBudgetEnabled(): boolean { return process.env.AI_BUDGET_ENABLED === "true"; }
export function getAiDailyBudget(): number { return Math.max(1, parseInt(process.env.AI_DAILY_BUDGET || "100000", 10) || 100000); }

// ==================== 阿里云百炼 (DashScope) 大模型客户端 (OpenAI 兼容模式) ====================
export const DASHSCOPE_CHAT_MODEL = process.env.DASHSCOPE_MODEL || "qwen-plus";
export const DASHSCOPE_VISION_MODEL = process.env.DASHSCOPE_VISION_MODEL || "qwen-vl-max";

export const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");
export const VIDEOS_DIR = path.join(UPLOADS_DIR, "videos");
