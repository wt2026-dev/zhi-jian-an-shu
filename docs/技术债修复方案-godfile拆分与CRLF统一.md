# 技术债修复方案：god-file 拆分与行尾符统一

> 2026-10-19 立项。状态：**方案待评审，未执行**。
> 为什么只出方案不动手：`src/api/index.ts` 当前有并行会话的未提交 WIP（验收标准相关），
> `scene.ts` / `EquipmentScene.tsx` 所有权在会话 A（见 AGENTS.md 所有权表），
> `git add --renormalize` 是 AGENTS.md 明文要求全员同意的动作。
> 三把锁都解锁之前，任何一刀都是往并行会话的现场里踩。

## 零、总原则（三条铁律）

1. **纯移动优先**：每一步只搬代码不改行为，行为重构另行立项。搬错可以整体回滚一个 commit。
2. **每步全绿**：`npx tsc --noEmit` + 全量 `npx vitest run` 过了才进下一步；拆分期间
   godfile-ratchet 只降不升，天然满足基线。
3. **不动共享热点**：`equipment.ts` 的 GLB 映射区只追加不重排；`RepairStepCard.tsx`
   的 props 面不碰；`src/server/**`、`src/db/**` 动之前群里说一声。

## 一、CRLF 全仓 renormalize 方案（等全员同意后执行）

现状：`core.autocrlf=true`，`.gitattributes` 已有 `* text=auto` 与 mjs/cjs/sh 的 LF 钉子。
历史实测：一次 diff 里 354 条脏文件只有 14 条是真内容差，其余全是行尾幻影。

### 前置条件（全部满足才允许执行）

- [ ] 所有并行会话手头 WIP 已提交或明确归属，`git status --short` 里没有别人的活文件
- [ ] 群里预告冻结窗口（建议 30 分钟），期间无会话 add/commit
- [ ] `.gitattributes` 先补齐例外清单（见下），这一步单独提交

### .gitattributes 需补的条目

```gitattributes
# 现有基础上补充：
*.ps1 text eol=crlf        # PowerShell 对 CRLF 敏感，且本仓库有 scripts/*.ps1
*.png binary
*.glb binary
*.mp4 binary
*.webm binary
*.zip binary
*.otf binary
```

### 执行步骤

```bash
# 1. 冻结窗口内执行
git add --renormalize .
git diff --cached --stat          # 逐条核对：全部应为"行尾重写"，无内容级差异
git diff --cached --ignore-cr-at-eol --stat   # 此命令输出应为空 —— 这是唯一验收标准

# 2. 单独提交，说明写清"无内容变更"
git commit -m "chore: 全仓行尾符 renormalize（无内容变更，.gitattributes 钉死）"

# 3. 提交后交叉验证
git diff --ignore-cr-at-eol HEAD~1 HEAD --stat   # 应为空
npx tsc --noEmit && npx vitest run               # 全绿
```

### 风险与回滚

- 本机已检出的工作区不会自动重写，混行尾会残留到下次重新检出——可接受，索引里已经干净了。
- shebang 脚本风险（mjs/cjs 剥 `#!` 遇裸 `\r` 炸 SyntaxError）已被现有 `eol=lf` 覆盖，
  renormalize 前先确认这几类文件在暂存区里的 diff 确实是纯行尾。
- 回滚 = revert 该 commit，无数据风险。

## 二、src/api/index.ts 拆分计划（1785 行 → 按业务域分模块）

### 前置条件

- [ ] 当前在途的验收相关 WIP 已提交（谁写的谁提），该文件回到干净状态
- [ ] 动手前 `git log --oneline -3` + `git diff --ignore-cr-at-eol` 确认无他人改动

### 目标结构

```
src/api/
  index.ts          # 收缩为纯 re-export（import * from './domains/*'），调用方 import 路径零改动
  client.ts         # 抽公共 request 封装 / 错误处理 / 通用类型
  domains/
    equipment.ts    # 设备台账 / 遥测 / 3D 模型清单
    workorders.ts   # 工单全生命周期
    safety.ts       # 作业票 / LOTO / 隐患
    inspections.ts  # 巡检点检
    knowledge.ts    # 知识库 / 图谱
    ai.ts           # AI 能力端点（对话/诊断/RAG/质检/审核）
    dispatch.ts     # 就近调度 / 位置上报
    admin.ts        # 模型路由 / 审计 / 用户管理
```

### 渐进路径（一个域一个 commit）

1. 先抽 `client.ts`（公共请求封装），index.ts 内其余代码改为引用它——这一步顺带消灭重复样板。
2. 按上表逐域搬迁：函数体**逐字节**搬到 domains/xxx.ts，index.ts 原 import 关系改为 re-export。
3. 每步：`npx tsc --noEmit` 零错 → 全量 vitest 全绿 → 单独 commit（写明"纯移动，第 N/N 域"）。
4. 全部搬完后 index.ts 应只剩 re-export，行数 < 100。

### 硬约束

- 不重命名任何导出、不改函数签名、不改错误文案（tests 里有快照/文案断言会咬）。
- 调用方（`src/components/**`）**一行不改**——改 import 路径是后续独立课题。
- 若与并行会话的 WIP 在该文件相遇：停手，先沟通，绝不覆盖。

## 三、scene.ts（3743 行）/ EquipmentScene.tsx（2919 行）拆分计划

> 所有权：会话 A。以下供会话 A 执行，或经其书面（群消息即可）同意后由执行方操作。

### scene.ts 切面（按职责切，不按行数切）

| 目标模块 | 内容 | 预估占比 |
|---|---|---|
| `equipment3d/engine/` | renderer / camera / 灯光 / 环境初始化、resize、dispose 生命周期 | ~20% |
| `equipment3d/loader/` | GLTF/GLB 加载、`EQUIPMENT_GLB_MAP` 消费、进度与失败回退 | ~15% |
| `equipment3d/focus/` | 对焦 / callout / 装饰层（`FOCUS_CALLOUTS_ENABLED` 开关随迁） | ~25% |
| `equipment3d/labels/` | 标注 / 标签 / 遥测浮层 | ~15% |
| 保留 `scene.ts` | 编排层：装配上述模块、对外暴露 init/update/dispose | <800 行 |

### EquipmentScene.tsx 切面

1. **先拆非 3D 子树**（风险最低）：HUD 挂载点、检修卡片事件桥、工具栏 → 独立组件文件；
2. **再抽 `useEquipmentScene()` hook**：three.js 生命周期（init/render/dispose）收进 hook，
   组件本体收缩为 JSX 组装层；
3. 3D 内工单操作仍走 `RepairStepCard` 既有 props 面，不改接口。

### 安全网

- `tests/equipment3d-focus.test.ts` 等既有 3D 用例是回归安全网；拆分**开始前**先本地跑一次
  全量并记录读数，之后每步对比。
- 拆分全程禁改 `setFocusDecorData` / `setFocusDecorSafeArea` no-op 兼容层——那是会话间的
  停血协议，等两边模块边界都清晰了再谈删除。

## 四、验收口径（统一）

- `tests/godfile-ratchet.test.ts` 读数下降（或至少不升），三个 god-file 行数单独读数下降；
- `npx tsc --noEmit` 零错，全量 vitest 全绿；
- `git diff --ignore-cr-at-eol --name-only` 收工时不含他人文件；
- 每个中间态都可运行、可演示、可回滚（单 commit 粒度）。

## 五、排期建议（按解锁顺序，不并行抢锁）

1. **随时可做**：CRLF 的 `.gitattributes` 补条目（不含 renormalize 本身）。
2. **等 WIP 清空**：api/index.ts 拆分（预计 3~4 个工作段）。
3. **等会话 A 排期**：scene.ts / EquipmentScene.tsx 拆分（预计 2~3 倍于 api 拆分的工作量）。
4. **等全员同意**：renormalize 一刀切（30 分钟窗口内完成）。
