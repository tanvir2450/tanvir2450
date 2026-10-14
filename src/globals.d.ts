/** Hooks shared between index.html, the game, and the mobile smoke test. */
interface Window {
  /** Set by the inline script in index.html: shows a message on the splash screen. */
  __bootFail?: (message: string) => void;
  /** Exposed only when the diagnostics flag is on (see src/core/debug.ts). Used by scripts/smoke-mobile.mjs. */
  __game?: import('phaser').Game;
}
