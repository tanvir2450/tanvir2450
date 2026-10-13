/* =========================================================================
   ONE PIECE FIGHT — ui.js
   HUD, on-screen joystick & action buttons, menus, shop, codex.
   ========================================================================= */
(function (global) {
  'use strict';
  const OPF = global.OPF;
  const $ = (id) => document.getElementById(id);

  const STYLE = `
  #hud, #hud * { touch-action: none; }
  /* Control sizing: every cluster scales with the viewport so the joystick and
     the action pad can never collide, on any phone or orientation. */
  #hud {
    --stick: min(clamp(92px, 26vw, 150px), 30vh);
    --padb: clamp(8px, 2.4vw, 18px);
    --padx: clamp(8px, 2.4vw, 16px);
    --gap: clamp(5px, 1.5vw, 10px);
    --btn: clamp(44px, 11.5vw, 66px);
    --btn-atk: clamp(54px, 14.5vw, 84px);
    --btn-sp: clamp(42px, 11vw, 62px);
  }
  .hud-row { display:flex; justify-content:space-between; align-items:flex-start; padding:10px 14px; }
  .hud-left { display:flex; flex-direction:column; gap:6px; }
  .fighter-hud { background:rgba(8,10,18,0.72); border:2px solid #2c3446; border-radius:12px; padding:6px 10px; min-width:210px; backdrop-filter:blur(4px); }
  .fighter-hud.boss { border-color:#e74c3c; }
  .fh-name { font-size:11px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:#e8eefc; display:flex; justify-content:space-between; }
  .fh-name .lvl { color:#ffd700; }
  .bar { height:11px; background:#11141d; border-radius:6px; overflow:hidden; margin-top:4px; border:1px solid #22293a; position:relative; }
  .bar > i { display:block; height:100%; width:0%; transition:width .18s ease-out; }
  .bar.hp > i { background:linear-gradient(90deg,#ff5252,#c0392b); }
  .bar.hp.foe > i { background:linear-gradient(90deg,#ff8a65,#e64a19); }
  .bar.mp { height:8px; }
  .bar.mp > i { background:linear-gradient(90deg,#4fc3f7,#1565c0); }
  .bar .lbl { position:absolute; right:5px; top:-1px; font-size:9px; font-weight:700; color:#fff; text-shadow:0 1px 2px #000; }
  .hud-right { display:flex; flex-direction:column; align-items:flex-end; gap:6px; }
  .chip { background:rgba(8,10,18,0.72); border:2px solid #2c3446; border-radius:10px; padding:5px 10px; font-size:12px; font-weight:800; color:#ffd700; }
  .chip.small { font-size:11px; color:#cfe0ff; border-color:#2c3446; }
  .boss-bar { position:absolute; top:12px; left:50%; transform:translateX(-50%); width:min(72%,620px); background:rgba(8,10,18,0.8); border:2px solid #e74c3c; border-radius:12px; padding:8px 12px; box-shadow:0 0 22px rgba(231,76,60,.35); }
  .boss-bar .t { text-align:center; font-size:13px; font-weight:900; letter-spacing:.1em; color:#ffd0c4; text-transform:uppercase; margin-bottom:4px; text-shadow:0 0 10px rgba(231,76,60,.6); }
  .controls { position:absolute; left:0; right:0; bottom:0; display:flex; justify-content:space-between; align-items:flex-end; padding:8px var(--padx) var(--padb); pointer-events:none; gap:var(--gap); }
  .controls > * { pointer-events:auto; }
  .stick-wrap { position:relative; width:var(--stick); height:var(--stick); flex:none; }
  .stick-base { position:absolute; inset:0; border-radius:50%; border:3px solid rgba(255,215,0,.28); background:radial-gradient(circle at 35% 32%, rgba(255,215,0,.10), rgba(4,6,12,.55)); box-shadow:inset 0 0 24px rgba(0,0,0,.6); }
  .stick-base::after { content:''; position:absolute; inset:26%; border-radius:50%; border:2px dashed rgba(255,255,255,.12); }
  .stick { position:absolute; left:50%; top:50%; width:38%; height:38%; margin:-19% 0 0 -19%; border-radius:50%; background:radial-gradient(circle at 34% 30%, #ffe680, #b8860b 70%, #7a5a07); border:2px solid #fff6cc; box-shadow:0 0 18px rgba(255,215,0,.55), inset 0 -4px 8px rgba(0,0,0,.35); transition:transform .05s linear; }
  .pad { display:flex; flex-direction:column; gap:var(--gap); align-items:flex-end; flex:none; }
  .pad-row { display:flex; gap:var(--gap); align-items:flex-end; }
  .abtn { width:var(--btn); height:var(--btn); border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; font-weight:900; color:#fff; border:2px solid rgba(255,255,255,.28); background:linear-gradient(160deg, rgba(60,70,90,.85), rgba(12,16,26,.9)); box-shadow:0 4px 14px rgba(0,0,0,.5), inset 0 -3px 8px rgba(0,0,0,.4); user-select:none; font-size:11px; letter-spacing:.03em; position:relative; overflow:hidden; }
  .abtn .ico { font-size:clamp(14px, 3.6vw, 20px); line-height:1; }
  .abtn:active, .abtn.on { transform:scale(.93); filter:brightness(1.35); }
  .abtn.atk { width:var(--btn-atk); height:var(--btn-atk); background:linear-gradient(160deg,#ff8a4c,#b3270b); font-size:12px; }
  .abtn.jmp { background:linear-gradient(160deg,#5ec3ff,#0d47a1); }
  .abtn.dsh { background:linear-gradient(160deg,#c792ea,#4527a0); }
  .abtn.blk { background:linear-gradient(160deg,#9aa7bd,#37474f); }
  .abtn.sp { width:var(--btn-sp); height:var(--btn-sp); background:linear-gradient(160deg,#7a4cff,#2a0a5e); font-size:10px; }
  .abtn.sp.locked { filter:grayscale(.9) brightness(.55); }
  .abtn.sp .cost { font-size:9px; color:#a9d7ff; }
  .abtn .cd { position:absolute; inset:0; background:rgba(3,5,10,.72); display:flex; align-items:center; justify-content:center; font-size:16px; font-weight:900; color:#fff; }
  .items { position:absolute; left:var(--padx); bottom:calc(var(--padb) + var(--stick) + 8px); display:flex; flex-direction:column; gap:6px; }
  .item-btn { width:clamp(40px, 10.5vw, 52px); height:clamp(40px, 10.5vw, 52px); border-radius:14px; border:2px solid rgba(255,255,255,.25); background:linear-gradient(160deg, rgba(40,50,70,.9), rgba(8,12,20,.92)); color:#fff; font-size:20px; display:flex; align-items:center; justify-content:center; position:relative; }
  .item-btn .cnt { position:absolute; right:-4px; top:-6px; background:#ffd700; color:#101018; font-size:10px; font-weight:900; border-radius:9px; padding:1px 5px; }
  .item-btn:active { transform:scale(.93); }
  .btn-sm { padding:6px 12px; font-size:11px; font-weight:800; letter-spacing:.06em; color:#e8eefc; background:rgba(8,10,18,.75); border:2px solid #2c3446; border-radius:10px; }
  .menu-screen { overflow-y:auto; padding:18px 0 34px; justify-content:flex-start !important; }
  .menu-head { display:flex; justify-content:space-between; align-items:center; width:100%; max-width:900px; padding:0 16px 10px; }
  .grid4 { display:grid; grid-template-columns:repeat(auto-fill, minmax(96px,1fr)); gap:8px; width:100%; max-width:900px; padding:0 16px; }
  .lvl-btn { aspect-ratio:1/0.78; border-radius:12px; border:2px solid #2c3446; background:linear-gradient(160deg,#1b2334,#0b0f18); color:#dfe8f7; font-weight:800; font-size:15px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; position:relative; }
  .lvl-btn small { font-size:9px; font-weight:700; opacity:.85; }
  .lvl-btn.cleared { border-color:#2ecc71; background:linear-gradient(160deg,#123a25,#0a1a12); }
  .lvl-btn.cleared::after { content:'★'; position:absolute; top:3px; right:6px; color:#ffd700; font-size:11px; }
  .lvl-btn.boss { border-color:#e74c3c; background:linear-gradient(160deg,#3a1114,#1a0708); }
  .lvl-btn.locked { opacity:.42; }
  .lvl-btn:active { transform:scale(.97); }
  .char-edge { width:100%; max-width:900px; padding:0 16px 8px; display:flex; gap:8px; align-items:center; }
  .tabs { display:flex; gap:8px; overflow-x:auto; padding:4px 16px 10px; width:100%; max-width:900px; }
  .tab { padding:8px 16px; border-radius:20px; border:2px solid #2c3446; background:#141a28; color:#93a3bd; font-weight:800; font-size:12px; white-space:nowrap; }
  .tab.on { border-color:#ffd700; color:#ffd700; background:#1e2536; }
  .bars { position:absolute; inset:0; pointer-events:none; }
  @media (max-width:430px) {
    .abtn { font-size:9.5px; }
    .fighter-hud { min-width:144px; padding:5px 8px; }
  }
  @media (orientation:landscape) and (max-height:430px) {
    .abtn { font-size:9.5px; }
    .fighter-hud { min-width:170px; }
  }
  `;

  class UI {
    constructor(game) {
      this.game = game;
      this.dir = { x: 0, y: 0 };
      this.keys = {};
      this.build();
      this.bindKeyboard();
    }

    build() {
      const style = document.createElement('style');
      style.textContent = STYLE;
      document.head.appendChild(style);

      const hud = $('hud');
      hud.innerHTML = `
        <div class="hud-row">
          <div class="hud-left">
            <div class="fighter-hud" id="phud">
              <div class="fh-name"><span id="pname">LUFFY</span><span class="lvl" id="plvl">Lv.1</span></div>
              <div class="bar hp"><i id="php"></i><span class="lbl" id="phptxt">100/100</span></div>
              <div class="bar mp"><i id="pmp"></i></div>
            </div>
          </div>
          <div class="hud-right">
            <button class="btn-sm" id="pause-btn">❚❚</button>
            <div class="chip small" id="wave-chip">WAVE 1/2</div>
            <div class="chip" id="coin-chip">0 ⛁</div>
          </div>
        </div>
        <div class="bars" id="enemy-bars"></div>
        <div id="boss-bar-slot"></div>
        <div class="controls">
          <div class="stick-wrap" id="stick-wrap">
            <div class="stick-base"></div>
            <div class="stick" id="stick"></div>
          </div>
          <div class="pad">
            <div class="pad-row" id="special-row"></div>
            <div class="pad-row">
              <div class="abtn blk" data-act="block"><span class="ico">🛡</span>BLOCK</div>
              <div class="abtn dsh" data-act="dash"><span class="ico">💨</span>DASH</div>
              <div class="abtn jmp" data-act="jump"><span class="ico">⤒</span>JUMP</div>
              <div class="abtn atk" data-act="attack"><span class="ico">👊</span>ATTACK</div>
            </div>
          </div>
        </div>
        <div class="items" id="item-bar"></div>
      `;

      $('pause-btn').addEventListener('click', () => this.game.togglePause());
      this.buildStick();
      this.buildButtons();
    }

    /* ------------------------------------------------ joystick --------- */
    buildStick() {
      const wrap = $('stick-wrap'), stick = $('stick');
      let pid = null, cx = 0, cy = 0, R = 54;
      const setStick = (dx, dy) => {
        const len = Math.hypot(dx, dy);
        const cl = Math.min(len, R);
        const nx = len ? dx / len : 0, ny = len ? dy / len : 0;
        stick.style.transform = `translate(${nx * cl}px, ${ny * cl}px)`;
        this.dir.x = Math.abs(nx) < 0.22 ? 0 : nx;
        this.dir.y = Math.abs(ny) < 0.28 ? 0 : ny;
      };
      const reset = () => { stick.style.transform = ''; this.dir.x = 0; this.dir.y = 0; };

      wrap.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        pid = e.pointerId;
        if (wrap.setPointerCapture) wrap.setPointerCapture(pid);
        const r = wrap.getBoundingClientRect();
        cx = r.left + r.width / 2; cy = r.top + r.height / 2;
        R = r.width * 0.36;
        setStick(e.clientX - cx, e.clientY - cy);
      });
      wrap.addEventListener('pointermove', (e) => {
        if (e.pointerId !== pid) return;
        setStick(e.clientX - cx, e.clientY - cy);
      });
      const up = (e) => { if (e.pointerId === pid) { pid = null; reset(); } };
      wrap.addEventListener('pointerup', up);
      wrap.addEventListener('pointercancel', up);
      wrap.addEventListener('pointerleave', (e) => { if (e.pointerId === pid && e.pointerType === 'mouse') { pid = null; reset(); } });
    }

    /* ------------------------------------------------ buttons ---------- */
    buildButtons() {
      this.btns = {};
      document.querySelectorAll('.abtn[data-act]').forEach(el => {
        const act = el.dataset.act;
        this.btns[act] = el;
        const down = (e) => {
          e.preventDefault();
          el.classList.add('on');
          OPF.Audio.init();
          this.press(act, true);
        };
        const upAct = (e) => { el.classList.remove('on'); this.press(act, false); };
        el.addEventListener('pointerdown', down);
        el.addEventListener('pointerup', upAct);
        el.addEventListener('pointercancel', upAct);
        el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && el.classList.contains('on')) upAct(e); });
      });
      this.held = {};
    }

    setSpecialButtons(charId, level) {
      const C = OPF.CHAR_BY_ID[charId];
      const row = $('special-row');
      row.innerHTML = '';
      this.spBtns = [];
      C.specials.forEach((sp, i) => {
        const el = document.createElement('div');
        const locked = level < sp.unlock;
        el.className = 'abtn sp' + (locked ? ' locked' : '');
        el.innerHTML = `<span class="ico">${['①', '②', '③', '④'][i]}</span><span class="cost">${locked ? 'Lv.' + sp.unlock : sp.cost + 'MP'}</span>`;
        el.title = locked
          ? `${sp.name} — unlock at character level ${sp.unlock}`
          : `${sp.name} — ${sp.cost} mana`;
        if (locked) el.setAttribute('aria-label', `${sp.name} locked until level ${sp.unlock}`);
        el.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          el.classList.add('on');
          OPF.Audio.init();
          this.game.world && this.game.world.playerSpecial(i);
          OPF.Audio.sfx('ui');
        });
        const off = () => el.classList.remove('on');
        el.addEventListener('pointerup', off);
        el.addEventListener('pointercancel', off);
        row.appendChild(el);
        this.spBtns.push(el);
      });
    }

    setItemButtons() {
      const bar = $('item-bar');
      bar.innerHTML = '';
      this.itemBtns = {};
      [['health_potion', '🧪'], ['mana_potion', '🔮']].forEach(([id, ico]) => {
        const el = document.createElement('div');
        el.className = 'item-btn';
        el.innerHTML = `${ico}<span class="cnt" id="cnt-${id}">0</span>`;
        el.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          OPF.Audio.init();
          this.game.world && this.game.world.useItem(id);
          this.refreshItems();
        });
        bar.appendChild(el);
        this.itemBtns[id] = el;
      });
      this.refreshItems();
    }

    refreshItems() {
      const bag = this.game.save.bag || {};
      ['health_potion', 'mana_potion'].forEach(id => {
        const el = $('cnt-' + id);
        if (el) el.textContent = bag[id] || 0;
      });
    }

    press(act, down) {
      const w = this.game.world;
      this.held[act] = down;
      if (!w || !w.player || w.player.dead) return;
      if (!down) {
        if (act === 'block') w.player.setState('idle');
        return;
      }
      switch (act) {
        case 'attack': w.playerAttack(); break;
        case 'jump': w.player.jump(); break;
        case 'dash': w.player.dash(this.dir.x > 0 ? 1 : this.dir.x < 0 ? -1 : w.player.facing); break;
        case 'block': w.player.setState('block', 1); break;
      }
    }

    /* ------------------------------------------------- keyboard -------- */
    bindKeyboard() {
      window.addEventListener('keydown', (e) => {
        const w = this.game.world;
        OPF.Audio.init();
        if (e.repeat) { this.keys[e.code] = true; return; }
        this.keys[e.code] = true;
        if (e.code === 'Escape' || e.code === 'KeyP') { this.game.togglePause(); return; }
        if (!w || !w.player) return;
        switch (e.code) {
          case 'KeyJ': case 'KeyZ': w.playerAttack(); break;
          case 'KeyK': case 'Space': w.player.jump(); break;
          case 'KeyL': case 'ShiftLeft': w.player.dash(0); break;
          case 'KeyS': case 'ArrowDown': w.player.setState('block', 1); break;
          case 'Digit1': w.playerSpecial(0); break;
          case 'Digit2': w.playerSpecial(1); break;
          case 'Digit3': w.playerSpecial(2); break;
          case 'Digit4': w.playerSpecial(3); break;
          case 'KeyQ': w.useItem('health_potion'); this.refreshItems(); break;
          case 'KeyE': w.useItem('mana_potion'); this.refreshItems(); break;
        }
      });
      window.addEventListener('keyup', (e) => {
        this.keys[e.code] = false;
        const w = this.game.world;
        if (!w || !w.player) return;
        if ((e.code === 'KeyS' || e.code === 'ArrowDown') && w.player.state === 'block') w.player.setState('idle');
      });
    }

    /* -------------------------------------------------- per-frame ------ */
    update(dt) {
      const w = this.game.world;
      if (!w) return;
      const p = w.player;
      // keyboard movement
      let kx = 0, ky = 0;
      if (this.keys['KeyA'] || this.keys['ArrowLeft']) kx -= 1;
      if (this.keys['KeyD'] || this.keys['ArrowRight']) kx += 1;
      if (this.keys['KeyW'] || this.keys['ArrowUp']) ky -= 1;
      if (this.held['attack']) this.autoAttack(dt);
      const dirX = kx || this.dir.x;
      const dirY = ky || this.dir.y;

      if (p && !p.dead) {
        p.moveInput(dirX, w);
        // Only latch when the jump is actually taken.  p.jump() refuses while the
        // fighter is stunned/hurt, and latching anyway meant a stick held up during
        // a hit was silently swallowed until the player released and pushed again.
        if (dirY < -0.6 && p.onGround && !this._jumpLatch && p.jump()) this._jumpLatch = true;
        if (dirY > 0.6 && p.onGround && !p.locked) { p.setState('crouch'); }
        else if (p.state === 'crouch' && dirY <= 0.6) p.setState('idle');
        if (dirY > -0.6) this._jumpLatch = false;
      }
      this.drawHUD();
    }

    autoAttack(dt) {
      const w = this.game.world;
      const p = w.player;
      if (!p || p.dead) return;
      this._atkCd = (this._atkCd || 0) - dt;
      if (this._atkCd <= 0) { w.playerAttack(); this._atkCd = 0.28; }
    }

    drawHUD() {
      const w = this.game.world;
      const p = w.player;
      const set = (id, v) => { const el = $(id); if (el && el.style.width !== v) el.style.width = v; };
      set('php', (p.hp / p.maxHp * 100).toFixed(1) + '%');
      set('pmp', (p.mana / p.maxMana * 100).toFixed(1) + '%');
      const pt = $('phptxt');
      if (pt) pt.textContent = Math.max(0, Math.ceil(p.hp)) + '/' + p.maxHp;
      const nm = $('pname'), lv = $('plvl');
      if (nm) nm.textContent = p.name + (p.buffs.filter(b => b.aura).length ? ' ⚡' : '');
      if (lv) lv.textContent = 'Lv.' + p.level;
      const cc = $('coin-chip');
      if (cc) cc.textContent = this.game.save.coins + ' ⛁';
      const wc = $('wave-chip');
      if (wc) {
        wc.textContent = w.isBoss ? 'BOSS' : ('WAVE ' + (w.waveIndex + 1) + '/' + w.waves.length);
      }

      // enemy bars for up to 4 nearby foes
      const cont = $('enemy-bars');
      const foes = w.enemies.filter(e => !e.dead && !e.static).slice(0, 4);
      const key = foes.map(f => f.id).join(',');
      if (cont.dataset.key !== key) {
        cont.dataset.key = key;
        cont.innerHTML = foes.map((f, i) => `
          <div class="fighter-hud" data-foe="${f.id}" style="position:absolute;top:${64 + i * 46}px;right:14px;min-width:190px;pointer-events:none;">
            <div class="fh-name"><span>${f.name}</span></div>
            <div class="bar hp foe"><i></i><span class="lbl"></span></div>
          </div>`).join('');
      }
      foes.forEach((f) => {
        const el = cont.querySelector(`[data-foe="${f.id}"]`);
        if (!el) return;
        const bar = el.querySelector('.bar.hp > i');
        const lbl = el.querySelector('.lbl');
        bar.style.width = (f.hp / f.maxHp * 100) + '%';
        lbl.textContent = Math.max(0, Math.ceil(f.hp)) + '/' + f.maxHp;
      });

      // boss bar
      const bslot = $('boss-bar-slot');
      if (w.boss && !w.boss.dead) {
        if (bslot.dataset.on !== '1') {
          bslot.dataset.on = '1';
          bslot.innerHTML = `<div class="boss-bar"><div class="t">${w.boss.name} — ${w.boss.boss.title}</div><div class="bar hp foe" style="height:14px"><i id="boss-hp"></i></div></div>`;
        }
        const bh = $('boss-hp');
        if (bh) bh.style.width = (w.boss.hp / w.boss.maxHp * 100) + '%';
      } else if (bslot.dataset.on === '1') {
        bslot.dataset.on = '0'; bslot.innerHTML = '';
      }

      // special button states
      if (this.spBtns) {
        const C = OPF.CHAR_BY_ID[p.charId];
        this.spBtns.forEach((el, i) => {
          const sp = C.specials[i];
          const locked = p.level < sp.unlock;
          el.classList.toggle('locked', locked);
          const afford = p.mana >= sp.cost;
          el.style.opacity = locked ? '' : (afford ? '1' : '0.5');
        });
      }
    }
  }

  /* =====================================================================
     MENU RENDERING
     ===================================================================== */
  /* Portraits are drawn onto <canvas> elements inside menu cards.  A failure
     here used to vanish into an empty catch block, which is how you end up with
     blank character cards and no clue why.  Fail loudly but keep the menu up. */
  function portrait(canvas, kind, id) {
    if (!canvas) return;
    try {
      OPF.Art.drawPortrait(canvas, kind, id);
    } catch (err) {
      console.error('portrait failed for ' + kind + ' ' + id, err);
      if (window.reportGameError) window.reportGameError('Portrait ' + id, err);
    }
  }

  const Menus = {
    charGrid(game) {
      const grid = $('char-grid');
      grid.innerHTML = '';
      const startBtn = $('start-battle-btn');
      if (startBtn) startBtn.disabled = false;   // a character is always selected
      OPF.CHARACTERS.forEach((C, idx) => {
        const up = game.save.upgrades[C.id] || { vitality: 0, power: 0, spirit: 0 };
        const lvl = OPF.charLevelFrom(up);
        const card = document.createElement('div');
        card.className = 'char-card' + (game.selectedChar === C.id ? ' selected' : '');
        card.style.setProperty('--char-color', C.color);
        card.innerHTML = `
          <div class="char-level">Lv.${lvl}</div>
          <canvas class="char-portrait" width="180" height="180" style="width:100%;aspect-ratio:1;border-radius:12px;"></canvas>
          <div class="char-name">${C.name}</div>
          <div class="char-style">${C.epithet}</div>
        `;
        card.addEventListener('click', () => {
          game.selectedChar = C.id;
          OPF.Audio.sfx('ui');
          Menus.charGrid(game);
        });
        grid.appendChild(card);
        portrait(card.querySelector('canvas'), 'char', C.id);
      });
    },

    arcList(game) {
      const list = $('arc-list');
      list.innerHTML = '';
      OPF.ARCS.forEach((arc) => {
        const cleared = game.arcClearedCount(arc.id);
        const unlocked = game.arcUnlocked(arc.id);
        const card = document.createElement('div');
        card.className = 'arc-card ' + (unlocked ? 'unlocked' : 'locked');
        const bosses = [10, 20, 30].map(l => {
          const bId = arc.bosses[l];
          const B = OPF.BOSSES[bId];
          const done = game.levelCleared(arc.id, l);
          const isNext = !done && game.levelUnlocked(arc.id, l);
          return `<span class="boss-badge ${done ? 'defeated' : isNext ? 'current' : ''}">${B.name}</span>`;
        }).join('');
        card.innerHTML = `
          <div class="arc-header">
            <div class="arc-name">${unlocked ? '' : '🔒 '}Arc ${arc.id + 1}: ${arc.name}</div>
            <div class="arc-progress">${cleared}/30</div>
          </div>
          <div style="font-size:12px;color:#8fa3c4;margin-bottom:8px;">${arc.subtitle}</div>
          <div class="arc-bosses">${bosses}</div>
        `;
        card.addEventListener('click', () => {
          if (!unlocked) { OPF.Audio.sfx('back'); return; }
          game.openLevels(arc.id);
        });
        list.appendChild(card);
      });
    },

    levelList(game, arcIdx) {
      const arc = OPF.ARCS[arcIdx];
      $('level-select-title').textContent = 'ARC ' + (arcIdx + 1) + ': ' + arc.name.toUpperCase();
      const list = $('arc-list');
      list.innerHTML = `<div class="char-edge"><button class="btn btn-secondary" style="min-width:auto;padding:.5rem 1rem;font-size:.8rem" id="back-to-arcs">← ARCS</button></div>
                        <div class="grid4" id="lvl-grid"></div>`;
      $('back-to-arcs').addEventListener('click', () => { game.openArcs(); });
      const grid = $('lvl-grid');
      for (let l = 1; l <= 30; l++) {
        const boss = OPF.isBossLevel(l);
        const cleared = game.levelCleared(arcIdx, l);
        const unlocked = game.levelUnlocked(arcIdx, l);
        const el = document.createElement('div');
        el.className = 'lvl-btn' + (cleared ? ' cleared' : '') + (boss ? ' boss' : '') + (unlocked ? '' : ' locked');
        const label = boss ? (arc.levelNames[l] || 'BOSS') : (l <= 9 ? 'Grunts' : l <= 19 ? 'Veterans' : 'Elites');
        el.innerHTML = `<span>${l}</span><small>${boss ? 'BOSS' : label}</small>`;
        el.addEventListener('click', () => {
          if (!unlocked) { OPF.Audio.sfx('back'); return; }
          OPF.Audio.sfx('ui');
          game.startBattle(arcIdx, l);
        });
        grid.appendChild(el);
      }
    },

    shop(game) {
      $('shop-coins').textContent = game.save.coins;
      $('shop-health-potions').textContent = game.save.bag.health_potion || 0;
      $('shop-mana-potions').textContent = game.save.bag.mana_potion || 0;
      Menus.upgrades(game);
      Menus.consumables(game);
    },

    upgrades(game) {
      const list = $('upgrade-list');
      list.innerHTML = '';
      OPF.CHARACTERS.forEach(C => {
        const up = game.save.upgrades[C.id] || { vitality: 0, power: 0, spirit: 0 };
        const lvl = OPF.charLevelFrom(up);
        const stats = OPF.resolveCharStats(C.id, up);
        const row = document.createElement('div');
        row.className = 'upgrade-item';
        row.style.borderColor = C.color;
        const trackRows = OPF.UPGRADE_TRACKS.map(T => {
          const cur = up[T.id];
          const cost = OPF.upgradeCost(C.id, T.id, cur);
          const maxed = cur >= 10;
          const afford = game.save.coins >= cost;
          return `<div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;">
            <span style="width:118px;font-size:12px;color:${T.color};font-weight:800">${T.icon} ${T.name}</span>
            <span style="font-size:12px;color:#cbd6ea;width:52px">${cur}/10</span>
            <button class="btn-upgrade" data-char="${C.id}" data-track="${T.id}" ${maxed || !afford ? 'disabled' : ''}>
              ${maxed ? 'MAX' : cost + ' ⛁'}
            </button>
            <span style="font-size:10px;color:#7d8ca6">${T.desc}</span>
          </div>`;
        }).join('');
        row.innerHTML = `
          <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;width:100%">
            <canvas width="90" height="90" style="width:76px;height:76px;border-radius:12px;flex:none"></canvas>
            <div style="flex:1;min-width:230px">
              <div class="upgrade-name">${C.name} <span style="color:#ffd700;font-size:13px">Lv.${lvl}</span></div>
              <div class="upgrade-desc">${C.style}</div>
              <div class="upgrade-stats">
                <span class="stat">❤ ${stats.hp} HP</span>
                <span class="stat">⚔ ${stats.atk.toFixed(1)} ATK</span>
                <span class="stat">✦ ${stats.mana} MP</span>
              </div>
              ${trackRows}
            </div>
          </div>`;
        list.appendChild(row);
        portrait(row.querySelector('canvas'), 'char', C.id);
      });
      list.querySelectorAll('.btn-upgrade').forEach(btn => {
        btn.addEventListener('click', () => {
          const ok = game.buyUpgrade(btn.dataset.char, btn.dataset.track);
          if (ok) OPF.Audio.sfx('upgrade'); else OPF.Audio.sfx('back');
        });
      });
    },

    consumables(game) {
      const list = $('consumable-list');
      list.innerHTML = '';
      OPF.CONSUMABLES.forEach(item => {
        const owned = game.save.bag[item.id] || 0;
        const el = document.createElement('div');
        el.className = 'consumable-item';
        el.style.borderColor = item.color;
        el.innerHTML = `
          <div class="consumable-info">
            <div class="consumable-name">${item.icon} ${item.name} <span style="font-size:11px;color:#8fa3c4">×${owned} owned</span></div>
            <div class="consumable-desc">${item.desc}${item.battle ? ' <span style="color:#ffd700">(auto-applied next battle)</span>' : ''}</div>
          </div>
          <div class="upgrade-actions">
            <span class="consumable-price">${item.cost} ⛁</span>
            <button class="btn-buy" data-id="${item.id}" ${game.save.coins < item.cost ? 'disabled' : ''}>BUY</button>
          </div>`;
        list.appendChild(el);
      });
      list.querySelectorAll('.btn-buy').forEach(btn => {
        btn.addEventListener('click', () => {
          const ok = game.buyConsumable(btn.dataset.id);
          if (ok) OPF.Audio.sfx('buy'); else OPF.Audio.sfx('back');
        });
      });
    },

    codex(game) {
      const list = $('codex-list');
      const seen = game.save.seen || {};
      const sections = [];
      sections.push('<h3 style="color:#ffd700;margin:10px 0 6px">ENEMIES</h3>');
      Object.keys(OPF.ENEMY_TYPES).forEach(id => {
        const T = OPF.ENEMY_TYPES[id];
        const known = seen['enemy:' + id];
        sections.push(`<div class="upgrade-item" style="margin-bottom:6px;border-color:${known ? '#2ecc71' : '#2c3446'}">
          <div class="upgrade-info">
            <div class="upgrade-name">${known ? T.name : '???'}</div>
            <div class="upgrade-desc">${known ? `HP ${T.hp} · ATK ${T.atk} · ${T.ai === 'ranged' ? 'Ranged' : 'Melee'}` : 'Not yet encountered'}</div>
          </div>
          <canvas width="70" height="70" style="width:56px;height:56px;border-radius:10px"></canvas>
        </div>`);
        setTimeout(() => {
          const cvs = list.querySelectorAll('canvas');
          const c = cvs[cvs.length - 1];
          if (c && known) portrait(c, 'enemy', id);
        }, 0);
      });
      sections.push('<h3 style="color:#ffd700;margin:14px 0 6px">BOSSES</h3>');
      Object.keys(OPF.BOSSES).forEach(id => {
        const B = OPF.BOSSES[id];
        const known = seen['boss:' + id];
        sections.push(`<div class="upgrade-item" style="margin-bottom:6px;border-color:${known ? '#e74c3c' : '#2c3446'}">
          <div class="upgrade-info">
            <div class="upgrade-name">${known ? B.name : '???'}</div>
            <div class="upgrade-desc">${known ? `${B.title} · HP ${B.hp} · ATK ${B.atk}` : 'Undefeated'}</div>
          </div>
        </div>`);
      });
      list.innerHTML = sections.join('');
    },
  };

  OPF.UI = UI;
  OPF.Menus = Menus;
  global.Menus = Menus;
})(window);
