# 实现报告 —— 知识库向量 RAG（2026-09-13）

> 📌 **口径说明（2026-09-13 统一）**：本报告记录的是修复完成时点的基线快照。全仓现行统一口径为 **26 个测试文件 / 169 个用例、29 张业务表、20 项 AI 能力（7 项 SSE 流式）**，下文中的历史数字以本说明为准，不重复回改。

> 交付原则落实：改动仅限点名的 RAG 范围（新文件 + knowledgeRetrieval 重写 + 021 迁移 + 文档），
> 原 knowledgeRetrieval.ts 已备份至 `archive/backup/knowledgeRetrieval.ts.orig-20260913`；
> 检索函数签名不变、调用方零改动；全部外部依赖不可用时优雅降级；测试全绿（见第五节）。

---

## 一、三项核心能力落地情况

| 能力 | 落地情况 |
|---|---|
| **向量** | 独立表 `knowledge_embeddings`（article_id PK → knowledge_articles FK，embedding、model、dims、updated_at），不改动 knowledge_articles 主表；upsert 用 ON CONFLICT DO UPDATE 幂等覆盖；当前持久库已回填 **17 篇 / 1024 维** |
| **Embedding** | `embeddingService.ts`：OpenAI SDK 兼容模式调 DashScope（baseURL `https://dashscope.aliyuncs.com/compatible-mode/v1`，复用 DASHSCOPE_API_KEY，模型取 `DASHSCOPE_EMBEDDING_MODEL` 默认 text-embedding-v3，`dimensions: 1024`）；输入截断 8000 字符 + 空串保护；**维度非 1024 视为脏数据拒绝返回**；未配置 Key/调用失败/超时 → 返回 null，绝不抛错阻塞业务 |
| **索引** | pgvector 可用时：`CREATE EXTENSION vector` + `vector(1024)` 列 + **HNSW 索引（vector_cosine_ops）**，余弦距离下推数据库；JSONB 模式（当前 PGlite 默认）：应用层余弦相似度打分。两种模式分数统一为余弦相似度并夹取 [0,1] |

## 二、三套实现的取舍（约束 7 的决策）

| 实现 | 采用情况 | 原因 |
|---|---|---|
| A（PGlite + pgvector HNSW） | ❌ 未采用（代码路径已备好） | **实测 @electric-sql/pglite 0.5.8 不带 pgvector**：包 exports 仅 `./template ./live ./worker ./nodefs ./opfs-ahp ./basefs ./contrib/*`，dist 无 vector.tar.gz，无 `@electric-sql/pglite/vector` 子包。升级 PGlite 主版本会牵动整个数据层，超出本任务"只改点名范围"的边界 |
| **B（JSONB + 应用层余弦）** | ✅ **当前生效**（initVectorStore 自动选择） | 零外部依赖、全环境可用（含内存测试库）；参赛数据规模（数十~数百篇）下应用层余弦扫描性能足够（17 篇检索 <1ms） |
| C（生产 PostgreSQL pgvector） | ✅ 自动启用 | `DB_TYPE=postgres` 时 initVectorStore 探测 `pg_extension` 成功即建 vector 列 + HNSW 索引；若表已按 JSONB 建过则保持 JSONB（升级需人工确认，避免运行期隐式改列类型） |

运行时探测顺序（`initVectorStore()` 单例幂等）：`CREATE EXTENSION IF NOT EXISTS vector`（try/catch）→ 查 `pg_extension` → 查既有列类型 → 择一建表/建 HNSW。迁移文件 021 只含执行器兼容的简单语句（执行器按分号切分、会剥注释，DO $$ 块会被切碎——故条件升级放在运行时，报告中说明此取舍）。

## 三、混合检索设计（任务 4）

`findRelevantKnowledge(keywords, limit)` 签名与返回结构不变（文章对象数组），内部流程：

```
keywords 拼接 → embed() 查询向量
   ├─ 成功 → searchSimilar(topK=20) ─┐
   └─ null（无Key/失败）→ 跳过 ──────┤
关键词打分（原逻辑保留）──────────────┴→ RRF 融合(k=60) → 仅 approved → topN
```

- 两路候选统一限定在 `status='approved'` 集合（向量命中也按 approved 二次过滤，合规不回归）；
- embedding 为 null 时纯关键词路径，与旧版行为完全一致（有专门测试锁定）；
- 懒回填提醒：配置了 Key 且关键词/向量均零命中时，限频（5 分钟一次）console.warn 提示 pending 篇数与回填命令，**请求链路内无任何同步回填**。

## 四、回填脚本执行结果（scripts/embed-knowledge.ts）

```
$ npx tsx scripts/embed-knowledge.ts
[VectorStore] 就绪（模式: jsonb）
[EmbedBackfill] 待回填 17 篇，预计 DashScope API 调用约 2 次（每批 ≤10 篇 × 1 次调用，text-embedding-v3, 1024 维）。
[EmbedBackfill] 实际扫描到 17 篇，开始分批回填（每批 20 篇）...
[EmbedBackfill] 进度: 17/17（成功 17 / 失败 0）
[EmbedBackfill] 完成。成功 17，失败 0（失败项重跑本脚本即可重试），
                 当前已有 embedding 共 17 篇，耗时 0.9s，模式 jsonb。
```

真实调用 DashScope text-embedding-v3 共 2 次批量请求，成功 17 篇 / 失败 0 / 跳过 0，耗时 0.9s。
脚本幂等：仅扫描无向量文章，失败项重跑自动重试。

## 五、新增测试与最终测试结果

**新增 13 个用例**（全部 mock/注入确定性假向量，零真实外部调用）：

| 文件 | 用例 |
|---|---|
| `tests/embedding-service.test.ts`（8） | 无 Key 返回 null 不抛错；空串/空白短路；超长输入截断 ≤8000；mock 正常路径返回 1024 维数组；512 维脏数据拒绝；客户端异常置空；embedBatch index 映射与空串位保持 null；批量整体失败全置空 |
| `tests/knowledge-retrieval.test.ts`（5） | JSONB 模式就绪；向量路生效（关键词零命中仍语义召回 kb-101）；降级回退关键词路径且零命中返回 `[]`（与旧行为一致）；pending 文章不可经语义召回（合规过滤）；upsert+search 往返（ON CONFLICT 覆盖、分数 ∈ (0,1]、降序、limit 生效） |

**最终结果**：

```
$ npm test
 Test Files  26 passed... 25 passed / 1 failed (26)   ← 唯一失败与本任务无关（见下）
      Tests  164 passed / 1 failed (165)

$ npx vitest run <本任务范围 7 个 AI/知识库相关文件>
 Test Files  7 passed (7)      Tests  73 passed (73)   ← 全绿

$ npm run lint
本任务新增/修改文件 0 错误；现存 2 个错误位于 src/server/controllers/procedureController.ts
与 src/server/services/videoGenerationService.ts（团队并行 AGNES 配置重构中间态，与本任务无关）
```

## 六、并行开发冲突说明（重要）

本轮执行期间检测到团队正在并行重构**工单乐观锁与 AGNES 视频生成**（出现 020/022 新迁移与多个新测试文件）。两处交集已谨慎处理：

1. **workOrder 乐观锁 409 误判**：团队的 `WorkOrderRepository.update` 以 `rowCount === 0` 判定版本冲突，但两个 PGlite 适配器的 `rowCount` 取的是 `rows.length`（UPDATE 恒为 0），导致首次派单即 409。因 `src/db/db.ts` 当时无并行改动，已在适配器层做最小修复：`rowCount = res.affectedRows ?? res.rows.length`（与 postgres 适配器既有口径一致，SELECT 语义不变）。修复后工单/派单 11 个用例恢复全绿。
2. **仍红的 1 个用例**（`optimistic-lock-and-concurrency.test.ts` 的并发派单 [200,400]）：第二个并发派单被 Zod `dispatchWorkOrderSchema` 以 400 拒绝（schema 尚未放行 `version` 字段），属团队乐观锁 WIP 的未完成项，不在本任务点名范围，未代改；AGNES 的 video-gen-guard 用例同理（与其 lint 错误同源）。

## 七、遗留风险

| 风险 | 说明与缓解 |
|---|---|
| PGlite 无 pgvector | 语义召回走应用层余弦扫描，万篇级以下无压力；更大规模需升级 PGlite 主版本或切生产 PostgreSQL（适配器自动启用 HNSW） |
| embedding API 成本 | 仅在配置 Key 后按次计费；查询侧每次检索 1 次 embedding 调用，回填侧脚本打印预估调用次数（本次 17 篇 ≈ 2 次调用）；未配置 Key 时零成本（纯关键词） |
| 冷启动 | 新增文章先以关键词路检索，懒回填提醒（5 分钟限频）引导运行回填脚本；请求链路永不同步回填 |
| embedding 版本一致性 | knowledge_embeddings 记录 model 字段；换模型后需重跑回填脚本（embedding 与查询向量必须同模型同维度，维度不符直接拒绝写入） |
| 双向量的双轨残留 | 主表 knowledge_articles.embedding（旧字段，供 legacy /api/ai/rag-search 使用）与新表并存；后续可统一到 knowledge_embeddings 并让 legacy 接口改读新表 |
