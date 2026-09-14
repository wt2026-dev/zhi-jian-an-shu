import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // 后端 API 用例保持 node；*.test.tsx 通过文件头 `// @vitest-environment jsdom` 启用 DOM。
    // 全局不可改为 jsdom，否则 PGlite/Express 套件会被浏览器全局污染。
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: true,
    maxWorkers: 6,
    pool: "forks",
    exclude: [...configDefaults.exclude, "**/scratch/**", "**/build/**", "**/archive/**"],
    setupFiles: ["./tests/setup.ts"],
    // 离线确定性：测试进程内将外部服务凭据置空（dotenv 不覆盖已存在变量，
    // 故 AI/视频/数字人路径统一走"无 Key 优雅降级"，无网/无 Key 环境全量稳定全绿）。
    // 注意：JWT_SECRET 不在此列（应用 fail-fast 需要它，由 .env 或 CI secrets 提供）。
    env: {
      DASHSCOPE_API_KEY: "",
      AGNES_API_KEY: "",
      XINGYUN_APP_ID: "",
      XINGYUN_APP_SECRET: "",
    },
  },
});
