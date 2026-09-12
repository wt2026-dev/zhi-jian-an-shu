import { findRelevantKnowledge } from "./knowledgeRetrieval.ts";

// ==================== 工业检修总工 AI 人设与规则引擎降级 ====================

export const AI_EXPERT_SYSTEM = "你是一位拥有20年工业重型设备（离心泵、压缩机、减速机、大型电机、数控机床、工业机器人）检修与安全生产管理经验的总工程师，回答结构清晰严谨、具备工程实操性，严格遵循 GB 30871 危险作业安全规范与 LOTO（上锁挂牌）能量隔离标准，在涉及危险作业或高风险环节时必须明确包含【安全警示】与防护措施。你必须严格输出合法 JSON，不要输出任何 JSON 之外的解释文字。";

export async function generateFallbackExpertReply(message: string, contextData: any = {}): Promise<string> {
  const keywords = (message || "").split(/[，,、\s+]+/).filter((w: string) => w.length >= 2).slice(0, 5);
  let kbDocs: any[] = [];
  try {
    kbDocs = await findRelevantKnowledge(keywords.length ? keywords : ["设备", "检修", "安全"], 3);
  } catch (err) {
    console.warn("Fallback kb lookup error:", err);
  }

  let text = `> ⚠️ **【系统提示】** AI 智能服务暂不可用，已自动切换为知识库检索降级模式。\n\n`;
  if (kbDocs.length > 0) {
    text += `### 📚 知识库关联规程参考（真实文档）：\n`;
    for (const doc of kbDocs) {
      text += `#### 📄 《${doc.title}》【${doc.category || "通用"}】\n`;
      text += `- **摘要**: ${doc.summary || "无摘要"}\n`;
      if (doc.content) {
        text += `- **规程要点**: ${doc.content.slice(0, 200)}...\n`;
      }
      text += `\n`;
    }
  } else {
    text += `知识库中暂未检索到与「${(message || "").slice(0, 30)}」直接匹配的已审核规程，请人工查阅车间规程手册或联系主管工程师。\n\n`;
  }

  text += `### 🛡️ 【通用安全警示】\n`;
  text += `- 严格执行 GB 30871 危险作业安全标准及 LOTO 能量隔离程序，作业前必须断电验电、挂牌上锁并泄放残余能量。\n`;
  text += `- 严禁未办理安全作业许可证进行动火、进入受限空间或高处作业。\n`;

  return text;
}

export async function generateFallbackDiagnosis(name: string, symptoms: string, telemetry: any): Promise<any> {
  const keywords = [name, ...(symptoms || "").split(/[，,、\s+]+/)].filter((w: string) => w && w.length >= 2).slice(0, 5);
  let kbDocs: any[] = [];
  try {
    kbDocs = await findRelevantKnowledge(keywords.length ? keywords : ["故障", "检修", "安全"], 3);
  } catch (err) {
    console.warn("Fallback diagnosis kb lookup error:", err);
  }

  const rawHits = kbDocs.map((k: any) => ({
    title: k.title,
    category: k.category,
    excerpt: k.summary || k.content?.slice(0, 150) || "",
  }));

  return {
    severity: "一般",
    urgencyScore: 50,
    summary: `AI 智能诊断服务暂不可用，无法生成深度诊断分析。已为您检索知识库关联规程供人工参考（共匹配 ${kbDocs.length} 篇真实文献）。`,
    rawHits,
    probableCauses: kbDocs.length > 0
      ? kbDocs.map((k: any) => ({
          cause: `参考规程《${k.title}》`,
          probability: 50,
          detail: k.summary || "请参考对应规程内容排查现场异常",
        }))
      : [
          {
            cause: "待现场人工排查",
            probability: 50,
            detail: "AI 诊断降级中，请专业点检员对照出厂维保手册进行现场排查",
          },
        ],
    safetyPrecautions: [
      "【安全警示】检修与核查作业前必须严格执行 LOTO 挂牌上锁规范，确认动力回路断电且机械残余能量泄放完毕。",
      "涉及动火、高空、受限空间等高危环节时，必须严格执行 GB 30871 规程，开具专项作业许可并安排专人监护。",
      "拆解旋转或承压部件前，确认机组降至室温且管路内部压力泄放至常压。",
    ],
    recommendedActions: kbDocs.length > 0
      ? kbDocs.map((k: any, idx: number) => ({
          step: idx + 1,
          action: `对照《${k.title}》开展现场点检与核实`,
          tools: "现场点检仪、测量器具",
          standard: "符合车间设备管理规程要求",
        }))
      : [
          {
            step: 1,
            action: "调取设备近期振动、温度、电流历史遥测曲线，记录异常拐点",
            tools: "SCADA / DCS 历史记录系统",
            standard: "符合额定工况要求",
          },
          {
            step: 2,
            action: "安排持证点检员携带振动测温仪至现场核查",
            tools: "测温测振仪",
            standard: "符合机械设备通用技术规范",
          },
        ],
    spareParts: [],
    estimatedRepairHours: 2.0,
  };
}
