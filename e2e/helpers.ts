import { expect, type Page } from '@playwright/test';

export const SERVER = 'http://localhost:4181';

/** Talk to the test server from Node (never from the page). */
export async function server(command: 'up' | 'down' | 'root/a' | 'root/b') {
  const res = await fetch(`${SERVER}/__e2e/${command}`, { method: 'POST' });
  if (res.status !== 204) throw new Error(`server ${command}: ${res.status}`);
}

export const captureBar = (page: Page) => page.getByLabel('Capture a thought');
export const rows = (page: Page) => page.locator('main [data-item-id]');
export const row = (page: Page, text: string) => page.locator('main [data-item-id]', { hasText: text });

/** Opens the app and waits until the store has loaded and a view is showing. */
export async function open(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.getByRole('navigation', { name: 'Views' })).toBeVisible();
  await page.waitForFunction(() => (document.querySelector('main')?.childElementCount ?? 0) > 0);
}

export async function capture(page: Page, text: string) {
  const bar = captureBar(page);
  await bar.click();
  await bar.fill(text);
  await bar.press('Enter');
  await expect(bar).toHaveValue('');
}

/** Moves focus out of every field, as if the user clicked the page background. */
export async function blur(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

export async function view(page: Page, name: 'Inbox' | 'Today' | 'Upcoming' | 'Everything') {
  await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name, exact: true }).click();
}

export async function openBackup(page: Page) {
  await page.getByRole('button', { name: 'Backup and restore' }).click();
  await expect(page.getByRole('heading', { name: 'Backup and restore' })).toBeVisible();
}

/** Waits until the service worker has precached the app and controls the page. */
export async function installed(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  }
}
