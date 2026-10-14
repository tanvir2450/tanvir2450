/**
 * Diagnostics overlay + `window.__game` test hook.
 *
 * ON by default while each milestone is verified on real phones: the overlay shows what the
 * device actually gives us (renderer, resolution, touch points, fps, build id). Add `?debug=0`
 * to the URL to hide it. Flip DEBUG_BY_DEFAULT to false once the game is ready to ship.
 */
const DEBUG_BY_DEFAULT = true;

const param = new URLSearchParams(window.location.search).get('debug');

export const debugEnabled: boolean =
  param === null ? DEBUG_BY_DEFAULT : !['0', 'false', 'off'].includes(param.toLowerCase());
