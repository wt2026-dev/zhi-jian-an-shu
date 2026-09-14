import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface VirtualListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  estimateItemHeight?: number;
  maxHeight?: number;
  className?: string;
  emptyText?: string;
  loading?: boolean;
}

export function VirtualList<T>({
  items,
  renderItem,
  estimateItemHeight = 120,
  maxHeight = 600,
  className = '',
  emptyText = '暂无数据',
  loading = false,
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateItemHeight,
    overscan: 5,
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-slate-500 text-sm">
        <div className="animate-spin w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full mr-2" />
        加载中...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-slate-500 text-sm">
        {emptyText}
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <div
        ref={parentRef}
        className="overflow-auto"
        style={{ maxHeight }}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = items[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                className="absolute left-0 right-0"
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {renderItem(item, virtualRow.index)}
              </div>
            );
          })}
        </div>
      </div>

      {items.length > 10 && (
        <div className="absolute bottom-3 right-3 flex flex-col gap-1 z-20">
          <button
            onClick={() => virtualizer.scrollToIndex(0)}
            className="p-1 rounded bg-slate-800/90 text-slate-500 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer"
            title="滚动到顶部"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            onClick={() => virtualizer.scrollToIndex(items.length - 1)}
            className="p-1 rounded bg-slate-800/90 text-slate-500 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer"
            title="滚动到底部"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
