/* =========================================================================
   ONE PIECE FIGHT — game.js
   Main controller: canvas & view scaling, game loop, save data, screens.
   ========================================================================= */
(function (global) {
  'use strict';
  const OPF = global.OPF;
  const CFG = OPF.CONFIG;
  const $ = (id) => document.getElementById(id);
  const SAVE_KEY = 'opf_save_v1';

  const defaultSave = () => ({
    coins: 250,
    bag: { health_potion: 2, mana_potion: 1, attack_tonic: 0, iron_draught: 0, revive_scroll: 0 },
    upgrades: OPF.CHARACTERS.reduce((o, c) => { o[c.id] = { vitality: 0, power: 0, spirit: 0 }; return o; }, {}),
    progress: {},         // "arc:level" -> { coins, xp, best }
    xp: 0,
    seen: {},
    settings: { sound: true, music: true },
    stats: { kills: 0, bestCombo: 0 },
  });

  class Game {
    constructor() {
      this.canvas = $('game-canvas');
      this.ctx = this.canvas.getContext('2d');
      this.view = { w: 960, h: CFG.VIEW_H };
      this.world = null;
      this.paused = false;
      this.screen = 'main-menu';
      this.selectedChar = 'luffy';
      this.accum = 0;
      this.last = 0;
      this.fpsSmooth = 60;
      this.load();
      this.resize();
      window.addEventListener('resize', () => this.resize());
      window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
      this.ui = new OPF.UI(this);
      this.ui.setSpecialButtons(this.selectedChar, 1);
      $('hud').style.display = 'none';
      OPF.Audio.init = OPF.Audio.init;    // (audio unlocks on first touch)
      this.loop = this.loop.bind(this);
      requestAnimationFrame((t) => { this.last = t; this.loop(t); });
      // first gesture unlocks audio
      const unlock = () => { OPF.Audio.init(); window.removeEventListener('pointerdown', unlock); };
      window.addEventListener('pointerdown', unlock);
      this.loadingDone();
    }

    loadingDone() {
      const fill = $('loading-fill');
      let p = 0;
      const tick = setInterval(() => {
        p += 20;
        if (fill) fill.style.width = Math.min(100, p) + '%';
        if (p >= 100) {
          clearInterval(tick);
          setTimeout(() => $('loading-screen').classList.add('hidden'), 220);
        }
      }, 90);
    }

    /* --------------------------------------------------------- view ---- */
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth, h = window.innerHeight;
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';

      const CW = this.canvas.width, CH = this.canvas.height;
      // Start from "540 units of world fit vertically", then clamp so that a
      // sensible amount of the arena is always visible in both orientations.
      let scale = CH / CFG.VIEW_H;
      scale = Math.min(scale, CW / CFG.MIN_VIEW_W);   // never narrower than MIN_VIEW_W units
      scale = Math.max(scale, CW / CFG.MAX_VIEW_W);   // never wider than MAX_VIEW_W units
      scale = Math.min(scale, CH / (CFG.VIEW_H * 0.86)); // keep the floor on screen
      this.scale = scale;
      this.view.h = CH / scale;
      this.view.w = CW / scale;
      // portrait phones show a tall slice: push the floor towards the bottom
      this.view.yOffset = Math.max(0, (this.view.h - CFG.VIEW_H) * 0.74);
    }

    /* --------------------------------------------------------- save ---- */
    load() {
      let data = null;
      try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { data = null; }
      const base = defaultSave();
      this.save = data ? Object.assign(base, data) : base;
      this.save.bag = Object.assign(base.bag, (data && data.bag) || {});
      this.save.upgrades = Object.assign(base.upgrades, (data && data.upgrades) || {});
      OPF.CHARACTERS.forEach(c => { this.save.upgrades[c.id] = Object.assign({ vitality: 0, power: 0, spirit: 0 }, this.save.upgrades[c.id]); });
      this.save.progress = (data && data.progress) || {};
      this.save.seen = (data && data.seen) || {};
      this.save.settings = Object.assign(base.settings, (data && data.settings) || {});
    }
    persist() {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch (e) { }
    }

    /* ----------------------------------------------------- progress ---- */
    levelKey(a, l) { return a + ':' + l; }
    levelCleared(a, l) { return !!(this.save.progress[this.levelKey(a, l)]); }
    levelUnlocked(a, l) {
      if (!this.arcUnlocked(a)) return false;
      if (l === 1) return true;
      if (l === 11) return this.levelCleared(a, 10);
      if (l === 21) return this.levelCleared(a, 20);
      return this.levelCleared(a, l - 1);
    }
    arcUnlocked(a) {
      if (a === 0) return true;
      return this.levelCleared(a - 1, 30);
    }
    arcClearedCount(a) {
      let n = 0;
      for (let l = 1; l <= 30; l++) if (this.levelCleared(a, l)) n++;
      return n;
    }

    /* ------------------------------------------------------- economy --- */
    buyUpgrade(charId, trackId) {
      const up = this.save.upgrades[charId];
      const cur = up[trackId];
      if (cur >= 10) return false;
      const cost = OPF.upgradeCost(charId, trackId, cur);
      if (this.save.coins < cost) return false;
      this.save.coins -= cost;
      up[trackId] = cur + 1;
      this.persist();
      OPF.Menus.shop(this);
      this.ui.setSpecialButtons(this.selectedChar, OPF.charLevelFrom(this.save.upgrades[this.selectedChar]));
      return true;
    }

    buyConsumable(id) {
      const item = OPF.CONSUMABLES.find(c => c.id === id);
      if (!item || this.save.coins < item.cost) return false;
      this.save.coins -= item.cost;
      this.save.bag[id] = (this.save.bag[id] || 0) + 1;
      this.persist();
      OPF.Menus.shop(this);
      this.ui.refreshItems();
      return true;
    }

    /* -------------------------------------------------------- battle --- */
    startBattle(arcIdx, level) {
      const used = {};
      ['attack_tonic', 'iron_draught', 'revive_scroll'].forEach(id => {
        if (this.save.bag[id] > 0) { used[id] = true; this.save.bag[id]--; }
      });
      this.persist();
      this.world = new OPF.World(this, {
        arcIdx, level,
        charId: this.selectedChar,
        upgrades: this.save.upgrades[this.selectedChar],
        usedItems: used,
      });
      this.battleArc = arcIdx;
      this.battleLevel = level;
      this.paused = false;
      $('pause-overlay').classList.remove('active');
      $('result-overlay').classList.remove('active');
      $('hud').style.display = '';
      this.hideScreens();
      this.ui.setSpecialButtons(this.selectedChar, this.world.player.level);
      this.ui.setItemButtons();
      OPF.Audio.init();
      OPF.Audio.sfx('power');
    }

    onLog(msg, type) {
      const log = $('combat-log');
      const el = document.createElement('div');
      el.className = 'log-entry ' + (type || '');
      el.textContent = msg;
      log.appendChild(el);
      setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; }, 2600);
      setTimeout(() => el.remove(), 3200);
      while (log.children.length > 8) log.removeChild(log.firstChild);
    }

    onShout(text) {
      const el = document.createElement('div');
      el.className = 'transformation-indicator';
      el.textContent = text;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1600);
    }

    onBattleEnd(world, victory, rewards) {
      const p = world.player;
      if (victory) {
        const key = this.levelKey(world.arcIdx, world.level);
        const first = !this.save.progress[key];
        if (!first) { rewards.coins = Math.round(rewards.coins * 0.6); rewards.xp = Math.round(rewards.xp * 0.6); }
        this.save.coins += rewards.coins;
        this.save.xp += rewards.xp;
        this.save.progress[key] = { coins: rewards.coins, xp: rewards.xp, best: Math.max((this.save.progress[key] || {}).best || 0, world.maxCombo) };
        this.save.stats.kills += world.stats.kills;
        this.save.stats.bestCombo = Math.max(this.save.stats.bestCombo, world.maxCombo);
        // codex
        world.enemies.forEach(e => {
          if (e.typeId) this.save.seen['enemy:' + e.typeId] = true;
          if (e.bossId) this.save.seen['boss:' + e.bossId] = true;
        });
        if (world.player.buffs.length) { /* no-op */ }
      }
      this.persist();
      const title = $('result-title');
      title.textContent = victory ? 'VICTORY!' : 'DEFEATED';
      title.className = 'result-title ' + (victory ? 'victory' : 'defeat');
      $('reward-coins').textContent = '+' + rewards.coins;
      $('reward-xp').textContent = '+' + rewards.xp;
      $('result-overlay').classList.add('active');
      this.ui.refreshItems();
    }

    closeResult() {
      $('result-overlay').classList.remove('active');
      if (this.battleArc !== undefined && this.world && this.world.result === 'victory') {
        // return to level list of the same arc
        const a = this.battleArc;
        this.world = null;
        $('hud').style.display = 'none';
        OPF.Menus.levelList(this, a);
        this.showScreen('level-select');
      } else {
        this.world = null;
        $('hud').style.display = 'none';
        this.showScreen('main-menu');
      }
      OPF.Audio.sfx('ui');
    }

    restartLevel() {
      if (this.battleArc === undefined) return;
      this.startBattle(this.battleArc, this.battleLevel);
    }

    exitToMenu() {
      this.world = null;
      this.paused = false;
      $('pause-overlay').classList.remove('active');
      $('hud').style.display = 'none';
      $('combat-log').innerHTML = '';
      this.showScreen('main-menu');
      OPF.Audio.sfx('back');
    }

    togglePause() {
      if (!this.world || this.world.over) return;
      this.paused = !this.paused;
      this.world.paused = this.paused;
      $('pause-overlay').classList.toggle('active', this.paused);
      $('hud').style.display = this.paused ? 'none' : '';
      OPF.Audio.sfx('ui');
    }

    /* -------------------------------------------------------- screens -- */
    hideScreens() {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    }
    showScreen(id) {
      if (id !== undefined && id !== null && typeof id === 'string') {
        this.hideScreens();
        const el = $(id);
        if (el) el.classList.add('active');
        this.screen = id;
      }
      if (this.screen === 'character-select') OPF.Menus.charGrid(this);
      if (this.screen === 'level-select') OPF.Menus.arcList(this);
      if (this.screen === 'shop-screen') OPF.Menus.shop(this);
      if (this.screen === 'codex-screen') OPF.Menus.codex(this);
      $('hud').style.display = 'none';
      $('combat-log').innerHTML = '';
      this.world = null;
      OPF.Audio.sfx('ui');
    }

    startSelectedLevel() {
      // jump straight to the furthest unlocked arc
      let arc = 0;
      for (let a = 4; a >= 0; a--) if (this.arcUnlocked(a)) { arc = a; break; }
      OPF.Menus.levelList(this, arc);
      this.hideScreens();
      $('level-select').classList.add('active');
      this.screen = 'level-select';
      $('hud').style.display = 'none';
      OPF.Audio.sfx('ui');
    }

    /* ----------------------------------------------------------- loop -- */
    loop(t) {
      const dtRaw = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      this.fpsSmooth += ((1 / Math.max(0.0001, dtRaw)) - this.fpsSmooth) * 0.08;

      // fixed timestep simulation
      this.accum += dtRaw;
      let steps = 0;
      while (this.accum >= CFG.FIXED_DT && steps < 5) {
        this.step(CFG.FIXED_DT);
        this.accum -= CFG.FIXED_DT;
        steps++;
      }
      this.render();
      requestAnimationFrame(this.loop);
    }

    step(dt) {
      const w = this.world;
      if (!w || this.paused) return;
      // player input from UI
      this.ui.update(dt);
      w.update(dt);
    }

    render() {
      const ctx = this.ctx;
      const s = this.scale;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(s, 0, 0, s, 0, 0);
      const v = this.view;

      if (!this.world) {
        // animated menu backdrop
        const t = performance.now() / 1000;
        const pal = OPF.ARCS[0].palette;
        const g = ctx.createLinearGradient(0, 0, 0, v.h);
        g.addColorStop(0, '#0a0e1c');
        g.addColorStop(1, '#141c30');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, v.w, v.h);
        for (let i = 0; i < 40; i++) {
          const a = (i * 0.31 + t * 0.06) % 1;
          const x = ((i * 137.5) % v.w);
          const y = (i * 71.3 + t * 22) % v.h;
          ctx.globalAlpha = 0.18 + (i % 5) * 0.06;
          ctx.fillStyle = i % 7 === 0 ? '#ffd700' : '#7fb2ff';
          ctx.fillRect(x, y, 2.2, 2.2 + (i % 3) * 2);
        }
        ctx.globalAlpha = 1;
        return;
      }

      const w = this.world;
      // background fills the screen (parallax handled inside art.js)
      OPF.Art.drawBackground(ctx, w.arcIdx, v, w.camera, w.time);
      // actors & props live in world space: camera + centering
      const camX = w.camera.x;
      const centerOffset = v.w > w.stageW ? (v.w - w.stageW) / 2 : 0;
      ctx.save();
      ctx.translate(-camX + centerOffset, v.yOffset || 0);
      w.drawEntities(ctx);
      ctx.restore();

      w.drawOverlays(ctx);

      // vignette
      const vg = ctx.createRadialGradient(v.w / 2, v.h / 2, v.h * 0.4, v.w / 2, v.h / 2, v.h * 0.95);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, v.w, v.h);

      // intro banner
      if (w.introTimer > 0) {
        ctx.save();
        const a = Math.min(1, w.introTimer);
        ctx.globalAlpha = a;
        ctx.textAlign = 'center';
        const label = w.isBoss ? (w.arc.levelNames[w.level] || 'BOSS').toUpperCase()
          : ('LEVEL ' + w.level + ' — ' + w.arc.name.toUpperCase());
        ctx.font = '900 34px system-ui, sans-serif';
        ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 8;
        ctx.strokeText(label, v.w / 2, v.h * 0.42);
        ctx.fillStyle = w.isBoss ? '#ff6b5a' : '#ffd700';
        ctx.fillText(label, v.w / 2, v.h * 0.42);
        ctx.restore();
      }
    }
  }

  /* ------------------------------------------------------- bootstrap --- */
  global.showScreen = function (id) { GAME.showScreen(id); };
  global.switchShopTab = function (name) {
    document.querySelectorAll('.shop-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $('upgrade-list').style.display = name === 'upgrades' ? '' : 'none';
    $('consumable-list').style.display = name === 'consumables' ? '' : 'none';
    OPF.Audio.sfx('ui');
  };
  global.startSelectedLevel = function () { GAME.startSelectedLevel(); };
  global.togglePause = function () { GAME.togglePause(); };
  global.restartLevel = function () { GAME.restartLevel(); };
  global.exitToMenu = function () { GAME.exitToMenu(); };
  global.closeResult = function () { GAME.closeResult(); };

  let GAME;
  window.addEventListener('load', () => {
    GAME = new Game();
    global.GAME = GAME;
    OPF.Menus.arcList(GAME);
  });
})(window);
