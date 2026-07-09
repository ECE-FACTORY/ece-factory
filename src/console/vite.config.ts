import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('.', import.meta.url));
const API_PORT = Number(process.env.CONSOLE_API_PORT ?? 4319);

// Dev: Vite serves client/ and proxies /state/* + /healthz to server/serve.ts (the read plane).
// Build: static bundle → dist/, served by serve.ts in prod. Same-origin, localhost, no cloud.
export default defineConfig({
  root,
  plugins: [react()],
  server: {
    port: 4318,
    proxy: {
      '/state': `http://localhost:${API_PORT}`,
      '/healthz': `http://localhost:${API_PORT}`,
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
