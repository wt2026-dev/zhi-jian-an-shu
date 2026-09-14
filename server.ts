// 重构说明：原 7329 行单文件 server.ts 已按业务域拆分至 src/server/ 目录
// （routes/ controllers/ services/ middleware/ schemas/ utils/，装配入口 src/server/index.ts）。
// 本文件仅保留为兼容入口：npm run dev / build 与 tests/*.test.ts 的引用路径不变。
export { createApp, startServer } from "./src/server/index.ts";
