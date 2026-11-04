import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Tailwind v3 runs through PostCSS (postcss.config.mjs). See DECISIONS #15.
export default defineConfig({
  plugins: [
    react(),
    // Installable, offline app shell (DECISIONS #23). The service worker caches
    // only the built app (HTML, JS, CSS, fonts, icons). Item data lives in
    // IndexedDB and is never cached or served by the service worker.
    VitePWA({
      // A new version waits until the user chooses to reload; never auto-reload
      // over something they might be typing.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Capture',
        short_name: 'Capture',
        description: 'Capture anything now, find it later. Works offline; your data stays in this browser.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f5f7fa',
        theme_color: '#1e2833',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{html,js,css,woff2,png,svg,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // No runtime caching: the app makes no network requests for data.
        runtimeCaching: [],
      },
    }),
  ],
});
