# tanvir2450

## Neon Drive // Handling Lab

A playable browser-based Step 2 driving prototype: nine cars, three test tracks, analog steering, arcade/physical tire slip, gears/RPM, drift combos, nitro, traffic, damage and a live telemetry/tuning panel. **This is a driving test lab, not the finished game.**

```bash
npm install
npm run dev          # open http://localhost:5173 (exports + packs car art first)
npm test             # deterministic simulation + asset tests
npm run build        # export assets + typecheck + production build
npm run assets       # regenerate the 2× PNGs and core atlas from SVGs
```

**Drive:** W/S throttle/brake · A/D steer · Space handbrake · Shift nitro · T telemetry · R reset. Arrow keys and on-screen touch controls work too. Select a car and route in the left panel; press **♪ OFF** to opt in to engine audio. If WebGL is slow, add `?renderer=canvas` to the URL.

- [Step 2 guide, architecture, tuning and known gaps](docs/STEP2.md)
- [Game Specification v2 — Sections 1, 9, 11, 11B](docs/SPEC_V2.md)
- [Asset pipeline, supported formats and load budget](assets/README.md)
- [Per-car stats and surface grip](data/cars.json) · [Tuning defaults](data/tuning.json) · [Test tracks](data/tracks.json)
