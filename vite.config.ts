import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      '__APP_VERSION__': JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        // ws is a Node.js package pulled in by @supabase/realtime-js.
        // Replace with a browser stub so Rollup never tries to bundle Node internals.
        'ws': path.resolve(__dirname, 'src/lib/ws-stub.ts'),
      },
    },
    optimizeDeps: {
      // Prevent Vite's dep pre-bundler from scanning ws and Node-only transitive deps.
      exclude: [
        'ws',
        '@supabase/realtime-js',
      ],
    },
    test: {
      globals: true,
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        ignored: ['**/.followup-state.json', '**/.tokens.json'],
      },
    },
  };
});
