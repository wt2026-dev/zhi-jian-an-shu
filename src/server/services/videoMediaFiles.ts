/**
 * 媒体文件与下载校验域（自 videoGenerationService.ts 机械切出，纯移动不改行为）。
 *
 * 内聚在此：SSRF 下载地址校验（内网 IPv4/IPv6 段 + 域名白名单）、
 * 缓冲区落盘、文件大小查询、超限视频逐级重编码压缩（shrinkIfOversize）。
 */
import { exec as execCb, execFile as execFileCb } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import { getAgnesArtifactMaxMb, getAgnesDownloadHostWhitelist } from "../utils/config.ts";
const execAsync = promisify(execCb);
const execFileAsync = promisify(execFileCb);
import path from "path";

// ==================== SSRF 防护 ====================
// 内网 IP 段正则
const PRIVATE_IP_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.|0\.|localhost$|\[::1\]$|::1$)/i;

/**
 * 校验视频下载 URL 合法性（导出供单测使用）
 * 规则：仅允许 http/https，拒绝 localhost/内网 IP，可选域名白名单
 */
export function validateDownloadUrl(rawUrl: string): { ok: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "视频下载地址格式不合法" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: `视频下载地址协议不被允许（${parsed.protocol}），仅支持 http/https` };
  }
  const hostname = parsed.hostname;
  if (PRIVATE_IP_RE.test(hostname)) {
    return { ok: false, reason: `视频下载地址指向内网地址（${hostname}），已拒绝` };
  }
  // IPv6 内网地址
  if (/^\[?[0-9a-f:]+\]?$/i.test(hostname) && /:(?:0|f{1,4}|f{2,4}|f{3,4}|f{4}:f{1,4}|f{4}:f{1,4}:f{1,4}|f{4}:f{1,4}:f{1,4}:f{1,4})$/.test(hostname.replace(/^\[|\]$/g, ""))) {
    return { ok: false, reason: `视频下载地址指向内网 IPv6 地址（${hostname}），已拒绝` };
  }
  const whitelist = getAgnesDownloadHostWhitelist();
  if (whitelist.length > 0 && !whitelist.includes(hostname)) {
    return { ok: false, reason: `视频下载地址域名（${hostname}）不在白名单内` };
  }
  return { ok: true };
}


/**
 * 将缓冲区异步写入文件
 */
export async function writeBufferToFile(filePath: string, data: ArrayBuffer): Promise<void> {
  const buf = Buffer.from(data);
  await fs.writeFile(filePath, buf);
  return;
}

// ==================== 产物体积护栏 ====================
// 运行环境会**静默删除**工作区内 ≥10 MiB（10,485,760 B）的 mp4，跨目录、不可恢复。
// 实测证据：2026-09-17 16:13–16:18 之间，docs/、scratch/、public/uploads/ 三个目录里
// 所有 ≥10 MiB 的 mp4 全部消失；幸存的都刚好在 10 MiB 以下。
// 分段文件（6~11 MB）常年在阈值边缘，成片（30~40 MB）则必然越线 ——
// 结果是"任务 completed、前端播放器 404"，库里再被启动自检改判 failed。
// 所以这里主动把越线文件压回去，宁可损失一点画质，也不要交付物凭空消失。
export async function fileSizeBytes(p: string): Promise<number> {
  try {
    return (await fs.stat(p)).size;
  } catch {
    return 0;
  }
}

/**
 * 超过阈值就把视频压小（原地替换）。逐级提高 crf 直到低于阈值。
 * 返回是否真的重编码过；压不下去时保留原文件（至少不比原来更糟）并打警告。
 */
export async function shrinkIfOversize(filePath: string): Promise<boolean> {
  const maxBytes = getAgnesArtifactMaxMb() * 1024 * 1024;
  const size = await fileSizeBytes(filePath);
  if (!size || size < maxBytes) return false;

  const tmp = `${filePath}.shrink.mp4`;
  for (const crf of [26, 30, 34, 38]) {
    try {
      await execFileAsync(
        "ffmpeg",
        ["-v", "error", "-y", "-i", filePath, "-c:v", "libx264", "-preset", "fast",
         "-crf", String(crf), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", tmp],
        { maxBuffer: 1024 * 1024 * 16 }
      );
      const newSize = await fileSizeBytes(tmp);
      if (newSize > 0 && newSize < maxBytes) {
        await fs.rename(tmp, filePath);
        console.log(
          `[AgnesVideoFull] ${path.basename(filePath)} 已压小：` +
            `${(size / 1048576).toFixed(2)}MiB → ${(newSize / 1048576).toFixed(2)}MiB（crf ${crf}）`
        );
        return true;
      }
    } catch (e: any) {
      console.warn(`[AgnesVideoFull] 压缩 ${path.basename(filePath)} 失败（crf ${crf}）:`, e?.message || e);
    }
  }
  await fs.unlink(tmp).catch(() => {});
  console.warn(
    `[AgnesVideoFull] ${path.basename(filePath)} 仍达 ${(size / 1048576).toFixed(2)}MiB，` +
      `超过 ${getAgnesArtifactMaxMb()}MiB 上限，可能被工作区清理`
  );
  return false;
}
