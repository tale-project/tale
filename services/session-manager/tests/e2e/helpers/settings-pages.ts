import { expect, type Locator, type Page } from '@playwright/test';

import { TIMEOUT } from './env';
import { literally, t } from './i18n';

/** A label resolver: the English one (`t`), or the catalog of another language. */
export type Translate = (key: string) => string;

export type SettingsPage = 'general' | 'appearance' | 'ai-access';

const SETTINGS_PATHS: Record<SettingsPage, string> = {
  general: '/settings/general',
  appearance: '/settings/appearance',
  'ai-access': '/settings/ai-access',
};

/** The message key of each page's name (the panel's row, the page's heading, the tab title). */
const SETTINGS_TITLE_KEYS: Record<SettingsPage, string> = {
  general: 'settings.pages.general.title',
  appearance: 'settings.pages.appearance.title',
  'ai-access': 'settings.pages.aiAccess.title',
};

/**
 * The message key of the name each page goes by in the browser tab: the same as
 * its heading, except that "General" says too little in a tab.
 */
export const SETTINGS_TAB_KEYS: Record<SettingsPage, string> = {
  general: 'settings.pages.general.documentTitle',
  appearance: 'settings.pages.appearance.title',
  'ai-access': 'settings.pages.aiAccess.title',
};

/** Opens a settings page by its address and waits until its heading is there. */
export async function openSettings(
  page: Page,
  which: SettingsPage,
  translate: Translate = t,
): Promise<void> {
  await page.goto(SETTINGS_PATHS[which]);
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: translate(SETTINGS_TITLE_KEYS[which]),
    }),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
}

/**
 * The answers whose sentence only says to try again. Beside a "Try again"
 * button the alert names what could not be read and leaves them out (the
 * button says it, and the banner of the app says why the server could not be
 * asked): `readFailureText` of the app. A code the app has no words for is
 * worded as `fallback`, which is one of them.
 */
const ONLY_A_RETRY: ReadonlySet<string> = new Set([
  'network',
  'internal_error',
  'server_error',
  'fallback',
]);

/**
 * What the page says when the settings could not be read, for an answer with
 * this error code: the sentence that names what failed, and a cause (the
 * `errors.<code>` sentence) only when trying again does not mend it.
 */
function loadFailedText(code: string, translate: Translate = t): string {
  const lead = translate('settings.loadFailed');
  return ONLY_A_RETRY.has(code)
    ? lead
    : `${lead} ${translate(`errors.${code}`)}`;
}

/**
 * The page says the settings could not be read, in the words of `loadFailedText`
 * and no others: for an answer that only says "try again" the alert does not
 * carry the sentence of the code as well.
 */
export async function expectSettingsNotRead(
  page: Page,
  code: string,
  translate: Translate = t,
): Promise<void> {
  await expect(
    page.getByText(loadFailedText(code, translate), { exact: true }),
    `the alert for ${code}`,
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  if (ONLY_A_RETRY.has(code)) {
    await expect(
      page.getByText(translate(`errors.${code}`)),
      `${code}: the sentence of the code is not in the alert`,
    ).toHaveCount(0);
  }
}

// -- General ---------------------------------------------------------------------

export function startPageField(page: Page, translate: Translate = t): Locator {
  return page.getByRole('textbox', {
    name: translate('settings.general.startPage.label'),
  });
}

/** Save, or "Saved" for the moment after a save. */
export function saveButton(page: Page, translate: Translate = t): Locator {
  return page.getByRole('button', {
    name: new RegExp(
      `^(?:${literally(translate('common.actions.save')).source}|${
        literally(translate('common.actions.saved')).source
      })$`,
    ),
  });
}

export function discardButton(page: Page, translate: Translate = t): Locator {
  return page.getByRole('button', {
    name: translate('common.actions.discard'),
    exact: true,
  });
}

// -- AI access ---------------------------------------------------------------------

export function aiAccessSwitch(page: Page, translate: Translate = t): Locator {
  return page.getByRole('switch', {
    name: translate('settings.aiAccess.switch.label'),
  });
}

// -- Appearance --------------------------------------------------------------------

export type ThemeChoice = 'light' | 'dark' | 'system';

export function themeRadio(
  page: Page,
  choice: ThemeChoice,
  translate: Translate = t,
): Locator {
  return page.getByRole('radio', {
    name: translate(`themeSwitcher.${choice}`),
    exact: true,
  });
}

/** The button that opens the language menu; its name carries the language shown. */
export function languageButton(page: Page, translate: Translate = t): Locator {
  return page.getByRole('button', {
    name: new RegExp(
      `^${literally(translate('languageSwitcher.ariaLabel')).source}`,
    ),
  });
}

/** The state the document is in, as the theme and the language leave it. */
export interface DocumentLook {
  dark: boolean;
  colorScheme: string;
  lang: string;
  title: string;
  storedTheme: string | null;
  storedLanguage: string | null;
  /** The page's background, as `rgb(r, g, b)`. */
  background: string;
}

export function documentLook(page: Page): Promise<DocumentLook> {
  return page.evaluate(() => ({
    dark: document.documentElement.classList.contains('dark'),
    colorScheme: document.documentElement.style.colorScheme,
    lang: document.documentElement.lang,
    title: document.title,
    storedTheme: localStorage.getItem('tale-theme'),
    storedLanguage: localStorage.getItem('user-locale'),
    background: getComputedStyle(document.body).backgroundColor,
  }));
}

/**
 * What the tab shows for the theme: the icon, and the colour of the browser's
 * own bars. Each has a light and a dark version in the page's head, and the
 * theme pins one on (`media="all"`) and the other off (`media="not all"`).
 */
export interface TabLook {
  faviconLight: string | null;
  faviconDark: string | null;
  themeColorLight: string | null;
  themeColorDark: string | null;
}

export function tabLook(page: Page): Promise<TabLook> {
  return page.evaluate(() => {
    const media = (id: string) =>
      document.getElementById(id)?.getAttribute('media') ?? null;
    return {
      faviconLight: media('favicon-light'),
      faviconDark: media('favicon-dark'),
      themeColorLight: media('theme-color'),
      themeColorDark: media('theme-color-dark'),
    };
  });
}

/** The tab of a page whose theme is `theme`: that theme's icon and colour on, the other's off. */
export function tabLookFor(theme: 'light' | 'dark'): TabLook {
  const on = 'all';
  const off = 'not all';
  return {
    faviconLight: theme === 'light' ? on : off,
    faviconDark: theme === 'dark' ? on : off,
    themeColorLight: theme === 'light' ? on : off,
    themeColorDark: theme === 'dark' ? on : off,
  };
}

/** How light a CSS `rgb(r, g, b)` colour is, from 0 (black) to 1 (white). */
export function lightnessOf(background: string): number {
  const [r = 0, g = 0, b = 0] = (background.match(/[\d.]+/g) ?? []).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
