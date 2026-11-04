import { expect, test, type Browser, type Page } from '@playwright/test';
import { capture, open, openBackup, row, rows } from './helpers';

/** Captures items in a separate browser profile and exports them, via a real download. */
async function makeBackup(browser: Browser, texts: string[]): Promise<string> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await open(page);
  for (const text of texts) await capture(page, text);
  await openBackup(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export backup' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^capture-backup-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.getByRole('status')).toContainText(`Exported ${texts.length} item`);
  const file = test.info().outputPath(`backup-${Date.now()}.json`);
  await download.saveAs(file);
  await context.close();
  return file;
}

const preview = (page: Page) => page.getByRole('region', { name: 'Import preview' });

async function choose(page: Page, file: string) {
  await page.locator('#backup-file').setInputFiles(file);
  await expect(preview(page)).toBeVisible();
}

test('preview first; Cancel writes nothing; Import adds the items', async ({ page, browser }) => {
  const file = await makeBackup(browser, ['alpha from backup', 'beta from backup']);
  await open(page);
  await capture(page, 'already here');
  await openBackup(page);

  await choose(page, file);
  await expect(preview(page)).toContainText('Adds 2 new items.');
  await preview(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(preview(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(rows(page)).toHaveCount(1);
  await page.reload();
  await expect(rows(page)).toHaveCount(1); // and nothing reached IndexedDB

  await openBackup(page);
  await choose(page, file);
  await preview(page).getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Import finished.' })).toContainText('Added 2 new items.');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(rows(page)).toHaveCount(3);

  // Imported items are searchable straight away.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('alpha');
  await expect(row(page, 'alpha from backup')).toBeVisible();

  // Importing the same file again changes nothing, and says so.
  await page.getByRole('button', { name: 'Backup and restore' }).click();
  await choose(page, file);
  await expect(preview(page)).toContainText('Leaves 2 items as they are');
  await expect(preview(page).getByRole('button', { name: 'Import' })).toBeDisabled();
});

test('a preview made stale by another tab is refreshed, not applied', async ({ context, browser }) => {
  const file = await makeBackup(browser, ['shared item']);
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  await open(tabA);
  await open(tabB);

  // Both tabs preview the same file: each would add the item.
  for (const tab of [tabA, tabB]) {
    await openBackup(tab);
    await choose(tab, file);
    await expect(preview(tab)).toContainText('Adds 1 new item.');
  }

  // Tab B imports first.
  await preview(tabB).getByRole('button', { name: 'Import' }).click();
  await expect(tabB.getByRole('status').filter({ hasText: 'Import finished.' })).toBeVisible();

  // Tab A's confirm finds the database changed: nothing is written, and it
  // shows what importing would do now.
  await preview(tabA).getByRole('button', { name: 'Import' }).click();
  await expect(preview(tabA).getByRole('alert')).toContainText('Something changed since you chose this file');
  await expect(preview(tabA)).toContainText('Leaves 1 item as it is');
  await expect(preview(tabA).getByRole('button', { name: 'Import' })).toBeDisabled();

  // And tab A's list already shows the item, via cross-tab sync.
  await tabA.getByRole('button', { name: 'Close' }).click();
  await expect(rows(tabA)).toHaveCount(1);
  await expect(row(tabA, 'shared item')).toBeVisible();
});

test('a failed import transaction changes nothing and says so', async ({ page, browser }) => {
  const file = await makeBackup(browser, ['one', 'two', 'three']);

  // Make IndexedDB refuse read-write transactions while a flag is set: the
  // import's single transaction fails before it commits.
  await page.addInitScript(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<typeof original>) {
      if ((window as unknown as { failWrites?: boolean }).failWrites && args[1] === 'readwrite') {
        throw new DOMException('Simulated failure', 'UnknownError');
      }
      return original.apply(this, args);
    } as typeof original;
  });

  await open(page);
  await capture(page, 'kept safe');
  await openBackup(page);
  await choose(page, file);
  await expect(preview(page)).toContainText('Adds 3 new items.');

  await page.evaluate(() => ((window as unknown as { failWrites: boolean }).failWrites = true));
  await preview(page).getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('alert')).toContainText('The import didn’t finish, so nothing was changed.');
  await page.evaluate(() => ((window as unknown as { failWrites: boolean }).failWrites = false));

  await page.reload();
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 'kept safe')).toBeVisible();

  // Trying again once writes work imports everything, all at once.
  await openBackup(page);
  await choose(page, file);
  await preview(page).getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Import finished.' })).toContainText('Added 3 new items.');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(rows(page)).toHaveCount(4);
});

test('a file that is not a backup is refused before any preview', async ({ page }) => {
  await open(page);
  await openBackup(page);
  const file = test.info().outputPath('not-a-backup.json');
  await import('node:fs').then((fs) => fs.writeFileSync(file, JSON.stringify({ hello: 'world' })));
  await page.locator('#backup-file').setInputFiles(file);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(preview(page)).toHaveCount(0);
});
