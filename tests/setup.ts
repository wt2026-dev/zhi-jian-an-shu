// 前端组件测试全局 setup
import "@testing-library/jest-dom/vitest";

// Mock wx (WeChat mini-program API) for tests that might import miniprogram utils
if (typeof globalThis.wx === "undefined") {
  (globalThis as any).wx = {
    showToast: () => {},
    showLoading: () => {},
    hideLoading: () => {},
    showModal: () => {},
    navigateTo: () => {},
    navigateBack: () => {},
    reLaunch: () => {},
    getStorageSync: () => "",
    setStorageSync: () => {},
    removeStorageSync: () => {},
  };
}
