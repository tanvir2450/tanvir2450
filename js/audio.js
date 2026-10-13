/* =========================================================================
   ONE PIECE FIGHT — audio.js
   Fully procedural WebAudio: SFX + adaptive background music. No assets.
   ========================================================================= */
(function (global) {
  'use strict';

  const A = {
    ctx: null,
    master: null,
    sfxBus: null,
    musicBus: null,
    enabled: true,
    musicOn: true,
    started: false,
    _musicTimer: null,
    _step: 0,
    _bpm: 132,
  };

  function ac() {
    if (!A.ctx) {
      const Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return null;
      A.ctx = new Ctx();
      A.master = A.ctx.createGain();
      A.master.gain.value = 0.9;
      A.master.connect(A.ctx.destination);

      A.sfxBus = A.ctx.createGain();
      A.sfxBus.gain.value = 0.55;
      A.sfxBus.connect(A.master);

      A.musicBus = A.ctx.createGain();
      A.musicBus.gain.value = 0.0;      // faded in on first user gesture
      A.musicBus.connect(A.master);
    }
    return A.ctx;
  }

  A.init = function () {
    const c = ac();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    if (!A.started && A.musicOn) {
      A.started = true;
      fade(A.musicBus.gain, 0.22, 2.0);
      startMusicLoop();
    }
  };

  function fade(param, to, time) {
    const c = A.ctx;
    if (!c) return;
    const now = c.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(to, now + time);
  }

  /* ------------------------------------------------------------- SFX ---- */
  // Generic synth voice: osc -> gain envelope -> optional filter
  function tone(opts) {
    if (!A.enabled) return;
    const c = ac();
    if (!c) return;
    const {
      type = 'square', freq = 220, freq2 = null, dur = 0.12, vol = 0.3,
      attack = 0.005, decay = null, filter = null, q = 1, pan = 0, delay = 0, detune = 0,
    } = opts;
    const t0 = c.currentTime + delay;

    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.detune.value = detune;
    if (freq2 !== null) {
      if (opts.sweep === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq2), t0 + dur);
      else osc.frequency.linearRampToValueAtTime(Math.max(1, freq2), t0 + dur);
    }

    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    const d = decay === null ? dur : decay;
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(attack + 0.01, d));

    let node = osc;
    if (filter) {
      const f = c.createBiquadFilter();
      f.type = filter;
      f.frequency.value = opts.filterFreq || 900;
      f.Q.value = q;
      node.connect(f);
      node = f;
    }
    if (pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(p);
      node = p;
    }
    node.connect(g);
    g.connect(A.sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.06);
  }

  function noise(opts) {
    if (!A.enabled) return;
    const c = ac();
    if (!c) return;
    const {
      dur = 0.14, vol = 0.3, filter = 'lowpass', freq = 1200, freq2 = null,
      q = 1, delay = 0, pan = 0, attack = 0.004,
    } = opts;
    const t0 = c.currentTime + delay;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;

    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t0);
    if (freq2 !== null) f.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t0 + dur);
    f.Q.value = q;
    src.connect(f);

    let node = f;
    if (pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(p);
      node = p;
    }

    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(g);
    g.connect(A.sfxBus);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  const SFX = {
    whiff: (pan) => noise({ dur: 0.1, vol: 0.16, filter: 'bandpass', freq: 900, freq2: 300, q: 1.6, pan }),
    hit: (pan, heavy) => {
      noise({ dur: heavy ? 0.22 : 0.12, vol: heavy ? 0.45 : 0.28, filter: 'lowpass', freq: heavy ? 900 : 1400, freq2: 120, pan });
      tone({ type: 'triangle', freq: heavy ? 120 : 200, freq2: 48, sweep: 'exp', dur: heavy ? 0.2 : 0.1, vol: heavy ? 0.34 : 0.18, pan });
    },
    block: (pan) => {
      noise({ dur: 0.16, vol: 0.3, filter: 'highpass', freq: 2200, pan });
      tone({ type: 'square', freq: 720, freq2: 400, dur: 0.1, vol: 0.14, pan });
    },
    jump: () => tone({ type: 'sine', freq: 320, freq2: 700, sweep: 'exp', dur: 0.14, vol: 0.14 }),
    land: () => noise({ dur: 0.12, vol: 0.2, filter: 'lowpass', freq: 700, freq2: 120 }),
    dash: () => noise({ dur: 0.2, vol: 0.22, filter: 'bandpass', freq: 400, freq2: 2400, q: 1.2 }),
    ko: () => {
      tone({ type: 'sawtooth', freq: 260, freq2: 60, sweep: 'exp', dur: 0.7, vol: 0.28 });
      noise({ dur: 0.6, vol: 0.24, filter: 'lowpass', freq: 900, freq2: 90 });
    },
    ui: () => tone({ type: 'square', freq: 880, freq2: 1180, dur: 0.07, vol: 0.12 }),
    back: () => tone({ type: 'square', freq: 620, freq2: 400, dur: 0.08, vol: 0.12 }),
    coin: () => {
      tone({ type: 'triangle', freq: 1320, dur: 0.06, vol: 0.16 });
      tone({ type: 'triangle', freq: 1760, dur: 0.1, vol: 0.14, delay: 0.055 });
    },
    buy: () => {
      tone({ type: 'sine', freq: 660, dur: 0.08, vol: 0.18 });
      tone({ type: 'sine', freq: 990, dur: 0.12, vol: 0.16, delay: 0.07 });
      tone({ type: 'sine', freq: 1320, dur: 0.14, vol: 0.12, delay: 0.14 });
    },
    upgrade: () => {
      [523, 659, 784, 1046].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.16, vol: 0.16, delay: i * 0.06 }));
    },
    potion: () => {
      tone({ type: 'sine', freq: 440, freq2: 880, sweep: 'exp', dur: 0.3, vol: 0.18 });
      noise({ dur: 0.2, vol: 0.08, filter: 'highpass', freq: 3000 });
    },
    victory: () => {
      [523, 659, 784, 1046, 1318].forEach((f, i) =>
        tone({ type: 'square', freq: f, dur: 0.28, vol: 0.17, delay: i * 0.11, filter: 'lowpass', filterFreq: 2600 }));
    },
    defeat: () => {
      [440, 392, 330, 262].forEach((f, i) =>
        tone({ type: 'sawtooth', freq: f, dur: 0.34, vol: 0.16, delay: i * 0.16, filter: 'lowpass', filterFreq: 1400 }));
    },
    levelup: () => {
      [659, 784, 988, 1318, 1568].forEach((f, i) =>
        tone({ type: 'triangle', freq: f, dur: 0.25, vol: 0.16, delay: i * 0.08 }));
    },
    power: () => {
      tone({ type: 'sawtooth', freq: 90, freq2: 300, sweep: 'exp', dur: 0.5, vol: 0.3, filter: 'lowpass', filterFreq: 1200 });
      noise({ dur: 0.5, vol: 0.2, filter: 'bandpass', freq: 300, freq2: 2600 });
    },
    transform: () => {
      tone({ type: 'sawtooth', freq: 120, freq2: 900, sweep: 'exp', dur: 0.8, vol: 0.3, filter: 'lowpass', filterFreq: 2400 });
      [523, 784, 1046, 1568].forEach((f, i) => tone({ type: 'square', freq: f, dur: 0.3, vol: 0.14, delay: 0.2 + i * 0.1 }));
    },
    explosion: () => {
      noise({ dur: 0.7, vol: 0.5, filter: 'lowpass', freq: 1400, freq2: 60 });
      tone({ type: 'triangle', freq: 90, freq2: 30, sweep: 'exp', dur: 0.6, vol: 0.3 });
    },
    slash: (pan) => {
      noise({ dur: 0.18, vol: 0.3, filter: 'bandpass', freq: 3200, freq2: 900, q: 1.1, pan });
    },
    gun: (pan) => {
      noise({ dur: 0.14, vol: 0.34, filter: 'highpass', freq: 1600, pan });
      tone({ type: 'square', freq: 200, freq2: 60, dur: 0.1, vol: 0.16, pan });
    },
    laser: () => {
      tone({ type: 'sawtooth', freq: 1800, freq2: 220, sweep: 'exp', dur: 0.5, vol: 0.26, filter: 'bandpass', filterFreq: 2000 });
    },
    ice: () => {
      noise({ dur: 0.4, vol: 0.2, filter: 'highpass', freq: 3000 });
      [1568, 2093, 2637].forEach((f, i) => tone({ type: 'sine', freq: f, dur: 0.3, vol: 0.1, delay: i * 0.07 }));
    },
    fire: () => noise({ dur: 0.4, vol: 0.22, filter: 'lowpass', freq: 700, freq2: 1800 }),
    roar: () => {
      tone({ type: 'sawtooth', freq: 140, freq2: 70, sweep: 'exp', dur: 0.8, vol: 0.34, filter: 'lowpass', filterFreq: 800 });
      noise({ dur: 0.8, vol: 0.26, filter: 'lowpass', freq: 600, freq2: 200 });
    },
  };

  A.sfx = function (name, a, b) {
    if (!A.enabled) return;
    const fn = SFX[name];
    if (fn) { try { fn(a, b); } catch (e) { /* ignore */ } }
  };

  /* ----------------------------------------------------------- MUSIC ---- */
  // Minor-key pirate motif. Simple scheduler; intensity raises tempo/layers.
  const SCALE = [0, 2, 3, 5, 7, 8, 10];        // natural minor
  const ROOTS = [110, 116.54, 98, 103.83, 87.31];
  const MELODY = [
    [0, 4], [2, 2], [4, 2], [6, 4], [4, 2], [2, 2],
    [1, 4], [3, 2], [5, 2], [4, 4], [2, 4],
    [0, 4], [2, 2], [4, 2], [7, 4], [6, 2], [4, 2],
    [5, 4], [3, 2], [1, 2], [0, 8],
  ];

  A.setIntensity = function (level) {
    A._bpm = 120 + level * 26;
  };

  function nf(root, deg, oct) {
    const d = ((deg % 7) + 7) % 7;
    const o = Math.floor(deg / 7) + (oct || 0);
    return root * Math.pow(2, o + SCALE[d] / 12);
  }

  function startMusicLoop() {
    if (A._musicTimer) return;
    const c = A.ctx;
    if (!c) return;
    A._step = 0;
    A._nextTime = c.currentTime + 0.15;

    A._musicTimer = setInterval(() => {
      if (!A.ctx || !A.musicOn) return;
      const now = A.ctx.currentTime;
      if (A._nextTime - now > 1.2) return;         // too far ahead, wait
      scheduleBar();
    }, 90);
  }

  function mnote(freq, dur, vol, type, when, filterFreq) {
    const c = A.ctx;
    const osc = c.createOscillator();
    osc.type = type || 'triangle';
    osc.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    let node = osc;
    if (filterFreq) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filterFreq;
      node.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(A.musicBus);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  }

  function mdrum(kind, when) {
    const c = A.ctx;
    if (kind === 'kick') {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(140, when);
      o.frequency.exponentialRampToValueAtTime(40, when + 0.14);
      const g = c.createGain();
      g.gain.setValueAtTime(0.5, when);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.2);
      o.connect(g); g.connect(A.musicBus);
      o.start(when); o.stop(when + 0.24);
    } else {
      const len = Math.floor(c.sampleRate * 0.09);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const s = c.createBufferSource();
      s.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = kind === 'hat' ? 7000 : 1800;
      const g = c.createGain();
      g.gain.value = kind === 'hat' ? 0.09 : 0.2;
      s.connect(f); f.connect(g); g.connect(A.musicBus);
      s.start(when); s.stop(when + 0.1);
    }
  }

  function scheduleBar() {
    const c = A.ctx;
    const spb = 60 / A._bpm;               // seconds per beat
    const beat = A._step;
    const rootIdx = Math.floor(beat / 16) % ROOTS.length;
    const root = ROOTS[rootIdx];
    const t = A._nextTime;
    const intense = A._bpm > 138;

    // bass on every beat
    const bassDeg = [0, 0, 3, 3, 5, 5, 4, 4][beat % 8];
    mnote(nf(root, bassDeg, -1), spb * 0.9, 0.16, 'sawtooth', t, 500);

    // drums
    if (beat % 4 === 0 || beat % 8 === 7) mdrum('kick', t);
    if (beat % 4 === 2 || (beat % 8 === 5 && intense)) mdrum('snare', t);
    if (intense) mdrum('hat', t + spb * 0.5);

    // melody / arpeggio
    const mi = beat % MELODY.length;
    const [deg, len] = MELODY[mi];
    const dur = spb * len * 0.5;
    mnote(nf(root, deg, 1), dur, 0.075, intense ? 'square' : 'triangle', t, 2400);
    if (intense) mnote(nf(root, deg + 2, 1), dur, 0.04, 'triangle', t, 2400);

    A._nextTime += spb;
    A._step = (A._step + 1) % (MELODY.length * 2);
  }

  /* -------------------------------------------------- master controls --- */
  A.toggle = function () {
    A.enabled = !A.enabled;
    if (A.master) A.master.gain.value = A.enabled ? 0.9 : 0;
    return A.enabled;
  };
  A.toggleMusic = function () {
    A.musicOn = !A.musicOn;
    if (A.musicBus) {
      if (A.musicOn) { ac(); if (A.ctx.state === 'suspended') A.ctx.resume(); fade(A.musicBus.gain, 0.22, 0.4); startMusicLoop(); }
      else fade(A.musicBus.gain, 0.0, 0.3);
    }
    return A.musicOn;
  };

  global.OPF = global.OPF || {};
  global.OPF.Audio = A;
})(window);
