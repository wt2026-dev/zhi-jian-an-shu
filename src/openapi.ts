// OpenAPI 3.0 规范（生产级 API 文档，/api-docs 可视化查看）
// 覆盖：auth / equipments / work-orders / inspections / safety-permits / knowledge / ai
export function buildOpenApiSpec(): Record<string, any> {
  const bearer = [{ bearerAuth: [] }];
  const okJson = (desc: string) => ({
    description: desc,
    content: { "application/json": { schema: { type: "object" } } },
  });
  return {
    openapi: "3.0.3",
    info: {
      title: "工业设备运行智能决策与作业协同系统 API",
      version: "2.0.0",
      description: "检修工单全生命周期 / 巡检作业 / 高危作业票与 LOTO / 设备台账与健康监测 / 知识库 RAG / AI 智能辅助（15 项能力）。认证方式：Authorization: Bearer <JWT>（登录接口获取）。错误统一返回 { error, code? }。",
    },
    servers: [{ url: "/", description: "当前实例" }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      schemas: {
        WorkOrder: {
          type: "object",
          properties: {
            id: { type: "string" }, orderNo: { type: "string", example: "WO-20260905-399" },
            title: { type: "string" }, equipmentId: { type: "string" },
            equipmentName: { type: "string" }, workshop: { type: "string" },
            faultType: { type: "string", example: "机械振动" },
            priority: { type: "string", enum: ["urgent", "high", "medium", "low"] },
            status: { type: "string", enum: ["created", "dispatched", "in_progress", "pending_acceptance", "completed", "cancelled"] },
            creator: { type: "string" }, assignee: { type: "string" },
            createdAt: { type: "string" }, description: { type: "string" },
            version: { type: "integer" }, repairLog: { type: "object", nullable: true },
            acceptance: { type: "object", nullable: true },
          },
        },
        Inspection: {
          type: "object",
          properties: {
            id: { type: "string" }, taskNo: { type: "string" }, title: { type: "string" },
            workshop: { type: "string" }, route: { type: "string" },
            status: { type: "string", enum: ["pending", "in_progress", "completed", "abnormal"] },
            totalPoints: { type: "integer" }, completedPoints: { type: "integer" },
            abnormalCount: { type: "integer" }, items: { type: "array", items: { type: "object" } },
          },
        },
        SafetyPermit: {
          type: "object",
          properties: {
            id: { type: "string" }, permitNo: { type: "string" }, permitType: { type: "string" },
            riskLevel: { type: "string", example: "极大风险 (Level 1)" }, title: { type: "string" },
            status: { type: "string", enum: ["pending_approval", "approved", "active", "closed", "rejected"] },
            lotoNumber: { type: "string", nullable: true },
            guardianApproval: { type: "object", nullable: true }, supervisorApproval: { type: "object", nullable: true },
          },
        },
        Equipment: {
          type: "object",
          properties: {
            id: { type: "string" }, code: { type: "string" }, name: { type: "string" },
            category: { type: "string" }, workshop: { type: "string" },
            status: { type: "string", enum: ["running", "warning", "fault", "overhauling", "standby", "scrapped"] },
            healthScore: { type: "integer" }, telemetry: { type: "object" },
          },
        },
        Notification: {
          type: "object",
          properties: {
            id: { type: "string" }, title: { type: "string" }, content: { type: "string" },
            type: { type: "string", enum: ["info", "alert", "warning", "success"] },
            read: { type: "boolean" }, time: { type: "string" },
          },
        },
      },
    },
    paths: {
      "/api/v1/auth/login": {
        post: { tags: ["auth"], summary: "账号密码登录，签发 JWT",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["username", "password"], properties: { username: { type: "string", example: "admin" }, password: { type: "string", example: "Admin@2026#Demo" } } } } } },
          responses: { "200": okJson("token 与用户信息"), "401": okJson("账号或密码错误"), "429": okJson("触发限流/IP 锁定") } } },
      "/api/v1/auth/me": { get: { tags: ["auth"], security: bearer, summary: "获取当前登录用户", responses: { "200": okJson("用户信息") } } },
      "/api/v1/auth/users": {
        get: { tags: ["auth"], security: bearer, summary: "用户列表", responses: { "200": okJson("用户数组") } },
        post: { tags: ["auth"], security: bearer, summary: "创建用户账号（仅 admin）",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["username", "name", "password", "role"], properties: { username: { type: "string" }, name: { type: "string" }, password: { type: "string" }, role: { type: "string", enum: ["admin", "manager", "technician", "inspector", "operator", "archivist", "user"] } } } } } },
          responses: { "201": okJson("创建成功"), "403": okJson("RBAC 拒绝"), "409": okJson("用户名已存在") } } },
      "/api/v1/equipments": {
        get: { tags: ["equipments"], summary: "设备台账列表（支持 workshop/status/search 筛选）", parameters: [{ name: "workshop", in: "query", schema: { type: "string" } }, { name: "status", in: "query", schema: { type: "string" } }, { name: "search", in: "query", schema: { type: "string" } }], responses: { "200": { description: "设备数组", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Equipment" } } } } } } },
        post: { tags: ["equipments"], security: bearer, summary: "新增设备档案（admin/manager）", responses: { "201": okJson("创建成功"), "403": okJson("RBAC 拒绝") } } },
      "/api/v1/equipments/{id}": { get: { tags: ["equipments"], summary: "设备详情（含遥测与维修履历）", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "设备详情", content: { "application/json": { schema: { $ref: "#/components/schemas/Equipment" } } } } } } },
      "/api/v1/equipments/{id}/telemetry-history": { get: { tags: ["equipments"], summary: "设备遥测历史时序", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": okJson("时序数组") } } },
      "/api/v1/work-orders": {
        get: { tags: ["work-orders"], summary: "工单列表（status/priority/workshop/search 筛选）", responses: { "200": { description: "工单数组", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/WorkOrder" } } } } } } },
        post: { tags: ["work-orders"], security: bearer, summary: "创建报修工单（含 15 分钟防重复拦截）",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["title", "equipmentId", "faultType", "priority", "description"], properties: { title: { type: "string" }, equipmentId: { type: "string" }, faultType: { type: "string" }, priority: { type: "string" }, description: { type: "string" }, safetyRequirements: { type: "array", items: { type: "string" } }, forceSubmit: { type: "boolean", description: "应急穿透防重复拦截" } } } } } },
          responses: { "201": { description: "创建成功", content: { "application/json": { schema: { $ref: "#/components/schemas/WorkOrder" } } } }, "409": okJson("DUPLICATE_WORK_ORDER 防重复拦截") } } },
      "/api/v1/work-orders/{id}": { get: { tags: ["work-orders"], summary: "工单详情", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "工单详情", content: { "application/json": { schema: { $ref: "#/components/schemas/WorkOrder" } } } } } } },
      "/api/v1/work-orders/{id}/dispatch": { post: { tags: ["work-orders"], security: bearer, summary: "主管派单（created→dispatched，乐观锁）", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": okJson("派发成功"), "409": okJson("VERSION_CONFLICT") } } },
      "/api/v1/work-orders/{id}/claim": { post: { tags: ["work-orders"], security: bearer, summary: "技师接单（dispatched→in_progress）", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": okJson("接单成功") } } },
      "/api/v1/work-orders/{id}/complete": { post: { tags: ["work-orders"], security: bearer, summary: "完工上报（in_progress→pending_acceptance）", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": okJson("上报成功") } } },
      "/api/v1/work-orders/{id}/accept": { post: { tags: ["work-orders"], security: bearer, summary: "质检验收（pending_acceptance→completed/in_progress）", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": okJson("验收结果") } } },
      "/api/v1/work-orders/{id}/transition": { post: { tags: ["work-orders"], security: bearer, summary: "通用状态流转（状态机互斥校验）", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["targetStatus"], properties: { targetStatus: { type: "string" }, comment: { type: "string" }, operatorName: { type: "string" } } } } } }, responses: { "200": okJson("流转成功"), "400": okJson("INVALID_STATE_TRANSITION 状态机校验失败") } } },
      "/api/v1/work-orders/{id}/logs": { get: { tags: ["work-orders"], summary: "工单流转时间线", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": okJson("日志数组") } } },
      "/api/v1/inspections": {
        get: { tags: ["inspections"], summary: "巡检任务列表", responses: { "200": { description: "任务数组", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Inspection" } } } } } } },
        post: { tags: ["inspections"], security: bearer, summary: "创建巡检任务", responses: { "201": okJson("创建成功") } } },
      "/api/v1/inspections/{id}": {
        get: { tags: ["inspections"], summary: "巡检任务详情（含测点清单）", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "任务详情", content: { "application/json": { schema: { $ref: "#/components/schemas/Inspection" } } } } } },
        patch: { tags: ["inspections"], security: bearer, summary: "巡检打卡/更新（逐项录入实测值）", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": okJson("更新成功") } } },
      "/api/v1/safety-permits": {
        get: { tags: ["safety-permits"], summary: "作业票列表（risk_level/status 筛选）", responses: { "200": { description: "作业票数组", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/SafetyPermit" } } } } } } },
        post: { tags: ["safety-permits"], security: bearer, summary: "申请高危作业票", responses: { "201": okJson("创建成功") } } },
      "/api/v1/safety-permits/{id}/approve": { post: { tags: ["safety-permits"], security: bearer, summary: "会签审批（guardian 现场监护 → supervisor 主管终审）", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["step"], properties: { step: { type: "string", enum: ["guardian", "supervisor"] }, pass: { type: "boolean" }, comment: { type: "string" }, gasTestResults: { type: "object" } } } } } }, responses: { "200": okJson("审批结果"), "403": okJson("RBAC 拒绝"), "400": okJson("气体检测不合格") } } },
      "/api/v1/safety-permits/{id}/close": { post: { tags: ["safety-permits"], security: bearer, summary: "作业闭环注销", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": okJson("闭环成功") } } },
      "/api/v1/knowledge": { get: { tags: ["knowledge"], summary: "知识文章列表（category/search）", responses: { "200": okJson("文章数组") } } },
      "/api/v1/knowledge/search": { post: { tags: ["knowledge"], summary: "语义检索", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["query"], properties: { query: { type: "string" }, limit: { type: "integer" } } } } } }, responses: { "200": okJson("检索结果（含来源）") } } },
      "/api/v1/notifications": { get: { tags: ["notifications"], security: bearer, summary: "通知列表", responses: { "200": { description: "通知数组", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Notification" } } } } } } } },
      "/api/v1/notifications/{id}/read": { patch: { tags: ["notifications"], security: bearer, summary: "标记单条已读", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": okJson("已读") } } },
      "/api/v1/notifications/read-all": { post: { tags: ["notifications"], security: bearer, summary: "全部已读", responses: { "200": okJson("成功") } } },
      "/api/v1/ai/chat/stream": { post: { tags: ["ai"], security: bearer, summary: "AI 对话（SSE 流式）",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["message"], properties: { message: { type: "string" }, history: { type: "array", items: { type: "object" } } } } } } },
        responses: { "200": { description: "text/event-stream：data:{\"content\"} 帧，结束 data:[DONE]，错误 data:{\"error\"}", content: { "text/event-stream": { schema: { type: "string" } } } } } } },
      "/api/v1/ai/diagnose": { post: { tags: ["ai"], security: bearer, summary: "多维故障诊断（结构化 JSON）", responses: { "200": okJson("诊断报告"), "502": okJson("AI 调用失败") } } },
      "/api/v1/ai/generate-work-order": { post: { tags: ["ai"], security: bearer, summary: "智能工单生成（巡检异常→工单草稿）", responses: { "200": okJson("工单草稿 / 降级提示") } } },
      "/api/v1/ai/root-cause-analysis": { post: { tags: ["ai"], security: bearer, summary: "根因分析（5Why/故障树；失败时规则引擎降级）", responses: { "200": okJson("RCA 报告（或 degraded 规则结果）") } } },
      "/api/v1/ai/generate-maintenance-plan": { post: { tags: ["ai"], security: bearer, summary: "检修方案生成（失败时规则引擎降级）", responses: { "200": okJson("作业指导书（或 degraded 规则结果）") } } },
      "/api/v1/ai/health-forecast": { post: { tags: ["ai"], security: bearer, summary: "设备劣化趋势预警（确定性统计引擎；AI 不可用时返回同口径规则结果）", responses: { "200": okJson("劣化趋势研判（或 degraded 规则结果）") } } },
      "/api/v1/ai/equipment-summary": { post: { tags: ["ai"], security: bearer, summary: "设备健康画像（失败时规则引擎降级）", responses: { "200": okJson("画像摘要（或 degraded 规则结果）") } } },
      "/api/v1/ai/generate-report": { post: { tags: ["ai"], security: bearer, summary: "智能报告生成（巡检/检修/月度）", responses: { "200": okJson("结构化报告"), "502": okJson("AI 调用失败") } } },
      "/api/v1/ai/safety-risk-assessment": { post: { tags: ["ai"], security: bearer, summary: "作业票风险评估（JSA）", responses: { "200": okJson("评估结果"), "502": okJson("AI 调用失败") } } },
      "/api/v1/ai/recommend-assignee": { post: { tags: ["ai"], security: bearer, summary: "AI 辅助派单（推荐主修人+工时）", responses: { "200": okJson("推荐结果"), "502": okJson("AI 调用失败") } } },
      "/api/v1/ai/alarm-correlation": { post: { tags: ["ai"], security: bearer, summary: "报警智能关联分析", responses: { "200": okJson("关联分析"), "502": okJson("AI 调用失败") } } },
      "/api/v1/ai/suggest-followups": { post: { tags: ["ai"], security: bearer, summary: "智能追问建议", responses: { "200": okJson("追问数组"), "502": okJson("AI 调用失败") } } },
      "/api/v1/audit-logs": { get: { tags: ["audit"], security: bearer, summary: "操作审计日志查询", responses: { "200": okJson("日志数组") } } },
    },
  };
}
