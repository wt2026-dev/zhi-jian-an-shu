import React, { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { Sparkles, ArrowRight, ArrowLeft } from 'lucide-react';
import { useAiChatContext } from '../context/AiChatContext';

const STORAGE_KEY = 'onboarded_v2';

interface GuideStep {
  key: string;
  selector: string;
  title: string;
  text: string;
  placement: 'top' | 'bottom';
}

/** 三步引导：悬浮 AI 助手 → 检修工单 → 知识库RAG */
const STEPS: GuideStep[] = [
  {
    key: 'ai-ball',
    selector: '[data-onboarding="ai-ball"]',
    title: '第 1 步 / 共 3 步',
    text: '点这里随时找 AI 助手',
    placement: 'top',
  },
  {
    key: 'work_orders',
    selector: '#nav-tab-work_orders',
    title: '第 2 步 / 共 3 步',
    text: '从这里发起检修作业',
    placement: 'bottom',
  },
  {
    key: 'knowledge',
    selector: '#nav-tab-knowledge',
    title: '第 3 步 / 共 3 步',
    text: '检索检修手册与案例',
    placement: 'bottom',
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * 新用户首次引导：登录后首次进入显示（localStorage onboarded_v2 判断）
 * 高亮采用"遮罩 + 目标元素描边"实现，引导结束或跳过后立即移除遮罩。
 */
export const OnboardingGuide: React.FC = () => {
  const chat = useAiChatContext();
  const [showWelcome, setShowWelcome] = useState(false);
  const [stepIndex, setStepIndex] = useState<number>(-1);
  const [rect, setRect] = useState<Rect | null>(null);
  const [missing, setMissing] = useState(false);

  // 首次进入判断
  useEffect(() => {
    let done = false;
    try {
      const searchDone = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('onboarded') === '1';
      done = searchDone || localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      done = false;
    }
    if (!done) setShowWelcome(true);
  }, []);

  const finish = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {}
    setShowWelcome(false);
    setStepIndex(-1);
    setRect(null);
  }, []);

  // 测量当前步骤目标元素位置
  const measure = useCallback((index: number) => {
    const step = STEPS[index];
    if (!step) return;
    const el = document.querySelector(step.selector) as HTMLElement | null;
    if (!el) {
      setMissing(true);
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setMissing(false);
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    // 目标滚动到可视区域
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // 滚动后重新测量一次
    setTimeout(() => {
      const el2 = document.querySelector(step.selector) as HTMLElement | null;
      if (el2) {
        const r2 = el2.getBoundingClientRect();
        setRect({ top: r2.top, left: r2.left, width: r2.width, height: r2.height });
      }
    }, 320);
  }, []);

  useLayoutEffect(() => {
    if (stepIndex >= 0) measure(stepIndex);
  }, [stepIndex, measure]);

  // 窗口尺寸变化时重新测量
  useEffect(() => {
    if (stepIndex < 0) return;
    const onResize = () => measure(stepIndex);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [stepIndex, measure]);

  const startGuide = () => {
    // 悬浮球在面板展开时隐藏，引导第 1 步前先收起面板
    chat.closePanel();
    setShowWelcome(false);
    setStepIndex(0);
  };

  const next = () => {
    if (stepIndex < STEPS.length - 1) setStepIndex(stepIndex + 1);
    else finish();
  };

  const prev = () => {
    if (stepIndex > 0) setStepIndex(stepIndex - 1);
    else {
      // 回到欢迎页
      setStepIndex(-1);
      setShowWelcome(true);
    }
  };

  const step = stepIndex >= 0 ? STEPS[stepIndex] : null;
  const isLast = stepIndex === STEPS.length - 1;

  // 气泡定位
  const bubbleStyle: React.CSSProperties = (() => {
    if (!rect || !step) return { display: 'none' };
    const width = 260;
    const left = Math.min(
      Math.max(12, rect.left + rect.width / 2 - width / 2),
      Math.max(12, window.innerWidth - width - 12)
    );
    const top = step.placement === 'top' ? rect.top - 108 : rect.top + rect.height + 14;
    return { position: 'fixed', top: Math.max(12, top), left, width, zIndex: 10001 };
  })();

  if (!showWelcome && stepIndex < 0) return null;

  return (
    <>
      {/* ---------- 首次进入欢迎弹窗 ---------- */}
      {showWelcome && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs"
          onClick={finish}
        >
          <div
            className="w-full max-w-md card-industrial bg-white border border-slate-200 rounded-lg p-6 shadow-xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-blue-600 border border-blue-500 text-white flex items-center justify-center shadow-xs">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">欢迎使用工业设备智能检修系统</h3>
                <p className="text-[11px] text-slate-500">中国软件杯 A1 赛题 · 多模态工业诊断与知识协同平台</p>
              </div>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              本系统覆盖设备台账、健康监测、检修工单、巡检作业、安全作业票与知识库 RAG
              全流程，并内置 AI 数字人助手可随时为您做故障诊断与规程检索。
            </p>
            <div className="mt-5 flex items-center justify-between">
              <button
                onClick={finish}
                className="px-4 py-2 text-xs text-slate-500 hover:text-slate-800 cursor-pointer font-medium"
              >
                跳过
              </button>
              <button
                onClick={startGuide}
                className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                开始引导
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- 分步引导：遮罩 + 高亮描边 ---------- */}
      {step && rect && (
        <>
          {/* 高亮框：利用超大 box-shadow 形成全屏遮罩，框内保持原样 */}
          <div
            className="fixed pointer-events-none"
            style={{
              top: rect.top - 4,
              left: rect.left - 4,
              width: rect.width + 8,
              height: rect.height + 8,
              border: '2px solid #3b82f6',
              borderRadius: 8,
              boxShadow: '0 0 0 9999px rgba(15,23,42,0.35)',
              zIndex: 10000,
              transition: 'all 0.25s ease',
            }}
          />

          {/* 气泡 */}
          <div className="card-industrial bg-white border border-slate-200 rounded-lg p-3.5 shadow-xl text-slate-800" style={bubbleStyle}>
            <div className="text-[10px] text-blue-600 font-bold mb-1">{step.title}</div>
            <p className="text-xs text-slate-700 leading-relaxed">{step.text}</p>
            <div className="mt-3 flex items-center justify-between">
              <button
                onClick={finish}
                className="text-[11px] text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                跳过
              </button>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={prev}
                  className="px-2.5 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] flex items-center gap-1 cursor-pointer font-medium"
                >
                  <ArrowLeft className="w-3 h-3" />
                  上一步
                </button>
                <button
                  onClick={next}
                  className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer shadow-xs"
                >
                  {isLast ? '开始使用' : '下一步'}
                  {!isLast && <ArrowRight className="w-3 h-3" />}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* 目标元素不存在时给出提示，避免引导卡死 */}
      {step && missing && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10001] bg-white border border-amber-200 rounded-lg px-4 py-3 shadow-xl"
        >
          <p className="text-xs text-amber-800 mb-2">未定位到引导目标，可能当前页面未展示该入口。</p>
          <div className="flex items-center justify-end gap-2">
            <button onClick={finish} className="text-[11px] text-slate-500 hover:text-slate-800 cursor-pointer">
              跳过引导
            </button>
            <button
              onClick={next}
              className="px-3 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] cursor-pointer font-medium"
            >
              {isLast ? '开始使用' : '下一步'}
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default OnboardingGuide;
