/**
 * PGlite → PostgreSQL 数据迁移工具
 * 用法: DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD 配置好目标库后执行
 *       npx tsx scripts/migrate-pglite-to-postgres.ts
 * 流程: 读取 PGlite 全量表数据 → 目标库执行迁移 SQL → 批量写入 → 记录数校验
 */
import fs from "fs";
import path from "path";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";

var PG_PATH = path.join(process.cwd(), "data", "industrial_ops_pg");
var TABLES = [
  "users", "equipments", "work_orders", "work_order_logs", "safety_permits",
  "audit_logs", "knowledge_articles", "inspections", "equipment_telemetry",
  "notifications", "loto_locks", "upload_files",
];

async function main() {
  console.log("[migrate] 打开源 PGlite:", PG_PATH);
  var source = new PGlite(PG_PATH);

  var targetUrl =
    process.env.DATABASE_URL ||
    `postgresql://${process.env.DB_USER || "postgres"}:${process.env.DB_PASSWORD || ""}@${process.env.DB_HOST || "localhost"}:${process.env.DB_PORT || "5432"}/${process.env.DB_NAME || "industrial_maintenance"}`;
  console.log("[migrate] 连接目标 PostgreSQL ...");
  var pool = new pg.Pool({ connectionString: targetUrl, max: 4 });

  // 1. 目标库执行迁移 SQL（建表）
  var migDir = path.join(process.cwd(), "src", "db", "migrations");
  var files = fs.readdirSync(migDir).filter(function (f) { return f.endsWith(".sql"); }).sort();
  for (var f of files) {
    console.log("[migrate] 执行迁移:", f);
    await pool.query(fs.readFileSync(path.join(migDir, f), "utf-8"));
  }

  // 2. 逐表迁移
  var report: { table: string; source: number; target: number; ok: boolean }[] = [];
  for (var table of TABLES) {
    var src = await source.query(`SELECT * FROM ${table}`);
    var rows = src.rows as any[];
    if (rows.length === 0) {
      report.push({ table: table, source: 0, target: 0, ok: true });
      continue;
    }
    var cols = Object.keys(rows[0]);
    var colList = cols.map(function (c) { return '"' + c + '"'; }).join(", ");
    var inserted = 0;
    var BATCH = 50;
    for (var i = 0; i < rows.length; i += BATCH) {
      var chunk = rows.slice(i, i + BATCH);
      var values: any[] = [];
      var tuples = chunk.map(function (row, ri) {
        var ph = cols.map(function (c, ci) {
          values.push(
            row[c] !== null && typeof row[c] === "object" && !(row[c] instanceof Date)
              ? JSON.stringify(row[c])
              : row[c]
          );
          return "$" + (ri * cols.length + ci + 1);
        });
        return "(" + ph.join(", ") + ")";
      });
      var sql = `INSERT INTO ${table} (${colList}) VALUES ${tuples.join(", ")} ON CONFLICT DO NOTHING`;
      var res = await pool.query(sql, values);
      inserted += res.rowCount || 0;
    }
    var tgt = await pool.query(`SELECT COUNT(*)::int AS c FROM ${table}`);
    var targetCount = tgt.rows[0].c;
    report.push({ table: table, source: rows.length, target: targetCount, ok: targetCount >= rows.length });
    console.log(`[migrate] ${table}: 源 ${rows.length} 行 → 目标 ${targetCount} 行`);
    void inserted;
  }

  // 3. 校验报告
  console.log("\n===== 迁移校验报告 =====");
  var allOk = true;
  for (var r of report) {
    if (!r.ok) allOk = false;
    console.log(`${r.ok ? "OK " : "FAIL"} ${r.table}: 源=${r.source} 目标=${r.target}`);
  }
  console.log(allOk ? "===== 全部表迁移校验通过 =====" : "===== 存在校验失败项，请检查 =====");

  await source.close();
  await pool.end();
  process.exit(allOk ? 0 : 1);
}

main().catch(function (e) {
  console.error("[migrate] 迁移失败:", e);
  process.exit(1);
});
