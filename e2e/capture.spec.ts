import { expect, test } from '@playwright/test';
import { blur, capture, captureBar, open, row, rows } from './helpers';

// Real keystrokes in a real browser: what the unit tests for shortcutFor()
// can't show is how the browser, React and focus actually behave together.

test.beforeEach(async ({ page }) => {
  await open(page);
});

test('Enter saves at once and keeps the bar ready for the next thought', async ({ page }) => {
  const bar = captureBar(page);
  await expect(bar).toBeFocused(); // desktop pointer: autofocus
  await page.keyboard.type('buy milk #errands');
  await page.keyboard.press('Enter');
  await expect(bar).toHaveValue('');
  await expect(bar).toBeFocused();
  await expect(row(page, 'buy milk')).toBeVisible();

  // Survives a reload: it really is in IndexedDB.
  await page.reload();
  await expect(row(page, 'buy milk')).toBeVisible();
});

test('Shift+Enter adds a line instead of saving', async ({ page }) => {
  const bar = captureBar(page);
  await bar.click();
  await page.keyboard.type('line one');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('line two');
  await expect(bar).toHaveValue('line one\nline two');
  await expect(rows(page)).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('line one');
  await expect(rows(page).first()).toContainText('line two');
});

test('Enter during IME composition does not save', async ({ page }) => {
  const bar = captureBar(page);
  await bar.click();
  await page.keyboard.type('nihon');
  // Chromium has no scriptable IME, so send the keydown an IME produces when
  // Enter confirms a candidate: same event the browser would dispatch.
  await bar.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true, cancelable: true });
  await expect(bar).toHaveValue('nihon');
  await expect(rows(page)).toHaveCount(0);
  // Once composition has ended, Enter saves as usual.
  await page.keyboard.press('Enter');
  await expect(row(page, 'nihon')).toBeVisible();
});

test('Ctrl+Z undoes the last action, but inside a text field it stays native undo', async ({ page }) => {
  await capture(page, 'water plants');
  // click(), not check(): the row leaves the Inbox before it could read as checked.
  await row(page, 'water plants').getByRole('checkbox').click();
  await expect(row(page, 'water plants')).toHaveCount(0); // done items leave the Inbox
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();

  // In the capture bar, Ctrl+Z is the textarea's own undo, not the app's.
  const bar = captureBar(page);
  await bar.click();
  await page.keyboard.type('draft');
  await page.keyboard.press('Control+z');
  await expect(bar).not.toHaveValue('draft');
  await expect(row(page, 'water plants')).toHaveCount(0);

  // Outside any field, it undoes completing the item.
  await bar.fill('');
  await blur(page);
  await page.keyboard.press('Control+z');
  await expect(row(page, 'water plants')).toBeVisible();
  await expect(row(page, 'water plants').getByRole('checkbox')).not.toBeChecked();
});

test('/ opens search, except while typing', async ({ page }) => {
  const bar = captureBar(page);
  await bar.click();
  await page.keyboard.type('a/b');
  await expect(bar).toHaveValue('a/b');
  await expect(page.getByLabel('Search everything')).toHaveCount(0);

  await blur(page);
  await page.keyboard.press('/');
  const search = page.getByLabel('Search everything');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue(''); // the slash itself isn't typed
});

test('Ctrl+K opens search from anywhere, even the capture bar', async ({ page }) => {
  await capture(page, 'dentist appointment');
  const bar = captureBar(page);
  await bar.click();
  await page.keyboard.type('half-typed');
  await page.keyboard.press('Control+k');
  const search = page.getByLabel('Search everything');
  await expect(search).toBeFocused();
  await page.keyboard.type('dentst'); // typo: fuzzy match
  await expect(row(page, 'dentist appointment')).toBeVisible();
  // The half-typed capture is kept.
  await expect(bar).toHaveValue('half-typed');
});

test('j/k move between items, x completes, e edits, n returns to capture', async ({ page }) => {
  // Newest first in the Inbox.
  await capture(page, 'third');
  await capture(page, 'second');
  await capture(page, 'first');
  await blur(page);

  const focusedText = () => page.evaluate(() => document.activeElement?.closest('[data-item-id]')?.textContent ?? null);
  await page.keyboard.press('j');
  expect(await focusedText()).toContain('first');
  await page.keyboard.press('j');
  expect(await focusedText()).toContain('second');
  await page.keyboard.press('j');
  await page.keyboard.press('j'); // stops at the end
  expect(await focusedText()).toContain('third');
  await page.keyboard.press('k');
  expect(await focusedText()).toContain('second');

  // x completes the focused item; focus stays in the list.
  await page.keyboard.press('x');
  await expect(row(page, 'second')).toHaveCount(0);
  await expect.poll(focusedText).not.toBeNull();

  // e edits the focused item; Enter saves and returns focus to the row.
  await page.keyboard.press('k');
  expect(await focusedText()).toContain('first');
  await page.keyboard.press('e');
  const editor = page.getByLabel('Edit text');
  await expect(editor).toBeFocused();
  await editor.fill('first, edited');
  await page.keyboard.press('Enter');
  await expect(row(page, 'first, edited')).toBeVisible();
  await expect.poll(focusedText).toContain('first, edited');

  // Letters typed in the editor are text, not shortcuts.
  await page.keyboard.press('e');
  await page.keyboard.press('End');
  await page.keyboard.type(' jkx');
  await page.keyboard.press('Escape'); // Escape discards
  await expect(row(page, 'first, edited')).toBeVisible();
  await expect(row(page, 'jkx')).toHaveCount(0);

  await page.keyboard.press('n');
  await expect(captureBar(page)).toBeFocused();
  await expect(captureBar(page)).toHaveValue('');
});
