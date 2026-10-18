import { useState, useEffect, useRef } from 'react';
import { procedureApi } from '../../api';
import { MaintenanceProcedure, VideoScript } from '../../types';

interface UseProcedureScriptOptions {
  activeProcedure?: MaintenanceProcedure | null;
  showToast: (toast: { type: 'success' | 'error' | 'warning' | 'info'; title: string; message?: string }) => void;
}

export function useProcedureScript({ activeProcedure, showToast }: UseProcedureScriptOptions) {
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [videoScript, setVideoScript] = useState<VideoScript | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [generatingScript, setGeneratingScript] = useState(false);
  const [scriptNotice, setScriptNotice] = useState<string | null>(null);

  const synthRef = useRef<SpeechSynthesis | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis;
    }
  }, []);

  // 语音合成播放逻辑
  const speakCurrentStep = (index: number) => {
    if (!synthRef.current || !videoScript) return;
    synthRef.current.cancel();

    if (isMuted) return;

    const text = videoScript.voiceover?.[index] || activeProcedure?.steps?.[index]?.content || '';
    if (!text) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onend = () => {
      // 当前步骤解说完毕，自动进入下一步
      if (isPlaying && index + 1 < (activeProcedure?.steps?.length || 0)) {
        setCurrentStepIndex(index + 1);
      } else if (index + 1 >= (activeProcedure?.steps?.length || 0)) {
        setIsPlaying(false);
      }
    };

    utteranceRef.current = utterance;
    synthRef.current.speak(utterance);
  };

  useEffect(() => {
    if (showVideoModal && isPlaying) {
      speakCurrentStep(currentStepIndex);
    } else if (synthRef.current) {
      synthRef.current.cancel();
    }
  }, [currentStepIndex, isPlaying, showVideoModal]);

  const handleOpenVideo = async () => {
    if (!activeProcedure) return;

    if (activeProcedure.script && activeProcedure.script.voiceover && activeProcedure.script.voiceover.length > 0) {
      setVideoScript(activeProcedure.script);
      setCurrentStepIndex(0);
      setShowVideoModal(true);
      return;
    }

    setGeneratingScript(true);
    setScriptNotice('AI 正在基于标准化作业步骤生成分镜脚本与解说词...');
    try {
      const res = await procedureApi.generateVideoScript(activeProcedure.id);
      if (res.script) {
        setVideoScript(res.script);
        setCurrentStepIndex(0);
        setShowVideoModal(true);
      }
    } catch (err: unknown) {
      showToast({ type: 'error', title: '分镜生成失败', message: (err as Error)?.message || '生成分镜脚本失败' });
    } finally {
      setGeneratingScript(false);
      setScriptNotice(null);
    }
  };

  const handlePlayPause = () => {
    if (isPlaying) {
      setIsPlaying(false);
      synthRef.current?.cancel();
    } else {
      setIsPlaying(true);
      speakCurrentStep(currentStepIndex);
    }
  };

  const handleNextStep = () => {
    if (!activeProcedure) return;
    if (currentStepIndex + 1 < activeProcedure.steps.length) {
      setCurrentStepIndex(currentStepIndex + 1);
    }
  };

  const handlePrevStep = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
    }
  };

  const handleReplay = () => {
    setCurrentStepIndex(0);
    setIsPlaying(true);
    speakCurrentStep(0);
  };

  const handleCloseVideo = () => {
    setShowVideoModal(false);
    setIsPlaying(false);
    synthRef.current?.cancel();
  };

  return {
    showVideoModal,
    videoScript,
    currentStepIndex,
    setCurrentStepIndex,
    isPlaying,
    isMuted,
    setIsMuted,
    isFullscreen,
    setIsFullscreen,
    generatingScript,
    scriptNotice,
    handleOpenVideo,
    handlePlayPause,
    handleNextStep,
    handlePrevStep,
    handleReplay,
    handleCloseVideo,
  };
}
