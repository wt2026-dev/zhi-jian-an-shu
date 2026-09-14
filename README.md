# 工业设备智能检修与作业协同系统

以**安全合规为底线**、用 **AI 加速**的设备检修全流程数字化闭环系统：从现场报修、作业审批（高危作业票 / LOTO 能量隔离 / 双人会签）、检修执行到完工质检，每一步安全受控、可追溯、经验可沉淀；深度集成阿里云百炼大模型（故障诊断、视觉质检、混合 RAG 知识检索、检修方案生成等），AI 全程可降级、绝不伪造结果。

## 技术栈

- 前端：React 19 + TypeScript + TailwindCSS + Recharts
- 后端：Node.js 20 + Express 4 + Zod + pino（日志文件轮转）
- 数据：PGlite（嵌入式 PostgreSQL，29 张业务表，幂等迁移与种子）
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

## 核心功能

- **检修工单全生命周期**：创建（15 分钟防重复拦截）→ 派单（乐观锁并发防护 + AI 推荐主修）→ 接单 → 完工上报（BOM/照片）→ 质检验收 → 归档；状态机互斥校验 + 完整流转时间线
- **设备健康监测**：6 维遥测 48h 时序、健康评分、AI 趋势预测（统计特征研判）
- **巡检作业**：测点打卡自动判定、异常一键转工单、AI 工单草稿、巡检报告生成
- **高危作业管控**：六类作业票双人会签、气体检测校验、LOTO 锁具联动、AI 风险评估（JSA）
- **AI 智能体（20 项 AI 能力，其中 7 项支持 SSE 流式输出）**：流式对话、故障诊断、视觉缺陷识别、**向量检索 + 关键词融合的混合 RAG**（DashScope text-embedding-v3，1024 维；pgvector HNSW 索引，PGlite 环境自动降级为 JSONB 向量 + 应用层余弦相似度；无 Key 时透明回退关键词检索）、根因分析、检修方案、健康画像、智能报告、风险评估、辅助派单、报警关联分析、语音转写、视频分析、多模态检索、AI 任务编排等；全部真实数据驱动，失败时规则引擎降级（degraded 标记），不伪造结果
- **安全与合规**：RBAC 细粒度权限、全量操作审计、Zod 参数校验、SSE 鉴权

## 常用命令

> 包管理器统一使用 **npm**（Dockerfile 与 CI 均为 `npm ci`），禁止混用 bun/pnpm/yarn，
> 以唯一锁文件 `package-lock.json` 为准，避免依赖不一致。
> 测试基线：**32 个测试文件 / 223 个用例全绿**（`npm test`），类型检查 `npm run lint` 零错误。

```bash
npm run dev          # 开发模式
npm run build        # 生产构建（前端 + 后端 bundle）
npm test             # 运行全部测试（vitest）
npm run db:migrate   # 手动执行数据库迁移
npm run db:seed      # 幂等导入种子数据
docker compose up -d # 容器化部署
```

## 数据库表

迁移脚本 `src/db/migrations/` 按编号 001–023 连续唯一（按文件名字典序执行，全部幂等），共 **29 张业务表**：

| 分域 | 表 | 说明 |
|---|---|---|
| 用户与权限 | `users` | 支持 status 字段（'active' / 'disabled' 用户启用与停用管控）及 idx_users_status 状态索引 |
| 设备与遥测 | `equipments`、`equipment_telemetry` | |
| 工单与日志 | `work_orders`、`work_order_logs` | |
| 安全生产 | `safety_permits`、`loto_locks`、`hazards`、`compliance_checks` |
| 巡检 | `inspections` |
| 知识库与 AI | `knowledge_articles`、`knowledge_embeddings`（向量 RAG）、`ai_feedback`、`ai_analysis_log`、`ai_knowledge_contributions`、`knowledge_graph_nodes`、`knowledge_graph_edges` |
| 作业指引与视频 | `maintenance_procedures`、`procedure_videos` |
| 备件 | `spare_parts`、`spare_parts_movements` |
| 通知 / 审计 / 文件 | `notifications`、`audit_logs`、`upload_files` |
| AI 协同与治理 | `ai_tasks`、`ai_task_steps`、`ai_generation_reviews`、`ai_model_configs` |
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
src/db/                 # 迁移 SQL（001–023）、Repository、种子数据
src/utils/logger.ts     # pino 日志（控制台 + 文件轮转）
scripts/                # 备份/恢复脚本
```

> 说明：`backend/`（早期 Python 原型，已由 Node.js 实现替代，2026-09 移除）；历史兼容层 `/api/ai/*` 已全部迁移至版本化 `/api/v1/ai/*` 命名空间，相关遗留文件正式下线退役。
