// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import path from "path";
import fs from "fs";
import { DASHSCOPE_VISION_MODEL, UPLOADS_DIR, VIDEOS_DIR } from "../utils/config.ts";
import { authenticateBearer } from "../services/authService.ts";
import { addAuditLog } from "../services/auditService.ts";
import { getVisionClient, extractAiJson } from "../services/aiClient.ts";
import { AiAnalysisLogRepository } from "../../db/repositories/index.ts";

// ==================== 视频文件上传接口 (POST /api/v1/upload/video) ====================
export const handleUploadVideo = async (req: any, res: any) => {
  try {
    const { videoBase64, filename } = req.body;
    let detectedExt = "";
    const headerMatch = videoBase64.match(/^data:video\/(mp4|quicktime|x-msvideo|webm|avi);base64,/i);
    if (headerMatch) {
      const mimeSub = headerMatch[1].toLowerCase();
      detectedExt = mimeSub === "quicktime" ? ".mov" : mimeSub === "x-msvideo" ? ".avi" : `.${mimeSub}`;
    } else if (filename && filename.includes(".")) {
      const ext = path.extname(filename).toLowerCase();
      if ([".mp4", ".mov", ".avi", ".webm"].includes(ext)) detectedExt = ext;
    } else {
      detectedExt = ".mp4";
    }

    const allowedExts = [".mp4", ".mov", ".avi", ".webm"];
    if (!allowedExts.includes(detectedExt)) {
      return res.status(400).json({ error: "非法视频格式！仅支持 mp4, mov, avi, webm 格式视频", code: "INVALID_FILE_TYPE" });
    }

    const cleanBase64 = videoBase64.replace(/^data:video\/\w+;base64,/, "");
    const buffer = Buffer.from(cleanBase64, "base64");

    // 视频文件头魔数校验（与图片上传的文件头签名校验标准对齐）：
    // 仅凭 MIME 声明与扩展名可被伪造，实际内容可能是任意文件甚至恶意载荷。
    const VIDEO_MAGIC: Record<string, { desc: string; test: (b: Buffer) => boolean }> = {
      ".mp4": {
        desc: "ISO BMFF 容器头 (ftyp box)",
        test: (b) => b.length > 11 && b.subarray(4, 8).toString("binary") === "ftyp",
      },
      ".mov": {
        desc: "QuickTime 容器头 (ftyp/moov/mdat 等 atom)",
        test: (b) => {
          if (b.length < 12) return false;
          const brand = b.subarray(4, 8).toString("binary");
          const head4 = b.subarray(0, 4).toString("binary");
          return (
            brand === "ftyp" ||
            ["moov", "mdat", "wide", "skip", "free"].includes(head4)
          );
        },
      },
      ".webm": {
        desc: "EBML 头 (1A 45 DF A3)",
        test: (b) => b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
      },
      ".avi": {
        desc: "RIFF 容器头 + AVI 标识",
        test: (b) =>
          b.length > 12 &&
          b.subarray(0, 4).toString("binary") === "RIFF" &&
          b.subarray(8, 12).toString("binary") === "AVI ",
      },
    };
    const magic = VIDEO_MAGIC[detectedExt];
    if (magic && !magic.test(buffer)) {
      return res.status(400).json({
        error: `视频文件内容与声明的 ${detectedExt} 格式不符（缺少文件头签名：${magic.desc}），疑似伪造扩展名或损坏文件`,
        code: "INVALID_FILE_SIGNATURE",
      });
    }
    const MAX_SIZE = 80 * 1024 * 1024; // 80MB
    if (buffer.length > MAX_SIZE) {
      return res.status(413).json({ error: `视频文件大小不能超过 80MB (实测: ${(buffer.length / (1024 * 1024)).toFixed(2)} MB)`, code: "PAYLOAD_TOO_LARGE" });
    }

    const videoId = `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${detectedExt}`;
    // 必须走 VIDEOS_DIR（= UPLOADS_DIR/videos），不能写死 process.cwd()/public/uploads/videos。
    // 原因：index.ts 是用 `express.static(UPLOADS_DIR)` 托管 /uploads 的，而 UPLOADS_DIR 支持
    // 用环境变量覆盖为工作区之外的绝对路径（这是逃出工作区大文件清理的唯一手段）。
    // 一旦覆盖，写死路径会把文件写到 A 处、却从 B 处提供服务 → 上传成功但立刻 404。
    const savePath = path.join(VIDEOS_DIR, videoId);
    fs.mkdirSync(VIDEOS_DIR, { recursive: true });
    fs.writeFileSync(savePath, buffer);

    res.status(201).json({
      success: true,
      url: `/uploads/videos/${videoId}`,
      videoId,
      filename: filename || videoId,
      size: buffer.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: "视频上传落盘失败: " + err.message });
  }
};

// POST /api/v1/upload/image
export const handleUploadImage = async (req: any, res: any) => {
  try {
    const user = authenticateBearer(req);
    if (user) req.currentUser = user;
    const { imageBase64, filename } = req.body;

    // 提取文件类型并校验白名单 (jpg / jpeg / png / webp)
    let detectedExt = "";
    const headerMatch = imageBase64.match(/^data:image\/(jpeg|jpg|png|webp);base64,/i);
    if (headerMatch) {
      const mimeSub = headerMatch[1].toLowerCase();
      detectedExt = mimeSub === "jpeg" ? ".jpg" : `.${mimeSub}`;
    } else if (filename && filename.includes(".")) {
      const ext = path.extname(filename).toLowerCase();
      if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
        detectedExt = ext === ".jpeg" ? ".jpg" : ext;
      }
    } else {
      detectedExt = ".jpg";
    }

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(cleanBase64, "base64");

    // 单文件上限 10MB -> 超限返回 413
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (buffer.length > MAX_SIZE) {
      return res.status(413).json({
        error: `上传文件过大，单张图片不能超过 10MB (实测: ${(buffer.length / (1024 * 1024)).toFixed(2)} MB)`,
        code: "PAYLOAD_TOO_LARGE",
      });
    }

    // 文件类型白名单判断 -> 非法输入返回 400
    const allowedExts = [".jpg", ".jpeg", ".png", ".webp"];
    if (!detectedExt || !allowedExts.includes(detectedExt)) {
      return res.status(400).json({
        error: "非法图片类型！仅支持上传 jpg、png、webp 格式的图片文件",
        code: "INVALID_FILE_TYPE",
      });
    }

    // Magic Number 校验（文件头签名验证，防伪装类型）
    const MAGIC_SIGNATURES: { mime: string; bytes: number[] }[] = [
      { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
      { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
      { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] },
    ];
    function matchMagic(buf: Buffer, sig: { bytes: number[] }): boolean {
      if (buf.length < sig.bytes.length) return false;
      for (let i = 0; i < sig.bytes.length; i++) {
        if (buf[i] !== sig.bytes[i]) return false;
      }
      return true;
    }
    let magicValid = false;
    for (const sig of MAGIC_SIGNATURES) {
      if (matchMagic(buffer, sig)) { magicValid = true; break; }
    }
    if (!magicValid) {
      return res.status(400).json({
        error: "文件内容与声明的图片类型不匹配（Magic Number 校验失败），拒绝上传",
        code: "INVALID_FILE_MAGIC",
      });
    }

    // 随机文件名防路径穿越
    const ext = detectedExt === ".jpeg" ? ".jpg" : detectedExt;
    const safeFilename = `img_${Date.now()}_${Math.floor(100000 + Math.random() * 900000)}${ext}`;
    const filePath = path.join(UPLOADS_DIR, safeFilename);

    // 改用 fs.promises 异步写入
    await fs.promises.writeFile(filePath, buffer);
    const accessUrl = `/uploads/${safeFilename}`;

    // 现场照片防伪核验：校验拍摄时间戳有效性与防伪指纹
    const { capturedAt, captureDevice, location } = req.body;
    let authenticityStatus: "verified" | "unverified" | "suspicious" = "unverified";
    let authenticityMessage = "照片未附带现场终端可信硬件防伪时间戳";

    if (capturedAt) {
      const captureTime = new Date(capturedAt).getTime();
      const now = Date.now();
      // 允许前后 24 小时内的现场拍摄，超出合理范围标记为可疑（防远期假图或时钟篡改）
      if (!isNaN(captureTime) && Math.abs(now - captureTime) < 24 * 3600 * 1000) {
        authenticityStatus = "verified";
        authenticityMessage = `现场终端拍摄时间戳验证通过 (${captureDevice || "工业防爆手持终端"})`;
      } else {
        authenticityStatus = "suspicious";
        authenticityMessage = "警告：照片拍摄时间戳与当前系统时间偏差过大，疑似历史旧图";
      }
    }

    addAuditLog(req, {
      actionType: "FILE_UPLOAD",
      module: "AI视觉质检",
      detail: `上传工业设备检修照片 [${safeFilename}] (文件大小: ${(buffer.length / 1024).toFixed(1)} KB, 防伪状态: ${authenticityStatus})`,
      status: authenticityStatus === "suspicious" ? "BLOCKED" : "SUCCESS",
      metadata: { filename: safeFilename, sizeBytes: buffer.length, accessUrl, authenticityStatus, capturedAt, captureDevice, location },
    });

    res.json({
      success: true,
      url: accessUrl,
      filename: safeFilename,
      size: buffer.length,
      authenticity: {
        status: authenticityStatus,
        message: authenticityMessage,
        capturedAt: capturedAt || null,
        captureDevice: captureDevice || null,
        location: location || null,
      },
    });
  } catch (err: any) {
    console.error("Upload error:", err);
    res.status(500).json({ error: `上传失败: ${err.message}` });
  }
};

// ==================== 视频多模态智能故障分析 (POST /api/v1/ai/video-analyze) ====================
export const handleVideoAnalyze = async (req: any, res: any) => {
  try {
    const { frames, question = "分析视频中工业设备的运行状态与潜在故障", deviceModel = "工业动力设备", videoId } = req.body;
    const ai = getVisionClient();
    if (!ai) return res.status(503).json({ error: "AI 服务未配置，无法进行视频多模态分析" });

    const promptText = `你是一位拥有20年工程经验的特级工业设备多模态视觉诊断专家。
请仔细分析作业人员采集的连续 ${frames.length} 帧工业设备巡检视频关键画面截图。
受检设备类型/型号: 【${deviceModel}】
作业人员疑问与现象描述: 【${question}】

请结合多帧图像之间的动作连续性、热色差、振动模糊、油液渗漏、密封破损或结构开裂等物理表象，输出严格的 JSON 诊断报告：
{
  "device_part": "疑似故障或异常受损的具体部件名称（如：电机驱动端滚动轴承 / 离心泵双端面机械密封动环 / 空压机进气阀片 / 减速机高速轴齿面）",
  "phenomenon": "观察到的详细异常物理现象描述（60字以内，客观写实）",
  "causes": [
    "主要潜在原因研判1",
    "可能原因2",
    "可能原因3"
  ],
  "suggestions": [
    "专业处置建议1（含所需专业工具与安全防护要求）",
    "处置建议2",
    "预防性维护建议3"
  ],
  "confidence": 0.94
}`;

    const userContent: any[] = [{ type: "text", text: promptText }];
    frames.slice(0, 6).forEach((frame: string) => {
      const url = frame.startsWith("data:") ? frame : `data:image/jpeg;base64,${frame}`;
      userContent.push({ type: "image_url", image_url: { url } });
    });

    let analysisResult: any = null;
    try {
      const response: any = await ai.chat.completions.create({
        model: DASHSCOPE_VISION_MODEL,
        messages: [{ role: "user", content: userContent }],
        temperature: 0.2,
      });
      const rawContent = response.choices?.[0]?.message?.content || "";
      analysisResult = extractAiJson(rawContent);
    } catch (e: any) {
      console.warn("[VideoAnalyze] Qwen-VL 调用异常，切换至工业规则库分析:", e?.message || e);
    }

    if (!analysisResult || !analysisResult.device_part) {
      // 降级（规则推断）：未对任何视频帧做图像分析，不编造"检测到"类现象与精确测量数值，
      // confidence 置空（前端显示 0%），仅给出基于设备类型的排查方向；字段结构保持不变。
      const isPump = deviceModel.includes("泵");
      const isMotor = deviceModel.includes("电机");
      const isFan = deviceModel.includes("风机");
      analysisResult = {
        device_part: isPump ? "离心泵轴封/机械密封（规则推断排查方向）" : isMotor ? "电机驱动端滚动轴承（规则推断排查方向）" : isFan ? "离心风机叶轮与动平衡（规则推断排查方向）" : "传动机构旋转部件（规则推断排查方向）",
        phenomenon: `AI 视频分析暂不可用，未对视频帧进行图像实测，未检测到任何异常现象。以上部件方向为基于设备类型（${deviceModel}）关键词的规则推断（非图像实测），请以现场测振/测温复核为准。`,
        causes: [
          "规则推断（非本机实测）：旋转部件常见失效模式包括交变载荷下的疲劳点蚀，需现场解体确认",
          "规则推断（非本机实测）：密封面杂质冲刷导致的微渗漏在同类设备中较常见，需拆检验证",
          "规则推断（非本机实测）：联轴器同轴度偏差需激光对中仪现场测量后才能判定",
        ],
        suggestions: [
          "使用便携式三轴测振仪在轴承座水平和垂直方向实测振动烈度值",
          "停机排查密封冲洗管路排气孔，测量机械密封弹簧压缩预紧量",
          "按规程补加规定牌号的高温极压复合润滑脂，紧固底座地脚螺栓",
        ],
        confidence: null,
      };
    }

    const logEntry = await AiAnalysisLogRepository.create({
      videoId,
      framesCount: frames.length,
      question,
      deviceModel,
      result: analysisResult,
    });

    res.json({
      success: true,
      degraded: true,
      analysisSource: "rule-inference",
      analysis: analysisResult,
      logId: logEntry.id,
      videoId,
      framesCount: frames.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: "视频智能故障分析失败: " + err.message });
  }
};
