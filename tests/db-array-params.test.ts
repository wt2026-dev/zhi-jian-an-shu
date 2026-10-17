import { describe, it, expect, beforeAll } from "vitest";
import { createApp } from "../server.ts";
import { getDb } from "../src/db/db.ts";
import { ProcedureVideoRepository, ProcedureRepository } from "../src/db/repositories/index.ts";
import { sweepStaleVideoTasks } from "../src/server/services/videoGenerationService.ts";

/**
 * 数组参数绑定护栏。
 *
 * 事故背景（2026-09-20）：启动日志里出现
 *   [Startup] 清理僵死视频任务失败（不影响启动）: malformed array literal: "["full-1789825451141"]"
 * 根因在 `src/db/db.ts` 的 normalizeParams：它把**所有** object 参数一律 JSON.stringify，
 * 而 JS 数组也是 object —— 于是 `ANY($2::text[])` 收到的是字符串 '["full-…"]' 而不是数组，
 * Postgres 拿它当数组字面量解析就报 malformed array literal。
 *
 * 后果（两条自愈路径同时失效，且都不影响启动 ⇒ 完全静默）：
 *   ① 启动自愈 sweepStaleVideoTasks 不生效 → 进程重启后残留的 processing 行永远转圈；
 *   ② runFullVideoGeneration 的"提交前回收僵死任务"不生效。
 * 而 58 个测试文件里没有任何一个覆盖 failTasksByIds / sweepStaleVideoTasks，
 * 所以这个 bug 一直没被拦住 —— 本文件就是补上这道闸。
 */

const PROC_ID = "proc-db-array-param";

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  await createApp();
  const existing = await ProcedureRepository.getById(PROC_ID);
  if (!existing) {
    await ProcedureRepository.create({
      id: PROC_ID,
      title: "数组参数绑定测试规程",
      equipmentType: "空压机",
      maintenanceLevel: "一级维保",
      steps: [{ step_no: 1, name: "步骤1", content: "操作1" }],
    });
  }
});

describe("数据库数组参数绑定 (ANY($n::text[]) 不能被 JSON 序列化)", () => {
  it("底层契约：数组参数按 Postgres 数组绑定，而不是被 JSON.stringify 成字符串", async () => {
    const db = await getDb();
    // 直接钉住根因：旧实现下这里会抛 malformed array literal
    const { rows } = await db.query(`SELECT $1::text[] AS arr;`, [["alpha", "beta"]]);
    expect(rows[0].arr).toEqual(["alpha", "beta"]);
  });

  it("failTasksByIds：只改判列出的 taskId，不误伤其他行", async () => {
    const tag = Date.now();
    const a = `arr-a-${tag}`;
    const b = `arr-b-${tag}`;
    const untouched = `arr-c-${tag}`;
    for (const taskId of [a, b, untouched]) {
      await ProcedureVideoRepository.create({
        procedureId: PROC_ID,
        taskId,
        status: "processing",
        prompt: "单测桩任务",
      });
    }

    const n = await ProcedureVideoRepository.failTasksByIds([a, b], "单测批量改判");
    expect(n).toBe(2);

    expect((await ProcedureVideoRepository.getByTaskId(a))?.status).toBe("failed");
    expect((await ProcedureVideoRepository.getByTaskId(b))?.status).toBe("failed");
    // 未列出的那条必须原样保留 —— ANY 一旦退化成"匹配全部"就会误杀正在跑的任务
    expect((await ProcedureVideoRepository.getByTaskId(untouched))?.status).toBe("processing");
  });

  it("空列表直接返回 0，不产生任何 SQL（避免 ANY('{}') 之类边界）", async () => {
    expect(await ProcedureVideoRepository.failTasksByIds([], "空列表")).toBe(0);
  });

  it("sweepStaleVideoTasks：超时未更新的 processing 被改判 failed，未超时的保持不动", async () => {
    const tag = Date.now();
    const stale = `sweep-stale-${tag}`;
    const fresh = `sweep-fresh-${tag}`;
    for (const taskId of [stale, fresh]) {
      await ProcedureVideoRepository.create({
        procedureId: PROC_ID,
        taskId,
        status: "processing",
        prompt: "单测桩任务",
      });
    }

    const db = await getDb();
    // 把 stale 那条拨到 2 小时前（远超 AGNES_STALE_AFTER_MIN 默认 60 分钟）
    await db.query(`UPDATE procedure_videos SET updated_at = $1 WHERE task_id = $2;`, [
      new Date(Date.now() - 120 * 60 * 1000).toISOString(),
      stale,
    ]);

    const n = await sweepStaleVideoTasks();
    expect(n).toBeGreaterThanOrEqual(1);

    const staleRow = await ProcedureVideoRepository.getByTaskId(stale);
    expect(staleRow?.status).toBe("failed");
    expect(staleRow?.error).toContain("服务端重启后任务中断");
    // 进度字段必须一并清空，否则前端会拿着 progressPct 继续画进度条
    expect(staleRow?.progressPct).toBeNull();
    expect(staleRow?.internalStatus).toBeNull();

    // 未超时的不能被误杀：Agnes 单段最坏要跑 40 分钟，误杀会直接毁掉正在生成的任务
    expect((await ProcedureVideoRepository.getByTaskId(fresh))?.status).toBe("processing");
  });
});
