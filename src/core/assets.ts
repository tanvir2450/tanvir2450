/**
 * URL helpers for game files that Vite does NOT content-hash: PNG sprites, audio and JSON
 * data in `public/assets` and `public/data`.
 *
 * Always build those URLs through these helpers. They append the build id, so every deploy
 * gets fresh URLs while the hosts cache the files for a year (see public/_headers), and they
 * respect Vite's relative `base`, so the game also works under a sub-path.
 */
const base = import.meta.env.BASE_URL;

const versioned = (url: string): string => `${url}?v=${__BUILD_ID__}`;

/** Art and audio, e.g. `assetUrl('cars/starter.png')`. */
export const assetUrl = (path: string): string => versioned(`${base}assets/${path}`);

/** Mission / level / balance data (JSON), e.g. `dataUrl('missions/docks.json')`. */
export const dataUrl = (path: string): string => versioned(`${base}data/${path}`);
