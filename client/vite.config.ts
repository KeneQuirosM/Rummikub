import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const serverPort = process.env.SERVER_PORT ?? '3001';

// Identificador único de cada compilación (para el service worker y la recarga tras un despliegue)
const buildId = process.env.BUILD_ID ?? Date.now().toString(36);
// Versión visible en el menú (package.json del cliente) y fecha de compilación
const appVersion = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;
const buildDate = new Date().toISOString().slice(0, 10);

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/socket.io': { target: `http://localhost:${serverPort}`, ws: true, changeOrigin: true },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/socket.io': { target: `http://localhost:${serverPort}`, ws: true, changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          gsap: ['gsap'],
        },
      },
    },
  },
});
