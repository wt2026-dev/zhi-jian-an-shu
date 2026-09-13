/**
 * Embedding 服务回归测试。
 * 覆盖：无 Key 优雅降级（null 不抛错）、空串/超长输入保护、维度校验拒绝脏数据、
 * 批量接口的 index 映射与失败置空。全部使用 mock/注入，禁止真实调用外部 API。
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  embed,
  embedBatch,
  isEmbeddingAvailable,
  EMBEDDING_DIMENSIONS,
  __setEmbedOverrideForTests,
  __setClientForTests,
} from "../src/server/services/embeddingService.ts";

const ENV_KEY = process.env.DASHSCOPE_API_KEY;

afterEach(() => {
  __setEmbedOverrideForTests(null);
  __setClientForTests(undefined);
  if (ENV_KEY === undefined) delete process.env.DASHSCOPE_API_KEY;
  else process.env.DASHSCOPE_API_KEY = ENV_KEY;
});

function unitVector(dim: number, activeIndex: number): number[] {
  const v = new Array(dim).fill(0);
  v[activeIndex] = 1;
  return v;
}

function mockOpenAIClient(embeddingByInput?: (input: string[] | string) => number[][], opts?: { fail?: boolean; dim?: number }) {
  return {
    embeddings: {
      create: async ({ input }: any) => {
        if (opts?.fail) throw new Error("simulated network error");
        const inputs = Array.isArray(input) ? input : [input];
        const dim = opts?.dim ?? EMBEDDING_DIMENSIONS;
        const vectors = embeddingByInput
          ? embeddingByInput(inputs)
          : inputs.map((_, i) => unitVector(dim, i % dim));
        return {
          data: vectors.map((embedding, index) => ({ index, embedding })),
        };
      },
    },
  } as any;
}

describe("Embedding 服务", () => {
  it("未配置 DASHSCOPE_API_KEY 时 embed() 返回 null 且不抛错", async () => {
    delete process.env.DASHSCOPE_API_KEY;
    __setClientForTests(undefined); // 强制按环境变量重新惰性初始化
    expect(isEmbeddingAvailable()).toBe(false);
    await expect(embed("离心泵轴承过热")).resolves.toBeNull();
  });

  it("空串/纯空白输入返回 null（不发起任何调用）", async () => {
    __setClientForTests(mockOpenAIClient()); // 即使客户端可用，空输入也应短路
    await expect(embed("")).resolves.toBeNull();
    await expect(embed("   \n\t  ")).resolves.toBeNull();
  });

  it("超长输入被截断至 8000 字符以内", async () => {
    let captured: string[] = [];
    __setClientForTests(
      mockOpenAIClient((inputs) => {
        const arr = Array.isArray(inputs) ? inputs : [inputs];
        captured = arr;
        return arr.map(() => unitVector(EMBEDDING_DIMENSIONS, 0));
      })
    );
    const longText = "轴".repeat(20000);
    const result = await embed(longText);
    expect(result).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(captured[0].length).toBeLessThanOrEqual(8000);
  });

  it("正常路径：注入 mock 后返回 1024 维数值数组", async () => {
    __setClientForTests(mockOpenAIClient());
    const result = await embed("轴承温度异常");
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1024);
    expect(result!.every((x) => typeof x === "number" && Number.isFinite(x))).toBe(true);
  });

  it("维度校验失败（512 维脏数据）被拒绝，返回 null 而非写入", async () => {
    __setClientForTests(mockOpenAIClient(undefined, { dim: 512 }));
    const result = await embed("维度不对的向量");
    expect(result).toBeNull();
  });

  it("客户端调用异常时返回 null（不抛错阻塞）", async () => {
    __setClientForTests(mockOpenAIClient(undefined, { fail: true }));
    await expect(embed("网络故障场景")).resolves.toBeNull();
  });

  it("embedBatch：按 index 正确映射回原下标，空串位保持 null", async () => {
    __setClientForTests(mockOpenAIClient());
    const results = await embedBatch(["第一篇", "", "第二篇"]);
    expect(results).toHaveLength(3);
    expect(results[0]).toHaveLength(1024);
    expect(results[1]).toBeNull();
    expect(results[2]).toHaveLength(1024);
    // 空串不参与调用；两段有效输入按批内 index 得到不同单位向量（local 0 与 local 1）
    expect(results[0]![5]).toBe(0);
    expect(results[2]![1]).toBe(1);
  });

  it("embedBatch：批量调用整体失败时全部置空（不抛错）", async () => {
    __setClientForTests(mockOpenAIClient(undefined, { fail: true }));
    const results = await embedBatch(["a", "b", "c"]);
    expect(results).toEqual([null, null, null]);
  });
});
