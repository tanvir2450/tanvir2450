/** Hooks between the running game and the HTML splash / error screen in index.html. */

/** Call once the first scene is fully loaded and drawn: hides the splash screen. */
export function markReady(): void {
  const game = document.getElementById('game');
  if (game) game.dataset.state = 'ready';

  const boot = document.getElementById('boot');
  if (boot) {
    boot.classList.add('done');
    window.setTimeout(() => boot.remove(), 400);
  }
}

/** Show an unrecoverable problem on screen (phones have no console to look at). */
export function showFatalError(message: string): void {
  console.error(message);
  const game = document.getElementById('game');
  if (game) game.dataset.state = 'error';
  window.__bootFail?.(message);
}
