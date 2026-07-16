import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // FRONTEND-006: build identity injected at build time — replaces the stale
  // hardcoded BUILD_VERSION constant that advertised a months-old version in
  // the update banner. No extra infrastructure: Vite's define + build clock.
  define: {
    __BUILD_TS__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z'),
  },
  plugins: [
    react(),
    VitePWA({
      // FRONTEND-006 (PWA-1): PROMPTED activation. 'autoUpdate' +
      // skipWaiting/clientsClaim made every deploy force-reload live sessions
      // (mid-scan, mid-checkout) via App.jsx's controllerchange listener, and
      // fired a spurious reload on FIRST install (clientsClaim triggers
      // controllerchange for brand-new visitors). With 'prompt' the new SW
      // installs and WAITS; the generated worker still listens for the
      // {type:'SKIP_WAITING'} message, so activation happens exactly when the
      // user approves the update banner (usePWAUpdate in App.jsx).
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'GetWorth – AI Marketplace',
        short_name: 'GetWorth',
        description: 'Snap any item, get instant AI valuation, and sell on Israel\'s smartest marketplace.',
        theme_color: '#060a14',
        background_color: '#060a14',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        dir: 'auto',
        lang: 'he',
        categories: ['shopping', 'lifestyle', 'utilities'],
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        screenshots: [
          {
            src: '/screenshot-wide.png',
            sizes: '1280x720',
            type: 'image/png',
            form_factor: 'wide',
            label: 'GetWorth AI Marketplace',
          },
          {
            src: '/screenshot-narrow.png',
            sizes: '390x844',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'GetWorth AI Scanner',
          },
        ],
      },
      workbox: {
        // Cache strategies
        runtimeCaching: [
          {
            // NetworkOnly: all Supabase traffic (REST /rest/v1/, auth /auth/v1/,
            // Edge Functions /functions/v1/, and storage).
            // Must come before the image rule so Supabase storage images also go
            // NetworkOnly — signed verification URLs must never be served from cache.
            urlPattern: /supabase\.co/,
            handler: 'NetworkOnly',
          },
          {
            // NetworkOnly: all Vercel serverless/edge API routes.
            // Results are request-specific and must never be served stale.
            urlPattern: /\/api\//,
            handler: 'NetworkOnly',
          },
          {
            // CacheFirst: images from non-Supabase origins (CDN, external).
            // Supabase storage images are excluded by the NetworkOnly rule above.
            urlPattern: /\.(?:png|jpg|jpeg|webp|gif|svg)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }, // 30 days
            },
          },
        ],
        // Navigate fallback — serve index.html for all non-API routes (SPA support offline)
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // Pre-cache the app shell
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Don't cache more than 50MB total
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Clean up old caches on update
        cleanupOutdatedCaches: true,
      },
      // Dev options — enable SW in dev for testing
      devOptions: {
        enabled: false, // Set to true to test PWA in dev
      },
    }),
  ],
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'vendor';
          if (id.includes('@supabase/supabase-js')) return 'supabase';
          if (id.includes('lucide-react')) return 'icons';
        },
      },
    },
  },
});
