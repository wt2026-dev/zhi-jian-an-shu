import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Sparkles, Volume2, VolumeX, Activity, Check, Loader2, Cuboid, RotateCcw, Monitor, AlertTriangle, FileText, Settings2, Radio } from 'lucide-react';
import { DigitalHumanPersona } from '../types';
import { DigitalHumanVRM, type DigitalHumanVRMHandle } from './digital-human/DigitalHumanVRM';

/**
 * 金色 / 天青动态声波仪（Dynamic Audio Waveform HUD）
 * 纯 CSS 驱动：波形柱由 .wave-bar-1..5 提供「香槟金 → 晨曦金 → 天青」渐变与弹性律动，
 * 静默时回落为低矮灰柱，保证"说话 / 拾音 / 待命"三态一目了然。
 */
const WaveformHUD = ({
  active,
  bars = 18,
  className = '',
  barWidth = 3,
}: {
  active: boolean;
  bars?: number;
  className?: string;
  barWidth?: number;
}) => (
  <div
    className={`flex items-end justify-center gap-[3px] ${className}`}
    data-testid="waveform-hud"
    data-active={active ? '1' : '0'}
    data-bars={bars}
    aria-hidden="true"
  >
    {Array.from({ length: bars }).map((_, i) => (
      <span
        key={i}
        className={`rounded-full transition-all ${active ? `wave-bar-${(i % 5) + 1}` : ''}`}
        style={
          active
            ? { width: `${barWidth}px` }
            : { width: `${barWidth}px`, height: `${4 + ((i * 7) % 10)}px`, backgroundColor: '#CBD5E1' }
        }
      />
    ))}
  </div>
);

/** 现场检修快捷问答指令（游戏化金色胶囊芯片） */
const QUICK_DIRECTIVES: { text: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { text: '今日待办工单与紧急告警', Icon: AlertTriangle },
  { text: '设备健康度最差的3台设备及诊断', Icon: Activity },
  { text: '生成本周设备巡检总结报告', Icon: FileText },
  { text: '螺杆空压机二级保养核心步骤', Icon: Settings2 },
];

// 魔珐星云 3D 数字人配置（所有密钥仅在服务端 process.env 中流转，前端零凭证暴露）
const XINGYUN_CDN = 'https://media.xingyun3d.com/xingyun3d/general/litesdk/xmovAvatar@latest.js';
const XINGYUN_PROXY_SESSION_API = '/api/v1/xingyun/session';


export const DIGITAL_PERSONAS: DigitalHumanPersona[] = [
  {
    id: 'zhang',
    name: '张工',
    roleTitle: '机械首席总工程师',
    description: '30年离心机组与重载设备诊断经验，熟悉GB 30871高危规范',
    gender: 'male',
    themeColor: '#0ea5e9', // Sky Blue
    avatarSvgType: 'zhang',
  },
  {
    id: 'li',
    name: '李工',
    roleTitle: '电气自动化工程师',
    description: '精通PLC逻辑、变频调速与电气防爆LOTO隔离',
    gender: 'female',
    themeColor: '#10b981', // Emerald Green
    avatarSvgType: 'li',
  },
  {
    id: 'zhi',
    name: '小智',
    roleTitle: 'AI智能巡检专家',
    description: '连接工厂遥测中枢与千问大模型，秒级响应故障研判',
    gender: 'male',
    themeColor: '#06b6d4', // Cyan
    avatarSvgType: 'zhi',
  },
];

interface DigitalHumanAvatarProps {
  isSpeaking: boolean;
  isListening?: boolean;
  speechEnabled: boolean;
  onToggleSpeech: () => void;
  onSelectPrompt?: (text: string) => void;
  className?: string;
}

export interface DigitalHumanAvatarHandle {
  /** 让 3D 数字人开口说话（AI 回答文本驱动） */
  speak: (text: string) => Promise<boolean | void>;
  /** 打断或停止数字人当前语音输出 */
  stop?: () => void;
  /** 当前是否正处于 3D 渲染活跃态 */
  is3D?: () => boolean;
}

export const getSanitizedFallbackReason = (reason: any): string => {
  if (!reason) return '平台会话异常（可能是积分不足或网络问题）';
  if (typeof reason === 'object') {
    const str = reason.error_reason || reason.reason || reason.message || reason.msg || '';
    if (!str || str === '{}' || str === '[object Object]') {
      return '平台会话异常（可能是积分不足或网络问题）';
    }
    return String(str);
  }
  const str = String(reason).trim();
  if (!str || str === '{}' || str === '[object Object]' || str === 'undefined' || str === 'null') {
    return '平台会话异常（可能是积分不足或网络问题）';
  }
  return str;
};

export const DigitalHumanAvatar = forwardRef<DigitalHumanAvatarHandle, DigitalHumanAvatarProps>((
  {
    isSpeaking,
    isListening = false,
    speechEnabled,
    onToggleSpeech,
    onSelectPrompt,
    className = '',
  },
  ref,
) => {
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>(() => {
    try {
      return localStorage.getItem('industrial_digital_human_persona') || 'zhang';
    } catch {
      return 'zhang';
    }
  });

  // 魔珐星云 3D 数字人状态：idle=未启用 loading=加载中 ready=就绪 error=失败(降级2D)
  const [sdkStatus, setSdkStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [loadProgress, setLoadProgress] = useState<number>(0);
  const [sdkSpeaking, setSdkSpeaking] = useState<boolean>(false);
  const [sdkListening, setSdkListening] = useState<boolean>(false);
  const [force2D, setForce2D] = useState<boolean>(false);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);

  const updateFallbackReason = (reason: any) => {
    setFallbackReason(getSanitizedFallbackReason(reason));
  };

  const sdkRef = useRef<any>(null);
  const sdkStatusRef = useRef<'idle' | 'loading' | 'ready' | 'error'>('idle');
  sdkStatusRef.current = sdkStatus;

  const human3dRef = useRef<DigitalHumanVRMHandle>(null);

  // 1. 魔珐星云 Lite SDK 生命周期管理与加载超时保护（10秒超时自动降级）
  useEffect(() => {
    if (force2D) return;

    let cancelled = false;
    setSdkStatus('loading');
    setLoadProgress(10);

    // 10秒超时守卫：网络阻滞或渲染超时时自动降级
    const timeoutTimer = setTimeout(() => {
      if (sdkStatusRef.current === 'loading') {
        console.warn('[XingYun 3D] 资源加载/初始化超过 10 秒，触发保底机制自动降级为 2D 仿真数字人');
        if (!cancelled) {
          updateFallbackReason('网络加载超时');
          setSdkStatus('error');
        }
      }
    }, 10000);

    const initSdk = async () => {
      if (cancelled) return;
      try {
        const Ctor: any = (window as any).XmovAvatar;
        if (!Ctor) {
          console.warn('[XingYun 3D] XmovAvatar 未在全局对象挂载，自动降级为 2D');
          if (!cancelled) {
            updateFallbackReason('SDK 模块未就绪');
            setSdkStatus('error');
          }
          return;
        }

        // 1. 安全代理初始化：先向后端代理获取会话与临时凭证，前端绝不暴露 App Secret
        let proxySessionData: any = null;
        try {
          const resp = await fetch(XINGYUN_PROXY_SESSION_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tag: 'default',
              gateway_type: 'default',
            }),
          });
          const json = await resp.json();
          if (!json.success || (json.error_code && json.error_code !== 0)) {
            const rawReason = json.error_reason || json.message || '魔珐星云会话建立失败';
            console.warn('[XingYun 3D] 服务端代理返回错误:', json);
            if (!cancelled) {
              updateFallbackReason(rawReason);
              setSdkStatus('error');
            }
            return;
          }
          proxySessionData = json.data;
        } catch (netErr: any) {
          console.warn('[XingYun 3D] 请求服务端数字人代理网络失败:', netErr);
          if (!cancelled) {
            updateFallbackReason('数字人代理网关连接超时');
            setSdkStatus('error');
          }
          return;
        }

        if (cancelled) return;

        // 2. 使用代理返回的会话数据初始化 SDK
        const sdk = new Ctor({
          containerId: '#xingyun-avatar',
          gatewayServer: proxySessionData?.gatewayServer || window.location.origin + XINGYUN_PROXY_SESSION_API,
          sessionRequestData: proxySessionData,
          onStatusChange: (status: any) => {
            console.log('[XingYun 3D] onStatusChange:', status);
            try {
              const arr = JSON.parse(localStorage.getItem('xy_status') || '[]');
              arr.push(String(status));
              localStorage.setItem('xy_status', JSON.stringify(arr.slice(-20)));
            } catch {}
          },
          onStateChange: (state: any) => {
            console.log('[XingYun 3D] onStateChange:', state);
            const s = String(state).toLowerCase();
            const spk = s.includes('speak') || s.includes('tts') || s.includes('talk') || s === 'speaking';
            setSdkSpeaking(spk);
            if (s.includes('listen')) {
              setSdkListening(true);
            } else if (s.includes('idle')) {
              setSdkSpeaking(false);
              setSdkListening(false);
            }
          },
          onError: (err: any) => {
            console.warn('[XingYun 3D] SDK 运行异常，自动降级 2D:', err);
            if (!cancelled) {
              const msg = (err && (err.error_reason || err.reason || err.message || err)) || 'SDK异常';
              updateFallbackReason(msg);
              setSdkStatus('error');
            }
          },
          onMessage: (m: any) => {
            console.log('[XingYun 3D] onMessage:', m);
            if (!cancelled && m) {
              const raw = JSON.stringify(m);
              const reason = m?.error_reason || m?.reason || (m?.originalError ? String(m.originalError) : '');
              const code = m?.code ?? m?.error_code;
              if (
                code === 10003 || code === 5 ||
                /积分|余额|额度|充值|session|会话/.test(raw)
              ) {
                updateFallbackReason(reason || (m?.message ? String(m.message) : '魔珐星云会话建立失败（可能是积分不足）'));
                setSdkStatus('error');
              }
            }
          },
        });

        sdkRef.current = sdk;

        // 初始化音量同步
        if (typeof sdk.setVolume === 'function') {
          try {
            sdk.setVolume(speechEnabled ? 1 : 0);
          } catch {}
        }

        const initPromise = sdk.init({
          onDownloadProgress: (p: number) => {
            const val = Math.round(Number(p) || 0);
            setLoadProgress((prev) => Math.max(prev, val));
          },
          onError: (err: any) => {
            console.warn('[XingYun 3D] init error 回调:', err);
            if (!cancelled) {
              updateFallbackReason(err?.message || '初始化失败');
              setSdkStatus('error');
            }
          },
        });

        if (initPromise && typeof initPromise.then === 'function') {
          initPromise
            .then(() => {
              clearTimeout(timeoutTimer);
              if (!cancelled) {
                setLoadProgress(100);
                setSdkStatus('ready');
                console.log('[XingYun 3D] 魔珐星云 3D 数字人就绪并开始渲染！');
              }
            })
            .catch((err: any) => {
              clearTimeout(timeoutTimer);
              console.warn('[XingYun 3D] init Promise rejected:', err);
              if (!cancelled) {
                updateFallbackReason(err?.message || '初始化握手失败');
                setSdkStatus('error');
              }
            });
        } else {
          clearTimeout(timeoutTimer);
          if (!cancelled) {
            setLoadProgress(100);
            setSdkStatus('ready');
          }
        }
      } catch (e: any) {
        clearTimeout(timeoutTimer);
        console.warn('[XingYun 3D] 初始化异常捕获:', e);
        if (!cancelled) {
          updateFallbackReason(e?.message || '脚本执行异常');
          setSdkStatus('error');
        }
      }
    };

    const existingScript = document.querySelector(`script[src="${XINGYUN_CDN}"]`);
    if (existingScript) {
      initSdk();
    } else {
      const s = document.createElement('script');
      s.src = XINGYUN_CDN;
      s.async = true;
      s.onload = () => initSdk();
      s.onerror = (e) => {
        clearTimeout(timeoutTimer);
        console.warn('[XingYun 3D] CDN 脚本拉取失败，触发 2D 降级保底:', e);
        if (!cancelled) {
          updateFallbackReason('CDN 资源不可达');
          setSdkStatus('error');
        }
      };
      document.head.appendChild(s);
    }

    return () => {
      cancelled = true;
      clearTimeout(timeoutTimer);
      if (sdkRef.current) {
        try {
          if (typeof sdkRef.current.destroy === 'function') {
            sdkRef.current.destroy();
          } else if (typeof sdkRef.current.stop === 'function') {
            sdkRef.current.stop();
          }
        } catch (e) {
          console.warn('[XingYun 3D] 资源释放异常:', e);
        }
        sdkRef.current = null;
      }
    };
  }, [force2D]);

  // 2. 语音开关与 SDK 静音同步联动
  useEffect(() => {
    if (sdkRef.current && typeof sdkRef.current.setVolume === 'function') {
      try {
        sdkRef.current.setVolume(speechEnabled ? 1 : 0);
      } catch (e) {
        console.warn('[XingYun 3D] 设置音量失败:', e);
      }
    }
  }, [speechEnabled]);

  const is3DReady = sdkStatus === 'ready' && !force2D;
  const isSpeakingActive = isSpeaking || sdkSpeaking;
  const isListeningActive = isListening || sdkListening;

  // 3. 对外暴露 speak 与 stop 句柄：AI 问答文本 → 驱动数字人语音合成与口型
  useImperativeHandle(ref, () => ({
    is3D: () => is3DReady,
    speak: async (text: string) => {
      // ── 星云 3D 分支（保持原逻辑不变） ──
      if (is3DReady) {
        const sdk = sdkRef.current;
        if (!sdk || !text || !speechEnabled) return false;
        try {
          const cleanText = text
            .replace(/[#*`_~>[\]()!-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (!cleanText) return false;
          const excerpt = cleanText.length > 280 ? cleanText.slice(0, 280) : cleanText;

          if (typeof sdk.speak === 'function') {
            console.log('[XingYun 3D] speak 触发:', cleanText.slice(0, 40));
            await sdk.speak(excerpt, true, true);
            console.log('[XingYun 3D] speak 完成');
            return true;
          } else if (typeof sdk.chat === 'function') {
            await sdk.chat(excerpt);
            return true;
          } else if (typeof sdk.sendMessage === 'function') {
            await sdk.sendMessage(excerpt);
            return true;
          } else if (typeof sdk.sendText === 'function') {
            await sdk.sendText(excerpt);
            return true;
          } else {
            console.warn('[XingYun 3D] SDK 无可用对话/说话方法');
            return false;
          }
        } catch (e) {
          console.warn('[XingYun 3D] 数字人发声异常:', e);
          return false;
        }
      }

      // ── 本地 3D 分支：speechSynthesis 朗读 + 口型驱动 ──
      if (!text || !speechEnabled) return false;
      const h3d = human3dRef.current;
      if (h3d) {
        return h3d.speak(text);
      }
      return false;
    },
    stop: () => {
      // 星云 SDK stop
      const sdk = sdkRef.current;
      if (sdk) {
        try {
          if (typeof sdk.interrupt === 'function') {
            sdk.interrupt('user_stop');
          } else if (typeof sdk.stop === 'function') {
            sdk.stop();
          }
        } catch {}
      }
      // 本地 3D stop
      const h3d = human3dRef.current;
      if (h3d) {
        h3d.stop();
      }
    },
  }));

  const activePersona = DIGITAL_PERSONAS.find((p) => p.id === selectedPersonaId) || DIGITAL_PERSONAS[0];

  const handleSelectPersona = (id: string) => {
    setSelectedPersonaId(id);
    try {
      localStorage.setItem('industrial_digital_human_persona', id);
    } catch {}
  };

  return (
    <div
      className={`hud-card fx-shimmer p-4 sm:p-5 relative transition-all ${className}`}
      onClick={() => {
        // 用户手势内唤醒 SDK 音频上下文（规避浏览器自动播放策略）
        try {
          if (sdkRef.current && typeof sdkRef.current.setVolume === 'function') {
            sdkRef.current.setVolume(speechEnabled ? 1 : 0);
          }
        } catch {}
      }}
    >
      {/* Top Header: Title & Persona Switcher */}
      <div className="flex items-center justify-between gap-2 relative z-10 pb-2.5 border-b border-amber-100/80">
        <div className="flex items-center space-x-2 min-w-0">
          <div className="icon-tile icon-tile-sm icon-tile-gold shrink-0">
            {is3DReady ? <Cuboid className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center space-x-1.5 truncate">
              <span>{is3DReady ? '3D数字人专家' : '自研3D数字人・本地渲染'}</span>
              <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full border shrink-0 ${
                is3DReady
                  ? 'bg-cyan-50 text-cyan-600 border-cyan-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
              }`}>
                {is3DReady ? '3D · LIVE' : '本地3D · LIVE'}
              </span>
            </h3>
            <p className="text-[10px] text-slate-500 mt-0.5 truncate">
              {is3DReady ? '魔珐星云轻量云渲染 · 实时口型同步' : `${activePersona.roleTitle} · ${activePersona.name}`}
            </p>
          </div>
        </div>

        {/* TTS Speech Toggle & 3D/2D switch button */}
        <div className="flex items-center space-x-1.5 shrink-0">
          {sdkStatus === 'ready' && (
            <button
              type="button"
              onClick={() => setForce2D(!force2D)}
              title={force2D ? '切回 3D 渲染视图' : '切换为 2D 视图'}
              className="px-2 py-1 rounded-md border border-slate-200 hover:border-cyan-300 text-slate-600 hover:text-cyan-600 bg-white hover:bg-cyan-50/50 transition-colors cursor-pointer text-[11px] flex items-center space-x-1"
            >
              <Monitor className="w-3 h-3" />
              <span>{force2D ? '切回3D' : '2D视图'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onToggleSpeech}
            title={speechEnabled ? '已开启语音朗读 (点击静音)' : '已静音 (点击开启语音朗读)'}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center space-x-1 transition-all cursor-pointer border ${
              speechEnabled
                ? 'bg-blue-50 text-blue-600 border-blue-200 shadow-2xs'
                : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            {speechEnabled ? <Volume2 className="w-3.5 h-3.5 text-blue-600" /> : <VolumeX className="w-3.5 h-3.5" />}
            <span>{speechEnabled ? '播报中' : '静音'}</span>
          </button>
        </div>
      </div>

      {/* Main Avatar Canvas Area */}
      <div className="py-3 flex flex-col items-center gap-3.5 relative z-10 w-full">
        
        {/* Main Render Area: 3D Render Area OR 2D Fallback SVG */}
        <div className="relative flex flex-col items-center justify-center w-full">

          {/* 常驻 3D 挂载容器：SDK init 依赖该节点，任何渲染状态下都必须存在于 DOM
              （ready 前隐藏且不占位，SDK 初始化完成后转为可见占位） */}
          <div
            id="xingyun-avatar"
            className={`w-[280px] h-[165px] sm:w-[300px] sm:h-[175px] max-w-full rounded-xl overflow-hidden border transition-all duration-300 relative flex items-center justify-center [&>canvas]:w-full [&>canvas]:h-full [&>canvas]:object-cover ${
              is3DReady
                ? isSpeakingActive
                  ? 'border-cyan-400 shadow-[0_0_24px_rgba(6,182,212,0.35)] ring-2 ring-cyan-300/50 bg-gradient-to-b from-blue-50/20 to-cyan-50/20'
                  : 'border-slate-200/80 bg-gradient-to-b from-slate-50/80 to-slate-100/50 shadow-inner'
                : 'absolute opacity-0 pointer-events-none border-slate-200/40 bg-slate-50/40'
            }`}
          />

          {/* 状态 1: 3D 就绪视觉层（边框高亮、角标、声波条由本层与常驻容器共同呈现） */}
          {is3DReady ? (
            <div className="relative flex flex-col items-center">
              <div
                className={`w-[280px] h-[165px] sm:w-[300px] sm:h-[175px] max-w-full rounded-xl overflow-hidden border transition-all duration-300 relative flex items-center justify-center ${
                  isSpeakingActive
                    ? 'border-cyan-400 shadow-[0_0_24px_rgba(6,182,212,0.35)] ring-2 ring-cyan-300/50 bg-gradient-to-b from-blue-50/20 to-cyan-50/20'
                    : 'border-slate-200/80 bg-gradient-to-b from-slate-50/80 to-slate-100/50 shadow-inner'
                }`}
              >
                {/* 3D 视觉占位（实际挂载点为外层常驻容器 #xingyun-avatar） */}
                <div className="w-full h-full relative" />

                {/* 科技角标装饰 */}
                <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-white/85 backdrop-blur-xs border border-cyan-200/80 text-[9px] font-mono text-cyan-700 shadow-xs pointer-events-none flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
                  <span>XingYun 3D</span>
                </div>
              </div>

              {/* 3D 容器下方：金色/天青动态声波仪 + 状态指示器 */}
              <div className="hud-bar mt-2.5 w-[280px] sm:w-[300px] max-w-full px-3 py-1.5 flex items-center justify-between">
                <div className="flex items-center space-x-1.5 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                    isSpeakingActive ? 'bg-amber-400 animate-ping' : isListeningActive ? 'bg-emerald-500' : 'bg-slate-400'
                  }`} />
                  <span className="text-[11px] font-medium text-slate-700 truncate">
                    {isSpeakingActive ? '3D语音实时输出中' : isListeningActive ? '正在现场拾音' : '3D数字人 · 在线待命'}
                  </span>
                </div>

                {/* 金色 → 天青动态声波仪 */}
                <WaveformHUD active={isSpeakingActive} bars={9} className="h-5 shrink-0 pl-2" />
              </div>
            </div>

          /* 状态 2: 3D 加载中玻璃风加载态（横向黄金比例，杜绝畸形留白与黑边） */
          ) : sdkStatus === 'loading' && !force2D ? (
            <div className="w-[280px] h-[165px] sm:w-[300px] sm:h-[175px] max-w-full rounded-xl border border-blue-200/80 bg-gradient-to-b from-white/95 via-blue-50/40 to-cyan-50/20 backdrop-blur-md px-4 py-3 flex flex-col items-center justify-between text-center shadow-xs">
              <div className="flex items-center space-x-2.5 mt-1">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-500 to-cyan-400 p-0.5 shadow-sm shadow-blue-500/20 animate-pulse">
                  <div className="w-full h-full bg-white rounded-[6px] flex items-center justify-center text-cyan-600">
                    <Cuboid className="w-4 h-4 animate-spin" style={{ animationDuration: '4s' }} />
                  </div>
                </div>
                <div className="text-left">
                  <div className="text-xs font-bold text-slate-800 tracking-tight flex items-center gap-1">
                    <span>魔珐星云 3D 数字人</span>
                    <span className="text-[9px] px-1 py-0.2 rounded bg-cyan-100 text-cyan-700 font-mono">16:9</span>
                  </div>
                  <div className="text-[10px] text-slate-500">正在建立 3D 渲染会话通道...</div>
                </div>
              </div>
              
              {/* 蓝青科技细线进度条 */}
              <div className="w-full space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-600">
                  <span>骨骼与模型网格下载</span>
                  <span className="font-bold text-blue-600">{loadProgress}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-100 p-0.5 border border-slate-200/60 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 to-teal-400 transition-all duration-200"
                    style={{ width: `${Math.max(6, loadProgress)}%` }}
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => setForce2D(true)}
                className="text-[10px] text-slate-500 hover:text-blue-600 hover:underline cursor-pointer"
              >
                跳过加载直接使用本地3D →
              </button>
            </div>

          /* 状态 3: 降级回原 2D 仿真 SVG 数字人（完整保留原有张工/李工/小智及全部动效） */
          ) : (
            <div className="relative flex flex-col items-center w-full">
              {fallbackReason && (
                <div className="w-full max-w-[280px] mb-2 px-2.5 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-[10px] text-amber-700 text-center leading-relaxed">
                  ⚠ 3D 数字人暂不可用：{getSanitizedFallbackReason(fallbackReason)}（已自动降级 2D 形象）
                </div>
              )}
              {/* ── 次世代立绘剧场：全景舞台 + 环境光晕 + 全息底网 + 呼吸脉冲 + 立绘融入 + 全息底座 ── */}
              <div className="relative w-full h-[286px] sm:h-[322px] rounded-2xl overflow-hidden border border-amber-100/70 bg-gradient-to-b from-white/70 via-amber-50/25 to-cyan-50/25">

                {/* ① 环境景深漫反射光晕（晨曦金 / 天青 / 靛紫） */}
                <div className="absolute inset-0 overflow-hidden rounded-2xl">
                  <div className="fx-bloom" />
                </div>

                {/* ② 微晶六边形全息透光底网 */}
                <div className="fx-hex absolute inset-0 rounded-2xl" />

                {/* ③ 晨曦微光粒子 */}
                <div className="fx-particles rounded-2xl" />

                {/* ④ 同心圆呼吸脉冲地标（说话金 / 拾音绿 / 待命青） */}
                <div className="absolute left-1/2 bottom-10 -translate-x-1/2 w-[224px] h-[224px] pointer-events-none">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className={`absolute inset-0 rounded-full border pulse-ring ${i === 1 ? 'pulse-ring-2' : i === 2 ? 'pulse-ring-3' : ''}`}
                      style={{
                        borderColor: isSpeakingActive
                          ? 'rgba(232, 163, 61, 0.55)'
                          : isListeningActive
                          ? 'rgba(16, 185, 129, 0.45)'
                          : 'rgba(14, 165, 233, 0.32)',
                      }}
                    />
                  ))}
                </div>

                {/* ⑤ 全息科技光环 */}
                <div
                  className="hud-halo"
                  style={{ opacity: isSpeakingActive ? 0.95 : isListeningActive ? 0.8 : 0.55 }}
                />

                {/* ⑥ 大立绘：半身融入（底部渐隐，与全息底座自然衔接） */}
                <div className="absolute inset-x-0 bottom-4 flex justify-center z-10">
                  <div
                    className="w-[228px] h-[228px] sm:w-[262px] sm:h-[262px] flex items-center justify-center"
                    style={{
                      animation: isSpeakingActive
                        ? 'digital-human-breath 1.8s ease-in-out infinite'
                        : 'digital-human-breath 3.5s ease-in-out infinite',
                      maskImage: 'linear-gradient(180deg, #000 64%, rgba(0,0,0,0.40) 87%, transparent 100%)',
                      WebkitMaskImage: 'linear-gradient(180deg, #000 64%, rgba(0,0,0,0.40) 87%, transparent 100%)',
                    }}
                  >
                {/* 自研 VRM 动漫 3D 数字人（替代原 SVG 简笔画 / 程序化模型） */}
                <DigitalHumanVRM
                  ref={human3dRef}
                  personaId={selectedPersonaId}
                  isSpeaking={isSpeakingActive}
                  className="w-full h-full"
                />

                  </div>
                </div>

                {/* ⑦ 全息底座 */}
                <div className="hud-pedestal absolute bottom-3 left-1/2 -translate-x-1/2 w-[248px] sm:w-[284px] h-4 rounded-[50%]" />

                {/* ⑧ 金色/天青声波仪表盘 + 状态浮标 */}
                <div className="absolute inset-x-4 bottom-3 z-20 flex flex-col items-center gap-1.5">
                  <WaveformHUD active={isSpeakingActive || isListeningActive} bars={24} className="h-6 w-full" />
                  <div className="px-2.5 py-0.5 rounded-full bg-white/90 backdrop-blur-xs border border-amber-200/70 text-[10px] font-mono text-slate-700 flex items-center space-x-1.5 shadow-sm">
                    {isSpeakingActive ? (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                        <span className="text-amber-700 font-bold">2D语音合成输出中</span>
                      </>
                    ) : isListeningActive ? (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span className="text-emerald-600 font-bold">正在现场拾音</span>
                      </>
                    ) : (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                        <span>2D仿真 · 在线待命</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {force2D && sdkStatus === 'ready' && (
                <button
                  type="button"
                  onClick={() => setForce2D(false)}
                  className="mt-2 text-[11px] text-cyan-600 hover:text-cyan-700 hover:underline flex items-center space-x-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>切回 3D 渲染</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Lower Section: Persona Details & Quick Directives */}
        <div className="w-full space-y-2.5 text-left">
          
          {/* 3D 形象展示 或 2D 形象详情 */}
          {is3DReady ? (
            <div className="p-3 rounded-lg bg-gradient-to-r from-amber-50/60 via-cyan-50/35 to-white border border-amber-100/80 space-y-1.5">
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-sm font-bold text-slate-900">魔珐星云 · 工业3D机电总工</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-100/70 text-amber-800 border border-amber-200">
                  超写实轻量端渲染
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                基于魔珐星云 3D Lite SDK 免显卡端渲染引擎驱动，已直连工厂遥测中枢与千问大模型，问答回复时实时驱动逼真面部口型与身体动作。
              </p>
            </div>
          ) : (
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-base font-bold text-slate-900">{activePersona.name}</span>
                <span
                  className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                  style={{
                    backgroundColor: `${activePersona.themeColor}15`,
                    color: activePersona.themeColor,
                    border: `1px solid ${activePersona.themeColor}30`,
                  }}
                >
                  {activePersona.roleTitle}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">{activePersona.description}</p>
            </div>
          )}

          {/* 2D 模式下的三形象切换器（3D模式只有一个形象时隐藏并展示当前形象名） */}
          {(!is3DReady || force2D) && (
            <div>
              <span className="text-[11px] text-slate-500 font-medium block mb-1.5">切换专家形象：</span>
              <div className="grid grid-cols-3 gap-2">
                {DIGITAL_PERSONAS.map((p) => {
                  const isSelected = p.id === activePersona.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectPersona(p.id)}
                      className={`justify-center text-xs font-semibold ${isSelected ? 'chip-gold' : 'chip-cyan'}`}
                    >
                      <span>{p.name}</span>
                      {isSelected && <Check className="w-3 h-3 ml-0.5" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick Directive Hotkeys */}
          {onSelectPrompt && (
            <div className="pt-2 border-t border-amber-100/70">
              <div className="text-[11px] text-slate-500 mb-1.5 flex items-center font-medium">
                <Radio className="w-3 h-3 mr-1 text-amber-500" />
                <span>现场检修快捷问答指令：</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_DIRECTIVES.map(({ text, Icon }) => (
                  <button
                    key={text}
                    type="button"
                    onClick={() => onSelectPrompt(text)}
                    className="chip-gold fx-shimmer"
                  >
                    <Icon className="w-3 h-3 shrink-0 opacity-80" />
                    <span>{text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

DigitalHumanAvatar.displayName = 'DigitalHumanAvatar';
