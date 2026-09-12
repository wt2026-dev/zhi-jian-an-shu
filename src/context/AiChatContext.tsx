import React, { createContext, useContext, useMemo, useState } from 'react';
import { useAiChat, AiChatApi } from '../hooks/useAiChat';

interface AiChatContextValue extends AiChatApi {
  /** 悬浮面板是否展开 */
  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  /** 外部（如驾驶舱"AI 解读"）预填的问题文本 */
  prefill: string;
  /** 递增序号：即使两次预填文本相同也能触发面板重新消费 */
  prefillSeq: number;
  clearPrefill: () => void;
  /** 唤起面板并预填问题（面板会自动发送并回答） */
  askAi: (text: string) => void;
}

const AiChatContext = createContext<AiChatContextValue | null>(null);

export const AiChatProvider: React.FC<{
  userRoleTitle?: string;
  children: React.ReactNode;
}> = ({ userRoleTitle, children }) => {
  const chat = useAiChat(userRoleTitle);
  const [panelOpen, setPanelOpen] = useState(false);
  const [prefill, setPrefill] = useState('');
  const [prefillSeq, setPrefillSeq] = useState(0);

  const askAi = (text: string) => {
    setPrefill(text);
    setPrefillSeq((s) => s + 1);
    setPanelOpen(true);
  };

  const value = useMemo<AiChatContextValue>(
    () => ({
      ...chat,
      panelOpen,
      openPanel: () => setPanelOpen(true),
      closePanel: () => setPanelOpen(false),
      prefill,
      prefillSeq,
      clearPrefill: () => setPrefill(''),
      askAi,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chat, panelOpen, prefill, prefillSeq]
  );

  return <AiChatContext.Provider value={value}>{children}</AiChatContext.Provider>;
};

export function useAiChatContext(): AiChatContextValue {
  const ctx = useContext(AiChatContext);
  if (!ctx) throw new Error('useAiChatContext 必须在 AiChatProvider 内部使用');
  return ctx;
}

export default AiChatContext;
