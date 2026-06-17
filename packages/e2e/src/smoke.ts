import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Reusable smoke assertions for the mostly-static frontend services (web,
 * docs). Dependency-free on purpose — no axe/extra tooling — so the suites
 * stay cheap to run on every push.
 */

/** Benign console noise that should not fail a smoke test. */
const DEFAULT_IGNORE: RegExp[] = [
  /favicon/i,
  /ResizeObserver loop/i,
  /\[vite\]/i,
  /service worker/i,
  /Manifest:/i,
];

/**
 * Start collecting console + uncaught page errors. Call before navigating, then
 * assert the returned array is empty at the end of the test. Benign dev noise
 * is filtered by default so the check stays meaningful rather than flaky; pass
 * your own patterns to override.
 */
export function collectConsoleErrors(
  page: Page,
  ignore: RegExp[] = DEFAULT_IGNORE,
): string[] {
  const errors: string[] = [];
  const record = (text: string): void => {
    if (!ignore.some((pattern) => pattern.test(text))) {
      errors.push(text);
    }
  };
  page.on('console', (message) => {
    if (message.type() === 'error') {
      record(message.text());
    }
  });
  page.on('pageerror', (error) => {
    record(error.message);
  });
  return errors;
}

/** Assert the page reached a usable state: body plus a main/heading landmark. */
export async function expectPageRenders(page: Page): Promise<void> {
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('main, [role="main"], h1').first()).toBeVisible();
}
