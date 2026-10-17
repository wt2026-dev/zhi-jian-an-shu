// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DigitalHumanAvatar, DigitalHumanAvatarHandle } from '../../src/components/DigitalHumanAvatar';

/**
 * 3D 后端（写实 GLB / 自研程序化 3D）都用可注入的 mock 替换：
 *  - 记录 speak 调用（用于验证"播报"按钮真的把文本送进了后端）
 *  - 可通过 `failNext` 让某个后端失败（用于验证逐级降级链）
 *  - GLB mock 暴露 `trigger-glb-error`，用来模拟模型加载失败
 *  （动漫 VRM 已按用户要求移除，不再有 VRM 分支）
 */
const mocks = vi.hoisted(() => {
  const make = (testid: string) => ({
    speak: vi.fn(),
    fail: false,
    testid,
  });
  return {
    glb: make('glb-component'),
    three: make('fallback-3d-component'),
  };
});

function makeBackendMock(cfg: { speak: any; fail: boolean; testid: string }) {
  return React.forwardRef(({ personaId, isSpeaking, onError }: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      speak: (t: string) => {
        cfg.speak(t);
        return Promise.resolve(cfg.fail ? false : true);
      },
      stop: vi.fn(),
      setSpeaking: vi.fn(),
      setPersona: vi.fn(),
    }));
    return (
      <div data-testid={cfg.testid} data-persona={personaId} data-speaking={isSpeaking ? '1' : '0'}>
        <button data-testid="trigger-glb-error" onClick={() => onError?.(new Error('load failed'))}>
          Simulate Error
        </button>
      </div>
    );
  });
}

vi.mock('../../src/components/digital-human/DigitalHumanGLB', () => ({
  DigitalHumanGLB: makeBackendMock(mocks.glb),
}));

vi.mock('../../src/components/digital-human/DigitalHuman3D', () => ({
  DigitalHuman3D: makeBackendMock(mocks.three),
}));

/** 记录所有被朗读的文本（Web Speech 兜底路径） */
let spoken: string[] = [];

class FakeUtterance {
  text: string;
  lang = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: any = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onboundary: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
  addEventListener() {}
}

describe('DigitalHumanAvatar - GLB Primary Render Path', () => {
  beforeEach(() => {
    // 本 describe 专门盯写实 GLB 这条链（降级顺序、加载失败兜底）。
    // 默认后端已改成自研程序化 3D，所以这里显式开 `?dh_backend=glb` 把口径钉住，
    // GLB 那条路的回归保护一条都不少；默认口径见文件末尾的另一个 describe。
    window.history.replaceState(null, '', '/?dh_backend=glb');
    localStorage.clear();
    spoken = [];
    mocks.glb.speak.mockClear();
    mocks.three.speak.mockClear();
    mocks.glb.fail = false;
    mocks.three.fail = false;

    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    Object.defineProperty(window, 'speechSynthesis', {
      writable: true,
      value: {
        speak: vi.fn((u: FakeUtterance) => {
          spoken.push(u.text);
          u.onstart?.();
          // 真实引擎是异步结束的，这里同步结束避免测试悬挂
          u.onend?.();
        }),
        cancel: vi.fn(),
        getVoices: vi.fn(() => []),
        addEventListener: vi.fn(),
        paused: false,
        speaking: false,
        pending: false,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders GLB 写实工程师 immediately with 0s wait and correct live badge', () => {
    render(
      <DigitalHumanAvatar
        isSpeaking={false}
        speechEnabled={true}
        onToggleSpeech={vi.fn()}
      />
    );

    // Header title and live badge
    expect(screen.getByText(/3D 数字人・本地渲染/)).toBeTruthy();
    expect(screen.getByText('本地 3D · LIVE')).toBeTruthy();

    // Default persona is 张工
    expect(screen.getByText('机械首席总工程师 · 张工')).toBeTruthy();

    // GLB 写实工程师组件立即渲染（不再有动漫 VRM）
    expect(screen.getByTestId('glb-component')).toBeTruthy();

    // Verify absence of VRM / fallback error alerts
    expect(screen.queryByText(/魔珐星云/)).toBeNull();
    expect(screen.queryByText(/已降级为本地渲染/)).toBeNull();
    expect(screen.queryByText(/正在建立 3D 渲染会话/)).toBeNull();
  });

  it('allows switching between 张工 / 李工 / 小智 personas smoothly', () => {
    render(
      <DigitalHumanAvatar
        isSpeaking={false}
        speechEnabled={true}
        onToggleSpeech={vi.fn()}
      />
    );

    // Initial persona is zhang
    expect(screen.getByTestId('glb-component').getAttribute('data-persona')).toBe('zhang');

    // Click 李工
    fireEvent.click(screen.getByRole('button', { name: /李工/ }));
    expect(screen.getByTestId('glb-component').getAttribute('data-persona')).toBe('li');
    expect(screen.getByText('电气自动化工程师 · 李工')).toBeTruthy();
    expect(localStorage.getItem('industrial_digital_human_persona')).toBe('li');

    // Click 小智
    fireEvent.click(screen.getByRole('button', { name: /小智/ }));
    expect(screen.getByTestId('glb-component').getAttribute('data-persona')).toBe('zhi');
    expect(screen.getByText('AI智能巡检专家 · 小智')).toBeTruthy();
    expect(localStorage.getItem('industrial_digital_human_persona')).toBe('zhi');
  });

  it('exposes imperative handle with is3D, speak, and stop', async () => {
    const ref = React.createRef<DigitalHumanAvatarHandle>();
    render(
      <DigitalHumanAvatar
        ref={ref}
        isSpeaking={false}
        speechEnabled={true}
        onToggleSpeech={vi.fn()}
      />
    );

    expect(ref.current).toBeTruthy();
    expect(ref.current?.is3D?.()).toBe(true);

    const spoke = await ref.current?.speak('设备轴承温度处于正常受控区间');
    expect(spoke).toBe(true);
    expect(mocks.glb.speak).toHaveBeenCalledWith('设备轴承温度处于正常受控区间');

    // Stop speaking
    ref.current?.stop?.();
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
  });

  it('degrades 写实 GLB → 自研 3D，逐级回退且不白屏', () => {
    render(
      <DigitalHumanAvatar
        isSpeaking={false}
        speechEnabled={true}
        onToggleSpeech={vi.fn()}
      />
    );

    // 一级：写实工程师 GLB
    expect(screen.getByTestId('glb-component')).toBeTruthy();
    expect(screen.queryByTestId('fallback-3d-component')).toBeNull();

    // 二级：GLB 加载失败 → 降级到自研程序化 3D，仍然不白屏
    fireEvent.click(screen.getByTestId('trigger-glb-error'));
    expect(screen.queryByTestId('glb-component')).toBeNull();
    expect(screen.getByTestId('fallback-3d-component')).toBeTruthy();
    expect(screen.getByText('自研3D数字人・本地渲染')).toBeTruthy();
  });

  it('stops speech playback when speechEnabled is toggled to false (mute)', () => {
    const { rerender } = render(
      <DigitalHumanAvatar
        isSpeaking={true}
        speechEnabled={true}
        onToggleSpeech={vi.fn()}
      />
    );

    // Mute speech
    rerender(
      <DigitalHumanAvatar
        isSpeaking={true}
        speechEnabled={false}
        onToggleSpeech={vi.fn()}
      />
    );

    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
  });

  /**
   * 第 2 项（数字人发声）的核心验收：
   * 点"播报"必须真的把文本送进语音后端，而不是只切换开关。
   */
  it('“播报”按钮把最近一次播报内容重新送进 3D 后端', async () => {
    const ref = React.createRef<DigitalHumanAvatarHandle>();
    render(
      <DigitalHumanAvatar
        ref={ref}
        isSpeaking={false}
        speechEnabled={true}
        onToggleSpeech={vi.fn()}
      />
    );

    await act(async () => {
      await ref.current?.speak('一级泵组出口压力偏低，请检查入口过滤器');
    });
    expect(mocks.glb.speak).toHaveBeenCalledTimes(1);

    const replay = screen.getByTestId('digital-human-replay');
    await act(async () => {
      fireEvent.click(replay);
      await Promise.resolve();
    });

    expect(mocks.glb.speak).toHaveBeenCalledTimes(2);
    expect(mocks.glb.speak.mock.calls[1][0]).toBe('一级泵组出口压力偏低，请检查入口过滤器');
  });

  it('静音时"播报"按钮禁用，避免无声却给用户"已播报"的错觉', () => {
    render(
      <DigitalHumanAvatar
        isSpeaking={false}
        speechEnabled={false}
        onToggleSpeech={vi.fn()}
      />
    );
    const replay = screen.getByTestId('digital-human-replay') as HTMLButtonElement;
    expect(replay.disabled).toBe(true);
    expect(screen.getByText('朗读关')).toBeTruthy();
  });

  /**
   * 两层 3D 后端全部失败时，必须落到 Web Speech 兜底 —— 这是"数字人无声"问题的根因防线。
   */
  it('两层 3D 后端全部失败时回退到 Web Speech 朗读', async () => {
    mocks.glb.fail = true;
    mocks.three.fail = true;

    const ref = React.createRef<DigitalHumanAvatarHandle>();
    render(
      <DigitalHumanAvatar
        ref={ref}
        isSpeaking={false}
        speechEnabled={true}
        onToggleSpeech={vi.fn()}
      />
    );

    let ok: any;
    await act(async () => {
      ok = await ref.current?.speak('螺杆空压机二级保养核心步骤');
    });

    // 兜底路径走通，并且真的调用了 speechSynthesis
    expect(ok).toBe(true);
    expect(spoken.join(' ')).toContain('螺杆空压机二级保养核心步骤');
  });

  /**
   * 关键回归：同一时刻只挂载一个 3D 后端，所以"当前后端 speak() 返回 false"
   * （例如浏览器没有可用中文音色）**绝不能就此静默结束**，
   * 必须继续落到 Web Speech 兜底。这正是用户反馈"点播报没声音"的根因防线。
   */
  it('当前 3D 后端返回 false 时继续降级到 Web Speech，而不是静默失败', async () => {
    mocks.glb.fail = true;

    const ref = React.createRef<DigitalHumanAvatarHandle>();
    render(
      <DigitalHumanAvatar
        ref={ref}
        isSpeaking={false}
        speechEnabled={true}
        onToggleSpeech={vi.fn()}
      />
    );

    let ok: any;
    await act(async () => {
      ok = await ref.current?.speak('检查冷却水路是否堵塞');
    });

    expect(mocks.glb.speak).toHaveBeenCalledWith('检查冷却水路是否堵塞');
    expect(ok).toBe(true);
    expect(spoken.join(' ')).toContain('检查冷却水路是否堵塞');
  });
});

/**
 * 程序化 3D 的**显式**入口（`?dh_backend=procedural`）。
 *
 * 历史：这里原先断言"默认就是程序化 3D"，理由写的是"国内比赛要可控的东亚面孔，
 * 而不是按骨骼估尺寸的写实 GLB"。该理由已被 `china_engineer.glb`（中国男性工程师
 * 生成模型）取代，默认值随后改为写实 GLB —— 见上方 `GLB Primary Render Path`。
 * 因此本块改为守住**显式指定程序化后端**这条仍然支持的路径（组件里的 dh_backend 分支），
 * 而不是继续断言一个已经不成立的默认值。
 *
 * ⚠️ 默认 GLB 依赖 `public/models/engineer/china_engineer.glb`，该文件当前**未被 git 跟踪**
 * ⇒ 全新 clone 会走 onError 降级回本块这条程序化路径（见 ATTRIBUTION.md 的"版本控制缺口"）。
 */
describe('DigitalHumanAvatar - 程序化 3D（显式 ?dh_backend=procedural）', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/?dh_backend=procedural');
    localStorage.clear();
    spoken = [];
    mocks.glb.speak.mockClear();
    mocks.three.speak.mockClear();
    mocks.glb.fail = false;
    mocks.three.fail = false;
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    Object.defineProperty(window, 'speechSynthesis', {
      writable: true,
      value: { speak: vi.fn(), cancel: vi.fn(), getVoices: vi.fn(() => []), addEventListener: vi.fn() },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('带 ?dh_backend=procedural 时挂载程序化 3D，GLB 不占位', () => {
    render(<DigitalHumanAvatar isSpeaking={false} speechEnabled onToggleSpeech={vi.fn()} />);
    expect(screen.getByTestId('fallback-3d-component')).toBeTruthy();
    expect(screen.queryByTestId('glb-component')).toBeNull();
    expect(screen.getByText('自研3D数字人・本地渲染')).toBeTruthy();
  });

  it('显式程序化后端的 speak 走程序化 3D，而不是 GLB', async () => {
    const ref = React.createRef<DigitalHumanAvatarHandle>();
    render(
      <DigitalHumanAvatar ref={ref} isSpeaking={false} speechEnabled onToggleSpeech={vi.fn()} />,
    );
    await act(async () => {
      await ref.current?.speak('轴承温度处于正常受控区间');
    });
    expect(mocks.three.speak).toHaveBeenCalledWith('轴承温度处于正常受控区间');
    expect(mocks.glb.speak).not.toHaveBeenCalled();
  });

  it('程序化后端下切形象只换 personaId，不换渲染后端', () => {
    render(<DigitalHumanAvatar isSpeaking={false} speechEnabled onToggleSpeech={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /李工/ }));
    expect(screen.getByTestId('fallback-3d-component').getAttribute('data-persona')).toBe('li');
  });
});
