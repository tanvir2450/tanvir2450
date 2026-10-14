/**
 * Integration test: boots the REAL front-end (boot.js -> render.js, hud.js,
 * input.js, game.js, audio.js) against a stubbed DOM, then drives the car with
 * the keyboard, with the game's own demo autopilot, and with the tooling's
 * autopilot while running real animation frames.
 *
 * This is what catches the bugs that unit tests cannot: a missing DOM id, a
 * canvas API used wrongly, an input path that never fires, a renderer that
 * throws on the first frame, or a physics value that comes back NaN.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { setupDom, stubFetch } from './dom-stub.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the whole game boots and runs frames', async () => {
  const dom = setupDom();
  globalThis.fetch = stubFetch(readFileSync, ROOT);
  try {
    const { boot, HUD_ELEMENT_IDS } = await import('../src/boot.js');

    // every id the HUD asks for must exist in index.html
    const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
    for (const [key, id] of Object.entries(HUD_ELEMENT_IDS)) {
      assert.ok(htmlIds.has(id), `index.html is missing id="${id}" (HUD element ${key})`);
    }

    const apex = await boot();
    assert.ok(apex, 'boot() returned null - the app failed to start');
    const { game, track, config } = apex;
    assert.equal(game.car.id, config.cars[0].id);
    assert.ok(track.gates.length > 8, 'the circuit should have several checkpoints');

    let now = 0;
    const runFrames = (count, onFrame = () => {}) => {
      for (let i = 0; i < count; i++) {
        now += 16.667;
        game.frame(now);
        onFrame(i);
      }
    };

    // 1. keyboard throttle must move the car
    dom.keydown('ArrowUp');
    runFrames(120);
    assert.ok(game.car.speedMs > 5, `expected the car to move, speed=${game.car.speedMs}`);
    assert.ok(Number.isFinite(game.car.engineState.rpmDisplay), 'tachometer reading went non-finite');
    assert.match(apex.hud.els.gear.textContent, /^(R|N|[1-9])$/, 'gear readout is not a gear');
    dom.keyup('ArrowUp');

    // 2. handbrake + full lock must leave rubber on the road
    game.reset();
    dom.keydown('ArrowUp');
    dom.keydown('ArrowLeft');
    runFrames(180);
    dom.keydown('Space');
    runFrames(60);
    assert.ok(game.effects.marks.length > 0, 'a handbrake slide should leave skid marks');
    dom.keyup('Space');
    dom.keyup('ArrowLeft');
    dom.keyup('ArrowUp');

    // 3. the demo mode (O) must drive the car by itself, through the real loop
    game.reset();
    dom.keydown('KeyO');
    dom.keyup('KeyO');
    runFrames(30);
    assert.equal(game.demo, true, 'pressing O should hand the car to the autopilot');
    let demoLaps = 0;
    runFrames(60 * 110, () => {
      if (game.lapTimer.lapCount > demoLaps) demoLaps = game.lapTimer.lapCount;
    });
    assert.ok(demoLaps >= 1, `demo autopilot did not complete a lap (${Math.round(game.car.odometerM)} m driven)`);
    assert.ok(Number.isFinite(game.car.x) && Number.isFinite(game.car.y), 'demo drive went non-finite');
    dom.keydown('ArrowUp');
    runFrames(40);
    dom.keyup('ArrowUp');
    assert.equal(game.demo, false, 'touching the controls should take the car back from the demo');

    // 4. the tooling autopilot, driven through the keyboard path, must lap too
    const { Autopilot } = await import('../src/ai.js');
    const autopilot = new Autopilot(track, config);
    game.reset();
    game.car.reset({ ...track.startPose, speedMs: 0 });
    let laps = 0;
    const pressed = new Set();
    const applyInput = (input) => {
      const keys = [
        ['ArrowUp', input.throttle > 0.1],
        ['ArrowDown', input.brake > 0.1],
        ['ArrowLeft', input.steer < -0.15],
        ['ArrowRight', input.steer > 0.15],
        ['Space', input.handbrake]
      ];
      for (const [code, wanted] of keys) {
        if (wanted && !pressed.has(code)) {
          pressed.add(code);
          dom.keydown(code);
        } else if (!wanted && pressed.has(code)) {
          pressed.delete(code);
          dom.keyup(code);
        }
      }
    };
    runFrames(60 * 175, () => {
      applyInput(autopilot.update(1 / 60, game.car));
      if (game.lapTimer.lapCount > laps) laps = game.lapTimer.lapCount;
    });
    for (const code of pressed) dom.keyup(code);
    assert.ok(game.car.odometerM > 600, `autopilot barely moved: ${Math.round(game.car.odometerM)} m`);
    assert.ok(laps >= 1, `autopilot did not complete a lap (odometer ${Math.round(game.car.odometerM)} m)`);
    assert.ok(game.lapTimer.bestLap > 20 && game.lapTimer.bestLap < 400, `implausible lap time ${game.lapTimer.bestLap}`);

    // 5. the HUD received numbers
    assert.ok(Number(apex.hud.els.speed.textContent) >= 0, 'speed readout was never updated');
    assert.notEqual(apex.hud.els.lapTime.textContent, '');
  } finally {
    dom.restore();
  }
});
