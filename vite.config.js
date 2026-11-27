import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  base: './',
  server: { proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false, ws: true } } },
  build: { rollupOptions: { output: { manualChunks(id) {
    if (!id.includes('/node_modules/')) return undefined;
    if (id.includes('/firebase/') || id.includes('/@firebase/')) return 'firebase';
    if (['/react/', '/react-dom/', '/scheduler/'].some((name) => id.includes(name))) return 'react';
    if (['/zod/', '/react-hook-form/', '/@hookform/'].some((name) => id.includes(name))) return 'forms';
    if (id.includes('/@tanstack/')) return 'query';
    return undefined;
  } } } },
  plugins: [react(), VitePWA({
    strategies: 'injectManifest', srcDir: 'src', filename: 'sw.js', registerType: 'autoUpdate', injectRegister: null,
    includeAssets: ['logo.webp', 'tuktuk.webp', 'icons/*.webp'],
    manifest: {
      id: './', name: 'Teer | خدمات ذكية', short_name: 'Teer', description: 'خدمات توصيل ذكية لباب بيتك',
      lang: 'ar', dir: 'rtl', start_url: './', scope: './', display: 'standalone', orientation: 'portrait', background_color: '#f8fafc', theme_color: '#8b5cf6', categories: ['shopping', 'food', 'utilities'],
      icons: [
        { src: './icons/logo-192.webp', sizes: '192x192', type: 'image/webp', purpose: 'any' },
        { src: './icons/logo-512.webp', sizes: '512x512', type: 'image/webp', purpose: 'any' },
        { src: './icons/maskable-192.webp', sizes: '192x192', type: 'image/webp', purpose: 'maskable' },
        { src: './icons/maskable-512.webp', sizes: '512x512', type: 'image/webp', purpose: 'maskable' },
      ],
      shortcuts: [{ name: 'طلباتي', short_name: 'طلباتي', url: './#orders', icons: [{ src: './icons/logo-192.webp', sizes: '192x192', type: 'image/webp' }] }],
    },
    injectManifest: { globPatterns: ['**/*.{js,css,html,webp,svg,ico,woff,woff2}'] },
  })],
});
