// @vitest-environment jsdom
/**
 * 俯视迷宫的「安全上下文」前置闸门（双向断言）。
 *
 * 背景（2026-10-17 实测）：`public/godot-maze/index.js` 的 `Engine.getMissingFeatures`
 * **无条件**校验 `window.isSecureContext`（与导出预设的 threads=false 无关），
 * 浏览器只把 https:// 与 http://localhost|127.0.0.1 算作安全上下文。
 * 于是 http://<裸IP>:3000 直连部署时引擎整个拒绝启动，页面只剩英文红框
 * "Secure Context - Check web server configuration (use HTTPS)"。
 *
 * 本用例钉住两件事：
 *   ① 不满足时不再挂 iframe，改给中文可执行口径（HTTPS / localhost / 浏览器 flag）；
 *   ② 满足时 iframe 必须照常挂载 —— 防止闸门把能玩的环境也一起拦死。
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../../src/context/AppDataContext', () => ({
  useAppData: () => ({ equipments: [{ id: 'eq-1' }] }),
}));
vi.mock('../../src/components/game/gameData', () => ({
  fetchProcedures: () => Promise.resolve([]),
}));
vi.mock('../../src/components/game/mazeLevels', () => ({
  buildMazePayload: () => ({ type: 'maze-game', version: 1, devices: [], levels: [] }),
}));

import { MazeGameView } from '../../src/components/game/MazeGameView';

function setSecureContext(value: boolean) {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value });
}

describe('MazeGameView 安全上下文闸门', () => {
  const original = window.isSecureContext;

  beforeEach(() => {
    setSecureContext(true);
  });
  afterEach(() => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: original });
  });

  it('非安全上下文：不挂 Godot iframe，给出中文处置口径', async () => {
    setSecureContext(false);
    const { container } = render(<MazeGameView currentUser={{ name: '陈建平' }} />);

    expect(await screen.findByText(/需要「安全上下文」/)).toBeInTheDocument();
    expect(container.querySelector('iframe')).toBeNull();
    // 三条出路都要在文案里，缺一条就等于把问题推回给用户
    expect(container.textContent).toContain('gen-self-signed-cert.mjs');
    expect(container.textContent).toContain('http://localhost:3000');
    expect(container.textContent).toContain('unsafely-treat-insecure-origin-as-secure');
    // 明确这不是数据问题（台账/规程红线：不许把环境问题说成没数据）
    expect(container.textContent).toContain('与关卡数据、台账无关');
  });

  it('安全上下文：iframe 照常挂载，不出现闸门文案', async () => {
    setSecureContext(true);
    const { container } = render(<MazeGameView currentUser={{ name: '陈建平' }} />);

    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    const frame = container.querySelector('iframe')!;
    expect(frame.getAttribute('src')).toBe('/godot-maze/index.html');
    expect(screen.queryByText(/需要「安全上下文」/)).toBeNull();
  });
});
