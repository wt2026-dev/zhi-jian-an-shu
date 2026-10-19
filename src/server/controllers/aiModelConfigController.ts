// 重构说明：AI 模型路由管理端控制器——列表（密钥掩码）/新增更新/连接测试/重排序。
import { addAuditLog } from "../services/auditService.ts";
import { AiModelConfigRepository } from "../../db/repositories/index.ts";
import { pickFirstChatHop } from "../services/aiClient.ts";
import {
  maskApiKey,
  encryptApiKey,
  decryptApiKey,
  invalidateModelConfigCache,
  resolveCandidates,
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

/**
 * GET /api/v1/ai/engine —— 任何登录角色可读的「当前应答引擎」只读投影。
 * 存在的理由：/admin/ai-models 是 admin 专属，非管理员页面拿不到引擎真名，
 * 只能显示「未探测」；这里只投影展示字段，密钥一律不出库、不出接口。
 */
export const handleGetChatEngineStatus = async (_req: any, res: any) => {
  try {
    const candidates = await resolveCandidates();
    const primary = pickFirstChatHop(candidates);
    const chatCandidates = candidates.filter((c) => (c.capabilities || []).includes("chat"));
    if (!primary) {
      // 读不到候选就如实说没配置，不给一个"看起来在线"的默认值
      return res.json({
        configured: false,
        displayName: null,
        modelName: null,
        provider: null,
        healthStatus: null,
        chatCandidateCount: 0,
      });
    }
    let healthStatus: string | null = null;
    if (primary.configId) {
      const row: any = await AiModelConfigRepository.getById(primary.configId);
      healthStatus = row?.healthStatus ?? null;
    }
    res.json({
      configured: true,
      displayName: primary.displayName || primary.modelName,
      modelName: primary.modelName,
      provider: primary.provider,
      healthStatus,
      chatCandidateCount: chatCandidates.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: "获取当前应答引擎失败", message: err?.message || String(err) });
  }
};

// POST /api/v1/admin/ai-models  (携带 id 为更新，否则新增)
export const handleUpsertAiModel = async (req: any, res: any) => {
  try {
    const { id, apiKey, apiKeyEnv, capabilities, priority, enabled } = req.body;
    // 入参净化：NFC 规范化 + trim，防止异常编码字符或空白入库产生乱码
    const nfcTrim = (v: any) => (typeof v === "string" ? v.normalize("NFC").trim() : v);
    const provider = nfcTrim(req.body.provider);
    const displayName = nfcTrim(req.body.displayName);
    const modelName = nfcTrim(req.body.modelName);
    const baseUrl = nfcTrim(req.body.baseUrl);
    if (!provider || !displayName || !modelName) {
      return res.status(400).json({ error: "provider / displayName / modelName 必填", code: "INVALID_INPUT" });
    }
    if (String(displayName).length > 128 || String(modelName).length > 128 || String(provider).length > 64) {
      return res.status(400).json({ error: "provider / displayName / modelName 超过长度限制（64/128/128）", code: "INVALID_INPUT" });
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
