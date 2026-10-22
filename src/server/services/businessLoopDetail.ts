/**
 * 业务闭环详情装配域（自 businessLoopService.ts 机械切出，纯移动不改行为）。
 *
 * 内聚在此：buildLoopDetail 的纯装配段 —— 台账设备的前端投影（mapEquipmentForFrontend）、
 * 各环节预填正文/建议的抽取（stagePrefillContent / stagePrefillAdvice）、
 * 复盘建议清单的规则装配（buildSuggestions）。纯函数，无 IO、无 AI 调用。
 */
import type { Equipment } from "../../types/index.ts";
import {
  STAGE_DEFS,
  TEMP_LIMIT,
  VIB_LIMIT,
  telemetryValueOrNull,
} from "./businessLoopConstants.ts";

// ==================== 内部组装工具 ====================

export function mapEquipmentForFrontend(eq: Equipment | null) {
  const te = eq?.telemetry ?? null;
  if (!eq) {
    return {
      id: "",
      code: "",
      name: "未识别设备",
      model: "",
      workshop: "",
      status: "normal" as const,
      // 未识别设备时没有任何读数，"温度 0°C" 会被前端读成"设备冷态正常"
      temperature: null,
      temperatureThreshold: TEMP_LIMIT,
      vibration: null,
      loadRate: null,
      healthScore: null,
    };
  }
  const rawStatus = String(eq.status || "");
  const status: "warning" | "normal" | "danger" =
    ["fault", "critical"].includes(rawStatus) ? "danger" : rawStatus === "warning" ? "warning" : "normal";
  return {
    id: eq.id,
    code: eq.code,
    name: eq.name,
    model: eq.model || "",
    workshop: String(eq.workshop || ""),
    status,
    temperature: telemetryValueOrNull(te?.temperature),
    temperatureThreshold: TEMP_LIMIT,
    vibration: telemetryValueOrNull(te?.vibration),
    loadRate: telemetryValueOrNull(te?.loadRate),
    healthScore: Number.isFinite(Number(eq.healthScore)) ? Number(eq.healthScore) : null,
  };
}

export function stagePrefillContent(stage: any): string | null {
  const p = stage.aiPrefill;
  if (!p) return null;
  if (stage.stageNo === 1) {
    const d = p.workOrderDraft;
    if (!d?.title) return p.message || "工单草稿预填失败，请在确认前人工核对填写工单要素";
    return `${d.title}｜严重度优先级 ${d.priority || "—"}｜预计 ${d.estimatedHours ?? "—"} 小时`;
  }
  if (stage.stageNo === 2) {
    const a = p.assessment;
    if (!a?.riskLevel) return p.message || "JSA 预填失败，请人工开展作业安全分析";
    return `JSA 风险等级：${a.riskLevel}・${a.riskReason || "（未输出理由）"}`;
  }
  if (stage.stageNo === 3) {
    const items = p.lotoItems || [];
    const cnt = items.length;
    return cnt ? `AI 规则推演 ${cnt} 个隔离点；锁具要求 ${p.lockCount ?? cnt} 把` : p.note || null;
  }
  if (stage.stageNo === 4) {
    const plan = p.plan;
    if (!plan?.overview) return p.message || "检修方案预填失败，请人工编制方案";
    return plan.overview;
  }
  if (stage.stageNo === 5) return p.acceptanceSummary || null;
  if (stage.stageNo === 6) {
    const c = p.contribution;
    if (c?.worthContributing) return `知识沉淀建议：${c.title}`;
    return c?.message || "待归档或未达沉淀标准";
  }
  return null;
}

export function stagePrefillAdvice(stage: any): string | null {
  const p = stage.aiPrefill;
  if (!p) return null;
  if (stage.stageNo === 1 && Array.isArray(p.workOrderDraft?.recommendedSteps)) {
    return p.workOrderDraft.recommendedSteps.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n");
  }
  if (stage.stageNo === 2 && Array.isArray(p.assessment?.jsaMeasures)) {
    return p.assessment.jsaMeasures
      .slice(0, 6)
      .map((m: any) => `${m.hazard}：${m.control}`)
      .join("\n");
  }
  if (stage.stageNo === 3) {
    const items = p.lotoItems || [];
    return items.map((i: any) => `【${i.type}】${i.point}${i.lockNumber ? `（锁号 ${i.lockNumber}）` : "（锁具编号待现场登记）"}`).join("\n");
  }
  if (stage.stageNo === 4 && p.plan?.steps) {
    return p.plan.steps.map((s: any) => `${s.step}. ${s.operation}${s.qualityStandard ? `（验收：${s.qualityStandard}）` : ""}`).join("\n");
  }
  return null;
}

export function buildSuggestions(loop: any, stagesView: any[], lotoItems: any[], allCompleted: boolean): any[] {
  const current = stagesView.find((s) => s.status === "in_progress") || stagesView[stagesView.length - 1];
  const currentNo = current?.order ?? loop.currentStage;
  const defs = STAGE_DEFS;

  const todoByStage: Record<number, { title: string; content: string; tag: string; actionText: string }> = {
    1: { title: `待办提醒：确认「${loop.loopNo}」工单草稿后推进`, content: "AI 已预填工单要素，请在检修工单页核对无误后确认下发报修", tag: "工单核对", actionText: "去确认" },
    2: { title: "待办提醒：核对 JSA 措施后办理作业票", content: "作业安全分析已在环节页预填，确认后系统落成真实作业票（待双人会签）", tag: "安全审批", actionText: "去核对 JSA" },
    3: {
      title: `待办提醒：LOTO 请完成 ${lotoItems.filter((i) => i.confirmed).length}/${lotoItems.length} 项确认`,
      content: lotoItems.filter((i) => !i.confirmed).length
        ? `未确认项：${lotoItems.filter((i) => !i.confirmed).map((i) => i.point).join("、")}`
        : "全部隔离点已确认完成",
      tag: "安全闸门",
      actionText: "去逐项确认",
    },
    4: { title: "待办提醒：确认检修方案后下发执行", content: "检修方案已由 AI 预填（步骤/备件/安全措施），确认后即可组织开工", tag: "方案确认", actionText: "去查看方案" },
    5: { title: "待办提醒：完工验收与质量复核", content: "维修完工后请完成现场验收记录与遥测复核", tag: "完工验收", actionText: "去验收" },
    6: { title: "待办提醒：质检归档与知识沉淀", content: "归档将生成质检报告并判断是否沉淀知识条目", tag: "归档收尾", actionText: "去归档" },
  };
  const sug1 = todoByStage[currentNo] || todoByStage[6];

  const degradedStage = stagesView.find((s) => s.aiPrefill?.status === "degraded");
  let sug2: { id: string; type: "risk"; title: string; content: string; tag: string; actionText: string };
  if (degradedStage) {
    sug2 = {
      id: "sug-2",
      type: "risk",
      title: `风险提示：环节 ${degradedStage.order}（${degradedStage.title}）AI 结果为降级规则结果`,
      content: `${degradedStage.aiPrefill?.engine || "该 AI 能力"}未输出可信结构化结果，请人工核校后再推进，避免以规则兜底内容直接替代工程判断`,
      tag: "AI 降级",
      actionText: "去人工核校",
    };
  } else {
    sug2 = {
      id: "sug-2",
      type: "risk",
      title: `风险提示：遥测对照经验限值（温度 < ${TEMP_LIMIT}°C / 振动 < ${VIB_LIMIT} mm/s）`,
      content: `限值来源为台账-趋势复用经验限值，非设备档案实测阈值；如需精确报警线请以设备台账与厂家手册为准`,
      tag: "遥测对照",
      actionText: "查看健康度",
    };
  }

  const sug3 = {
    id: "sug-3",
    type: "next" as const,
    title: allCompleted ? "下一步引导：执行归档生成质检报告" : `下一步引导：推进至「${defs[Math.min(currentNo, 5)].title}」`,
    content: allCompleted
      ? "六个环节已全部确认，归档将生成质检报告并判断知识沉淀价值"
      : `${current?.aiPrefill?.content || "AI 预填内容生成后即可在环节页核对确认"}`,
    tag: "自动编排",
    actionText: "查看当前环节",
  };

  return [
    { id: "sug-1", type: "todo" as const, ...sug1 },
    sug2,
    sug3,
  ];
}
