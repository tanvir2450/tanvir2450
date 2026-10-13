/* Navigation probe: walks the real UI flow by dispatching clicks, asserting that
   each screen actually renders and stays put (this is the class of bug that
   showScreen() overwriting the level grid used to cause).
   Run: node test/navigation.js */
const { boot } = require('./boot');
const { window, frame, GAME } = boot();
const doc = window.document;
const $ = (id) => doc.getElementById(id);
const qs = (sel) => doc.querySelector(sel);

let failures = 0;
function check(label, cond, detail) {
  const mark = cond ? 'ok  ' : 'FAIL';
  if (!cond) failures++;
  console.log(`  ${mark} ${label}${detail ? '  (' + detail + ')' : ''}`);
}
function click(el) {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  frame(2);
}
const btnByText = (sel, text) => Array.from(doc.querySelectorAll(sel))
  .find(b => (b.textContent || '').toUpperCase().includes(text.toUpperCase()));

console.log('MENU FLOW');
// main menu -> character select
click(btnByText('#main-menu .btn', 'START GAME'));
check('main menu hides', !$('main-menu').classList.contains('active'));
check('character select opens', $('character-select').classList.contains('active'));
check('6 character cards rendered', doc.querySelectorAll('.char-card').length === 6,
  doc.querySelectorAll('.char-card').length + ' cards');
check('ENTER BATTLE is enabled without tapping a card', !$('start-battle-btn').disabled);

// pick a character then start
click(doc.querySelectorAll('.char-card')[3]);
check('tapping a card selects it', GAME.selectedChar === 'usopp', GAME.selectedChar);
click($('start-battle-btn'));
check('level select opens', $('level-select').classList.contains('active'));
check('ENTER BATTLE jumps straight to a level grid',
  doc.querySelectorAll('.lvl-btn').length === 30, doc.querySelectorAll('.lvl-btn').length + ' tiles');

console.log('\nARC LIST -> LEVEL GRID (the regression)');
click($('back-to-arcs'));
const arcCards = doc.querySelectorAll('.arc-card');
check('5 arc cards rendered', arcCards.length === 5, arcCards.length + '');
// arc 1 is unlocked, so it should open its level grid
click(arcCards[0]);
const levelBtns = doc.querySelectorAll('.lvl-btn');
check('level grid rendered 30 levels', levelBtns.length === 30, levelBtns.length + ' buttons');
check('level grid survived navigation (arc list did not overwrite it)',
  !doc.querySelector('.arc-card'), doc.querySelector('.arc-card') ? 'arc cards still present' : 'grid intact');
check('level 1 is unlocked', !levelBtns[0].classList.contains('locked'));
check('level 2 is locked before clearing 1', levelBtns[1].classList.contains('locked'));
check('level 10 is a boss tile', levelBtns[9].classList.contains('boss'));
check('level 30 is a boss tile', levelBtns[29].classList.contains('boss'));

console.log('\nBACK TO ARCS, THEN INTO AN ARC AGAIN');
click($('back-to-arcs'));
check('arc list is back', doc.querySelectorAll('.arc-card').length === 5,
  doc.querySelectorAll('.arc-card').length + ' arc cards');
click(doc.querySelectorAll('.arc-card')[0]);
check('re-entering an arc renders levels again', doc.querySelectorAll('.lvl-btn').length === 30,
  doc.querySelectorAll('.lvl-btn').length + ' buttons');

console.log('\nSTARTING A BATTLE AND RETURNING AFTER A WIN');
const lvl1 = doc.querySelectorAll('.lvl-btn')[0];
click(lvl1);
check('battle started', !!GAME.world, GAME.world ? 'level ' + GAME.world.level : 'no world');
check('HUD is visible during battle', $('hud').style.display !== 'none');

// force a win and continue
const w = GAME.world;
w.enemies.forEach(e => { e.hp = 0; e.dead = true; });
w.isBoss = false;
w.waveIndex = w.waves.length - 1;
w.clearTimer = 0.01;
for (let i = 0; i < 240 && !w.over; i++) frame(1);
check('battle resolved as victory', w.result === 'victory', String(w.result));
check('result overlay shown', $('result-overlay').classList.contains('active'));
click(qs('#result-overlay .btn'));
check('after victory we return to the LEVEL GRID (not the arc list)',
  doc.querySelectorAll('.lvl-btn').length === 30, doc.querySelectorAll('.lvl-btn').length + ' level buttons');
check('level 1 now shows as cleared',
  doc.querySelectorAll('.lvl-btn')[0].classList.contains('cleared'));
check('level 2 is now unlocked',
  !doc.querySelectorAll('.lvl-btn')[1].classList.contains('locked'));

console.log('\nSHOP & CODEX');
GAME.showScreen('shop-screen');
check('shop opened', $('shop-screen').classList.contains('active'));
check('upgrade rows rendered for all 6 characters',
  doc.querySelectorAll('#upgrade-list .upgrade-item').length === 6,
  doc.querySelectorAll('#upgrade-list .upgrade-item').length + '');
click(doc.querySelector('.shop-tab[data-tab="consumables"]'));
check('consumables tab shows the list',
  $('consumable-list').style.display !== 'none' && doc.querySelectorAll('.consumable-item').length === 5,
  doc.querySelectorAll('.consumable-item').length + ' items');
GAME.showScreen('codex-screen');
check('codex opened', $('codex-screen').classList.contains('active'));
check('codex lists all bosses', (doc.getElementById('codex-list').innerHTML.match(/upgrade-item/g) || []).length >= 15);

console.log('\nPAUSE / RESTART / EXIT');
click(btnByText('#main-menu .btn', 'START GAME'));
click($('start-battle-btn'));
click(doc.querySelectorAll('.lvl-btn')[0]);
click($('pause-btn'));
check('pause overlay opens', $('pause-overlay').classList.contains('active'));
click(btnByText('#pause-overlay .btn', 'RESUME'));
check('pause overlay closes', !$('pause-overlay').classList.contains('active'));
click($('pause-btn'));
click(btnByText('#pause-overlay .btn', 'MAIN MENU'));
check('exit to main menu works', $('main-menu').classList.contains('active'));
check('HUD hidden in menus', $('hud').style.display === 'none');

console.log('\nSCREEN SCROLLABILITY (tall menus must not clip their buttons)');
const css = Array.from(doc.querySelectorAll('style')).map(s => s.textContent).join('\n');
const screenRule = css.slice(css.indexOf('.screen {'), css.indexOf('.screen > *'));
check('.screen scrolls vertically', /overflow-y:\s*auto/.test(screenRule));
check('.screen uses safe centering so tall content scrolls from the top',
  /justify-content:\s*safe center/.test(screenRule));
check('.screen reserves safe-area padding', /safe-area-inset-bottom/.test(screenRule));
check('screen children cannot be squashed', /\.screen > \* \{[^}]*flex-shrink:\s*0/.test(css));
check('phone media query tightens the level grid', /minmax\(74px/.test(css));

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL NAVIGATION CHECKS PASSED');
process.exit(failures ? 1 : 0);
