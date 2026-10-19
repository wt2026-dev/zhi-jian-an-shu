/**
 * AI 能力清单——单一事实来源。
 *
 * 为什么要单独一个文件：对外说"多少项 AI 能力"这件事此前有三处各写一个数字
 * （package.json 写 20、openapi 写 15、AiPipelineView 注释写 20），答辩时一问
 * "哪 20 项"就露底。这里把它变成一份表，`tests/ai-capability-registry.test.ts`
 * 会拿这张表去核对**真实注册的路由**与 openapi 文档，任何一边漂了就红。
 *
 * status 口径：
 * - core      对外主张的三项核心能力，计入 AI_CORE_CAPABILITY_COUNT
 * - transport 同一能力的另一种传输形态（SSE 流式），不重复计数
 * - stub      接口在、但不宣称 AI 效果的占位实现（返回 degraded，不建模），不计数
 * - internal  统计/预算/管理面，不是对外的"能力"，不计数
 */

export type AiCapabilityStatus = "core" | "transport" | "stub" | "internal";

export type AiCapabilityEntry = {
  id: string;
  name: string;
  method: "GET" | "POST";
  path: string;
  status: AiCapabilityStatus;
  /** status 为 stub 时必填：说明它为什么不算能力 */
  note?: string;
};

export const AI_API_PREFIX = "/api/v1/ai/";

export const AI_CAPABILITIES: AiCapabilityEntry[] = [
  { id: "chat", name: "数字人对话问答", method: "POST", path: "/api/v1/ai/chat", status: "internal" },
  { id: "chat-stream", name: "数字人对话问答（SSE 流式）", method: "POST", path: "/api/v1/ai/chat/stream", status: "transport" },
  { id: "diagnose", name: "多维故障诊断", method: "POST", path: "/api/v1/ai/diagnose", status: "core" },
  {
    id: "health-forecast",
    name: "设备劣化趋势预警",
    method: "POST",
    path: "/api/v1/ai/health-forecast",
    status: "internal",
    note: "统计口径由 services/degradationTrend.ts 确定性算出，模型只做解读",
  },
  { id: "root-cause-analysis", name: "根因分析（5Why/故障树）", method: "POST", path: "/api/v1/ai/root-cause-analysis", status: "internal" },
  { id: "generate-maintenance-plan", name: "检修方案生成", method: "POST", path: "/api/v1/ai/generate-maintenance-plan", status: "core" },
  { id: "generate-work-order", name: "智能工单生成", method: "POST", path: "/api/v1/ai/generate-work-order", status: "internal" },
  { id: "generate-report", name: "智能报告生成", method: "POST", path: "/api/v1/ai/generate-report", status: "internal" },
  { id: "safety-risk-assessment", name: "作业票风险评估（JSA）", method: "POST", path: "/api/v1/ai/safety-risk-assessment", status: "internal" },
  { id: "equipment-summary", name: "设备健康画像", method: "POST", path: "/api/v1/ai/equipment-summary", status: "internal" },
  { id: "recommend-assignee", name: "AI 辅助派单", method: "POST", path: "/api/v1/ai/recommend-assignee", status: "internal" },
  { id: "alarm-correlation", name: "报警关联分析", method: "POST", path: "/api/v1/ai/alarm-correlation", status: "internal" },
  { id: "rag-search", name: "知识库 RAG 语义检索", method: "POST", path: "/api/v1/ai/rag-search", status: "core" },
  { id: "multimodal-search", name: "多模态检索（看图找案例）", method: "POST", path: "/api/v1/ai/multimodal-search", status: "internal" },
  { id: "vision-defect-detect", name: "视觉缺陷识别", method: "POST", path: "/api/v1/ai/vision-defect-detect", status: "internal" },
  { id: "suggest-contribution", name: "知识贡献识别", method: "POST", path: "/api/v1/ai/suggest-contribution", status: "internal" },
  { id: "suggest-followups", name: "智能追问建议", method: "POST", path: "/api/v1/ai/suggest-followups", status: "internal" },
  { id: "pipeline", name: "AI 协同任务链路", method: "POST", path: "/api/v1/ai/pipeline", status: "internal" },
  {
    id: "video-analyze",
    name: "检修视频时序分析（真抽帧）",
    method: "POST",
    path: "/api/v1/ai/video-analyze",
    status: "internal",
    note: "网页端上传视频后由服务端抽帧送 Qwen-VL；与下面的 video-analysis 占位接口不是一回事",
  },

  {
    id: "speech-to-text",
    name: "语音转写",
    method: "POST",
    path: "/api/v1/ai/speech-to-text",
    status: "stub",
    note: "DashScope 兼容模式不支持转写，接口固定返回 degraded 提示，不作为能力宣传",
  },
  {
    id: "video-analysis",
    name: "检修视频时序分析（无帧兜底）",
    method: "POST",
    path: "/api/v1/ai/video-analysis",
    status: "stub",
    note: "小程序拿不到抽帧结果时的兜底入口：只回规则推断并明写「非图像实测结论」，不宣称看了视频内容；能力算在 video-analyze 上",
  },

  { id: "pipeline-list", name: "协同任务列表", method: "GET", path: "/api/v1/ai/pipeline", status: "internal" },
  { id: "pipeline-detail", name: "协同任务详情", method: "GET", path: "/api/v1/ai/pipeline/:id", status: "internal" },
  { id: "pipeline-events", name: "协同任务进度推送", method: "GET", path: "/api/v1/ai/pipeline/:id/events", status: "internal" },
  { id: "budget", name: "AI 每日预算用量", method: "GET", path: "/api/v1/ai/budget", status: "internal" },
  {
    id: "engine-status",
    name: "当前应答引擎状态",
    method: "GET",
    path: "/api/v1/ai/engine",
    status: "internal",
    note: "只投影路由第一跳的展示字段，不发起模型调用；因为 /admin/ai-models 是 admin 专属，非管理员页面靠它显示引擎真名",
  },
  { id: "feedback-create", name: "AI 纠错反馈提交", method: "POST", path: "/api/v1/ai/feedback", status: "internal" },
  { id: "feedback-list", name: "AI 纠错反馈列表", method: "GET", path: "/api/v1/ai/feedback", status: "internal" },
  { id: "feedback-adopt", name: "AI 纠错反馈采纳", method: "POST", path: "/api/v1/ai/feedback/:id/adopt", status: "internal" },
  { id: "contribution-create", name: "知识贡献候选提交", method: "POST", path: "/api/v1/ai/contributions", status: "internal" },
  { id: "contribution-list", name: "知识贡献候选列表", method: "GET", path: "/api/v1/ai/contributions", status: "internal" },
  { id: "contribution-adopt", name: "知识贡献候选采纳入库", method: "POST", path: "/api/v1/ai/contributions/:id/adopt", status: "internal" },
];

export function capabilitiesOf(status: AiCapabilityStatus): AiCapabilityEntry[] {
  return AI_CAPABILITIES.filter((c) => c.status === status);
}

/** 对外宣称的能力数——写文案时引用它，不要手抄数字。 */
export const AI_CORE_CAPABILITY_COUNT = capabilitiesOf("core").length;

/** 占位接口数：如实披露，不计入能力数。 */
export const AI_STUB_ENDPOINT_COUNT = capabilitiesOf("stub").length;
