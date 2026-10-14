import { defineConfig } from 'vite';

/**
 * Cache-busting id. Runtime-loaded game files (PNG, JSON, audio) are NOT content-hashed
 * by Vite, so src/core/assets.ts appends `?v=<buildId>` and the hosts serve them with a
 * long cache lifetime. Each deploy therefore gets fresh URLs; repeat visits stay cached.
 */
const buildId = (
  process.env.VERCEL_GIT_COMMIT_SHA || // Vercel
  process.env.COMMIT_REF || //            Netlify
  process.env.CF_PAGES_COMMIT_SHA || //   Cloudflare Pages
  Date.now().toString(36)
).slice(0, 10);

export default defineConfig({
  // Relative base: the build works at a domain root, under a sub-path, or behind a proxy.
  base: './',

  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },

  build: {
    // Phaser is ES5/ES2015-style code; only our own TS needs lowering. ES2020 keeps
    // Safari 13.1+/Chrome 80+/Firefox 74+ working (Vite's default would drop iOS 15).
    target: 'es2020',
    // Hashed bundles go to /bundle so /assets and /data can hold un-hashed game content
    // with different cache rules (see public/_headers, vercel.json).
    assetsDir: 'bundle',
    assetsInlineLimit: 0,
    // Phaser alone is ~1.2 MB minified (~330 KB gzip); it lives in its own chunk so game
    // code changes don't invalidate the browser's cached copy of the engine.
    chunkSizeWarningLimit: 1300,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'phaser', test: /node_modules[\\/]phaser[\\/]/ }],
        },
      },
    },
  },

  // The game holds no secrets and is meant to be opened from phones through whatever URL
  // is handy (LAN IP, tunnel, hosting preview), so the Host-header allow-list is open.
  server: { port: 5173, allowedHosts: true },
  preview: { port: 4173, allowedHosts: true },
});
