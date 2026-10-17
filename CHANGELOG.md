# 更新日志（CHANGELOG）

> 本文件按 v2.0.0 发布基线的 12 条语义化提交自动整理，标注本次基线清理范围。
> 历史清理说明：2026-09-13 整理出 12 条发布基线，原始 43 条开发提交完整保留于 `backup/pre-cleanup` 分支；敏感文件历史审计结论为 0 个残留（详见 `docs/敏感文件审计清单.md`）。
>
> **现行口径以 `README.md` 为唯一真源**（2026-10-17 校准）：30 张业务表 / 迁移 001–025 /
> 18 项核心 AI 能力（单一来源 `src/aiCapabilities.ts`；此处原写"24 项"，属漂移，已按表校正） /
> 89 个测试文件 1073 个用例（数字随并行会话变动，以 `npm run metrics:check` 实测为准）。下方各版本条目里的数字是**当时**的快照，
> 按日志惯例保留原值、不回填 —— 带 `口径历史快照` 标记的行由 `npm run metrics:check` 跳过校验。


## [2.0.1] - 2026-09-18（参赛提交收口）

### feat（3D 质感与资产）
- **GLB 资产入库**：六轴机械臂（2.6MB）+ 10 台工业设备模型（约 55MB），全部 CC BY 4.0，署名见各目录 `ATTRIBUTION.md`（`a567583`）
- **bloom 后处理链**：EffectComposer（RenderPass→UnrealBloomPass→OutputPass），按画质档分级；三处性能护栏（medium bloom 半分辨率 / 软渲染检测回退 / 直渲-Composer 两阶段探测 FPS 掉 30% 自动降级）（`93a836b`、`7e66a9d`）
- **选中设备 emissive 蓝调高亮** + 故障定位标签两行布局防裁切（`93a836b`、`82f8108`）

### test（质量证据）
- 新增 13 个纯新增测试文件与 digital-twin/UI 组件（`10833de`），已在全新 worktree 快照中验证；**提交源码口径实测 47 文件 / 412 用例全绿** <!-- 口径历史快照 -->
- 6 个依赖进行中会话未提交改动的测试（telemetry-history / glb-perf / factory-zones / safety-interlock-e2e / seed-permit / work-order-safety-guards）与数字人、视频生成会话文件（`videoHistorySnapshot.ts`、`videoProgress.ts`、`024_video_progress.sql`、`tests/video-*`、`tests/digital-human-*`）**本轮不提交**，待对应会话收口后入库；工作区口径为 57 文件 / 556 用例 <!-- 口径历史快照 -->

### docs（口径终版）
- 测试基线统一为 47/412（提交快照）并注明工作区 57/556 的差异原因；旧口径 193/223/234/237 为历史核对快照，见 `docs/口径数字同步核对表.md`
- 评测双口径保留并各自注明含义：AI 降级评测 11/11（`scripts/ai-eval.ts`，12 条固定样本去 1 条）；PG 生产模式核心回归 15/15（`docs/生产模式验证报告.md`）
- 数据迁移工具 `scripts/migrate-pglite-to-postgres.ts` 现覆盖全部 30 张业务表（早期"仅 12 张核心表"坦白项已随代码补全失效，历史修复报告按当日事实保留）


## [2.0.0] - 2026-09-13

### feat（功能里程碑）
- **初始化与基建**：Vite + React 19 + TypeScript + Express + PGlite 脚手架，Docker/CI/日志基建，001–023 幂等迁移与领域仓储层
- **设备与巡检**：设备台账、六维遥测 48h 时序、巡检点检打卡自动判定、异常一键转工单、AI 趋势预测
- **检修工单全生命周期**：创建（15 分钟防重复）→ 派单（乐观锁并发保护 + AI 推荐主修）→ 接单 → 完工上报 → 质检验收 → 归档；状态机互斥校验 + 完整流转时间线
- **高危作业管控**：六类作业票双人会签、气体检测校验、LOTO 锁具联动、JSA 风险评估；隐患闭环与备件领用
- **知识库与混合 RAG**：DashScope text-embedding-v3（1024 维）向量检索 + 关键词 RRF 融合，pgvector HNSW / JSONB 双模式存储，无 Key 自动回退关键词路径
- **AI 能力矩阵（20 项，7 项 SSE 流式）**：多模型路由与故障转移（AI_MODEL_FAILOVER 审计 + 健康回写）、失败规则引擎降级绝不伪造（degraded 标记）、生成内容人工审核闸（ai_generation_reviews）
- **内部师傅就近调度**：位置上报 / 真实经纬度距离推荐 / 调度大屏 / 一键派单
- **微信小程序**：扫码免登录报修（限流+防重）、工单列表/详情、驾驶舱、遥测健康

### fix（关键修复）
- **安全加固**：全局 API 鉴权基线（默认拒绝 + 白名单）；X-Forwarded-For 防伪造（默认取 socket 地址，TRUST_PROXY/TRUSTED_PROXY_IPS 显式可信）；switch-user 生产下线且仅 admin；审计日志/源码包仅 admin；工单写操作鉴权
- **资源与正确性**：工单日志内存数组 1000 条上限；限流/登录失败 Map 超阈值清扫；登录防爆破计数修复；PGlite 适配器 rowCount 采用真实受影响行数；archiver v8 API 适配
- **知识库单一数据源**：列表与 RAG 检索同口径（approved），消除内存双轨；健康预测降级 statistics 补齐 min 字段

### test（测试体系）
- **33 个测试文件 / 237 个用例全绿** <!-- 口径历史快照 -->，全程离线确定性：`test.env` 隔离外部凭据，AI 路径零真实外部调用
- 安全基线回归（攻击链永久用例）、乐观锁并发、状态机互斥、降级契约验证（`tests/ai-verification.test.ts`）

### docs（文档与评测）
- 全仓口径统一：29 张业务表 / 20 项 AI 能力（7 项 SSE 流式）/ 迁移 001–023 <!-- 口径历史快照 -->
- `docs/AI效果评测基线.md`：无 Key 降级模式 12 条固定样本 **11/11 通过（100%）**（`npx tsx scripts/ai-eval.ts` 可复现）
- `docs/生产模式验证报告.md`：PostgreSQL 16.15 实证——23 个迁移零兼容性问题、PG 模式核心测试 15/15
- `docs/敏感文件审计清单.md`：历史全量审计 **0 个敏感残留**（路径级 + 内容级双重复核）
- 答辩材料：防守话术（AI 深度 / 存储选型）、一页纸速记、提交说明命名规范

### chore（工程治理）
- `.gitattributes` 行尾统一（sh=lf / bat=crlf / md=lf）+ renormalize；.gitignore 补 scratch/；移除 bun.lock 双锁（统一 npm）
- 交付 zip 重建（443 文件白名单，排除 .env/运行时/内部文档）
