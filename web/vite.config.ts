import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev the Vite server proxies /api to the Fastify server, so the browser sees ONE origin.
// That is what lets the httpOnly session cookie and EventSource work without any CORS setup.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } } },
  build: { outDir: 'dist', sourcemap: false },
});
