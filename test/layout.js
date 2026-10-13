/* Layout probe: parses the control-sizing CSS out of the live UI stylesheet and
   proves that the joystick and the action pad fit side by side on real devices.
   Run: node test/layout.js */
const { boot } = require('./boot');
const { window, GAME } = boot();
const doc = window.document;

let failures = 0;
function check(label, cond, detail) {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) failures++;
}

const css = Array.from(doc.querySelectorAll('style')).map(s => s.textContent).join('\n');

/* --- pull the numbers straight out of the stylesheet ------------------- */
function grabVar(name) {
  const m = css.match(new RegExp('--' + name + ':\\s*([^;]+);'));
  return m ? m[1].trim() : null;
}
function clampBounds(expr) {
  // returns {min, vw, max} for clamp(min, Nvw, max)
  const m = expr.match(/clamp\(\s*([\d.]+)px\s*,\s*([\d.]+)vw\s*,\s*([\d.]+)px\s*\)/);
  if (!m) return null;
  return { min: +m[1], vw: +m[2] / 100, max: +m[3] };
}
function clampPx(expr, w, h) {
  // handles min(clamp(...), Nvh) and clamp(...)
  const minWrap = expr.match(/min\(\s*clamp\([^)]*\)\s*,\s*([\d.]+)vh\s*\)/);
  const b = clampBounds(expr);
  if (!b) return null;
  let v = Math.min(b.max, Math.max(b.min, b.vw * w));
  if (minWrap) v = Math.min(v, (+minWrap[1] / 100) * h);
  return v;
}

const vars = {};
['stick', 'padb', 'padx', 'gap', 'btn', 'btn-atk', 'btn-sp'].forEach(k => { vars[k] = grabVar(k); });
check('control CSS variables are declared', Object.values(vars).every(Boolean),
  Object.entries(vars).map(([k, v]) => k + '=' + v).join(' '));

const btn = clampBounds(vars['btn']);
const atk = clampBounds(vars['btn-atk']);
const sp = clampBounds(vars['btn-sp']);
const padx = clampBounds(vars['padx']);
const gapB = clampBounds(vars['gap']);
check('all button sizes are viewport-relative clamps', !!(btn && atk && sp && padx && gapB));
check('joystick is viewport-relative and height-capped',
  /min\(clamp/.test(vars['stick']) && /vh/.test(vars['stick']), vars['stick']);
check('the action pad and joystick cannot shrink below usable touch sizes',
  btn.min >= 44 && sp.min >= 42 && atk.min >= 54, `btn>=${btn.min} sp>=${sp.min} atk>=${atk.min}`);
check('.controls no longer hard-codes a pixel padding',
  /\.controls \{[^}]*padding:\s*8px var\(--padx\) var\(--padb\)/.test(css));
check('item buttons scale too', /\.item-btn \{[^}]*clamp\(/.test(css));
check('no fixed-size control overrides remain in media queries',
  !/\.abtn \{ width:\d+px/.test(css) && !/\.stick-wrap \{ width:\d+px/.test(css));

/* --- simulate the flex row for real device sizes ---------------------- */
const devices = [
  ['iPhone SE portrait', 320, 568], ['common Android', 360, 640], ['iPhone 14 portrait', 390, 844],
  ['iPhone 14 Pro Max', 430, 932], ['small landscape', 640, 360], ['iPhone landscape', 844, 390],
  ['tablet portrait', 834, 1112], ['desktop 1280x720', 1280, 720],
];
console.log('\n  device                    w    h   stick    pad  needed  verdict');
for (const [name, w, h] of devices) {
  const stick = clampPx(vars['stick'], w, h);
  const g = clampPx(vars['gap'], w, h);
  const px = clampPx(vars['padx'], w, h);
  const b = clampPx(vars['btn'], w, h);
  const a = clampPx(vars['btn-atk'], w, h);
  const s = clampPx(vars['btn-sp'], w, h);
  const spRow = 4 * s + 3 * g;
  const actRow = 3 * b + 2 * g + a + g;
  const pad = Math.max(spRow, actRow);
  const needed = stick + pad + 2 * px + g;      // + gap between the two clusters
  const fits = needed <= w;
  const stackFits = stick + 2 * px <= w;
  if (!fits) failures++;
  console.log(`  ${name.padEnd(22)} ${String(w).padStart(4)} ${String(h).padStart(4)}  ${stick.toFixed(0).padStart(5)} ${pad.toFixed(0).padStart(6)} ${needed.toFixed(0).padStart(7)}  ${fits ? 'fits' : 'OVERLAP'}`);
  check(`${name}: joystick fits within the screen width`, stackFits,
    `${stick.toFixed(0)}px + ${(2 * px).toFixed(0)}px padding in ${w}px`);
  // control stack must also leave room vertically for the fight
  const vertUsed = clampPx(vars['padb'], w, h) + stick + 8;
  if (vertUsed > h * 0.45) failures++;
  check(`${name}: controls take less than 45% of the screen height`, vertUsed <= h * 0.45,
    `${vertUsed.toFixed(0)}px of ${h}px`);
}

console.log(failures ? `\n${failures} LAYOUT CHECK(S) FAILED` : '\nALL LAYOUT CHECKS PASSED');
process.exit(failures ? 1 : 0);
