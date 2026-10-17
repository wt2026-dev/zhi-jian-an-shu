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
//
// 默认 **1（严格串行）**，不是拍脑袋：2026-09-17 实测 3/3 次都是同一规律 ——
// 两条任务同时在跑时，**后提交的那条 4 分钟左右跑完，先提交的那条一直卡到 40 分钟轮询窗口耗尽**。
// 远端查询证实被卡住的那条 `perf_infer_s=0`（推理一秒都没跑），即被新任务挤掉了调度。
// 免费档只保证极少的推理槽位，并发提交等于主动制造"饿死"。
// 注意：调大这个值并不会提高吞吐，只会让先提交的任务更容易超时失败。
export const AGNES_MAX_CONCURRENT = Math.max(1, parseInt(process.env.AGNES_MAX_CONCURRENT || "1", 10) || 1);
export function getAgnesMaxConcurrent(): number { return Math.max(1, parseInt(process.env.AGNES_MAX_CONCURRENT || "1", 10) || 1); }
// 单段轮询窗口（分钟）：慢段可跑满这么久才判超时。
// 单独抽出来是为了让"全局超时"能按段数自洽推导（见 getAgnesTotalTimeoutMin）。
export function getAgnesSegmentWindowMin(): number {
  return Math.max(5, parseInt(process.env.AGNES_SEGMENT_WINDOW_MIN || "40", 10) || 40);
}
// 段间强制等待（秒）：Agnes 生成限频约 1 次/分钟
export function getAgnesSegmentGapSec(): number {
  return Math.max(0, parseInt(process.env.AGNES_SEGMENT_GAP_SEC || "65", 10) || 65);
}
// 全局超时（分钟），超时则终止任务。
//
// **不能只写死一个数**：单段窗口 40 分钟 × N 段 + 段间限频，才是真正的上界。
// 原先固定 240 分钟对 5 段刚好（47 分钟/段），但对 8 段只有 29 分钟/段 —— 比单段窗口还短，
// 于是"单段还没到自己的超时上限，整个任务先撞全局超时"，8 段规程必然失败。
// 现在改为 `max(配置值, 段数 × 单段窗口 + 段间等待)`，两者永远自洽。
export function getAgnesTotalTimeoutMin(segmentCount?: number): number {
  const configured = Math.max(10, parseInt(process.env.AGNES_TOTAL_TIMEOUT_MIN || "240", 10) || 240);
  if (!segmentCount || segmentCount < 1) return configured;
  const needed = Math.ceil(
    (segmentCount * getAgnesSegmentWindowMin() * 60 + (segmentCount - 1) * getAgnesSegmentGapSec()) / 60
  );
  return Math.max(configured, needed);
}
// 产物大小上限（MiB）：工作区会静默删除 ≥10MiB 的文件（实测阈值 10,485,760 B），
// 分段与成片都必须压到这个值以下，否则"生成成功"的东西会凭空消失。
export function getAgnesArtifactMaxMb(): number {
  return Math.max(1, parseInt(process.env.AGNES_ARTIFACT_MAX_MB || "9", 10) || 9);
}

// 下载域名单词白名单（逗号分隔），为空则仅做协议+内网校验
export const AGNES_DOWNLOAD_HOST_WHITELIST = (process.env.AGNES_DOWNLOAD_HOST_WHITELIST || "").split(",").map((s) => s.trim()).filter(Boolean);
export function getAgnesDownloadHostWhitelist(): string[] { return (process.env.AGNES_DOWNLOAD_HOST_WHITELIST || "").split(",").map((s) => s.trim()).filter(Boolean); }
// 中文标题字体（FFmpeg drawtext 用）。留空则按平台常见路径自动探测。
// 背景：Agnes 无法渲染可读中文（字形乱码且只显示数秒），标题改由 FFmpeg 确定性烧录，
// 因此需要一份系统 CJK 字体；探测不到字体时只跳过标题烧录，不让整个任务失败。
export function getAgnesTitleFont(): string { return process.env.AGNES_TITLE_FONT || ""; }

// ==================== 中文配音（TTS）配置 ====================
// 背景：实测 agnes-video-v2.0 **不会**合成中文语音 —— prompt 里写明
// "Chinese male voiceover narrating in Mandarin" 也只会得到一层工业环境音，
// 频谱上完全看不到语音共振峰。所以口播必须另外用 edge-tts 合成再混入。
// 默认关闭：edge-tts 依赖外部 Python 环境，缺失时必须优雅降级（成片无配音但不出错）。
export const AGNES_TTS_ENABLED = (process.env.AGNES_TTS_ENABLED || "0") === "1";
export function isAgnesTtsEnabled(): boolean { return (process.env.AGNES_TTS_ENABLED || "0") === "1"; }
// edge-tts 音色，默认云希（zh-CN 男声）
export const AGNES_TTS_VOICE = process.env.AGNES_TTS_VOICE || "zh-CN-YunxiNeural";
export function getAgnesTtsVoice(): string { return process.env.AGNES_TTS_VOICE || "zh-CN-YunxiNeural"; }
// Python 解释器（需已装 edge-tts）。留空则按常见路径探测。
export function getAgnesTtsPython(): string { return process.env.AGNES_TTS_PYTHON || ""; }
// 人声响度目标（LUFS）。实测 edge-tts 干声仅 -25.9 LUFS、语音带 -28.1 dB，各句响度也不齐，
// 所以每句都要按感知响度归一到 -16 LUFS（不再是为了"盖过环境音"——底噪已改静音）。
export function getAgnesTtsLufs(): string { return process.env.AGNES_TTS_LUFS || "-16"; }

/**
 * ⚠️ **当前无任何调用方，改它不会有任何效果。**
 *
 * 混音底噪已改为静音（Agnes 原音轨被整体丢弃，见 `buildNarrationAudioFilter`）——
 * 因为那条音轨里可能混着模型自己生成的旁白，会跟 edge-tts 口播叠成"两个男声"。
 *
 * 保留这个访问器是为了"环境音单独走"的可选方案：将来若要用本地无语音 `ambient.mp3`
 * 循环当底噪，音量直接复用这个配置即可。**不要**用它去重新打开 Agnes 音轨。
 */
export function getAgnesAmbientVol(): string { return process.env.AGNES_AMBIENT_VOL || "0.30"; }

// 启动自愈：超过此时长（分钟）仍在 processing/queued 的任务视为僵尸，启动时批量置 failed。
// 必须大于单段 40 分钟窗口（AGNES_SEGMENT_WINDOW_MIN），避免误杀正在慢跑的任务。
export function getAgnesStaleAfterMin(): number {
  return Math.max(61, parseInt(process.env.AGNES_STALE_AFTER_MIN || "60", 10) || 60);
}

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

// 上传/产物根目录。可用 UPLOADS_DIR 覆盖为绝对路径 —— 这是**逃出工作区大文件清理**的唯一手段：
// 工作区会静默删除 ≥10MiB 的 mp4，而 5~8 段拼出的成片天然 30~40 MiB。
// 虽然现在流水线已会把越线文件压到 AGNES_ARTIFACT_MAX_MB 以下，但把产物放到工作区外更稳。
// 默认仍是 <cwd>/public/uploads（保持原行为，不影响现有部署）。
export const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(process.cwd(), "public", "uploads");
export const VIDEOS_DIR = path.join(UPLOADS_DIR, "videos");
