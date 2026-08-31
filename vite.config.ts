import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import path from 'path';
import manifest from './src/manifest.json';

const CRX_PORT = 7178;

export default defineConfig(({ mode }) => {
  process.env.PORT = String(CRX_PORT);

  const baseCsp = manifest.content_security_policy.extension_pages;
  const devCsp =
    mode === 'development'
      ? `${baseCsp} ws://localhost:${CRX_PORT} http://localhost:${CRX_PORT}`
      : baseCsp;

  return {
    plugins: [
      react({ jsxRuntime: 'automatic' }),
      crx({
        manifest: {
          ...manifest,
          content_security_policy: { extension_pages: devCsp },
        },
      }),
    ],
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    server: {
      port: CRX_PORT,
      strictPort: true,
      hmr: { protocol: 'ws', host: 'localhost', port: CRX_PORT },
    },
    build: {
      rollupOptions: {
        input: {
          sidepanel: path.resolve(__dirname, 'src/sidepanel/index.html'),
          offscreen: path.resolve(__dirname, 'src/offscreen/index.html'),
        },
      },
    },
  };
});
