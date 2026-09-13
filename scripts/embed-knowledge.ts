/**
 * 知识库 embedding 回填脚本（幂等，可重复执行）。
 *
 * 用法：npx tsx scripts/embed-knowledge.ts
 *
 * 行为：
 *   1. 扫描所有 status='approved' 且在 knowledge_embeddings 中无向量的文章；
 *   2. 打印预估 API 调用次数（每批 1 次、每批 ≤ 10 篇，兼容模式单请求上限）；
 *   3. 分批调用 embedBatch 生成向量 → upsertEmbedding 落库（ON CONFLICT 覆盖）；
 *   4. 输出成功/失败/跳过统计；失败项下次重跑自动重试（仅扫描无向量文章）。
 *
 * 注意：未配置 DASHSCOPE_API_KEY 时脚本直接退出（embedBatch 全部返回 null，
 * 不会写入任何脏数据）；系统运行期不依赖本脚本——检索会透明回退关键词路径。
 */
import { initDatabase, getDb } from "../src/db/db.ts";
import {
  countEmbedded,
  countPending,
  getVectorStoreMode,
  initVectorStore,
  upsertEmbedding,
} from "../src/db/vectorStore.ts";
import { embedBatch, isEmbeddingAvailable } from "../src/server/services/embeddingService.ts";

const BATCH_SIZE = 20; // 每批文章数（内部按兼容模式单请求 ≤ 10 条再细分 API 调用）

async function main() {
  console.log("[EmbedBackfill] 初始化数据库...");
  await initDatabase();
  const mode = await initVectorStore();
  console.log(`[EmbedBackfill] 向量存储模式: ${mode}`);

  if (!isEmbeddingAvailable()) {
    console.error(
      "[EmbedBackfill] 未配置 DASHSCOPE_API_KEY，无法生成 embedding。请在 .env 配置后重试；" +
        "系统检索功能不受影响（自动回退关键词路径）。"
    );
    process.exit(1);
  }

  const pending = await countPending();
  const embedded = await countEmbedded();
  if (pending === 0) {
    console.log(`[EmbedBackfill] 无待回填文章（已有 embedding: ${embedded} 篇），退出。`);
    return;
  }

  // 预估调用次数：批量接口每批 ≤ 10 篇 → 每批 1 次调用
  const estimatedApiCalls = Math.ceil(pending / 10);
  console.log(
    `[EmbedBackfill] 待回填 ${pending} 篇，预计 DashScope API 调用约 ${estimatedApiCalls} 次` +
      `（每批 ≤10 篇 × 1 次调用，text-embedding-v3, 1024 维）。`
  );

  const db = await getDb();
  const { rows } = await db.query(
    `SELECT a.id, a.title, a.summary, a.content
     FROM knowledge_articles a
     WHERE a.status = 'approved'
       AND NOT EXISTS (SELECT 1 FROM knowledge_embeddings e WHERE e.article_id = a.id)
     ORDER BY a.id DESC`
  );
  const articles: any[] = rows || [];
  console.log(`[EmbedBackfill] 实际扫描到 ${articles.length} 篇，开始分批回填（每批 ${BATCH_SIZE} 篇）...`);

  let success = 0;
  let failed = 0;
  const startedAt = Date.now();

  for (let start = 0; start < articles.length; start += BATCH_SIZE) {
    const batch = articles.slice(start, start + BATCH_SIZE);
    // 拼接标题+摘要+正文截断，作为 embedding 输入（与检索语义对齐）
    const inputs = batch.map((a) => `${a.title || ""}\n${a.summary || ""}\n${String(a.content || "").slice(0, 4000)}`);
    const vectors = await embedBatch(inputs);

    for (let i = 0; i < batch.length; i++) {
      const article = batch[i];
      const vector = vectors[i];
      if (!vector) {
        failed += 1;
        console.warn(`[EmbedBackfill] 失败: ${article.id} 《${String(article.title).slice(0, 40)}》`);
        continue;
      }
      try {
        await upsertEmbedding(article.id, vector, "text-embedding-v3");
        success += 1;
      } catch (err: any) {
        failed += 1;
        console.warn(`[EmbedBackfill] 落库失败: ${article.id}:`, err?.message || err);
      }
    }
    console.log(
      `[EmbedBackfill] 进度: ${Math.min(start + BATCH_SIZE, articles.length)}/${articles.length}（成功 ${success} / 失败 ${failed}）`
    );
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[EmbedBackfill] 完成。成功 ${success}，失败 ${failed}（失败项重跑本脚本即可重试），` +
      `当前已有 embedding 共 ${await countEmbedded()} 篇，耗时 ${elapsedSec}s，模式 ${await getVectorStoreMode()}。`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[EmbedBackfill] 异常退出:", err?.message || err);
    process.exit(1);
  });
