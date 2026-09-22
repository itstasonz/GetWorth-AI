import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import devApi from './scripts/vite-dev-api.mjs';

// ── OPTIONAL DEV HTTPS ──────────────────────────────────────────────────────
//
// The in-app camera viewfinder uses getUserMedia, which browsers gate on a
// SECURE CONTEXT. localhost counts; http://192.168.x.x does not — so a phone
// opening the dev server over the LAN cannot use the live viewfinder, only the
// upload button (which opens the phone's own camera app and needs no HTTPS).
//
// Installing @vitejs/plugin-basic-ssl turns the viewfinder on:
//
//   npm i -D @vitejs/plugin-basic-ssl
//
// Loaded through a try/catch on purpose: a missing OPTIONAL dev dependency
// must not stop `npm run dev` from starting for everyone who does not need it,
// and a hard import would make it mandatory in package.json for a feature that
// is not. The phone will warn about the self-signed certificate once; accepting
// it makes the origin secure and the viewfinder works.
let devHttps;
try {
  const { default: basicSsl } = await import('@vitejs/plugin-basic-ssl');
  devHttps = basicSsl();
} catch {
  devHttps = null;
}

export default defineConfig({
  // ── LOCAL DEVELOPMENT ONLY ────────────────────────────────────────────────
  //
  // `server` and `preview` are read by `vite dev` / `vite preview` and are not
  // part of a build, so nothing here reaches a deployed bundle.
  //
  // host: true binds 0.0.0.0 instead of localhost, which is what lets a phone
  // on the same Wi-Fi open the app at all. It is a development affordance with
  // a real consequence — the dev server becomes reachable by anything on the
  // network — so it is worth knowing it is on rather than inheriting it.
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 4173,
  },
  // FRONTEND-006: build identity injected at build time — replaces the stale
  // hardcoded BUILD_VERSION constant that advertised a months-old version in
  // the update banner. No extra infrastructure: Vite's define + build clock.
  define: {
    __BUILD_TS__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z'),
    // ── WHICH COMMIT IS THIS? ────────────────────────────────────────────────
    //
    // A timestamp says a build happened; it does not say WHICH build an
    // installed PWA is running. That question has a real answer only once the
    // commit travels with the bundle — and it is the question that matters
    // after a service worker has cached an older one.
    //
    // `VERCEL_GIT_COMMIT_SHA` is injected by Vercel during a deployment build.
    // Locally it is absent, so this falls back to whatever git says, and to
    // 'local' outside a checkout. Seven characters: enough to match against
    // `git log`, short enough to read off a phone screen.
    //
    // A COMMIT SHA IS NOT A SECRET — it is already public in the repository and
    // in Vercel's own deployment metadata. Nothing else from the build
    // environment is exposed here, and nothing may be: `define` writes
    // literally into the client bundle, which is why PWA-1b asserts this block
    // never mentions a provider key.
    __BUILD_SHA__: JSON.stringify(
      (process.env.VERCEL_GIT_COMMIT_SHA || (() => {
        try {
          // eslint-disable-next-line global-require
          return require('node:child_process')
            .execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
            .toString().trim();
        } catch { return 'local'; }
      })()).slice(0, 7),
    ),
  },
  plugins: [
    react(),
    // apply: 'serve' inside the plugin — `vite build` never invokes it, and no
    // module under src/ imports it, so it is absent from the client graph.
    devApi(),
    // null is filtered out below; present only when the optional dev
    // dependency is installed, and never during a build.
    ...(devHttps ? [devHttps] : []),
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
