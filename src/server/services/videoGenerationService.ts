// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
// 承载 /api/v1/procedures/:id/generate-video 与 generate-video-full 中的纯视频生成逻辑
// （不依赖 req/res，参数传入），由 procedureController 调用。
import path from "path";
import fs from "fs/promises";
import { exec as execCb } from "child_process";
import { promisify } from "util";
import {
  AGNES_BASE_URL,
  AGNES_API_KEY,
  AGNES_ENABLED,
  AGNES_MAX_CONCURRENT,
  AGNES_TOTAL_TIMEOUT_MIN,
  AGNES_DOWNLOAD_HOST_WHITELIST,
  isAgnesEnabled,
  getAgnesMaxConcurrent,
  getAgnesTotalTimeoutMin,
  getAgnesDownloadHostWhitelist,
} from "../utils/config.ts";
import { getAiClient, callDashScopeJson } from "./aiClient.ts";
import { ProcedureVideoRepository } from "../../db/repositories/index.ts";

const sleepMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, process.env.NODE_ENV === "test" ? Math.min(ms, 10) : ms));
const execAsync = promisify(execCb);

// ==================== 并发控制 ====================
let runningTasks = 0;

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

// 将规程浓缩为 60-100 词的连贯英文连续画面 Prompt（自 generate-video handler 拆出）
export async function buildEnglishVideoPrompt(proc: any): Promise<string> {
  let englishPrompt = "";
  const ai = getAiClient();
  const stepsSummary = (proc.steps || [])
    .map((s: any) => `Step ${s.step_no}: ${s.name} (${s.content}). Safety: ${s.safety || 'wear safety gear'}`)
    .join("; ");

  if (ai) {
    try {
      const sysPrompt = "You are an industrial video director. Summarize industrial maintenance SOP into a single continuous-shot English video description prompt. Only output valid JSON with property 'prompt'.";
      const userPrompt = `Summarize this industrial SOP into a 60-100 word coherent continuous-shot English prompt describing realistic industrial scene, specific equipment (${proc.equipmentType}), worker actions, tools, and safety elements. It must describe a SINGLE continuous dynamic camera shot, strictly NO multi-shot montage/cut phrases.
Procedure Title: ${proc.title}
Equipment Type: ${proc.equipmentType}
Maintenance Level: ${proc.maintenanceLevel}
Steps: ${stepsSummary}

Output JSON format:
{"prompt": "A 60-100 word fluent English description..."}`;

      const { data } = await callDashScopeJson(sysPrompt, userPrompt, 0.3);
      englishPrompt = data.prompt || "";
    } catch (err: any) {
      console.warn("[AgnesVideo] 大模型生成英文 Prompt 失败，采用备用模板:", err?.message || err);
    }
  }

  if (!englishPrompt || englishPrompt.length < 20) {
    englishPrompt = `In a clean modern high-tech industrial workshop, a certified technician wearing safety helmet and protective goggles methodically performs ${proc.maintenanceLevel} on an industrial ${proc.equipmentType}. Smooth steady continuous cinematic camera tracking shot showing precise handling of maintenance tools, inspection of machinery components, safety compliance, realistic industrial lighting, ultra high definition 4K texture, professional industrial engineering atmosphere.`;
  }
  return englishPrompt;
}

// 为每个步骤分组生成英文 prompt（连续单镜头 + 工业环境声/中文解说描述，Agnes 原生音画同出）
export async function buildFullSegmentPrompt(proc: any, groupSteps: any[]): Promise<string> {
  const stepsText = groupSteps
    .map((s) => `Step ${s.step_no}: ${s.name}. Operation: ${s.content || ""}. Safety: ${s.safety || "strict PPE compliance"}. Acceptance: ${s.acceptance || "qualified"}`)
    .join(" Then ");
  const ai = getAiClient();
  if (ai) {
    try {
      const sys = "You are an industrial training video director. Write ONE continuous-shot English video prompt (55-90 words) for a maintenance SOP segment. The video MUST include synchronized audio: clear ambient industrial sounds (machinery hum, tool handling) and a calm confident male Chinese technician voiceover narrating the exact operations in Chinese. Output valid JSON: {\"prompt\": \"...\"}";
      const user = `Equipment: ${proc.equipmentType}, maintenance level: ${proc.maintenanceLevel}. Segment operations: ${stepsText}. Output JSON only.`;
      const { data } = await callDashScopeJson(sys, user, 0.3);
      if (data.prompt && data.prompt.length > 30) return data.prompt;
    } catch (err: any) {
      console.warn("[AgnesVideoFull] 大模型生成段 Prompt 失败，采用备用模板:", err?.message || err);
    }
  }
  return `In a clean modern high-tech industrial workshop, a certified technician in safety helmet and goggles performs precise maintenance operations: ${stepsText}. Smooth steady continuous cinematic tracking shot, realistic industrial lighting, 4K texture. Synchronized audio with clear industrial machinery ambient sounds, tool handling noises, and a calm professional Chinese male voice narrating the maintenance steps in Mandarin with clear pronunciation.`;
}

/**
 * 将缓冲区异步写入文件
 */
async function writeBufferToFile(filePath: string, data: ArrayBuffer): Promise<void> {
  const buf = Buffer.from(data);
  await fs.writeFile(filePath, buf);
  return;
}

// 完整讲解视频后台异步执行：串行生成每段 → 下载 → FFmpeg 拼接（自 generate-video-full 的异步 IIFE 拆出）
export async function runFullVideoGeneration(proc: any, taskId: string, groups: any[][], fullDir: string): Promise<void> {
  // 防御：开关关闭直接置 failed
  if (!isAgnesEnabled()) {
    const errMsg = "视频生成功能未启用";
    console.error("[AgnesVideoFull] 开关关闭，任务终止:", errMsg);
    try { await ProcedureVideoRepository.updateStatus(taskId, { status: "failed", error: errMsg }); } catch {}
    return;
  }
  // 并发控制
  const maxConcurrent = getAgnesMaxConcurrent();
  if (runningTasks >= maxConcurrent) {
    const errMsg = "视频生成任务已达并发上限，请稍后重试";
    console.error("[AgnesVideoFull] 并发超限，任务终止:", errMsg);
    try { await ProcedureVideoRepository.updateStatus(taskId, { status: "failed", error: errMsg }); } catch {}
    return;
  }
  runningTasks++;
  const taskStartTime = Date.now();
  const totalTimeoutMs = getAgnesTotalTimeoutMin() * 60 * 1000;

  try {
    const segPaths: string[] = [];
    for (let g = 0; g < groups.length; g++) {
      // 全局超时检查
      if (Date.now() - taskStartTime > totalTimeoutMs) {
        throw new Error(`视频生成任务全局超时（${getAgnesTotalTimeoutMin()}分钟），已终止`);
      }
      const groupSteps = groups[g];
      await ProcedureVideoRepository.updateStatus(taskId, {
        status: "processing",
        error: `正在生成第 ${g + 1}/${groups.length} 段视频（${groupSteps.map((s) => `步骤${s.step_no}`).join("、")}）...`,
      });

      const segPrompt = await buildFullSegmentPrompt(proc, groupSteps);
      console.log(`[AgnesVideoFull] 第${g + 1}/${groups.length}段提交: prompt=${segPrompt.slice(0, 100)}...`);

      // 提交 Agnes 视频任务
      const createRes = await fetch(`${AGNES_BASE_URL}/videos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${AGNES_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "agnes-video-v2.0",
          prompt: segPrompt,
          width: 1152,
          height: 768,
          num_frames: 441,
          frame_rate: 24,
        }),
        signal: AbortSignal.timeout(30000),
      });
      const createBody: any = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        const errDetail = typeof createBody?.message === "string" ? createBody.message : (typeof createBody?.error === "string" ? createBody.error : (createBody && Object.keys(createBody).length ? JSON.stringify(createBody) : `HTTP ${createRes.status}`));
        throw new Error(`第 ${g + 1} 段创建失败: 状态码 ${createRes.status} / 消息 ${errDetail}`);
      }
      const segTaskId = createBody.video_id || createBody.task_id || createBody.id;
      if (!segTaskId) throw new Error(`第 ${g + 1} 段响应缺少 video_id`);

      // 轮询该段完成（最多 10 分钟，且不超全局超时）
      let segUrl: string | null = null;
      for (let p = 0; p < 40; p++) {
        // 每轮检查全局超时
        if (Date.now() - taskStartTime > totalTimeoutMs) {
          throw new Error(`视频生成任务全局超时（${getAgnesTotalTimeoutMin()}分钟），已终止`);
        }
        await sleepMs(15000);
        try {
          const stRes = await fetch(`${AGNES_BASE_URL}/agnesapi?video_id=${encodeURIComponent(segTaskId)}`, {
            headers: { Authorization: `Bearer ${AGNES_API_KEY}` },
            signal: AbortSignal.timeout(15000),
          });
          const st: any = await stRes.json().catch(() => ({}));
          const raw = (st.status || st.state || "").toLowerCase();
          if (raw === "completed" || raw === "succeeded" || st.video_url || st.url || st.output?.video_url) {
            segUrl = st.video_url || st.url || st.output?.video_url || st.output?.url || null;
            break;
          }
          if (raw === "failed" || raw === "error") {
            const failDetail = typeof st?.error === "string" ? st.error : (typeof st?.message === "string" ? st.message : (st?.error || st?.message ? JSON.stringify(st.error || st.message) : `状态码 ${stRes.status}`));
            throw new Error(`第 ${g + 1} 段生成失败: 状态码 ${stRes.status} / 消息 ${failDetail}`);
          }
        } catch (err: any) {
          if (err?.message && err.message.includes("段生成失败")) throw err;
          if (err?.message && err.message.includes("全局超时")) throw err;
          const errStr = err?.message || (typeof err === "object" ? JSON.stringify(err) : String(err));
          console.warn(`[AgnesVideoFull] 第${g + 1}段轮询异常，继续等待:`, errStr);
        }
      }
      if (!segUrl) throw new Error(`第 ${g + 1} 段生成超时（10 分钟）`);

      // SSRF 防护：校验下载 URL
      const urlCheck = validateDownloadUrl(segUrl);
      if (!urlCheck.ok) {
        throw new Error(urlCheck.reason);
      }

      // 下载段视频（异步写入）
      const segFile = path.join(fullDir, `${taskId}-seg${g + 1}.mp4`);
      const segResp = await fetch(segUrl, { signal: AbortSignal.timeout(120000) });
      if (!segResp.ok) throw new Error(`第 ${g + 1} 段视频下载失败: HTTP ${segResp.status}`);
      const arrayBuf = await segResp.arrayBuffer();
      await writeBufferToFile(segFile, arrayBuf);
      segPaths.push(segFile);
      console.log(`[AgnesVideoFull] 第${g + 1}/${groups.length}段下载完成: ${segFile} (${Math.round(arrayBuf.byteLength / 1024)}KB)`);

      // Agnes 视频生成限频约 1 次/分钟，段间等待 65 秒（最后一段无需等待）
      if (g < groups.length - 1) {
        await ProcedureVideoRepository.updateStatus(taskId, {
          status: "processing",
          error: `第 ${g + 1}/${groups.length} 段完成，等待限频后生成下一段（约 1 分钟）...`,
        });
        await sleepMs(65000);
      }
    }

    // FFmpeg 拼接（音视频流直接复制，速度快且保留每段原生声音）
    await ProcedureVideoRepository.updateStatus(taskId, {
      status: "processing",
      error: `全部 ${groups.length} 段生成完成，正在拼接音视频...`,
    });
    const listFile = path.join(fullDir, `${taskId}.txt`);
    const listContent = segPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
    await fs.writeFile(listFile, listContent);
    const outName = `${taskId}.mp4`;
    const outPath = path.join(fullDir, outName);
    try {
      await execAsync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${outPath}"`);
    } catch (concatErr: any) {
      console.warn("[AgnesVideoFull] concat -c copy 失败，改为重编码拼接:", concatErr?.message || concatErr);
      await execAsync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k "${outPath}"`);
    }

    // 清理段文件与列表（异步）
    await Promise.allSettled([
      ...segPaths.map((p) => fs.unlink(p).catch(() => {})),
      fs.unlink(listFile).catch(() => {}),
    ]);

    const videoUrl = `/uploads/full-videos/${outName}`;
    await ProcedureVideoRepository.updateStatus(taskId, {
      status: "completed",
      videoUrl,
      error: null,
    });
    console.log(`[AgnesVideoFull] 完整视频拼接完成: ${outPath} → ${videoUrl}`);
  } catch (err: any) {
    const errMsg = err?.message || (typeof err === "object" ? JSON.stringify(err) : String(err));
    console.error("[AgnesVideoFull] 完整视频生成失败:", errMsg);
    try {
      await ProcedureVideoRepository.updateStatus(taskId, {
        status: "failed",
        error: errMsg || "完整视频生成失败",
      });
    } catch {}
  } finally {
    runningTasks--;
  }
}

// ==================== 内部状态观测口（供回归测试与运维诊断使用，业务代码勿用） ====================
export const __runningTasks = { get count() { return runningTasks; } };
