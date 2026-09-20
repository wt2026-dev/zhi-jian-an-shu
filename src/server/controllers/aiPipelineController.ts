// 重构说明：AI 协同任务链路（Pipeline）控制器——请求解析、编排调用与响应封装。
import { sseInit, sseSend } from "../services/aiClient.ts";
import { AiTaskRepository } from "../../db/repositories/index.ts";
import { createAndRunPipeline, PIPELINE_STEPS } from "../services/aiPipelineService.ts";
import { logger } from "../../utils/logger.ts";

// ==================== 创建并启动协同任务 ====================
export const handleCreatePipeline = async (req: any, res: any) => {
  try {
    const { equipmentId, problemDescription, scene } = req.body;
    const { id } = await createAndRunPipeline({
      scene: scene || "collaborative-diagnosis",
      equipmentId,
      problemDescription,
      createdBy: req.currentUser?.id,
    });
    res.status(202).json({
      success: true,
      taskId: id,
      scene: scene || "collaborative-diagnosis",
      steps: PIPELINE_STEPS.map((s) => s.name),
      message: "协同任务已创建并启动，可通过 GET /api/v1/ai/pipeline/:id 或 /events 跟踪进度",
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: "创建协同任务失败", message: err.message });
  }
};

// ==================== 查询协同任务最近列表 ====================
export const handleListPipeline = async (req: any, res: any) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 5;
    const tasks = await AiTaskRepository.list(limit);
    res.json({ success: true, tasks });
  } catch (err: any) {
    res.status(500).json({ success: false, error: "获取协同任务列表失败", message: err.message });
  }
};

// ==================== 查询任务与各步骤状态 ====================
export const handleGetPipeline = async (req: any, res: any) => {
  try {
    const task = await AiTaskRepository.getById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, error: "协同任务不存在" });
    }
    res.json({ success: true, task });
  } catch (err: any) {
    res.status(500).json({ success: false, error: "查询协同任务失败", message: err.message });
  }
};

// ==================== SSE 实时推送步骤进度 ====================
// 沿用现有 SSE 鉴权方式（requireAuth + Bearer Token），客户端用 fetch 流式读取或轮询兜底。
// 推送帧：{type:"snapshot", task} 初始快照；{type:"progress", task} 步骤变更；
//         {type:"done", task} 任务终态（completed/failed）后关闭连接。
export const handlePipelineEvents = async (req: any, res: any) => {
  try {
    const task = await AiTaskRepository.getById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, error: "协同任务不存在" });
    }
    sseInit(res);
    let lastSignature = "";

    const signatureOf = (t: any) =>
      JSON.stringify([t.status, t.progress, t.currentStep, t.steps.map((s: any) => `${s.status}:${s.progress}`)]);

    sseSend(res, { type: "snapshot", task });

    const isTerminal = (t: any) => t.status === "completed" || t.status === "failed";

    const timer = setInterval(async () => {
      try {
        const fresh = await AiTaskRepository.getById(req.params.id);
        if (!fresh) {
          sseSend(res, { type: "error", message: "协同任务已不存在" });
          cleanup();
          res.end();
          return;
        }
        const sig = signatureOf(fresh);
        if (sig !== lastSignature) {
          lastSignature = sig;
          sseSend(res, { type: isTerminal(fresh) ? "done" : "progress", task: fresh });
        }
        if (isTerminal(fresh)) {
          cleanup();
          res.end();
        }
      } catch (err: any) {
        logger.error("[AI Pipeline SSE] 推送异常:", err?.message || err);
        sseSend(res, { type: "error", message: err?.message || "推送异常" });
        cleanup();
        res.end();
      }
    }, 1500);

    const cleanup = () => {
      if (timer) clearInterval(timer);
    };
    req.on("close", cleanup);
  } catch (err: any) {
    res.status(500).json({ success: false, error: "建立协同任务事件流失败", message: err.message });
  }
};
