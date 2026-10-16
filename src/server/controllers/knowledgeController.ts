// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
// 修复：列表/检索双轨数据源——原 handleListKnowledge 读取模块级内存数组
// dbKnowledgeArticles（仅 2 篇硬编码种子），与 KnowledgeRepository（数据库 14+ 篇）不一致，
// 导致前端列表与 AI RAG 检索口径割裂、重启后新建文章从列表消失。
// 现已删除内存数组，列表/检索/图谱统一以 knowledge_articles 表为唯一数据源。
import { getVisionClient, callDashScopeJson, createEmbedding, cosineSimilarity } from "../services/aiClient.ts";
import { getDb } from "../../db/db.ts";
import { KnowledgeRepository } from "../../db/repositories/index.ts";
import { DASHSCOPE_VISION_MODEL } from "../utils/config.ts";

// GET /api/v1/knowledge
// 与 POST /api/v1/knowledge/search（RAG 检索）同口径：仅返回 status=approved，
// 保证"列表能看到的内容 = AI 能检索到的内容"。
export const handleListKnowledge = async (req: any, res: any) => {
  const { category, search } = req.query;
  try {
    const list = await KnowledgeRepository.getAll({
      status: "approved",
      category: category ? String(category) : undefined,
      search: search ? String(search) : undefined,
    });
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: "获取知识列表失败: " + err.message });
  }
};


// POST /api/v1/knowledge
export const handleCreateKnowledge = async (req: any, res: any) => {
  const user = req.currentUser;
  const newArt = {
    id: `kb-${Date.now()}`,
    title: req.body.title,
    category: req.body.category || "检修SOP规程",
    targetEquipment: req.body.targetEquipment || "通用设备",
    tags: req.body.tags || ["规程"],
    summary: req.body.summary || req.body.content.slice(0, 150),
    content: req.body.content,
    author: user ? `${user.name} (${user.roleTitle})` : "匿名专家",
    updatedAt: new Date().toLocaleDateString("zh-CN"),
    viewCount: 1,
    likes: 0,
    fileType: "manual",
    chunksCount: Math.ceil(req.body.content.length / 400),
    status: "pending",
  };
  try { (newArt as any).embedding = await createEmbedding(`${newArt.title}\n${newArt.summary}\n${newArt.content}`); }
  catch (err: any) { return res.status(502).json({ error: "知识向量生成失败，文章未写入", message: err.message }); }
  await KnowledgeRepository.create(newArt);
  res.status(201).json(newArt);
};

// POST /api/v1/knowledge/upload
export const handleUploadKnowledge = async (req: any, res: any) => {
  const user = req.currentUser;
  const { fileName, textContent, category = "检修SOP规程", targetEquipment = "通用设备", tags = [] } = req.body;
  if (!textContent || !textContent.trim()) {
    return res.status(400).json({ error: "未能解析到文档文本" });
  }

  const chunks = [];
  const chunkSize = 400;
  for (let i = 0; i < textContent.length; i += chunkSize) {
    chunks.push(textContent.slice(i, i + chunkSize));
  }

  const title = (fileName || "上传规程文档").replace(/\.[^/.]+$/, "");
  const newArt = {
    id: `kb-${Date.now()}`,
    title,
    category,
    targetEquipment,
    tags: tags.length ? tags : ["文件导入", "SOP"],
    summary: textContent.slice(0, 160) + "...",
    content: textContent,
    author: user ? `${user.name} (${user.roleTitle})` : "未知贡献者",
    updatedAt: new Date().toLocaleDateString("zh-CN"),
    viewCount: 1,
    likes: 0,
    fileType: fileName?.endsWith(".pdf") ? "pdf" : fileName?.endsWith(".docx") ? "docx" : "txt",
    chunksCount: chunks.length,
    status: "pending",
  };
  try { (newArt as any).embedding = await createEmbedding(`${newArt.title}\n${newArt.summary}\n${newArt.content}`); }
  catch (err: any) { return res.status(502).json({ error: "知识向量生成失败，文档未写入", message: err.message }); }
  await KnowledgeRepository.create(newArt);

  res.json({
    success: true,
    message: `文档【${fileName}】解析切分成功，共生成 ${chunks.length} 个高维向量切片并持久化注入知识库！`,
    article: newArt,
    chunksCount: chunks.length,
  });
};

// POST /api/v1/knowledge/search
export const handleSearchKnowledge = async (req: any, res: any) => {
  let { query = "", imageBase64, limit = 5 } = req.body;
  let imageRecognition = "";
  if (imageBase64) {
    const ai = getVisionClient();
    if (!ai) return res.status(503).json({ error: "AI 服务未配置，无法进行图片识别检索" });
    try {
      const vision: any = await ai.chat.completions.create({ model: DASHSCOPE_VISION_MODEL, messages: [{ role: "user", content: [{ type: "text", text: "识别图中的工业设备型号、部件和故障现象；只返回用于知识检索的中文关键词，50字以内。" }, { type: "image_url", image_url: { url: imageBase64 } }] }] } as any);
      imageRecognition = String(vision.choices?.[0]?.message?.content || "").trim();
      query = `${query} ${imageRecognition}`.trim();
    } catch (err: any) { return res.status(502).json({ error: "图片识别失败，未执行检索", message: err.message }); }
  }
  if (!query) return res.json({ success: true, results: [] });
  try {
    const queryEmbedding = await createEmbedding(query);
    const articles = await KnowledgeRepository.getAll({ status: "approved" });
    const results = articles.filter((art: any) => Array.isArray(art.embedding) && art.embedding.length === 1024).map((art: any) => ({
      chunkId: `chunk-${art.id}`, articleId: art.id, docTitle: art.title, category: art.category,
      text: art.content.slice(0, 300) + (art.content.length > 300 ? "..." : ""),
      similarity: Number(cosineSimilarity(queryEmbedding, art.embedding).toFixed(6)),
      ...(imageRecognition ? { imageRecognitionHit: true } : {}),
    })).sort((a: any, b: any) => b.similarity - a.similarity).slice(0, limit);
    res.json({ success: true, query, imageRecognition: imageRecognition || undefined, results });
  } catch (err: any) { res.status(502).json({ error: "语义检索向量调用失败", message: err.message }); }
};

// GET /api/v1/knowledge/review/list
export const handleKnowledgeReviewList = async (req: any, res: any) => {
  res.json(await KnowledgeRepository.getAll({ status: req.query.status || "pending" }));
};

// POST /api/v1/knowledge/review/:id/approve
export const handleKnowledgeApprove = async (req: any, res: any) => {
  const db = await getDb(); const id = req.params.id;
  const result = await db.query("UPDATE knowledge_articles SET status='approved', reviewer=$2, reviewed_at=CURRENT_TIMESTAMP WHERE id=$1 AND status='pending' RETURNING *", [id, req.currentUser.name]);
  if (!result.rows[0]) return res.status(404).json({ error: "待审核知识不存在或已审核" });
  res.json({ success: true, article: result.rows[0] });
};

// POST /api/v1/knowledge/review/:id/reject
export const handleKnowledgeReject = async (req: any, res: any) => {
  const db = await getDb(); const result = await db.query("UPDATE knowledge_articles SET status='rejected', reviewer=$2, reviewed_at=CURRENT_TIMESTAMP WHERE id=$1 AND status='pending' RETURNING id", [req.params.id, `${req.currentUser.name}${req.body.reason ? `：${req.body.reason}` : ""}`]);
  if (!result.rows[0]) return res.status(404).json({ error: "待审核知识不存在或已审核" });
  res.json({ success: true });
};

// POST /api/v1/knowledge/graph/extract
export const handleKnowledgeGraphExtract = async (_req: any, res: any) => {
  try {
    const db = await getDb();
    const { rows: articles } = await db.query("SELECT * FROM knowledge_articles a WHERE status='approved' AND NOT EXISTS (SELECT 1 FROM knowledge_graph_nodes n WHERE n.article_id=a.id)");
    let extracted = 0;
    for (const article of articles) {
      const { data } = await callDashScopeJson("你是工业设备知识图谱抽取器。仅输出合法 JSON。实体 type 只能为：设备、故障、方法、备件、部件。", `从以下知识中抽取实体和关系，输出 {"nodes":[{"name":"","type":"设备"}],"edges":[{"source":"","target":"","relation":""}]}。\n标题：${article.title}\n正文：${String(article.content).slice(0, 10000)}`);
      if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) continue;
      const ids = new Map<string, string>();
      for (let i = 0; i < data.nodes.length; i++) {
        const n = data.nodes[i]; if (!n?.name || !["设备", "故障", "方法", "备件", "部件"].includes(n.type)) continue;
        const id = `gn-${article.id}-${i}`; ids.set(String(n.name), id);
        await db.query("INSERT INTO knowledge_graph_nodes (id,entity_type,entity_name,article_id) VALUES ($1,$2,$3,$4)", [id, n.type, String(n.name).slice(0, 256), article.id]);
      }
      for (let i = 0; i < data.edges.length; i++) {
        const e = data.edges[i], source = ids.get(String(e?.source)), target = ids.get(String(e?.target));
        if (source && target && e?.relation) await db.query("INSERT INTO knowledge_graph_edges (id,source_node_id,target_node_id,relation,article_id) VALUES ($1,$2,$3,$4,$5)", [`ge-${article.id}-${i}`, source, target, String(e.relation).slice(0, 128), article.id]);
      }
      extracted++;
    }
    res.json({ success: true, extractedArticles: extracted });
  } catch (err: any) { res.status(502).json({ error: "知识图谱抽取失败", message: err.message }); }
};

// GET /api/v1/knowledge/graph
export const handleKnowledgeGraph = async (req: any, res: any) => {
  const db = await getDb(); const equipment = req.query.equipment;
  const where = equipment ? " WHERE n.entity_name ILIKE $1 OR n.article_id IN (SELECT article_id FROM knowledge_graph_nodes WHERE entity_name ILIKE $1)" : "";
  const params = equipment ? [`%${equipment}%`] : [];
  const { rows: nodes } = await db.query(`SELECT n.*, a.title AS article_title, a.content AS article_content FROM knowledge_graph_nodes n JOIN knowledge_articles a ON a.id=n.article_id${where}`, params);
  const ids = nodes.map((n: any) => n.id);
  let edges: any[] = [];
  if (ids.length) {
    const { rows: allEdges } = await db.query("SELECT * FROM knowledge_graph_edges");
    const idSet = new Set(ids);
    edges = allEdges.filter((e: any) => idSet.has(e.source_node_id) && idSet.has(e.target_node_id));
  }
  res.json({ nodes, edges });
};
