#!/usr/bin/env node
/**
 * bundle.mjs - builds a single self-contained HTML file so the game can be
 * opened straight from the filesystem on a phone or a PC (no server, no
 * install, no network).
 *
 * The dev build is ES modules + `fetch('data/*.json')`, and browsers refuse
 * both over `file://` (module scripts and fetches are CORS-checked against a
 * null origin). This tool removes the problem instead of asking the player to
 * work around it:
 *
 *   1. every `src/*.js` module is wrapped in a tiny module registry, so the
 *      `import`/`export` graph becomes one classic script;
 *   2. every `data/*.json` file is embedded and a `fetch` shim answers the
 *      `data/...` requests the game already makes - the app code is unchanged;
 *   3. `styles.css` and the script are inlined into `index.html`.
 *
 * The result is also *smaller* than serving the pieces: ~400 KB, one file, no
 * requests. `index.html` + `npm start` remains the development path, where a
 * reload picks up edits without rebuilding.
 *
 * Usage:
 *   node tools/bundle.mjs                       # -> apex-2d.html
 *   node tools/bundle.mjs --out dist/game.html
 *   node tools/bundle.mjs --data-only           # skip data (dev/test bundles)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const DEFAULT_OUT = path.join(ROOT, 'apex-2d.html');

/* ------------------------------------------------------------------ *
 * the module transform
 *
 * The source style is deliberately uniform, which keeps this honest:
 *   import { a, b } from './x.js';        (single or multi line)
 *   export function f() {} / export class C {}
 *   export const k = ...;
 *   export { a, b };
 *   export { X } from './x.js';           (a re-export: fx.js does this)
 * There are no default exports, no `export *`, and no cyclic imports.
 * ------------------------------------------------------------------ */

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?[^\S\n]*$/gm;
const REEXPORT_RE = /^export\s*\{([^}]*)\}\s*from\s*'([^']+)';?[^\S\n]*$/gm;
const EXPORT_LIST_RE = /^export\s*\{([^}]*)\};?[^\S\n]*$/gm;
const EXPORT_DECL_RE = /^export\s+(async\s+function|function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;

/** `a, b as c` -> `a, b: c`; returns the local names too. */
function parseNameList(specifiers) {
  const mapped = [];
  const names = [];
  for (const raw of specifiers.split(',')) {
    const spec = raw.trim();
    if (!spec) continue;
    const parts = spec.split(/\s+as\s+/);
    const local = parts[0].trim();
    const exported = (parts[1] ?? parts[0]).trim();
    if (!local || !exported) throw new Error(`could not parse specifier "${spec}"`);
    mapped.push(local === exported ? local : `${local}: ${exported}`);
    names.push(exported);
  }
  return { mapped, names };
}

/** Resolve a relative specifier against the module's own id. */
function resolve(fromId, specifier) {
  if (!specifier.startsWith('.')) throw new Error(`external import "${specifier}" cannot be bundled`);
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromId), specifier));
}

/**
 * Rewrite one module into a registry factory.
 * @param {string} id e.g. 'src/car.js'
 * @param {string} source
 */
function transform(id, source) {
  const exported = new Set();
  let body = source;

  body = body.replace(IMPORT_RE, (_match, specifiers, specifier) => {
    const target = resolve(id, specifier);
    const { mapped } = parseNameList(specifiers);
    return `const { ${mapped.join(', ')} } = __require(${JSON.stringify(target)});`;
  });

  body = body.replace(REEXPORT_RE, (_match, specifiers, specifier) => {
    const target = resolve(id, specifier);
    const { names } = parseNameList(specifiers);
    const lines = [`const __re = __require(${JSON.stringify(target)});`];
    for (const name of names) {
      // assigned here rather than added to `exported`: the name is not a local
      // binding, so the generated tail must not reference it
      lines.push(`__exports.${name} = __re.${name};`);
    }
    return lines.join('\n');
  });

  body = body.replace(EXPORT_LIST_RE, (_match, specifiers) => {
    const { names } = parseNameList(specifiers);
    for (const name of names) exported.add(name);
    return '';
  });

  body = body.replace(EXPORT_DECL_RE, (_match, kind, name) => {
    exported.add(name);
    return `${kind} ${name}`;
  });

  // `import.meta.url` is module-only syntax. The browser modules never use it -
  // the one use is inside config.js's node-only `loadConfigFromDisk()`, which a
  // browser never calls - but a classic script still has to PARSE it, so it is
  // rewritten to the classic-script equivalent of "where am I".
  body = body.replace(
    /import\.meta\.url/g,
    "((typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || (typeof location !== 'undefined' ? location.href : ''))"
  );

  // Anything still starting a line with import/export is a pattern this tool
  // does not know about: fail loudly rather than ship a broken bundle.
  const leftover = body.match(/^(import|export)\b.*/m);
  if (leftover) throw new Error(`${id}: untransformed module syntax: ${leftover[0].slice(0, 80)}`);

  const tail = [...exported].map((name) => `__exports.${name} = ${name};`).join('\n');
  const indent = (text) =>
    text
      .split('\n')
      .map((line) => (line ? `  ${line}` : line))
      .join('\n');
  return `__define(${JSON.stringify(id)}, function (__exports, __require) {\n${indent(body)}\n${indent(tail)}\n});\n`;
}

/* ------------------------------------------------------------------ */

async function readText(relative) {
  return readFile(path.join(ROOT, relative), 'utf8');
}

/**
 * Build the single-file HTML.
 *
 * @param {{outPath?:string, withData?:boolean, write?:boolean}} [options]
 * @returns {Promise<{html:string, modules:number, dataFiles:number, outPath:string}>}
 */
export async function buildBundle(options = {}) {
  const outPath = path.resolve(options.outPath ?? DEFAULT_OUT);
  const withData = options.withData ?? true;
  // 1. the module graph, in dependency order (depth first from main.js)
  const ENTRY = 'src/main.js';
  const order = [];
  const seen = new Set();
  const sources = new Map();
  const visit = async (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const source = await readText(id);
    sources.set(id, source);
    const deps = [...source.matchAll(IMPORT_RE), ...source.matchAll(REEXPORT_RE)].map((m) => resolve(id, m[2]));
    for (const dep of deps) await visit(dep);
    order.push(id);
  };
  await visit(ENTRY);

  const modules = [];
  for (const id of order) modules.push(transform(id, sources.get(id)));

  // 2. the data files the app fetches
  const dataFiles = [];
  if (withData) {
    const catalogue = JSON.parse(await readText('data/tracks.json'));
    const wanted = new Set(['cars.json', 'surfaces.json', 'tuning.json', 'audio.json', 'tracks.json']);
    for (const entry of catalogue.tracks ?? []) {
      const file = entry.file ?? `data/${entry.id}.json`;
      wanted.add(path.basename(file));
    }
    for (const name of [...wanted].sort()) {
      const json = JSON.parse(await readText(`data/${name}`));
      dataFiles.push(`  ${JSON.stringify(`data/${name}`)}: ${JSON.stringify(json)}`);
    }
  }

  // 3. the page: styles + script inlined
  const styles = await readText('styles.css');
  const html = await readText('index.html');

  const preamble = `
/* ---------------------------------------------------------------------
 * APEX 2D - single-file build
 *
 * Built from the ES modules in src/ and the JSON in data/ by
 * tools/bundle.mjs. Everything below is the same code the dev server runs;
 * it is wrapped in a module registry and the data is embedded, so this file
 * works when opened directly (file://) with no server and no network.
 *
 * Rebuild after an edit:  npm run bundle
 * ------------------------------------------------------------------- */
const __modules = Object.create(null);
const __cache = Object.create(null);
function __define(id, factory) { __modules[id] = factory; }
function __require(id) {
  const hit = __cache[id];
  if (hit) return hit;
  const exports = (__cache[id] = {});
  __modules[id](exports, __require);
  return exports;
}
`;

  const dataBlock = withData
    ? `
/* The game fetches data/*.json (cars, surfaces, tuning, audio, the circuit
 * catalogue and every circuit). Offline those become an in-memory table and a
 * fetch shim, so boot.js is unchanged. */
const __FILES = {
${dataFiles.join(',\n')}
};
/* a marker the game (and the tests) can read: this is the single-file build,
 * so a boot failure is not a "you forgot to serve the folder" problem */
globalThis.__APEX_SINGLE_FILE = true;
const __nativeFetch = typeof fetch === 'function' ? fetch.bind(globalThis) : null;
const __offlineFetch = (url, init) => {
  const key = String(url).replace(/^\\.?\\//, '');
  const body = __FILES[key];
  if (body !== undefined) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
      headers: { get: () => 'application/json' }
    });
  }
  return __nativeFetch ? __nativeFetch(url, init) : Promise.reject(new Error('offline build: ' + url));
};
try { globalThis.fetch = __offlineFetch; } catch (error) { console.warn('[bundle] could not install the data shim', error); }
`
    : '';

  const bundle = `${preamble}${dataBlock}
/* ---- module registry: dependency order, entry last ---- */
${modules.join('\n')}__require(${JSON.stringify(ENTRY)});
`;

  // a `</script` inside the code would end the tag early
  const safeBundle = bundle.replace(/<\/script/gi, '<\\/script');
  const safeStyles = styles.replace(/<\/style/gi, '<\\/style');

  let output = html;
  // NOTE: every replacement here goes through a function. A replacement STRING
  // is not literal in JavaScript - `$'`, `$&`, `` $` `` and `$1` are
  // substitutions, and the game source contains `$'` (config.js matches keys
  // starting with `$`), which silently mangled the first build of this file.
  const styleTag = `<link rel="stylesheet" href="styles.css" />`;
  if (!output.includes(styleTag)) throw new Error('index.html no longer links styles.css - update the bundler');
  output = output.replace(styleTag, () => `<style>\n${safeStyles}</style>`);

  const scriptTag = `<script type="module" src="src/main.js"></script>`;
  if (!output.includes(scriptTag)) throw new Error('index.html no longer loads src/main.js - update the bundler');
  output = output.replace(scriptTag, () => `<script>\n${safeBundle}</script>`);

  // a standalone file should say so, and be free of any other local reference
  const leftovers = [...output.matchAll(/(?:src|href)="(?!https?:|data:|#)([^"]+)"/g)].map((m) => m[1]);
  if (leftovers.length) throw new Error(`the bundle still references local files: ${leftovers.join(', ')}`);
  output = output.replace(
    '<title>',
    () => '<!-- Single-file build: open this file directly, on a phone or a PC. Built by tools/bundle.mjs. -->\n    <title>'
  );

  if (options.write !== false) {
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, output);
  }
  return { html: output, modules: order.length, dataFiles: dataFiles.length, outPath, entry: ENTRY };
}

/* ---- CLI ------------------------------------------------------------ */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const argValue = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : fallback;
  };
  buildBundle({
    outPath: argValue('out', DEFAULT_OUT),
    withData: !args.includes('--data-only')
  })
    .then(({ outPath, html, modules, dataFiles }) => {
      const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
      console.log(
        `${path.relative(ROOT, outPath) || outPath}: ${kb} KB - ${modules} modules, ` +
          `${dataFiles} data files embedded`
      );
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
