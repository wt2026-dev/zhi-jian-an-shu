import { getDb } from "../db.ts";
import { parseJson } from "./shared.ts";

// ==================== 多模型路由配置仓储（ai_model_configs） ====================

export const AiModelConfigRepository = {
  mapRow(r: any) {
    return {
      id: r.id,
      provider: r.provider,
      displayName: r.display_name,
      baseUrl: r.base_url,
      hasEncryptedKey: !!r.api_key_encrypted,
      encrypted: r.api_key_encrypted,
      apiKeyEnv: r.api_key_env,
      modelName: r.model_name,
      capabilities: parseJson(r.capabilities, [] as string[]),
      priority: r.priority,
      enabled: r.enabled,
      healthStatus: r.health_status,
      lastCheckedAt: r.last_checked_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  },

  async count(): Promise<number> {
    const db = await getDb();
    const { rows } = await db.query(`SELECT COUNT(*)::int AS c FROM ai_model_configs;`);
    return Number(rows[0]?.c || 0);
  },

  async getAll() {
    const db = await getDb();
    const { rows } = await db.query(`SELECT * FROM ai_model_configs ORDER BY priority ASC, created_at ASC;`);
    return rows.map((r) => this.mapRow(r));
  },

  async getEnabled() {
    const db = await getDb();
    const { rows } = await db.query(`SELECT * FROM ai_model_configs WHERE enabled = TRUE ORDER BY priority ASC, created_at ASC;`);
    return rows.map((r) => this.mapRow(r));
  },

  async getById(id: string) {
    const db = await getDb();
    const { rows } = await db.query(`SELECT * FROM ai_model_configs WHERE id = $1;`, [id]);
    return rows.length ? this.mapRow(rows[0]) : null;
  },

  async insert(config: {
    id: string;
    provider: string;
    displayName: string;
    baseUrl: string;
    apiKeyEncrypted?: string | null;
    apiKeyEnv?: string | null;
    modelName: string;
    capabilities: string[];
    priority: number;
    enabled: boolean;
  }) {
    const db = await getDb();
    await db.query(
      `INSERT INTO ai_model_configs
         (id, provider, display_name, base_url, api_key_encrypted, api_key_env, model_name, capabilities, priority, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id;`,
      [
        config.id,
        config.provider,
        config.displayName,
        config.baseUrl,
        config.apiKeyEncrypted || null,
        config.apiKeyEnv || null,
        config.modelName,
        JSON.stringify(config.capabilities),
        config.priority,
        config.enabled,
      ]
    );
    return this.getById(config.id);
  },

  async update(id: string, patch: {
    displayName?: string;
    baseUrl?: string;
    apiKeyEncrypted?: string | null;
    apiKeyEnv?: string | null;
    modelName?: string;
    capabilities?: string[];
    enabled?: boolean;
  }) {
    const db = await getDb();
    const { rows } = await db.query(
      `UPDATE ai_model_configs SET
         display_name = COALESCE($2, display_name),
         base_url = COALESCE($3, base_url),
         api_key_encrypted = COALESCE($4, api_key_encrypted),
         api_key_env = COALESCE($5, api_key_env),
         model_name = COALESCE($6, model_name),
         capabilities = COALESCE($7, capabilities),
         enabled = COALESCE($8, enabled),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id;`,
      [
        id,
        patch.displayName ?? null,
        patch.baseUrl ?? null,
        patch.apiKeyEncrypted ?? null,
        patch.apiKeyEnv ?? null,
        patch.modelName ?? null,
        patch.capabilities ? JSON.stringify(patch.capabilities) : null,
        patch.enabled ?? null,
      ]
    );
    if (!rows.length) return null;
    return this.getById(id);
  },

  /** 更新健康状态（路由器降级/成功后异步调用） */
  async updateHealth(id: string, status: "healthy" | "unhealthy") {
    const db = await getDb();
    await db.query(
      `UPDATE ai_model_configs SET health_status = $2, last_checked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1;`,
      [id, status]
    );
  },

  /** 按给定顺序重排优先级（index*10） */
  async updatePriorities(orderedIds: string[]) {
    const db = await getDb();
    for (let i = 0; i < orderedIds.length; i++) {
      await db.query(`UPDATE ai_model_configs SET priority = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1;`, [
        orderedIds[i],
        (i + 1) * 10,
      ]);
    }
    return this.getAll();
  },
};
