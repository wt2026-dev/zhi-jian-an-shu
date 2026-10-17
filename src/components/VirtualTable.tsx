import React, { useRef, useState, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronUp, ChevronDown, Inbox } from 'lucide-react';

export interface VirtualTableColumn<T> {
  key: string;
  header: string;
  width?: number | string;
  sortable?: boolean;
  render?: (row: T, index: number) => React.ReactNode;
  className?: string;
}

interface VirtualTableProps<T> {
  data: T[];
  columns: VirtualTableColumn<T>[];
  rowHeight?: number;
  maxHeight?: number;
  onRowClick?: (row: T, index: number) => void;
  rowKey?: (row: T, index: number) => string | number;
  emptyText?: string;
  loading?: boolean;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (key: string) => void;
}

export function VirtualTable<T extends Record<string, any>>({
  data,
  columns,
  rowHeight = 48,
  maxHeight = 600,
  onRowClick,
  rowKey,
  emptyText = '暂无数据',
  loading = false,
  sortBy,
  sortDirection = 'asc',
  onSort,
}: VirtualTableProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });

  const getRowKey = useCallback(
    (row: T, index: number) => {
      if (rowKey) return rowKey(row, index);
      return (row.id as string | number) ?? index;
    },
    [rowKey]
  );

  const totalWidth = useMemo(() => {
    return columns.reduce((acc, col) => {
      if (typeof col.width === 'number') return acc + col.width;
      return acc;
    }, 0);
  }, [columns]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-slate-500 text-sm">
        <div className="animate-spin w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full mr-2" />
        加载中...
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-500">
        <Inbox className="w-10 h-10 text-slate-300 mb-2" />
        <p className="text-sm font-medium text-slate-600">{emptyText}</p>
        <p className="text-xs text-slate-400 mt-1">暂无匹配记录，请调整筛选条件</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Header */}
      <div className="flex bg-slate-900/80 border-b border-slate-700/60 sticky top-0 z-10">
        {columns.map((col) => (
          <div
            key={col.key}
            className={`px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider shrink-0 ${
              col.sortable ? 'cursor-pointer hover:text-cyan-400 select-none' : ''
            } ${col.className || ''}`}
            style={{ width: col.width || 'auto', minWidth: col.width ? undefined : 100 }}
            onClick={() => col.sortable && onSort?.(col.key)}
          >
            <span className="inline-flex items-center gap-1">
              {col.header}
              {col.sortable && sortBy === col.key && (
                sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
              )}
            </span>
          </div>
        ))}
      </div>

      {/* Scrollable body */}
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
            const row = data[virtualRow.index];
            return (
              <div
                key={getRowKey(row, virtualRow.index)}
                className={`absolute left-0 right-0 flex border-b border-slate-800/60 ${
                  onRowClick ? 'cursor-pointer hover:bg-slate-800/40' : ''
                }`}
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                onClick={() => onRowClick?.(row, virtualRow.index)}
              >
                {columns.map((col) => (
                  <div
                    key={col.key}
                    className={`px-3 py-2.5 text-xs text-slate-300 truncate flex items-center shrink-0 ${col.className || ''}`}
                    style={{ width: col.width || 'auto', minWidth: col.width ? undefined : 100 }}
                  >
                    {col.render ? col.render(row, virtualRow.index) : String(row[col.key] ?? '')}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Scroll to top/bottom buttons */}
      {data.length > 20 && (
        <div className="absolute bottom-3 right-3 flex flex-col gap-1 z-20">
          <button
            onClick={() => virtualizer.scrollToIndex(0)}
            className="p-1 rounded bg-slate-800/90 text-slate-500 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer"
            title="滚动到顶部"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            onClick={() => virtualizer.scrollToIndex(data.length - 1)}
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
