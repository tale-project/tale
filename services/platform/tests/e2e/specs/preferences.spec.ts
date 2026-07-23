import { readFileSync } from 'node:fs';

import { type Page } from '@playwright/test';
import { parse as parseYaml } from 'yaml';

import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { reloadAndSettle } from '../helpers/forms';
import { t } from '../helpers/i18n';

/**
 * User-preference coverage: theme switch and UI-language switch. Theme + locale
 * are per-origin client preferences on the worker's owner session, so each
 * mutating test CAPTURES the original value and RESTORES it unconditionally.
 *
 * Both controls live inside the account dropdown (`user-button.tsx`), opened
 * from the sidebar user button whose accessible name is
 * `auth.userButton.manageAccount`. Theme is a Radix `Tabs` row (system/light/
 * dark) wired to `useTheme()`; on this desktop viewport the language picker is a
 * Radix sub-menu wired to `useLocale()`. `setTheme` persists to
 * `localStorage['tale-theme']` and toggles the `dark` class on `<html>`;
 * `setLocale` writes `localStorage['user-locale']`, re-read first on next load.
 */

type StoredTheme = 'system' | 'light' | 'dark';

// Locale-invariant endonyms (always "Deutsch"/"English"). Their option labels
// live in `messages/global.json`, which the e2e `t()` (en-only) can't resolve,
// so they're safe local literals here, used only to pick the right radio.
const ENDONYM_GERMAN = 'Deutsch';
const ENDONYM_ENGLISH = 'English';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Read a dot-path key from the GERMAN catalog. Justified for a locale test:
 * after switching to German the visible UI no longer matches `messages/en.yml`
 * (which the shared `t()` reads), so we need the German label to assert the
 * switch took. Mirrors `helpers/i18n.ts`, scoped to this spec.
 */
function de(key: string): string {
  const messagesUrl = new URL('../../../messages/de.yml', import.meta.url);
  const parsed: unknown = parseYaml(readFileSync(messagesUrl, 'utf8'));
  let node: unknown = parsed;
  for (const part of key.split('.')) {
    if (!isRecord(node)) {
      throw new Error(`Missing de.yml key: ${key} (failed at "${part}")`);
    }
    node = node[part];
  }
  if (typeof node !== 'string') {
    throw new Error(`de.json key is not a string: ${key}`);
  }
  return node;
}

function chatUrl(organizationId: string): string {
  return `/dashboard/${organizationId}/chat`;
}

/**
 * The sidebar account-menu trigger (its tooltip is its accessible name).
 *
 * The accessible name is localized, and the language test switches the UI to
 * German mid-flow — so match EITHER locale's `manageAccount` label rather than
 * pinning English (which would stop matching once the app is in German). The
 * button also renders twice (desktop rail + `md:hidden` mobile header), so
 * filter to the visible (desktop) instance before `.first()`.
 */
function accountTrigger(page: Page) {
  const labels = [
    t('auth.userButton.manageAccount'),
    de('auth.userButton.manageAccount'),
  ].map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return page
    .getByRole('button', { name: new RegExp(labels.join('|')) })
    .filter({ visible: true })
    .first();
}

/** Open the account (user-button) dropdown from the sidebar. */
async function openAccountMenu(page: Page): Promise<void> {
  await accountTrigger(page).click();
  await expect(page.getByRole('menu').first()).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });
}

/** Close the open dropdown so a later re-open starts from a clean slate. */
async function closeMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0, {
    timeout: TIMEOUT.VISIBLE,
  });
}

/** The current persisted theme preference (`tale-theme`), "system" if unset. */
async function readStoredTheme(page: Page): Promise<StoredTheme> {
  const raw = await page.evaluate(() =>
    window.localStorage.getItem('tale-theme'),
  );
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

function themeTabName(theme: StoredTheme): string {
  if (theme === 'light') return t('auth.userButton.themeLight');
  if (theme === 'dark') return t('auth.userButton.themeDark');
  return t('auth.userButton.themeSystem');
}

/** Click a theme tab (system/light/dark) inside the open account menu. */
async function selectThemeTab(page: Page, theme: StoredTheme): Promise<void> {
  await openAccountMenu(page);
  await page
    .getByRole('tab', { name: themeTabName(theme), exact: true })
    .click();
  await closeMenu(page);
}

test.describe('user preferences', () => {
  test('theme: switches to dark, persists across reload, then restores', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(chatUrl(organizationId));
    await expect(accountTrigger(page)).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });

    // CAPTURE the original preference so we can restore it exactly.
    const originalTheme = await readStoredTheme(page);
    const root = page.locator('html');

    await selectThemeTab(page, 'dark');

    // The provider toggles the `dark` class on <html> and sets color-scheme.
    await expect(root).toHaveClass(/(^|\s)dark(\s|$)/, {
      timeout: TIMEOUT.VISIBLE,
    });
    await expect(root).toHaveCSS('color-scheme', 'dark', {
      timeout: TIMEOUT.VISIBLE,
    });
    expect(await readStoredTheme(page)).toBe('dark');

    // Reload, settle on the account trigger, then assert the persisted theme
    // rehydrated from localStorage (not React state).
    await reloadAndSettle(page, accountTrigger(page));
    await expect(root).toHaveClass(/(^|\s)dark(\s|$)/, {
      timeout: TIMEOUT.PERSIST,
    });
    await expect(root).toHaveCSS('color-scheme', 'dark', {
      timeout: TIMEOUT.PERSIST,
    });
    expect(await readStoredTheme(page)).toBe('dark');

    // RESTORE the original theme unconditionally.
    await selectThemeTab(page, originalTheme);
    expect(await readStoredTheme(page)).toBe(originalTheme);
    if (originalTheme === 'dark') {
      await expect(root).toHaveClass(/(^|\s)dark(\s|$)/);
    } else if (originalTheme === 'light') {
      await expect(root).not.toHaveClass(/(^|\s)dark(\s|$)/);
    }
    // "system" follows the OS; we only assert the stored value is back.
  });

  test('language: switches to German, persists across reload, then restores to English', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(chatUrl(organizationId));
    await expect(accountTrigger(page)).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });

    const originalLocale = await page.evaluate(() =>
      window.localStorage.getItem('user-locale'),
    );

    // Open the account menu → the Language sub-menu (Radix opens on hover),
    // then pick German by its locale-invariant endonym.
    await openAccountMenu(page);
    await page
      .getByRole('menuitem', { name: t('auth.userButton.language') })
      .hover();
    await page.getByRole('menuitemradio', { name: ENDONYM_GERMAN }).click();

    await expect
      .poll(
        async () =>
          page.evaluate(() => window.localStorage.getItem('user-locale')),
        { timeout: TIMEOUT.VISIBLE },
      )
      .toMatch(/^de/);

    // Re-open and assert the "Language" row label is now German (its German
    // translation comes from de.json and must differ from the English string).
    const germanLanguageLabel = de('auth.userButton.language');
    expect(germanLanguageLabel).not.toBe(t('auth.userButton.language'));
    await openAccountMenu(page);
    await expect(
      page.getByRole('menuitem', { name: germanLanguageLabel }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await closeMenu(page);

    // Reload, settle, then confirm the locale was re-detected and stays German.
    await reloadAndSettle(page, accountTrigger(page));
    await openAccountMenu(page);
    await expect(
      page.getByRole('menuitem', { name: germanLanguageLabel }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // RESTORE to English from the same sub-menu.
    await page.getByRole('menuitem', { name: germanLanguageLabel }).hover();
    await page.getByRole('menuitemradio', { name: ENDONYM_ENGLISH }).click();

    await expect
      .poll(
        async () =>
          page.evaluate(() => window.localStorage.getItem('user-locale')),
        { timeout: TIMEOUT.VISIBLE },
      )
      .toMatch(/^en/);
    await openAccountMenu(page);
    await expect(
      page.getByRole('menuitem', { name: t('auth.userButton.language') }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await closeMenu(page);

    // If the worker somehow started non-English, restore that exact value so we
    // never leave the session in an unexpected locale.
    if (originalLocale && !originalLocale.startsWith('en')) {
      await page.evaluate((loc) => {
        window.localStorage.setItem('user-locale', loc);
      }, originalLocale);
    }
  });
});
