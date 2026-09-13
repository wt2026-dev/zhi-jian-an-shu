/**
 * 知识库混合检索（向量 RAG + 关键词 RRF 融合）回归测试。
 * 覆盖：向量路生效 / embedding 降级回退关键词路径（与旧行为一致）/
 * approved 合规过滤不回归 / 向量存储 upsert+search 往返正确性。
 * 全部使用注入的确定性假向量，禁止真实调用外部 API。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";
import { findRelevantKnowledge } from "../src/server/services/knowledgeRetrieval.ts";
import {
  __setEmbedOverrideForTests,
  EMBEDDING_DIMENSIONS,
} from "../src/server/services/embeddingService.ts";
import {
  getVectorStoreMode,
  searchSimilar,
  upsertEmbedding,
} from "../src/db/vectorStore.ts";
import { KnowledgeRepository } from "../src/db/repositories/index.ts";

let app: any;

// 确定性向量：query 向量固定为第 0 维单位向量
const QUERY_VEC = unitVector(0);
// 与 query 正交的干扰向量（余弦相似度 0）
const ORTHO_VEC = unitVector(1);

function unitVector(activeIndex: number): number[] {
  const v = new Array(EMBEDDING_DIMENSIONS).fill(0);
  v[activeIndex] = 1;
  return v;
}

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();
  // 冒烟：API 层正常（登录可用）
  const login = await request(app).post("/api/v1/auth/login").send({ username: "admin", password: "password123" });
  expect(login.status).toBe(200);
});

afterAll(() => {
  __setEmbedOverrideForTests(null);
});

beforeEach(() => {
  __setEmbedOverrideForTests(null);
});

describe("知识库混合检索", () => {
  it("向量库就绪且默认运行在 JSONB 模式（PGlite 0.5.x 无 pgvector，实现 B）", async () => {
    const mode = await getVectorStoreMode();
    expect(["jsonb", "pgvector"]).toContain(mode);
    expect(mode).toBe("jsonb");
  });

  it("有 embedding 时向量路生效：关键词零命中也能语义召回", async () => {
    // 为种子文章 kb-101（离心泵轴承/机械密封 SOP）写入与 query 同向的向量
    await upsertEmbedding("kb-101", QUERY_VEC, "test-model");
    // 其余种子文章写正交向量（相似度 0，被过滤）
    for (const id of ["kb-102", "kb-111"]) {
      await upsertEmbedding(id, ORTHO_VEC, "test-model").catch(() => {});
    }
    // 查询关键词刻意避开所有标题/标签子串（无关键词命中）
    __setEmbedOverrideForTests(async () => QUERY_VEC);
    const results = await findRelevantKnowledge(["量子纠缠态"], 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe("kb-101");
  });

  it("embedding 降级（返回 null）时回退关键词路径，行为与旧版一致", async () => {
    __setEmbedOverrideForTests(async () => null);
    // 关键词命中：kb-102 标题含"螺杆空压机"
    const hit = await findRelevantKnowledge(["螺杆空压机"], 5);
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.some((k: any) => String(k.title).includes("螺杆空压机"))).toBe(true);
    expect(hit.every((k: any) => k.status === "approved" || k.status === undefined)).toBe(true);

    // 关键词零命中且无向量 → 返回空数组（与旧版一致）
    const miss = await findRelevantKnowledge(["量子纠缠态"], 5);
    expect(miss).toEqual([]);
  });

  it("合规约束：向量候选也只返回 approved 文章，pending 不可经语义召回", async () => {
    // 创建一篇 pending 文章并写入与 query 同向的向量
    const pending = await KnowledgeRepository.create({
      id: `kb-pending-${Date.now()}`,
      title: "待审核：液压站蓄能器氮气充装规程",
      category: "检修SOP规程",
      content: "蓄能器氮气充装压力与安全操作规程正文。",
      summary: "pending 状态的液压蓄能器规程",
      status: "pending",
    });
    expect(pending).toBeTruthy();
    await upsertEmbedding(pending!.id, QUERY_VEC, "test-model");

    __setEmbedOverrideForTests(async () => QUERY_VEC);
    const results = await findRelevantKnowledge(["量子纠缠态"], 10);
    expect(results.some((k: any) => k.id === pending!.id)).toBe(false);
    // 同向的 approved 文章仍可召回
    expect(results.some((k: any) => k.id === "kb-101")).toBe(true);
  });

  it("向量存储 upsert + search 往返正确性：ON CONFLICT 覆盖、分数域与排序", async () => {
    // 覆盖写：kb-102 的向量从 ORTHO 改为与 query 同向
    await upsertEmbedding("kb-102", ORTHO_VEC, "test-model");
    const before = await searchSimilar(QUERY_VEC, 20);
    expect(before.find((x) => x.articleId === "kb-102")).toBeUndefined(); // 正交向量 score=0 被过滤

    await upsertEmbedding("kb-102", QUERY_VEC, "test-model");
    const after = await searchSimilar(QUERY_VEC, 20);
    const hit = after.find((x) => x.articleId === "kb-102");
    expect(hit).toBeTruthy();
    expect(hit!.score).toBeGreaterThan(0.99); // 同向单位向量余弦相似度 ≈ 1
    expect(hit!.score).toBeLessThanOrEqual(1);

    // 排序：分数降序
    const scores = after.map((x) => x.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);

    // limit 生效
    const limited = await searchSimilar(QUERY_VEC, 1);
    expect(limited.length).toBeLessThanOrEqual(1);
  });
});
