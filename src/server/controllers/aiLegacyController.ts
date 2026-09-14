// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
// 兼容保留：本模块由 src/server/routes/aiLegacy.ts 挂载为 /api/ai/* 无鉴权兼容层（历史前端/第三方调用仍在用），
// 新代码请走 aiPipelineController（协同任务）或 v1 鉴权端点；全部 5 个导出均被挂载，无未使用导出。
import { getAiClient, extractAiJson } from "../services/aiClient.ts";
import { generateFallbackExpertReply, generateFallbackDiagnosis } from "../services/aiExpert.ts";
import { DASHSCOPE_CHAT_MODEL, DASHSCOPE_VISION_MODEL } from "../utils/config.ts";
import { getDb } from "../../db/db.ts";
import { runFaultDiagnosisCore } from "../services/aiCapabilityService.ts";

// ==================== legacy AI 路由 handler ====================

export async function handleAiChat(req: any, res: any) {
  try {
    const { message, history = [], contextData = {} } = req.body;
    const ai = getAiClient();

    const systemPrompt = `你是一位拥有20年工业重型设备（离心泵、压缩机、减速机、大型变频电机、数控机床、工业机器人）检修与安全生产管理经验的特级设备检修与安全专家，运行于《设备检修知识检索与作业系统 v2.0.0》。
上下文信息:
${JSON.stringify(contextData, null, 2)}

请针对用户提出的工业设备故障排查、SOP规程、检修技巧、安全防护、参数异常等问题，提供专业、清晰、分步骤、具备工程落地可操作性的指导。
你的回答必须遵循以下规则：
1. 结构清晰严谨，使用 Markdown 格式输出（分段小标题、序号步骤、加粗重点参数与验收标准）。
2. 涉及危险作业（高压断电、动火、受限空间、登高、吊装、机械卷入、有毒介质）时，必须附带醒目的【安全警示】并明确给出 GB 30871 规范与 LOTO 能量隔离（停电挂牌上锁验证零能量）要点。
3. 给出清晰的根本机理推断、排查优先级清单、所需工器具与通用备件规格，以及预防性维护策略，保持工程专业严谨，不闲聊。`;

    if (ai) {
      try {
        // 阿里云百炼 DashScope OpenAI 兼容模式：多轮 messages 对话
        const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
          { role: "system", content: systemPrompt },
          ...history
            .filter((h: { role: string; content: string }) => h.content)
            .map((h: { role: string; content: string }) => ({
              role: (h.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
              content: h.content,
            })),
          { role: "user", content: message },
        ];

        const response = await ai.chat.completions.create({
          model: DASHSCOPE_CHAT_MODEL,
          messages,
          temperature: 0.7,
        });

        const reply = response.choices?.[0]?.message?.content;
        if (reply) {
          return res.json({
            success: true,
            reply,
            model: DASHSCOPE_CHAT_MODEL,
          });
        }
      } catch (genError: any) {
        console.error("DashScope Chat API error:", genError?.message || genError);
      }
    }

    const fallbackReply = await generateFallbackExpertReply(message, contextData);
    return res.json({
      success: true,
      degraded: true,
      reply: fallbackReply,
      model: "knowledge-base-fallback",
    });
  } catch (error: any) {
    console.error("Chat handler error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

// AI 知识贡献识别（对话后判断是否沉淀为知识案例）
export async function handleAiSuggestContribution(req: any, res: any) {
  try {
    const { lastUserMessage, lastAiReply, equipment } = req.body;
    const ai = getAiClient();

    const systemPrompt = `你是一位拥有20年工业重型设备检修经验的知识管理员。判断下面这段工程师与AI的对话是否包含一个"完整、可复用、现场验证过"的故障处理案例。
判定标准（全部满足才算）：①有明确设备（名称/位号）②有具体故障现象 ③有可操作的根因或解决方案 ④不是纯闲聊或纯理论。
严格输出 JSON（禁止输出 JSON 以外的任何文字）：
{"worthContributing":true/false,"title":"建议的案例标题","type":"故障案例|点检异常|检修技巧|安全规程","equipment":"设备名称","summary":"一句话摘要","solution":"核心解决方案要点"}
worthContributing=false 时其他字段全部为空字符串。`;

    const userPrompt = `【工程师与AI的对话内容】
【用户输入/提问】:
${lastUserMessage}

【AI回复内容】:
${lastAiReply}
${equipment ? `\n【现场关联设备】: ${equipment}` : ""}`;

    let suggestion: any = {
      worthContributing: false,
      title: "",
      type: "",
      equipment: "",
      summary: "",
      solution: "",
    };

    if (ai) {
      try {
        const response = await ai.chat.completions.create({
          model: DASHSCOPE_CHAT_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
        });

        const rawText = response.choices?.[0]?.message?.content?.trim() || "";
        const parsed = extractAiJson(rawText);
        if (parsed && typeof parsed.worthContributing === "boolean") {
          suggestion = {
            worthContributing: Boolean(parsed.worthContributing),
            title: String(parsed.title || "").trim(),
            type: String(parsed.type || "故障案例").trim(),
            equipment: String(parsed.equipment || equipment || "").trim(),
            summary: String(parsed.summary || "").trim(),
            solution: String(parsed.solution || "").trim(),
          };
        }
      } catch (aiErr: any) {
        console.error("Suggest contribution AI error:", aiErr?.message || aiErr);
      }
    }

    // 在 suggest-contribution 返回 worthContributing=true 时，把建议落库一行（status=pending）
    if (suggestion.worthContributing) {
      try {
        const db = await getDb();
        const id = `kc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const chatId = `chat-${Date.now()}`;
        const contributor = req.currentUser?.name || "AI智能问答自进化";
        await db.query(
          `INSERT INTO ai_knowledge_contributions (id, chat_id, title, type, equipment, summary, solution, contributor, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
          [
            id,
            chatId,
            suggestion.title || "工业检修排查案例",
            suggestion.type || "故障案例",
            suggestion.equipment || equipment || "通用设备",
            suggestion.summary || "",
            suggestion.solution || "",
            contributor,
          ]
        );
        suggestion.id = id;
        suggestion.chatId = chatId;
      } catch (dbErr: any) {
        console.error("Save suggestion to DB error:", dbErr?.message || dbErr);
      }
    }

    return res.json({
      success: true,
      suggestion,
    });
  } catch (err: any) {
    console.error("Suggest contribution handler error:", err);
    return res.json({
      success: true,
      suggestion: {
        worthContributing: false,
        title: "",
        type: "",
        equipment: "",
        summary: "",
        solution: "",
      },
    });
  }
}

// AI 智能故障诊断向导 (Fault Diagnosis Wizard)
// AI 智能故障诊断向导 (Fault Diagnosis Wizard)
// 核心逻辑抽取至 services/aiCapabilityService.runFaultDiagnosisCore，此处仅保留 HTTP 语义
export async function handleAiDiagnose(req: any, res: any) {
  try {
    const { equipmentName, equipmentCode, category, symptoms, telemetry, errorCodes } = req.body;
    const result = await runFaultDiagnosisCore({ equipmentName, equipmentCode, category, symptoms, telemetry, errorCodes });
    return res.json(result.body);
  } catch (error: any) {
    console.error("Diagnose error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

// AI 图像识别与缺陷检测 (Vision Analysis)
export async function handleAiVision(req: any, res: any) {
  try {
    const { imageBase64, mimeType = "image/jpeg", promptText } = req.body;
    const ai = getAiClient();

    if (!imageBase64) {
      return res.status(400).json({ success: false, error: "请提供设备图片数据 (Base64)" });
    }

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");

    const userPrompt = promptText || `你是一位拥有20年工业重型设备（离心泵、压缩机、减速机、大型变频电机、数控机床、工业机器人）检修与无损探伤经验的视觉巡检专家。请深入分析此工业设备图片：
1. 识别设备类型及关键构件（轴承箱、电机定转子、联轴器、法兰密封端、铭牌仪表、接线盒等）。
2. 检测物理缺陷（润滑渗漏、齿面点蚀剥落、轴瓦磨损、皮带开裂、法兰松动、锈蚀腐蚀、热斑温升等）。
3. 涉及危险作业时明确标注【安全警示】与 GB 30871 / LOTO 能量隔离防护要点。
4. 给出设备状态评级（正常/关注/隐患/危险）及具备工程可操作性的分步骤检修建议。回答结构化分点输出，严谨专业。`;

    if (ai) {
      try {
        // DashScope qwen-vl-max 多模态视觉识别 (image_url 格式)
        const dataUrl = `data:${mimeType};base64,${cleanBase64}`;
        const response = await ai.chat.completions.create({
          model: DASHSCOPE_VISION_MODEL,
          messages: [
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: dataUrl } },
                { type: "text", text: userPrompt },
              ],
            },
          ],
        });

        const analysis = response.choices?.[0]?.message?.content;
        if (analysis) {
          return res.json({
            success: true,
            analysis,
            model: DASHSCOPE_VISION_MODEL,
          });
        }
      } catch (visErr: any) {
        console.error("DashScope Vision error:", visErr?.message || visErr);
      }
    }

    return res.json({
      success: true,
      degraded: true,
      analysis: "AI 视觉智能巡检服务暂不可用，未能自动识别设备图片中的构件与缺陷。系统杜绝编造虚假视觉结论，请现场点检人员结合设备台账与实际工况进行人工核实（涉及带电或旋转部件严格执行 LOTO 能量隔离），或稍后重试。",
    });
  } catch (error: any) {
    console.error("Vision error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

// AI 知识库 RAG 语义检索 (RAG Semantic Search)
export async function handleAiRagSearch(req: any, res: any) {
  try {
    const { query, knowledgeList = [] } = req.body;
    const ai = getAiClient();

    if (ai && query) {
      try {
        const contextCorpus = knowledgeList
          .slice(0, 8)
          .map(
            (k: any) =>
              `【标题】${k.title}\n【类别】${k.category}\n【摘要】${k.summary}\n【核心规程】${k.content.slice(0, 400)}`
          )
          .join("\n\n---\n\n");

        const prompt = `用户正在检索工业检修知识库：
用户查询问题: "${query}"

知识库参考文档:
${contextCorpus}

请基于上述知识库资料，给出精准的RAG语义综合解答：
1. 直接回答用户的问题并给出核心结论。
2. 列出相关的标准作业程序(SOP)关键步骤或排查要点。
3. 标注参考的规程来源文档。`;

        const response = await ai.chat.completions.create({
          model: DASHSCOPE_CHAT_MODEL,
          messages: [
            {
              role: "system",
              content: `你是一位拥有20年工业重型设备（离心泵、压缩机、减速机、大型变频电机、数控机床、工业机器人）检修经验的知识工程师，运行于企业设备检修知识库之上。你的回答必须遵循以下规则：
1. 优先基于提供的知识库文档作答，结论后用【来源：《文档标题》】标注引用；未提供文档支撑的结论一律标注【通用经验，未经企业规程验证】。
2. 如果知识库中没有直接相关内容，不要编造规程号，必须明确说明"当前知识库未收录该场景"，并在回答末尾追加一句："该问题尚未沉淀为知识，建议由现场维修员在【AI纠错反馈】中提交补充，或由知识管理员在知识中心沉淀为案例。"
3. 回答中如果引用了"现场经验类"资料（区别于标准 SOP），必须额外标注【来源类型：现场经验】。
4. 涉及危险作业（高压、高温、易燃易爆、机械卷入、受限空间）时，必须附【安全警示】并给出对应的防护与 LOTO 要点。
5. 回答使用结构化分点输出，关键参数用编号，保持专业严谨，不闲聊。`,
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.4,
        });

        const summary = response.choices?.[0]?.message?.content;
        if (summary) {
          return res.json({
            success: true,
            summary,
            matchedDocCount: knowledgeList.length,
            model: DASHSCOPE_CHAT_MODEL,
          });
        }
      } catch (ragErr) {
        console.error("RAG DashScope error:", ragErr);
      }
    }

    return res.json({
      success: true,
      degraded: true,
      summary: "AI 知识增强服务暂不可用，请稍后重试；以下为知识库原文片段，仅供参考。",
      matchedDocCount: knowledgeList.length,
      rawHits: knowledgeList.slice(0, 3).map((k: any) => ({
        title: k.title,
        category: k.category,
        excerpt: k.summary || (k.content ? k.content.slice(0, 150) : ""),
      })),
    });
  } catch (error: any) {
    console.error("RAG error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}
