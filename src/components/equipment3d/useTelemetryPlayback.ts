/**
 * 遥测回放（EquipmentScene.tsx 第三刀，2026-10-19）。
 *
 * 自持：播放开关、当前时刻、1 秒 = 1 小时的定时器，以及「时刻 → 3D 状态色覆盖 +
 * 介质流速」的同步。外部只给四样：选中设备、真实 48h 遥测时序、设备台账、引擎 ref。
 *
 * 刻意**不接管**的两处（它们不是回放的属性）：
 *   - `!selectedId` 时「停回放 + 收起拆解视图」的合并 effect —— 拆过来就得让本 hook
 *     依赖 explodedDeviceId / exitExplodedView，留在组件里调 `stop()`；
 *   - 拆解视图入口里的「先停回放」判断（enterExplodedView）。
 *
 * 数据来源仍是真实落库时序（equipmentApi.getTelemetryHistory）：无点即无可播放，
 * 不插值、不补帧；状态色判定复用 statusMapping 那份全系统唯一的阈值口径。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Equipment } from '../../types';
import { telemetryFeed } from './uiPrimitives';
import { telemetryToStatus } from './statusMapping';
import type { StatusKey } from './equipment';
import type { TelemetryHistory } from './DeviceAnalysisPanel';

/** 回放只用到引擎的这三扇门，因此不必依赖整个 EquipmentScene 类型。 */
export interface PlaybackSceneTarget {
  setStatusOverride(deviceId: string, status: StatusKey | null): void;
  clearStatusOverrides(): void;
  setDeviceTelemetry(deviceId: string, data: ReturnType<typeof telemetryFeed>): void;
}

export interface TelemetryPlaybackOptions {
  selectedId: string | null;
  telemetry: TelemetryHistory | null;
  equipments: Equipment[];
  sceneRef: { current: PlaybackSceneTarget | null };
}

/**
 * `points` 刻意保持"每轮重新取"而不是 useMemo 稳定化：旧实现里同步 effect 的依赖
 * 每轮都在变，等于每次 render（含 stats 轮询）都会把回放状态色重新压回场景 ——
 * 这正是"引擎被参数变更重建后回放颜色不丢"的兜底。钉成稳定身份会让暂停中的回放
 * 在一次重建后悄悄退回台账色，所以这里保留原语义，宁可留一条 exhaustive-deps 警告
 * （该警告在切分前的组件里同样存在，不是新增债）。
 */
export function useTelemetryPlayback({
  selectedId,
  telemetry,
  equipments,
  sceneRef,
}: TelemetryPlaybackOptions) {
  const points = telemetry?.points ?? [];
  const maxIndex = points.length - 1;

  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(-1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** 只停状态与定时器，不清 3D 覆盖（清选中 / 卸载这类路径自己决定何时回灌台账态）。 */
  const stop = useCallback(() => {
    setPlaying(false);
    setIndex(-1);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const toggle = useCallback(() => {
    setPlaying((prev) => !prev);
  }, []);

  const seek = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(maxIndex, idx));
      setIndex(clamped);
      // 拖动时如果未在播放，也同步一次 3D 状态色（即时反馈）
      if (!playing && selectedId && points.length > 0) {
        const point = points[clamped];
        sceneRef.current?.setStatusOverride(selectedId, telemetryToStatus(point));
      }
    },
    [maxIndex, playing, selectedId, points, sceneRef]
  );

  /** 停止回放并回到台账真实状态（清覆盖 + 用台账 status/telemetry 回灌一次）。 */
  const reset = useCallback(() => {
    stop();
    sceneRef.current?.clearStatusOverrides();
    const eq = equipments.find((item) => item.id === selectedId);
    if (eq) sceneRef.current?.setDeviceTelemetry(eq.id, telemetryFeed(eq.status, eq.telemetry));
  }, [selectedId, equipments, sceneRef, stop]);

  useEffect(() => {
    if (playing && points.length > 0) {
      timerRef.current = setInterval(() => {
        setIndex((prev) => {
          const next = prev + 1;
          if (next > maxIndex) {
            // 播放结束：回到真实状态
            if (selectedId) sceneRef.current?.clearStatusOverrides();
            setPlaying(false);
            return -1;
          }
          return next;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [playing, points.length, maxIndex, selectedId, sceneRef]);

  // 回放时刻变化时：同步 3D 状态色覆盖与介质流速
  useEffect(() => {
    if (index < 0 || index >= points.length || !selectedId) return;
    const point = points[index];
    const overStatus = telemetryToStatus(point);
    sceneRef.current?.setStatusOverride(selectedId, overStatus);
    const ledgerStatus = equipments.find((eq) => eq.id === selectedId)?.status ?? 'nodata';
    sceneRef.current?.setDeviceTelemetry(selectedId, telemetryFeed(overStatus ?? ledgerStatus, point));
  }, [index, points, selectedId, equipments, sceneRef]);

  return { playing, index, toggle, seek, reset, stop };
}
