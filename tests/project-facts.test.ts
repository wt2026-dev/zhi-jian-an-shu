/**
 * 事实派生守卫 —— 把「权威文档对外说的结构性数字」钉到从代码派生的真值上。
 *
 * 背景：`scripts/check-metrics.mjs` 早就实现了建表统计，但它既不在 pre-commit 也不在
 * CI 里跑，于是 2026-10-18 实测 README 仍写「30 张业务表 / 迁移 001–025」，而迁移已到
 * 027、表已到 34 张。修法不是再写一份核对清单，而是让这些数字**在 vitest 里被核对**：
 * pre-commit 与 CI 都跑全量 vitest，这道门因此自动生效，成本只是几次文件读（毫秒级）。
 *
 * 分工（刻意不重叠）：
 *   · 本文件守**静态可派生**的量：表数、迁移编号区间、能力清单内部一致性，以及测试基线
 *     里的**文件数**一半 —— 文件数静态扫出来的值与 vitest 运行时报的数量恒等（2026-10-18
 *     在干净检出里并排核对：131 = 131），所以能放进毫秒级的 pre-commit。这一半只拦**超报**
 *     （对外虚报），容忍低估：共享工作区里别人的未入库测试文件会让派生数偏高，精确匹配
 *     等于把邻居的 WIP 打在我的闸门上；低估由 CI 的 `metrics:check` 精确核对。
 *   · 用例数（`M 个用例`）要跑真实 vitest 才是真值（含参数化展开），由
 *     `npm run metrics:check` 守（已接进 CI）。这里刻意不拿静态 `it(` 计数冒充它。
 *   · AI 能力数的对外文案漂移由 `tests/ai-capability-registry.test.ts` 守（它核对
 *     package.json 与 openapi）。这里刻意**不**扫散文：README 的「历史漂移提醒」句里
 *     就带着 "24 项"「20 项」这两个故意留下的错误数字，任何全文扫描都会把坦白打成违规。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { deriveFacts } from "../scripts/project-facts.mjs";
import { AI_CAPABILITIES, AI_CORE_CAPABILITY_COUNT } from "../src/aiCapabilities.ts";

const ROOT = process.cwd();

/** 结构性数字的权威文件：过期即红，不允许静默漂移。 */
const CANONICAL_DOCS = ["README.md", "CHANGELOG.md"];

/** 与 check-metrics.mjs 同一套豁免约定：行尾加该标记 = 声明"这是当时的历史快照"。 */
const HISTORICAL_LINE_MARK = "口径历史快照";

const facts = deriveFacts(ROOT);

type Claim = { file: string; line: number; value: number; text: string };

/** 逐行抽取「N 张(业务)表」与「001–NNN」声明，跳过历史快照行。 */
function collectClaims(rel: string): { tables: Claim[]; ranges: Claim[] } {
  const tables: Claim[] = [];
  const ranges: Claim[] = [];
  const lines = fs.readFileSync(path.join(ROOT, rel), "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes(HISTORICAL_LINE_MARK)) return;
    for (const m of line.matchAll(/(\d{1,5})\s*张\s*(?:业务)?表/g)) {
      tables.push({ file: rel, line: i + 1, value: Number(m[1]), text: line.trim() });
    }
    for (const m of line.matchAll(/001[–-](\d{3})/g)) {
      ranges.push({ file: rel, line: i + 1, value: Number(m[1]), text: line.trim() });
    }
  });
  return { tables, ranges };
}

const allClaims = CANONICAL_DOCS.map(collectClaims);

/**
 * 「N 个测试文件 / M 个用例」声明。成对写法与 `scripts/check-metrics.mjs` 的
 * `PAIR_PATTERNS` 保持一致 —— 两边解析不一致，就会出现「CI 说一致、pre-commit 说超报」
 * 这种互相打红的口径裂缝。
 */
function collectBaselineClaims(): { file: string; line: number; files: number; cases: number; text: string }[] {
  const out: { file: string; line: number; files: number; cases: number; text: string }[] = [];
  for (const rel of CANONICAL_DOCS) {
    const lines = fs.readFileSync(path.join(ROOT, rel), "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (line.includes(HISTORICAL_LINE_MARK)) return;
      for (const m of line.matchAll(
        /(\d{1,6})\s*个?\s*(?:测试)?文件\s*[\s/、，,共]{1,6}(\d{1,6})\s*个?\s*(?:测试用例|用例|项用例)/g
      )) {
        out.push({ file: rel, line: i + 1, files: Number(m[1]), cases: Number(m[2]), text: line.trim() });
      }
    });
  }
  return out;
}

describe("派生器本身可信（scripts/project-facts.mjs）", () => {
  it("迁移编号从 001 起连续无断号，README 的「按编号连续唯一」才成立", () => {
    expect(facts.migrations.unnumbered, `存在未编号迁移: ${facts.migrations.unnumbered}`).toEqual([]);
    expect(facts.migrations.missing, `迁移编号有断号: ${facts.migrations.missing}`).toEqual([]);
    expect(facts.migrations.min).toBe(1);
    expect(facts.migrations.contiguous).toBe(true);
    // 文件数 = 最大编号：防同一编号挂两个文件（按字典序执行会静默吞掉重复职责）
    expect(facts.migrations.count).toBe(facts.migrations.max);
  });

  it("表数只认 CREATE TABLE …( 且按名去重，散文里的伪建表句不被计数", () => {
    expect(facts.tables.count).toBeGreaterThan(0);
    expect(facts.tables.names.length).toBe(facts.tables.count);
    expect(facts.tables.names).not.toContain("if"); // 历史上把 "IF" 数成过一张表
    // 新迁移加的表必须出现在派生结果里，否则说明扫描漏了来源
    for (const t of ["acceptance_standards", "business_loops", "factories"]) {
      expect(facts.tables.names, `派生结果漏了 ${t}`).toContain(t);
    }
  });

  it("status 正则计数 = 真实导入模块的计数（不放过守卫自己的盲区）", () => {
    const byModule = (status: string) => AI_CAPABILITIES.filter((c) => c.status === status).length;
    expect(facts.capabilities.core).toBe(byModule("core"));
    expect(facts.capabilities.transport).toBe(byModule("transport"));
    expect(facts.capabilities.stub).toBe(byModule("stub"));
    expect(facts.capabilities.internal).toBe(byModule("internal"));
    expect(facts.capabilities.core).toBe(AI_CORE_CAPABILITY_COUNT);
  });
});

describe("权威文档的结构性数字 = 派生真值", () => {
  it(`表数声明全部等于迁移派生的 ${facts.tables.count} 张`, () => {
    const bad = allClaims.flatMap((c) => c.tables).filter((x) => x.value !== facts.tables.count);
    expect(
      bad.map((x) => `${x.file}:${x.line} 声明 ${x.value} 张 → 应为 ${facts.tables.count}`),
      `文档表数已过期（跑一次 \`npm run metrics:check -- --fix\` 或直接改这几行）:\n${bad
        .map((x) => `  ${x.file}:${x.line}  ${x.text.slice(0, 80)}`)
        .join("\n")}`
    ).toEqual([]);
  });

  it(`迁移区间声明全部等于派生的 001–${String(facts.migrations.max).padStart(3, "0")}`, () => {
    const bad = allClaims.flatMap((c) => c.ranges).filter((x) => x.value !== facts.migrations.max);
    expect(
      bad.map((x) => `${x.file}:${x.line} 声明 0${x.value} → 应为 0${facts.migrations.max}`),
      `文档迁移区间已过期:\n${bad.map((x) => `  ${x.file}:${x.line}  ${x.text.slice(0, 80)}`).join("\n")}`
    ).toEqual([]);
  });

  it("README 的「数据库表」清单与派生表名一一对应（不漏列、不虚构）", () => {
    const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8").replace(/\r\n/g, "\n");
    // 行尾符不能让切分静默失配（失配 = 空扫描 = 假绿）；只取小节里的**表格行**作清单，
    // 否则正文说明里提一句表名就能顶掉缺列 —— 2026-10-18 造红验证时正是这样漏掉的。
    const section = readme.split(/^## 数据库表$/m)[1]?.split(/^## /m)[0] ?? "";
    expect(section.length, "未能定位 README 的「## 数据库表」小节，核对已退化成空扫描").toBeGreaterThan(400);
    const rows = section.split("\n").filter((line) => line.trim().startsWith("|"));
    expect(rows.length, "数据库表小节里没扫到任何表格行").toBeGreaterThan(5);
    // 只认「表」这一列（第 2 个单元格）：说明列里写列名（progress_pct 等）不该被当成表名
    const inventory = rows.map((line) => line.split("|")[2] ?? "").join("\n");
    expect(inventory.length, "「表」列取出来是空的，核对已退化成空扫描").toBeGreaterThan(50);

    const missing = facts.tables.names.filter((n: string) => !inventory.includes(`\`${n}\``));
    expect(missing, `迁移里已建但 README 表清单缺席: ${missing.join(", ")}`).toEqual([]);

    // 反向：清单里写到的表必须真的存在，否则文档虚构了一张表
    const listed = [...inventory.matchAll(/`([a-z][a-z0-9_]{3,})`/g)].map((m) => m[1]);
    const invented = [...new Set(listed)].filter((n: string) => !facts.tables.names.includes(n));
    expect(invented, `README 表清单写了迁移里不存在的表: ${invented.join(", ")}`).toEqual([]);
  });

  it("README 至少各有一处表数与迁移区间声明（防止靠删掉声明来通过守卫）", () => {
    const readme = collectClaims("README.md");
    expect(readme.tables.length).toBeGreaterThan(0);
    expect(readme.ranges.length).toBeGreaterThan(0);
  });

  it(`测试基线的文件数声明不得超过同一棵树里派生的 ${facts.tests.files} 个`, () => {
    const claims = collectBaselineClaims();
    // 空扫描 = 假绿：删掉那两行声明就能绕过这条守卫，所以先钉扫描本身有产出
    expect(claims.length, "README/CHANGELOG 里没扫到「N 个测试文件」声明，核对已退化成空扫描").toBeGreaterThan(0);
    // 单向（只拦超报）而不是精确匹配，是有意的：共享工作区里躺着别人未提交的测试文件时，
    // 树内派生数会**大于**已提交口径，精确匹配就把邻居的 WIP 打在我的闸门上 —— 那正是本仓
    // 要避免的互相打红。对外虚报才是这条守的东西；低估留给 CI 的 metrics:check 精确核对。
    const bad = claims.filter((c) => c.files > facts.tests.files);
    expect(
      bad.map((x) => `${x.file}:${x.line} 声明 ${x.files} 个文件 → 该树只有 ${facts.tests.files}`),
      `文档的测试文件数是**别的树**里的读数（多半是共享工作区里那个未入库的测试文件）。` +
        `改这个数字前想清楚：CI 在干净检出里跑，认的是提交内容里的文件数。\n` +
        bad.map((x) => `  ${x.file}:${x.line}  ${x.text.slice(0, 90)}`).join("\n")
    ).toEqual([]);
  });
});
