/**
 * Crossroads — Future Desert · bootstrap + UI glue
 * Menu flow, settings persistence, HUD bindings, game lifecycle.
 */
import { Input } from './input.js';
import { Network } from './network.js';
import { Game } from './game.js';
import * as audio from './audio.js';

// ---------------------------------------------------------------- DOM ------
const $ = (id) => document.getElementById(id);

const dom = {
  canvas: $('game-canvas'),
  stickZone: $('stick-zone'),
  stickBase: $('stick-base'),
  stickNub: $('stick-nub'),
  lookZone: $('look-zone'),
  btnFire: $('btn-fire'),
  btnAds: $('btn-ads'),
  btnJump: $('btn-jump'),
  btnReload: $('btn-reload'),
  btnNade: $('btn-nade'),
  weaponStrip: $('weapon-strip'),
};

const uiEls = {
  menu: $('screen-menu'),
  settings: $('screen-settings'),
  hud: $('hud'),
  touchUi: $('touch-ui'),
  inputName: $('input-name'),
  inputCode: $('input-code'),
  netStatus: $('net-status'),
  hudRoom: $('hud-room'),
  hudScore: $('hud-score'),
  hudPing: $('hud-ping'),
  killfeed: $('killfeed'),
  healthFill: $('health-fill'),
  healthNum: $('health-num'),
  weaponName: $('weapon-name'),
  ammoMag: $('ammo-mag'),
  ammoReserve: $('ammo-reserve'),
  weaponStrip: $('weapon-strip'),
  crosshair: $('crosshair'),
  scoreboard: $('scoreboard'),
  scoreRows: $('score-rows'),
  deathOverlay: $('death-overlay'),
  deathBy: $('death-by'),
  respawnCount: $('respawn-count'),
  endOverlay: $('end-overlay'),
  endTitle: $('end-title'),
  endDetail: $('end-detail'),
  toast: $('toast'),
  rotateHint: $('rotate-hint'),
};

// damage vignette (created at runtime)
const vignette = document.createElement('div');
vignette.id = 'damage-vignette';
Object.assign(vignette.style, {
  position: 'absolute', inset: '0', pointerEvents: 'none', opacity: '0',
  background: 'radial-gradient(ellipse at center, transparent 42%, rgba(255,20,50,0.55) 100%)',
  transition: 'opacity 0.32s ease', zIndex: '15',
});
uiEls.hud.appendChild(vignette);

// ------------------------------------------------------------- settings ----
const defaults = { sens: 1, vol: 0.7, invert: false, bloom: true, quality: 0.75 };
let settings = { ...defaults };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem('cxfd_settings') || '{}'));
} catch {
  /* corrupt storage — use defaults */
}

function saveSettings() {
  localStorage.setItem('cxfd_settings', JSON.stringify(settings));
}

// name persistence
const savedName = localStorage.getItem('cxfd_name');
uiEls.inputName.value = savedName || `Ranger${(Math.random() * 900 + 100) | 0}`;

function playerName() {
  return uiEls.inputName.value.trim().slice(0, 16) || 'DesertRat';
}

// ------------------------------------------------------------------ ui -----
const ui = {
  setRoom(text) {
    uiEls.hudRoom.textContent = text;
  },
  setScore(k, d) {
    uiEls.hudScore.textContent = `K ${k} / D ${d}`;
  },
  setPing(ms) {
    uiEls.hudPing.textContent = ms == null ? 'OFFLINE' : `${ms} ms`;
  },
  setHealth(hp, max) {
    const pct = Math.max(0, Math.min(1, hp / max));
    uiEls.healthFill.style.width = `${pct * 100}%`;
    uiEls.healthFill.classList.toggle('low', pct < 0.35);
    uiEls.healthNum.textContent = Math.round(hp);
  },
  setAmmo(mag, reserve, reloading = false) {
    uiEls.ammoMag.textContent = mag;
    uiEls.ammoReserve.textContent = reserve;
    uiEls.ammoMag.parentElement.classList.toggle('empty', mag === 0 && !reloading);
  },
  setWeapon(name, slot) {
    uiEls.weaponName.textContent = name;
    uiEls.weaponStrip.querySelectorAll('.wslot').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.slot) === slot);
    });
  },
  killFeed(killer, victim, weaponShort, head) {
    const item = document.createElement('div');
    item.className = 'kf-item';
    item.innerHTML = `<span class="k">${escapeHtml(killer)}</span><span class="w">${head ? '☠ HEADSHOT' : '✕'} ${escapeHtml(weaponShort)}</span><span class="v">${escapeHtml(victim)}</span>`;
    uiEls.killfeed.prepend(item);
    while (uiEls.killfeed.children.length > 6) uiEls.killfeed.lastChild.remove();
    setTimeout(() => item.remove(), 5200);
  },
  toast(msg) {
    uiEls.toast.textContent = msg;
    uiEls.toast.classList.remove('hidden');
    clearTimeout(ui._toastTimer);
    ui._toastTimer = setTimeout(() => uiEls.toast.classList.add('hidden'), 2600);
  },
  showDeath(byName) {
    uiEls.deathBy.textContent = `by ${byName}`;
    uiEls.deathOverlay.classList.remove('hidden');
  },
  hideDeath() {
    uiEls.deathOverlay.classList.add('hidden');
  },
  setRespawnCount(n) {
    uiEls.respawnCount.textContent = n;
  },
  showEnd(title, detail) {
    uiEls.endTitle.textContent = title;
    uiEls.endDetail.textContent = detail;
    uiEls.endOverlay.classList.remove('hidden');
  },
  hideEnd() {
    uiEls.endOverlay.classList.add('hidden');
  },
  scoreboard(rows) {
    uiEls.scoreRows.innerHTML = rows
      .sort((a, b) => b.k - a.k || a.d - b.d)
      .map(
        (r) =>
          `<tr style="${r.me ? 'color:#23e6ff;font-weight:700' : ''}"><td>${escapeHtml(r.name)}</td><td>${r.k}</td><td>${r.d}</td><td>${Math.max(0, Math.round(r.hp))}</td></tr>`
      )
      .join('');
  },
  setSpread(k) {
    uiEls.crosshair.style.transform = `translate(-50%, -50%) scale(${k})`;
  },
  setAds(on) {
    uiEls.crosshair.classList.toggle('ads', on);
  },
  damageFlash() {
    vignette.style.opacity = '1';
    clearTimeout(ui._dmgTimer);
    ui._dmgTimer = setTimeout(() => (vignette.style.opacity = '0'), 140);
  },
  setScoreboardVisible(v) {
    uiEls.scoreboard.classList.toggle('hidden', !v);
  },
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ------------------------------------------------------------- systems -----
const input = new Input(dom);
input.sensitivity = settings.sens;
input.invertY = settings.invert;

audio.initAudio();
audio.setVolume(settings.vol);

const network = new Network();

const game = new Game({
  canvas: dom.canvas,
  input,
  network,
  ui,
  settings: { quality: settings.quality, bloom: settings.bloom },
});
if (settings.bloom) game.setBloom(true);

// --------------------------------------------------------------- screens ---
function showMenu() {
  uiEls.menu.classList.add('active');
  uiEls.settings.classList.remove('active');
  uiEls.hud.classList.remove('active');
  uiEls.touchUi.classList.remove('active');
  uiEls.rotateHint.classList.remove('showing');
  ui.hideDeath();
  ui.hideEnd();
  ui.setScoreboardVisible(false);
  document.exitPointerLock?.();
}

function enterGameUi() {
  uiEls.menu.classList.remove('active');
  uiEls.settings.classList.remove('active');
  uiEls.hud.classList.add('active');
  if (input.isTouch) uiEls.touchUi.classList.add('active');
  input.mouseLookEnabled = true;
  updateRotateHint();
}

function leaveToMenu() {
  network.leaveRoom();
  game.stop();
  showMenu();
  audio.play('ui');
}

function updateRotateHint() {
  const portrait = window.innerHeight > window.innerWidth;
  const show = uiEls.hud.classList.contains('active') && portrait && input.isTouch;
  uiEls.rotateHint.classList.toggle('showing', show);
}
window.addEventListener('resize', updateRotateHint);
window.addEventListener('orientationchange', () => setTimeout(updateRotateHint, 250));

// ----------------------------------------------------------------- menu ----
function beginPractice() {
  audio.initAudio();
  audio.resume();
  audio.play('ui');
  localStorage.setItem('cxfd_name', playerName());
  enterGameUi();
  game.start('practice');
}

$('btn-practice').addEventListener('click', beginPractice);

function startOnline(method) {
  audio.initAudio();
  audio.resume();
  audio.play('ui');
  const name = playerName();
  localStorage.setItem('cxfd_name', name);
  ui.toast('CONNECTING…');
  if (method === 'create') network.createRoom(name);
  else if (method === 'quick') network.quickMatch(name);
  else {
    const code = uiEls.inputCode.value.toUpperCase().trim();
    if (code.length < 4) {
      ui.toast('ENTER A ROOM CODE');
      return;
    }
    network.joinRoom(code, name);
  }
}

$('btn-create').addEventListener('click', () => startOnline('create'));
$('btn-quick').addEventListener('click', () => startOnline('quick'));
$('btn-join').addEventListener('click', () => startOnline('join'));
uiEls.inputCode.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startOnline('join');
});
uiEls.inputName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') beginPractice();
});

$('btn-settings').addEventListener('click', () => {
  audio.play('ui');
  uiEls.menu.classList.remove('active');
  uiEls.settings.classList.add('active');
});
$('btn-settings-back').addEventListener('click', () => {
  audio.play('ui');
  uiEls.settings.classList.remove('active');
  uiEls.menu.classList.add('active');
});

$('btn-leave').addEventListener('click', leaveToMenu);
$('btn-end-menu').addEventListener('click', leaveToMenu);

// scoreboard toggle on score pill (touch friendly)
uiEls.hudScore.addEventListener('click', () => {
  const hidden = uiEls.scoreboard.classList.contains('hidden');
  ui.setScoreboardVisible(hidden);
});

// desktop escape exits to menu
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && uiEls.hud.classList.contains('active')) {
    leaveToMenu();
  }
  if (e.code === 'Tab' && uiEls.hud.classList.contains('active')) {
    ui.setScoreboardVisible(true);
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Tab') ui.setScoreboardVisible(false);
});

// -------------------------------------------------------------- settings ---
const setSens = $('set-sens');
const setVol = $('set-vol');
const setInvert = $('set-invert');
const setBloom = $('set-bloom');
const setQuality = $('set-quality');

setSens.value = settings.sens;
setVol.value = settings.vol;
setInvert.checked = settings.invert;
setBloom.checked = settings.bloom;
setQuality.value = String(settings.quality);
$('val-sens').textContent = Number(settings.sens).toFixed(1);
$('val-vol').textContent = Number(settings.vol).toFixed(2);

setSens.addEventListener('input', () => {
  settings.sens = Number(setSens.value);
  input.sensitivity = settings.sens;
  $('val-sens').textContent = settings.sens.toFixed(1);
  saveSettings();
});
setVol.addEventListener('input', () => {
  settings.vol = Number(setVol.value);
  audio.setVolume(settings.vol);
  $('val-vol').textContent = settings.vol.toFixed(2);
  saveSettings();
});
setInvert.addEventListener('change', () => {
  settings.invert = setInvert.checked;
  input.invertY = settings.invert;
  saveSettings();
});
setBloom.addEventListener('change', () => {
  settings.bloom = setBloom.checked;
  game.setBloom(settings.bloom);
  saveSettings();
});
setQuality.addEventListener('change', () => {
  settings.quality = Number(setQuality.value);
  game.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.quality >= 1 ? 2 : settings.quality >= 0.75 ? 1.5 : 1));
  game.resize();
  saveSettings();
});

// ---------------------------------------------------------------- network --
network.on('status', (msg) => {
  uiEls.netStatus.textContent = msg.connected ? '● SERVER ONLINE' : '● OFFLINE — PRACTICE OK';
  uiEls.netStatus.classList.toggle('ok', msg.connected);
  uiEls.netStatus.classList.toggle('bad', !msg.connected);
});

network.on('welcome', (msg) => {
  enterGameUi();
  game.start('online', msg);
  ui.toast(`JOINED ROOM ${msg.room.code}`);
  audio.play('ui');
});

network.on('error', (msg) => {
  ui.toast(msg.msg || 'COULD NOT JOIN ROOM');
  audio.play('empty');
});

network.connect();

// unlock audio on first interaction anywhere
window.addEventListener('pointerdown', () => {
  audio.initAudio();
  audio.resume();
}, { once: true });

// keep the canvas sharp on orientation change
window.addEventListener('resize', () => game.resize());
