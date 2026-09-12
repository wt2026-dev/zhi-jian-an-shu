import { KnowledgeRepository } from "../../db/repositories/knowledgeRepository.ts";

/** 按关键词检索知识库相关文章 (标题/类别/适用设备/标签打分，严格限制为已审核 approved 规程) */
export async function findRelevantKnowledge(keywords: string[], limit = 5) {
  const all = await KnowledgeRepository.getAll({ status: "approved" });
  return all
    .map((k: any) => {
      const hay = `${k.title || ""} ${k.category || ""} ${k.targetEquipment || ""} ${(k.tags || []).join(" ")}`;
      const score = keywords.reduce((acc, kw) => (kw && hay.includes(kw) ? acc + 1 : acc), 0);
      return { k, score };
    })
    .filter((x: any) => x.score > 0)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, limit)
    .map((x: any) => x.k);
}
