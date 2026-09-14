// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { VirtualList } from '../../src/components/VirtualList';

// Mock @tanstack/react-virtual to avoid real DOM measurement
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize, overscan }: any) => ({
    getTotalSize: () => count * estimateSize(),
    getVirtualItems: () => {
      const items: Array<{ index: number; key: string; size: number; start: number }> = [];
      const limit = Math.min(count, 10); // simulate rendering only a window
      for (let i = 0; i < limit; i++) {
        items.push({
          index: i,
          key: `v-${i}`,
          size: estimateSize(),
          start: i * estimateSize(),
        });
      }
      return items;
    },
    scrollToIndex: vi.fn(),
  }),
}));

describe('VirtualList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders items', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ id: i, name: `Item ${i}` }));
    render(
      <VirtualList
        items={items}
        renderItem={(item) => <div>{item.name}</div>}
        estimateItemHeight={50}
        maxHeight={300}
      />
    );
    // Our mock renders 10 visible items out of 30
    const rendered = screen.getAllByText(/Item \d+/);
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThanOrEqual(10);
  });

  it('shows empty text when items is empty', () => {
    render(
      <VirtualList
        items={[]}
        renderItem={() => <div />}
        emptyText="暂无检修记录"
      />
    );
    expect(screen.getByText('暂无检修记录')).toBeTruthy();
  });

  it('shows custom empty text', () => {
    render(
      <VirtualList
        items={[]}
        renderItem={() => <div />}
        emptyText="没有符合条件的工单"
      />
    );
    expect(screen.getByText('没有符合条件的工单')).toBeTruthy();
  });

  it('shows loading state', () => {
    render(
      <VirtualList
        items={[]}
        renderItem={() => <div />}
        loading={true}
      />
    );
    expect(screen.getByText('加载中...')).toBeTruthy();
  });

  it('scroll-to-top and scroll-to-bottom buttons appear when > 10 items', () => {
    const items = Array.from({ length: 15 }, (_, i) => ({ id: i, name: `Item ${i}` }));
    render(
      <VirtualList
        items={items}
        renderItem={(item) => <div>{item.name}</div>}
        estimateItemHeight={50}
        maxHeight={200}
      />
    );
    expect(screen.getByTitle('滚动到顶部')).toBeTruthy();
    expect(screen.getByTitle('滚动到底部')).toBeTruthy();
  });
});
