import { useState, useEffect, useCallback } from 'react';

const CLEAN_MODE_STYLE_ID = 'equipment3d-clean-mode-host-style';

/**
 * 拆解工作台纯净模式 Hook：
 * 1. 负责管理 cleanMode 状态（默认 false）；
 * 2. 设备清空或退出拆解时自动重置为 false；
 * 3. 向宿主 body 挂载 host-clean-mode 类与样式，收起数字人浮球等全局外围浮层。
 */
export function useCleanMode(explodedDeviceId: string | null) {
  const [cleanMode, setCleanMode] = useState<boolean>(false);

  // 退出拆解视图或切换设备时，自动复位纯净模式
  useEffect(() => {
    if (!explodedDeviceId) {
      setCleanMode(false);
    }
  }, [explodedDeviceId]);

  // 宿主全局样式：隐藏数字人浮球等宿主常驻浮标
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!document.getElementById(CLEAN_MODE_STYLE_ID)) {
      const style = document.createElement('style');
      style.id = CLEAN_MODE_STYLE_ID;
      style.textContent = `
        body.host-clean-mode [data-onboarding="ai-ball"],
        body.host-clean-mode aside.fixed.z-\\[9999\\] {
          opacity: 0 !important;
          pointer-events: none !important;
          transition: opacity 0.25s ease-in-out !important;
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // 宿主 body 类名同步
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const body = document.body;
    if (cleanMode) {
      body.classList.add('host-clean-mode');
    } else {
      body.classList.remove('host-clean-mode');
    }
    return () => {
      body.classList.remove('host-clean-mode');
    };
  }, [cleanMode]);

  const toggleCleanMode = useCallback(() => {
    setCleanMode((v) => !v);
  }, []);

  return {
    cleanMode,
    setCleanMode,
    toggleCleanMode,
  };
}
