/**
 * withDailyNoRetry / isUniqueViolation 单元测试。
 *
 * 背景：dailyNo.ts 的「取号+插入」此前只有进程内互斥锁，多副本/多连接部署时另一进程
 * 插入了同一个号会让 INSERT 撞 UNIQUE 直接 500。withDailyNoRetry 在锁外兜撞号重试。
 * 这里不依赖数据库，用注入的闭包模拟冲突序列，验证重试语义本身。
 */
import { describe, expect, it } from "vitest";
import { isUniqueViolation, withDailyNoRetry } from "../src/db/dailyNo.ts";

function uniqueErr(msg = "duplicate key value violates unique constraint \"work_orders_order_no_key\"") {
  return Object.assign(new Error(msg), { code: "23505" });
}

describe("isUniqueViolation", () => {
  it("识别 SQLSTATE 23505", () => {
    expect(isUniqueViolation(uniqueErr())).toBe(true);
  });

  it("消息兜底：无 code 但消息含 unique constraint / duplicate key 也算", () => {
    expect(isUniqueViolation(new Error("UNIQUE constraint failed: inspections.task_no"))).toBe(true);
    expect(isUniqueViolation(new Error('pg: duplicate key value violates constraint'))).toBe(true);
  });

  it("非唯一约束错误返回 false", () => {
    expect(isUniqueViolation(new Error("connection refused"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});

describe("withDailyNoRetry", () => {
  it("无冲突时直接返回结果，不重试", async () => {
    let calls = 0;
    const result = await withDailyNoRetry(async () => {
      calls++;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("撞号后重新执行闭包（重新取号），冲突-冲突-成功序列最终成功", async () => {
    let calls = 0;
    const result = await withDailyNoRetry(async () => {
      calls++;
      if (calls < 3) throw uniqueErr();
      return `WO-20261019-${String(calls).padStart(4, "0")}`;
    });
    expect(calls).toBe(3);
    expect(result).toBe("WO-20261019-0003");
  });

  it("重试耗尽后抛出最后一个唯一约束错误", async () => {
    let calls = 0;
    await expect(
      withDailyNoRetry(
        async () => {
          calls++;
          throw uniqueErr();
        },
        3
      )
    ).rejects.toThrow(/duplicate key/);
    expect(calls).toBe(3);
  });

  it("非唯一约束错误立即抛出、绝不重试（避免重复副作用）", async () => {
    let calls = 0;
    await expect(
      withDailyNoRetry(async () => {
        calls++;
        throw new Error("connection refused");
      })
    ).rejects.toThrow("connection refused");
    expect(calls).toBe(1);
  });

  it("并发多个重试任务互不串扰（各自独立收敛）", async () => {
    const counters = [0, 0, 0];
    const results = await Promise.all(
      counters.map((_, i) =>
        withDailyNoRetry(async () => {
          counters[i]++;
          if (counters[i] < i + 1) throw uniqueErr();
          return `seq-${i}`;
        })
      )
    );
    expect(results).toEqual(["seq-0", "seq-1", "seq-2"]);
  });
});
