import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30000,
    fileParallelism: false,
    exclude: [...configDefaults.exclude, "**/scratch/**", "**/build/**", "**/archive/**"],
    setupFiles: ["./tests/setup.ts"],
  },
});
