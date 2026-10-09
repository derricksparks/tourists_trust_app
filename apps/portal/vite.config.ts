/// <reference types="vitest" />
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Compile the shared package from source so the browser gets ES modules.
    alias: { '@ttp/shared-types': fileURLToPath(new URL('../../packages/shared-types/src/index.ts', import.meta.url)) },
  },
  server: {
    port: 5174,
    // The dashboard calls /api/*; in development that is forwarded to the API server.
    proxy: { '/api': { target: API_URL, rewrite: (path) => path.replace(/^\/api/, '') } },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
  },
});
