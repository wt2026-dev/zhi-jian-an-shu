import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";
import { AiAnalysisLogRepository } from "../src/db/repositories/index.ts";
import { detectSafetyNotice } from "../src/server/services/promptVersion.ts";

describe("AI 工业级安全边界与全链路追溯测试 (AI Safety Boundary and Traceability)", () => {
  let app: any;
  let adminToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DASHSCOPE_API_KEY = "offline-safety-boundary-fake-key";
    app = await createApp();

    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "admin", password: "password123" });
    adminToken = loginRes.body.token;
    expect(adminToken).toBeTruthy();
  });

  it("1. 高危作业/方案必须触发 safetyNotice 并且 requiresConfirmation 为 true", async () => {
    // 单元逻辑验证：输入/输出包含高危作业关键词（受限空间/LOTO/带电作业）
    const notice = detectSafetyNotice({
      input: { symptoms: "进入受限空间检修搅拌机主轴，存在窒息与机械卷入风险" },
      output: { safetyPrecautions: ["执行 LOTO 能量隔离", "受限空间通风检测"] },
      degraded: false,
    });

    expect(notice.required).toBe(true);
    expect(notice.level).toBe("HIGH");
    expect(notice.requiresConfirmation).toBe(true);
    expect(notice.reason).toContain("需持证人员复核后方可执行");
    expect(notice.riskTypes.length).toBeGreaterThan(0);
  });

  it("2. 负向测试（低风险且未降级时不触发高危安全警示）", async () => {
    const notice = detectSafetyNotice({
      input: { symptoms: "设备外壳表面少量积灰，日常巡检擦拭清洁" },
      output: { summary: "常规表面除尘维护", steps: ["使用干抹布清洁外罩"] },
      degraded: false,
    });

    expect(notice.required).toBe(false);
    expect(notice.level).toBe("NONE");
    expect(notice.requiresConfirmation).toBe(false);
    expect(notice.riskTypes).toEqual([]);
  });

  it("3. 降级兜底强制提示：degraded 为 true 时必须附加 safetyNotice 且指明规则引擎人工判断", async () => {
    const notice = detectSafetyNotice({
      input: { symptoms: "普通清洁" },
      output: {},
      degraded: true,
    });

    expect(notice.required).toBe(true);
    expect(notice.level).toBe("HIGH");
    expect(notice.requiresConfirmation).toBe(true);
    expect(notice.reason).toContain("AI 未生成结果，以下为规则引擎兜底，请人工判断");
    expect(notice.reason).toContain("涉及高危作业需持证人员复核后方可执行");
    expect(notice.degraded).toBe(true);
  });

  it("4. 接口端到端验证：POST /api/v1/ai/diagnose 返回 safetyNotice 与 traceability", async () => {
    const res = await request(app)
      .post("/api/v1/ai/diagnose")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        equipmentName: "加压泵机组",
        category: "泵类设备",
        symptoms: "高压变送器异常且伴随带电作业隐患",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // 验证安全通知字段
    expect(res.body.safetyNotice).toBeDefined();
    expect(res.body.safetyNotice.required).toBe(true);
    expect(res.body.safetyNotice.requiresConfirmation).toBe(true);

    // 验证追溯字段
    expect(res.body.traceability).toBeDefined();
    expect(res.body.traceability.model).toBeTruthy();
    expect(res.body.traceability.promptVersion).toBe("v2.1.0");
    expect(res.body.traceability.inputDigest).toContain("加压泵机组");
  });

  it("5. 接口端到端验证：POST /api/v1/ai/generate-maintenance-plan 写入追溯日志并返回 safetyNotice", async () => {
    const res = await request(app)
      .post("/api/v1/ai/generate-maintenance-plan")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        equipmentId: "eq-101",
        faultDescription: "需动火切割并执行 LOTO 停电挂牌上锁",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.safetyNotice).toBeDefined();
    expect(res.body.safetyNotice.required).toBe(true);
    expect(res.body.traceability).toBeDefined();
    expect(res.body.traceability.promptVersion).toBe("v2.1.0");
  });

  it("6. 审计追溯表持久化与历史兼容回退验证 (ai_analysis_log 记录与 fallback)", async () => {
    // 写入一条历史老数据（不含 traceability，模拟老版本日志）
    const legacyLog = await AiAnalysisLogRepository.create({
      id: `legacy-log-${Date.now()}`,
      question: "老系统历史分析日志",
      deviceModel: "历史离心机",
      result: { summary: "旧分析结果" },
    });

    expect(legacyLog.id).toBeTruthy();
    expect(legacyLog.model).toBe("legacy");
    expect(legacyLog.promptVersion).toBe("legacy");
    expect(legacyLog.reviewStatus).toBe("legacy");

    // 查询管理员追溯接口
    const res = await request(app)
      .get("/api/v1/admin/ai-analysis-logs")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    const targetLegacy = res.body.find((item: any) => item.id === legacyLog.id);
    expect(targetLegacy).toBeTruthy();
    expect(targetLegacy.model).toBe("legacy");
    expect(targetLegacy.promptVersion).toBe("legacy");
  });
});
