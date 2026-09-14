import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
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
