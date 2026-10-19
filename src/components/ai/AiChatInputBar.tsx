import React, { useRef } from 'react';
import { Sparkles, Mic, RefreshCw, X } from 'lucide-react';

interface AiChatInputBarProps {
  inputText: string;
  setInputText: (text: string | ((prev: string) => string)) => void;
  isStreaming: boolean;
  isAiLoading: boolean;
  isRecording: boolean;
  recordingSeconds: number;
  isTranscribing: boolean;
  voiceNotice: string | null;
  onDismissVoiceNotice: () => void;
  onStartVoiceRecording: () => void;
  onStopVoiceRecording: () => void;
  onToggleVoiceRecording: () => void;
  onSendMessage: (textToSend?: string) => void;
  onStopGeneration: () => void;
}

export const AiChatInputBar: React.FC<AiChatInputBarProps> = ({
  inputText,
  setInputText,
  isStreaming,
  isAiLoading,
  isRecording,
  recordingSeconds,
  isTranscribing,
  voiceNotice,
  onDismissVoiceNotice,
  onStartVoiceRecording,
  onStopVoiceRecording,
  onToggleVoiceRecording,
  onSendMessage,
  onStopGeneration,
}) => {
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoldModeRef = useRef(false);

  return (
    <div className="p-3 border-t border-amber-100/70 bg-gradient-to-b from-white/65 to-white/95 backdrop-blur-md space-y-2">
      {/* Voice Notice / Recording Animation */}
      {voiceNotice && (
        <div className="flex items-center justify-between px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-[11px] text-blue-700">
          <span className="flex items-center space-x-1.5">
            <Sparkles className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span>{voiceNotice}</span>
          </span>
          <button
            type="button"
            onClick={onDismissVoiceNotice}
            className="text-slate-500 hover:text-slate-700 ml-2 cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {isRecording && (
        <div className="flex items-center justify-between px-3 py-2 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs animate-in fade-in">
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-pulse" />
            <span className="font-bold">现场麦克风实时录音中:</span>
            <span className="font-mono text-rose-700 font-bold">00:{recordingSeconds.toString().padStart(2, '0')}</span>
            {/* 金色/天青声波仪：与数字人剧场保持同一套律动 */}
            <div className="flex items-end space-x-[3px] h-6 ml-2" aria-hidden="true">
              {Array.from({ length: 10 }).map((_, i) => (
                <span key={i} className={`w-[3px] rounded-full wave-bar-${(i % 5) + 1}`} />
              ))}
            </div>
          </div>
          <span className="text-[11px] text-rose-600">点击下方麦克风结束并由 Paraformer 识别</span>
        </div>
      )}

      <div className="flex items-center space-x-2">
        <button
          type="button"
          onMouseDown={() => {
            isHoldModeRef.current = false;
            holdTimerRef.current = setTimeout(() => {
              isHoldModeRef.current = true;
              onStartVoiceRecording();
            }, 220);
          }}
          onMouseUp={() => {
            if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
            if (isHoldModeRef.current) {
              onStopVoiceRecording();
            }
          }}
          onTouchStart={() => {
            isHoldModeRef.current = true;
            onStartVoiceRecording();
          }}
          onTouchEnd={() => {
            if (isHoldModeRef.current) {
              onStopVoiceRecording();
            }
          }}
          onClick={() => {
            if (!isHoldModeRef.current) {
              onToggleVoiceRecording();
            }
            isHoldModeRef.current = false;
          }}
          disabled={isTranscribing || isStreaming}
          title={isRecording ? '松开完成 / 点击停止录音并转写' : '按住说话 / 点击对讲开启现场录音'}
          className={`p-2.5 rounded-full transition-all cursor-pointer flex items-center justify-center shrink-0 select-none ${
            isRecording
              ? 'bg-rose-600 text-white animate-pulse shadow-sm ring-2 ring-rose-400'
              : isTranscribing
              ? 'bg-blue-100 text-blue-700 animate-spin'
              : 'bg-white border border-slate-200 hover:border-amber-300 hover:bg-amber-50/70 text-slate-600 hover:text-amber-700 active:bg-rose-600 active:text-white active:border-rose-600'
          }`}
        >
          {isTranscribing ? <RefreshCw className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>

        <textarea
          rows={2}
          disabled={isStreaming}
          placeholder={
            isStreaming
              ? 'AI 正在流式生成回复，可点击右侧「停止生成」中断...'
              : isRecording
              ? `正在现场录音... (${recordingSeconds}s) 点击麦克风完成并调用 Paraformer 转写`
              : isTranscribing
              ? 'Paraformer-v1 语音识别模型解析转录中...'
              : '输入故障现象、设备位号或规程问题 (Enter 发送 / Shift+Enter 换行)...'
          }
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => {
            // 中文输入法候选未确认时的 Enter 属于「选词/上屏」，不是发送；
            // 这里若照旧 preventDefault，会把候选提交一起吞掉，表现为按了没反应。
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSendMessage();
            }
          }}
          className="flex-1 bg-white/70 border border-slate-200 rounded-xl px-4 py-2 text-xs text-slate-800 placeholder-slate-400 focus:bg-white resize-none disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        />

        {isStreaming ? (
          <button
            type="button"
            onClick={onStopGeneration}
            className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-full text-xs font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer transition-colors"
          >
            <span className="w-2.5 h-2.5 bg-white rounded-xs" />
            <span>停止生成</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onSendMessage()}
            disabled={!inputText.trim() || isAiLoading || isTranscribing}
            className="px-4 py-2.5 rounded-full btn-gold text-xs font-semibold flex items-center space-x-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>发送</span>
          </button>
        )}
      </div>

      {/* Quick Speech Phrases for Instant Testing */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <Mic className="w-3 h-3 text-cyan-500" />
          现场对讲语音快捷填入:
        </span>
        <button
          type="button"
          onClick={() => setInputText('2号循环泵轴承箱温度升至76度，出口压力表剧烈抖动，伴随金属干摩擦异响，请排查游隙')}
          className="chip-cyan"
        >
          泵轴温76°C抖动异响
        </button>
        <button
          type="button"
          onClick={() => setInputText('动力站MCC配电柜停电检修，动力电380V，请生成五步法LOTO挂牌上锁与能量隔离措施')}
          className="chip-cyan"
        >
          MCC停电LOTO上锁流程
        </button>
        <button
          type="button"
          onClick={() => setInputText('工业管线二道截止阀气割动火作业，属于二级高危作业，需要落实哪些防火监护措施')}
          className="chip-cyan"
        >
          管线动火作业票防火要求
        </button>
      </div>
    </div>
  );
};
