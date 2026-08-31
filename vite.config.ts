import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Windows editors/tooling may briefly truncate a file while rewriting it.
    // Wait for a stable write before caching its transformed module.
    watch: { awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 } },
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
  build: { outDir: 'dist/client', emptyOutDir: true },
});
