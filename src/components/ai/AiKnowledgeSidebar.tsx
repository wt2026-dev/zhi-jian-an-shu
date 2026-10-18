import React from 'react';
import { HelpCircle, Mic } from 'lucide-react';
import { DigitalHumanAvatar, DigitalHumanAvatarHandle } from '../DigitalHumanAvatar';

interface AiKnowledgeSidebarProps {
  avatarRef: React.RefObject<DigitalHumanAvatarHandle | null>;
  isSpeaking: boolean;
  isListening: boolean;
  speechEnabled: boolean;
  onToggleSpeech: () => void;
  onSpeakingChange: (speaking: boolean) => void;
  onSelectPrompt: (directive: string) => void;
  onSendMessage: (text: string) => void;
  hotPrompts: Array<{ title: string; question: string }>;
}

export const AiKnowledgeSidebar: React.FC<AiKnowledgeSidebarProps> = ({
  avatarRef,
  isSpeaking,
  isListening,
  speechEnabled,
  onToggleSpeech,
  onSpeakingChange,
  onSelectPrompt,
  onSendMessage,
  hotPrompts,
}) => {
  return (
    <div className="lg:col-span-4 h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {/* 3D Digital Human Avatar with 2D Fallback */}
        <DigitalHumanAvatar
          ref={avatarRef}
          isSpeaking={isSpeaking}
          isListening={isListening}
          speechEnabled={speechEnabled}
          onToggleSpeech={onToggleSpeech}
          onSpeakingChange={onSpeakingChange}
          onSelectPrompt={onSelectPrompt}
        />

        <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 space-y-3 shadow-xs">
          <h3 className="text-xs font-bold text-slate-800 flex items-center">
            <HelpCircle className="w-4 h-4 mr-1.5 text-blue-600" />
            热点检修与安全规程推荐
          </h3>
          <div className="space-y-2">
            {hotPrompts.length === 0 ? (
              <p className="text-[11px] text-slate-500 p-2">知识库规程加载中或暂无可推荐内容...</p>
            ) : (
              hotPrompts.map((k, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onSendMessage(k.question)}
                  title={k.title}
                  className="w-full text-left p-2.5 rounded-lg bg-slate-50 hover:bg-blue-50 border border-slate-200 text-xs text-slate-700 hover:text-blue-700 transition-colors cursor-pointer leading-relaxed"
                >
                  {k.title}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-4 text-xs space-y-2">
          <span className="font-bold text-blue-900 flex items-center">
            <Mic className="w-4 h-4 mr-1.5 text-blue-600" />
            现场语音转录开单功能
          </span>
          <p className="text-slate-600 text-[11px] leading-relaxed">
            在现场佩戴防噪对讲耳机时，可长按麦克风语音描述现场故障，AI 自动清洗口语化噪音并结构化提取为工单要素。
          </p>
        </div>
      </div>
    </div>
  );
};
