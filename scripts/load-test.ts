/**
 * 并发与数据量压测脚本（待实测）。
 *
 * 用法：npx tsx scripts/load-test.ts [--concurrency 50] [--duration 180]
 *
 * 前置条件：容器已运行（docker compose up -d），admin 已登录。
 *
 * 压测内容：
 *   A. 并发压测：工单创建/派单/验收，50/100/200 并发各 3 分钟
 *   B. 数据量验证：5 万条工单日志 + 20 万条遥测后查询耗时
 *
 * ⚠️ 当前为"待实测"状态——脚本可直接运行，但结果需在真实 PG 环境中采集。
 */
import fs from "fs";
import path from "path";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const OUTPUT_DIR = path.resolve("scratch/load-test-output");
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ==================== HTTP 工具 ====================
async function api(method: string, url: string, body?: any, token?: string): Promise<{ status: number; data: any; elapsedMs: number }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const start = Date.now();
  const opts: RequestInit = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${url}`, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, elapsedMs: Date.now() - start };
}

async function login(): Promise<string> {
  const { data } = await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin@2026#Demo" });
  return data.token;
}

// ==================== 并发压测 ====================
interface ConcurrencyResult {
  concurrency: number;
  duration: number;
  totalRequests: number;
  success: number;
  failed: number;
  conflicts: number;
  p50: number;
  p95: number;
  p99: number;
  throughput: number;
}

async function runConcurrencyTest(
  token: string,
  concurrency: number,
  durationMs: number,
): Promise<ConcurrencyResult> {
  const auth = { Authorization: `Bearer ${token}` };
  const results: number[] = [];
  let success = 0, failed = 0, conflicts = 0;
  const startTime = Date.now();
  let running = true;

  // 启动定时器结束压测
  setTimeout(() => { running = false; }, durationMs);

  // 并发工作者
  const workers = Array.from({ length: concurrency }, async () => {
    while (running) {
      const start = Date.now();
      try {
        // 1. 创建工单
        const createRes = await api("POST", "/api/v1/work-orders", {
          title: `压测工单-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          equipmentId: "eq-101",
          faultType: "机械振动",
          priority: "medium",
          description: "压测自动创建",
        }, token);

        if (createRes.status === 200 && createRes.data?.id) {
          success++;
          const elapsed = Date.now() - start;
          results.push(elapsed);

          // 2. 派单
          await api("POST", `/api/v1/work-orders/${createRes.data.id}/dispatch`, {
            assignee: "tech1",
          }, token);

          // 3. 接单
          await api("POST", `/api/v1/work-orders/${createRes.data.id}/accept`, {}, token);

          // 4. 完工
          await api("POST", `/api/v1/work-orders/${createRes.data.id}/complete`, {
            repairLog: { summary: "压测完工" },
          }, token);
        } else if (createRes.status === 409) {
          conflicts++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
      // 小间隔避免过载
      await new Promise((r) => setTimeout(r, 10));
    }
  });

  await Promise.all(workers);
  const totalMs = Date.now() - startTime;

  // 计算分位数
  results.sort((a, b) => a - b);
  const p50 = results[Math.floor(results.length * 0.5)] || 0;
  const p95 = results[Math.floor(results.length * 0.95)] || 0;
  const p99 = results[Math.floor(results.length * 0.99)] || 0;

  return {
    concurrency,
    duration: Math.round(totalMs / 1000),
    totalRequests: results.length,
    success,
    failed,
    conflicts,
    p50,
    p95,
    p99,
    throughput: Math.round(results.length / (totalMs / 1000)),
  };
}

// ==================== 数据量验证 ====================
async function runVolumeTest(token: string): Promise<void> {
  console.log("\n=== B. 数据量验证 ===");
  console.log("⚠️ 待实测：需在真实 PG 环境中构造数据后测量查询耗时");

  // 测量当前数据量下的查询耗时
  const queries = [
    { name: "工单列表（全量）", url: "/api/v1/work-orders" },
    { name: "设备列表", url: "/api/v1/equipments" },
    { name: "知识库列表", url: "/api/v1/knowledge" },
    { name: "审计日志", url: "/api/v1/admin/audit-logs" },
  ];

  for (const q of queries) {
    const { elapsedMs, data } = await api("GET", q.url, undefined, token);
    const count = Array.isArray(data) ? data.length : (data?.total || "N/A");
    console.log(`  ${q.name}: ${elapsedMs}ms (返回 ${count} 条)`);
  }
}

// ==================== 主逻辑 ====================
async function main() {
  console.log(`[load-test] 连接 ${BASE_URL}`);
  const token = await login();
  console.log("[load-test] 登录成功\n");

  const concurrencyLevels = [50, 100, 200];
  const durationMs = 3 * 60 * 1000; // 3 分钟
  const allResults: ConcurrencyResult[] = [];

  for (const c of concurrencyLevels) {
    console.log(`\n=== A. 并发压测: ${c} 并发, 3 分钟 ===`);
    const result = await runConcurrencyTest(token, c, durationMs);
    allResults.push(result);
    console.log(`  完成: ${result.success} 成功 / ${result.failed} 失败 / ${result.conflicts} 冲突`);
    console.log(`  延迟: P50=${result.p50}ms P95=${result.p95}ms P99=${result.p99}ms`);
    console.log(`  吞吐: ${result.throughput} 请求/秒`);
  }

  // 数据量验证
  await runVolumeTest(token);

  // 输出汇总
  console.log("\n================ 压测结果汇总 ================");
  console.log(`| 并发数 | 成功 | 失败 | 冲突 | P50 | P95 | P99 | 吞吐 |`);
  for (const r of allResults) {
    console.log(`| ${r.concurrency} | ${r.success} | ${r.failed} | ${r.conflicts} | ${r.p50}ms | ${r.p95}ms | ${r.p99}ms | ${r.throughput}/s |`);
  }
  console.log("================================================");

  // 保存结果
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "load-test-result.json"),
    JSON.stringify({ timestamp: new Date().toISOString(), concurrency: allResults }, null, 2)
  );
  console.log(`\n结果已保存至 ${OUTPUT_DIR}/load-test-result.json`);
}

main().catch((err) => {
  console.error("[load-test] 未捕获异常:", err);
  process.exit(1);
});
