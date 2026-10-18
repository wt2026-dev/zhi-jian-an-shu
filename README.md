# 智检安枢——数字孪生驱动的工业装备检修与安全管控一体化平台

以**安全合规为底线**、用 **AI 加速**的设备检修全流程数字化闭环系统：从现场报修、作业审批（高危作业票 / LOTO 能量隔离 / 双人会签）、检修执行到完工质检，每一步安全受控、可追溯、经验可沉淀；深度集成阿里云百炼大模型（故障诊断、视觉质检、混合 RAG 知识检索、检修方案生成等），AI 全程可降级、绝不伪造结果。

## 技术栈

- 前端：React 19 + TypeScript + TailwindCSS + Recharts
- 后端：Node.js 20 + Express 4 + Zod + pino（日志文件轮转）
- 数据：PGlite（嵌入式 PostgreSQL，34 张业务表，幂等迁移与种子）
- AI：阿里云百炼 DashScope（OpenAI 兼容模式，qwen-plus / qwen-vl-max），SSE 流式输出
- 部署：Docker 多阶段构建 + docker compose（含每日 2:00 数据库自动备份服务）

## 快速启动

```bash
# 1. 配置环境变量（JWT_SECRET 必填，缺失拒绝启动）
cp .env.example .env   # 填入 JWT_SECRET 与 DASHSCOPE_API_KEY

# 2. Docker 一键启动
docker compose up -d

# 3. 访问
#    应用：     http://localhost:3000
#    API 文档： http://localhost:3000/api-docs  (Swagger UI)
#    健康检查： http://localhost:3000/health

# 演示账号：admin / Admin@2026#Demo（各角色独立强密码见下表）
# 🛡️【安全合规】演示环境参照等保三级规范设计的安全基线，各角色独立强密码入库
```

### 演示账号表（各角色独立密码）

| 角色岗位 | 登录账号 | 演示密码 | 权限与业务定位 |
|---|---|---|---|
| 总工 / 机电部长（系统管理员） | `admin` | `Admin@2026#Demo` | 全功能访问、系统参数配置、AI 模型接入管理 |
| 车间安全总监 / 维保主管 | `manager` | `Manager@2026#Safe` | 就近派单调度、作业票终审会签、工单质检审核 |
| 机电检修高级技师 | `tech1` | `Tech1@2026#Work` | 工单认领与完工填报、安全作业票申请 |
| 电气专工 / 高压试验负责人 | `tech2` | `Tech2@2026#Elec` | 电气检修、LOTO 能量隔离挂锁与操作 |
| 点检工程师 / 专职安全监护员 | `inspector` | `Inspect@2026#Check` | 巡检点检打卡、安全监护现场确认、完工验收 |
| 巡检主管 / 设备状态点检长 | `inspector2` | `Inspect2@2026#Site` | 巡检路线管理、质检验收审批 |
| 现场生产岗位操作工 | `operator` | `Operator@2026#Line` | 扫码报修、异常工单初创 |
| 吊装司机 / 起重机械操作岗 | `operator2` | `Operator2@2026#Lift` | 吊装作业会签、设备现场报修 |
| 技术档案管理员 / 知识库专员 | `archivist` | `Archive@2026#Doc` | 知识库规程管理、文档归档导出、审计日志查阅 |

> [!NOTE]
> **安全声明（各角色独立密码与首次登录改密策略）**：
> 1. 系统参照等保三级规范设计的安全基线，演示环境为各角色配置独立强密码（大写+小写+数字+特殊符号，长度 ≥ 15 位），经 Bcrypt（cost=10）加盐哈希入库，彻底杜绝通用弱口令风险。
> 2. 系统内置「首次登录强制改密」策略：配置环境变量 `DEMO_FORCE_PASSWORD_CHANGE=true` 时，登录成功后将引导修改初始密码；强制改密默认关闭仅服务于评审演示；生产部署必须开启，且演示密码仅存在于演示环境，生产密码经环境变量注入。


开发模式：`npm install && npm run dev`（tsx 直跑，Vite 中间件热更新）

## 就近调度模块：真实地图配置（可选，强烈建议）

调度大屏默认使用高德地图渲染真实厂区经纬度与球面距离（Haversine）；未配置 Key 或离线时自动降级为平面示意图，不影响演示。

```bash
# 1. 申请高德 Key（个人开发者免费，约 10 分钟）
#    ① 打开 https://lbs.amap.com/ → 右上角登录（支持手机号 / 支付宝快捷登录）
#    ② 进入控制台 → 应用管理 → 我的应用 → 创建应用（名称任意，类型选「效率」）
#    ③ 应用下「添加 Key」：服务平台选「Web端(JS API)」，域名白名单留空（不限域名，localhost 可直接用），勾选同意条款提交
# 2. 将 Key 填入 .env（或 .env.example 复制后填写）
#    VITE_AMAP_KEY=你的Key
# 3. 重启 npm run dev 后，打开「就近调度」大屏即为真实地图模式
```

- 厂区中心经纬度在迁移 `src/db/migrations/019_dispatch_geo.sql` 顶部注释中（示例 113.31, 23.12），拿到真实厂区坐标后替换常量重跑 `npm run db:migrate` 即可（幂等，仅填充空值，不覆盖已上报位置）。
- 师傅位置上报接口支持 `{ lng, lat, status }`（真实经纬度）与 `{ mapX, mapY, status }`（旧平面坐标兼容）；"演示定位"按钮仅在无真实定位设备时演示用。

## 核心功能体系（工业闭环主线 + 3 项高可靠实用 AI）

系统拒绝功能盲目堆砌，确立**“1 条高危作业闭环主线 + 3 项高可靠实用 AI”**为产品核心壁垒，其余功能作为扩展插件：

> **能力数口径（唯一来源 `src/aiCapabilities.ts`）**：**18 项核心 AI 能力**（`status: "core"`，即对外可交付的能力数）；另有 1 项 `transport`（SSE 流式，同一能力的另一种传输形态，**不重复计数**）、2 项 `stub`（接口在、但不宣称 AI 效果的占位实现，**不计数**）、10 项 `internal`（统计/预算/管理面，不是对外能力）。`package.json` 与 openapi 文案的数字均从此表取，`tests/ai-capability-registry.test.ts` 把它钉在**真实注册的 express 路由**上防漂移。
>
> ⚠️ 历史漂移提醒：`CHANGELOG.md` 头部曾写"24 项 AI 能力"、v2.0.0 条目写"20 项"（后者为**当时**的端点总数含 2 个占位接口）。**现行口径是 18 项核心**，以此表为准。

### 1. 核心业务主闭环（工业生产刚需）
`现场报修/异常发现 → 风险隔离与作业票 (双人会签/LOTO) → 派工执行 (乐观锁/状态机) → 完工质检验收 → 经验归档沉淀`
- **检修工单全生命周期**：创建（15 分钟防重复拦截）→ 派单（乐观锁并发防护 + 推荐主修）→ 接单 → 完工上报（BOM/现场照片防伪校验）→ 质检验收 → 归档；状态机严禁非法跳跃 + 完整时间线留痕
- **高危作业管控底线**：六类高危作业票（动火/受限空间/高处等）**双人会签（支持二次安全密码核验与 SHA-256 不可伪造电子签名哈希）**、气体检测阈值强校验、LOTO 智能锁具物理状态联动、JSA 风险交底
- **设备与巡检在控**：6 维设备遥测 48h 时序、测点打卡自动判定、巡检异常一键闭环转工单

### 2. 三大核心高可靠实用 AI（绝不编造，全链路可审计）
1. **故障诊断与根因分析**：输入故障现象与设备型号，输出标准化排查步骤与备件清单；无 Key/弱网时确定性规则引擎平滑降级（`degraded` 显式标记，置信度置空）
2. **检修方案草拟与 JSA 风险预审**：辅助生成安全防范规程与防护交底，输出经由人工审核闸（`ai_generation_reviews`）复核后入库
3. **混合 RAG 检修知识检索**：向量语义检索（DashScope text-embedding-v3）+ 关键词 BM25/RRF 融合重排；所有回答强制附带 `knowledgeSources` 实体依据溯源

### 3. 实验性增值扩展能力（可插拔组件）
- **视觉质检初筛**：qwen-vl-max 多模态轴承磨损与油污识别（附带防爆终端拍摄时间戳与防伪水印校验）
- **扩展交互**：魔珐星云数字人播报、高德地图实时就近调度大屏、语音识别转写、知识图谱拓扑可视化

#### 范围自查（2026-10-17 补记，如实列出"其余"到底有多少）

上面那句"其余功能作为扩展插件"把规模说小了。仓库里实际还存在以下**不在核心主线**的模块，
体量远超"一个插件"，评审时容易被当成"宣称拒绝堆砌、却带着多套子系统交付"：

| 模块 | 体量 | 是否上线（`src/App.tsx` 路由） |
|---|---|---|
| `miniprogram/`（微信小程序端） | 207 个文件，全部纳入版本控制 | 独立端，不在 Web 路由内 |
| `godot-game-maze/`（2D 迷宫·检修闯关） | 118 个文件 / 44 个受控 | **是**，`MazeGameView` 仍被 `React.lazy` 引用 |
| `public/exploded/`（9 个自包含拆解视图 HTML） | 9 页 + `ExplodedViewStage` | 是（设备详情内嵌 iframe） |

结论：核心主线之外还有 **3 套独立子产品**。诚实的说法是
**"1 条高危作业闭环主线 + 3 项核心 AI + 若干可插拔演示模块"**，而不是"系统拒绝功能盲目堆砌"
——后半句容易读成"没有多余功能"，与实际交付面不符。原三套闯关实现已于 2026-10-18 收口为
迷宫版单线：3D 版（`godot-game/`）与 2D 横版（`godot-game-2d/`）的源码及导出
（`public/godot-game/`、`public/godot-game-2d/`）已随清理提交移除，仅保留运行中的迷宫版演示；
`GodotGameView.tsx` 因 `mazeLevels.ts` 引用其 `GodotStepDTO` 类型而保留文件本体，无运行入口。

## 常用命令

> 包管理器统一使用 **npm**（Dockerfile 与 CI 均为 `npm ci`），禁止混用 bun/pnpm/yarn，
> 以唯一锁文件 `package-lock.json` 为准，避免依赖不一致。
> 测试基线：**130 个测试文件 / 1450 个用例**（`npx vitest run` 独立环境实测全绿），
> 类型检查 `npx tsc --noEmit` 零错误（实测 exit 0）。
> 数字随并行会话变动，**以 `npm run metrics:check` 实测为准**，不要手改别处。
> 注意：守卫对 README/CHANGELOG 要求**精确匹配**（不适用"低于实测=历史快照"的宽容），
> 所以并行会话提交/回退用例后本行必然过期 —— 直接跑 `npm run metrics:check -- --fix`
> 重测重写，不要手算。
>
> **2026-10-17 复核修订**：此前本行写作"89 文件 / 1073 用例，1068 通过 / 5 失败"（历史值，不参与校验）<!-- 口径历史快照 -->，并把这 5 项失败
> 一句话解释成"属并行会话在途改动，与主流程无关"——**该措辞不成立**。它们是三个真实缺陷，
> 已全部定位根因并修复（不是靠调宽容差或跳过用例）：
> 1. `tests/equipment3d-focus.test.ts` 包围盒中心偏差 **0.037（相对误差 3.7%）**。
>    根因：`equipment.ts` 先量 `localBounds` 再 `parts.push(auxValve/pressGauge/opScreen)`，
>    而这三个附件是按已算出的 `size` 定位的 ⇒ 申报包围盒漏掉附件。改为 `measureParts()` 在
>    追加后**重测**，74/74 通过；**浮点噪声量级是 `1e-5`，这从来不是"浮点容差"问题**。
> 2. `tests/model-attribution-guard.test.ts` 2 个 GLB 缺署名。已在 `public/models/engineer/ATTRIBUTION.md`
>    补录为**"待补"**——其中 `asian_worker_new.glb` 实测**不是 GLB**（magic bytes 是 `BRAS`，
>    是下载失败残留的网页 HTML）。**作者名未经证实不得编造**。
> 3. 数字人 GLB 回退：`china_engineer.glb`（78 MB）**未被 git 跟踪**，而代码在运行时请求它
>    ⇒ 全新 clone 后数字人静默降级到程序化 3D（详见该 `ATTRIBUTION.md` 的"版本控制缺口"）。
>    相关测试已改为守住**显式** `?dh_backend=procedural` 这条真实支持的路径，不再断言一个
>    已被有意改掉的默认值。

```bash
npm run dev          # 开发模式
npm run build        # 生产构建（前端 + 后端 bundle）
npm test             # 运行全部测试（vitest）
npm run db:migrate   # 手动执行数据库迁移
npm run db:seed      # 幂等导入种子数据
docker compose up -d # 容器化部署
```

## 迁移与种子数据分层说明

本项目严格区分 **DDL 结构迁移** 与 **DML 种子数据** 两类职责，避免"迁移文件里塞业务数据"的常见反模式：

| 类型 | 位置 | 职责 | 幂等策略 |
|---|---|---|---|
| 结构迁移（DDL） | `src/db/migrations/001–027` | 建表 / 加列 / 建索引 | 全部幂等，可重复执行 |
| 运行时种子（DML） | `src/db/seed.ts` + `src/db/seed-data/*.json` | 初始与演示业务数据 | `ON CONFLICT DO UPDATE` / `DO NOTHING` |

**历史兼容说明（主动坦白）**：`008_seed_maintenance_procedures.sql` 与 `014_seed_demo_data.sql` 两个迁移文件内含 DML 种子数据，属项目早期的历史设计——当时 `db:seed` 尚未独立拆分，初始数据随建表一起写入以保证空库启动即可完整演示。删除它们会导致**从零建库时缺失初始数据**，因此**保留不动**，仅在文件头以 ADR 注释完整说明来龙去脉与演进方向。

**新增数据的约定**：新增演示数据一律走 `npm run db:seed`，不再向迁移文件追加 DML，逐步向「迁移 = 纯 DDL」规范收敛。

**数据与代码分离**：纯数据数组已提取至 `src/db/seed-data/*.json`（当前：`users.json` 9 条、`equipments.json` 16 台），`seed.ts` 仅保留数据库操作逻辑，便于数据审阅、复用与独立校验。

## 部署与水平扩展注意

### 单实例约束（当前设计）

本系统当前为**单副本**部署形态。以下组件为**进程内内存实现**，横向扩容前必须先行改造：

| 组件 | 位置 | 单实例约束 | 升级路径 |
|---|---|---|---|
| 接口限流 | `src/server/middleware/rateLimit.ts` | 计数器存于进程堆内存。多副本时同一 IP 的请求分散到不同实例，限流阈值**实际等效放大为「阈值 × 副本数」而失效** | Redis + Lua 原子滑动窗口（`ioredis` + `rate-limit-redis`） |
| 登录防爆破 | 同上（`loginFailureStore`） | 同一 IP 请求落到不同副本时无法累积失败计数，防爆破失效 | Redis `INCR` + `TTL` |
| 嵌入式数据库 | PGlite（默认） | 单机嵌入式，**仅适用于单节点部署** | `DB_TYPE=postgres` 切换至独立 PostgreSQL（已验证 PG 16.15 兼容） |
| 工单日志即时缓存 | `src/server/controllers/workOrderController.ts` | 内存数组（上限 1000 条），仅用于列表/详情即时展示 | 已全量落库，时间线以 `work_order_logs` 表为准，无需改造 |

> ⚠️ **执行 `docker compose up --scale app=N`（N>1）之前**，必须先完成限流/防爆破存储的 Redis 迁移，并切换 `DB_TYPE=postgres`，否则将出现限流失效与数据竞争。
>
> 这是一个**明确的工程取舍**：当前规模下内存实现零依赖、零延迟、零配置；只有在确有水平扩展需求时，才值得引入 Redis 的运维复杂度。

## 数据库表

迁移脚本 `src/db/migrations/` 按编号 001–027 连续唯一（按文件名字典序执行，全部幂等），共 **34 张业务表**：

> 口径说明：`024_video_progress.sql` 只对 `procedure_videos` 加两列（`progress_pct` / `internal_status`），
> **不新建表**；`025_factories.sql` 新增 `factories`（29 → 30）；`026_acceptance_standards.sql` 新增
> `acceptance_standards`（30 → 31）；`027_business_loops.sql` 新增 `business_loops` / `business_loop_stages`
> / `business_loop_artifacts` 三张（31 → 34）。
> 这三处数字由 `scripts/project-facts.mjs` 从迁移 SQL 派生，并由 `tests/project-facts.test.ts` 在
> pre-commit 与 CI 的全量 vitest 里核对 —— 表数与迁移区间不再靠人工对表。

| 分域 | 表 | 说明 |
|---|---|---|
| 用户与权限 | `users` | 支持 status 字段（'active' / 'disabled' 用户启用与停用管控）及 idx_users_status 状态索引 |
| 厂区层级 | `factories` | 025 迁移新增；支撑「全国 → 城市 → 厂区 → 车间 → 设备」五层下钻 |
| 设备与遥测 | `equipments`、`equipment_telemetry` | |
| 工单与日志 | `work_orders`、`work_order_logs` | |
| 安全生产 | `safety_permits`、`loto_locks`、`hazards`、`compliance_checks` |
| 巡检 | `inspections` |
| 知识库与 AI | `knowledge_articles`、`knowledge_embeddings`（向量 RAG）、`ai_feedback`、`ai_analysis_log`、`ai_knowledge_contributions`、`knowledge_graph_nodes`、`knowledge_graph_edges` |
| 作业指引与视频 | `maintenance_procedures`、`procedure_videos` | 024 迁移为 `procedure_videos` 加 `progress_pct` / `internal_status` 两列（不新建表） |
| 备件 | `spare_parts`、`spare_parts_movements` |
| 通知 / 审计 / 文件 | `notifications`、`audit_logs`、`upload_files` |
| AI 协同与治理 | `ai_tasks`、`ai_task_steps`、`ai_generation_reviews`、`ai_model_configs` |
| 修后验收 | `acceptance_standards` | 026 迁移新增；验收标准项与实测值/判定留痕的口径来源 |
| 业务闭环 | `business_loops`、`business_loop_stages`、`business_loop_artifacts` | 027 迁移新增；报修→审批→检修→验收→归档的编排与产物登记 |
| 调度与位置 | `technician_locations` |

## 数据备份

- 容器内 cron 服务每天 02:00 自动备份 PGlite 数据到 `./backups/pglite-backup-<时间戳>.tar.gz`
- 自动保留最近 7 天；手动备份：`bash scripts/backup.sh`（Windows：`powershell -File scripts/backup.ps1`）
- 恢复：`bash scripts/restore.sh backups/<备份文件>`

## 项目结构

```
server.ts               # 兼容入口（装配与业务实现见 src/server/：routes/ controllers/ services/ middleware/）
src/api/index.ts        # 前端 API 客户端
src/components/         # React 视图与 AI 组件
src/db/                 # 迁移 SQL（001–027）、Repository、种子数据
src/utils/logger.ts     # pino 日志（控制台 + 文件轮转）
scripts/                # 备份/恢复脚本
```

> 说明：`backend/`（早期 Python 原型，已由 Node.js 实现替代，2026-09 移除）；历史兼容层 `/api/ai/*` 已全部迁移至版本化 `/api/v1/ai/*` 命名空间，相关遗留文件正式下线退役。
