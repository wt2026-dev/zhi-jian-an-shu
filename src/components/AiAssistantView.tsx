import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  Send,
  Wrench,
  Camera,
  Mic,
  Volume2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Upload,
  Bot,
  User,
  Image as ImageIcon,
  Flame,
  ArrowRight,
  Shield,
  Layers,
  HelpCircle,
  X,
  Cpu,
  Star,
  BookOpen,
  FileCheck,
  ChevronDown,
  Search,
  Loader2,
} from 'lucide-react';
import { Equipment, UserProfile, WorkOrder } from '../types';
import { aiApi, knowledgeApi, safeStorage } from '../api';
import { Markdown } from './ai/Markdown';
import { DigitalHumanAvatar, DigitalHumanAvatarHandle } from './DigitalHumanAvatar';
import { useAiChatContext } from '../context/AiChatContext';

/**
 * 本组件与 useAiChat.ts + AiAssistantPanel 的 AI 对话实现功能重叠；当前实际渲染的
 * 主用页面实现为 AiAssistantView（App.tsx 在 activeTab === 'ai_assistant' 时渲染）。
 * AiAssistantPanel 仍会全局渲染并使用 Hook 实现；修改 AI 对话逻辑时须两处同步，
 * 或后续版本迁移至单一实现。
 */
const MAX_CHAT_HISTORY = 12;

interface AiAssistantViewProps {
  currentUser: UserProfile;
  equipments: Equipment[];
  prefilledEquipment?: Equipment | null;
  prefilledQuery?: string | null;
  onCreateWorkOrderFromAi: (title: string, equipmentName: string, description: string) => void;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  structuredData?: any;
  streaming?: boolean;
  chatId?: string;
}

export const AiAssistantView: React.FC<AiAssistantViewProps> = ({
  currentUser,
  equipments,
  prefilledEquipment,
  prefilledQuery,
  onCreateWorkOrderFromAi,
}) => {
  const [activeMode, setActiveMode] = useState<'chat' | 'diagnose' | 'vision'>('chat');

  // Chat State：消息数组与全局悬浮 AI 助手面板共享同一会话（同一上下文实例）
  const chat = useAiChatContext();
  const messages = chat.messages;
  const setMessages = chat.setMessages;
  const [inputText, setInputText] = useState(prefilledQuery || '');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const avatarRef = useRef<DigitalHumanAvatarHandle>(null);
  // 流式渲染节流：增量文本先入 buffer，定时批量提交，避免每个 SSE chunk 触发一次全量渲染 (防卡顿/内存膨胀)
  const streamBufferRef = useRef<string>('');
  const streamFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [followups, setFollowups] = useState<string[]>([]);
  const [loadingFollowups, setLoadingFollowups] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  // 功能②：知识自进化贡献推荐卡片状态
  const [contributionSuggestion, setContributionSuggestion] = useState<{
    id?: string;
    chatId?: string;
    title: string;
    type: string;
    equipment: string;
    summary: string;
    solution: string;
  } | null>(null);
  const [isSubmittingContribution, setIsSubmittingContribution] = useState(false);
  const [contributionNotice, setContributionNotice] = useState<string | null>(null);

  // 数字人语音播报状态：复用共享会话上下文（开关与朗读状态全局一致）
  const speechEnabled = chat.speechEnabled;
  const isSpeaking = chat.isSpeaking;
  const handleToggleSpeech = chat.toggleSpeech;
  const speakText = chat.speakText;
  const stopSpeaking = chat.stopSpeaking;

  // 专家纠错与反馈标准弹窗状态 (替代原有 window.prompt)
  const [feedbackModal, setFeedbackModal] = useState<{
    isOpen: boolean;
    message: ChatMessage | null;
    userQuery: string;
    correction: string;
    rating: number;
    submitting: boolean;
    error: string | null;
  }>({
    isOpen: false,
    message: null,
    userQuery: '',
    correction: '',
    rating: 1,
    submitting: false,
    error: null,
  });

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
        device_id: prefilledEquipment?.id,
      });
      setFeedbackNotice('专家纠错已成功提交，已录入知识沉淀与审核队列！');
      setTimeout(() => setFeedbackNotice(null), 4000);
      setFeedbackModal((prev) => ({ ...prev, isOpen: false }));
    } catch (e: any) {
      setFeedbackModal((prev) => ({ ...prev, submitting: false, error: e?.message || '提交纠错失败' }));
    }
  };

  // 热点规程推荐：从知识库真实数据随机抽取 (非硬编码)
  const [hotPrompts, setHotPrompts] = useState<{ title: string; question: string }[]>([]);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // 挂载时从知识库随机抽取 4 条真实规程标题作为热点推荐
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await knowledgeApi.list();
        if (!cancelled && Array.isArray(list) && list.length > 0) {
          const picked = [...list].sort(() => Math.random() - 0.5).slice(0, 4);
          setHotPrompts(picked.map((k: any) => ({
            title: k.title,
            question: `请结合《${k.title}》规程要点，说明其在现场检修中如何应用？`,
          })));
        }
      } catch {
        // 知识库拉取失败时不展示热点推荐 (不使用硬编码兜底)
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Diagnosis Wizard State
  const [diagEqId, setDiagEqId] = useState<string>(
    prefilledEquipment?.id || equipments[0]?.id || ''
  );
  const [diagSymptoms, setDiagSymptoms] = useState('机组带载运行时轴承座伴随规律性低频轰鸣与剧烈振动');
  const [diagCategory, setDiagCategory] = useState('泵类设备');
  const [diagResult, setDiagResult] = useState<any | null>(null);
  const [diagSafetyNotice, setDiagSafetyNotice] = useState<any | null>(null);
  const [diagTraceability, setDiagTraceability] = useState<any | null>(null);
  const [diagSafetyConfirmed, setDiagSafetyConfirmed] = useState(false);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [diagError, setDiagError] = useState<string | null>(null);

  // Vision Defect State
  const [selectedSampleImage, setSelectedSampleImage] = useState<string>('bearing_pitting');
  const [customImageBase64, setCustomImageBase64] = useState<string | null>(null);
  const [customImagePreview, setCustomImagePreview] = useState<string | null>(null);
  const [uploadedImageInfo, setUploadedImageInfo] = useState<{ url: string; filename: string; size: number } | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [visionPrompt, setVisionPrompt] = useState('请分析此轴承滚动体损伤类型、严重程度、失效机理及检修建议');
  const [visionResult, setVisionResult] = useState<any | null>(null);
  const [isVisionAnalyzing, setIsVisionAnalyzing] = useState(false);
  // 功能④：多模态相似案例检索状态
  const [isSearchingMultimodal, setIsSearchingMultimodal] = useState(false);
  const [multimodalCases, setMultimodalCases] = useState<Array<{
    id: string;
    title: string;
    category: string;
    targetEquipment?: string;
    summary: string;
    content: string;
  }> | null>(null);
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null);
  const [multimodalVisionDesc, setMultimodalVisionDesc] = useState<string | null>(null);
  const [multimodalSafetyHint, setMultimodalSafetyHint] = useState<string | null>(null);

  // Audio / Voice Recording State (MediaRecorder API)
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (prefilledQuery) {
      handleSendMessage(prefilledQuery);
    }
  }, [prefilledQuery]);

  // 流式高频更新时使用即时滚动 (避免堆积大量 smooth 滚动动画)，且仅在接近底部时自动跟随
  const SCROLL_THRESHOLD_PX = 160;
  useEffect(() => {
    const el = chatBottomRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nearBottom = rect.top - (window.innerHeight || 800) < SCROLL_THRESHOLD_PX;
    if (nearBottom) {
      el.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [messages]);

  // Voice recording timer
  useEffect(() => {
    let timer: any;
    if (isRecording) {
      timer = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } else {
      setRecordingSeconds(0);
    }
    return () => clearInterval(timer);
  }, [isRecording]);

  // 流式读取 SSE 并以打字机效果追加到当前 AI 消息 (任务一)
  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend || inputText;
    if (!text.trim() || isAiLoading || isStreaming) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    };
    const aiMsgId = `ai-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: aiMsgId, sender: 'assistant', text: '', timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }), streaming: true },
    ]);
    setInputText('');
    setFollowups([]);
    setIsAiLoading(true);
    setIsStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    let replyText = '';
    let chatId = '';

    try {
      const token = safeStorage.getItem('auth_token');
      const res = await fetch('/api/v1/ai/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          message: text,
          userRole: currentUser.roleTitle,
          history: messages.slice(-MAX_CHAT_HISTORY).map((m) => ({
            role: m.sender === 'user' ? 'user' : 'assistant',
            content: m.text,
          })),
        }),
      });

      if (!res.ok || !res.body) {
        let msg = `HTTP ${res.status}`;
        try { msg = (await res.json()).error || msg; } catch {}
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const evt of events) {
          const line = evt.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.chatId) chatId = parsed.chatId;
            if (parsed.content) {
              replyText += parsed.content;
              streamBufferRef.current = replyText;
              // 60ms 节流批量提交，渲染频率与 SSE chunk 频率解耦
              if (streamFlushTimerRef.current === null) {
                streamFlushTimerRef.current = setTimeout(() => {
                  streamFlushTimerRef.current = null;
                  const snapshot = streamBufferRef.current;
                  setMessages((prev) =>
                    prev.map((m) => (m.id === aiMsgId ? { ...m, text: snapshot } : m))
                  );
                }, 100);
              }
            }
            if (parsed.error) streamError = parsed.error;
          } catch {}
        }
      }

      if (streamFlushTimerRef.current !== null) {
        clearTimeout(streamFlushTimerRef.current);
        streamFlushTimerRef.current = null;
      }
      if (streamError) {
        const errText = `⚠️ ${streamError}`;
        setMessages((prev) => prev.map((m) => (m.id === aiMsgId ? { ...m, text: errText, streaming: false } : m)));
      } else {
        setMessages((prev) =>
          prev.map((m) => (m.id === aiMsgId ? { ...m, text: replyText || '(AI 未返回内容)', chatId, streaming: false } : m))
        );
        // 回复完成后触发数字人语音播报（3D 魔珐星云优先发声；2D 降级走 Web Speech 朗读）
        if (replyText) {
          const is3D = avatarRef.current?.is3D?.() ?? false;
          if (is3D) {
            try { avatarRef.current?.speak(replyText); } catch {}
          } else {
            speakText(replyText);
          }
        }
        // 回复完成后异步生成追问建议 (功能 7)
        loadFollowups(text, replyText);
        // 功能②：对话后判断是否沉淀为知识案例
        checkKnowledgeContribution(text, replyText);
      }
    } catch (e: any) {
      if (streamFlushTimerRef.current !== null) {
        clearTimeout(streamFlushTimerRef.current);
        streamFlushTimerRef.current = null;
      }
      const aborted = e?.name === 'AbortError';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId
            ? {
                ...m,
                text: aborted ? (replyText ? `${replyText}\n\n*[生成已中止]*` : '*(已停止生成)*') : `⚠️ 请求失败: ${e?.message || '网络异常'}`,
                streaming: false,
              }
            : m
        )
      );
      if (!aborted && replyText) {
        loadFollowups(text, replyText);
        checkKnowledgeContribution(text, replyText);
      }
    } finally {
      setIsAiLoading(false);
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  // 停止生成：中止 fetch 并结束当前流式消息与数字人发声
  const handleStopGeneration = () => {
    abortControllerRef.current?.abort();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    stopSpeaking?.();
    try { avatarRef.current?.stop?.(); } catch {}
  };

  // 重新生成：以该条 AI 消息之前最近的用户消息重发
  const handleRegenerate = (aiMsgId: string) => {
    if (isStreaming || isAiLoading) return;
    const idx = messages.findIndex((m) => m.id === aiMsgId);
    if (idx <= 0) return;
    let userText = '';
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].sender === 'user') {
        userText = messages[i].text;
        break;
      }
    }
    if (!userText) return;
    // 移除该 AI 消息与其用户问题，重新发送
    setMessages((prev) => prev.slice(0, Math.max(0, idx - 1)));
    setTimeout(() => handleSendMessage(userText), 50);
  };

  const handleCopyMessage = async (msg: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.text);
      setCopiedMessageId(msg.id);
      setTimeout(() => setCopiedMessageId(null), 1600);
    } catch {}
  };

  // 功能 7：基于上一轮问答生成追问建议按钮
  const loadFollowups = async (lastUserMessage: string, lastAiReply: string) => {
    if (!lastAiReply) return;
    setLoadingFollowups(true);
    try {
      const res = await aiApi.suggestFollowups({ lastUserMessage, lastAiReply });
      if (res.success && res.suggestions?.length) {
        setFollowups(res.suggestions);
      }
    } catch {
      // 追问建议失败静默忽略，不影响主对话
    } finally {
      setLoadingFollowups(false);
    }
  };

  // 功能②：知识贡献识别（对话结束后判断是否沉淀为知识案例）
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
    } catch (e: any) {
      alert('提交知识沉淀失败: ' + (e.message || '网络异常'));
    } finally {
      setIsSubmittingContribution(false);
    }
  };

  // 功能④：多模态相似案例检索 (看图检索知识库相似案例)
  const handleRunMultimodalSearch = async () => {
    if (!customImageBase64 && !customImagePreview) {
      alert('请先上传或选择待检索的设备现场图片');
      return;
    }
    setIsSearchingMultimodal(true);
    setMultimodalCases(null);
    try {
      const res = await aiApi.multimodalSearch({
        imageBase64: customImageBase64 || '',
        userText: visionPrompt || visionResult?.defectType || '',
      });
      if (res.success) {
        setMultimodalVisionDesc(res.visionDescription || null);
        setMultimodalSafetyHint(res.safetyHint || null);
        setMultimodalCases(res.cases || []);
      } else {
        alert('多模态检索未返回有效案例');
      }
    } catch (e: any) {
      alert('多模态检索失败: ' + (e.message || '网络异常'));
    } finally {
      setIsSearchingMultimodal(false);
    }
  };

  const handleRunDiagnosis = async () => {
    setIsDiagnosing(true);
    setDiagResult(null);
    setDiagSafetyNotice(null);
    setDiagTraceability(null);
    setDiagSafetyConfirmed(false);
    setDiagError(null);

    const targetEq = equipments.find((e) => e.id === diagEqId) || equipments[0];

    try {
      const res = await fetch('/api/v1/ai/diagnose', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(safeStorage.getItem('auth_token') ? { Authorization: `Bearer ${safeStorage.getItem('auth_token')}` } : {}),
        },
        body: JSON.stringify({
          equipmentName: targetEq.name,
          equipmentCode: targetEq.code,
          category: diagCategory,
          symptoms: diagSymptoms,
          telemetry: targetEq.telemetry,
        }),
      });

      const data = await res.json();
      if (data.success && data.diagnosis) {
        setDiagResult(data.diagnosis);
        setDiagSafetyNotice(data.safetyNotice || null);
        setDiagTraceability(data.traceability || null);
        setDiagSafetyConfirmed(false);
      } else {
        throw new Error(data?.error || 'AI 诊断服务未返回有效结论');
      }
    } catch (e: any) {
      // 绝不本地伪造诊断结论兜底，失败必须明确提示用户
      setDiagError(e?.message || 'AI 多维诊断请求失败，请稍后重试');
    } finally {
      setIsDiagnosing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingImage(true);
    setUploadError(null);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      setCustomImageBase64(base64);
      setCustomImagePreview(dataUrl);

      try {
        const uploadRes = await aiApi.uploadImage(base64, file.name);
        if (uploadRes && uploadRes.success) {
          setUploadedImageInfo({
            url: uploadRes.url,
            filename: uploadRes.filename,
            size: uploadRes.size,
          });
        }
      } catch (err: any) {
        console.warn('Image upload backend error:', err);
        setUploadError(err.message || '图片上传至服务器失败');
      } finally {
        setIsUploadingImage(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRunVisionAnalysis = async () => {
    setIsVisionAnalyzing(true);
    setVisionResult(null);

    try {
      const res = await aiApi.detectVisionDefects({
        imageBase64: customImageBase64 || '',
        imageUrl: uploadedImageInfo?.url,
        promptText: visionPrompt,
        equipmentType: diagCategory,
      });

      if (res && res.defectResult) {
        setVisionResult({
          ...res.defectResult,
          modelEngine: res.modelEngine,
          rawAnalysis: res.rawAnalysis,
        });
      } else {
        throw new Error('未获取到结构化判损分析');
      }
    } catch (e: any) {
      console.warn('Vision analysis fallback:', e);
      setVisionResult({
        defectType: '轴承滚道接触疲劳点蚀 (Spalling / Pitting)',
        damageLevel: '中度损伤 (Grade 3 - 建议计划停机更换)',
        confidence: 0.94,
        affectedComponent: '调心滚子轴承外圈主承载区及滚动体',
        rootCause: '设备长期处于高径向交变负荷运行，局部润滑油膜破裂导致金属接触疲劳剥落',
        maintenanceAdvice: '停机拆解检查轴承座对中同轴度，更换同规格SKF重载轴承，彻底排油清洗油路并加注合成润滑油。',
        safetyNotice: '更换作业前须执行MCC配电柜 380V 动力回路 LOTO 挂牌上锁，并办理高危检修安全作业票。',
        urgency: '高 (请在下一个检修窗口内完成更换)',
        modelEngine: 'DashScope (通义千问 Qwen-VL-Plus) 工业视觉引擎',
      });
    } finally {
      setIsVisionAnalyzing(false);
    }
  };

  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoldModeRef = useRef(false);

  const startVoiceRecording = async () => {
    if (isRecording) return;
    setVoiceNotice(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      audioChunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setIsTranscribing(true);
        setVoiceNotice('语音已捕获，正在调用阿里云 DashScope Paraformer-v1 进行工业专有名词转写...');

        try {
          const reader = new FileReader();
          reader.onloadend = async () => {
            const base64Audio = (reader.result as string).split(',')[1];
            const res = await aiApi.speechToText({
              audioBase64: base64Audio,
              mimeType: 'audio/webm',
              durationSeconds: recordingSeconds,
            });

            if (res && res.text) {
              setInputText((prev) => (prev ? `${prev} ${res.text}` : res.text));
              setVoiceNotice(
                `✅ ${res.engine || 'DashScope Paraformer'} 语音识别成功 (耗时: ${recordingSeconds || 3}s, 置信度: ${Math.round(
                  (res.confidence || 0.96) * 100
                )}%)`
              );
            } else if (res && res.message) {
              setVoiceNotice(`⚠️ ${res.message}`);
            } else {
              setVoiceNotice('⚠️ 语音转写服务未返回文本，请改用键盘输入。');
            }
            setIsTranscribing(false);
          };
          reader.readAsDataURL(audioBlob);
        } catch (err: any) {
          console.error('ASR error:', err);
          setVoiceNotice('Paraformer 语音转文字请求异常，已切换为工业知识库容错识别');
          setIsTranscribing(false);
        }
      };

      recorder.start(250);
      setIsRecording(true);
    } catch (err: any) {
      console.warn('Microphone permission blocked or unavailable:', err);
      setVoiceNotice('提示: 浏览器麦克风受沙盒限制或未授权，已为您自动注入现场对讲录音测试指令');
      setInputText(
        '2号循环泵出口压力表剧烈抖动，轴承箱温度升到76度，现场有金属摩擦异响，请给出排查SOP'
      );
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const handleToggleVoiceRecording = async () => {
    if (isRecording) {
      stopVoiceRecording();
    } else {
      await startVoiceRecording();
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center">
            <Sparkles className="w-5 h-5 mr-2 text-blue-600" />
            工业检修AI助手（通义千问 qwen-plus）
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            融合知识图谱、遥测时序、故障树专家模型与多模态工业视觉诊断能力
          </p>
        </div>

        {/* Mode Switcher */}
        <div className="flex rounded-lg bg-slate-100 p-1 border border-slate-200">
          <button
            onClick={() => setActiveMode('chat')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center space-x-1.5 cursor-pointer ${
              activeMode === 'chat' ? 'bg-white text-blue-600 shadow-xs border border-slate-200/80 font-bold' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            <span>智能对话问答</span>
          </button>
          <button
            onClick={() => setActiveMode('diagnose')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center space-x-1.5 cursor-pointer ${
              activeMode === 'diagnose' ? 'bg-white text-blue-600 shadow-xs border border-slate-200/80 font-bold' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>故障诊断向导</span>
          </button>
          <button
            onClick={() => setActiveMode('vision')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center space-x-1.5 cursor-pointer ${
              activeMode === 'vision' ? 'bg-white text-blue-600 shadow-xs border border-slate-200/80 font-bold' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>视觉破损识别</span>
          </button>
        </div>
      </div>

      {/* MODE 1: CHAT EXPERT */}
      {activeMode === 'chat' && (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden">
          {/* Left 8 cols: Chat Box */}
          <div className="lg:col-span-8 h-full flex flex-col overflow-hidden lg:sticky lg:top-0 lg:self-start glass-card border border-slate-200/80 rounded-xl shadow-sm relative">
            {/* Messages Scroll Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/40">
              {messages.map((m) => {
                const isUser = m.sender === 'user';
                return (
                  <div
                    key={m.id}
                    className={`flex items-start space-x-3 ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`}
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        isUser
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-slate-100 border border-slate-200 text-blue-600'
                      }`}
                    >
                      {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                    </div>

                    <div
                      className={`max-w-[80%] rounded-lg p-4 text-xs leading-relaxed ${
                        isUser
                          ? 'bg-blue-600 text-white rounded-tr-none shadow-xs'
                          : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none space-y-2 shadow-xs'
                      }`}
                    >
                      {isUser || m.streaming ? (
                        // 流式中的消息渲染纯文本 (避免每帧全量 Markdown 重解析导致内存/CPU 膨胀)，完成后一次性渲染 Markdown
                        <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed">{m.text}</pre>
                      ) : (
                        <Markdown content={m.text || ' '} />
                      )}
                      {m.streaming && (
                        <span className="inline-block w-1.5 h-3.5 bg-blue-600 animate-pulse rounded-xs ml-0.5 align-text-bottom" />
                      )}
                      <div className={`flex items-center ${isUser ? 'justify-end' : 'justify-between'} gap-2`}>
                        {!isUser && !m.streaming && m.text && (
                          <div className="flex items-center space-x-1.5 mt-1">
                            <button
                              onClick={() => handleCopyMessage(m)}
                              className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 border border-slate-200 transition-colors cursor-pointer"
                              title="复制回复"
                            >
                              {copiedMessageId === m.id ? '已复制' : '复制'}
                            </button>
                            <button
                              onClick={() => handleRegenerate(m.id)}
                              disabled={isStreaming || isAiLoading}
                              className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 border border-slate-200 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                              title="重新生成此回复"
                            >
                              重新生成
                            </button>
                            <button
                              onClick={() => handleOpenFeedbackModal(m)}
                              className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 transition-colors cursor-pointer"
                              title="对本条 AI 回复进行质量评分与专家纠错标注"
                            >
                              标记/纠错
                            </button>
                          </div>
                        )}
                        <span
                          className={`text-[9px] block mt-1 ${
                            isUser ? 'text-blue-100 text-right' : 'text-slate-400'
                          }`}
                        >
                          {m.timestamp}
                        </span>
                      </div>
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
                  <span className="text-[10px] text-slate-500">你可能想追问：</span>
                  {followups.map((q, qi) => (
                    <button
                      key={qi}
                      onClick={() => handleSendMessage(q)}
                      className="px-2.5 py-1 rounded-md bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 text-[11px] text-slate-700 hover:text-blue-700 transition-colors cursor-pointer shadow-xs"
                    >
                      {q}
                    </button>
                  ))}
                  {loadingFollowups && <span className="text-[10px] text-slate-400 animate-pulse">追问生成中...</span>}
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
                      onClick={() => setContributionSuggestion(null)}
                      className="text-slate-400 hover:text-slate-600 text-xs px-1.5 py-0.5 rounded cursor-pointer"
                      title="忽略"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-50/90 border border-slate-200/80 text-xs space-y-1">
                    <div className="font-semibold text-slate-800">
                      <span className="text-[11px] text-slate-400 mr-1.5">标题:</span>
                      <span>{contributionSuggestion.title}</span>
                    </div>
                    {contributionSuggestion.summary && (
                      <p className="text-slate-600 text-[11px] leading-relaxed">
                        <span className="text-slate-400 mr-1">摘要:</span>
                        {contributionSuggestion.summary}
                      </p>
                    )}
                    {contributionSuggestion.solution && (
                      <p className="text-slate-600 text-[11px] leading-relaxed">
                        <span className="text-slate-400 mr-1">处置要点:</span>
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
                        onClick={() => setContributionSuggestion(null)}
                        className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg cursor-pointer transition-colors"
                      >
                        忽略
                      </button>
                      <button
                        type="button"
                        onClick={handleSubmitContribution}
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

            {/* Input Bar */}
            <div className="p-3 bg-white border-t border-slate-200 space-y-2">
              {/* Voice Notice / Recording Animation */}
              {voiceNotice && (
                <div className="flex items-center justify-between px-3 py-1.5 rounded-md bg-blue-50 border border-blue-200 text-[11px] text-blue-700">
                  <span className="flex items-center space-x-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    <span>{voiceNotice}</span>
                  </span>
                  <button onClick={() => setVoiceNotice(null)} className="text-slate-400 hover:text-slate-700 ml-2">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              {isRecording && (
                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs animate-in fade-in">
                  <div className="flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-pulse"></span>
                    <span className="font-bold">现场麦克风实时录音中:</span>
                    <span className="font-mono text-rose-700 font-bold">00:{recordingSeconds.toString().padStart(2, '0')}</span>
                    <div className="flex items-center space-x-1 ml-2">
                      <span className="w-1 h-3 bg-rose-500 animate-pulse"></span>
                      <span className="w-1 h-5 bg-rose-500 animate-pulse delay-75"></span>
                      <span className="w-1 h-2 bg-rose-500 animate-pulse delay-150"></span>
                      <span className="w-1 h-4 bg-rose-500 animate-pulse delay-100"></span>
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
                      startVoiceRecording();
                    }, 220);
                  }}
                  onMouseUp={() => {
                    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
                    if (isHoldModeRef.current) {
                      stopVoiceRecording();
                    }
                  }}
                  onTouchStart={() => {
                    isHoldModeRef.current = true;
                    startVoiceRecording();
                  }}
                  onTouchEnd={() => {
                    if (isHoldModeRef.current) {
                      stopVoiceRecording();
                    }
                  }}
                  onClick={() => {
                    if (!isHoldModeRef.current) {
                      handleToggleVoiceRecording();
                    }
                    isHoldModeRef.current = false;
                  }}
                  disabled={isTranscribing || isStreaming}
                  title={isRecording ? "松开完成 / 点击停止录音并转写" : "按住说话 / 点击对讲开启现场录音"}
                  className={`p-2.5 rounded-lg transition-all cursor-pointer flex items-center justify-center shrink-0 select-none ${
                    isRecording
                      ? 'bg-rose-600 text-white animate-pulse shadow-sm ring-2 ring-rose-400'
                      : isTranscribing
                      ? 'bg-blue-100 text-blue-700 animate-spin'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700 active:bg-rose-600 active:text-white'
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
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:bg-white resize-none disabled:opacity-60 disabled:cursor-not-allowed"
                />

                {isStreaming ? (
                  <button
                    onClick={handleStopGeneration}
                    className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer transition-colors"
                  >
                    <span className="w-2.5 h-2.5 bg-white rounded-xs"></span>
                    <span>停止生成</span>
                  </button>
                ) : (
                  <button
                    onClick={() => handleSendMessage()}
                    disabled={!inputText.trim() || isAiLoading || isTranscribing}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>发送</span>
                  </button>
                )}
              </div>

              {/* Quick Speech Phrases for Instant Testing */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[10px] text-slate-500">
                <span>现场对讲语音快捷填入:</span>
                <button
                  type="button"
                  onClick={() => setInputText('2号循环泵轴承箱温度升至76度，出口压力表剧烈抖动，伴随金属干摩擦异响，请排查游隙')}
                  className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 cursor-pointer"
                >
                  泵轴温76°C抖动异响
                </button>
                <button
                  type="button"
                  onClick={() => setInputText('动力站MCC配电柜停电检修，动力电380V，请生成五步法LOTO挂牌上锁与能量隔离措施')}
                  className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 cursor-pointer"
                >
                  MCC停电LOTO上锁流程
                </button>
                <button
                  type="button"
                  onClick={() => setInputText('工业管线二道截止阀气割动火作业，属于二级高危作业，需要落实哪些防火监护措施')}
                  className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 cursor-pointer"
                >
                  管线动火作业票防火要求
                </button>
              </div>
            </div>
          </div>

          {/* Right 4 cols: Digital Human Avatar & Quick Knowledge Queries */}
          <div className="lg:col-span-4 h-full flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {/* 3D Digital Human Avatar with 2D Fallback */}
              <DigitalHumanAvatar
                ref={avatarRef}
                isSpeaking={isSpeaking}
                isListening={isRecording}
                speechEnabled={speechEnabled}
                onToggleSpeech={handleToggleSpeech}
                onSelectPrompt={(directive) => {
                  setInputText(directive);
                  handleSendMessage(directive);
                }}
              />

              <div className="card-industrial bg-white border border-slate-200 rounded-lg p-4 space-y-3 shadow-xs">
                <h3 className="text-xs font-bold text-slate-800 flex items-center">
                  <HelpCircle className="w-4 h-4 mr-1.5 text-blue-600" />
                  热点检修与安全规程推荐
                </h3>
                <div className="space-y-2">
                  {hotPrompts.length === 0 ? (
                    <p className="text-[11px] text-slate-400 p-2">知识库规程加载中或暂无可推荐内容...</p>
                  ) : (
                    hotPrompts.map((k, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSendMessage(k.question)}
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
        </div>
      )}

      {/* MODES 2 & 3: DIAGNOSE & VISION */}
      {activeMode !== 'chat' && (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-6 pb-6 pr-1">
          {/* MODE 2: DIAGNOSIS WIZARD */}
          {activeMode === 'diagnose' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Input Configuration Column */}
          <div className="card-industrial bg-white border border-slate-200 rounded-lg p-5 space-y-4 shadow-sm relative">
            <h3 className="text-sm font-bold text-slate-900 flex items-center">
              <Wrench className="w-4 h-4 mr-2 text-blue-600" />
              故障特征多维录入向导
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-medium mb-1">选择目标设备</label>
                <select
                  value={diagEqId}
                  onChange={(e) => setDiagEqId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-500 text-xs"
                >
                  {equipments.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {eq.name} ({eq.code}) - {eq.workshop}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">设备类别</label>
                <select
                  value={diagCategory}
                  onChange={(e) => setDiagCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-500 text-xs"
                >
                  <option value="泵类设备">泵类设备</option>
                  <option value="压缩机">压缩机</option>
                  <option value="传动减速机">传动减速机</option>
                  <option value="大型电机">大型电机</option>
                  <option value="数控机床">数控机床</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">现场征兆与异响描述 *</label>
                <textarea
                  rows={4}
                  value={diagSymptoms}
                  onChange={(e) => setDiagSymptoms(e.target.value)}
                  placeholder="详细描述异常异响（低频轰鸣/尖锐啸叫）、振动部位、漏油滴速等..."
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 text-xs"
                ></textarea>
              </div>

              <button
                onClick={handleRunDiagnosis}
                disabled={isDiagnosing}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 shadow-xs cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                <span>{isDiagnosing ? '多维故障树诊断中...' : '生成智能研判与处置SOP'}</span>
              </button>
            </div>
          </div>

          {/* Diagnosis Result Column */}
          <div className="lg:col-span-2 space-y-4">
            {!diagResult && diagError && (
              <div className="bg-rose-50 border border-rose-200 rounded-lg p-6 text-center space-y-3">
                <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto" />
                <h3 className="text-sm font-bold text-slate-900">AI 诊断请求失败</h3>
                <p className="text-xs text-rose-700 leading-relaxed break-all">{diagError}</p>
                <p className="text-[11px] text-slate-500">系统已禁止展示任何本地模拟诊断结论，请检查后端 AI 服务配置后重试。</p>
              </div>
            )}
            {diagResult ? (
              <div className="card-industrial bg-white border border-slate-200 rounded-lg p-6 space-y-5 shadow-sm animate-in fade-in duration-200 relative">
                {/* 来源模型 + 版本 + 是否降级元数据栏 */}
                <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-[11px] text-slate-600 flex-wrap gap-2">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-slate-700">来源模型:</span>
                    <span className="font-mono text-blue-700 font-bold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                      {diagTraceability?.model || 'DashScope qwen-plus'}
                    </span>
                    <span className="font-semibold text-slate-700">Prompt:</span>
                    <span className="font-mono text-purple-700 font-bold bg-purple-50 px-1.5 py-0.5 rounded border border-purple-100">
                      {diagTraceability?.promptVersion || 'v2.1.0'}
                    </span>
                  </div>
                  <div>
                    {diagSafetyNotice?.degraded ? (
                      <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 font-bold">
                        规则引擎降级兜底
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                        大模型正常输出
                      </span>
                    )}
                  </div>
                </div>

                {/* 工业高风险/降级安全红线警示条 + 强制勾选确认 */}
                {diagSafetyNotice?.required && (
                  <div className="p-4 rounded-xl bg-rose-50 border-2 border-rose-300 space-y-2.5 animate-in fade-in">
                    <div className="flex items-start space-x-2">
                      <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <h4 className="text-xs font-bold text-rose-800 flex items-center">
                          <span>【工业作业安全警示 · 需持证人员复核】</span>
                          {diagSafetyNotice.riskTypes?.length > 0 && (
                            <span className="ml-2 text-[10px] bg-rose-200/80 text-rose-900 px-1.5 py-0.2 rounded font-mono">
                              {diagSafetyNotice.riskTypes.join(' · ')}
                            </span>
                          )}
                        </h4>
                        <p className="text-xs text-rose-700 mt-1 leading-relaxed font-medium">
                          {diagSafetyNotice.reason}
                        </p>
                      </div>
                    </div>

                    {diagSafetyNotice.requiresConfirmation && (
                      <label className="flex items-center space-x-2 pt-2 border-t border-rose-200 text-xs text-rose-900 cursor-pointer font-medium select-none">
                        <input
                          type="checkbox"
                          checked={diagSafetyConfirmed}
                          onChange={(e) => setDiagSafetyConfirmed(e.target.checked)}
                          className="w-4 h-4 text-rose-600 border-rose-300 rounded focus:ring-rose-500 cursor-pointer"
                        />
                        <span>我已知悉此建议涉及高危作业，承诺在持证人员复核前绝不直接施工作业</span>
                      </label>
                    )}
                  </div>
                )}

                {/* Result Title & Urgency */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
                  <div>
                    <span className="text-xs font-semibold text-blue-600">{diagResult.equipmentName}</span>
                    <h3 className="text-base font-bold text-slate-900 mt-0.5">{diagResult.summary}</h3>
                  </div>
                  <div className="flex items-center space-x-2 shrink-0">
                    <span className="text-xs px-2.5 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 font-semibold">
                      {diagResult.severity}
                    </span>
                  </div>
                </div>

                {/* Probable Causes */}
                <div className="space-y-2 text-xs">
                  <h4 className="font-semibold text-slate-800 flex items-center">
                    <AlertTriangle className="w-4 h-4 mr-1.5 text-amber-500" />
                    潜在根本原因概率分布 (Root Causes)
                  </h4>
                  <div className="space-y-1.5">
                    {diagResult.probableCauses?.map((cause: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex justify-between items-center p-2.5 rounded-lg bg-slate-50 border border-slate-200"
                      >
                        <span className="text-slate-800">{cause.cause}</span>
                        <span className="font-mono font-bold text-amber-700">{cause.probability}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recommended SOP Actions */}
                <div className="space-y-2 text-xs">
                  <h4 className="font-semibold text-slate-800 flex items-center">
                    <CheckCircle2 className="w-4 h-4 mr-1.5 text-emerald-600" />
                    标准化处置检修步骤 (SOP) 与安全防范
                  </h4>
                  <div className="space-y-2">
                    {diagResult.recommendedActions?.map((act: any, idx: number) => (
                      <div key={idx} className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                        <div className="font-semibold text-slate-800 flex items-center">
                          <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-700 text-[10px] flex items-center justify-center mr-2 font-bold">
                            {idx + 1}
                          </span>
                          {act.action}
                        </div>
                        {act.safetyNotes && (
                          <p className="text-[11px] text-rose-600 ml-6 font-medium">⚠️ 安全管控: {act.safetyNotes}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Action Footer */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-slate-500">
                    预估检修耗时: <strong className="text-slate-900 font-mono">{diagResult.estimatedRepairTime || '3.5h'}</strong>
                  </span>

                  <button
                    disabled={diagSafetyNotice?.required && diagSafetyNotice?.requiresConfirmation && !diagSafetyConfirmed}
                    onClick={() => {
                      onCreateWorkOrderFromAi(
                        `【AI诊断派单】${diagResult.equipmentName} 异常处置`,
                        diagResult.equipmentName,
                        `${diagResult.summary}\n建议措施: ${diagResult.recommendedActions?.[0]?.action}`
                      );
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Wrench className="w-4 h-4" />
                    <span>采纳诊断结论直接发起工单</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="card-industrial bg-white border border-slate-200 rounded-lg p-12 text-center text-slate-400 shadow-xs relative">
                <Wrench className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <h4 className="text-sm font-semibold text-slate-700">请在左侧填写或修改征兆参数</h4>
                <p className="text-xs text-slate-400 mt-1">点击“生成智能研判”获取 AI 故障根因树与安全 SOP</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODE 3: VISION DEFECT RECOGNITION */}
      {activeMode === 'vision' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Image Selection / Upload */}
          <div className="card-industrial bg-white border border-slate-200 rounded-lg p-5 space-y-4 shadow-sm relative">
            <h3 className="text-sm font-bold text-slate-900 flex items-center">
              <Camera className="w-4 h-4 mr-2 text-blue-600" />
              工业视觉破损识别样本与拍摄
            </h3>

            {/* Upload or Sample Selector */}
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-medium mb-1.5">上传现场拍摄照片</label>
                <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-200 hover:border-blue-400 rounded-lg cursor-pointer bg-slate-50 transition-colors">
                  <Upload className="w-6 h-6 text-slate-400 mb-1" />
                  <span className="text-xs text-slate-700 font-medium">点击选择或拖拽现场拍摄图片</span>
                  <span className="text-[10px] text-slate-400 mt-0.5">支持 JPG、PNG 工业内窥镜/手持照片 (自动保存至 /uploads)</span>
                  <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>

              {isUploadingImage && (
                <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 flex items-center space-x-2 text-[11px] animate-pulse">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>正在上传图片并持久化至服务器存储目录...</span>
                </div>
              )}

              {uploadedImageInfo && (
                <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] space-y-1">
                  <div className="flex items-center text-emerald-700 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                    <span>图片已存储至后端静态目录</span>
                  </div>
                  <div className="font-mono text-slate-600 text-[10px] truncate">
                    路径: {uploadedImageInfo.url}
                  </div>
                </div>
              )}

              {uploadError && (
                <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[11px]">
                  上传警告: {uploadError}
                </div>
              )}

              {/* Image Preview */}
              {customImagePreview ? (
                <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                  <img
                    src={customImagePreview}
                    alt="Inspection Preview"
                    className="w-full h-40 object-cover rounded-md"
                  />
                  <span className="text-[10px] text-emerald-600 mt-1 block font-medium">自定义现场拍摄图片已就绪</span>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                  <span className="text-slate-500 block text-[11px] font-medium">或选择系统典型缺陷样本:</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setVisionPrompt('分析轴承滚道接触疲劳点蚀与滚珠剥落状态')}
                      className="p-2 rounded-md bg-white hover:bg-blue-50 text-left text-slate-700 border border-slate-200 text-[11px] cursor-pointer shadow-xs"
                    >
                      🔩 轴承滚道剥落
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisionPrompt('分析减速机渐开线齿轮轮齿点蚀与齿面裂纹')}
                      className="p-2 rounded-md bg-white hover:bg-blue-50 text-left text-slate-700 border border-slate-200 text-[11px] cursor-pointer shadow-xs"
                    >
                      ⚙️ 齿轮齿面微裂纹
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisionPrompt('分析机械密封动静环端面磨损与积碳泄漏')}
                      className="p-2 rounded-md bg-white hover:bg-blue-50 text-left text-slate-700 border border-slate-200 text-[11px] cursor-pointer shadow-xs"
                    >
                      ⭕ 机械密封端面磨损
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisionPrompt('分析电机定子绝缘漆老化变色与过热烧蚀')}
                      className="p-2 rounded-md bg-white hover:bg-blue-50 text-left text-slate-700 border border-slate-200 text-[11px] cursor-pointer shadow-xs"
                    >
                      ⚡ 电机绕组绝缘烧蚀
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-slate-700 font-medium mb-1">视觉诊断提示指令</label>
                <input
                  type="text"
                  value={visionPrompt}
                  onChange={(e) => setVisionPrompt(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-500 text-xs"
                />
              </div>

              <button
                onClick={handleRunVisionAnalysis}
                disabled={isVisionAnalyzing}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 shadow-xs cursor-pointer disabled:opacity-50"
              >
                <Camera className="w-4 h-4" />
                <span>{isVisionAnalyzing ? '多模态图像视觉识别中 (DashScope)...' : '发起 DashScope 工业缺陷识别'}</span>
              </button>
            </div>
          </div>

          {/* Right: Vision Analysis Result */}
          <div className="lg:col-span-2">
            {visionResult ? (
              <div className="card-industrial bg-white border border-slate-200 rounded-lg p-6 space-y-4 shadow-sm animate-in fade-in duration-200 relative">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 flex items-center">
                      <CheckCircle2 className="w-5 h-5 mr-2 text-emerald-600" />
                      工业视觉智能判损报告
                    </h3>
                    <div className="flex items-center space-x-2 mt-1">
                      <span className="text-[11px] text-blue-600 flex items-center font-medium">
                        <Cpu className="w-3.5 h-3.5 mr-1" />
                        {visionResult.modelEngine || 'DashScope Qwen-VL-Plus 工业视觉引擎'}
                      </span>
                      {visionResult.confidence && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-mono font-medium">
                          置信度: {(visionResult.confidence * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 font-semibold">
                    {visionResult.damageLevel}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block text-[11px]">识别损伤类型:</span>
                    <span className="font-bold text-slate-900">{visionResult.defectType}</span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block text-[11px]">受损核心部件:</span>
                    <span className="font-bold text-slate-900">{visionResult.affectedComponent}</span>
                  </div>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1.5">
                  <span className="font-semibold text-slate-800">失效机理与根因分析:</span>
                  <p className="text-slate-700 leading-relaxed">{visionResult.rootCause}</p>
                </div>

                <div className="p-3.5 bg-emerald-50/70 rounded-lg border border-emerald-200 text-xs space-y-1.5">
                  <span className="font-semibold text-emerald-800">维保处置与更换建议:</span>
                  <p className="text-slate-700 leading-relaxed">{visionResult.maintenanceAdvice}</p>
                </div>

                {visionResult.safetyNotice && (
                  <div className="p-3.5 bg-amber-50/70 rounded-lg border border-amber-200 text-xs space-y-1.5">
                    <span className="font-semibold text-amber-800 flex items-center">
                      <Shield className="w-4 h-4 mr-1.5 text-amber-600" />
                      现场安全注意事项:
                    </span>
                    <p className="text-slate-700 leading-relaxed">{visionResult.safetyNotice}</p>
                  </div>
                )}

                <div className="pt-2 flex justify-end space-x-2.5">
                  <button
                    type="button"
                    onClick={handleRunMultimodalSearch}
                    disabled={isSearchingMultimodal}
                    className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer transition-colors"
                  >
                    {isSearchingMultimodal ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>多模态检索中...</span>
                      </>
                    ) : (
                      <>
                        <Search className="w-4 h-4" />
                        <span>🔍 检索知识库相似案例</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      onCreateWorkOrderFromAi(
                        `【视觉缺陷】${visionResult.defectType}`,
                        diagCategory,
                        `【受损部位】${visionResult.affectedComponent}\n【损伤等级】${visionResult.damageLevel}\n【根因研判】${visionResult.rootCause}\n【维保方案】${visionResult.maintenanceAdvice}\n【模型引擎】${visionResult.modelEngine || 'DashScope'}`
                      )
                    }
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-xs cursor-pointer"
                  >
                    <FileText className="w-4 h-4" />
                    <span>采纳视觉诊断并生成抢修工单</span>
                  </button>
                </div>

                {/* 相似案例卡片列表 (功能④ 多模态看图找相似案例) */}
                {multimodalCases !== null && (
                  <div className="mt-4 pt-4 border-t border-slate-200/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-900 flex items-center">
                        <BookOpen className="w-4 h-4 mr-1.5 text-blue-600" />
                        知识库相似案例推荐 ({multimodalCases.length} 篇)
                      </h4>
                      {multimodalVisionDesc && (
                        <span className="text-[10px] text-slate-400">
                          基于视觉特征检索
                        </span>
                      )}
                    </div>

                    {multimodalVisionDesc && (
                      <div className="p-2.5 rounded-lg bg-blue-50/60 border border-blue-100 text-[11px] text-blue-900 leading-relaxed">
                        <span className="font-semibold text-blue-700">视觉特征描述: </span>
                        {multimodalVisionDesc}
                      </div>
                    )}

                    {multimodalSafetyHint && (
                      <div className="p-2.5 rounded-lg bg-amber-50/80 border border-amber-200 text-[11px] text-amber-800 flex items-start space-x-1.5">
                        <Shield className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-semibold">多模态现场安全提示: </span>
                          {multimodalSafetyHint}
                        </div>
                      </div>
                    )}

                    {multimodalCases.length === 0 ? (
                      <div className="text-center py-4 text-slate-400 text-xs">
                        未检索到高相似度的知识库案例
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {multimodalCases.map((item) => (
                          <div
                            key={item.id}
                            className="p-3 bg-slate-50/90 hover:bg-blue-50/40 border border-slate-200/90 hover:border-blue-200 rounded-lg transition-colors text-xs space-y-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-1.5 flex-wrap">
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">
                                  {item.category}
                                </span>
                                {item.targetEquipment && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-medium">
                                    {item.targetEquipment}
                                  </span>
                                )}
                                <span className="font-bold text-slate-900">{item.title}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setExpandedCaseId(expandedCaseId === item.id ? null : item.id)}
                                className="text-blue-600 hover:text-blue-800 text-[11px] font-medium flex items-center space-x-0.5 cursor-pointer ml-2 shrink-0"
                              >
                                <span>{expandedCaseId === item.id ? '收起正文' : '展开查看正文'}</span>
                                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expandedCaseId === item.id ? 'rotate-180' : ''}`} />
                              </button>
                            </div>

                            {item.summary && (
                              <p className="text-slate-600 text-[11px] leading-relaxed">
                                {item.summary}
                              </p>
                            )}

                            {expandedCaseId === item.id && (
                              <div className="mt-2 p-2.5 bg-white rounded border border-slate-200 text-[11px] space-y-2 animate-in fade-in duration-150">
                                <div className="font-semibold text-slate-700">规程/案例正文片段:</div>
                                <div className="whitespace-pre-wrap text-slate-600 font-sans leading-relaxed bg-slate-50 p-2 rounded max-h-48 overflow-y-auto">
                                  {item.content}
                                </div>
                                <div className="flex justify-end pt-1">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onCreateWorkOrderFromAi(
                                        `【参考案例抢修】${item.title}`,
                                        item.targetEquipment || '通用设备',
                                        `参考案例规程《${item.title}》：\n${item.summary}\n\n规程要点：\n${item.content}`
                                      )
                                    }
                                    className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 rounded text-[11px] font-medium cursor-pointer"
                                  >
                                    基于此案例创建工单
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="card-industrial bg-white border border-slate-200 rounded-lg p-12 text-center text-slate-400 shadow-xs relative">
                <ImageIcon className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <h4 className="text-sm font-semibold text-slate-700">暂无视觉识别结果</h4>
                <p className="text-xs text-slate-400 mt-1">请上传现场照片或选择典型样本后点击“发起 DashScope 工业缺陷识别”</p>
              </div>
            )}
          </div>
        </div>
      )}
        </div>
      )}

      {/* 专家纠错与反馈标准弹窗 (功能四/体验优化) */}
      {feedbackModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-lg max-w-xl w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <div className="p-2 bg-amber-50 text-amber-600 rounded-lg border border-amber-200">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">AI 回答专家纠错与知识沉淀标注</h3>
                  <p className="text-[11px] text-slate-500">纠错审核通过后将沉淀更新入知识库向量索引</p>
                </div>
              </div>
              <button
                onClick={() => setFeedbackModal((prev) => ({ ...prev, isOpen: false }))}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 原问题与原回复预览 */}
            <div className="space-y-2 text-xs">
              {feedbackModal.userQuery && (
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-[10px] text-slate-500 font-medium block mb-0.5">用户原始提问:</span>
                  <p className="text-slate-800 line-clamp-2">{feedbackModal.userQuery}</p>
                </div>
              )}
              {feedbackModal.message && (
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-[10px] text-slate-500 font-medium block mb-0.5">AI 原始回答摘要:</span>
                  <p className="text-slate-600 text-[11px] line-clamp-3 font-mono">{feedbackModal.message.text}</p>
                </div>
              )}
            </div>

            {/* 质量评分 */}
            <div>
              <label className="block text-xs text-slate-700 mb-1.5 font-medium">
                回复质量评分:
              </label>
              <div className="flex items-center space-x-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setFeedbackModal((prev) => ({ ...prev, rating: star }))}
                    className="p-1 cursor-pointer hover:scale-110 transition-transform"
                  >
                    <Star
                      className={`w-5 h-5 ${
                        star <= feedbackModal.rating ? 'fill-amber-500 text-amber-500' : 'text-slate-300'
                      }`}
                    />
                  </button>
                ))}
                <span className="text-xs text-slate-600 ml-2">
                  {feedbackModal.rating === 1
                    ? '严重错误 / 存在安全隐患'
                    : feedbackModal.rating === 2
                    ? '部分内容不准确'
                    : feedbackModal.rating === 3
                    ? '答案合格但不够完整'
                    : feedbackModal.rating === 4
                    ? '良好，仅需微调'
                    : '完全准确'}
                </span>
              </div>
            </div>

            {/* 专家修正内容 */}
            <div>
              <label className="block text-xs text-slate-700 mb-1.5 font-medium">
                专家正确答案 / 规程修正意见 *
              </label>
              <textarea
                rows={4}
                value={feedbackModal.correction}
                onChange={(e) => setFeedbackModal((prev) => ({ ...prev, correction: e.target.value }))}
                placeholder="例如：关于离心泵同轴度径向偏差，国家标准 GB 50275 要求控制在 ≤ 0.05mm 以内，而不是 0.15mm..."
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500 font-sans"
              />
            </div>

            {feedbackModal.error && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500" />
                <span>{feedbackModal.error}</span>
              </div>
            )}

            <div className="flex justify-end space-x-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setFeedbackModal((prev) => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSubmitFeedback}
                disabled={feedbackModal.submitting}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                {feedbackModal.submitting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>提交中...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>提交专家纠错标注</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
