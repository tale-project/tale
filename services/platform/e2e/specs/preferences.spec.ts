import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { t } from '../helpers/i18n';
import { readRunContext } from '../helpers/test-context';

/**
 * Cross-cutting USER-PREFERENCE coverage: theme + UI language, plus the account
 * (user-button) menu that hosts both. Runs as the pre-authenticated owner
 * (chromium project storageState); never signs up / logs in / logs out.
 *
 * Where these live in THIS app (important — the platform does NOT mount the
 * `@tale/ui` `ThemeSwitcher` / `LanguageSwitcher` site components for an
 * authenticated user; those only appear in the first-run onboarding step the
 * owner already passed): both controls live inside the account dropdown
 * (`app/components/user-button.tsx`), opened from the sidebar user button whose
 * accessible name is `auth.userButton.manageAccount` ("Manage account").
 *  - Theme: a Radix `Tabs` row (three icon tabs — system / light / dark) wired
 *    to `useTheme()` from `@tale/ui/theme`. Each tab is `role="tab"` with an
 *    aria-label (`auth.userButton.themeSystem|themeLight|themeDark`).
 *  - Language: on this (Desktop Chrome, 1280px ≥ md) viewport the picker is a
 *    Radix SUB-MENU — a `role="menuitem"` trigger named `auth.userButton.language`
 *    ("Language") that opens `role="menuitemradio"` options. It is wired to
 *    `useLocale()` from `@tale/ui/i18n/locale-provider`.
 *
 * How the theme reaches the DOM (read from `theme-provider.tsx`): `setTheme`
 * persists to `localStorage['tale-theme']` and `applyDocumentClass` toggles the
 * `dark` class on `<html>` (`document.documentElement`) and sets
 * `root.style.colorScheme` to the resolved theme — so we assert on the root
 * element's class + inline `color-scheme`, and on the persisted storage key.
 * How the locale persists: `setLocale` writes `localStorage['user-locale']` and
 * `detectLocale` reads it back first on the next load (survives reload).
 *
 * IDEMPOTENCY (non-negotiable — theme + locale are shared per-origin client
 * preferences on the owner session): every test CAPTURES the original value
 * (theme: the `tale-theme` storage value, defaulting to "system" when unset;
 * locale: the `<html lang>` / `user-locale` value, expected English) and
 * RESTORES it through the same UI controls at the end, then re-asserts the
 * restore. Nothing else is mutated. The user-menu test is read-only.
 */

type StoredTheme = 'system' | 'light' | 'dark';

// The endonym for German as rendered by the language picker. The option labels
// come from the `global.languages.*` catalog, which lives in a SEPARATE
// messages file (`messages/global.json`) that the e2e `t()` helper — which
// reads ONLY `messages/en.json` — cannot resolve (it would throw). These
// endonyms are locale-INVARIANT by design (always "Deutsch" / "English"
// regardless of the active locale), so they are safe local literals here, in
// the same spirit as the fixture-name constants in `settings.spec.ts`. Used
// only to pick the right radio option by its accessible name.
const ENDONYM_GERMAN = 'Deutsch';
const ENDONYM_ENGLISH = 'English';

/**
 * Read a dot-path key from the GERMAN service catalog (`messages/de.json`).
 * Justified for a locale test: after switching to German the visible UI no
 * longer matches `messages/en.json` (which the shared `t()` reads), so we need
 * the German translation of a stable label to assert the switch took. Mirrors
 * the lookup logic of `helpers/i18n.ts`, scoped to this one spec.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function de(key: string): string {
  const messagesUrl = new URL('../../messages/de.json', import.meta.url);
  const parsed: unknown = JSON.parse(readFileSync(messagesUrl, 'utf8'));
  let node: unknown = parsed;
  for (const part of key.split('.')) {
    if (!isRecord(node)) {
      throw new Error(`Missing de.json key: ${key} (failed at "${part}")`);
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

/** Open the account (user-button) dropdown from the sidebar. */
async function openAccountMenu(page: Page): Promise<void> {
  // The trigger carries the "Manage account" tooltip as its accessible name.
  // `.first()` guards against the desktop sidebar vs mobile-header copies both
  // being in the tree (only the desktop one is visible at this viewport).
  await page
    .getByRole('button', { name: t('auth.userButton.manageAccount') })
    .first()
    .click();
  // The dropdown content is `role="menu"`; wait for it before interacting.
  await expect(page.getByRole('menu').first()).toBeVisible({
    timeout: 60_000,
  });
}

/** Close the open dropdown so a later re-open starts from a clean slate. */
async function closeMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 20_000 });
}

/** The current persisted theme preference (`tale-theme`), "system" if unset. */
async function readStoredTheme(page: Page): Promise<StoredTheme> {
  const raw = await page.evaluate(() =>
    window.localStorage.getItem('tale-theme'),
  );
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

/** Map a stored-theme value to its theme-tab accessible name. */
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
  }) => {
    const { organizationId } = readRunContext();
    await page.goto(chatUrl(organizationId));

    // The sidebar user button proves the dashboard shell mounted.
    const accountTrigger = page
      .getByRole('button', { name: t('auth.userButton.manageAccount') })
      .first();
    await expect(accountTrigger).toBeVisible({ timeout: 60_000 });

    // CAPTURE the original preference so we can restore it exactly. The owner
    // session defaults to "system" (no stored override) → resolves to light.
    const originalTheme = await readStoredTheme(page);
    const root = page.locator('html');

    // Switch to DARK via the theme tab in the account menu.
    await selectThemeTab(page, 'dark');

    // The provider toggles the `dark` class on <html> and sets color-scheme.
    await expect(root).toHaveClass(/(^|\s)dark(\s|$)/, { timeout: 20_000 });
    await expect(root).toHaveCSS('color-scheme', 'dark', { timeout: 20_000 });
    expect(await readStoredTheme(page)).toBe('dark');

    // Reload: the preference must come back from localStorage, not React state.
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/, {
      timeout: 60_000,
    });
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark', {
      timeout: 20_000,
    });
    expect(await readStoredTheme(page)).toBe('dark');

    // RESTORE the original theme (keeps the shared owner session unchanged).
    await selectThemeTab(page, originalTheme);
    expect(await readStoredTheme(page)).toBe(originalTheme);
    if (originalTheme === 'dark') {
      await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);
    } else if (originalTheme === 'light') {
      await expect(page.locator('html')).not.toHaveClass(/(^|\s)dark(\s|$)/);
    }
    // "system" resolves to the headless default (light) but we only assert the
    // stored value is back to the original; the resolved class follows the OS.
  });

  test('language: switches to German, persists across reload, then restores to English', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    await page.goto(chatUrl(organizationId));
    await expect(
      page
        .getByRole('button', { name: t('auth.userButton.manageAccount') })
        .first(),
    ).toBeVisible({ timeout: 60_000 });

    // CAPTURE the original locale (expected English / unset on the owner).
    const originalLocale = await page.evaluate(() =>
      window.localStorage.getItem('user-locale'),
    );

    // Open the account menu → the Language sub-menu, then pick German.
    await openAccountMenu(page);
    // Hover the sub-trigger to open its sub-content (Radix opens on hover),
    // then click the German radio option (located by its locale-invariant
    // endonym, since its label key is not in the e2e-readable catalog).
    await page
      .getByRole('menuitem', { name: t('auth.userButton.language') })
      .hover();
    await page.getByRole('menuitemradio', { name: ENDONYM_GERMAN }).click();

    // The picker writes the German locale to localStorage immediately.
    await expect
      .poll(
        async () =>
          page.evaluate(() => window.localStorage.getItem('user-locale')),
        { timeout: 20_000 },
      )
      .toMatch(/^de/);

    // Selecting a radio option closes the menu; re-open it and assert a STABLE
    // visible label is now German. The account menu's own "Language" row label
    // is the anchor — its German translation comes from de.json (justified
    // in-test read), and it must differ from the English string `t()` returns.
    const germanLanguageLabel = de('auth.userButton.language');
    expect(germanLanguageLabel).not.toBe(t('auth.userButton.language'));
    await openAccountMenu(page);
    await expect(
      page.getByRole('menuitem', { name: germanLanguageLabel }),
    ).toBeVisible({ timeout: 20_000 });
    await closeMenu(page);

    // Reload: the locale must be re-detected from localStorage and stay German.
    await page.reload();
    await expect(
      page
        .getByRole('button', { name: t('auth.userButton.manageAccount') })
        .first(),
    ).toBeVisible({ timeout: 60_000 });
    await openAccountMenu(page);
    await expect(
      page.getByRole('menuitem', { name: germanLanguageLabel }),
    ).toBeVisible({ timeout: 20_000 });

    // RESTORE to English: pick the English option from the same sub-menu.
    await page.getByRole('menuitem', { name: germanLanguageLabel }).hover();
    await page.getByRole('menuitemradio', { name: ENDONYM_ENGLISH }).click();

    // localStorage is back to English, and the menu label reads English again.
    await expect
      .poll(
        async () =>
          page.evaluate(() => window.localStorage.getItem('user-locale')),
        { timeout: 20_000 },
      )
      .toMatch(/^en/);
    await openAccountMenu(page);
    await expect(
      page.getByRole('menuitem', { name: t('auth.userButton.language') }),
    ).toBeVisible({ timeout: 20_000 });
    await closeMenu(page);

    // Belt-and-braces: the owner started English/unset; we left it English.
    if (originalLocale && !originalLocale.startsWith('en')) {
      // The owner somehow started non-English — restore that exact value via
      // storage so we never leave the shared session in an unexpected locale.
      await page.evaluate((loc) => {
        window.localStorage.setItem('user-locale', loc);
      }, originalLocale);
    }
  });

  test('user menu: renders the account, preference, and session items', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    await page.goto(chatUrl(organizationId));
    await expect(
      page
        .getByRole('button', { name: t('auth.userButton.manageAccount') })
        .first(),
    ).toBeVisible({ timeout: 60_000 });

    await openAccountMenu(page);
    const menu = page.getByRole('menu').first();

    // Account header: the owner's display name (read from context) anchors the
    // label group at the top of the menu.
    const { ownerEmail } = readRunContext();
    await expect(menu.getByText(ownerEmail).first()).toBeVisible({
      timeout: 20_000,
    });

    // Org + team pickers (sub-menu triggers on this viewport).
    await expect(
      menu.getByRole('menuitem', { name: t('navigation.orgSwitcher.label') }),
    ).toBeVisible();
    await expect(
      menu.getByRole('menuitem', { name: t('navigation.teamFilter.label') }),
    ).toBeVisible();

    // Theme control: the three theme tabs each render with their aria-label.
    await expect(
      menu.getByRole('tab', {
        name: t('auth.userButton.themeSystem'),
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      menu.getByRole('tab', {
        name: t('auth.userButton.themeLight'),
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      menu.getByRole('tab', {
        name: t('auth.userButton.themeDark'),
        exact: true,
      }),
    ).toBeVisible();

    // Language control (sub-menu trigger).
    await expect(
      menu.getByRole('menuitem', { name: t('auth.userButton.language') }),
    ).toBeVisible();

    // Session items: help & feedback, and the log-out entry — asserted present,
    // NEVER clicked (logging out would poison the shared owner session).
    await expect(
      menu.getByRole('menuitem', { name: t('auth.userButton.helpFeedback') }),
    ).toBeVisible();
    await expect(
      menu.getByRole('menuitem', { name: t('auth.userButton.logOut') }),
    ).toBeVisible();

    await closeMenu(page);
  });
});
