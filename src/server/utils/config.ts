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

// ==================== 魔珐星云数字人服务配置 (环境变量注入，缺失时优雅降级) ====================
export const XINGYUN_APP_ID = process.env.XINGYUN_APP_ID || "";
export const XINGYUN_APP_SECRET = process.env.XINGYUN_APP_SECRET || "";
export const XINGYUN_BASE_URL = process.env.XINGYUN_BASE_URL || "https://api.xingyun.mofa.ai";

// ==================== 微信小程序服务配置 (环境变量注入，严禁暴露前端) ====================
export const WECHAT_APP_ID = process.env.WECHAT_APP_ID || "";
export const WECHAT_APP_SECRET = process.env.WECHAT_APP_SECRET || "";

// ==================== 阿里云百炼 (DashScope) 大模型客户端 (OpenAI 兼容模式) ====================
export const DASHSCOPE_CHAT_MODEL = process.env.DASHSCOPE_MODEL || "qwen-plus";
export const DASHSCOPE_VISION_MODEL = process.env.DASHSCOPE_VISION_MODEL || "qwen-vl-max";

export const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");
export const VIDEOS_DIR = path.join(UPLOADS_DIR, "videos");
