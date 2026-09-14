# 修复报告：AI 对话成本与一致性

> 📌 **口径说明**：本报告记录的是修复完成时点的基线快照。当前基线：33 文件 / 234 用例（2026-09-14）。

修复日期：2026-09-13

## 1. 对话历史截断与后端校验

- 前端截断参数：`MAX_CHAT_HISTORY = 12`。截断仅发生在发往 `/api/v1/ai/chat/stream` 的请求体；界面仍保留并展示完整 `messages`。
- `src/components/AiAssistantView.tsx`：内联 SSE 请求的 `history` 改为 `messages.slice(-MAX_CHAT_HISTORY)`，映射格式保持 `{ role, content }`，顺序不变。
- `src/hooks/useAiChat.ts`：Hook SSE 请求作相同处理，映射格式同为 `{ role, content }`。
- `src/server/schemas/ai.ts`：`aiChatSchema.history` 改为最多 12 条的 `{ role: "user" | "assistant", content: string }` 数组；超限错误信息为“对话历史过长，请刷新后重试”。单条 `content` 上限为 2000 字符。
- API 成功路径未改变：请求字段仍为 `message`、`history`、`userRole`，历史项仍为 `role/content`；仅超长请求被拒绝。

## 2. 双实现标注与渲染路径

两处文件顶部均已增加防漂移注释，明确修改对话逻辑须同步，后续可迁移至单一实现，未作重构或删除。

判定证据：

- `src/App.tsx` 在 `activeTab === 'ai_assistant'` 时渲染 `AiAssistantView`，因此它是 AI 助手页面的主用实现。
- `src/App.tsx` 在根层级无条件渲染 `AiAssistantPanel`；该组件经 `AiChatProvider` 使用 `useAiChat`，因此 Hook 实现是全局悬浮面板的实际实现。

两处本次 diff 摘要：均新增本地常量 `MAX_CHAT_HISTORY = 12`，并将历史组装从 `messages.map(...)` 一致改为 `messages.slice(-MAX_CHAT_HISTORY).map(...)`；两者都发送同样的 `role/content` 结构和相同的 `/api/v1/ai/chat/stream` 路径。

## 3. AI 成本核实与限流

结论：存在额外计费调用，页面路径的一次成功且 AI 回复长度不少于 25 字的对话最多触发 3 次 DashScope 调用：

1. 主回答：`AiAssistantView.handleSendMessage` → `POST /api/v1/ai/chat/stream` → `handleAiChatStream` → `ai.chat.completions.create(..., stream: true)`。
2. 追问：`loadFollowups` → `aiApi.suggestFollowups` → `POST /api/v1/ai/suggest-followups` → `handleSuggestFollowups` → `callDashScopeJson` → `ai.chat.completions.create(...)`。
3. 知识沉淀判断：`checkKnowledgeContribution` → `aiApi.suggestContribution` → `POST /api/v1/ai/suggest-contribution` → `handleAiSuggestContribution` → `ai.chat.completions.create(...)`。

其中第 2、3 项均不是纯前端规则。第 3 项在回复少于 25 字时不会触发；全局悬浮面板的 Hook 路径调用主回答和追问，不调用知识沉淀判断。

处置：`src/server/index.ts` 已在原有全局限流之后挂载 `app.use("/api/v1/ai/", aiLimiter)`；复用既有 `createRateLimiter` 和 `aiLimiter`，限制为 60 次/分钟/IP。它覆盖 chat、stream、suggest-followups 与 suggest-contribution 等 v1 AI 请求。单用户演示的正常交互频率远低于 60 次/分钟，预期不影响演示。

## 4. 测试与验证

新增/扩展：

- `tests/ai-features.test.ts`：13 条 history 返回 400 且含指定错误信息；12 条可通过 schema；2001 字符 content 返回 400。
- `tests/rate-limit-sweep.test.ts`：挂载 AI 专属限流后，`POST /api/v1/ai/chat` 前 60 次通过、第 61 次返回 429 和 `RATE_LIMIT_EXCEEDED`。

结果：

- 定向运行 `vitest run tests/ai-features.test.ts tests/rate-limit-sweep.test.ts`：2 文件、23 用例全部通过。
- `tsc --noEmit`：通过（退出码 0，无输出）。
- 全量 `npm.cmd test` / `vitest run`：未全绿。失败为既有 `tests/optimistic-lock-and-concurrency.test.ts` 的“AI 健康趋势预测返回统计信息补齐全部 6 维遥测指标”，断言第 237 行期望 `stats[metric].min` 为 number，实际为 undefined。运行日志显示 DashScope 两个模型均为 `Connection error`，该测试依赖外部 AI 调用；失败与本次所改文件及路由无交集。为遵守范围约束，未修改该测试或预测业务代码来掩盖失败。

## 5. 遗留风险

- 两套对话实现仍保留，注释和一致的截断逻辑降低漂移风险，但长期应在独立版本完成合并迁移。
- 追问和知识沉淀仍各会产生一次模型调用；本次仅加限流，未改变现有前端行为。若需进一步降本，应另行产品决策，例如按需触发或合并结构化输出。
- 测试环境存在真实 DashScope 连接依赖，网络不可用会导致与本次无关的健康预测回归失败；建议后续将该外部调用 mock 化。
