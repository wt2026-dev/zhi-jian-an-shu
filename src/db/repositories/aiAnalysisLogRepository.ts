import { getDb } from "../db.ts";
import { parseJson } from "./shared.ts";

export const AiAnalysisLogRepository = {
  mapRow(r: any) {
    return {
      id: r.id,
      videoId: r.video_id,
      framesCount: r.frames_count,
      question: r.question,
      deviceModel: r.device_model,
      result: parseJson(r.result, {}),
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
};
