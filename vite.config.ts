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
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-charts': ['recharts'],
            'vendor-icons': ['lucide-react'],
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
