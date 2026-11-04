import { expect, test, type Page } from '@playwright/test';
import { capture, captureBar, open, openBackup, rows } from './helpers';

// navigator.storage is stubbed so the test decides what the browser answers
// and when, and can count the requests. Everything else is the real app.

type Answer = 'grant' | 'deny' | 'hang';

async function stubStorage(page: Page, answer: Answer) {
  await page.addInitScript((answer: Answer) => {
    const w = window as unknown as { persistCalls: number; answerPersist: (yes: boolean) => void };
    w.persistCalls = 0;
    let granted = false;
    const pending: Array<(yes: boolean) => void> = [];
    // The test can answer a hanging request later.
    w.answerPersist = (yes) => {
      granted = yes;
      for (const resolve of pending.splice(0)) resolve(yes);
    };
    navigator.storage.persisted = async () => granted;
    navigator.storage.persist = () => {
      w.persistCalls++;
      if (answer === 'hang') return new Promise((resolve) => pending.push(resolve));
      granted = answer === 'grant';
      return Promise.resolve(granted);
    };
  }, answer);
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { persistCalls: number }).persistCalls);
const footerNote = (page: Page) => page.locator('footer').getByText('This browser may clear your data');

test('asks only after the first capture, once, and capture never waits for it', async ({ page }) => {
  await stubStorage(page, 'hang');
  await open(page);
  expect(await calls(page)).toBe(0); // nothing captured yet: don't ask

  // The browser never answers, and three captures in a row still save at once.
  const bar = captureBar(page);
  await bar.click();
  for (const text of ['one', 'two', 'three']) {
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
  }
  await expect(rows(page)).toHaveCount(3);
  expect(await calls(page)).toBe(1);
  await expect(footerNote(page)).toHaveCount(0); // no answer yet: say nothing

  // The browser finally says no: one quiet line, no dialog.
  await page.evaluate(() => (window as unknown as { answerPersist: (yes: boolean) => void }).answerPersist(false));
  await expect(footerNote(page)).toBeVisible();
  await capture(page, 'four');
  expect(await calls(page)).toBe(1);
});

test('denied: the footer note and backup text say so, and a reload does not ask again', async ({ page }) => {
  await stubStorage(page, 'deny');
  await open(page);
  await expect(footerNote(page)).toHaveCount(0);
  await capture(page, 'first thought');
  await expect(footerNote(page)).toBeVisible();
  await openBackup(page);
  await expect(page.getByText('This browser may clear your data if it runs low on space.', { exact: false }).first()).toBeVisible();

  await page.reload();
  await expect(footerNote(page)).toBeVisible(); // remembered that we asked
  await capture(page, 'after reload');
  expect(await calls(page)).toBe(0); // new page, and no second request
});

test('granted: no warning, and the backup text stays honest', async ({ page }) => {
  await stubStorage(page, 'grant');
  await open(page);
  await capture(page, 'first thought');
  await expect.poll(() => calls(page)).toBe(1);
  await openBackup(page);
  await expect(page.getByText('This browser has agreed not to clear your data on its own. Clearing site data still removes it.')).toBeVisible();
  await expect(footerNote(page)).toHaveCount(0);
});
