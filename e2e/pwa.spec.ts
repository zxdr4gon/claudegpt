import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { capture, captureBar, installed, open, openBackup, row, rows, server } from './helpers';

// The production build's service worker, in a real browser (DECISIONS #23).

test.afterEach(async () => {
  await server('up');
  await server('root/a');
});

const marker = (page: Page) => page.locator('meta[name="e2e-build"]');
const banner = (page: Page) => page.getByRole('status').filter({ hasText: 'A new version of Capture is ready.' });

test('first install precaches the app shell and no data', async ({ page }) => {
  await open(page);
  await installed(page);
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname);
    }
    return urls;
  });
  expect(cached).toContain('/index.html');
  expect(cached.some((u) => u.endsWith('.js'))).toBe(true);
  expect(cached.some((u) => u.endsWith('.css'))).toBe(true);
  expect(cached).toContain('/manifest.webmanifest');
  // Only built files: nothing else was cached at runtime.
  for (const url of cached) expect(url).toMatch(/\.(html|js|css|woff2|png|svg|webmanifest)$/);

  const manifest = await page.evaluate(() => fetch('/manifest.webmanifest').then((r) => r.json()));
  expect(manifest).toMatchObject({ name: 'Capture', display: 'standalone' });
});

test('works offline: reload, capture, edit, search, export and import', async ({ page, context, browser }) => {
  await open(page);
  await installed(page);
  await capture(page, 'captured online');

  // A second, empty profile that installed the app earlier, to import into.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await open(otherPage);
  await installed(otherPage);

  // Disconnect for real: the server drops connections and the browser is offline.
  await server('down');
  await context.setOffline(true);
  await other.setOffline(true);
  const reach = await page.evaluate(() => fetch('/__e2e/ping').then(() => 'reached', () => 'unreachable'));
  expect(reach).toBe('unreachable');
  await page.reload();
  await expect(row(page, 'captured online')).toBeVisible();

  await capture(page, 'captured offline #trip');
  await expect(row(page, 'captured offline')).toBeVisible();

  await row(page, 'captured online').getByRole('button', { name: /^Edit:/ }).click();
  const editor = page.getByLabel('Edit text');
  await editor.fill('edited offline');
  await editor.press('Enter');
  await expect(row(page, 'edited offline')).toBeVisible();

  await page.keyboard.press('Control+k');
  await page.keyboard.type('trip');
  await expect(row(page, 'captured offline')).toBeVisible();
  await page.keyboard.press('Escape');

  await openBackup(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export backup' }).click(),
  ]);
  const file = test.info().outputPath('offline-backup.json');
  await download.saveAs(file);
  const backup = JSON.parse(readFileSync(file, 'utf8')) as { items: Array<{ text: string }> };
  expect(backup.items.map((i) => i.text).sort()).toEqual(['captured offline #trip', 'edited offline']);

  // Import it into the other profile, also offline.
  await otherPage.reload();
  await openBackup(otherPage);
  await otherPage.locator('#backup-file').setInputFiles(file);
  const preview = otherPage.getByRole('region', { name: 'Import preview' });
  await expect(preview).toContainText('Adds 2 new items.');
  await preview.getByRole('button', { name: 'Import' }).click();
  await expect(otherPage.getByRole('status').filter({ hasText: 'Import finished.' })).toBeVisible();
  await otherPage.getByRole('button', { name: 'Close' }).click();
  await expect(rows(otherPage)).toHaveCount(2);
  await expect(row(otherPage, 'edited offline')).toBeVisible();
  await other.close();
});

test('an update waits for the user; Later keeps the old version; reload keeps the data', async ({ page }) => {
  await open(page);
  await installed(page);
  await capture(page, 'made in version a');
  await expect(marker(page)).toHaveCount(0);

  // Something half-typed when the update arrives.
  await captureBar(page).fill('half-typed thought');

  // Deploy version b, and let the browser check for it as it would on its own.
  await server('root/b');
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));
  await expect(banner(page)).toBeVisible();

  // Nothing reloaded: the text is still there, and this is still version a.
  await expect(captureBar(page)).toHaveValue('half-typed thought');
  await expect(marker(page)).toHaveCount(0);

  // Later: the banner goes, and version a keeps working.
  await banner(page).getByRole('button', { name: 'Later' }).click();
  await expect(banner(page)).toHaveCount(0);
  await captureBar(page).press('Enter');
  await expect(row(page, 'half-typed thought')).toBeVisible();

  // Even across a plain reload, version a stays until the user chooses.
  await page.reload();
  await expect(marker(page)).toHaveCount(0);
  await expect(banner(page)).toBeVisible();

  // Reload to update: version b, with every item intact and searchable.
  await banner(page).getByRole('button', { name: 'Reload to update' }).click();
  await expect(marker(page)).toHaveCount(1);
  await expect(banner(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(2);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('version');
  await expect(row(page, 'made in version a')).toBeVisible();
});
