import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // Публикуется на GitHub Pages в подпапку репозитория; имя подпапки можно
  // переопределить env-переменной VITE_BASE (см. .github/workflows/pages.yml).
  base: process.env.VITE_BASE ?? '/cats-in-forest/',
  plugins: [react()],
  resolve: {
    alias: {
      // Vite жуёт TS-исходники общего пакета напрямую (без сборки shared).
      '@sf/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    minify: 'esbuild',
  },
  optimizeDeps: {
    esbuildOptions: { target: 'es2022' },
  },
});