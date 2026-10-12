import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';

/** O app da equipe (/func/) tem manifest e service worker próprios: remove o manifest do app principal da página dele. */
const funcOwnManifest = (): Plugin => ({
  name: 'func-own-manifest',
  enforce: 'post',
  transformIndexHtml: { order: 'post', handler: (html, ctx) => (ctx.path.startsWith('/func/') ? html.replace(/<link rel="manifest" href="\/manifest\.webmanifest"[^>]*>/g, '') : html) },
  generateBundle(_o, bundle) {
    const f = bundle['func/index.html'];
    if (f && f.type === 'asset' && typeof f.source === 'string') f.source = f.source.replace(/<link rel="manifest" href="\/manifest\.webmanifest"[^>]*>/g, '');
  },
});

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'EscalaBus – Escalas de fim de semana',
        short_name: 'EscalaBus',
        description: 'Escalas de motoristas e cobradores aos sábados e domingos',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#ffffff',
        theme_color: '#1f3a5f',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Pré-carrega a "casca" do aplicativo; a API nunca é armazenada pelo service worker
        // (a cópia offline dos dados é feita pelo próprio app, por usuário/modo, e apagada ao sair).
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        globIgnores: ['manual/**', 'func/**'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/manual\//, /^\/func/],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
    funcOwnManifest(),
  ],
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: {
    outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1500,
    // dois apps: painel administrativo (/) e app da equipe (/func/)
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), func: resolve(__dirname, 'func/index.html') } },
  },
});
