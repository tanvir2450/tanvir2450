/* Balance / fairness check for Neon Chase.
   ---------------------------------------------------------------------
   A scripted player (tools/bot.mjs) plays real games and we look at the
   shape of the data rather than at "did the bot win", because the bot is
   a crude proxy for a human — it reads one junction ahead, not a plan.
   What we *can* assert meaningfully:

     - progress:   the bot collects dots while being hunted
     - fairness:   nobody dies seconds after spawning (no spawn camping,
                   no unfair traps at the start of a life)
     - threat:     the hunters do eventually punish greedy play
     - pressure:   slowing the hunters down must measurably help (proves
                   the chase is a chase and not a coin flip)

   Usage: node tools/balance-test.mjs [--runs N]
*/
import fs from 'node:fs';
import path from 'node:path';
import { makeHarness } from './harness.mjs';
import { makeBot } from './bot.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const code = fs.readFileSync(path.join(root, 'src/game.js'), 'utf8');
const args = process.argv.slice(2);
const runsArg = args.indexOf('--runs');
const RUNS = runsArg >= 0 ? parseInt(args[runsArg + 1], 10) : 4;
const DT = 1 / 60;

/** Play one game with the scripted player. Returns per-life telemetry. */
function playOne(codeText, seed, botOpts = {}) {
  const api = makeHarness(codeText);
  const game = api.game;
  game.manual = true;
  const bot = makeBot(api, { seed, ...botOpts });
  const lives = [];
  let lifeStart = 0;
  let lifeEaten = 0;
  let frames = 0;
  let lastState = game.state;

  api.start();
  for (; frames < 60 * 60 * 15; frames++) {
    bot.think();
    api.step(DT);
    if (game.state !== lastState) {
      if (game.state === 'dying') {
        lives.push({ seconds: (frames - lifeStart) / 60, eaten: game.dotsEaten - lifeEaten, score: game.score });
        lifeStart = frames;
        lifeEaten = game.dotsEaten;
      }
      if (game.state === 'gameover') break;
      lastState = game.state;
    }
  }
  return { game, lives, frames };
}

const stats = (list) => {
  const n = list.length;
  if (!n) return { n: 0, avg: 0, min: 0, max: 0 };
  const avg = list.reduce((a, b) => a + b, 0) / n;
  return { n, avg, min: Math.min(...list), max: Math.max(...list) };
};

const greedy = [];
const gentle = [];
const gentleCode = code.replace('hunter: 6.1, hunterStep: 0.26, hunterMax: 8.9,', 'hunter: 5.2, hunterStep: 0.26, hunterMax: 8.9,');

for (let r = 0; r < RUNS; r++) greedy.push(playOne(code, 1000 + r * 777));
for (let r = 0; r < RUNS; r++) gentle.push(playOne(gentleCode, 1000 + r * 777));

const lifeTimes = greedy.flatMap((g) => g.lives.map((l) => l.seconds));
const lifeEaten = greedy.flatMap((g) => g.lives.map((l) => l.eaten));
const t = stats(lifeTimes);
const e = stats(lifeEaten);
const gentleTimes = stats(gentle.flatMap((g) => g.lives.map((l) => l.seconds)));

console.log('balance report');
console.log(`  ${RUNS} games with the scripted player (crude but cautious)`);
console.log(`  lives played     : ${t.n}`);
console.log(`  life length      : avg ${t.avg.toFixed(1)}s · shortest ${t.min.toFixed(1)}s · longest ${t.max.toFixed(1)}s`);
console.log(`  dots per life    : avg ${e.avg.toFixed(0)} of 244`);
console.log(`  final scores     : ${greedy.map((g) => g.game.score).join(', ')}`);
console.log(`  dots left on board: ${greedy.map((g) => g.game.dotsLeft).join(', ')}`);
console.log(`  same bot vs slower hunters (5.2 t/s): avg life ${gentleTimes.avg.toFixed(1)}s (vs ${t.avg.toFixed(1)}s)`);

const fails = [];
if (t.n < RUNS) fails.push(`only ${t.n} lives played across ${RUNS} games — the loop may be broken`);
if (e.avg < 20) fails.push(`the bot averages only ${e.avg.toFixed(0)} dots per life — being hunted makes progress impossible`);
if (t.min < 6) fails.push(`a life lasted only ${t.min.toFixed(1)}s — the disc can be caught almost immediately after spawning`);
if (t.avg < 12) fails.push(`average life is ${t.avg.toFixed(1)}s — the disc has no room to breathe`);
if (t.n && !lifeTimes.some((s) => s > 0)) fails.push('no life ever ended — hunters never catch anyone');
if (t.n < RUNS * 2) fails.push(`only ${t.n} deaths in ${RUNS} games — the hunters may be too soft`);
if (gentleTimes.avg <= t.avg) fails.push('slower hunters did not extend lives — speed is not actually driving the chase');

if (fails.length) {
  console.error('\nFAILURES:');
  for (const f of fails) console.error(' - ' + f);
  process.exit(1);
}
console.log('\nOK: progress is possible, the press is real, and slower hunters measurably help.');
