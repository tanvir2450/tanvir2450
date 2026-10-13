/* Builds index.html — one self-contained file you can open anywhere:
   double-click it on a PC, AirDrop/email it to a phone, no server, no
   internet needed. The app icon is inlined as a data URI, so there are
   no side-car assets to lose.

   Sources:  index.template.html + src/net.js + src/game.js + assets/icon-192.png
   Output:   index.html  (the file you open)

   Solo play works from the file. For online play the page needs the relay
   running somewhere (server.js) — the link is remembered between visits.

   Usage: node tools/build.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Compose the single-file build. Also used by tools/validate.mjs. */
export function buildHtml(rootDir) {
  const read = (p) => fs.readFileSync(path.join(rootDir, p), 'utf8');
  const template = read('index.template.html');
  const net = read('src/net.js');
  const game = read('src/game.js');

  // Scripts must not be able to close the script tag early or start an HTML
  // comment. Both are illegal in a JS file, so these are hard build errors.
  for (const [name, src] of [['src/net.js', net], ['src/game.js', game]]) {
    if (/<\/script/i.test(src)) throw new Error(`${name} contains "</script" — cannot be inlined safely`);
    if (/<!--/.test(src)) throw new Error(`${name} contains "<!--" — cannot be inlined safely`);
  }
  if (!template.includes('<!-- ICONS -->')) throw new Error('template is missing the <!-- ICONS --> slot');
  if (!template.includes('<!-- NET_SCRIPT -->')) throw new Error('template is missing the <!-- NET_SCRIPT --> slot');
  if (!template.includes('<!-- GAME_SCRIPT -->')) throw new Error('template is missing the <!-- GAME_SCRIPT --> slot');

  // Inline the home-screen icon (used for the tab and for "Add to Home Screen").
  let iconLinks = '';
  const iconPath = path.join(rootDir, 'assets/icon-192.png');
  if (fs.existsSync(iconPath)) {
    const b64 = fs.readFileSync(iconPath).toString('base64');
    iconLinks = [
      `<link rel="apple-touch-icon" href="data:image/png;base64,${b64}" />`,
      `<link rel="icon" type="image/png" sizes="192x192" href="data:image/png;base64,${b64}" />`,
    ].join('\n');
  } else {
    console.warn('! assets/icon-192.png missing — building without an app icon');
  }

  return template
    .replace('<!-- ICONS -->', iconLinks)
    .replace('<!-- NET_SCRIPT -->', `<script>\n${net}\n</script>`)
    .replace('<!-- GAME_SCRIPT -->', `<script>\n${game}\n</script>`);
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const html = buildHtml(root);
  fs.writeFileSync(path.join(root, 'index.html'), html);
  console.log(`built index.html — ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB, self-contained (game + icon inlined)`);
}
