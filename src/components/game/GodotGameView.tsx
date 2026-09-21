/**
 * 「故障侦探」3D 第一人称推理检修 —— 用 iframe 嵌 Godot 4 Web 导出，双向 postMessage 通信。
 *
 * 数据流向：
 *   React ──(postMessage: JSON 字符串)──▶ iframe 的 window.__godotInbox
 *   React ◀──(window.parent.postMessage: 对象)── Godot 的 JavaScriptBridge.eval
 *
 * 数据红线：payload 里的设备、题目、正确项**全部来自真实台账与真实规程**
 * （`buildMasterLevels` + `buildDeviceMiniGames`）；没有命中规程的设备
 * `steps` 为空，Godot 侧会拒绝开始检修并提示"暂无标准化规程" —— 不造假兜底。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gamepad2, Loader2, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useAppData } from '../../context/AppDataContext';
import type { MaintenanceProcedure } from '../../types';
import { buildMasterLevels } from './masterLevels';
import {
  buildDeviceMiniGames,
  fetchProcedures,
  findProcedureForEquipment,
  iconKindForCategory,
  type MiniGame,
} from './gameData';

/* ============================ 桥协议类型 ============================ */

export interface GodotDeviceDTO {
  id: string;
  no: string;
  name: string;
  category: string;
  icon: string;
}

export interface GodotStepDTO {
  kind: MiniGame['kind'];
  title: string;
  prompt: string;
  options?: string[];
  correct?: string;
  statement?: string;
  answer?: boolean;
  items?: string[];
  explain?: string;
}

export interface GodotTargetDTO {
  deviceId: string;
  deviceName: string;
  alarming: boolean;
  sequential: boolean;
  steps: GodotStepDTO[];
}

export interface GodotLevelDTO {
  index: number;
  kind: string;
  name: string;
  brief: string;
  timeLimit: number;
  phaseSeconds: number[];
  targets: GodotTargetDTO[];
}

export interface GodotPayload {
  type: 'repair-data' | 'START_GAME';
  version: number;
  devices: GodotDeviceDTO[];
  levels: GodotLevelDTO[];
}

/** Godot 回传的消息（兼容旧 2D 和新 3D 格式） */
export interface GodotMessage {
  type: string;
  event?: string;
  game?: string;
  level?: number;
  stars?: number;
  score?: number;
  totalScore?: number;
  grade?: string;
  [k: string]: unknown;
}

const ROSTER_LIMIT = 16;

const KIND_META: Record<MiniGame['kind'], { title: string; prompt: (stepName: string) => string }> = {
  tool: { title: '选工具', prompt: (n) => `规程「${n}」应使用哪件工具？` },
  safety: { title: '安全判断', prompt: () => '判断下面这条安全说法是否正确' },
  order: { title: '排序题', prompt: () => '按正确顺序依次点击本步的作业动作' },
};

function toStepDTO(game: MiniGame, stepName: string): GodotStepDTO {
  const meta = KIND_META[game.kind];
  const base: GodotStepDTO = { kind: game.kind, title: meta.title, prompt: meta.prompt(stepName) };
  if (game.kind === 'tool') return { ...base, options: game.options, correct: game.correct };
  if (game.kind === 'safety') return { ...base, statement: game.statement, answer: game.answer };
  return { ...base, items: game.items };
}

/** 台账设备 + 真实规程 → Godot 需要的完整 payload */
export function buildGodotPayload(
  equipments: Parameters<typeof buildMasterLevels>[0],
  procs: MaintenanceProcedure[]
): GodotPayload {
  const devices: GodotDeviceDTO[] = equipments.slice(0, ROSTER_LIMIT).map((eq) => ({
    id: eq.id,
    no: eq.code || eq.id,
    name: eq.name,
    category: eq.category,
    icon: iconKindForCategory(eq.category),
  }));

  const levels: GodotLevelDTO[] = buildMasterLevels(equipments, procs).map((lv) => ({
    index: lv.index,
    kind: lv.kind,
    name: lv.name,
    brief: lv.brief,
    timeLimit: lv.timeLimit,
    phaseSeconds: lv.phaseSeconds,
    targets: lv.devices.map((spec) => {
      const eq = equipments.find((e) => e.id === spec.equipmentId);
      const proc = eq ? findProcedureForEquipment(eq, procs) : null;
      const games = proc ? buildDeviceMiniGames(proc, procs) : [];
      const stepName = proc?.steps?.[0]?.name || proc?.title || '';
      return {
        deviceId: spec.equipmentId,
        deviceName: spec.equipmentName,
        alarming: spec.alarming,
        sequential: spec.sequential,
        steps: games.map((g) => toStepDTO(g, stepName)),
      };
    }),
  }));

  return { type: 'repair-data', version: 1, devices, levels };
}

/* ============================ 组件 ============================ */

interface GodotGameViewProps {
  currentUser?: { name?: string } | null;
}

export function GodotGameView({ currentUser }: GodotGameViewProps) {
  const { equipments } = useAppData();
  const [procs, setProcs] = useState<MaintenanceProcedure[]>([]);
  const [loadingProcs, setLoadingProcs] = useState(true);
  const [connected, setConnected] = useState(false);
  const [godotReady, setGodotReady] = useState(false);
  const [lastEvent, setLastEvent] = useState<GodotMessage | null>(null);
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
    () => (equipments.length ? buildGodotPayload(equipments, procs) : null),
    [equipments, procs]
  );

  const pushPayload = useCallback((p: GodotPayload | null) => {
    const frame = frameRef.current;
    if (!p || !frame?.contentWindow) return;
    frame.contentWindow.postMessage(JSON.stringify(p), '*');
  }, []);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (!data || typeof data !== 'object') return;
      const msg = data as GodotMessage;

      // 旧 2D 格式: {type: "repair-game", event: "ready"}
      if (msg.type === 'repair-game' && msg.event === 'ready') {
        setConnected(true);
        setGodotReady(true);
        return;
      }
      // 新 3D 格式: {type: "ready", engine: "godot-4.7.2", game: "fault-detective"}
      if (msg.type === 'ready') {
        setConnected(true);
        setGodotReady(true);
        return;
      }
      // 心跳
      if (msg.event === 'state') return;

      setLastEvent(msg);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (godotReady && payload) pushPayload(payload);
  }, [godotReady, payload, pushPayload]);

  const reload = useCallback(() => {
    setGodotReady(false);
    setConnected(false);
    setLastEvent(null);
    setEpoch((v) => v + 1);
  }, []);

  const playableTargets = payload
    ? payload.levels.reduce((n, lv) => n + lv.targets.filter((t) => t.steps.length > 0).length, 0)
    : 0;
  const totalTargets = payload ? payload.levels.reduce((n, lv) => n + lv.targets.length, 0) : 0;

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
          <Gamepad2 className="mx-auto mb-3 h-8 w-8 text-cyan-400" />
          <p className="text-lg">暂无设备台账，无法生成故障侦探关卡</p>
          <p className="mt-2 text-sm text-slate-500">
            关卡内容全部来自真实台账与标准化规程，台账为空时不生成任何占位关卡。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-[#0b1220]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-700/60 bg-[#0f172a] px-4 py-2 text-xs text-slate-300">
        <span className="flex items-center gap-1.5 font-medium text-cyan-300">
          <Gamepad2 className="h-4 w-4" />
          故障侦探 · 3D
        </span>
        <span className="flex items-center gap-1.5">
          {connected ? (
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
          设备 {payload.devices.length} 台 ｜ 关卡 {payload.levels.length} 关 ｜
          可检修 {playableTargets}/{totalTargets}
        </span>
        {currentUser?.name && <span className="text-slate-500">操作员 {currentUser.name}</span>}
        <span className="ml-auto flex items-center gap-3">
          {lastEvent && (
            <span className="text-slate-400">
              {lastEvent.type === 'level_clear' && `第 ${lastEvent.level} 关完成 · ${lastEvent.stars} 星 · ${lastEvent.score} 分`}
              {lastEvent.type === 'level_fail' && `第 ${lastEvent.level} 关失败`}
              {lastEvent.type === 'all_clear' && '全部通关！'}
              {lastEvent.type === 'level_start' && `第 ${lastEvent.level} 关开始`}
              {lastEvent.event && lastEvent.type === 'repair-game' && (
                <>
                  {String(lastEvent.event)}：第 {String(lastEvent.level ?? '-')} 关
                  {lastEvent.grade ? ` · ${String(lastEvent.grade)} 级` : ''}
                  {typeof lastEvent.stars === 'number' ? ` · ${lastEvent.stars} 星` : ''}
                  {typeof lastEvent.totalScore === 'number' ? ` · 总积分 ${lastEvent.totalScore}` : ''}
                </>
              )}
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
        title="故障侦探"
        src="/godot-game-2d/index.html"
        className="min-h-0 w-full flex-1 border-0 bg-[#0b1220]"
        allow="autoplay; fullscreen"
      />
    </div>
  );
}

export default GodotGameView;
