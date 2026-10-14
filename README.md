# Racing-Action Game

A top-down, neon-noir street-racing and combat game that runs in the browser on phones and desktops, with nothing to install. Built with **Phaser 3 + TypeScript + Vite** and hosted as plain static files.

> **Status: milestone 1 of 9 (project setup).** The build shows a placeholder scene: a car sprite that reacts to touch. See [docs/MILESTONES.md](docs/MILESTONES.md) for the plan and for the rule that **each milestone must be confirmed on a real phone before the next one starts**. The design is in [docs/SPEC.md](docs/SPEC.md).

## Quick start

You need Node.js 20.19+ or 22.12+ (`.nvmrc` pins 22).

```bash
npm install
npm run dev        # dev server with live reload, http://localhost:5173 (also reachable on your LAN)
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/ locally, http://localhost:4173
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server, listening on all network interfaces so a phone can reach it |
| `npm run build` | `tsc` type-check, then the production build in `dist/` |
| `npm run preview` | Serves the production build (use this for phone testing, too) |
| `npm run typecheck` | Type-check only |
| `npm run art` | Re-draws `art/**/*.svg` into PNG sprites under `public/assets/` |
| `npm run test:mobile` | Phone-emulation smoke test of the production build (see below) |

## Try it on a phone

1. **Same Wi-Fi:** run `npm run dev` and open the `Network:` address Vite prints (for example `http://192.168.1.20:5173`) on the phone. If it won't load, check the computer's firewall and whether the Wi-Fi isolates devices (guest networks often do).
2. **Different network:** tunnel the server, for example `cloudflared tunnel --url http://localhost:5173` or `ngrok http 5173`, and open the address it prints.
3. **A deployed preview:** see [Hosting](#hosting). This is the closest thing to the real thing (HTTPS and the real cache headers).

An **on-screen diagnostics panel** (bottom-left) shows the renderer, canvas size, pixel ratio, touch points and fps. It is on by default while milestones are being checked. URL options:

| Option | Effect |
| --- | --- |
| `?debug=0` | hide the diagnostics panel |
| `?dpr=1.5` | override the render scale (default: the device pixel ratio, capped at 2). Useful for performance experiments |

The step-by-step phone checklist is in [docs/MILESTONES.md](docs/MILESTONES.md).

## Automated smoke test (emulation, not a real phone)

```bash
npm run build && npm run test:mobile
npm run test:mobile -- --only=iphone          # only scenarios whose name contains "iphone"
npm run test:mobile -- --url https://your.site/   # test an already-deployed build
```

The script serves `dist/` and drives headless Chromium as several phone and desktop profiles (iPhone, Pixel, Galaxy S9+ at a 4.5x pixel ratio, iPad, 1280x720 desktop). It checks that the game boots without errors, that the canvas matches the screen at the right resolution, that the car and text are actually drawn, that taps and two-finger touch arrive at the right coordinates, and that rotating re-fits the layout. It also checks three failure paths: a missing asset or a failed bundle download must show an on-screen error, and with WebGL unavailable the game must fall back to the Canvas renderer. Screenshots land in `test-results/mobile/` (git-ignored).

It needs a browser: set `CHROME_PATH` to a Chrome/Chromium binary, or run `npx playwright-core install chromium`. Extra launch flags can go in `CHROME_ARGS`.

This is Chromium *pretending* to be a phone, with software WebGL. It cannot tell you how the game behaves on iOS Safari, on real touch hardware, or how fast it runs. It supports the real-phone check and does not replace it.

## Hosting

The build is static files, so any static host works. `base` is relative, so it also works under a sub-path.

| Host | Setup |
| --- | --- |
| **Vercel** | Import the repo. `vercel.json` sets the build command, output directory and headers. |
| **Netlify** | Import the repo. `netlify.toml` sets build, publish directory and Node version. Headers come from `public/_headers`. |
| **Cloudflare Pages** | Build command `npm run build`, output directory `dist`, environment variable `NODE_VERSION=22`. Headers come from `public/_headers`. |

Caching: `/bundle/*` (content-hashed), `/assets/*` and `/data/*` (requested with `?v=<build id>`) are cached for a year as immutable, and the HTML page is always revalidated, so a new deploy is picked up immediately. These rules live in `public/_headers` (Cloudflare Pages and Netlify) and `vercel.json`, and they must be kept in sync.

## Project layout

```
index.html               HTML shell: splash + error screen, mobile meta tags
src/
  main.ts                Phaser game config and start-up
  globals.d.ts           types for window.__game / window.__bootFail
  core/
    assets.ts            assetUrl() / dataUrl(): cache-busted URLs for files in public/
    boot.ts              hooks to the splash / fatal-error screen
    debug.ts             the ?debug flag
    display.ts           device-pixel-ratio handling, keeps the canvas fitted
  scenes/
    PlaceholderScene.ts  the milestone 1 scene
public/
  assets/                runtime art (PNG sprites generated from art/)
  _headers               cache + security headers (Cloudflare Pages, Netlify)
art/                     SVG sources for sprites
scripts/                 build-art.mjs (SVG -> PNG), smoke-mobile.mjs
docs/                    SPEC.md, MILESTONES.md
vercel.json  netlify.toml
```

## Conventions

- **Data is external.** Missions, levels, waypoints, AI difficulty settings and rewards live as JSON in `public/data/` and are loaded with `dataUrl()`. They are never hardcoded in TypeScript.
- **Always build asset URLs with `assetUrl()` / `dataUrl()`** (`src/core/assets.ts`). They add the build id used for cache busting and respect the relative `base`.
- **Art:** edit the SVG in `art/`, run `npm run art`, and commit both the SVG and the generated PNG.
- **Car sprites face +X** (0 degrees = east), so a car's `rotation` is its heading.
- **World units are CSS pixels.** The canvas is rendered at the device pixel ratio (capped at 2) and the camera zoom compensates, so game code never deals with pixel ratios. See `src/core/display.ts`.
- **Phaser is pinned to 3.x.** A bare `npm install phaser` would fetch version 4, which is a different major version. Import it as `import * as Phaser from 'phaser'` (the ESM build has no default export).

### Phaser gotchas already hit

- Phaser 3 has no high-DPI support and `Scale.RESIZE` renders at pixel ratio 1, which looks blurry on phones. That is why the scale mode is `NONE`, with manual sizing and camera zoom.
- Create `Text` with `resolution: getRenderScale()` in its style. If the scale changes later, use `setTextResolution()`. Calling `setResolution()` alone draws the text at the wrong size on the Canvas fallback renderer.
- `setTint` only works with WebGL. Bake colours into the texture if the Canvas fallback has to look right.
- Audio is off (`noAudio`) until milestone 9.
