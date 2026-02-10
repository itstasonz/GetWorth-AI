import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
            // Cache API calls (analyze endpoint) — network first, fall back to cache
            urlPattern: /\/api\/analyze/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 }, // 1 hour
              networkTimeoutSeconds: 30,
            },
          },
          {
            // Cache Supabase data requests — network first
            urlPattern: /xbwxbdxuklrbnkpgonjc\.supabase\.co/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 5 }, // 5 min
              networkTimeoutSeconds: 10,
            },
          },
          {
            // Cache listing images — cache first (images don't change)
            urlPattern: /\.(?:png|jpg|jpeg|webp|gif|svg)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }, // 30 days
            },
          },
          {
            // Cache Google Fonts
            urlPattern: /^https:\/\/fonts\.googleapis\.com/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }, // 1 year
            },
          },
        ],
        // Pre-cache the app shell
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Don't cache more than 50MB total
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Clean up old caches on update
        cleanupOutdatedCaches: true,
        // Skip waiting so new SW activates immediately
        skipWaiting: true,
        clientsClaim: true,
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
        manualChunks: {
          vendor: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
