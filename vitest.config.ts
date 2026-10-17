import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import os from "node:os";
import path from "node:path";

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
      // 上传/产物目录必须隔离到系统临时目录（与 vite 的 cacheDir 同一思路）。
      //
      // 为什么必须：`UPLOADS_DIR` 是 config.ts 在**模块加载期**读取的常量，测试不设它时
      // 会解析到仓库内的 `public/uploads`。而上传类用例（upload.test.ts 的 1×1 PNG、
      // upload-video-magic.test.ts 的 24B mp4 / 8B webm 魔数桩）会真的调 controller 落盘，
      // 于是每跑一次测试就往仓库里灌一批垃圾 —— 实测已累积 719 个（348×70B PNG、
      // 178×24B mp4、175×8B webm），且 `public/uploads` 正是被 express.static 托管的目录。
      //
      // 放 tmp 还有一个附带好处：路径严格位于 os.tmpdir() 之下时，沙箱的批量删除守卫
      // 会直接放行（tryRm 第一行 bypass），清理这些产物永远不需要二次确认。
      UPLOADS_DIR: path.join(os.tmpdir(), "wb-tests-uploads"),
    },
  },
});
