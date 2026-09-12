// 重构说明：AI 模型路由管理端控制器——列表（密钥掩码）/新增更新/连接测试/重排序。
import { addAuditLog } from "../services/auditService.ts";
import { AiModelConfigRepository } from "../../db/repositories/index.ts";
import {
  maskApiKey,
  encryptApiKey,
  decryptApiKey,
  invalidateModelConfigCache,
  testModelConfig,
  ModelCandidate,
} from "../services/aiModelRouter.ts";

const VALID_CAPABILITIES = ["chat", "vision", "video"];

// GET /api/v1/admin/ai-models
export const handleListAiModels = async (req: any, res: any) => {
  try {
    const configs = await AiModelConfigRepository.getAll();
    res.json(
      configs.map((c: any) => ({
        id: c.id,
        provider: c.provider,
        displayName: c.displayName,
        baseUrl: c.baseUrl,
        apiKeyMasked: maskApiKey(c),
        modelName: c.modelName,
        capabilities: c.capabilities,
        priority: c.priority,
        enabled: c.enabled,
        healthStatus: c.healthStatus,
        lastCheckedAt: c.lastCheckedAt,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }))
    );
  } catch (err: any) {
    res.status(500).json({ error: "获取模型配置列表失败", message: err.message });
  }
};

// POST /api/v1/admin/ai-models  (携带 id 为更新，否则新增)
export const handleUpsertAiModel = async (req: any, res: any) => {
  try {
    const { id, provider, displayName, baseUrl, apiKey, apiKeyEnv, modelName, capabilities, priority, enabled } = req.body;
    if (!provider || !displayName || !modelName) {
      return res.status(400).json({ error: "provider / displayName / modelName 必填", code: "INVALID_INPUT" });
    }
    const caps = Array.isArray(capabilities) ? capabilities.filter((c: string) => VALID_CAPABILITIES.includes(c)) : [];
    if (!caps.length) {
      return res.status(400).json({ error: "capabilities 至少包含 chat/vision/video 之一", code: "INVALID_INPUT" });
    }
    if (apiKeyEnv && !apiKeyEnv.endsWith("_KEY") && !apiKeyEnv.endsWith("_SECRET")) {
      return res.status(400).json({ error: "apiKeyEnv 必须是环境变量名（建议以 _KEY / _SECRET 结尾）", code: "INVALID_INPUT" });
    }

    let saved;
    const auditTarget = id ? "更新" : "新增";
    if (id) {
      const patch: any = { displayName, baseUrl: baseUrl || "", modelName, capabilities: caps };
      if (apiKeyEnv !== undefined) patch.apiKeyEnv = apiKeyEnv || null;
      if (apiKey) patch.apiKeyEncrypted = encryptApiKey(apiKey);
      if (enabled !== undefined) patch.enabled = !!enabled;
      saved = await AiModelConfigRepository.update(id, patch);
      if (!saved) return res.status(404).json({ error: "模型配置不存在" });
    } else {
      saved = await AiModelConfigRepository.insert({
        id: `aimc-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
        provider,
        displayName,
        baseUrl: baseUrl || "",
        apiKeyEncrypted: apiKey ? encryptApiKey(apiKey) : null,
        apiKeyEnv: apiKeyEnv || null,
        modelName,
        capabilities: caps,
        priority: Number(priority) || 100,
        enabled: enabled !== false,
      });
    }
    invalidateModelConfigCache();
    addAuditLog(req, {
      actionType: "AI_MODEL_CONFIG_CHANGE",
      module: "ai",
      detail: `${auditTarget}模型配置 ${saved.displayName}(${saved.modelName})`,
      status: "SUCCESS",
      metadata: { configId: saved.id, provider: saved.provider, model: saved.modelName },
    });
    res.status(id ? 200 : 201).json({
      success: true,
      config: { ...saved, apiKeyMasked: maskApiKey(saved), encrypted: undefined, hasEncryptedKey: undefined },
    });
  } catch (err: any) {
    res.status(500).json({ error: "保存模型配置失败", message: err.message });
  }
};

// POST /api/v1/admin/ai-models/:id/test
export const handleTestAiModel = async (req: any, res: any) => {
  try {
    const config = await AiModelConfigRepository.getById(req.params.id);
    if (!config) return res.status(404).json({ error: "模型配置不存在" });
    // 测试连接使用配置自身的密钥（环境变量引用 → 加密密钥），与调用链解析逻辑一致
    const apiKey =
      (config.apiKeyEnv && process.env[config.apiKeyEnv]) ||
      (config.encrypted ? decryptApiKey(config.encrypted) : null);
    if (!apiKey) {
      return res.status(400).json({ error: "该配置未设置可用的 API Key（或引用的环境变量为空）" });
    }
    const target: ModelCandidate = {
      configId: config.id,
      provider: config.provider,
      displayName: config.displayName,
      baseUrl: config.baseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: String(apiKey),
      modelName: config.modelName,
      capabilities: config.capabilities,
    };
    const result = await testModelConfig(target);
    res.json({ success: true, configId: config.id, ...result });
  } catch (err: any) {
    res.status(500).json({ error: "测试连接失败", message: err.message });
  }
};

// POST /api/v1/admin/ai-models/reorder  body: { orderedIds: string[] }
export const handleReorderAiModels = async (req: any, res: any) => {
  try {
    const orderedIds: string[] = req.body?.orderedIds;
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json({ error: "orderedIds 必填（按降级顺序排列的配置 id 数组）", code: "INVALID_INPUT" });
    }
    const updated = await AiModelConfigRepository.updatePriorities(orderedIds);
    invalidateModelConfigCache();
    addAuditLog(req, {
      actionType: "AI_MODEL_CONFIG_CHANGE",
      module: "ai",
      detail: `调整模型降级优先级顺序：${orderedIds.join(" → ")}`,
      status: "SUCCESS",
      metadata: { orderedIds },
    });
    res.json({
      success: true,
      configs: updated.map((c: any) => ({ ...c, apiKeyMasked: maskApiKey(c), encrypted: undefined, hasEncryptedKey: undefined })),
    });
  } catch (err: any) {
    res.status(500).json({ error: "调整优先级失败", message: err.message });
  }
};
