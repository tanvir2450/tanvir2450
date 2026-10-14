#!/usr/bin/env node
/**
 * serve.mjs - zero dependency static server for the prototype.
 *
 * Usage:
 *   node tools/serve.mjs [--port 8000] [--host 0.0.0.0] [--root .]
 *
 * Binds 0.0.0.0 by default so the game is reachable from the sandbox preview
 * URL (the page must be served over http, not opened as file://, because the
 * data is loaded with fetch()).
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function parseArgs(argv) {
  const args = { port: Number(process.env.PORT ?? 8000), host: process.env.HOST ?? '0.0.0.0', root: path.join(HERE, '..') };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--port') args.port = Number(argv[++i]);
    else if (flag === '--host') args.host = argv[++i];
    else if (flag === '--root') args.root = path.resolve(argv[++i]);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const target = path.join(root, pathname);
    // never serve outside the root
    if (!target.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const info = await stat(target).catch(() => null);
    const file = info?.isDirectory() ? path.join(target, 'index.html') : target;
    const body = await readFile(file);
    const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(body);
  } catch (error) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`not found: ${error?.message ?? error}`);
  }
});

server.listen(args.port, args.host, () => {
  console.log(`Apex 2D running on http://${args.host === '0.0.0.0' ? 'localhost' : args.host}:${args.port}/`);
  console.log(`serving ${root}`);
});
