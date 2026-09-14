// 重构说明：本模块自 server.ts 拆出，逻辑保持原样。
import { getAiClient, extractAiJson } from "../services/aiClient.ts";
import { findRelevantKnowledge } from "../services/knowledgeRetrieval.ts";
import { DASHSCOPE_VISION_MODEL } from "../utils/config.ts";

// AI 多模态检索（看图找相似案例）
export async function handleAiMultimodalSearch(req: any, res: any) {
  try {
    const { imageBase64, userText = "" } = req.body;
    const ai = getAiClient();

    if (!imageBase64 || imageBase64.trim().length === 0) {
      return res.json({
        success: true,
        visionDescription: "未提供图片数据",
        safetyHint: "",
        cases: [],
      });
    }

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const mimeType = imageBase64.match(/^data:(image\/\w+);base64,/)?.[1] || "image/jpeg";
    const dataUrl = `data:${mimeType};base64,${cleanBase64}`;

    let visionDescription = "";
    let safetyHint = "";

    // 1) 调视觉模型识别设备类型与可见故障征象
    if (ai) {
      try {
        const visionPrompt = `你是一位拥有20年工业重型设备检修经验的专家。请准确描述图片中的设备类型与可见故障征象（泄漏/锈蚀/振动痕迹/烧蚀/对中偏移/渗漏油等），${userText ? `用户现场补充提示："${userText}"。` : ""}
必须严格输出 JSON（禁止输出任何 JSON 以外的文字）：
{"visionDescription":"设备类型及可见故障征象描述（客观精准、结构清晰）","safetyHint":"如涉及高危作业明确给出【安全警示】与 GB 30871、LOTO 停电挂牌、防烫防泄漏要点，无高危作业可提示常规劳防"}`;

        const response = await ai.chat.completions.create({
          model: DASHSCOPE_VISION_MODEL,
          messages: [
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: dataUrl } },
                { type: "text", text: visionPrompt },
              ],
            },
          ],
        });

        const rawText = response.choices?.[0]?.message?.content?.trim() || "";
        const parsed = extractAiJson(rawText);
        if (parsed) {
          visionDescription = String(parsed.visionDescription || "").trim();
          safetyHint = String(parsed.safetyHint || "").trim();
        } else {
          visionDescription = rawText;
        }
      } catch (visErr: any) {
        console.error("Multimodal vision error:", visErr?.message || visErr);
      }
    }

    // 若 AI 未识别出结果或未配置
    if (!visionDescription) {
      // 判断是否为微小/纯白/空白测试图 (如 base64 < 200)
      if (cleanBase64.length < 200) {
        return res.json({
          success: true,
          visionDescription: "空白图片，未检测到有效工业设备",
          safetyHint: "",
          cases: [],
        });
      }
      if (userText && userText.trim()) {
        visionDescription = `AI 视觉识别服务暂不可用，已结合现场补充描述检索：“${userText.trim()}”`;
        safetyHint = "现场设备排查检修前，须严格执行 GB 30871 规范与 LOTO 动力源切断挂牌上锁。";
      } else {
        return res.json({
          success: true,
          degraded: true,
          visionDescription: "AI 视觉识别服务暂不可用，未能自动提取图片特征。系统杜绝伪造故障征象，请补充文字描述后重试。",
          safetyHint: "现场巡检作业请执行安全防护规程与电气绝缘防护。",
          cases: [],
        });
      }
    }

    // 判断是否为空白图或纯色/无设备图
    const isBlankOrInvalid =
      visionDescription.includes("空白") ||
      visionDescription.includes("纯白") ||
      visionDescription.includes("纯黑") ||
      visionDescription.includes("未发现任何") ||
      visionDescription.includes("无法识别") ||
      visionDescription.includes("未识别出任何设备") ||
      visionDescription.includes("未包含设备") ||
      visionDescription.includes("未见任何设备") ||
      visionDescription.includes("没有明显的工业设备") ||
      (cleanBase64.length < 300 && !userText);

    if (isBlankOrInvalid && !userText) {
      return res.json({
        success: true,
        visionDescription,
        safetyHint: "",
        cases: [],
      });
    }

    // 2) 把 visionDescription 拆成 3 个检索关键词组，调 findRelevantKnowledge
    const combinedCorpus = `${visionDescription} ${userText}`.toLowerCase();

    const equipDict = ["离心泵", "给水泵", "空压机", "螺杆机", "减速箱", "减速机", "电机", "轧机", "轴承", "泵", "机床", "齿轮箱", "风机", "液压", "管道", "阀门"];
    const faultDict = ["泄漏", "漏油", "渗漏", "点蚀", "剥落", "磨损", "烧蚀", "过热", "高温", "振动", "裂纹", "偏心", "对中", "松动", "腐蚀", "锈蚀", "积碳", "异常", "损坏", "开裂"];
    const compDict = ["端盖", "密封", "机械密封", "联轴器", "滚珠", "滚道", "定子", "转子", "润滑", "润滑油", "油品", "轴瓦", "法兰", "叶轮", "皮带", "管路", "阀座"];

    const matchedEquips = equipDict.filter((w) => combinedCorpus.includes(w.toLowerCase()));
    const matchedFaults = faultDict.filter((w) => combinedCorpus.includes(w.toLowerCase()));
    const matchedComps = compDict.filter((w) => combinedCorpus.includes(w.toLowerCase()));

    let group1: string[] = [];
    let group2: string[] = [];
    let group3: string[] = [];

    if (matchedEquips.length || matchedFaults.length || matchedComps.length) {
      group1 = [...matchedEquips, ...matchedFaults].slice(0, 3);
      group2 = [...matchedFaults, ...matchedComps].slice(0, 3);
      group3 = [...matchedEquips, ...matchedComps].slice(0, 3);
    }

    if (!group1.length && !group2.length && !group3.length) {
      if (isBlankOrInvalid) {
        return res.json({
          success: true,
          visionDescription,
          safetyHint: "",
          cases: [],
        });
      }
      group1 = ["轴承", "点蚀"];
      group2 = ["离心泵", "检修"];
      group3 = ["减速机", "规程"];
    }

    if (!group1.length) group1 = group2.length ? [...group2] : ["检修", "故障"];
    if (!group2.length) group2 = group1.length ? [...group1] : ["轴承", "规程"];
    if (!group3.length) group3 = ["维保", "标准"];

    const [res1, res2, res3] = await Promise.all([
      findRelevantKnowledge(group1, 3),
      findRelevantKnowledge(group2, 3),
      findRelevantKnowledge(group3, 3),
    ]);

    const caseMap = new Map<string, any>();
    [...res1, ...res2, ...res3].forEach((art: any) => {
      if (art && art.id && !caseMap.has(art.id)) {
        caseMap.set(art.id, art);
      }
    });

    const matchedArticles = Array.from(caseMap.values());
    const allSearchKeywords = [...new Set([...group1, ...group2, ...group3])];
    const rankedCases = matchedArticles
      .map((art: any) => {
        const hay = `${art.title || ""} ${art.category || ""} ${art.targetEquipment || ""} ${(art.tags || []).join(" ")} ${art.summary || ""}`;
        const score = allSearchKeywords.reduce((acc, kw) => (kw && hay.includes(kw) ? acc + 1 : acc), 0);
        return { art, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ art }) => ({
        id: art.id,
        title: art.title,
        category: art.category,
        targetEquipment: art.targetEquipment,
        summary: art.summary || (art.content ? art.content.slice(0, 100) + "..." : ""),
        content: art.content ? art.content.slice(0, 200) : "",
      }));

    return res.json({
      success: true,
      visionDescription,
      safetyHint,
      cases: rankedCases,
    });
  } catch (err: any) {
    console.error("Multimodal search handler error:", err);
    return res.json({
      success: true,
      visionDescription: "识别失败",
      safetyHint: "",
      cases: [],
    });
  }
}
