# 工业设备智能检修与作业协同系统

面向流程制造企业的设备检修数字化与 AI 辅助决策平台：覆盖设备台账、巡检点检、检修工单全生命周期、高危作业票与 LOTO 能量隔离、知识库 RAG、通知与审计，并深度集成阿里云百炼大模型（14 项 AI 能力）。

## 技术栈

- 前端：React 19 + TypeScript + TailwindCSS + Recharts
- 后端：Node.js 20 + Express 4 + Zod + pino（日志文件轮转）
- 数据：PGlite（嵌入式 PostgreSQL，23 张业务表，幂等迁移与种子）
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

# 演示账号：admin / password123（更多角色见 用户操作手册）
```

开发模式：`npm install && npm run dev`（tsx 直跑，Vite 中间件热更新）

## 核心功能

- **检修工单全生命周期**：创建（15 分钟防重复拦截）→ 派单（乐观锁并发防护 + AI 推荐主修）→ 接单 → 完工上报（BOM/照片）→ 质检验收 → 归档；状态机互斥校验 + 完整流转时间线
- **设备健康监测**：6 维遥测 48h 时序、健康评分、AI 趋势预测（统计特征研判）
- **巡检作业**：测点打卡自动判定、异常一键转工单、AI 工单草稿、巡检报告生成
- **高危作业管控**：六类作业票双人会签、气体检测校验、LOTO 锁具联动、AI 风险评估（JSA）
- **AI 智能体（14 项）**：流式对话、故障诊断、视觉缺陷识别、RAG 问答、根因分析、检修方案、健康画像、智能报告、风险评估、辅助派单、报警关联分析等；全部真实数据驱动，失败时规则引擎降级（degraded 标记），不伪造结果
- **安全与合规**：RBAC 细粒度权限、全量操作审计、Zod 参数校验、SSE 鉴权

## 常用命令

```bash
npm run dev          # 开发模式
npm run build        # 生产构建（前端 + 后端 bundle）
npm test             # 运行全部测试（vitest）
npm run db:migrate   # 手动执行数据库迁移
npm run db:seed      # 幂等导入种子数据
docker compose up -d # 容器化部署
```

## 数据库表

迁移脚本 `src/db/migrations/` 按编号 001–017 连续唯一（按文件名字典序执行，全部幂等），共 **27 张业务表**：

| 分域 | 表 |
|---|---|
| 用户与权限 | `users` |
| 设备与遥测 | `equipments`、`equipment_telemetry` |
| 工单与日志 | `work_orders`、`work_order_logs` |
| 安全生产 | `safety_permits`、`loto_locks`、`hazards`、`compliance_checks` |
| 巡检 | `inspections` |
| 知识库与 AI | `knowledge_articles`、`ai_feedback`、`ai_analysis_log`、`ai_knowledge_contributions`、`knowledge_graph_nodes`、`knowledge_graph_edges` |
| 作业指引与视频 | `maintenance_procedures`、`procedure_videos` |
| 备件 | `spare_parts`、`spare_parts_movements` |
| 通知 / 审计 / 文件 | `notifications`、`audit_logs`、`upload_files` |
| AI 协同与治理 | `ai_tasks`、`ai_task_steps`、`ai_generation_reviews`、`ai_model_configs` |

## 数据备份

- 容器内 cron 服务每天 02:00 自动备份 PGlite 数据到 `./backups/pglite-backup-<时间戳>.tar.gz`
- 自动保留最近 7 天；手动备份：`bash scripts/backup.sh`（Windows：`powershell -File scripts/backup.ps1`）
- 恢复：`bash scripts/restore.sh backups/<备份文件>`

## 项目结构

```
server.ts               # 兼容入口（装配与业务实现见 src/server/：routes/ controllers/ services/ middleware/）
src/api/index.ts        # 前端 API 客户端
src/components/         # React 视图与 AI 组件
src/db/                 # 迁移 SQL（001–017）、Repository、种子数据
src/utils/logger.ts     # pino 日志（控制台 + 文件轮转）
scripts/                # 备份/恢复脚本
```

> 说明：`backend/`（早期 Python 原型，已由 Node.js 实现替代，2026-09 移除）。
