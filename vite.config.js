import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const project = fileURLToPath(new URL('./tunesf-tournament-site-main/', import.meta.url));
const root = resolve(project, 'src');

export default defineConfig({
  root,
  publicDir: resolve(root, 'public'),
  appType: 'mpa',
  server: { host: '127.0.0.1', port: 8000, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  plugins: [{
    name: 'reload-classic-scripts',
    handleHotUpdate({ file, server }) {
      if (file.replaceAll('\\', '/').includes('/src/public/')) {
        server.ws.send({ type: 'full-reload' });
        return [];
      }
    },
  }],
  build: {
    outDir: resolve(project, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(readdirSync(root)
        .filter(file => file.endsWith('.html'))
        .map(file => [file.slice(0, -5), resolve(root, file)])),
    },
  },
});
