// A static server for the end-to-end tests, serving the production build.
// Test code (Node, never the page) controls it:
//   POST /__e2e/root/a|b  switch between the build and its patched "next version"
//   POST /__e2e/down|up   refuse every other request, as if the server were gone
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.E2E_PORT ?? 4181);
const ROOTS = { a: 'dist', b: 'e2e/.build-b' };
let root = 'a';
let down = false;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/__e2e/')) {
    const [, , what, arg] = url.pathname.split('/');
    if (what === 'root' && arg in ROOTS) root = arg;
    else if (what === 'down') down = true;
    else if (what === 'up') down = false;
    else if (what !== 'ping') return void res.writeHead(404).end();
    return void res.writeHead(204).end();
  }
  // Like a stopped server: drop the connection without answering.
  if (down) return void req.socket.destroy();

  const base = normalize(ROOTS[root]);
  let file = normalize(join(base, decodeURIComponent(url.pathname)));
  if (!file.startsWith(base)) return void res.writeHead(403).end();
  try {
    if (statSync(file).isDirectory()) throw new Error('directory');
  } catch {
    file = join(base, 'index.html'); // single-page fallback
  }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    // Always revalidate, so a build switch is seen at once (sw.js especially).
    'Cache-Control': 'no-cache',
  });
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`e2e server on http://localhost:${PORT}`));
