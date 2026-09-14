/**
 * 知识库列表数据源一致性回归测试。
 * 修复前：GET /api/v1/knowledge 读模块级内存数组（仅 2 篇硬编码种子），
 * 与 RAG 检索（KnowledgeRepository, status=approved）口径割裂，重启后新建文章从列表消失。
 * 验收标准：
 *  1. 列表条目 = 数据库 knowledge_articles 表（status=approved）；
 *  2. 新建文章落库后即进列表（无内存双轨）；
 *  3. category / search 过滤不回归。
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";
import { KnowledgeRepository } from "../src/db/repositories/index.ts";

let app: any;
let adminToken = "";

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();
  adminToken = (await request(app).post("/api/v1/auth/login").send({ username: "admin", password: "password123" })).body.token;
  expect(adminToken).toBeTruthy();
});

describe("知识库列表与检索数据一致性 (Knowledge List Consistency)", () => {
  it("列表条目数与数据库 knowledge_articles（status=approved）完全一致，且不少于种子文章数", async () => {
    const listRes = await request(app).get("/api/v1/knowledge").set("Authorization", `Bearer ${adminToken}`);
    expect(listRes.status).toBe(200);

    const dbApproved = await KnowledgeRepository.getAll({ status: "approved" });
    expect(listRes.body.length).toBe(dbApproved.length);
    // 种子导入 14 篇 approved 文章——修复前列表只有 2 篇硬编码
    expect(listRes.body.length).toBeGreaterThanOrEqual(14);
    expect(listRes.body.some((a: any) => a.id === "kb-101")).toBe(true);
    expect(listRes.body.some((a: any) => a.id === "kb-102")).toBe(true);
  });

  it("直接落库的新文章立即可见于列表（消除重启后消失的双轨问题）", async () => {
    const id = `kb-test-${Date.now()}`;
    await KnowledgeRepository.create({
      id,
      title: "测试新增：液压站油温过高处置",
      category: "检修SOP规程",
      content: "液压站油温过高时先检查冷却器水路，再排查溢流阀设定压力。",
      summary: "液压站油温过高处置测试文章",
      status: "approved",
    });

    const listRes = await request(app).get("/api/v1/knowledge").set("Authorization", `Bearer ${adminToken}`);
    const found = listRes.body.find((a: any) => a.id === id);
    expect(found).toBeTruthy();
    expect(found.title).toContain("液压站油温过高");

    const dbApproved = await KnowledgeRepository.getAll({ status: "approved" });
    expect(listRes.body.length).toBe(dbApproved.length);
  });

  it("category 筛选不回归：仅返回该分类文章", async () => {
    const allRes = await request(app).get("/api/v1/knowledge").set("Authorization", `Bearer ${adminToken}`);
    const someCategory = allRes.body.find((a: any) => a.category)?.category;
    expect(someCategory).toBeTruthy();

    const filtered = await request(app)
      .get(`/api/v1/knowledge?category=${encodeURIComponent(someCategory)}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.length).toBeGreaterThan(0);
    expect(filtered.body.every((a: any) => a.category === someCategory)).toBe(true);
  });

  it("关键词搜索不回归：按标题关键词过滤", async () => {
    const res = await request(app)
      .get("/api/v1/knowledge?search=" + encodeURIComponent("螺杆空压机"))
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.some((a: any) => String(a.title).includes("螺杆空压机"))).toBe(true);
  });

  it("列表口径与 RAG 检索同源：pending 文章既不进列表也不可被检索", async () => {
    const pendingId = `kb-pending-${Date.now()}`;
    await KnowledgeRepository.create({
      id: pendingId,
      title: "待审核文章不应出现在列表",
      category: "检修SOP规程",
      content: "pending 状态内容",
      summary: "pending 状态",
      status: "pending",
    });

    const listRes = await request(app).get("/api/v1/knowledge").set("Authorization", `Bearer ${adminToken}`);
    expect(listRes.body.some((a: any) => a.id === pendingId)).toBe(false);

    const reviewList = await request(app)
      .get("/api/v1/knowledge/review/list")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(reviewList.status).toBe(200);
    expect(reviewList.body.some((a: any) => a.id === pendingId)).toBe(true);
  });
});
