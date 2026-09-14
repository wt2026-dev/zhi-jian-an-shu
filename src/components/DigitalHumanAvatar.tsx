import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Sparkles, Volume2, VolumeX, Activity, Check, Loader2, Cuboid, RotateCcw, Monitor } from 'lucide-react';
import { DigitalHumanPersona } from '../types';

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

  // 3. 对外暴露 speak 与 stop 句柄：AI 问答文本 → 驱动 3D 数字人语音合成与口型
  useImperativeHandle(ref, () => ({
    is3D: () => is3DReady,
    speak: async (text: string) => {
      const sdk = sdkRef.current;
      if (!sdk || !text || !speechEnabled || !is3DReady) return false;
      try {
        // 清除 markdown 语法标记得到纯朗读文本
        const cleanText = text
          .replace(/[#*`_~>[\]()!-]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (!cleanText) return false;
        const excerpt = cleanText.length > 280 ? cleanText.slice(0, 280) : cleanText;

        if (typeof sdk.speak === 'function') {
          // 官方签名 speak(text, is_start, is_end)：非流式整句朗读
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
    },
    stop: () => {
      const sdk = sdkRef.current;
      if (!sdk) return;
      try {
        if (typeof sdk.interrupt === 'function') {
          sdk.interrupt('user_stop');
        } else if (typeof sdk.stop === 'function') {
          sdk.stop();
        }
      } catch {}
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
      className={`glass-card p-4 sm:p-5 rounded-xl border border-slate-200/80 shadow-[0_4px_16px_rgba(15,23,42,0.06)] relative overflow-hidden transition-all ${className}`}
      style={{ borderTop: '1px solid rgba(59, 130, 246, 0.4)' }}
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
      <div className="flex items-center justify-between gap-2 relative z-10 pb-2.5 border-b border-slate-200/60">
        <div className="flex items-center space-x-2 min-w-0">
          <div className="icon-tile icon-tile-sm icon-tile-cyan shrink-0">
            {is3DReady ? <Cuboid className="w-4 h-4 text-cyan-600" /> : <Sparkles className="w-4 h-4 text-blue-600" />}
          </div>
          <div className="min-w-0">
            <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center space-x-1.5 truncate">
              <span>{is3DReady ? '3D数字人专家' : '工业2D数字人专家'}</span>
              <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded border shrink-0 ${
                is3DReady
                  ? 'bg-cyan-50 text-cyan-600 border-cyan-200'
                  : 'bg-blue-50 text-blue-600 border-blue-200'
              }`}>
                {is3DReady ? '3D · LIVE' : '2D · LIVE'}
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

              {/* 3D 容器下方：说话蓝青动态声波条 + 状态指示器 */}
              <div className="mt-2.5 w-[280px] sm:w-[300px] max-w-full px-3 py-1.5 rounded-lg bg-white/95 border border-slate-200/80 shadow-xs flex items-center justify-between">
                <div className="flex items-center space-x-1.5 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                    isSpeakingActive ? 'bg-cyan-500 animate-ping' : isListeningActive ? 'bg-emerald-500' : 'bg-slate-400'
                  }`} />
                  <span className="text-[11px] font-medium text-slate-700 truncate">
                    {isSpeakingActive ? '3D语音实时输出中' : isListeningActive ? '正在现场拾音' : '3D数字人 · 在线待命'}
                  </span>
                </div>

                {/* 5 根动态蓝青渐变音频声波条 */}
                <div className="flex items-end space-x-1 h-5 shrink-0 pl-2">
                  <span className={`w-1 rounded-full transition-all ${isSpeakingActive ? 'bg-gradient-to-t from-blue-500 to-cyan-400 wave-bar-1' : 'bg-slate-300 h-1.5'}`} />
                  <span className={`w-1 rounded-full transition-all ${isSpeakingActive ? 'bg-gradient-to-t from-blue-500 to-cyan-400 wave-bar-2' : 'bg-slate-300 h-2'}`} />
                  <span className={`w-1 rounded-full transition-all ${isSpeakingActive ? 'bg-gradient-to-t from-blue-500 to-cyan-400 wave-bar-3' : 'bg-slate-300 h-1.5'}`} />
                  <span className={`w-1 rounded-full transition-all ${isSpeakingActive ? 'bg-gradient-to-t from-blue-500 to-cyan-400 wave-bar-4' : 'bg-slate-300 h-2.5'}`} />
                  <span className={`w-1 rounded-full transition-all ${isSpeakingActive ? 'bg-gradient-to-t from-blue-500 to-cyan-400 wave-bar-5' : 'bg-slate-300 h-1.5'}`} />
                </div>
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
                跳过加载直接使用 2D →
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
              <div
                className={`w-36 h-36 sm:w-40 sm:h-40 rounded-full bg-slate-50 border-2 relative overflow-hidden flex items-center justify-center shadow-sm transition-transform ${
                  isSpeakingActive
                    ? 'border-blue-500 scale-105'
                    : isListeningActive
                    ? 'border-emerald-500 scale-105'
                    : 'border-slate-200'
                }`}
                style={{
                  animation: isSpeakingActive ? 'digital-human-breath 1.8s ease-in-out infinite' : 'digital-human-breath 3.5s ease-in-out infinite',
                }}
              >
                {/* SVG Persona 1: 张工 (资深机电总工) */}
                {activePersona.avatarSvgType === 'zhang' && (
                  <svg className="w-full h-full" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="60" cy="60" r="58" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1.5" />
                    <path d="M0 105 C30 95, 90 95, 120 105 L120 120 L0 120 Z" fill="#e2e8f0" />
                    <ellipse cx="60" cy="36" rx="34" ry="18" fill="#f59e0b" />
                    <path d="M26 38 C26 22, 94 22, 94 38 Z" fill="#d97706" />
                    <rect x="52" y="24" width="16" height="5" rx="2" fill="#ef4444" />
                    <path d="M22 38 C35 34, 85 34, 98 38 L100 42 C70 41, 50 41, 20 42 Z" fill="#b45309" />
                    <rect x="38" y="38" width="44" height="42" rx="14" fill="#fcd34d" />
                    <circle cx="44" cy="58" r="4" fill="#f87171" opacity={isSpeakingActive ? 0.6 : 0.3} />
                    <circle cx="76" cy="58" r="4" fill="#f87171" opacity={isSpeakingActive ? 0.6 : 0.3} />
                    <g className="avatar-eyes">
                      <ellipse cx="48" cy="52" rx="4" ry="5" fill="#0f172a" />
                      <circle cx="49" cy="50" r="1.5" fill="#ffffff" />
                      <ellipse cx="72" cy="52" rx="4" ry="5" fill="#0f172a" />
                      <circle cx="73" cy="50" r="1.5" fill="#ffffff" />
                    </g>
                    <path d="M43 45 Q48 43 53 45" stroke="#78350f" strokeWidth="2.5" strokeLinecap="round" />
                    <path d="M67 45 Q72 43 77 45" stroke="#78350f" strokeWidth="2.5" strokeLinecap="round" />
                    <rect x="42" y="46" width="13" height="12" rx="3" stroke="#38bdf8" strokeWidth="1.5" fill="none" opacity="0.8" />
                    <rect x="65" y="46" width="13" height="12" rx="3" stroke="#38bdf8" strokeWidth="1.5" fill="none" opacity="0.8" />
                    <line x1="55" y1="52" x2="65" y2="52" stroke="#38bdf8" strokeWidth="1.5" />
                    <path d="M60 52 L59 60 L63 60" stroke="#b45309" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    {isSpeakingActive ? (
                      <ellipse cx="60" cy="68" rx="6" ry="5" fill="#b91c1c" className="animate-pulse">
                        <rect x="57" y="65" width="6" height="2" fill="#ffffff" />
                      </ellipse>
                    ) : (
                      <path d="M54 67 Q60 71 66 67" stroke="#92400e" strokeWidth="2" strokeLinecap="round" fill="none" />
                    )}
                    <path d="M26 84 C38 78, 82 78, 94 84 L102 120 L18 120 Z" fill="#1e3a8a" />
                    <path d="M48 80 L60 92 L72 80" fill="#3b82f6" />
                    <path d="M22 96 L98 96" stroke="#22c55e" strokeWidth="4" />
                    <path d="M20 102 L100 102" stroke="#e2e8f0" strokeWidth="2" />
                    <rect x="30" y="86" width="8" height="14" rx="2" fill="#334155" />
                    <line x1="32" y1="86" x2="32" y2="80" stroke="#64748b" strokeWidth="1.5" />
                  </svg>
                )}

                {/* SVG Persona 2: 李工 (电气自动化工程师) */}
                {activePersona.avatarSvgType === 'li' && (
                  <svg className="w-full h-full" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="60" cy="60" r="58" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1.5" />
                    <path d="M30 46 C25 80, 28 98, 36 108 L84 108 C92 98, 95 80, 90 46 Z" fill="#1e1b4b" />
                    <rect x="39" y="38" width="42" height="40" rx="14" fill="#fed7aa" />
                    <circle cx="45" cy="56" r="4.5" fill="#fb7185" opacity={isSpeakingActive ? 0.7 : 0.4} />
                    <circle cx="75" cy="56" r="4.5" fill="#fb7185" opacity={isSpeakingActive ? 0.7 : 0.4} />
                    <path d="M36 40 C45 28, 75 28, 84 40 C75 34, 45 34, 36 40 Z" fill="#312e81" />
                    <path d="M36 40 C34 55, 38 65, 42 70 C38 62, 38 50, 40 42 Z" fill="#312e81" />
                    <path d="M84 40 C86 55, 82 65, 78 70 C82 62, 82 50, 80 42 Z" fill="#312e81" />
                    <ellipse cx="48" cy="50" rx="3.5" ry="4.5" fill="#0f172a" />
                    <circle cx="49" cy="48" r="1.5" fill="#ffffff" />
                    <ellipse cx="72" cy="50" rx="3.5" ry="4.5" fill="#0f172a" />
                    <circle cx="73" cy="48" r="1.5" fill="#ffffff" />
                    <path d="M44 46 L46 48 M52 46 L50 48" stroke="#1e1b4b" strokeWidth="1.2" />
                    <path d="M68 46 L70 48 M76 46 L74 48" stroke="#1e1b4b" strokeWidth="1.2" />
                    <rect x="42" y="44" width="13" height="11" rx="3" stroke="#10b981" strokeWidth="1.5" fill="none" opacity="0.85" />
                    <rect x="65" y="44" width="13" height="11" rx="3" stroke="#10b981" strokeWidth="1.5" fill="none" opacity="0.85" />
                    <line x1="55" y1="50" x2="65" y2="50" stroke="#10b981" strokeWidth="1.5" />
                    <path d="M60 51 L59 58 L62 58" stroke="#ea580c" strokeWidth="1.5" strokeLinecap="round" />
                    {isSpeakingActive ? (
                      <ellipse cx="60" cy="65" rx="5" ry="4.5" fill="#e11d48">
                        <rect x="58" y="63" width="4" height="1.5" fill="#ffffff" />
                      </ellipse>
                    ) : (
                      <path d="M55 64 Q60 68 65 64" stroke="#e11d48" strokeWidth="1.8" strokeLinecap="round" fill="none" />
                    )}
                    <path d="M28 82 C40 76, 80 76, 92 82 L100 120 L20 120 Z" fill="#0f766e" />
                    <path d="M50 80 L60 90 L70 80" fill="#14b8a6" />
                    <rect x="68" y="88" width="12" height="18" rx="2" fill="#e2e8f0" />
                    <rect x="70" y="90" width="8" height="6" fill="#0284c7" />
                    <line x1="70" y1="99" x2="78" y2="99" stroke="#64748b" strokeWidth="1.5" />
                  </svg>
                )}

                {/* SVG Persona 3: 小智 (极客AI巡检专家) */}
                {activePersona.avatarSvgType === 'zhi' && (
                  <svg className="w-full h-full" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="60" cy="60" r="58" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1.5" />
                    <path d="M22 55 C22 28, 98 28, 98 55" stroke="#38bdf8" strokeWidth="4" fill="none" />
                    <rect x="18" y="48" width="8" height="18" rx="4" fill="#0284c7" />
                    <circle cx="22" cy="57" r="2" fill="#38bdf8" />
                    <rect x="94" y="48" width="8" height="18" rx="4" fill="#0284c7" />
                    <circle cx="98" cy="57" r="2" fill="#38bdf8" />
                    <path d="M24 64 L36 74 L46 74" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                    <circle cx="46" cy="74" r="3" fill="#22c55e" />
                    <ellipse cx="60" cy="38" rx="33" ry="17" fill="#0284c7" />
                    <path d="M27 38 C27 24, 93 24, 93 38 Z" fill="#0369a1" />
                    <rect x="36" y="32" width="48" height="6" rx="2" fill="#0c4a6e" />
                    <line x1="40" y1="35" x2="76" y2="35" stroke="#38bdf8" strokeWidth="2" strokeDasharray="3 2" />
                    <rect x="38" y="40" width="44" height="38" rx="13" fill="#fed7aa" />
                    <rect x="42" y="46" width="36" height="12" rx="4" fill="#0f172a" stroke="#0ea5e9" strokeWidth="1.5" />
                    <circle cx="50" cy="52" r="3" fill="#38bdf8" />
                    <circle cx="70" cy="52" r="3" fill="#38bdf8" />
                    <line x1="56" y1="52" x2="64" y2="52" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="2 2" />
                    {isSpeakingActive ? (
                      <ellipse cx="60" cy="67" rx="5" ry="4" fill="#0369a1">
                        <line x1="56" y1="67" x2="64" y2="67" stroke="#38bdf8" strokeWidth="2" />
                      </ellipse>
                    ) : (
                      <path d="M55 66 Q60 69 65 66" stroke="#0284c7" strokeWidth="2" strokeLinecap="round" fill="none" />
                    )}
                    <path d="M28 82 C40 76, 80 76, 92 82 L100 120 L20 120 Z" fill="#0369a1" />
                    <path d="M52 82 L60 92 L68 82" fill="#38bdf8" />
                    <circle cx="60" cy="100" r="5" fill="#0284c7" />
                  </svg>
                )}

                {/* 2D 状态浮标 */}
                <div className="absolute bottom-1 px-2.5 py-0.5 rounded-full bg-white/95 backdrop-blur-xs border border-slate-200 text-[10px] font-mono text-slate-700 flex items-center space-x-1.5 shadow-xs">
                  {isSpeakingActive ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-ping" />
                      <span className="text-blue-600 font-bold">2D语音合成输出中</span>
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
            <div className="p-3 rounded-lg bg-gradient-to-r from-blue-50/70 via-cyan-50/40 to-white border border-blue-100 space-y-1.5">
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
                <span className="text-sm font-bold text-slate-900">魔珐星云 · 工业3D机电总工</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-100/60 text-cyan-800 border border-cyan-200">
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
              <span className="text-[11px] text-slate-500 font-medium block mb-1.5">切换 2D 专家风格：</span>
              <div className="grid grid-cols-3 gap-2">
                {DIGITAL_PERSONAS.map((p) => {
                  const isSelected = p.id === activePersona.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectPersona(p.id)}
                      className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center justify-center space-x-1 transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-blue-50 border-blue-300 text-blue-700 shadow-xs'
                          : 'bg-slate-50/80 border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300'
                      }`}
                    >
                      <span>{p.name}</span>
                      {isSelected && <Check className="w-3 h-3 text-blue-600 ml-1" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick Directive Hotkeys */}
          {onSelectPrompt && (
            <div className="pt-2 border-t border-slate-100">
              <div className="text-[11px] text-slate-500 mb-1.5 flex items-center font-medium">
                <Activity className="w-3 h-3 mr-1 text-cyan-500" />
                <span>现场检修快捷问答指令：</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  '今日待办工单与紧急告警',
                  '设备健康度最差的3台设备及诊断',
                  '生成本周设备巡检总结报告',
                  '螺杆空压机二级保养核心步骤',
                ].map((cmd, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onSelectPrompt(cmd)}
                    className="text-[11px] px-2.5 py-1 rounded-md bg-white hover:bg-cyan-50/70 text-slate-700 hover:text-cyan-700 border border-slate-200/80 hover:border-cyan-200 transition-colors cursor-pointer shadow-2xs"
                  >
                    {cmd}
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
