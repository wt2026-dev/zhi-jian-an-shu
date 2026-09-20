import { KnowledgeRepository } from "../../db/repositories/knowledgeRepository.ts";
import { embed, isEmbeddingAvailable } from "./embeddingService.ts";
import {
  countPending,
  getVectorStoreMode,
  searchSimilar,
} from "../../db/vectorStore.ts";
import { logger } from "../../utils/logger.ts";

// ==================== 知识库混合检索（向量 RAG + 关键词融合） ====================
// 混合流程：
//   ① keywords 拼接为查询文本 → embeddingService.embed() 生成查询向量；
//   ② 向量路：searchSimilar(topK=20) 取语义候选（分数为余弦相似度 0~1）；
//   ③ 关键词路：保留原 includes 打分（降级通道与精确词匹配通道）；
//   ④ 两路按 RRF（reciprocal rank fusion, k=60）融合排序；
//   ⑤ 仅返回 status='approved' 文章（合规约束：向量候选也按 approved 过滤）。
// 降级透明：embed() 返回 null（无 Key/失败/维度异常）时纯关键词路径，行为与历史版本一致。

const VECTOR_TOP_K = 20;
const RRF_K = 60;
// 懒回填提醒节流：至多每 5 分钟提醒一次，禁止在请求链路同步回填
let lastPendingWarnAt = 0;
const PENDING_WARN_INTERVAL_MS = 5 * 60 * 1000;

export async function findRelevantKnowledge(keywords: string[], limit = 5) {
  // 统一以数据库 approved 集合为检索域（关键词路与向量路都在其中过滤）
  const approved = await KnowledgeRepository.getAll({ status: "approved" });
  const byId = new Map<string, any>(approved.map((k: any) => [k.id, k]));

  // ---- 关键词路（保留原打分逻辑）----
  const keywordScoreMap = new Map<string, number>();
  const keywordMatchDetail = new Map<string, string[]>();
  const keywordRanked: string[] = approved
    .map((k: any) => {
      const hay = `${k.title || ""} ${k.category || ""} ${k.targetEquipment || ""} ${(k.tags || []).join(" ")}`;
      const matchedKws = keywords.filter((kw) => kw && hay.includes(kw));
      const score = matchedKws.length;
      if (score > 0) {
        keywordScoreMap.set(k.id, score);
        keywordMatchDetail.set(k.id, matchedKws);
      }
      return { id: k.id, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.id);

  // ---- 向量路 ----
  const vectorRanked: string[] = [];
  const vectorScoreMap = new Map<string, number>();
  const queryText = (Array.isArray(keywords) ? keywords : []).filter(Boolean).join(" ");
  if (queryText) {
    const queryVector = await embed(queryText).catch(() => null);
    if (queryVector) {
      try {
        await getVectorStoreMode(); // 确保存储就绪（幂等）
        const similar = await searchSimilar(queryVector, VECTOR_TOP_K);
        for (const hit of similar) {
          if (byId.has(hit.articleId)) {
            vectorRanked.push(hit.articleId);
            vectorScoreMap.set(hit.articleId, hit.score);
          }
        }
      } catch (err: any) {
        // 向量存储不可用：优雅降级为纯关键词路径
        logger.warn("[RAG] 向量检索失败（回退关键词路径）:", err?.message || err);
      }
    }
  }

  // ---- RRF 融合（k=60）----
  const fused = new Map<string, number>();
  const accumulate = (ranked: string[]) => {
    ranked.forEach((id, rank) => {
      fused.set(id, (fused.get(id) || 0) + 1 / (RRF_K + rank + 1));
    });
  };
  accumulate(keywordRanked);
  accumulate(vectorRanked);

  if (fused.size > 0) {
    return [...fused.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, rrfScore]) => {
        const article = byId.get(id);
        if (!article) return null;
        // 生成可解释理由
        const kwHits = keywordMatchDetail.get(id) || [];
        const vecScore = vectorScoreMap.get(id);
        const reasons: string[] = [];
        if (kwHits.length > 0) reasons.push(`关键词「${kwHits.join("、")}」命中`);
        if (vecScore !== undefined) reasons.push(`语义相似度 ${vecScore.toFixed(3)}`);
        const explanation = reasons.length > 0
          ? `召回理由：${reasons.join("；")}（RRF 综合分 ${rrfScore.toFixed(4)}）`
          : `召回理由：RRF 综合分 ${rrfScore.toFixed(4)}`;
        return { ...article, explanation };
      })
      .filter(Boolean);
  }

  // ---- 懒回填提醒（不阻塞、限频）----
  if (isEmbeddingAvailable() && queryText && Date.now() - lastPendingWarnAt > PENDING_WARN_INTERVAL_MS) {
    lastPendingWarnAt = Date.now();
    try {
      const pending = await countPending();
      const mode = await getVectorStoreMode();
      if (pending > 0) {
        logger.warn(
          `[RAG] 混合检索当前仅命中关键词路（向量库模式: ${mode}）。` +
            `检测到 ${pending} 篇 approved 文章尚未生成 embedding，` +
            `请运行 \`npx tsx scripts/embed-knowledge.ts\` 回填后启用语义召回。`
        );
      }
    } catch {
      /* 提醒失败不影响检索 */
    }
  }

  return [];
}
