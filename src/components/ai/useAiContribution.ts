import { useState } from 'react';
import { aiApi } from '../../api';
import { ContributionSuggestionData } from './AiChatMessagesList';
import type { Equipment } from '../../types';

interface UseAiContributionOptions {
  equipments: Equipment[];
  diagEqId: string;
  showToast: (toast: { type: 'success' | 'error' | 'warning' | 'info'; title: string; message?: string }) => void;
}

export function useAiContribution({ equipments, diagEqId, showToast }: UseAiContributionOptions) {
  const [contributionSuggestion, setContributionSuggestion] = useState<ContributionSuggestionData | null>(null);
  const [isSubmittingContribution, setIsSubmittingContribution] = useState(false);
  const [contributionNotice, setContributionNotice] = useState<string | null>(null);

  const checkKnowledgeContribution = async (lastUserMessage: string, lastAiReply: string) => {
    if (!lastAiReply || lastAiReply.length < 25) return;
    try {
      const currentEqName = equipments.find((e) => e.id === diagEqId)?.name || undefined;
      const res = await aiApi.suggestContribution({
        lastUserMessage,
        lastAiReply,
        equipment: currentEqName,
      });
      if (res.success && res.suggestion?.worthContributing) {
        setContributionSuggestion(res.suggestion);
      }
    } catch {
      // 建议识别失败静默忽略
    }
  };

  const handleSubmitContribution = async () => {
    if (!contributionSuggestion) return;
    setIsSubmittingContribution(true);
    try {
      const res = await aiApi.submitContribution({
        id: contributionSuggestion.id,
        chatId: contributionSuggestion.chatId,
        title: contributionSuggestion.title,
        type: contributionSuggestion.type,
        equipment: contributionSuggestion.equipment,
        summary: contributionSuggestion.summary,
        solution: contributionSuggestion.solution,
      });
      if (res.success) {
        setContributionNotice('已提交，待知识管理员审核');
        setTimeout(() => {
          setContributionSuggestion(null);
          setContributionNotice(null);
        }, 2500);
      }
    } catch (e: unknown) {
      showToast({ type: 'error', title: '提交知识沉淀失败', message: (e as Error)?.message || '网络异常' });
    } finally {
      setIsSubmittingContribution(false);
    }
  };

  return {
    contributionSuggestion,
    setContributionSuggestion,
    isSubmittingContribution,
    contributionNotice,
    checkKnowledgeContribution,
    handleSubmitContribution,
  };
}
