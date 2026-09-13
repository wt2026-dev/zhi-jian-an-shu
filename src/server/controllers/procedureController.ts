// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import path from "path";
import fs from "fs";
import { AGNES_BASE_URL, AGNES_API_KEY, isAgnesEnabled, UPLOADS_DIR } from "../utils/config.ts";
import { getAiClient, callDashScopeJson } from "../services/aiClient.ts";
import { ProcedureRepository, ProcedureVideoRepository } from "../../db/repositories/index.ts";
import { buildEnglishVideoPrompt, runFullVideoGeneration } from "../services/videoGenerationService.ts";

// GET /api/v1/procedures
export const handleListProcedures = async (req: any, res: any) => {
  const list = await ProcedureRepository.getAll({
    equipmentType: req.query.equipmentType,
    maintenanceLevel: req.query.maintenanceLevel,
    keyword: req.query.keyword,
  });
  res.json(list);
};

// 轮询视频状态 (GET /api/v1/procedures/video-status?taskId=xxx)
export const handleProcedureVideoStatus = async (req: any, res: any) => {
  const taskId = req.query.taskId as string;
  if (!taskId) {
    return res.status(400).json({ error: "缺少必要参数 taskId" });
  }

  const record = await ProcedureVideoRepository.getByTaskId(taskId);
  if (!record) {
    return res.status(404).json({ error: "未找到对应的视频生成记录" });
  }

  // 完整讲解视频（多段拼接）任务：task_id 以 full- 开头，进度在本地库中（error 字段存进度），不查询 Agnes 远端
  if (taskId.startsWith("full-")) {
    return res.json({
      status: record.status,
      videoUrl: record.videoUrl,
      error: record.error || null,
      fullMode: true,
    });
  }

  // 如果数据库中已经是 completed 或 failed，直接返回
  if (record.status === "completed" || record.status === "failed") {
    return res.json({
      status: record.status,
      videoUrl: record.videoUrl,
      error: record.error,
    });
  }

  // queued 或 processing 时，调 Agnes: GET ${AGNES_BASE_URL}/agnesapi?video_id=${taskId}
  if (!AGNES_API_KEY) {
    return res.json({
      status: record.status,
      videoUrl: record.videoUrl,
      error: "AGNES_API_KEY 缺失，无法查询最新远端状态",
    });
  }

  try {
    const checkUrl = `${AGNES_BASE_URL}/agnesapi?video_id=${encodeURIComponent(taskId)}`;
    console.log(`[AgnesVideo] 轮询视频状态: taskId=${taskId}, url=${checkUrl}`);
    const agnesRes = await fetch(checkUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${AGNES_API_KEY}`,
      },
    });

    const data: any = await agnesRes.json().catch(() => ({}));
    console.log(`[AgnesVideo] 轮询响应 taskId=${taskId}: status=${agnesRes.status}, data=`, JSON.stringify(data));

    const rawStatus = (data.status || data.state || "").toLowerCase();
    let finalStatus = record.status;
    let finalVideoUrl: string | null = record.videoUrl || null;
    let finalError: string | null = null;

    if (!agnesRes.ok) {
      finalStatus = "failed";
      const errorDetail = data?.message || (typeof data?.error === "object" ? (data.error?.message || JSON.stringify(data.error)) : data?.error) || `HTTP ${agnesRes.status}`;
      finalError = `Agnes API 失败: 状态码 ${agnesRes.status} / 消息 ${errorDetail}`;
    } else if (rawStatus === "completed" || rawStatus === "succeeded" || rawStatus === "success" || data.video_url || data.url) {
      finalStatus = "completed";
      finalVideoUrl = data.video_url || data.url || data.output?.video_url || data.output?.url || null;
    } else if (rawStatus === "failed" || rawStatus === "error") {
      finalStatus = "failed";
      const errorDetail = data?.message || (typeof data?.error === "object" ? (data.error?.message || JSON.stringify(data.error)) : data?.error) || "视频生成失败";
      finalError = `Agnes API 失败: 消息 ${errorDetail}`;
    } else if (rawStatus === "processing" || rawStatus === "in_progress" || rawStatus === "running") {
      finalStatus = "processing";
    } else if (rawStatus === "queued" || rawStatus === "pending" || rawStatus === "waiting") {
      finalStatus = "queued";
    }

    if (finalStatus !== record.status || finalVideoUrl !== record.videoUrl || finalError !== record.error) {
      await ProcedureVideoRepository.updateStatus(taskId, {
        status: finalStatus,
        videoUrl: finalVideoUrl,
        error: finalError,
      });
    }

    res.json({
      status: finalStatus,
      videoUrl: finalVideoUrl,
      error: finalError,
    });
  } catch (err: any) {
    const errMsg = err?.message || (typeof err === "object" ? JSON.stringify(err) : String(err));
    console.error(`[AgnesVideo] 轮询状态异常 (taskId=${taskId}):`, errMsg);
    res.json({
      status: record.status,
      videoUrl: record.videoUrl,
      error: record.error || `Agnes API 失败: 消息 ${errMsg}`,
    });
  }
};

// 删除视频记录 (DELETE /api/v1/procedures/videos/:id)
export const handleDeleteProcedureVideo = async (req: any, res: any) => {
  const deleted = await ProcedureVideoRepository.delete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "视频记录不存在或已被删除" });
  }
  res.json({ success: true, message: "视频记录已成功删除" });
};

// GET /api/v1/procedures/:id
export const handleGetProcedure = async (req: any, res: any) => {
  const item = await ProcedureRepository.getById(req.params.id);
  if (!item) return res.status(404).json({ error: "标准化作业指引未找到" });
  res.json(item);
};

// POST /api/v1/procedures
export const handleCreateProcedure = async (req: any, res: any) => {
  const created = await ProcedureRepository.create(req.body);
  res.status(201).json(created);
};

// POST /api/v1/procedures/:id/generate-video-script
export const handleGenerateVideoScript = async (req: any, res: any) => {
  const proc = await ProcedureRepository.getById(req.params.id);
  if (!proc) return res.status(404).json({ error: "作业指引未找到" });

  // 检查是否已有缓存且非强制刷新
  if (proc.script && !req.query.refresh) {
    return res.json({ success: true, script: proc.script, procedure: proc, cached: true });
  }

  const ai = getAiClient();
  if (!ai) {
    // 离线降级规则脚本生成
    const fallbackScript = {
      title: `${proc.title} - 仿真操作视频解说脚本`,
      duration_estimate: proc.steps.length * 25,
      voiceover: proc.steps.map((s: any) => `步骤${s.step_no}，${s.name}。重点操作内容：${s.content}。注意安全规范：${s.safety || "严格做好绝缘与安全隔离防护"}，严格按照验收标准执行。`),
      subtitles: proc.steps.map((s: any) => `第${s.step_no}步：${s.name}，工具：${s.tools || "标准工器具"}`),
    };
    const updated = await ProcedureRepository.updateScript(proc.id, fallbackScript);
    return res.json({ success: true, script: fallbackScript, procedure: updated, degraded: true });
  }

  try {
    const stepsText = proc.steps.map((s: any) => `步骤${s.step_no}: 【${s.name}】\n操作要求: ${s.content}\n所需工具: ${s.tools || "标准工具"}\n安全要点: ${s.safety || "严格个人防护"}\n验收标准: ${s.acceptance || "合格达标"}`).join("\n\n");
    const prompt = `请为以下标准化工业设备检修作业规程《${proc.title}》（设备类型: ${proc.equipmentType}, 检修等级: ${proc.maintenanceLevel}）生成一套专业的实操视频解说词与同步分镜字幕脚本。
步骤清单：
${stepsText}

请以严格合法的 JSON 格式输出，不要包含 markdown 外的多余字符：
{
  "title": "${proc.title} - 仿真视频讲解脚本",
  "duration_estimate": ${proc.steps.length * 28},
  "voiceover": [
    "对应第1步的生动专业解说词，每段50-80字，语速平稳有力，清晰交代操作手势、工具用法与安全红线",
    ...共 ${proc.steps.length} 条，严格对应每一步
  ],
  "subtitles": [
    "对应第1步的字幕核心精炼文案（25字以内）",
    ...共 ${proc.steps.length} 条，严格对应每一步
  ]
}`;

    const { data } = await callDashScopeJson("你是工业设备标准化作业视频导演与金牌解说专家。只输出合法JSON。", prompt, 0.3);
    const scriptData = {
      title: data.title || `${proc.title} - 讲解分镜脚本`,
      duration_estimate: data.duration_estimate || proc.steps.length * 25,
      voiceover: Array.isArray(data.voiceover) ? data.voiceover : proc.steps.map((s: any) => `步骤${s.step_no}：${s.name}。${s.content}`),
      subtitles: Array.isArray(data.subtitles) ? data.subtitles : proc.steps.map((s: any) => `第${s.step_no}步：${s.name}`),
    };

    const updated = await ProcedureRepository.updateScript(proc.id, scriptData);
    res.json({ success: true, script: scriptData, procedure: updated });
  } catch (err: any) {
    console.error("[ProcedureScript] AI 脚本生成失败:", err?.message || err);
    // 降级兜底
    const fallbackScript = {
      title: `${proc.title} - 仿真视频解说脚本`,
      duration_estimate: proc.steps.length * 25,
      voiceover: proc.steps.map((s: any) => `现在进行步骤${s.step_no}，${s.name}。操作要点：${s.content}。请务必佩戴好安全防护用具，严格遵守工程质量验收要求。`),
      subtitles: proc.steps.map((s: any) => `第${s.step_no}步：${s.name}`),
    };
    const updated = await ProcedureRepository.updateScript(proc.id, fallbackScript);
    res.json({ success: true, script: fallbackScript, procedure: updated, degraded: true, error: err.message });
  }
};

// ==================== Agnes AI 真实工业实操视频生成接口 ====================
// 1. 发起视频生成 (POST /api/v1/procedures/:id/generate-video)
export const handleGenerateVideo = async (req: any, res: any) => {
  if (!isAgnesEnabled()) {
    return res.status(503).json({
      error: "视频生成功能未启用，请联系管理员在 .env 中设置 AGNES_ENABLED=true 后重启系统",
      code: "VIDEO_GEN_DISABLED",
    });
  }
  if (!AGNES_API_KEY) {
    return res.status(503).json({
      error: "Agnes AI 视频生成服务未配置：缺少 AGNES_API_KEY 环境变量，请联系管理员在 .env 中配置后重启系统",
      code: "AGNES_KEY_MISSING",
    });
  }

  const proc = await ProcedureRepository.getById(req.params.id);
  if (!proc) return res.status(404).json({ error: "作业指引未找到" });

  // 1. 将规程浓缩为 60-100 词的连贯英文连续画面 Prompt（纯生成逻辑拆至 videoGenerationService）
  const englishPrompt = await buildEnglishVideoPrompt(proc);

  // 2. 调用 Agnes 视频生成 API
  // 时长选择：duration=10|15|18（秒），按 Agnes 8n+1 帧规则换算，默认 18 秒（441 帧 = 免费上限）
  const durationMap: Record<string, number> = { "10": 241, "15": 361, "18": 441 };
  const durationSec = String(req.query.duration || "18");
  const numFrames = durationMap[durationSec] || 441;
  console.log(`[AgnesVideo] 发起视频生成请求: procedureId=${proc.id}, duration=${durationSec}s (${numFrames}帧), prompt=${englishPrompt.slice(0, 100)}...`);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const agnesRes = await fetch(`${AGNES_BASE_URL}/videos`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AGNES_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "agnes-video-v2.0",
        prompt: englishPrompt,
        width: 1152,
        height: 768,
        num_frames: numFrames,
        frame_rate: 24,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const resBody: any = await agnesRes.json().catch(() => ({}));
    console.log(`[AgnesVideo] Agnes 响应状态: ${agnesRes.status}, body:`, JSON.stringify(resBody));

    if (!agnesRes.ok) {
      const rawErr = resBody.message || (typeof resBody.error === "object" ? (resBody.error?.message || JSON.stringify(resBody.error)) : resBody.error) || `HTTP ${agnesRes.status}`;
      const errorDetail = `Agnes API 失败: 状态码 ${agnesRes.status} / 消息 ${rawErr}`;
      await ProcedureVideoRepository.create({
        procedureId: proc.id,
        taskId: `err-${Date.now()}`,
        status: "failed",
        prompt: englishPrompt,
        error: errorDetail,
      });
      return res.status(502).json({
        error: errorDetail,
        details: resBody,
      });
    }

    // 取响应 video_id/task_id/id 任一字段作 task_id
    const taskId = resBody.video_id || resBody.task_id || resBody.id;
    if (!taskId) {
      throw new Error("Agnes 响应中未包含有效的 video_id/task_id");
    }

    const record = await ProcedureVideoRepository.create({
      procedureId: proc.id,
      taskId: String(taskId),
      status: "queued",
      prompt: englishPrompt,
    });

    res.status(200).json({
      success: true,
      taskId: String(taskId),
      status: "queued",
      videoRecord: record,
    });
  } catch (err: any) {
    const isTimeout = err.name === "AbortError";
    const rawMsg = err?.message || (typeof err === "object" ? JSON.stringify(err) : String(err));
    const errorMsg = isTimeout ? "请求 Agnes 视频接口超时 (30s)" : `Agnes API 失败: 消息 ${rawMsg}`;
    console.error("[AgnesVideo] 请求 Agnes 服务异常:", errorMsg);

    await ProcedureVideoRepository.create({
      procedureId: proc.id,
      taskId: `err-${Date.now()}`,
      status: "failed",
      prompt: englishPrompt,
      error: errorMsg,
    });

    res.status(502).json({
      error: errorMsg,
    });
  }
};

// ==================== 完整讲解视频：多段按步骤生成 + FFmpeg 拼接（带声音） ====================
// POST /api/v1/procedures/:id/generate-video-full
export const handleGenerateVideoFull = async (req: any, res: any) => {
  if (!isAgnesEnabled()) {
    return res.status(503).json({
      error: "视频生成功能未启用，请联系管理员在 .env 中设置 AGNES_ENABLED=true 后重启系统",
      code: "VIDEO_GEN_DISABLED",
    });
  }
  const proc = await ProcedureRepository.getById(req.params.id);
  if (!proc) return res.status(404).json({ error: "作业指引未找到" });
  if (!AGNES_API_KEY) return res.status(503).json({ error: "AGNES_API_KEY 未配置，无法生成完整视频" });

  const steps: any[] = proc.steps || [];
  if (steps.length === 0) return res.status(400).json({ error: "该规程没有可拍摄的步骤" });

  // 每 2 步一组（每段 441 帧 = 约 18 秒，Agnes 免费上限）
  const groups: any[][] = [];
  for (let i = 0; i < steps.length; i += 2) groups.push(steps.slice(i, i + 2));

  const taskId = `full-${Date.now()}`;
  const fullDir = path.join(UPLOADS_DIR, "full-videos");
  if (!fs.existsSync(fullDir)) fs.mkdirSync(fullDir, { recursive: true });

  // 立即入库（processing + 进度）
  await ProcedureVideoRepository.create({
    procedureId: proc.id,
    taskId,
    status: "processing",
    prompt: "完整讲解视频（多段生成 + FFmpeg 拼接）",
    error: `正在初始化，共 ${groups.length} 段视频...`,
  });

  res.status(200).json({
    success: true,
    taskId,
    status: "processing",
    segmentCount: groups.length,
    estimatedSeconds: groups.length * 18,
    message: `完整视频生成已启动：共 ${groups.length} 段，预计 ${Math.ceil(groups.length * 5)} 分钟`,
  });

  // 后台异步执行：串行生成每段 → 下载 → 拼接（纯生成逻辑拆至 videoGenerationService，与原 IIFE 相同为不等待的 fire-and-forget 调用）
  runFullVideoGeneration(proc, taskId, groups, fullDir);
};

// 3. 获取指定规程的历史视频记录列表 (GET /api/v1/procedures/:id/videos)
export const handleGetProcedureVideos = async (req: any, res: any) => {
  const list = await ProcedureVideoRepository.getByProcedureId(req.params.id);
  res.json(list);
};
