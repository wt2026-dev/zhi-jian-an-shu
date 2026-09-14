import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";
import { AiGenerationReviewRepository } from "../src/db/repositories/index.ts";

let app: any;
let token: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();

  const loginRes = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: "admin", password: "Admin@2026#Demo" });
  token = loginRes.body.token;
});

describe("8. AI 生成内容审核台测试 (AI Review Suite)", () => {
  it("未登录访问审核列表应返回 401", async () => {
    const res = await request(app).get("/api/v1/admin/ai-reviews");
    expect(res.status).toBe(401);
  });

  it("列表接口：按状态过滤 pending，且返回知识库溯源结构", async () => {
    // 造一条待审核记录（含知识库引用）
    await AiGenerationReviewRepository.create({
      id: `airev-test-${Date.now()}`,
      aiEndpoint: "/api/v1/ai/generate-maintenance-plan",
      sourceType: "maintenance_plan",
      contentJson: { overview: "测试方案概述", steps: [{ step: 1, operation: "LOTO 停电挂牌", qualityStandard: "验电确认" }] },
      knowledgeSources: ["kb-101"],
    });

    const res = await request(app)
      .get("/api/v1/admin/ai-reviews?status=pending")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const mine = res.body.find((r: any) => r.sourceType === "maintenance_plan");
    expect(mine).toBeTruthy();
    expect(mine.status).toBe("pending");
    expect(mine.sourceTypeLabel).toBe("检修方案");
    expect(Array.isArray(mine.knowledgeSources)).toBe(true);
  });

  it("审核通过：pending → approved，写入审核人与审计日志", async () => {
    const created = await AiGenerationReviewRepository.create({
      id: `airev-test-ap-${Date.now()}`,
      aiEndpoint: "/api/v1/ai/safety-risk-assessment",
      sourceType: "safety_risk",
      contentJson: { riskLevel: "高", riskReason: "测试" },
      knowledgeSources: [],
    });

    const res = await request(app)
      .post(`/api/v1/admin/ai-reviews/${created.id}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ review_note: "方案可行，同意使用" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.review.status).toBe("approved");
    expect(res.body.review.reviewer).toBeTruthy();

    // 重复审核应返回 404（仅 pending 可审核）
    const again = await request(app)
      .post(`/api/v1/admin/ai-reviews/${created.id}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(again.status).toBe(404);
  });

  it("审核驳回：缺少原因应返回 400，填写原因后 status → rejected", async () => {
    const created = await AiGenerationReviewRepository.create({
      id: `airev-test-rj-${Date.now()}`,
      aiEndpoint: "/api/v1/ai/generate-report",
      sourceType: "report",
      contentJson: { summary: "测试报告摘要" },
      knowledgeSources: [],
    });

    const noNote = await request(app)
      .post(`/api/v1/admin/ai-reviews/${created.id}/reject`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(noNote.status).toBe(400);

    const res = await request(app)
      .post(`/api/v1/admin/ai-reviews/${created.id}/reject`)
      .set("Authorization", `Bearer ${token}`)
      .send({ review_note: "数据口径与实际不符，退回重写" });
    expect(res.status).toBe(200);
    expect(res.body.review.status).toBe("rejected");
    expect(res.body.review.reviewNote).toBe("数据口径与实际不符，退回重写");
  });

  it("审核不存在的记录应返回 404", async () => {
    const res = await request(app)
      .post("/api/v1/admin/ai-reviews/airev-not-exist/approve")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(404);
  });
});
