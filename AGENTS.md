# 多会话并行开发约定（AI 会话与人类协作者共同遵守）

> 背景：2026-09-19 一天内发生三次并行写入冲突（callouts 开关被来回拨、检修卡片
> 一晚被重写两次、一次 stash 挂起）。每次都靠运气没坏，本文件把它变成流程。

## 文件所有权（写入权 = 1 个会话，其余只读验收）

| 目录 / 文件 | 当前写入方 | 其他会话 |
| --- | --- | --- |
| `src/components/equipment3d/scene.ts` | 会话 A（3D 引擎主责） | 只读 + 建议以文字转交 |
| `src/components/equipment3d/deviceDetailEnv.ts`、`faultLocator.ts`、`cameraFraming.ts` | 会话 A | 只读 |
| `src/components/equipment3d/ProductionHUD.tsx`、`RepairStepCard.tsx` | 会话 B | 只读 |
| `src/components/digital-human/` | 会话 B | 只读 |
| `src/components/game/`（检修闯关） | 会话 C | 只读 |
| `src/components/equipment3d/equipment.ts`（GLB 映射区 77-100 行） | 双方均可**追加**映射行，禁止重排/删除他人行 | — |
| `src/server/**`、`src/db/**` | 改动前必须先在群里说一声 | — |

## 写入规则

1. **动文件前先 `git status` + `git log --oneline -3`**：确认你要改的文件没有
   未提交的他人改动；有 → 先沟通，不要直接覆盖。
2. **小步提交**：一个功能点一个 commit（今天的 `aaa683a`→`fc3ae37` 链就是好的示范）。
   长时间持有的未提交改动是 stash 冲突的根源。
3. **不要重写别人的组件**：要改行为，加 prop / 加开关（参考 `scene.ts` 的
   `FOCUS_CALLOUTS_ENABLED` 模式），把"旧行为一行可恢复"留给对方确认。
4. **临时对比用 `git stash` 时**：pop 之前先 `git stash show --stat` 并确认工作区
   与 stash 的 diff 为空（逐字节一致）再 drop——今天差点弄丢工作区。
5. **同一文件连续被两人改**：后写的一方必须跑 `npx tsc --noEmit` + 全量
   `npx vitest run` 再交付。

## 已知共享热点（改动前额外小心）

- `scene.ts` 的 `setFocusDecorData` / `setFocusDecorSafeArea`（no-op 兼容层）
- `RepairStepCard.tsx` 的 props（3D 内工单操作是三条会话共用的接口面）
- `equipment.ts` 的 `EQUIPMENT_GLB_MAP`（追加行安全，重排不安全）

## 提交纪律（收工标准：`git status --short` 里不剩自己的文件）

1. **未提交的 WIP 会把所有人的 `npm run lint` / `npx tsc --noEmit` 打红**：这两个命令扫的是
   工作区而不是 HEAD。2026-09-19 夜里一条 `StepProgress` 的类型笔误让其他会话改完自己的
   页面后无法自证清白。所以：当天写完当天提，拿不准就先 `git stash` 之外单独建分支。
2. **禁止 `git add -A` / `git add .` / `git commit -a`**：工作区里同时躺着别人的未提交文件。
   只点名要提交的路径。
3. **共享文件（`App.tsx`、`navConfig.ts`）只提交自己那几个 hunk**——先取 HEAD 版本，
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
