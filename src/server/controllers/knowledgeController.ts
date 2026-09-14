// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import { getAiClient, callDashScopeJson, createEmbedding, cosineSimilarity } from "../services/aiClient.ts";
import { getDb } from "../../db/db.ts";
import { KnowledgeRepository } from "../../db/repositories/index.ts";
import { DASHSCOPE_VISION_MODEL } from "../utils/config.ts";

// 对应 server.ts createApp 闭包内的 `let dbKnowledgeArticles`（种子数据逐字保留），
// 因 server.ts 保持只读，拆出模块无法共享其闭包变量，故在本模块内持有同一份可变状态。
export let dbKnowledgeArticles: any[] = [
  {
    id: "kb-101",
    title: "离心式给水泵滚动轴承与机械密封过热故障树分析与快速排除SOP",
    category: "检修SOP规程",
    targetEquipment: "离心泵类",
    tags: ["离心泵", "轴承发热", "机械密封", "振动超标", "国家规程"],
    summary: "针对大型离心式给水泵非驱动端/驱动端轴承外壳温升超标（>75℃）与机封泄漏的故障树展开分析，涵盖润滑油劣化、动静环偏磨与同轴度超标处置步骤。",
    content: `### 一、轴承箱温升超标排查 SOP 步骤
1. 测温复核：使用双波段红外测温枪，复测轴承外壳及端盖温度。若温度持续攀升超过 80℃ 或温升速率 > 1℃/min，必须立即汇报调度减负荷或倒换备用泵；
2. 润滑状态诊断：检查轴承箱视油镜油位，正常油位应保持在中心线 1/2 至 2/3 位置；补充注脂时切忌过量，滚动轴承内部空隙填充率以 1/3~1/2 为宜；
3. 振动与轴对中复核：使用激光对中仪测量电机与泵联轴器径向与角向跳动，径向公差要求 ≤0.05 mm；若出现 2X 工频振动，重点排查软脚与不对中。

### 二、机械密封微量滴漏处理规程
1. 正常机封泄漏量标准为 ≤3 滴/min；
2. 若泄漏呈持续水线，检查冷却冲洗水路压力；停机拆检时，必须核对静环与动环端面平面度，严禁硬敲密封面。`,
    author: "张建国 (高级技师)",
    updatedAt: "2026-09-01",
    viewCount: 142,
    likes: 28,
    fileType: "manual",
    chunksCount: 2,
  },
  {
    id: "kb-102",
    title: "工业螺杆空压机主机排气高温与末级油气分离压差大处置指南",
    category: "故障树分析",
    targetEquipment: "螺杆空压机",
    tags: ["空压机", "排气高温", "油分压差", "阿特拉斯", "周期维保"],
    summary: "详细阐述阿特拉斯无油及喷油螺杆空压机出现温度保护跳机、温控阀卡阻、热交换器结垢和油气分离滤芯压差超标时的诊断方法与零件更换规范。",
    content: `### 螺杆空压机排气高温故障排查流程
1. 环境与通风核查：确认空压机房环境温度低于 40℃，导风罩滤网无积灰柳絮堵塞；
2. 温控阀芯测试：当油温达到 71℃ 时温控阀应开启，85℃ 时应全开旁路流向冷却器；若进出口温差 < 3℃，判定温控阀卡死，需更换阀芯；
3. 油分芯压差判定：监控机头控制屏上的油分压差（Delta P），标准允许压差为 ≤0.8 bar，超过 1.0 bar 必须立即更换油气分离滤芯。`,
    author: "李志强 (电气专工)",
    updatedAt: "2026-08-28",
    viewCount: 96,
    likes: 19,
    fileType: "manual",
    chunksCount: 2,
  },
];

// 供其他拆出模块（如 contributionController）整体替换该闭包态数组（对应 `dbKnowledgeArticles = ...` 赋值）
export function setDbKnowledgeArticles(list: any[]) {
  dbKnowledgeArticles = list;
}

// GET /api/v1/knowledge
export const handleListKnowledge = (req: any, res: any) => {
  const { category, search } = req.query;
  let list = [...dbKnowledgeArticles];
  if (category && category !== "all") list = list.filter((a) => a.category === category);
  if (search) {
    const q = String(search).toLowerCase();
    list = list.filter((a) => a.title.toLowerCase().includes(q) || a.summary.toLowerCase().includes(q) || a.content.toLowerCase().includes(q));
  }
  res.json(list);
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
  dbKnowledgeArticles.unshift(newArt);
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
  dbKnowledgeArticles.unshift(newArt);

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
    const ai = getAiClient();
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
  setDbKnowledgeArticles(await KnowledgeRepository.getAll()); res.json({ success: true, article: result.rows[0] });
};

// POST /api/v1/knowledge/review/:id/reject
export const handleKnowledgeReject = async (req: any, res: any) => {
  const db = await getDb(); const result = await db.query("UPDATE knowledge_articles SET status='rejected', reviewer=$2, reviewed_at=CURRENT_TIMESTAMP WHERE id=$1 AND status='pending' RETURNING id", [req.params.id, `${req.currentUser.name}${req.body.reason ? `：${req.body.reason}` : ""}`]);
  if (!result.rows[0]) return res.status(404).json({ error: "待审核知识不存在或已审核" });
  setDbKnowledgeArticles(await KnowledgeRepository.getAll()); res.json({ success: true });
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
