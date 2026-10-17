import React from 'react';

/**
 * 独立时钟：每秒只更新自身 DOM。
 *
 * 注意：这段代码原本**声明在 `CockpitDashboardView` 的组件体内**（不是模块顶层）。
 * 嵌套声明的函数组件每次父组件 re-render 都是**新的组件类型** ⇒ React 会卸载重建，
 * 与注释里"不触发整页 re-render"的意图相反。搬成模块顶层组件后身份稳定，
 * 输出 DOM 完全相同，只是不再每次重建。
 */

/** 独立时钟：每秒只更新自身 DOM，不触发 1600 行驾驶舱整页 re-render（性能修复） */
function LiveClock({ showTime = true, showDate = true }: { showTime?: boolean; showDate?: boolean }) {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      {showTime && <span>{now.toLocaleTimeString('zh-CN', { hour12: false })}</span>}
      {showDate && <span>{now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })}</span>}
    </>
  );
}

export { LiveClock };
