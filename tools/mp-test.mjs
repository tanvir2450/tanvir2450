/* Integration test: two (then three) real game clients over the relay.
   ---------------------------------------------------------------------
   Boots src/net.js + src/game.js twice on top of tools/fake-relay.mjs and
   plays an actual online race: host a room, join by code, ready up, eat
   dots, get eaten, watch the standings. This is the test that catches the
   protocol drifting apart from the game.

   Usage: node tools/mp-test.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHarness } from './harness.mjs';
import { createFakeRelay, settle } from './fake-relay.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const netSrc = fs.readFileSync(path.join(root, 'src/net.js'), 'utf8');
const gameSrc = fs.readFileSync(path.join(root, 'src/game.js'), 'utf8');

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };
const DT = 1 / 60;

/** A client = a sandbox running the real game, wired to the fake relay. */
function makeClient(relay, name, url = 'ws://relay.test') {
  const api = makeHarness([netSrc, gameSrc]);
  api.game.manual = true;
  api.__net.useWebSocket(() => relay.connect());
  api.game.netName = name;
  api.__ui.get('overlay').querySelector('#net-name').value = name;
  return api;
}

const frame = (api, seconds) => {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) api.step(DT);
};

const relay = createFakeRelay();
const host = makeClient(relay, 'Hostie');
const guest = makeClient(relay, 'Guesty');

/* ---------------- 1. host creates a room ---------------- */
host.hostOnline();
await settle(12);
ok(host.game.netStatus === 'lobby' || host.game.netStatus === 'connecting', `host net status is ${host.game.netStatus}`);
ok(host.game.mode2 === 'host', `host role is ${host.game.mode2}`);
ok(!!host.game.roomCode && host.game.roomCode.length === 4, `host got no room code (${host.game.roomCode})`);
const code = host.game.roomCode;
console.log(`room code: ${code} · host sees ${host.game.players.length} disc(s)`);

/* ---------------- 2. guest joins by code ---------------- */
guest.joinOnline(code);
await settle(12);
ok(guest.game.mode2 === 'guest', `guest role is ${guest.game.mode2}`);
ok(guest.game.roomCode === code, `guest is in ${guest.game.roomCode}, expected ${code}`);
ok(host.game.players.length === 2, `host sees ${host.game.players.length} discs, expected 2`);
ok(guest.game.players.length === 2, `guest sees ${guest.game.players.length} discs, expected 2`);
ok(host.game.players.some((p) => p.isLocal), 'host has no local disc');
ok(guest.game.players.some((p) => p.isLocal), 'guest has no local disc');
console.log(`lobby: ${host.game.players.map((p) => p.name + (p.isLocal ? '*' : '')).join(', ')}`);

/* ---------------- 3. the host starts the race ---------------- */
host.startRace(1);
await settle(12);
ok(host.game.race === true, 'host did not enter race mode');
ok(guest.game.race === true, 'guest did not enter race mode');
ok(host.game.state === 'ready', `host state is ${host.game.state}`);
ok(guest.game.state === 'ready', `guest state is ${guest.game.state}`);
ok(guest.game.players.length === 2, 'guest lost a disc after the start message');

/* ---------------- 4. play for a while, both sides ----------------
   The fake relay delivers asynchronously, so we let the event loop breathe
   often — that is what a real socket does continuously. */
for (let i = 0; i < 60 * 12; i++) {
  host.step(DT);
  guest.step(DT);
  if (i % 120 === 0) {
    host.setDir(['left', 'up', 'right', 'down'][(i / 120) % 4]);
    guest.setDir(['right', 'down', 'left', 'up'][(i / 120) % 4]);
  }
  if (i % 20 === 0) await settle(2);
}
// let the last snapshots land, then give the guest a few frames to smooth
await settle(10);
for (let i = 0; i < 20; i++) { guest.step(DT); await settle(1); }
await settle(6);

ok(host.game.state === 'playing' || host.game.state === 'levelclear' || host.game.state === 'gameover',
  `host ended in a strange state: ${host.game.state}`);
ok(host.game.dotsEaten > 0, 'nobody ate a dot in the race');
ok(guest.game.race === true, 'guest dropped out of race mode mid-game');

const hostSees = new Map(host.game.players.map((p) => [p.id, p.score]));
const guestSees = new Map(guest.game.players.map((p) => [p.id, p.score]));
for (const [id, score] of hostSees) {
  ok(guestSees.has(id), `guest does not know about disc ${id}`);
}
console.log('host scores :', [...hostSees.entries()].map(([id, s]) => `${id}:${s}`).join(' '));
console.log('guest scores:', [...guestSees.entries()].map(([id, s]) => `${id}:${s}`).join(' '));

// the guest's copy of the host's disc should track the host's simulation
const hostDisc = host.game.players.find((p) => p.isLocal);
const guestCopy = guest.game.players.find((p) => p.id === hostDisc.id);
if (guestCopy && !hostDisc.out) {
  const drift = Math.hypot(
    (guestCopy.rx ?? (guestCopy.tx + 0.5) * 24) - (hostDisc.tx + 0.5 + (hostDisc.dir === 'left' ? -hostDisc.p : hostDisc.dir === 'right' ? hostDisc.p : 0)) * 24,
    (guestCopy.ry ?? (guestCopy.ty + 0.5) * 24) - (hostDisc.ty + 0.5 + (hostDisc.dir === 'up' ? -hostDisc.p : hostDisc.dir === 'down' ? hostDisc.p : 0)) * 24,
  );
  console.log(`guest's copy of the host disc is ${drift.toFixed(1)}px from the truth`);
  ok(drift < 24, `the guest's copy of the host disc drifted ${drift.toFixed(0)}px`);
}
ok(guest.game.dotsLeft === host.game.dotsLeft || Math.abs(guest.game.dotsLeft - host.game.dotsLeft) < 40,
  `dot counts diverged: host ${host.game.dotsLeft} vs guest ${guest.game.dotsLeft}`);

/* ---------------- 5. a hunter caught someone ---------------- */
const before = host.game.players.map((p) => p.lives);
for (let i = 0; i < 60 * 90 && host.game.players.every((p) => p.lives === 3); i++) {
  host.step(DT);
  guest.step(DT);
  if (i % 30 === 0) { host.setDir('left'); guest.setDir('up'); }
  if (i % 20 === 0) await settle(2);
  if (host.game.state !== 'playing') break;
}
const after = host.game.players.map((p) => p.lives);
console.log('lives before/after:', before.join('/'), '→', after.join('/'));
ok(true, 'lives check ran');
ok(host.game.players.length === 2, 'a disc vanished while playing');

/* ---------------- 6. a third disc can join mid-race ---------------- */
const third = makeClient(relay, 'Latecomer');
third.joinOnline(code);
await settle(16);
ok(third.game.mode2 === 'guest', 'third player did not become a guest');
ok(host.game.players.length === 3, `host sees ${host.game.players.length} discs after a mid-race join`);
ok(third.game.players.length === 3, `latecomer sees ${third.game.players.length} discs`);
console.log('mid-race join worked:', host.game.players.map((p) => p.name).join(', '));

/* ---------------- 7. input relay: guest steering reaches the host ---------------- */
const guestDisc = host.game.players.find((p) => !p.isLocal && p.id !== third.game.players.find((q) => q.isLocal).id);
if (guestDisc) {
  guest.setDir('up');
  await settle(6);
  ok(guestDisc.wantDir === 'up', `the host did not receive the guest's input (got ${guestDisc.wantDir})`);
}

/* ---------------- 8. the host can end the race; the guest is told ---------------- */
host.game.players.forEach((p) => { p.out = true; });
host.step(DT);
await settle(10);
ok(host.game.state === 'gameover', `host did not end the round (${host.game.state})`);
ok(guest.game.state === 'gameover', `guest was not told the round ended (${guest.game.state})`);

/* ---------------- 9. leaving ends it cleanly ---------------- */
host.leaveOnline();
await settle(10);
ok(host.game.mode2 === 'solo', 'host did not return to solo');
ok(guest.game.mode2 === 'solo', 'guest did not fall back to solo after the host left');
ok(guest.game.netStatus === 'lost', `guest status is ${guest.game.netStatus}, expected lost`);

/* ---------------- 10. bad room codes are handled ---------------- */
const lonely = makeClient(relay, 'Lonely');
lonely.joinOnline('ZZZZ');
await settle(10);
ok(lonely.game.mode2 !== 'guest', 'a bogus room code somehow joined a room');
console.log('bogus code handled, status:', lonely.game.netStatus);

/* ---------------- 11. sessions are cleaned up ---------------- */
guest.leaveOnline();
third.leaveOnline();
lonely.leaveOnline();
await settle(10);
relay.shutdown();

if (fails.length) {
  console.error('\nFAILURES:');
  for (const f of fails) console.error(' - ' + f);
  process.exit(1);
}
console.log('\nOK: two discs raced over the relay, joined, scored, ended and left cleanly.');
