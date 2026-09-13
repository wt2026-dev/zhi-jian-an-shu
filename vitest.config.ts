import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30000,
    fileParallelism: false,
    // 显式排除：调试探针/临时脚本不计入用例数（scratch 已被 .gitignore 覆盖，双保险）
    exclude: [...configDefaults.exclude, "**/scratch/**", "**/build/**"],
  },
});
