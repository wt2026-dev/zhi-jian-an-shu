import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30000,
    fileParallelism: false,
    exclude: [...configDefaults.exclude, "**/scratch/**", "**/build/**"],
    // *.test.tsx 文件自动使用 jsdom 环境
    environmentMatchGlobs: [
      ["**/*.test.tsx", "jsdom"],
    ],
    setupFiles: ["./tests/setup.ts"],
  },
});
