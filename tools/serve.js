#!/usr/bin/env node
/* Tiny zero-dependency static server for One Piece Fight.
 *
 * Why not `python3 -m http.server`: it sends no Cache-Control at all, so browsers
 * apply heuristic caching and happily keep serving the *previous* build of
 * js/*.js for minutes after a fix.  That looks exactly like "the fix didn't work".
 * This server always sends no-store, so a reload always gets the current build.
 *
 * Usage:  node tools/serve.js [port]        (default 8000, binds 0.0.0.0)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8000);
const HOST = process.env.HOST || '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function send(res, code, body, headers) {
  res.writeHead(code, Object.assign({
    // never let a browser hold on to an old build
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Access-Control-Allow-Origin': '*',
  }, headers || {}));
  if (body === null) res.end(); else res.end(body);
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    return send(res, 400, 'bad request');
  }
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  // keep requests inside the project directory
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) return send(res, 403, 'forbidden');

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      return send(res, 404, 'not found: ' + urlPath, { 'Content-Type': 'text/plain' });
    }
    const type = TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    if (req.method === 'HEAD') {
      return send(res, 200, null, { 'Content-Type': type, 'Content-Length': st.size });
    }
    fs.readFile(filePath, (e2, buf) => {
      if (e2) return send(res, 500, 'read error');
      send(res, 200, buf, { 'Content-Type': type, 'Content-Length': buf.length });
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`One Piece Fight served from ${ROOT}`);
  console.log(`  http://${HOST}:${PORT}/   (no-store: reloads always get the current build)`);
});
