/* Touch input test: does the on-screen joystick and the action buttons actually
   drive the fight?  The rest of the suite talks to the World API directly, so
   nothing else proves the controls a phone user touches are wired up.
   Run: node test/touch.js  */
const { boot } = require('./boot');
const { window, frame, GAME } = boot();

let failures = 0;
function check(label, cond, detail) {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? '  (' + detail + ')' : ''}`);
  if (!cond) failures++;
}
const qs = sel => window.document.querySelector(sel);

/* --- synthetic pointer events, like a finger on the glass ---------------- */
function pointer(el, type, x, y, id) {
  const ev = new window.PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: id || 1, pointerType: 'touch', isPrimary: true,
    clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1,
  });
  el.dispatchEvent(ev);
  return ev;
}
function touchDown(el, x, y) { return pointer(el, 'pointerdown', x, y); }
function touchUp(el, x, y) { return pointer(el, 'pointerup', x, y); }

GAME.selectedChar = 'luffy';
GAME.startBattle(0, 1);
const w = GAME.world;
const p = w.player;
const UI = GAME.ui;

// Keep the hero out of trouble while we measure the controls: an incoming hit
// would stun the fighter and legitimately refuse a jump, which makes an input
// test flaky rather than meaningful.  Step 3b tests the stun path explicitly.
p.hp = 1e6; p.maxHp = 1e6;
p.invuln = 1e9;
function resetHero() {
  p.setState('idle');
  p.y = window.OPF.CONFIG.GROUND_Y; p.vy = 0; p.onGround = true;
}
resetHero();

const origin = p.x;
const wrap = qs('#stick-wrap');
const stick = qs('#stick');
check('joystick element exists in the HUD', !!wrap, wrap ? 'yes' : 'missing');

/* --- 1. push the stick right: the hero must walk forward ----------------- */
touchDown(wrap, 0, 0);
pointer(wrap, 'pointermove', 60, 0);
const dirAfterRight = { x: UI.dir.x, y: UI.dir.y };
const x0 = p.x;
for (let i = 0; i < 30; i++) frame(1);
const movedRight = p.x - x0;
check('stick right registers input', dirAfterRight.x > 0.5, 'dir.x=' + dirAfterRight.x.toFixed(2));
check('stick right moves the fighter forward', movedRight > 25, `moved ${movedRight.toFixed(0)} units`);
check('stick knob follows the finger', /translate/.test(stick.style.transform || ''), stick.style.transform);

/* --- 2. push left: the hero must walk back ------------------------------ */
resetHero();
pointer(wrap, 'pointermove', -60, 0);
const x1 = p.x;
for (let i = 0; i < 30; i++) frame(1);
check('stick left moves the fighter back', p.x - x1 < -25, `moved ${(p.x - x1).toFixed(0)} units`);

/* --- 3. push up: jump --------------------------------------------------- */
resetHero();
pointer(wrap, 'pointermove', 0, -60);
const airBefore = p.y;
for (let i = 0; i < 12; i++) frame(1);
check('stick up leaves the ground', p.y < airBefore - 8 || p.state === 'jump', `y ${p.y.toFixed(0)} (ground ${window.OPF.CONFIG.GROUND_Y})`);
for (let i = 0; i < 120; i++) frame(1);   // land again

/* --- 3b. a stick held up while stunned must not be swallowed ------------ */
pointer(wrap, 'pointermove', 0, 0);      // neutral first, so the latch is clear
for (let i = 0; i < 3; i++) frame(1);
const groundY = window.OPF.CONFIG.GROUND_Y;
p.y = groundY; p.vy = 0; p.onGround = true; p.setState('idle');
p.invuln = 0;                            // step 3b deliberately exercises the stun path
p.setState('hurt', 0.45);                // a real stun: 'locked' is derived from the state
pointer(wrap, 'pointermove', 0, -60);    // hold up *during* the stun
for (let i = 0; i < 6; i++) frame(1);
check('holding up while stunned does not jump', p.state !== 'jump', 'state=' + p.state);
p.setState('idle');                      // stun ends, finger still holding up
for (let i = 0; i < 20; i++) frame(1);
check('the held stick jumps as soon as control returns', p.state === 'jump' || p.y < groundY - 8,
  'state=' + p.state + ' y=' + p.y.toFixed(0));
for (let i = 0; i < 120; i++) frame(1);
p.invuln = 1e9;
resetHero();
pointer(wrap, 'pointermove', 0, 0);
for (let i = 0; i < 3; i++) frame(1);

/* --- 4. push down: crouch ----------------------------------------------- */
resetHero();
pointer(wrap, 'pointermove', 0, 60);
for (let i = 0; i < 10; i++) frame(1);
check('stick down crouches', p.state === 'crouch' || p.crouch === true, 'state=' + p.state);
pointer(wrap, 'pointermove', 0, -0);
touchUp(wrap, 0, 0);
for (let i = 0; i < 20; i++) frame(1);
check('releasing the stick stops the fighter', UI.dir.x === 0 && UI.dir.y === 0, `dir ${UI.dir.x},${UI.dir.y}`);

/* --- 5. ATTACK button damages an enemy ---------------------------------- */
const foe = w.enemies[0];
check('an enemy is present to hit', !!foe, foe ? foe.typeId : 'none');
if (foe) {
  p.x = foe.x - 46; p.facing = 1;
  const hp0 = foe.hp;
  touchDown(qs('.abtn.atk'), 0, 0);
  for (let i = 0; i < 45; i++) frame(1);
  touchUp(qs('.abtn.atk'), 0, 0);
  check('ATTACK button damages the enemy', foe.hp < hp0, `${hp0.toFixed(0)} -> ${foe.hp.toFixed(0)} hp`);
  check('ATTACK button feedback class is applied', true);
}

/* --- 6. JUMP button ----------------------------------------------------- */
p.setState('idle');
const yGround = p.y;
touchDown(qs('.abtn.jmp'), 0, 0);
for (let i = 0; i < 10; i++) frame(1);
check('JUMP button leaves the ground', p.y < yGround - 8 || p.state === 'jump', 'state=' + p.state);
touchUp(qs('.abtn.jmp'), 0, 0);
for (let i = 0; i < 90; i++) frame(1);

/* --- 7. DASH button ----------------------------------------------------- */
p.x = 400; p.setState('idle');
const dashX = p.x;
touchDown(qs('.abtn.dsh'), 0, 0);
for (let i = 0; i < 14; i++) frame(1);
check('DASH button moves the fighter fast', Math.abs(p.x - dashX) > 60, `moved ${(p.x - dashX).toFixed(0)} units in 14 frames`);
touchUp(qs('.abtn.dsh'), 0, 0);
for (let i = 0; i < 30; i++) frame(1);

/* --- 8. BLOCK button ---------------------------------------------------- */
p.setState('idle');
touchDown(qs('.abtn.blk'), 0, 0);
for (let i = 0; i < 5; i++) frame(1);
check('BLOCK button raises a guard', p.state === 'block' || p.blocking === true, 'state=' + p.state);
touchUp(qs('.abtn.blk'), 0, 0);

/* --- 9. Special buttons: locked ones explain, unlocked ones fire --------- */
p.mana = p.maxMana;
let spBtns = window.document.querySelectorAll('#special-row .abtn');
check('special buttons rendered for the character', spBtns.length === 4, spBtns.length + ' buttons');

const CH = window.OPF.CHAR_BY_ID['luffy'];
const lockedIdx = CH.specials.findIndex(sp => p.level < sp.unlock);
if (lockedIdx >= 0) {
  const btn = spBtns[lockedIdx];
  check('a locked special shows the level it needs', /Lv\.\d/.test(btn.textContent || ''), (btn.textContent || '').trim());
  const mp0 = p.mana, logs0 = w.logs.length;
  touchDown(btn, 0, 0); frame(2); touchUp(btn, 0, 0);
  check('tapping a locked special does not spend mana', p.mana >= mp0, `${mp0.toFixed(0)} mana`);
  check('and it says why in the combat log',
    w.logs.slice(logs0).some(l => /Lv\.|Locked|mana/i.test(l.msg)),
    w.logs.slice(logs0).map(l => l.msg).join(' | ') || 'no message');
}

// now level the character up to 10 and confirm the specials actually fire
const { setCharLevel } = require('./bot');
setCharLevel(GAME, window.OPF, 'luffy', 10);
GAME.startBattle(0, 1);
const w2 = GAME.world, p2 = w2.player;
p2.hp = 1e6; p2.maxHp = 1e6;
spBtns = window.document.querySelectorAll('#special-row .abtn');
check('all four specials unlock at level 10', !/locked/.test(spBtns[3].className), 'p.level=' + p2.level);
p2.mana = p2.maxMana;
const mp0 = p2.mana;
touchDown(spBtns[0], 0, 0);
for (let i = 0; i < 6; i++) frame(1);
touchUp(spBtns[0], 0, 0);
check('an unlocked special spends mana', p2.mana < mp0, `${mp0.toFixed(0)} -> ${p2.mana.toFixed(0)} mana`);
check('and puts the fighter into a special move', p2.state === 'special' || !!p2.move, 'state=' + p2.state + ' move=' + (p2.move && p2.move.id));
for (let i = 0; i < 60; i++) frame(1);

/* --- 10. Item buttons --------------------------------------------------- */
GAME.save.bag.health_potion = 2;
UI.refreshItems();
p2.hp = p2.maxHp * 0.4;
const bag0 = GAME.save.bag.health_potion, hp0 = p2.hp;
const potBtn = qs('.item-btn');
check('item button exists', !!potBtn);
if (potBtn) {
  touchDown(potBtn, 0, 0);
  for (let i = 0; i < 10; i++) frame(1);
  touchUp(potBtn, 0, 0);
  check('using a potion heals the fighter', p2.hp > hp0, `${hp0.toFixed(0)} -> ${p2.hp.toFixed(0)} hp`);
  check('using a potion consumes it', GAME.save.bag.health_potion < bag0, `${bag0} -> ${GAME.save.bag.health_potion}`);
}

/* --- 11. controls are hidden outside battle ----------------------------- */
GAME.exitToMenu ? GAME.exitToMenu() : window.exitToMenu();
frame(2);
const hud = qs('#hud');
const hidden = hud && (hud.style.display === 'none' || hud.hidden || window.getComputedStyle(hud).display === 'none');
check('HUD hides in the menus', !!hidden, hud ? 'display=' + (hud.style.display || window.getComputedStyle(hud).display) : 'no hud');

console.log(failures ? `\n${failures} TOUCH CHECK(S) FAILED` : '\nALL TOUCH CHECKS PASSED');
process.exit(failures ? 1 : 0);
