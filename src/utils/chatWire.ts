/**
 * AI 对话历史的出网组包（唯一口径来源）。
 *
 * 后端 `src/server/schemas/ai.ts` 的 aiChatSchema 对 history 是**硬拒绝**：
 * 单条 >2000 字或整包 >12 条 → 400 INVALID_INPUT「请求体输入参数校验失败」。
 * 而 AI 一条回答本身就经常超过 2000 字，前端又会把它原样塞回 history ——
 * 于是只要历史里出现过一条长回答，之后**每一次**请求都 400（长回答要滑出最后
 * 12 条才自愈，用户侧表现就是"这个助手突然再也发不出消息"）。
 * 所以压缩必须发生在客户端：出网前按预算截尾 + 只留最近 12 条。
 *
 * 长度口径与 zod 的 .max() 一致，都按 UTF-16 码元计（String.length），
 * 因此这里判 ≤2000 通过的字符串，后端也必然判通过。
 */

export const MAX_CHAT_HISTORY = 12;
export const HISTORY_ITEM_MAX_CHARS = 2000;

const TRUNCATE_MARK = '…（已截断）';

export interface ChatWireHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

/** 会话消息的最小形状，兼容 useAiChat 与 AiAssistantView 两处的 {sender,text}。 */
export interface ChatWireSourceMessage {
  sender: string;
  text: string;
}

function clampContent(text: string): string {
  if (text.length <= HISTORY_ITEM_MAX_CHARS) return text;
  return text.slice(0, HISTORY_ITEM_MAX_CHARS - TRUNCATE_MARK.length) + TRUNCATE_MARK;
}

export function buildChatHistory(
  messages: readonly ChatWireSourceMessage[]
): ChatWireHistoryItem[] {
  return messages.slice(-MAX_CHAT_HISTORY).map((m) => ({
    role: m.sender === 'user' ? 'user' : 'assistant',
    content: clampContent(m.text ?? ''),
  }));
}

/**
 * 校验类 400 只回 `error: "请求体输入参数校验失败"`，具体原因在 `details[0].message`。
 * 气泡里只印前者等于没说，所以优先取后者。
 */
export function readWireError(
  payload: { error?: string; details?: { message?: string }[] } | null | undefined,
  fallback: string
): string {
  return payload?.details?.[0]?.message || payload?.error || fallback;
}
