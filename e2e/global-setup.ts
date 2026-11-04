import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

/**
 * Makes "build b": the production build with a visible marker in index.html
 * and the matching precache revision in sw.js. Serving it in place of build a
 * is a real app update as far as the browser is concerned (sw.js changed).
 */
export default function globalSetup() {
  if (!existsSync('dist/sw.js')) throw new Error('Run `npm run build` first (or use `npm run e2e`).');
  rmSync('e2e/.build-b', { recursive: true, force: true });
  cpSync('dist', 'e2e/.build-b', { recursive: true });

  const html = readFileSync('e2e/.build-b/index.html', 'utf8').replace(
    '<head>',
    '<head><meta name="e2e-build" content="b">',
  );
  writeFileSync('e2e/.build-b/index.html', html);

  const revision = createHash('md5').update(html).digest('hex');
  const sw = readFileSync('e2e/.build-b/sw.js', 'utf8');
  const patched = sw.replace(/(\{url:"index\.html",revision:")[0-9a-f]+(")/, `$1${revision}$2`);
  if (patched === sw) throw new Error('Could not find index.html in the sw.js precache list');
  writeFileSync('e2e/.build-b/sw.js', patched);
}
