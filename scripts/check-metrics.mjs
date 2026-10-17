#!/usr/bin/env node
/**
 * 口径守卫（test-metrics guard）
 *
 * 背景：全仓文档里的「测试基线」数字（N 个测试文件 / M 个用例）是人工维护的，
 * 每当有人增删用例就会静默过期 —— 2026-09-14 统一到 234 之后，仅隔一天就漂回 237。
 * 本脚本把这件事变成机器校验：真实跑一次测试，再把所有文档里的基线声明与之比对。
 *
 * 用法：
 *   node scripts/check-metrics.mjs          # 校验；不一致则打印差异并以退出码 1 结束
 *   node scripts/check-metrics.mjs --fix    # 校验并把 README.md / CHANGELOG.md 改写为实测值
 *   node scripts/check-metrics.mjs --no-run # 不跑测试，改用 README 里的声明作为基准（离线快检）
 *
 * 覆盖范围：仓库内所有 .md / .txt。
 * 判定规则：测试基线随迭代只增不减，所以「低于实测」的数字视为历史快照（留存不报错），
 *           而「高于实测」的数字视为超报（报错）。README.md / CHANGELOG.md 任何不一致都报错。
 * 不覆盖：.docx / .pptx / .zip 等二进制交付物（需人工或单独脚本核对，见文末提示）。
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 历史记录类文件：正文是某次具体事件的原始快照，保留原数字，不参与一致性校验。
const HISTORICAL = new Set([
  "docs/口径数字同步核对表.md",
  "docs/测试运行记录-口径同步与flaky验证.md",
]);

// 行级历史标记：CHANGELOG 里按日期分节的发布条目，写的是**当时**的基线。
// 把它改成今天的数字就是篡改历史记录，所以这类行加标记即可跳过校验。
// 用法：在那一行末尾加 `<!-- 口径历史快照 -->`（md 注释，不渲染）。
const HISTORICAL_LINE_MARK = "口径历史快照";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "backups", "scratch", "data", ".workbuddy-ai", "public", "miniprogram", "参赛材料"]);

// 基线声明的成对写法：「33 个测试文件 / 237 个用例」「33个测试文件共237个测试用例」等
// ⚠️ 位数上限是**守卫的盲区**：这里原本是 `\d{1,4}`，于是「999 个测试文件 / 99999 个用例」
//    这条明显超报的声明**完全匹配不上** ⇒ 守卫打印「✓ 口径一致」。
//    实测反证时踩过：注入 99999 得到"全绿"，误判成守卫正常；换成 9999 才报红。
//    放宽到 6 位后，5 位数声明也能被看见（超报必报红）。
const PAIR_PATTERNS = [
  /(\d{1,6})\s*个?\s*(?:测试)?文件\s*[\s/、，,共]{1,6}(\d{1,6})\s*个?\s*(?:测试用例|用例|项用例)/g,
];

// 只有 README / CHANGELOG 是可被 --fix 改写的权威口径来源
const CANONICAL_FILES = ["README.md", "CHANGELOG.md"];

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith("data.bak")) continue;
      walk(path.join(dir, e.name), acc);
    } else if (/\.(md|txt)$/.test(e.name)) {
      acc.push(path.relative(ROOT, path.join(dir, e.name)).split(path.sep).join("/"));
    }
  }
  return acc;
}

function realCounts() {
  const out = path.join(os.tmpdir(), `vitest-metrics-${Date.now()}.json`);
  process.stdout.write("→ 正在运行 vitest 获取实测基线 ... ");
  try {
    execSync(`npx vitest run --reporter=json --outputFile="${out}"`, {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    // vitest 在有用例失败时返回非 0；JSON 报告仍会写出，继续解析
  }
  const j = JSON.parse(fs.readFileSync(out, "utf8"));
  fs.rmSync(out, { force: true });
  const files = Array.isArray(j.testResults) ? j.testResults.length : j.numTotalTestSuites;
  const tests = j.numTotalTests;
  console.log(`实测 ${files} 个测试文件 / ${tests} 个用例`);
  return { files, tests };
}

function claimFromReadme() {
  const md = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  for (const re of PAIR_PATTERNS) {
    const m = new RegExp(re.source).exec(md);
    if (m) return { files: Number(m[1]), tests: Number(m[2]) };
  }
  return null;
}

function scan() {
  const findings = [];
  for (const rel of walk(ROOT)) {
    if (HISTORICAL.has(rel)) continue;
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      // 行级历史标记：日期化条目里的「当时基线」保留原值，不参与校验
      if (line.includes(HISTORICAL_LINE_MARK)) return;
      for (const re of PAIR_PATTERNS) {
        for (const m of line.matchAll(new RegExp(re.source, "g"))) {
          findings.push({ file: rel, line: i + 1, files: Number(m[1]), tests: Number(m[2]), text: line.trim() });
        }
      }
    });
  }
  return findings;
}

// ── 表数口径（第二类指标）────────────────────────────────────────────────────
// 真值来自迁移 SQL：只认「CREATE TABLE [IF NOT EXISTS] <name> (」这种**建表语句**。
// ⚠️ 注释散文里也会出现 "CREATE TABLE IF NOT EXISTS，可重复执行" —— 若不要求后面跟 `(`，
//    就会把 `IF` 数成一张表，于是得出 31（真实 30）。这个错真的发生过一次，
//    并且顺着抄进了 README / 说明书 / 答辩 PPT。
// ⚠️ `024_video_progress.sql` 是 ALTER TABLE（只加两列），**不建表** —— 它不贡献表数，
//    早期文档却据此虚构了一张 `video_progress` 表。
// 同上：位数上限即盲区，`\d{1,3}` 会让「1234 张表」这种超报隐形。
const TABLE_PATTERNS = [/(\d{1,5})\s*张\s*(?:业务)?表/g];

function realTables() {
  const files = [];
  const migDir = path.join(ROOT, "src/db/migrations");
  for (const f of fs.readdirSync(migDir)) {
    if (f.endsWith(".sql")) files.push(path.join(migDir, f));
  }
  const vs = path.join(ROOT, "src/db/vectorStore.ts"); // knowledge_embeddings 的另一份建表（JSONB / vector 二选一）
  if (fs.existsSync(vs)) files.push(vs);

  const names = new Set();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([a-zA-Z_][a-zA-Z0-9_]*)["`]?\s*\(/gi;
  for (const f of files) {
    for (const m of fs.readFileSync(f, "utf8").matchAll(re)) {
      names.add(m[1].toLowerCase());
    }
  }
  return { count: names.size, names: [...names].sort() };
}

function scanTables() {
  const findings = [];
  for (const rel of walk(ROOT)) {
    if (HISTORICAL.has(rel)) continue;
    const lines = fs.readFileSync(path.join(ROOT, rel), "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (line.includes(HISTORICAL_LINE_MARK)) return;
      for (const re of TABLE_PATTERNS) {
        for (const m of line.matchAll(new RegExp(re.source, "g"))) {
          findings.push({ file: rel, line: i + 1, count: Number(m[1]), text: line.trim() });
        }
      }
    });
  }
  return findings;
}

/** 校验「N 张(业务)表」声明；打印报告并返回需修正清单。 */
function checkTables(real) {
  const findings = scanTables();
  const isCanonical = (f) => CANONICAL_FILES.includes(f.file);
  const failures = findings.filter(
    (f) => f.count !== real.count && (f.count > real.count || isCanonical(f)),
  );
  const historical = findings.filter((f) => f.count < real.count && !isCanonical(f));

  console.log(`\n表数守卫：实测 ${real.count} 张业务表（迁移 SQL 逐条统计）。`);
  console.log(
    `  扫描到 ${findings.length} 处「N 张表」声明 —— 一致 ${
      findings.length - failures.length - historical.length
    } 处 / 历史快照 ${historical.length} 处 / 需修正 ${failures.length} 处`,
  );
  for (const f of failures) {
    const why = f.count > real.count ? "超报" : "权威文件过期";
    console.log(`  ✗ [${why}] ${f.file}:${f.line}  声明 ${f.count} 张  →  应为 ${real.count} 张`);
    console.log(`      ${f.text.slice(0, 120)}`);
  }
  return failures;
}

/** 判定规则（测试基线）。抽成函数是为了在「疑似假红」时能用新基准重判一次。 */
function judge(findings, real) {
  const isCanonical = (f) => CANONICAL_FILES.includes(f.file);
  const failures = findings.filter(
    (f) => (f.files !== real.files || f.tests !== real.tests) && (f.tests > real.tests || isCanonical(f)),
  );
  const historical = findings.filter((f) => f.tests < real.tests && !isCanonical(f));
  return { failures, historical };
}

function main() {
  const args = process.argv.slice(2);
  const doFix = args.includes("--fix");
  const noRun = args.includes("--no-run");

  let real = noRun ? claimFromReadme() : realCounts();
  if (!real) {
    console.error("✗ 无法确定基准：README.md 中找不到「N 个测试文件 / M 个用例」声明");
    process.exit(1);
  }

  const findings = scan();

  // 判定规则：测试基线随迭代只增不减，因此
  //   claim == 实测          → 一致
  //   claim <  实测          → 历史快照（修复报告正文里大量存在，属正常，仅提示）
  //   claim >  实测          → 真实错误：宣称了不存在的用例数（任何文件都判失败）
  // 另外：权威文件（README/CHANGELOG）任何不一致都判失败，因为它们必须反映当前口径。
  //
  // ⚠️ 参数是 finding 对象（含 .file），不是文件名字符串。
  //    这里曾经写成 `CANONICAL_FILES.includes(f)` —— 拿对象去 includes 字符串数组，
  //    恒为 false，于是 README/CHANGELOG 永远进不了 failures、被静默归入「历史快照」，
  //    脚本照样打印「✓ 口径一致」。守卫自身失效是完全无声的，改动此处请务必用
  //    `npm run metrics:check` 反证一次：把 README 的基线故意写错，它必须报红。
  let { failures, historical } = judge(findings, real);

  // 并发会话正在改 tests/ 时，某个测试文件处于「半写」状态会让 vitest 少收用例，
  // 实测值**瞬降** ⇒ 本来正确的声明被判成「超报」假红。文件半写只会让用例数变小、
  // 不会凭空变多，所以复核一次、取较高值重判即可消除这类假红。
  if (failures.length > 0 && !noRun) {
    const again = realCounts();
    if (again.tests > real.tests || again.files !== real.files) {
      console.log(
        `\n⚠️ 复核：两次实测不一致（${real.files}/${real.tests} → ${again.files}/${again.tests}）——` +
          " tests/ 很可能正在被其它会话编辑，取较高值重判。",
      );
      if (again.tests > real.tests) real = again;
      ({ failures, historical } = judge(findings, real));
    }
  }

  console.log(`\n扫描到 ${findings.length} 处基线声明。`);
  console.log(`  一致：${findings.length - failures.length - historical.length} 处`);
  console.log(`  历史快照（低于实测，正常留存）：${historical.length} 处`);
  console.log(`  需修正：${failures.length} 处`);

  const realTableInfo = realTables();
  const realTablesCount = realTableInfo.count;
  const tableFailures = checkTables(realTableInfo);

  if (failures.length === 0 && tableFailures.length === 0) {
    console.log("\n✓ 口径一致（无过期主张、无超报）。");
    if (historical.length) {
      console.log("  历史快照文件：");
      for (const f of [...new Set(historical.map((x) => x.file))]) console.log(`    - ${f}`);
    }
    console.log("\n提示：.docx / .pptx / .zip 等二进制交付物不在本脚本覆盖范围内，改动数字后需另行核对。");
    return;
  }

  if (failures.length > 0) {
    console.log("");
    for (const f of failures) {
      const why = f.tests > real.tests ? "超报" : "权威文件过期";
      console.log(`  ✗ [${why}] ${f.file}:${f.line}  声明 ${f.files} 文件 / ${f.tests} 用例  →  应为 ${real.files} / ${real.tests}`);
      console.log(`      ${f.text.slice(0, 120)}`);
    }
  }

  if (doFix) {
    // ⚠️ 必须**逐行、只改判定为失败的那些行**，不能对整份文件做全局 replace。
    //
    //    这里曾经是 `after = after.replace(PAIR_PATTERNS...)`（全局替换），它有两个致命后果，
    //    2026-10-17 实测都发生了：
    //      1. 把带 `口径历史快照` 标记的历史条目一起改掉 —— CHANGELOG 里
    //         「33 个测试文件 / 237 个用例全绿」（v2.0.0 当时的基线）被替换成当天的 96/1150，
    //         「47 文件 / 412 用例」「57 文件 / 556 用例」同样被抹平。**这就是篡改历史记录**，
    //         而文件头自己写着"带标记的行跳过校验"，检查路径确实跳过了，修复路径却没跳过。
    //      2. 改写本来正确的行（同一文件里既有过期声明又有正确声明时，全都被写成同一个数字）。
    //    判定（scan/judge）本来就知道每条声明的 `file` + `line`，修复只需照着改，没有理由全局替换。
    const byFile = new Map();
    for (const f of failures) {
      if (!byFile.has(f.file)) byFile.set(f.file, new Map());
      byFile.get(f.file).set(f.line, f);
    }

    let fixed = 0;
    for (const rel of CANONICAL_FILES) {
      const targets = byFile.get(rel);
      if (!targets || targets.size === 0) continue;
      const abs = path.join(ROOT, rel);
      if (!fs.existsSync(abs)) continue;
      const before = fs.readFileSync(abs, "utf8");
      // 按「行 + 原换行符」切分，join 回去时换行风格逐字节不变
      const lines = before.split(/(\r?\n)/);
      let touched = 0;
      for (const [lineNo, f] of targets) {
        const idx = (lineNo - 1) * 2;
        const raw = lines[idx];
        if (raw === undefined) continue;
        if (raw.includes(HISTORICAL_LINE_MARK)) {
          // 双保险：scan() 已经跳过带标记的行，这里再挡一次，防止将来 scan 的过滤被改掉。
          console.log(`  跳过 ${rel}:${lineNo}（带「${HISTORICAL_LINE_MARK}」标记，保留原值）`);
          continue;
        }
        let next = raw;
        for (const re of PAIR_PATTERNS) {
          next = next.replace(new RegExp(re.source, "g"), (full, a, b) =>
            full.replace(a, String(real.files)).replace(b, String(real.tests)),
          );
        }
        if (next !== raw) {
          lines[idx] = next;
          touched++;
        }
      }
      const after = lines.join("");
      if (after !== before) {
        fs.writeFileSync(abs, after, "utf8");
        fixed++;
        console.log(`\n✓ 已改写 ${rel}（${touched} 行：${[...targets.keys()].join(", ")}）`);
      }
    }
    console.log(`\n共改写 ${fixed} 个权威文件。`);

    // ── 表数声明也要修 ──────────────────────────────────────────────────────
    // 此前 --fix 只处理「测试文件 / 用例」这一对，表数声明会被静默留下，
    // 然后脚本仍然 return（exit 0）—— 于是"修完了"其实没修完。实测踩过：
    // 注入「12345 张业务表」→ 报红 → --fix → 表数那行原封不动，脚本却退出 0。
    const tableByFile = new Map();
    for (const f of tableFailures) {
      if (!CANONICAL_FILES.includes(f.file)) continue;
      if (!tableByFile.has(f.file)) tableByFile.set(f.file, new Map());
      tableByFile.get(f.file).set(f.line, f);
    }
    for (const rel of CANONICAL_FILES) {
      const targets = tableByFile.get(rel);
      if (!targets || targets.size === 0) continue;
      const abs = path.join(ROOT, rel);
      if (!fs.existsSync(abs)) continue;
      const before = fs.readFileSync(abs, "utf8");
      const lines = before.split(/(\r?\n)/);
      let touched = 0;
      for (const [lineNo] of targets) {
        const idx = (lineNo - 1) * 2;
        const raw = lines[idx];
        if (raw === undefined || raw.includes(HISTORICAL_LINE_MARK)) continue;
        let next = raw;
        for (const re of TABLE_PATTERNS) {
          next = next.replace(new RegExp(re.source, "g"), (full, a) =>
            full.replace(a, String(realTablesCount)),
          );
        }
        if (next !== raw) {
          lines[idx] = next;
          touched++;
        }
      }
      const after = lines.join("");
      if (after !== before) {
        fs.writeFileSync(abs, after, "utf8");
        console.log(`✓ 已改写 ${rel} 的表数声明（${touched} 行）`);
      }
    }

    // 非权威文件里的表数超报 --fix 不管，必须让退出码反映出来
    const unresolved = tableFailures.filter((f) => !CANONICAL_FILES.includes(f.file));
    if (unresolved.length > 0) {
      console.log(`\n⚠️ 仍有 ${unresolved.length} 处表数声明需手工同步（非权威文件，--fix 不改）：`);
      for (const f of unresolved) console.log(`    ${f.file}:${f.line}  声明 ${f.count} 张 → 应为 ${realTablesCount} 张`);
      process.exit(1);
    }
    console.log("其余文件请据上面清单手工同步。");
    return;
  }

  console.log("\n修复：node scripts/check-metrics.mjs --fix   （只改 README.md / CHANGELOG.md）");
  process.exit(1);
}

main();
