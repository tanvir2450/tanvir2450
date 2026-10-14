# Milestones

The build order comes from [SPEC.md](SPEC.md). One rule applies to every step:

> **A milestone is finished only when it runs on a real phone browser, and someone has confirmed
> that. Do not start the next step before then.**

Emulators and the automated smoke test (`npm run test:mobile`) are useful for catching obvious
breakage early. They run desktop Chromium pretending to be a phone, so they cannot prove that
the game works on iOS Safari, on real touch hardware, or at a playable frame rate. They do not
count as the confirmation.

## Status

| #   | Milestone          | Status                                                                          |
| --- | ------------------ | ------------------------------------------------------------------------------- |
| 1   | Setup              | **Built. Passes the emulated smoke test. Waiting for a real-phone confirmation.** |
| 2   | Core driving       | Not started (blocked on step 1 confirmation)                                    |
| 3   | Single race        | Not started                                                                     |
| 4   | Progression        | Not started                                                                     |
| 5   | Combat             | Not started                                                                     |
| 6   | Content expansion  | Not started                                                                     |
| 7   | Difficulty + stars | Not started                                                                     |
| 8   | Story and finale   | Not started                                                                     |
| 9   | Polish             | Not started                                                                     |

## How a milestone is closed

1. `npm run build` succeeds (this includes the type check).
2. `npm run build && npm run test:mobile` is all green.
3. Open the build on a real phone, run through that milestone's checklist, and record the result
   in the log at the bottom of this file.
4. Only then update the status above and start the next step.

If a phone check fails, fix the problem and re-test. Don't carry it forward.

## Opening the build on a phone

- **Same Wi-Fi:** run `npm run dev`. Open the `Network:` address that Vite prints (for example
  `http://192.168.1.20:5173`) in the phone's browser. If it doesn't load, check the computer's
  firewall and whether the Wi-Fi isolates devices (guest networks often do).
- **Different network:** tunnel the dev or preview server, for example
  `cloudflared tunnel --url http://localhost:5173` or `ngrok http 5173`, and open the address
  that command prints.
- **A deployed preview:** push to Vercel, Netlify or Cloudflare Pages (see the README) and open the
  preview address. This is the closest thing to the final environment: HTTPS and the real
  caching headers.

Test the production build too (`npm run build && npm run preview`), not only the dev server. Phones
are slower and stricter than the dev server.

## Milestone 1 checklist (project setup)

Do this on at least one iPhone (Safari) and one Android phone (Chrome) if you can. Use the
on-screen diagnostics panel at the bottom-left. Add `?debug=0` to the address to hide it.

- [ ] **Loads:** the page opens within a few seconds, the "Loading" splash goes away, and no
      error message appears.
- [ ] **Picture:** the neon car is centred, with a magenta glow underneath and a slight idle bob.
      The title and subtitle are sharp (not blurry) and nothing is cut off at the screen edges.
- [ ] **Renderer:** the panel's second line says `WebGL`. `Canvas` means the phone fell back to
      the slower renderer. Note the phone model if you see that.
- [ ] **Sharpness:** the `canvas` size on the panel is about twice the `view` size on a 2× or 3×
      phone (for example view 390x664, canvas 780x1328).
- [ ] **Frame rate:** the `fps` line sits near 60 while the car idles. Note the number if it
      doesn't.
- [ ] **Tap:** tap anywhere. The car does a full spin and `taps` goes up by one each tap, with no
      noticeable delay.
- [ ] **Two fingers:** hold two fingers on the screen. `fingers` shows 2.
- [ ] **Rotation:** turn the phone sideways and back. The layout re-centres each time and nothing
      is cut off or overlapping.
- [ ] **Browser behaviour:** pinch-zoom and double-tap zoom do nothing, the page doesn't scroll or
      rubber-band, and a long press doesn't open a menu or select text.
- [ ] **Reload:** a second load still works (checks the caching setup).

## Checklist for later milestones

Each milestone adds its own items here when it starts. The basics apply to all of them:

- It loads and runs without an on-screen error.
- It is smooth at a normal frame rate, with no long stalls, for at least a few minutes of play.
- Touch controls respond with no noticeable delay.
- It works in portrait and landscape, and survives rotating mid-play.
- It keeps working after switching to another app and back.
- Anything new it needs (audio, saved data and so on) works on the phone, not only on desktop.

## Real-phone test log

Add one row per test, newest last.

| Date | Milestone | Phone and OS | Browser | Result (pass / fail) | Notes |
| ---- | --------- | ------------ | ------- | -------------------- | ----- |
|      |           |              |         |                      |       |
