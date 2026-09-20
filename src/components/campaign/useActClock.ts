/**
 * 幕内计时：起点在挂载 effect 里记，读数只在事件回调里取。
 *
 * 为什么不在 `useRef(Date.now())` 里初始化：`Date.now()` 是纯渲染约束里点名的不纯调用，
 * react-hooks/purity 会告警，而且 StrictMode 双渲染会让起点被记成第二次的时间。
 */
import { useEffect, useRef } from 'react';

export function useActClock(): () => number {
  const startRef = useRef(0);
  useEffect(() => {
    startRef.current = Date.now();
  }, []);
  return () => Math.max(0, Math.round((Date.now() - (startRef.current || Date.now())) / 1000));
}
