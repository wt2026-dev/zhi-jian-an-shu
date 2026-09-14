import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import path from 'path';
import {defineConfig} from 'vite';
import fs from 'fs';

let version = '2.0.0';
try {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
  version = pkg.version || version;
} catch {}

export default defineConfig(({ mode }) => {
  const plugins: any[] = [react(), tailwindcss()];

  if (process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT) {
    plugins.push(
      sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        release: { name: `industrial-maintenance@${version}` },
        sourcemaps: {
          assets: './dist/**',
        },
      })
    );
  }

  return {
    plugins,
    build: {
      sourcemap: true,
      rollupOptions: {
        output: {
          // 说明：仅对首屏必需的依赖做 manualChunks（react 全家桶）。
          // recharts / echarts / lucide-react 的消费方（DashboardView、KnowledgeGraphView、
          // CockpitDashboardView、EquipmentHealthView 等）均通过 React.lazy 懒加载，
          // 交由 Rollup 按动态 import 自动分包，避免被 modulepreload 拉进首屏。
          // 注意：manualChunks 的 key 必须与 Rollup 解析到的一致，否则会产出空 chunk
          // （此前 'vendor-react' 因名称不匹配长期产出 0 字节空 chunk，react 实际被打进 index）。
          manualChunks(id) {
            if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/scheduler')) {
              return 'vendor-react';
            }
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
