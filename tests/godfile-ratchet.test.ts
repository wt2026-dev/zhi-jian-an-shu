/**
 * God-file 棘轮 —— 「瘦身」不许只是账面数字。
 *
 * 2026-10-18 锐评里的事实：提交标题挂着「拆解视图 / API 层瘦身」，而同一棵树上
 * src 下的 .ts/.tsx 里 >300 行的仍有 115 个、>800 行 26 个、>1000 行 17 个，最大的是
 * `scene.ts` 3743 行、`EquipmentScene.tsx` 2919 行、`src/api/index.ts` 1785 行。
 * 文件行数和口径数字是同一类病：写在散文里的自我评价，没有闸门就会自己往上飘。
 *
 * 两条钉子：
 *   1. 三档阈值下的**文件个数**只许降不许升（新增大文件、把小文件撑过线都会红）；
 *   2. 三个最大头按**各自行数**记账 —— 它们正是「谁都不敢动」的那几个，不给它们戴笼子，
 *      棘轮就永远只约束新代码。
 *
 * 红线确实要涨的时候：在同一个 commit 里改 BUDGET 并在提交说明里写清为什么。
 * 这条闸门不拦「长胖」，它拦的是「悄悄长胖」。并行会话在途的 business-loop 链
 * （`businessLoopService.ts` 工作区已 1717 行）若跨过阈值会在这里变红 —— 那不是回归，
 * 是把账摆到桌面上，要么拆要么记账，别指望下一个会话替你圆。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 按 2026-10-18 HEAD 实测登记。 */
const BUDGET = { gt300: 116, gt800: 26, gt1000: 17 };
// gt300 115 → 116（2026-10-19，refactor/godfile-phase2）：workerFlow.ts 430 行是
// 从 scene.ts 机械切出的独立模块，scene.ts 同 commit 减重 ~430 行（3743 → 3073）。
// gt1000 桶不升：scene.ts 仍在桶内。三个 >1000 的头部文件合计净减。

/**
 * 单独记账的最大头：文件 → 允许的最大行数。
 *
 * 基线一律取**实测值，不留余量**：2026-10-19 复查发现这里仍登记 scene.ts 3743，
 * 而它经 CameraRig 等切分实际已降到 2908 —— 等于悄悄放宽了 835 行预算，
 * 「只降不升」在代码里并不成立。体积真的需要上涨时，在同一个 commit 里改这张表
 * 并在提交说明写清为什么；并行会话被这条拦红也是同一句话：要么拆，要么记账。
 */
const TOP_FILES: Record<string, number> = {
  "src/components/equipment3d/scene.ts": 2908,
  "src/components/equipment3d/EquipmentScene.tsx": 2608,
  "src/api/index.ts": 1498,
};

function lineCount(file: string): number {
  const text = fs.readFileSync(file, "utf8");
  // 用换行个数而不是 split 长度：CRLF / LF 必须给出同一个数
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

function scanSrcFiles(): { rel: string; lines: number }[] {
  const out: { rel: string; lines: number }[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name)) {
        out.push({ rel: path.relative(ROOT, full).replace(/\\/g, "/"), lines: lineCount(full) });
      }
    }
  };
  walk(path.join(ROOT, "src"));
  return out;
}

describe("God-file 棘轮（只降不升）", () => {
  const files = scanSrcFiles();
  const count = (threshold: number) => files.filter((f) => f.lines > threshold).length;
  const measured = { gt300: count(300), gt800: count(800), gt1000: count(1000) };
  const top = [...files].sort((a, b) => b.lines - a.lines).slice(0, 8);

  it(`超长文件个数不得超过基线 ${JSON.stringify(BUDGET)}`, () => {
    const detail = `当前实测 ${JSON.stringify(measured)}\n最重的 8 个文件：\n` +
      top.map((f) => `  ${String(f.lines).padStart(5)}  ${f.rel}`).join("\n") +
      `\n注意：本地 \`npm test\` 数的是**工作区**（含并行会话未提交的 WIP），闸门数的是**索引树**，` +
      `两边不一致时以 pre-commit 的读数为准 —— 别为了让本地变绿去调 BUDGET。`;
    expect(measured.gt300, `>300 行的文件变多了。${detail}`).toBeLessThanOrEqual(BUDGET.gt300);
    expect(measured.gt800, `>800 行的文件变多了。${detail}`).toBeLessThanOrEqual(BUDGET.gt800);
    expect(measured.gt1000, `>1000 行的文件变多了。${detail}`).toBeLessThanOrEqual(BUDGET.gt1000);
  });

  it("三个最大头各自一行都不许变长", () => {
    for (const [rel, budget] of Object.entries(TOP_FILES)) {
      const hit = files.find((f) => f.rel === rel);
      expect(hit, `${rel} 不在了？改名或移动也要回来更新这里的行数`).toBeTruthy();
      expect(hit!.lines, `${rel} 已超过登记的 ${budget} 行`).toBeLessThanOrEqual(budget);
    }
  });

  it("扫描本身有效（防空跑：真的数到了 src 源文件）", () => {
    expect(files.length, "src 下没扫到 .ts/.tsx，本文件的断言全是空跑").toBeGreaterThan(400);
    expect(top[0].lines).toBeGreaterThan(1500);
    // 三个登记头部必须真的扫得到：上一版用「最大行数 > 2800」当有效性探针，
    // 结果瘦身把最大头降到 2671 时守卫自己误红。存在性才是它想说的东西。
    for (const rel of Object.keys(TOP_FILES)) {
      expect(files.find((f) => f.rel === rel), `${rel} 没扫到 —— 是移动了还是路径写错？`).toBeTruthy();
    }
  });
});
