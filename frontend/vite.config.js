import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // NEXT_PUBLIC_* kept so existing .env.local files from the Next.js app keep working.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  server: { port: 3001 },
  // maplibre-gl spawns its own worker file; pre-bundling breaks the worker URL in dev.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  preview: { port: 3001 },
  // maplibre-gl alone is ~1 MB minified; it is already isolated in the lazy MapView chunk.
  build: { chunkSizeWarningLimit: 1300 },
  worker: { format: 'es' },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/tests/setup.js',
    css: false,
  },
});
