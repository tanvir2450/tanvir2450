/** Multiplayer protocol smoke test: two clients, one room. */
import WebSocket from 'ws';

const URL = 'ws://127.0.0.1:3000';
const log = (...a) => console.log('[test]', ...a);
let failures = 0;
function check(cond, label) {
  if (cond) log('PASS', label);
  else {
    failures++;
    log('FAIL', label);
  }
}

function client(name) {
  const ws = new WebSocket(URL);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    inbox.push(msg);
    for (const w of [...waiters]) {
      if (w.pred(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  });
  return {
    name,
    ws,
    inbox,
    send: (m) => ws.send(JSON.stringify(m)),
    next(pred, timeout = 3000) {
      const hit = inbox.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting (${name})`)), timeout);
        waiters.push({ pred, resolve: (m) => { clearTimeout(timer); resolve(m); } });
      });
    },
    open: () => new Promise((res, rej) => {
      ws.on('open', res);
      ws.on('error', rej);
    }),
    close: () => ws.close(),
  };
}

const a = client('A');
const b = client('B');
await a.open();
await b.open();
log('sockets open');

// A creates a room
a.send({ t: 'create', name: 'Alpha' });
const welcomeA = await a.next((m) => m.t === 'welcome');
check(welcomeA.room?.code?.length === 5, `A got room code ${welcomeA.room.code}`);
check(welcomeA.id > 0, `A id ${welcomeA.id}`);
const code = welcomeA.room.code;

// B joins by code
b.send({ t: 'join', code, name: 'Bravo' });
const welcomeB = await b.next((m) => m.t === 'welcome');
check(welcomeB.room.players.length === 2, `B sees ${welcomeB.room.players.length} players`);

// A sees B join
const joinMsg = await a.next((m) => m.t === 'join' && m.player.name === 'Bravo');
check(!!joinMsg, 'A notified of B join');

// state relay
b.send({ t: 'state', p: [10, 2, 20], ry: 1.2, rx: -0.1, w: 2, mv: 5, gr: true });
const st = await a.next((m) => m.t === 'state' && m.id === welcomeB.id);
check(st.p[0] === 10 && st.w === 2, 'A received B state');

// fire relay
b.send({ t: 'fire', w: 0, o: [10, 3, 20], d: [0, 0, -1] });
const fire = await a.next((m) => m.t === 'fire' && m.id === welcomeB.id);
check(fire.w === 0, 'A received B fire');

// grenade relay
b.send({ t: 'nade', o: [1, 2, 3], v: [0, 5, 8] });
const nade = await a.next((m) => m.t === 'nade' && m.id === welcomeB.id);
check(!!nade, 'A received B grenade');

// damage + hp
b.send({ t: 'hit', target: welcomeA.id, dmg: 30, w: 0, head: false });
const hp1 = await b.next((m) => m.t === 'hp' && m.id === welcomeA.id);
check(hp1.hp === 70, `hp applied -> ${hp1.hp}`);
await new Promise((r) => setTimeout(r, 60)); // respect server hit rate limit
b.send({ t: 'hit', target: welcomeA.id, dmg: 40, w: 1, head: true });
const kill = await a.next((m) => m.t === 'kill' && m.victim === welcomeA.id);
check(kill.killer === welcomeB.id, 'kill broadcast (headshot)');

const respawn = await a.next((m) => m.t === 'respawn' && m.id === welcomeA.id, 5000);
check(respawn.hp === 100 && Array.isArray(respawn.spawn), 'respawn with spawn point');

// bad room code
const c = client('C');
await c.open();
c.send({ t: 'join', code: 'ZZZZZ', name: 'Ghost' });
const err = await c.next((m) => m.t === 'error');
check(/not found/i.test(err.msg), 'invalid code rejected');

// scores broadcast
const scores = await a.next(
  (m) => m.t === 'scores' && m.players?.find((p) => p.id === welcomeA.id)?.deaths === 1
);
check(scores.players.length === 2, 'scores rows present');
const me = scores.players.find((p) => p.id === welcomeA.id);
check(me.deaths === 1 && me.kills === 0, `score row A k=${me.kills} d=${me.deaths}`);
const other = scores.players.find((p) => p.id === welcomeB.id);
check(other.kills === 1, `score row B k=${other.kills}`);

// leave
b.send({ t: 'leave' });
const left = await a.next((m) => m.t === 'leave' && m.id === welcomeB.id);
check(!!left, 'leave broadcast');

a.close();
b.close();
c.close();
log(failures === 0 ? 'ALL TESTS PASSED' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
