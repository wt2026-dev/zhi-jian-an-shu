/**
 * 「检修闯关」3D 场景的 React 外壳。
 *
 * 只做三件事：挂载/卸载 `GameScene`、把声明式状态（点位颜色 / 聚焦目标 / 数字人动作 / 故障热点）
 * 推给场景、把 WebGL 不可用时的兜底界面画出来。
 *
 * **相机俯冲之类的"一次性动作"不走 props**：父组件通过 `onReady` 拿到 `GameScene` 实例后
 * 直接调 `diveTo()` / `resetView()`。用 props 传"命令"需要额外的去重与生命周期管理，
 * 反而更容易出错。
 */
import { useEffect, useRef, useState } from 'react';
import { GameScene, type FaultSpotSpec, type GameSceneHooks, type StationSpec } from './gameScene';
import type { CharacterMood } from './gameCharacter';

export interface GameSceneViewProps {
  stations: StationSpec[];
  hooks: GameSceneHooks;
  characterUrl?: string;
  /** 聚焦的点位 id；null = 关卡地图总览 */
  focusedId: string | null;
  /** 数字人动作 */
  mood: CharacterMood;
  /** 非空时在场上摆出故障热点 */
  faultSpots: FaultSpotSpec[] | null;
  /** 场景就绪 / 销毁 */
  onReady?: (scene: GameScene | null) => void;
  className?: string;
}

export function GameSceneView(props: GameSceneViewProps) {
  const { stations, hooks, characterUrl, focusedId, mood, faultSpots, onReady, className } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<GameScene | null>(null);
  const hooksRef = useRef(hooks);
  const [failed, setFailed] = useState(false);

  // hooks 每次渲染都可能是新对象，但场景只在挂载时建一次 —— 用 ref 转发最新的回调。
  // 这个 effect 必须声明在建场景的 effect **之前**，才能保证首次提交后 ref 已就绪。
  useEffect(() => {
    hooksRef.current = hooks;
  });

  // 只在挂载时建场景：点位清单后续变化走 setStates，不重建（重建会丢失相机与已加载的 GLB）
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let scene: GameScene | null = null;
    try {
      scene = new GameScene(host, stations, {
        characterUrl,
        hooks: {
          onStationPick: (id) => hooksRef.current.onStationPick?.(id),
          onDiveEnd: (id) => hooksRef.current.onDiveEnd?.(id),
          onFaultPick: (key) => hooksRef.current.onFaultPick?.(key),
          onHover: (id) => hooksRef.current.onHover?.(id),
        },
      });
      scene.start();
      sceneRef.current = scene;
      // 仅开发期：把场景实例挂到 window，供 CDP 探针直接驱动
      // （`__gameScene.setCharacterMood('celebrate')` 之类）。
      // 为什么需要：庆祝/遗憾是程序化骨骼动画，要迭代姿态就得看到那一帧，
      // 而走完整三步关卡要 6~8 分钟；有这个把手，探针 2 分钟就能出图。
      if (import.meta.env.DEV) {
        (window as unknown as { __gameScene?: GameScene | null }).__gameScene = scene;
      }
      onReady?.(scene);
    } catch {
      // WebGL 不可用（老浏览器 / 软件渲染被禁 / jsdom）——给一个能看懂的兜底，不白屏。
      // 置位刻意放到微任务里：在 effect 体内同步 setState 会触发
      // react-hooks/set-state-in-effect 警告，而本项目的 ESLint 口径是"警告只降不升"，
      // 不该为了自己这一个分支把别人的 lint 基线抬高。
      scene?.dispose();
      sceneRef.current = null;
      onReady?.(null);
      void Promise.resolve().then(() => setFailed(true));
    }
    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
      if (import.meta.env.DEV) {
        (window as unknown as { __gameScene?: GameScene | null }).__gameScene = null;
      }
      onReady?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sceneRef.current?.setStates(
      Object.fromEntries(stations.map((s) => [s.id, s.state]))
    );
  }, [stations]);

  useEffect(() => {
    sceneRef.current?.setFocused(focusedId);
  }, [focusedId]);

  useEffect(() => {
    sceneRef.current?.setCharacterMood(mood);
  }, [mood]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (faultSpots && faultSpots.length) scene.showFaultSpots(faultSpots);
    else scene.clearFaultSpots();
  }, [faultSpots]);

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <div className="max-w-md rounded-xl border border-amber-400/35 bg-[rgba(20,14,4,0.85)] p-5">
            <div className="text-sm font-bold text-amber-200">3D 场景无法启动</div>
            <div className="mt-1.5 text-xs leading-relaxed text-slate-300">
              当前浏览器/显卡未启用 WebGL，关卡地图无法渲染。请改用支持 WebGL 的浏览器，
              或在浏览器设置中开启硬件加速后重试。
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
