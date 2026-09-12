import React from 'react';

/** 骨架屏原语：shimmer 块 */
export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-700/50 rounded-xl ${className}`} />;
}

/** KPI 卡骨架 */
export function SkeletonKpis({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 sm:gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-slate-800/80 border border-slate-700/70 rounded-xl p-4">
          <SkeletonBlock className="h-3 w-16 mb-3" />
          <SkeletonBlock className="h-8 w-20" />
          <SkeletonBlock className="h-2.5 w-full mt-3" />
        </div>
      ))}
    </div>
  );
}

/** 列表卡片骨架 */
export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-3 bg-slate-900/70 border border-slate-700/80 rounded-xl flex items-center gap-3">
          <SkeletonBlock className="w-10 h-10 rounded-lg shrink-0" />
          <div className="flex-1 space-y-2">
            <SkeletonBlock className="h-3.5 w-3/4" />
            <SkeletonBlock className="h-3 w-1/2" />
          </div>
          <SkeletonBlock className="w-16 h-6 shrink-0" />
        </div>
      ))}
    </div>
  );
}
