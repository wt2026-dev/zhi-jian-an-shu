import React from 'react';
import {
  Sparkles,
  User,
  AlertTriangle,
  BookOpen,
  X,
  CheckCircle2,
  Loader2,
  FileCheck,
} from 'lucide-react';
import { UserProfile } from '../../types';
import { ChatMessage } from '../../hooks/useAiChat';
import { Markdown } from './Markdown';

export const WELCOME_PROMPTS = [
  '离心泵、压缩机、减速箱等典型故障树与振动对中分析',
  '现场 LOTO 能量隔离与高危作业票安全规范',
  '根据轴温与电流遥测数据研判劣化趋势',
  '设备外观或破损照片的视觉损伤识别要点',
];

export interface ContributionSuggestionData {
  id?: string;
  chatId?: string;
  title: string;
  type: string;
  equipment: string;
  summary: string;
  solution: string;
}

interface AiChatMessagesListProps {
  messages: ChatMessage[];
  currentUser: UserProfile;
  isSpeaking: boolean;
  isStreaming: boolean;
  isAiLoading: boolean;
  copiedMessageId: string | null;
  feedbackNotice: string | null;
  followups: string[];
  loadingFollowups: boolean;
  contributionSuggestion: ContributionSuggestionData | null;
  isSubmittingContribution: boolean;
  contributionNotice: string | null;
  chatBottomRef: React.RefObject<HTMLDivElement | null>;
  onSendMessage: (text: string) => void;
  onRegenerate: (aiMsgId: string) => void;
  onCopyMessage: (msg: ChatMessage) => void;
  onOpenFeedbackModal: (msg: ChatMessage) => void;
  onDismissContribution: () => void;
  onSubmitContribution: () => void;
}

export const AiChatMessagesList: React.FC<AiChatMessagesListProps> = ({
  messages,
  currentUser,
  isSpeaking,
  isStreaming,
  isAiLoading,
  copiedMessageId,
  feedbackNotice,
  followups,
  loadingFollowups,
  contributionSuggestion,
  isSubmittingContribution,
  contributionNotice,
  chatBottomRef,
  onSendMessage,
  onRegenerate,
  onCopyMessage,
  onOpenFeedbackModal,
  onDismissContribution,
  onSubmitContribution,
}) => {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-5 space-y-3 bg-white/20">
      {messages.map((m) => {
        const isUser = m.sender === 'user';
        const isError = m.kind === 'error';
        return (
          <div
            key={m.id}
            className={`flex items-start space-x-3 ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`}
          >
            {/* 头像区域：AI 侧楷体"智"金字+发光脉冲点，用户侧蓝青渐变+角色首字 */}
            <div className="relative shrink-0">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center relative overflow-hidden ${
                  isUser
                    ? 'bg-gradient-to-br from-blue-600 to-cyan-500 text-white shadow-sm flex-col'
                    : 'icon-tile-gold border border-amber-300/70 shadow-sm'
                }`}
              >
                {!isUser && <span className="hud-halo opacity-60" />}
                {isUser ? (
                  <>
                    <User className="w-4 h-4" />
                    <span className="text-[9px] leading-tight text-white/95 font-medium -mt-0.5">
                      {currentUser?.roleTitle ? currentUser.roleTitle.charAt(0) : '工'}
                    </span>
                  </>
                ) : (
                  <span
                    className="font-black leading-none text-[18px] relative z-1"
                    style={{ fontFamily: "'KaiTi','STKaiti','FangSong','SimSun',serif" }}
                  >
                    智
                  </span>
                )}
              </div>
              {!isUser && (m.streaming || (isSpeaking && !isUser && messages[messages.length - 1]?.id === m.id)) && (
                <span className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500 ring-2 ring-white animate-pulse" />
              )}
            </div>

            {/* 气泡区域：四角统一 20px 圆角与纵向间距 */}
            <div
              className={`max-w-[85%] px-4 py-3 text-xs leading-relaxed ${
                isUser
                  ? 'bubble-frost-user space-y-2'
                  : isError
                  ? 'bg-rose-50/95 border border-rose-200 text-rose-900 rounded-[var(--radius-lg)] shadow-sm space-y-2'
                  : 'bubble-frost text-slate-800 space-y-2'
              }`}
            >
              {/* 首条欢迎问候卡：2x2 交互引导块 */}
              {m.id === 'm-init' ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-amber-200/40">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-slate-800 text-sm">智检安枢 · 工业设备检修 AI 专家</span>
                      <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 font-medium">
                        专家中枢
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        知识库 · 已连接
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-cyan-50 text-cyan-700 border border-cyan-200/80">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
                        设备遥测中枢 · 已连接
                      </span>
                    </div>
                  </div>
                  <p className="text-slate-600 text-xs">
                    你好，我是 <strong className="text-slate-800">智检安枢的工业设备检修 AI 专家</strong>。已连接工厂知识库与设备遥测中枢，您可以直接点击下方推荐场景发起研判或在底部自由提问：
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
                    {WELCOME_PROMPTS.map((prompt, pIdx) => (
                      <button
                        key={pIdx}
                        type="button"
                        onClick={() => onSendMessage(prompt)}
                        disabled={isStreaming || isAiLoading}
                        className="chip-gold !whitespace-normal !h-auto text-left p-2.5 !rounded-xl flex items-start gap-2 hover:shadow-xs transition-all cursor-pointer disabled:opacity-50 text-xs leading-relaxed"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                        <span className="text-slate-800 font-medium">{prompt}</span>
                      </button>
                    ))}
                  </div>
                  <div className="text-right pt-1">
                    <span className="text-[9px] text-slate-400">{m.timestamp}</span>
                  </div>
                </div>
              ) : isError ? (
                /* 错误气泡：隔离于专家纠错队列之外，仅保留重新生成 */
                <div className="space-y-2">
                  <div className="flex items-center space-x-1.5 text-rose-800 font-semibold">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>请求未完成</span>
                  </div>
                  <p className="text-xs text-rose-700 leading-relaxed break-all font-mono">
                    {m.text}
                  </p>
                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => onRegenerate(m.id)}
                      disabled={isStreaming || isAiLoading}
                      className="text-[10px] px-2 py-0.5 rounded bg-rose-100 hover:bg-rose-200 text-rose-800 border border-rose-200 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      title="重新生成此回复"
                    >
                      重新生成
                    </button>
                    <span className="text-[9px] text-rose-400">{m.timestamp}</span>
                  </div>
                </div>
              ) : (
                /* 常规文本气泡 */
                <>
                  {isUser ? (
                    <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed">{m.text}</pre>
                  ) : (
                    // AI 回复即使流式中也直接渲染 Markdown：早先为省 CPU 用 <pre> 显示原文，
                    // 副作用是整段带 # / ** 的裸文本先糊在气泡里、结束才"啪"地排版，观感像没流式。
                    // 渲染已 100ms 节流 + Markdown 组件 memo，重解析成本可忽略。
                    <Markdown content={m.text || ' '} tone="light" />
                  )}
                  {m.streaming &&
                    (m.text ? (
                      <span className="inline-block w-1.5 h-3.5 bg-blue-600 animate-pulse rounded-xs ml-0.5 align-text-bottom" />
                    ) : (
                      // 首字到达前（模型 TTFT 空窗）：三个跳动小点，明确"正在响应"，非伪装内容
                      <span className="inline-flex items-center gap-1 ml-0.5 align-middle py-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.3s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.15s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" />
                      </span>
                    ))}
                  <div className={`flex items-center ${isUser ? 'justify-end' : 'justify-between'} gap-2`}>
                    {!isUser && !m.streaming && m.text && (
                      <div className="flex items-center space-x-1.5 mt-1">
                        <button
                          type="button"
                          onClick={() => onCopyMessage(m)}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 border border-slate-200 transition-colors cursor-pointer"
                          title="复制回复"
                        >
                          {copiedMessageId === m.id ? '已复制' : '复制'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onRegenerate(m.id)}
                          disabled={isStreaming || isAiLoading}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 border border-slate-200 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          title="重新生成此回复"
                        >
                          重新生成
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenFeedbackModal(m)}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 transition-colors cursor-pointer"
                          title="对本条 AI 回复进行质量评分与专家纠错标注"
                        >
                          标记/纠错
                        </button>
                      </div>
                    )}
                    <span
                      className={`text-[9px] block mt-1 ${
                        isUser ? 'text-blue-100 text-right' : 'text-slate-500'
                      }`}
                    >
                      {m.timestamp}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })}

      {isStreaming && (
        <div className="flex items-center space-x-2 px-2">
          <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
          <span className="text-[11px] text-slate-500">正在生成... (可点击输入框右侧按钮停止)</span>
        </div>
      )}
      {feedbackNotice && <div className="text-[11px] text-emerald-700 font-medium pl-11">{feedbackNotice}</div>}
      {!isStreaming && !isAiLoading && followups.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pl-11">
          <span className="text-[10px] text-slate-500 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-amber-500" />
            你可能想追问：
          </span>
          {followups.map((q, qi) => (
            <button
              key={qi}
              type="button"
              onClick={() => onSendMessage(q)}
              className="chip-gold fx-shimmer"
            >
              <Sparkles className="w-3 h-3 shrink-0 opacity-75" />
              <span>{q}</span>
            </button>
          ))}
          {loadingFollowups && <span className="text-[10px] text-slate-500 animate-pulse">追问生成中...</span>}
        </div>
      )}

      {/* 功能②：知识贡献识别推荐卡片 (明亮玻璃科技风) */}
      {!isStreaming && !isAiLoading && contributionSuggestion && (
        <div className="mx-2 my-2.5 p-3.5 rounded-xl bg-white/95 backdrop-blur-md border border-blue-200/90 shadow-sm space-y-2.5 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-2">
              <span className="p-1 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
                <BookOpen className="w-3.5 h-3.5" />
              </span>
              <div>
                <h4 className="text-xs font-bold text-slate-900">
                  📝 本次排查值得沉淀为知识案例，是否提交？
                </h4>
                <div className="flex items-center space-x-2 mt-0.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                    {contributionSuggestion.type || '故障案例'}
                  </span>
                  {contributionSuggestion.equipment && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 font-medium">
                      {contributionSuggestion.equipment}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onDismissContribution}
              className="text-slate-500 hover:text-slate-600 text-xs px-1.5 py-0.5 rounded cursor-pointer"
              title="忽略"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-2.5 rounded-lg bg-slate-50/90 border border-slate-200/80 text-xs space-y-1">
            <div className="font-semibold text-slate-800">
              <span className="text-[11px] text-slate-500 mr-1.5">标题:</span>
              <span>{contributionSuggestion.title}</span>
            </div>
            {contributionSuggestion.summary && (
              <p className="text-slate-600 text-[11px] leading-relaxed">
                <span className="text-slate-500 mr-1">摘要:</span>
                {contributionSuggestion.summary}
              </p>
            )}
            {contributionSuggestion.solution && (
              <p className="text-slate-600 text-[11px] leading-relaxed">
                <span className="text-slate-500 mr-1">处置要点:</span>
                {contributionSuggestion.solution}
              </p>
            )}
          </div>

          {contributionNotice ? (
            <div className="flex items-center space-x-1.5 text-xs text-emerald-700 font-semibold py-1">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>{contributionNotice}</span>
            </div>
          ) : (
            <div className="flex items-center justify-end space-x-2 pt-0.5">
              <button
                type="button"
                onClick={onDismissContribution}
                className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg cursor-pointer transition-colors"
              >
                忽略
              </button>
              <button
                type="button"
                onClick={onSubmitContribution}
                disabled={isSubmittingContribution}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg flex items-center space-x-1.5 shadow-xs cursor-pointer transition-colors"
              >
                {isSubmittingContribution ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>提交中...</span>
                  </>
                ) : (
                  <>
                    <FileCheck className="w-3.5 h-3.5" />
                    <span>提交</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      <div ref={chatBottomRef} />
    </div>
  );
};
