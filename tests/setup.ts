// 前端组件测试全局 setup
import "@testing-library/jest-dom/vitest";

if (typeof window !== "undefined") {
  if (typeof (window as any).ResizeObserver === "undefined") {
    (window as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (typeof (window as any).IntersectionObserver === "undefined") {
    (window as any).IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
  }
}

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
