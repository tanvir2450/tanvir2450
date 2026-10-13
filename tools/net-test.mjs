/* Server test: boots the real server.js as a child process and talks to it
   over a real TCP socket with Node's built-in WebSocket client.
   ---------------------------------------------------------------------
   Covers the parts the in-memory relay cannot: the HTTP file server, the
   RFC 6455 handshake, frame encoding/lengths (including >64 KB payloads),
   room codes, membership changes, host departure and the capacity limit.

   Usage: node tools/net-test.mjs
*/
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3400 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}`;

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- start the server ---------------- */
const child = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d.toString(); });
child.stderr.on('data', (d) => { serverLog += d.toString(); });

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return true;
    } catch (err) { /* not up yet */ }
    await sleep(50);
  }
  return false;
}

function cleanup(code) {
  try { child.kill('SIGKILL'); } catch (err) { /* ignore */ }
  process.exit(code);
}

if (!(await waitForServer())) {
  console.error('server never came up. log:\n' + serverLog);
  cleanup(1);
}
console.log(`server up on ${BASE}`);

/* ---------------- a tiny promise-wrapped client ---------------- */
function connectClient(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const inbox = [];
    const waiters = [];
    const client = {
      ws,
      name,
      inbox,
      closed: false,
      closeCode: null,
      send(obj) { ws.send(JSON.stringify(obj)); },
      /** Wait for the next message matching `pred`. */
      next(pred, timeoutMs = 2000) {
        const match = (m) => (pred ? pred(m) : true);
        const i = inbox.findIndex(match);
        if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
        return new Promise((res, rej) => {
          const timer = setTimeout(() => rej(new Error(`timeout waiting for ${pred || 'a message'} (${name})`)), timeoutMs);
          waiters.push({ pred: match, res: (m) => { clearTimeout(timer); res(m); } });
        });
      },
      close() { try { ws.close(); } catch (err) { /* ignore */ } },
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      const i = waiters.findIndex((w) => w.pred(msg));
      if (i >= 0) { const w = waiters.splice(i, 1)[0]; w.res(msg); return; }
      inbox.push(msg);
    };
    ws.onopen = () => {
      client.send({ t: 'hello', name, v: 1 });
      resolve(client);
    };
    ws.onclose = (ev) => { client.closed = true; client.closeCode = ev.code; };
    ws.onerror = () => reject(new Error(`socket error for ${name}`));
  });
}

/* ---------------- 1. static files ---------------- */
const page = await fetch(`${BASE}/`);
const pageText = await page.text();
ok(page.status === 200, `GET / returned ${page.status}`);
ok(/text\/html/.test(page.headers.get('content-type') || ''), 'GET / is not served as HTML');
ok(pageText.includes('NEON CHASE'), 'the served page does not contain the game');
ok(pageText.includes('<script>'), 'the served page has no inlined script');

const js = await fetch(`${BASE}/src/game.js`);
ok(js.status === 200, `GET /src/game.js returned ${js.status}`);
ok(/javascript/.test(js.headers.get('content-type') || ''), 'game.js has the wrong content type');

const missing = await fetch(`${BASE}/nope-nope-nope`);
ok(missing.status === 404, `a missing file returned ${missing.status}`);

const escaped = await fetch(`${BASE}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`);
ok(escaped.status === 404 || escaped.status === 403, `a traversal attempt returned ${escaped.status}`);

/* ---------------- 2. handshake + rooms ---------------- */
const host = await connectClient('Hostie');
const welcome = await host.next((m) => m.t === 'welcome');
ok(!!welcome.id, 'no id in the welcome message');
ok(welcome.name === 'Hostie', `welcome name is ${welcome.name}`);

host.send({ t: 'create' });
const room = await host.next((m) => m.t === 'room');
ok(room.host === true, 'creator is not flagged as host');
ok(/^[A-Z2-9]{4}$/.test(room.code), `odd room code: ${room.code}`);
ok(room.peers.length === 1 && room.peers[0].host === true, 'peer list is wrong for a new room');
console.log(`room ${room.code} created`);

const guest = await connectClient('Guesty');
await guest.next((m) => m.t === 'welcome');
guest.send({ t: 'join', code: room.code.toLowerCase() });  // lower case must work
const joined = await guest.next((m) => m.t === 'room');
ok(joined.code === room.code, `guest landed in ${joined.code}`);
ok(joined.host === false, 'joiner was flagged as host');
const peersAtHost = await host.next((m) => m.t === 'peers' && m.peers.length === 2);
ok(peersAtHost.peers.map((p) => p.name).sort().join(',') === 'Guesty,Hostie', 'host peer list is wrong');

/* ---------------- 3. relay, including a big payload ---------------- */
host.send({ t: 'relay', data: { t: 's', hello: 'guest' } });
const got = await guest.next((m) => m.t === 'relay' && m.data && m.data.hello === 'guest');
ok(!!got.from, 'relayed message has no sender id');
ok(got.from !== joined.peers.find((p) => p.name === 'Guesty').id, 'the relay echoed to the sender');

const big = 'x'.repeat(70000);            // exercises the 64-bit length path
guest.send({ t: 'relay', data: { t: 's', blob: big } });
const bigBack = await host.next((m) => m.t === 'relay' && m.data && typeof m.data.blob === 'string', 4000);
ok(bigBack.data.blob.length === 70000, `big payload came back as ${bigBack.data.blob && bigBack.data.blob.length} chars`);

/* ---------------- 4. capacity ---------------- */
const extra = [];
for (let i = 0; i < 2; i++) {
  const c = await connectClient('Extra' + i);
  await c.next((m) => m.t === 'welcome');
  c.send({ t: 'join', code: room.code });
  const res = await c.next((m) => m.t === 'room' || m.t === 'error');
  ok(res.t === 'room', `extra client ${i} was rejected early: ${res.why}`);
  extra.push(c);
}
const overflow = await connectClient('Overflow');
await overflow.next((m) => m.t === 'welcome');
overflow.send({ t: 'join', code: room.code });
const full = await overflow.next((m) => m.t === 'error');
ok(full.why === 'full', `the fifth disc got "${full.why}" instead of "full"`);

/* ---------------- 5. bogus codes ---------------- */
const stray = await connectClient('Stray');
await stray.next((m) => m.t === 'welcome');
stray.send({ t: 'join', code: 'ZZZZ' });
const noRoom = await stray.next((m) => m.t === 'error');
ok(noRoom.why === 'no-room', `a bogus code gave "${noRoom.why}"`);

/* ---------------- 6. the host leaving closes the room ---------------- */
host.close();
const ended = await guest.next((m) => m.t === 'ended', 3000);
ok(ended.why === 'host-left', `guests were told "${ended.why}" instead of host-left`);

const health = await (await fetch(`${BASE}/healthz`)).json();
ok(health.rooms === 0, `${health.rooms} rooms still open after the host left`);

/* ---------------- 7. a graceful leave keeps the room alive ---------------- */
const host2 = await connectClient('Host2');
await host2.next((m) => m.t === 'welcome');
host2.send({ t: 'create' });
const room2 = await host2.next((m) => m.t === 'room');
const guest2 = await connectClient('Guest2');
await guest2.next((m) => m.t === 'welcome');
guest2.send({ t: 'join', code: room2.code });
await guest2.next((m) => m.t === 'room');
guest2.send({ t: 'leave' });
// the join broadcast may still be queued, so wait for the *shrunken* list
const peers2 = await host2.next((m) => m.t === 'peers' && m.peers.length === 1, 3000);
ok(peers2.peers.length === 1, `after a guest left the room holds ${peers2.peers.length} peers`);
const health2 = await (await fetch(`${BASE}/healthz`)).json();
ok(health2.rooms === 1, `expected 1 room, saw ${health2.rooms}`);

/* ---------------- 8. end to end: two real game clients, one real server ----------------
   The strongest check in the suite: the actual game files, over an actual
   socket, against the actual server process. */
const { makeHarness } = await import('./harness.mjs');
const netSrc = (await import('node:fs')).readFileSync(path.join(root, 'src/net.js'), 'utf8');
const gameSrc = (await import('node:fs')).readFileSync(path.join(root, 'src/game.js'), 'utf8');

function realClient(name) {
  const api = makeHarness([netSrc, gameSrc]);
  api.game.manual = true;
  api.__net.useWebSocket((url) => new WebSocket(url));   // Node's real client
  api.__net.saveUrl(WS_URL);
  api.game.netName = name;
  return api;
}

const c1 = realClient('Alice');
const c2 = realClient('Bob');
c1.hostOnline();
await sleep(300);
ok(c1.game.mode2 === 'host', `real client host role is ${c1.game.mode2}`);
const e2eCode = c1.game.roomCode;
ok(!!e2eCode, 'the real host got no room code');

c2.joinOnline(e2eCode);
await sleep(300);
ok(c2.game.mode2 === 'guest', `real client guest role is ${c2.game.mode2}`);
ok(c1.game.players.length === 2, `real host sees ${c1.game.players.length} discs`);

c1.startRace(1);
await sleep(300);
ok(c1.game.state === 'ready' && c2.game.state === 'ready', 'the real race did not start on both sides');

const DT = 1 / 60;
for (let i = 0; i < 60 * 8; i++) {
  c1.step(DT);
  c2.step(DT);
  if (i % 90 === 0) { c1.setDir('left'); c2.setDir('right'); }
  if (i % 15 === 0) await sleep(4);   // let the sockets breathe
}
c2.setDir('up');
await sleep(150);
const aliceScore = c1.game.players.find((p) => p.isLocal).score;
const bobCopy = c2.game.players.find((p) => !p.isLocal);
console.log(`end to end: host scored ${aliceScore}, guest holds ${c2.game.players.length} discs, guest sees host at ${bobCopy ? Math.round(bobCopy.rx ?? -1) : 'n/a'}px`);
ok(c1.game.dotsEaten > 0, 'nothing was eaten in the end-to-end race');
ok(c2.game.dotsLeft < 244, 'the guest never saw pellets disappear');
ok(c2.game.players.length === 2, 'the guest lost track of the discs');

c1.leaveOnline();
await sleep(200);
ok(c2.game.netStatus === 'lost', `after the host left, the real guest reports ${c2.game.netStatus}`);
c2.leaveOnline();
await sleep(100);

/* ---------------- wrap up ---------------- */
host2.close();
guest2.close();
extra.forEach((c) => c.close());
guest.close();
stray.close();
overflow.close();
await sleep(200);

console.log(`server log had ${serverLog.split('\n').length} lines`);

if (fails.length) {
  console.error('\nFAILURES:');
  for (const f of fails) console.error(' - ' + f);
  cleanup(1);
}
console.log('OK: the server serves the game, speaks WebSocket, and runs rooms correctly.');
cleanup(0);
