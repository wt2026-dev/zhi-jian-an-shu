# 多会话并行开发约定（AI 会话与人类协作者共同遵守）

> 背景：2026-09-19 一天内发生三次并行写入冲突（callouts 开关被来回拨、检修卡片
> 一晚被重写两次、一次 stash 挂起）。每次都靠运气没坏，本文件把它变成流程。
>
> 2026-10-18 修订：本文件原来记的是**病**不是**药** —— 用目录所有权代替分支隔离，
> 用"提交前跑全量测试"代替"测的是哪棵树"。现在闸门改了口径（见最后两节），
> 所有权表降级为止血措施，正解是各会话在自己 worktree 里干活。

## 文件所有权（写入权 = 1 个会话，其余只读验收）【止血用，不是终局方案】

| 目录 / 文件 | 当前写入方 | 其他会话 |
| --- | --- | --- |
| `src/components/equipment3d/scene.ts` | 会话 A（3D 引擎主责） | 只读 + 建议以文字转交 |
| `src/components/equipment3d/deviceDetailEnv.ts`、`faultLocator.ts`、`cameraFraming.ts` | 会话 A | 只读 |
| `src/components/equipment3d/ProductionHUD.tsx`、`RepairStepCard.tsx` | 会话 B | 只读 |
| `src/components/digital-human/` | 会话 B | 只读 |
| `src/components/game/`（检修闯关） | 会话 C | 只读 |
| `src/components/equipment3d/equipment.ts`（GLB 映射区 77-100 行） | 双方均可**追加**映射行，禁止重排/删除他人行 | — |
| `src/server/**`、`src/db/**` | 改动前必须先在群里说一声 | — |

**这张表冻结的是 god-file，不是冲突**：`scene.ts` 3743 行、`EquipmentScene.tsx` 2919 行、
`src/api/index.ts` 1785 行被划给"唯一写入方"之后，没有任何机制能让它变小。体积由
`tests/godfile-ratchet.test.ts` 记账（只降不升），别再用"归属"当重构的替代品。

正解（一次任务一套隔离，不共享工作区）：

```bash
git worktree add --detach ../pcheck-a HEAD     # 各会话一个目录，node_modules 靠上层共享或重装
git switch -c feat/<任务名>                     # 短期分支，合完就删；冲突在 PR/merge 里解决
```

## 写入规则

1. **动文件前先 `git status` + `git log --oneline -3`**：确认你要改的文件没有
   未提交的他人改动；有 → 先沟通，不要直接覆盖。
2. **小步提交**：一个功能点一个 commit（今天的 `aaa683a`→`fc3ae37` 链就是好的示范）。
   长时间持有的未提交改动是 stash 冲突的根源。
3. **不要重写别人的组件**：要改行为，加 prop / 加开关（参考 `scene.ts` 的
   `FOCUS_CALLOUTS_ENABLED` 模式），把"旧行为一行可恢复"留给对方确认。
4. **临时对比用 `git stash` 时**：pop 之前先 `git stash show --stat` 并确认工作区
   与 stash 的 diff 为空（逐字节一致）再 drop——今天差点弄丢工作区。
5. **同一文件连续被两人改**：后写的一方直接提交即可 —— pre-commit 已经把 `tsc --noEmit` +
   全量 `vitest run` 变成硬闸，且验的是**索引里的树**（见末节），不再拿别人的 WIP 打红你。

## 已知共享热点（改动前额外小心）

- `scene.ts` 的 `setFocusDecorData` / `setFocusDecorSafeArea`（no-op 兼容层）
- `RepairStepCard.tsx` 的 props（3D 内工单操作是三条会话共用的接口面）
- `equipment.ts` 的 `EQUIPMENT_GLB_MAP`（追加行安全，重排不安全）
- `WorkOrderRepository.create()`：`order_no` 分配收口在这里（锁 + 当天最大号+1），
  三个 controller 与隐患整改、业务闭环共用；别在调用方再自备随机号
- `src/db/dailyNo.ts`：所有 `UNIQUE` 业务编号的唯一实现，新增编号列走它，不要 `Math.random`
- `scripts/git-hooks/pre-commit`：闸门本体。改它 = 改所有人的提交体验，先说一声并自己在
  真实 hook 环境里跑过（在工作区手跑 `bash scripts/git-hooks/pre-commit` 会漏掉 GIT_DIR 差异）
- `README.md` / `CHANGELOG.md` 的口径行（表数、迁移区间、测试基线）：由
  `tests/project-facts.test.ts` + CI `npm run metrics:check` 双重钉住，手改数字必红

## 提交纪律（收工标准：`git diff --ignore-cr-at-eol --name-only` 里不剩自己的文件）

1. **未提交的 WIP 会把所有人的 `npm run lint` / `npx tsc --noEmit` 打红**：这两个命令扫的是
   工作区而不是 HEAD。2026-09-19 夜里一条 `StepProgress` 的类型笔误让其他会话改完自己的
   页面后无法自证清白。所以：当天写完当天提，拿不准就先 `git stash` 之外单独建分支。
   但**别用 `git status --short` 数自己还剩几个文件**：本仓库 `core.autocrlf=true`，2026-10-18
   实测 354 条里只有 14 条是真内容差，其余 338 条全是行尾符幻影。收工自检用
   `git diff --ignore-cr-at-eol --name-only`；想一次性把历史行尾钉平要单独走
   `git add --renormalize .`，那是要所有人同意的动作，别顺手做。
2. **禁止 `git add -A` / `git add .` / `git commit -a`**：工作区里同时躺着别人的未提交文件。
   只点名要提交的路径。
3. **共享文件（`App.tsx`、`navConfig.ts`、`README.md`、`CHANGELOG.md`）只提交自己那几个 hunk**——先取 HEAD 版本，
   在副本上只打自己的改动，再把副本塞进索引：

   ```powershell
   git show HEAD:src/App.tsx > scratch/base_App.tsx
   # 用脚本在副本上打自己的 3 处改动，每处 assert 命中数==1（防止改错位置）
   $sha = git hash-object -w scratch/staged_App.tsx
   git update-index --cacheinfo 100644,$sha,src/App.tsx
   git commit -m "..."          # 不带 -a；提交后该文件应回到 " M"（别人的改动仍留在工作区）
   git diff --cached --stat     # 每次提交前核对：staged 列表里没有别人的文件
   ```

4. **Windows 侧脚本坑**：Git-Bash 的 `/tmp` 与 Python 的 `/tmp` 不是同一个目录，临时文件统一
   放 `scratch/`（已 gitignore）；含中文的 here-doc 脚本要先 `export PYTHONUTF8=1`，否则
   cp936 解码会把中文字面量变成语法错误；切相对路径用 `os.path.relpath`，别按中文 cwd 切。

## `npm run lint` 的分级口径

`npm run lint` = `eslint . && tsc --noEmit`。ESLint 故意分两级（计数写在 `eslint.config.js` 注释里）：

- **error = 硬线**：只放当前违规数为 0 的规则，新代码一旦引入就红，CI 拦；
- **warn = 存量债**：`no-explicit-any`、`no-console`、`no-unused-vars` 等历史包袱，不阻塞，
  只要求"只降不升"。

**不要加 `--max-warnings`**：并行会话会互相打红。日志一律走 `src/utils/logger.ts`
（生产环境 `debug` / `info` 自动静默），别直接写 `console.*`。

## 闸门读数口径（2026-10-18 定，改闸门前先读这段）

1. **pre-commit 验的是索引树**：`git write-tree` + `git commit-tree` 把待提交内容封成临时
   commit，再 `git worktree add --detach scratch/precommit-wt-$$` 单独检出跑
   `tsc --noEmit` + 全量 `vitest run`。别人未提交的 WIP 既拦不住你，也不该由你负责；
   全量口径由 CI 在完整提交上兜底。旧写法直接扫工作区，2026-10-18 实测一个只动文档的提交
   被并行会话的 9 条 business-loop 红灯拦下 —— 那道门当时是病，不是药。
2. **`.gitattributes` 里 `*.mjs` / `*.cjs` 必须 `eol=lf`**：带 shebang 的脚本被检出成 CRLF 时，
   Vite/vitest 剥 `#!` 行会在模块开头留下裸 `\r`，整个文件 `SyntaxError: Invalid or unexpected
   token`。工作区是 LF 所以本地全绿，临时 worktree 一检出就把口径守卫自己弄挂（真实发生过）。
3. **`npm run metrics:check` / `--fix` 只能在干净检出里跑**：它把 vitest 实测基线写进
   README/CHANGELOG，在共享工作区跑会把别人未提交的测试文件算成口径（我就是这么把
   130/1448 写成 131/1453 的）。复现方法：
   `git worktree add --detach ../pcheck HEAD && cp .env ../pcheck/ && (cd ../pcheck && npm run metrics:check)`。
   另一条同类通路同样危险：**别人把工作区读数暂存进索引，我的提交替它背书** —— 2026-10-18
   `aa3cf5a` 里 README/CHANGELOG 的测试基线被写成了共享工作区的读数（工作区多一个未入库的
   测试文件），而该树真实读数是 131 文件 / 1451 用例，CI 判超报。为此测试文件数那一半已改由
   `tests/project-facts.test.ts` 静态核对（干净检出里静态文件数 == vitest 运行时文件数，实测
   131=131），这条超报在 pre-commit 就会红。该条只拦**超报**、容忍低估 —— 共享工作区里别人
   多一个未入库测试文件时精确匹配会把我自己的门打红；用例数仍需运行时，只有 CI 守。
4. **索引是共享的**：`git commit` 提交的是索引，不是你以为的"我 add 的那几个文件"。2026-10-18
   就发生过并行会话把我刚改的 `scripts/git-hooks/pre-commit` 暂存进去、被我的提交一起带走。
   所以每次 commit 前跑 `git diff --cached --name-only`，并逐文件核对
   `git ls-files -s <path>` 的 blob 是否等于 `git hash-object <path>`。**add 与 commit 之间也算窗口**：
   `aa3cf5a` 就是这样带上了 `README.md`/`CHANGELOG.md` 两行（我当时核对过，暂存表里只有 2 个文件）。
   比这更狠的一次：并行会话拿**过期的索引 blob** 提交，把我已经落地的 `d1f02f7`（README 数字 +
   守卫 + AGENTS 条文）整份静默 revert。索引 blob 只要比 master 旧，任何人的 `git commit` 都会
   把别人的修复还原成它暂存时的样子 —— 所以提交共享文档前先
   `git diff HEAD --ignore-cr-at-eol -- <自己的文件>`，确认自己带的是最新内容而不是"我以为的版本"。
5. **结构性数字的唯一来源是 `scripts/project-facts.mjs`**（表数、迁移区间、AI 能力计数、
   测试规模），由 `tests/project-facts.test.ts` 在 vitest 里核对，README/答辩稿/PPT 抄的都是
   同一份。要改数字先改代码，别改散文。
6. **体积由 `tests/godfile-ratchet.test.ts` 记账**：`src` 下 >300/>800/>1000 行的文件个数
   只许降不许升，三个最大头（`scene.ts`、`EquipmentScene.tsx`、`src/api/index.ts`）按行数单独钉。
   确需上涨时在同一个 commit 里改基线并在提交说明里写理由；本地 `npm test` 数工作区、
   闸门数索引树，两边不一致时以闸门为准，别为了让本地变绿去调基线。
