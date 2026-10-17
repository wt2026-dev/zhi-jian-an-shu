// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { Markdown } from '../../src/components/ai/Markdown';

describe('Markdown tone prop tests', () => {
  it('defaults to dark tone with text-slate-300', () => {
    const { container } = render(<Markdown content="Hello industrial world" />);
    const p = container.querySelector('p');
    expect(p).toBeTruthy();
    expect(p?.className).toContain('text-slate-300');
  });

  it('renders light tone with text-slate-700 for paragraph and text-slate-900 for bold', () => {
    const { container } = render(<Markdown content="**注意**：轴承温度过高" tone="light" />);
    const p = container.querySelector('p');
    expect(p).toBeTruthy();
    expect(p?.className).toContain('text-slate-700');

    const strong = screen.getByText('注意');
    expect(strong.className).toContain('text-slate-900');
  });

  it('renders light tone table with text-slate-700 and header with text-slate-800', () => {
    const tableMd = `| 参数 | 阈值 |\n|---|---|\n| 温度 | 85℃ |`;
    const { container } = render(<Markdown content={tableMd} tone="light" />);
    const th = container.querySelector('th');
    expect(th).toBeTruthy();
    expect(th?.className).toContain('text-slate-800');

    const td = container.querySelector('td');
    expect(td).toBeTruthy();
    expect(td?.className).toContain('text-slate-700');
  });

  it('preserves dark code block even in light tone for contrast', () => {
    const codeMd = "```bash\necho test\n```";
    const { container } = render(<Markdown content={codeMd} tone="light" />);
    const pre = container.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre?.className).toContain('bg-slate-900');
    const code = pre?.querySelector('code');
    expect(code?.className).toContain('text-emerald-200');
  });
});
