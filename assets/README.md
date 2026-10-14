# Asset pipeline (Section 1.4)

- `cars/source/{falcon,tank}_{body,wheels,lights}.svg` are editable vector
  sources at **128×64** (2× a nominal 64×32 car). A shared top-left light
  direction, 2 px outline, transparency and right-facing top-down orientation
  keep the layers aligned. The body is tintable; glass and lights are not.
  Front wheel steer, brake lighting, scratches and nitro flames are dynamic.
- Run `npm run assets` to export PNGs to `cars/*.png` and deterministically pack
  referenced layers into `textures/atlas.png` + TexturePacker-format
  `textures/atlas.json`. Each `car.art` object in `data/cars.json` is the
  manifest. Optional `decals` layers are supported when authored. The packer
  fails on missing SVGs, invalid/duplicate names or oversize atlases.
  `npm run dev` and `npm run build` rebuild the atlas automatically. Commit
  source and generated PNGs so CI/previews need no asset server.
- Canonical car paths retain the supplied `cars/falcon_body.png` convention
  (folder = category, basename = name_state). For future standalone art use
  `category_name_state.png`, e.g. `effects_smoke_idle.png`. Seven provisional
  cars still render using the vector fallback until their art exists.
- `effects/`, `environment/`, `ui/` and `audio/` are reserved for authored
  assets. The current lab uses procedural effects, canvas track tiles, DOM UI
  and opt-in synthesized Web Audio. Once recorded audio exists, ship **OGG
  primary / MP3 fallback** versions with matching stems; no dummy files.
- `BootScene` loads **only** the shared car atlas. Track scenery is drawn into
  camera-local canvas tiles on demand. Future district-specific atlases and
  audio must load on district entry, not at boot. Keep the whole first transfer
  under **8 MiB**; the core atlas plus JSON is under 11 KiB, and the entire
  uncompressed production build is under 2 MiB. Real-device QA and larger
  texture/effect passes remain for Step 10.
