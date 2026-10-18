#!/usr/bin/env node
/**
 * 项目事实派生（单一实现，供守卫脚本与测试共用）。
 *
 * 为什么要有这个文件：仓库对外要说的每个数字（几张表、迁移编到几号、几项 AI 能力、
 * 多少测试）此前都写在散文里。散文不会自己更新 —— 2026-10-18 实测 README 写「30 张
 * 业务表 / 迁移 001–025」，而迁移已到 027、表已到 34 张，且 `check-metrics.mjs` 里
 * 已经有一份建表统计却没有被任何闸门调用。这里把「数字从代码派生」做成一个函数，
 * 由 `tests/project-facts.test.ts`（跑在 pre-commit 与 CI 的 vitest 里）钉住文档。
 *
 * 只做静态派生，不跑测试：跑真实 vitest 基线是 check-metrics.mjs 的职责（CI 里跑），
 * 本文件要能在毫秒级被测试引用。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 只认「CREATE TABLE [IF NOT EXISTS] <name> (」——必须要求左括号。
 * 少了这个约束，注释散文里的 "CREATE TABLE IF NOT EXISTS，可重复执行" 会把 `IF`
 * 数成一张表（真实发生过，并顺着抄进 README / 说明书 / 答辩 PPT）。
 */
const CREATE_TABLE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([a-zA-Z_][a-zA-Z0-9_]*)["`]?\s*\(/gi;

/** 迁移目录里的 .sql 文件（按文件名字典序 = 执行序）。 */
export function migrationFiles(root = ROOT) {
  return fs
    .readdirSync(path.join(root, "src/db/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * 表数真值：迁移 SQL + `src/db/vectorStore.ts`（knowledge_embeddings 的第二份建表，
 * pgvector / JSONB 二选一，两边都数才会不重不漏）。
 */
export function realTables(root = ROOT) {
  const files = migrationFiles(root).map((f) => path.join(root, "src/db/migrations", f));
  const vectorStore = path.join(root, "src/db/vectorStore.ts");
  if (fs.existsSync(vectorStore)) files.push(vectorStore);

  const names = new Set();
  for (const f of files) {
    for (const m of fs.readFileSync(f, "utf8").matchAll(CREATE_TABLE_RE)) {
      names.add(m[1].toLowerCase());
    }
  }
  return { count: names.size, names: [...names].sort() };
}

/** 迁移编号区间与连续性（README 的「001–025 连续唯一」就靠这个核对）。 */
export function realMigrations(root = ROOT) {
  const files = migrationFiles(root);
  const numbers = files
    .map((f) => /^(\d{3})_/.exec(f))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  const missing = [];
  for (let n = Math.min(...numbers); n <= Math.max(...numbers); n++) {
    if (!numbers.includes(n)) missing.push(String(n).padStart(3, "0"));
  }
  return {
    count: files.length,
    min: Math.min(...numbers),
    max: Math.max(...numbers),
    unnumbered: files.filter((f) => !/^\d{3}_/.test(f)),
    missing,
    contiguous: missing.length === 0 && numbers.length === files.length,
  };
}

/**
 * AI 能力数：直接读 `src/aiCapabilities.ts` 的 status 字面量计数。
 * 正则数出来的值由测试拿去和**真实导入的模块**比对，所以这里不需要引 TS。
 */
export function realCapabilities(root = ROOT) {
  const text = fs.readFileSync(path.join(root, "src/aiCapabilities.ts"), "utf8");
  const count = (status) => (text.match(new RegExp(`status:\\s*"${status}"`, "g")) || []).length;
  return {
    core: count("core"),
    transport: count("transport"),
    stub: count("stub"),
    internal: count("internal"),
  };
}

/** 测试文件数与用例声明数（静态；运行时真值见 check-metrics.mjs）。 */
export function realTestSource(root = ROOT) {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") walk(full);
      } else if (/\.test\.tsx?$/.test(e.name)) {
        files.push(full);
      }
    }
  };
  walk(path.join(root, "tests"));
  let cases = 0;
  for (const f of files) {
    cases += (fs.readFileSync(f, "utf8").match(/^\s*(?:it|test)\(/gm) || []).length;
  }
  return { files: files.length, cases };
}

export function deriveFacts(root = ROOT) {
  return {
    tables: realTables(root),
    migrations: realMigrations(root),
    capabilities: realCapabilities(root),
    tests: realTestSource(root),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  console.log(JSON.stringify(deriveFacts(), null, 2));
}
