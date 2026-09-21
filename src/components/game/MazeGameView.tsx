/**
 * 《故障侦探 · 俯视迷宫》—— iframe 嵌 Godot 4.7 Web 导出，React 只负责喂真实数据。
 *
 * 数据流向与横版一致：
 *   React ──(postMessage: JSON 字符串)──▶ iframe 的 window.__godotInbox（Bridge 轮询 shift）
 *   React ◀──(window.parent.postMessage: 对象)── Godot 的 JavaScriptBridge.eval
 *
 * 数据红线：payload 由 `buildMazePayload(真实台账, 真实规程)` 生成；台账里凑不满
 * 本关要用的可玩设备时，`MazeLevelDTO.degraded` 会带上原因，Godot 侧照念不编。
 * 台账为空时这里直接不渲染 iframe —— 引擎停在"等待接入"屏，也不会自己造设备。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Compass, Loader2, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useAppData } from '../../context/AppDataContext';
import type { MaintenanceProcedure } from '../../types';
import { buildMazePayload, type MazePayload } from './mazeLevels';
import { fetchProcedures } from './gameData';

/** Godot `bridge.gd` 回传的消息（type 恒为 `maze-game`） */
interface MazeMessage {
  type: string;
  event?: string;
  levels?: number;
  devices?: number;
  index?: number;
  score?: number;
  [k: string]: unknown;
}

export interface MazeGameViewProps {
  currentUser?: { name?: string } | null;
}

export function MazeGameView({ currentUser }: MazeGameViewProps) {
  const { equipments } = useAppData();
  const [procs, setProcs] = useState<MaintenanceProcedure[]>([]);
  const [loadingProcs, setLoadingProcs] = useState(true);
  const [engineReady, setEngineReady] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [lastEvent, setLastEvent] = useState<MazeMessage | null>(null);
  const [epoch, setEpoch] = useState(0);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchProcedures().then((list) => {
      if (!alive) return;
      setProcs(list);
      setLoadingProcs(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const payload = useMemo(
    () => (equipments.length ? buildMazePayload(equipments, procs) : null),
    [equipments, procs]
  );

  const pushPayload = useCallback((p: MazePayload | null) => {
    const frame = frameRef.current;
    if (!p || !frame?.contentWindow) return;
    frame.contentWindow.postMessage(JSON.stringify(p), '*');
  }, []);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (!data || typeof data !== 'object') return;
      const msg = data as MazeMessage;
      if (msg.type !== 'maze-game') return;
      if (msg.event === 'ready') setEngineReady(true);
      if (msg.event === 'data_accepted') setAccepted(true);
      if (msg.event === 'level_done') setLastEvent(msg);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (engineReady && payload) pushPayload(payload);
  }, [engineReady, payload, pushPayload]);

  const reload = useCallback(() => {
    setEngineReady(false);
    setAccepted(false);
    setLastEvent(null);
    setEpoch((v) => v + 1);
  }, []);

  if (loadingProcs) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#0b1220] text-slate-300">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        正在加载规程数据…
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#0b1220] p-8 text-center text-slate-300">
        <div>
          <Compass className="mx-auto mb-3 h-8 w-8 text-cyan-400" />
          <p className="text-lg">暂无设备台账，无法生成俯视迷宫关卡</p>
          <p className="mt-2 text-sm text-slate-500">
            房间里的故障设备与检修动作全部来自真实台账与标准化规程，台账为空时不下发任何占位关卡。
          </p>
        </div>
      </div>
    );
  }

  const faultTotal = payload.levels.reduce((n, lv) => n + lv.faults.length, 0);
  const degraded = payload.levels.filter((lv) => lv.degraded);

  return (
    <div className="flex h-full w-full flex-col bg-[#0b1220]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-700/60 bg-[#0f172a] px-4 py-2 text-xs text-slate-300">
        <span className="flex items-center gap-1.5 font-medium text-cyan-300">
          <Compass className="h-4 w-4" />
          故障侦探 · 俯视迷宫
        </span>
        <span className="flex items-center gap-1.5">
          {engineReady ? (
            <>
              <Wifi className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-emerald-400">引擎已连接</span>
            </>
          ) : (
            <>
              <WifiOff className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-amber-400">正在启动 Godot 引擎…</span>
            </>
          )}
        </span>
        <span className="text-slate-500">
          台账 {payload.devices.length} 台 ｜ {payload.levels.length} 关 ｜ 故障位 {faultTotal} 处 ｜
          {accepted ? '真实数据已下发' : '等待数据下发'}
        </span>
        {degraded.length > 0 && (
          <span className="text-amber-400">
            {degraded.length} 关按台账降级：{degraded.map((lv) => `第${lv.index}关 ${lv.degraded}`).join('；')}
          </span>
        )}
        {currentUser?.name && <span className="text-slate-500">操作员 {currentUser.name}</span>}
        <span className="ml-auto flex items-center gap-3">
          {lastEvent && (
            <span className="text-slate-400">
              第 {lastEvent.index ?? '-'} 关完成 · 累计 {lastEvent.score ?? 0} 分
            </span>
          )}
          <button
            type="button"
            onClick={reload}
            className="flex items-center gap-1 rounded border border-slate-600 px-2 py-1 text-slate-300 transition hover:border-cyan-500 hover:text-cyan-300"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重开
          </button>
        </span>
      </div>
      <iframe
        key={epoch}
        ref={frameRef}
        title="故障侦探·俯视迷宫"
        src="/godot-maze/index.html"
        className="min-h-0 w-full flex-1 border-0 bg-[#0b1220]"
        allow="autoplay; fullscreen"
      />
    </div>
  );
}

export default MazeGameView;
