import { getDb } from "../db.ts";
import { parseJson } from "./shared.ts";

export interface AiTraceLogRecord {
  id: string;
  videoId?: string | null;
  framesCount?: number;
  question: string;
  deviceModel: string;
  model: string;
  promptVersion: string;
  inputDigest: string;
  reviewStatus: string;
  safetyNotice?: any;
  result: any;
  createdAt: string;
}

export const AiAnalysisLogRepository = {
  mapRow(r: any): AiTraceLogRecord {
    const res: any = parseJson(r.result, {});
    const trace: any = res?.traceability || {};
    return {
      id: r.id,
      videoId: r.video_id,
      framesCount: r.frames_count,
      question: r.question,
      deviceModel: r.device_model,
      // 历史记录或未填字段回退为 'legacy'
      model: trace.model || res.model || "legacy",
      promptVersion: trace.promptVersion || "legacy",
      inputDigest: trace.inputDigest || r.question || "legacy",
      reviewStatus: trace.reviewStatus || "legacy",
      safetyNotice: res?.safetyNotice || undefined,
      result: res,
      createdAt: r.created_at,
    };
  },

  async create(item: {
    id?: string;
    videoId?: string;
    framesCount?: number;
    question?: string;
    deviceModel?: string;
    result: any;
  }) {
    const db = await getDb();
    const id = item.id || `video-log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await db.query(
      `INSERT INTO ai_analysis_log (id, video_id, frames_count, question, device_model, result, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP);`,
      [
        id,
        item.videoId || null,
        item.framesCount || 0,
        item.question || "",
        item.deviceModel || "",
        JSON.stringify(item.result || {}),
      ]
    );
    const { rows } = await db.query(`SELECT * FROM ai_analysis_log WHERE id = $1 LIMIT 1;`, [id]);
    return this.mapRow(rows[0]);
  },

  /** 记录 AI 调用（包含模型版本、提示词版本、输入摘要与审核状态） */
  async recordAiCall(params: {
    endpoint: string;
    model: string;
    promptVersion: string;
    inputDigest: string;
    deviceModel?: string;
    question?: string;
    reviewStatus?: "pending" | "approved" | "rejected" | "not_required";
    safetyNotice?: any;
    body: any;
  }) {
    const {
      endpoint,
      model,
      promptVersion,
      inputDigest,
      deviceModel = "工业设备",
      question = inputDigest,
      reviewStatus = "not_required",
      safetyNotice,
      body,
    } = params;

    const payload = {
      endpoint,
      traceability: {
        model,
        promptVersion,
        inputDigest,
        reviewStatus,
      },
      safetyNotice,
      body,
    };

    return this.create({
      id: `ai-trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      deviceModel,
      question,
      result: payload,
    });
  },

  /** 查询 AI 追溯与版本分析日志 */
  async listTraceLogs(filter?: { model?: string; limit?: number }) {
    const db = await getDb();
    const limit = filter?.limit || 50;
    const { rows } = await db.query(
      `SELECT * FROM ai_analysis_log ORDER BY created_at DESC LIMIT $1;`,
      [limit]
    );
    let mapped = rows.map((r: any) => this.mapRow(r));
    if (filter?.model) {
      mapped = mapped.filter((item: AiTraceLogRecord) => item.model === filter.model);
    }
    return mapped;
  },
};

