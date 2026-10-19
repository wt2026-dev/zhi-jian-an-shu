// 「遥测回放」源码契约守卫（EquipmentScene.tsx 第三刀，2026-10-19）。
//
// 为什么要有这个文件：回放是纯交互链（点播放 → 1 秒 1 小时推进 → 设备状态色/介质流速
// 跟着变），tsc 与组件测试都测不到"引擎被喂了什么"。切分成 useTelemetryPlayback 之后，
// 一旦接线断在半路（hook 被调用但返回值没人用、或场景不再喂真实时序），页面照常渲染、
// 只是回放"按了没反应"——正是本仓库反复挨过的「静默删功能」形态。
//
// 两类断言：
//   A. 接线契约：场景把真实时序与选中设备喂给 hook，并把 hook 返回值透传给分析面板；
//   B. 顺序契约：hook 的调用点必须排在「台账遥测回灌」effect 之后 —— 回放同步 effect
//      晚于它执行才不会把回放色覆盖回台账色（effect 按声明顺序跑）。
import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SCENE = 'src/components/equipment3d/EquipmentScene.tsx';
const HOOK = 'src/components/equipment3d/useTelemetryPlayback.ts';
const PANEL = 'src/components/equipment3d/DeviceAnalysisPanel.tsx';

describe('遥测回放 · 切分后接线契约（防静默删功能）', () => {
  it('场景把选中设备 + 真实时序 + 台账 + 引擎 ref 喂给 hook', () => {
    const src = read(SCENE);
    expect(src).toContain('useTelemetryPlayback({ selectedId, telemetry, equipments, sceneRef })');
    // 解构改名：下游（HUD / 分析面板 / 拆解入口）拿到的仍是原来那批名字
    expect(src).toContain('playing: playbackPlaying');
    expect(src).toContain('index: playbackIndex');
    expect(src).toContain('stop: stopPlayback');
  });

  it('场景 → 分析面板：播放态与三个回调全部透传（缺一即"按钮点了没反应"）', () => {
    const src = read(SCENE);
    expect(src).toContain('playing={playbackPlaying}');
    expect(src).toContain('playbackIndex={playbackIndex}');
    expect(src).toContain('onTogglePlayback={togglePlayback}');
    expect(src).toContain('onSeek={seekPlayback}');
    expect(src).toContain('onResetPlayback={resetPlayback}');
    const panel = read(PANEL);
    expect(panel).toContain('onTogglePlayback');
    expect(panel).toContain('cursorIndex={playbackIndex}');
  });

  it('停回放的两条业务路径都改走 hook 的 stop（切设备 / 清选中不再各写一份状态）', () => {
    const src = read(SCENE);
    expect(src).toContain('stopPlayback();');
    expect(src).not.toContain('setPlaybackPlaying');
    expect(src).not.toContain('playbackTimerRef');
    expect(src).not.toContain('playbackIndexRef');
  });

  it('hook 自持真实推进：1 秒 1 帧、拖动夹在 [0, maxIndex]、放完回到台账真实状态', () => {
    const src = read(HOOK);
    expect(src).toContain('}, 1000);');
    expect(src).toContain('Math.max(0, Math.min(maxIndex, idx))');
    expect(src).toContain('sceneRef.current?.clearStatusOverrides();');
    expect(src).toContain('telemetryFeed(eq.status, eq.telemetry)'); // 回灌台账真实读数
    // 状态色判定只许用全系统那一份阈值口径
    expect(src).toContain("from './statusMapping'");
  });

  it('数据诚实性：只播真实落库时序，无点即无内容，不插值不补帧不掷随机', () => {
    const src = read(HOOK);
    expect(src).toContain('telemetry?.points ?? []');
    expect(src).not.toMatch(/Math\.random|interpolat|lerp/);
  });

  it('顺序契约：hook 调用点排在台账遥测回灌之后、拆解视图控制之前', () => {
    const src = read(SCENE);
    const ledgerRefeed = src.indexOf('setDeviceTelemetry(eq.id, telemetryFeed(eq.status, eq.telemetry))');
    const hookCall = src.indexOf('useTelemetryPlayback({');
    const explodedSection = src.indexOf('7.1 拆解视图控制');
    expect(ledgerRefeed, '台账遥测回灌那段不见了').toBeGreaterThan(-1);
    expect(hookCall, 'hook 调用不见了').toBeGreaterThan(-1);
    expect(hookCall).toBeGreaterThan(ledgerRefeed);
    expect(hookCall).toBeLessThan(explodedSection);
  });
});
