/**
 * PostgreSQL 迁移全量回放脚本。
 *
 * 用法：npx tsx scripts/pg-migration-replay.ts
 *
 * 前置条件：DATABASE_URL 指向 PostgreSQL 16 实例（非 PGlite）。
 * 行为：按序回放 23 个迁移 → 逐表统计行数 → 生成对照表。
 * 失败即停并输出原因。
 */
import fs from "fs";
import path from "path";
import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || DATABASE_URL.includes("pglite")) {
  console.error("[pg-migration-replay] 错误：DATABASE_URL 必须指向 PostgreSQL 实例（非 PGlite）");
  console.error("示例：DATABASE_URL=postgresql://postgres:password@localhost:5432/industrial_maintenance npx tsx scripts/pg-migration-replay.ts");
  process.exit(1);
}

const MIGRATIONS_DIR = path.resolve("src/db/migrations");

// 预期 29 张业务表（不含 schema_migrations）
const EXPECTED_TABLES = [
  "users", "equipments", "work_orders", "safety_permits", "audit_logs",
  "knowledge_articles", "work_order_logs", "inspections", "equipment_telemetry",
  "notifications", "loto_locks", "upload_files", "knowledge_graph_nodes",
  "knowledge_graph_edges", "ai_feedback", "maintenance_procedures",
  "compliance_checks", "ai_analysis_log", "spare_parts", "spare_parts_movements",
  "hazards", "procedure_videos", "ai_knowledge_contributions", "ai_tasks",
  "ai_task_steps", "ai_generation_reviews", "ai_model_configs",
  "technician_locations", "knowledge_embeddings",
];

async function main() {
  console.log("[pg-migration-replay] 连接 PostgreSQL...");
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log("[pg-migration-replay] 已连接\n");

  // 1. 获取迁移文件列表
  const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  console.log(`[pg-migration-replay] 发现 ${migrationFiles.length} 个迁移文件\n`);

  // 2. 按序执行迁移
  console.log("=== 执行迁移 ===");
  for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    try {
      await client.query(sql);
      console.log(`  ✅ ${file}`);
    } catch (err: any) {
      console.error(`  ❌ ${file} 失败: ${err.message}`);
      console.error(`\n[pg-migration-replay] 迁移失败，已停止。`);
      await client.end();
      process.exit(1);
    }
  }
  console.log(`\n${migrationFiles.length} 个迁移全部成功\n`);

  // 3. 逐表统计行数
  console.log("=== 表行数统计 ===");
  const tableCounts: { table: string; count: number }[] = [];
  for (const table of EXPECTED_TABLES) {
    try {
      const { rows } = await client.query(`SELECT COUNT(*)::int AS cnt FROM ${table}`);
      tableCounts.push({ table, count: rows[0].cnt });
      console.log(`  ${table}: ${rows[0].cnt} 行`);
    } catch (err: any) {
      console.error(`  ❌ ${table}: ${err.message}`);
      tableCounts.push({ table, count: -1 });
    }
  }

  // 4. 检查是否有预期外的表
  const { rows: allTables } = await client.query(`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
  `);
  const actualTables = allTables.map((r: any) => r.tablename).filter((t: string) => t !== "schema_migrations");
  const extraTables = actualTables.filter((t: string) => !EXPECTED_TABLES.includes(t));
  if (extraTables.length > 0) {
    console.log(`\n⚠️ 预期外的表: ${extraTables.join(", ")}`);
  }

  // 5. 缺失表检查
  const missingTables = EXPECTED_TABLES.filter((t) => !actualTables.includes(t));
  if (missingTables.length > 0) {
    console.log(`\n❌ 缺失表: ${missingTables.join(", ")}`);
  }

  // 6. 输出对照表
  console.log("\n=== 对照表 ===");
  console.log(`| 表名 | 行数 | 状态 |`);
  console.log(`|------|------|------|`);
  for (const { table, count } of tableCounts) {
    const status = count >= 0 ? "✅" : "❌";
    console.log(`| ${table} | ${count} | ${status} |`);
  }
  console.log(`| **合计** | **${tableCounts.filter((t) => t.count >= 0).reduce((s, t) => s + t.count, 0)}** | ${tableCounts.every((t) => t.count >= 0) ? "✅ 全部存在" : "❌ 有缺失"} |`);

  await client.end();
  console.log("\n[pg-migration-replay] 完成");
}

main().catch((err) => {
  console.error("[pg-migration-replay] 未捕获异常:", err);
  process.exit(1);
});
