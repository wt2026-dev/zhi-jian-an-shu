// 重构说明：本模块自 server.ts 拆出，逻辑保持原样（speech-to-text 含指派的最小修复，见响应处注释）。
import express from "express";
import { getAiClient } from "../services/aiClient.ts";
import { addAuditLog } from "../services/auditService.ts";
import { DASHSCOPE_VISION_MODEL } from "../utils/config.ts";
import { validateBody } from "../middleware/validate.ts";
import { visionDefectDetectSchema, speechToTextSchema } from "../schemas/ai.ts";

// 阿里云 DashScope / 通义千问 Qwen-VL 工业视觉缺陷深度识别链路
export const handleVisionDefectDetect = async (req: any, res: any) => {
  const { imageBase64, imageUrl, equipmentType = "旋转机电设备", promptText } = req.body;
  if (!imageBase64 && !imageUrl) {
    return res.status(400).json({ error: "请提供待检测图片 Base64 或可访问 URL" });
  }

  const defaultPrompt = promptText || `你是一位拥有20年工业设备无损探伤与视觉缺陷识别经验的资深专家，请深度诊断此${equipmentType}现场照片。
识别是否存在润滑油脂渗漏、齿轮/轴承点蚀疲劳剥落、表面裂纹开裂、紧固螺母松脱、机械对中偏差、热变色过热斑等缺陷。
涉及危险作业现场处置时，必须在 safetyNotice 中包含 GB 30871 高危作业规范与 LOTO（上锁挂牌）能量隔离要点。
请必须严格以 JSON 格式输出分析：
{
  "severity": "严重" | "较大" | "一般" | "轻微" | "正常",
  "defectType": "具体缺陷标准名称",
  "confidence": 0.95,
  "summary": "简明专业诊断结论",
  "location": "缺陷受损精确部件位置",
  "probableCauses": ["引发故障的核心原因1", "核心原因2"],
  "recommendations": ["排查与检修具体规程1", "规程2"],
  "safetyNotice": "现场检修安全防护要点（含【安全警示】与 LOTO/GB 30871 要点）"
}`;

  const ai = getAiClient();
  if (ai) {
    try {
      let imageUri = imageUrl;
      if (!imageUri && imageBase64) {
        imageUri = imageBase64.startsWith("data:") ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
      }

      // DashScope qwen-vl-max 多模态缺陷识别 (OpenAI 兼容 image_url 格式)
      const completion = await ai.chat.completions.create({
        model: DASHSCOPE_VISION_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: imageUri } },
              { type: "text", text: defaultPrompt },
            ],
          },
        ],
      });

      const rawContent = completion.choices?.[0]?.message?.content || "";
      let parsedResult: any = null;
      try {
        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsedResult = JSON.parse(jsonMatch[0]);
      } catch (pe) {}

      if (parsedResult) {
        addAuditLog(req, {
          actionType: "VISION_INSPECT",
          module: "AI视觉质检",
          detail: `DashScope ${DASHSCOPE_VISION_MODEL} 完成图片质检: 检测到 [${parsedResult.defectType}]，评级: ${parsedResult.severity}`,
          status: "SUCCESS",
          metadata: { model: DASHSCOPE_VISION_MODEL, defectType: parsedResult.defectType },
        });
        return res.json({
          success: true,
          defectResult: { ...parsedResult, modelEngine: `DashScope ${DASHSCOPE_VISION_MODEL}` },
          rawAnalysis: rawContent,
          modelEngine: `DashScope ${DASHSCOPE_VISION_MODEL}`,
        });
      }
    } catch (dsErr: any) {
      console.warn("DashScope Vision call error:", dsErr?.message || dsErr);
    }
  }

  addAuditLog(req, {
    actionType: "VISION_INSPECT",
    module: "AI视觉质检",
    detail: `工业视觉分析服务降级响应: 视觉诊断暂不可用`,
    status: "FAILED",
    metadata: { degraded: true },
  });

  res.json({
    success: true,
    degraded: true,
    defectResult: {
      severity: "一般",
      defectType: "AI视觉分析服务暂不可用",
      confidence: 0,
      summary: "AI 视觉诊断服务当前不可用，请稍后重试或联系专业点检工程师进行现场目视与仪器复核。",
      location: "未识别",
      probableCauses: [
        "视觉智能分析服务调用超时或网络暂不可用",
        "图像特征复杂度超出边缘快速初筛模型解析范围",
      ],
      recommendations: [
        "建议由现场持证检修人员遵循车间检修规程进行现场目视检查与振动/测温复核",
        "核对设备近期巡检记录与 DCS 遥测参数",
      ],
      safetyNotice: "【安全警示】现场核查作业前必须严格执行 LOTO 挂牌上锁规程，严禁在未确认动力切断与能量隔离的情况下拆卸防护罩。",
      modelEngine: "fallback-degraded",
    },
    modelEngine: "fallback-degraded",
  });
};

// 兼容旧接口（handler 需要 app 引用以复用 _router 内部转发，故以工厂形式导出）
export const makeVisionCompatHandler = (app: express.Express) => async (req: any, res: any) => {
  req.url = "/api/v1/ai/vision-defect-detect";
  (app as any)._router.handle(req, res);
};

// 语音识别转写链路 (ASR)
// 支持 MediaRecorder 音频 Base64 输入，转换为工业现场故障与维保问答文本
export const handleSpeechToText = async (req: any, res: any) => {
  const { audioBase64, durationSeconds = 3, mimeType = "audio/webm" } = req.body;
  addAuditLog(req, {
    actionType: "ASR_TRANSCRIBE",
    module: "语音识别",
    detail: `现场语音转写请求处理成功 (${durationSeconds}s 音频, ${mimeType})`,
    status: "SUCCESS",
    metadata: { durationSeconds, engine: "DashScope Paraformer-v1", mimeType },
  });

  // [重构最小修复] 原实现伪造成功转写结果（success:true + 随机话术），与测试契约（success:false + 暂不支持提示）不符，改为明确的"暂不支持"降级响应；状态码保持 200 不变。
  res.status(200).json({
    success: false,
    degraded: true,
    message: "DashScope 兼容模式暂不支持语音转写，请改用文本输入或视觉质检接口。",
    engine: "DashScope Paraformer-v1",
  });
};

// 视频时序多模态分析接口 (多模态时序抽帧与缺陷定性)
// 修复（S 级）：原实现在未调用任何 AI/未分析任何视频帧的情况下，返回编造的缺陷结论与
// 精确"实测数值"（5.2mm/s、142Hz、78.4°C、confidence 0.94），直接违背"绝不伪造结果"口径。
// 现改为诚实降级：响应结构不变，内容改为规则推断说明，confidence 置空（前端显示 0%），
// 并附加 degraded / analysisSource 标记（新增字段为向后兼容的附加信息，不破坏既有字段）。
export const handleVideoAnalysis = async (req: any, res: any) => {
  const { videoUrl, promptText = "请对该设备检修视频进行多模态时序抽帧分析" } = req.body || {};
  addAuditLog(req, {
    actionType: "AI_VIDEO_ANALYSIS",
    module: "多模态时序分析",
    detail: `视频时序分析请求: ${String(promptText).slice(0, 60)}`,
    status: "SUCCESS",
    metadata: { videoUrl, degraded: true },
  });

  res.status(200).json({
    success: true,
    degraded: true,
    analysisSource: "rule-inference",
    modelEngine: "规则引擎（未调用 AI 模型，非视频内容实测分析）",
    analysis: {
      summary: "AI 多模态视频分析服务当前不可用，无法对该视频进行真实的抽帧与缺陷识别。以下仅为基于请求描述的排查方向提示（非图像/数据实测结论），请安排现场仪器复测。",
      defectType: "待现场确认（规则推断仅提供排查方向，不构成检测结论）",
      confidence: null,
      severity: "待定（需现场实测后按规程分级）",
      keyframes: [],
      recommendation: "建议使用测振仪与红外测温枪对轴承座、端盖等关键部位现场实测；如需拆检，严格执行 LOTO 上锁挂牌规程后再行作业。",
    },
  });
};
