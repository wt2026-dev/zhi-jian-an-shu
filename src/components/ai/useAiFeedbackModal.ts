import { useState } from 'react';
import { aiApi } from '../../api';
import { ChatMessage } from '../../hooks/useAiChat';
import { FeedbackModalState } from './AiFeedbackModal';

interface UseAiFeedbackModalOptions {
  messages: ChatMessage[];
  deviceId?: string;
}

export function useAiFeedbackModal({ messages, deviceId }: UseAiFeedbackModalOptions) {
  const [feedbackModal, setFeedbackModal] = useState<FeedbackModalState>({
    isOpen: false,
    message: null,
    userQuery: '',
    correction: '',
    rating: 1,
    submitting: false,
    error: null,
  });
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);

  const handleOpenFeedbackModal = (m: ChatMessage) => {
    const idx = messages.findIndex((item) => item.id === m.id);
    let userQuery = '';
    if (idx > 0) {
      for (let i = idx - 1; i >= 0; i--) {
        if (messages[i].sender === 'user') {
          userQuery = messages[i].text;
          break;
        }
      }
    }
    setFeedbackModal({
      isOpen: true,
      message: m,
      userQuery,
      correction: '',
      rating: 1,
      submitting: false,
      error: null,
    });
  };

  const handleSubmitFeedback = async () => {
    if (!feedbackModal.message || !feedbackModal.correction.trim()) {
      setFeedbackModal((prev) => ({ ...prev, error: '请填写纠错说明或专家修正意见' }));
      return;
    }
    setFeedbackModal((prev) => ({ ...prev, submitting: true, error: null }));
    try {
      await aiApi.submitFeedback({
        chatId: feedbackModal.message.chatId || feedbackModal.message.id,
        user_correction: feedbackModal.correction,
        corrected_content: feedbackModal.correction,
        model_response: feedbackModal.message.text,
        device_id: deviceId,
      });
      setFeedbackNotice('专家纠错已成功提交，已录入知识沉淀与审核队列！');
      setTimeout(() => setFeedbackNotice(null), 4000);
      setFeedbackModal((prev) => ({ ...prev, isOpen: false }));
    } catch (e: unknown) {
      setFeedbackModal((prev) => ({ ...prev, submitting: false, error: (e as Error)?.message || '提交纠错失败' }));
    }
  };

  return {
    feedbackModal,
    setFeedbackModal,
    feedbackNotice,
    handleOpenFeedbackModal,
    handleSubmitFeedback,
  };
}
