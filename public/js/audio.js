/**
 * Procedural SFX via WebAudio — zero asset weight, mobile friendly.
 */
let ctx = null;
let master = null;
let volume = 0.7;
let noiseBuf = null;

export function initAudio() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);

  // shared 1s noise buffer
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

export function setVolume(v) {
  volume = v;
  if (master) master.gain.value = v;
}

export function resume() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

function now() {
  return ctx.currentTime;
}

function env(gainNode, t0, peak, attack, decay) {
  gainNode.gain.setValueAtTime(0.0001, t0);
  gainNode.gain.linearRampToValueAtTime(peak, t0 + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}

function noiseShot({ peak = 0.5, decay = 0.12, freq = 1200, q = 1, type = 'bandpass', attack = 0.002 }) {
  if (!ctx) return;
  const t0 = now();
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = ctx.createGain();
  env(g, t0, peak, attack, decay);
  src.connect(filter).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + attack + decay + 0.05);
}

function tone({ freq = 440, endFreq = null, peak = 0.3, decay = 0.15, type = 'sine', attack = 0.002 }) {
  if (!ctx) return;
  const t0 = now();
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + decay);
  const g = ctx.createGain();
  env(g, t0, peak, attack, decay);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + attack + decay + 0.05);
}

const sfx = {
  ak() {
    noiseShot({ peak: 0.5, decay: 0.11, freq: 900, q: 0.8 });
    tone({ freq: 180, endFreq: 60, peak: 0.35, decay: 0.09, type: 'square' });
  },
  mg() {
    noiseShot({ peak: 0.38, decay: 0.07, freq: 1400, q: 0.7 });
    tone({ freq: 220, endFreq: 90, peak: 0.22, decay: 0.05, type: 'square' });
  },
  sniper() {
    noiseShot({ peak: 0.65, decay: 0.28, freq: 500, q: 0.5, type: 'lowpass' });
    tone({ freq: 90, endFreq: 38, peak: 0.55, decay: 0.24, type: 'square' });
    tone({ freq: 2400, endFreq: 500, peak: 0.18, decay: 0.1, type: 'triangle' });
  },
  plasma() {
    tone({ freq: 880, endFreq: 160, peak: 0.32, decay: 0.18, type: 'sawtooth' });
    tone({ freq: 1760, endFreq: 320, peak: 0.12, decay: 0.12, type: 'triangle' });
  },
  explosion() {
    noiseShot({ peak: 0.85, decay: 0.55, freq: 220, q: 0.4, type: 'lowpass', attack: 0.004 });
    tone({ freq: 110, endFreq: 28, peak: 0.6, decay: 0.45, type: 'square' });
    noiseShot({ peak: 0.3, decay: 0.25, freq: 2600, q: 0.6, attack: 0.01 });
  },
  hit() {
    tone({ freq: 1320, endFreq: 660, peak: 0.22, decay: 0.06, type: 'triangle' });
  },
  headshot() {
    tone({ freq: 1760, endFreq: 880, peak: 0.3, decay: 0.1, type: 'triangle' });
    tone({ freq: 2640, endFreq: 1320, peak: 0.18, decay: 0.12, type: 'sine' });
  },
  hurt() {
    noiseShot({ peak: 0.3, decay: 0.12, freq: 500, q: 0.8, type: 'lowpass' });
  },
  reload() {
    tone({ freq: 420, endFreq: 300, peak: 0.18, decay: 0.05, type: 'square' });
    setTimeout(() => tone({ freq: 520, endFreq: 380, peak: 0.2, decay: 0.06, type: 'square' }), 140);
    setTimeout(() => noiseShot({ peak: 0.22, decay: 0.07, freq: 1800, q: 1.2 }), 320);
  },
  empty() {
    tone({ freq: 900, endFreq: 700, peak: 0.12, decay: 0.03, type: 'square' });
  },
  jump() {
    noiseShot({ peak: 0.12, decay: 0.1, freq: 700, q: 0.7 });
    tone({ freq: 300, endFreq: 520, peak: 0.12, decay: 0.1, type: 'sine' });
  },
  ui() {
    tone({ freq: 660, endFreq: 990, peak: 0.14, decay: 0.07, type: 'triangle' });
  },
  death() {
    tone({ freq: 340, endFreq: 70, peak: 0.35, decay: 0.6, type: 'sawtooth' });
    noiseShot({ peak: 0.25, decay: 0.5, freq: 300, q: 0.5, type: 'lowpass' });
  },
  kill() {
    tone({ freq: 520, endFreq: 780, peak: 0.22, decay: 0.12, type: 'triangle' });
    setTimeout(() => tone({ freq: 780, endFreq: 1170, peak: 0.2, decay: 0.14, type: 'triangle' }), 110);
  },
};

export function play(name) {
  if (!ctx || volume <= 0) return;
  const fn = sfx[name];
  if (fn) {
    try {
      fn();
    } catch {
      /* audio hiccup — never break the game */
    }
  }
}
