import type { Page } from '@playwright/test';

import type { AppApi } from '../helpers/api';
import { timesShown, typedTexts, type Control } from '../helpers/control';
import { TIMEOUT } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { fill, literally, t } from '../helpers/i18n';
import { animationsDone } from '../helpers/nav-a11y';
import {
  describeStop,
  focusRestsOnAControl,
  focusedStop,
  startFromTop,
  tabWalkFaults,
  walkTabOrder,
} from '../helpers/nav-focus';
import { serveOtherSite } from '../helpers/nav-http';
import { horizontalOverflow } from '../helpers/nav-overflow';
import { AT_REST, pillState } from '../helpers/nav-pill';
import {
  proxiesWorkingAndNot,
  secretsOfEveryKind,
  sessionsInEveryState,
} from '../helpers/nav-scenes';
import {
  DESKTOP,
  MD_BREAKPOINT,
  PHONE,
  SIDEWAYS,
  WIDTHS,
  viewportAt,
  type Viewport,
} from '../helpers/nav-viewports';
import {
  APP_NAME,
  languageName,
  plural,
  tIn,
  tabTitle,
} from '../helpers/settings-i18n';
import { AI_ACCESS_OFF, McpClient } from '../helpers/settings-mcp';
import { expectSettingsNotRead } from '../helpers/settings-pages';

// What a test changes in the manager's settings, or scripts in the fakes, goes
// back to the defaults when it ends, whether it passed or not.
test.afterEach(async ({ api, control }) => {
  await control.clear();
  await api.updateSettings({ startPage: '', mcpEnabled: false });
});

// =============================================================================
// Locators of the frame
// =============================================================================

type Section = 'sessions' | 'proxies' | 'secrets' | 'settings';
const SECTIONS: readonly Section[] = [
  'sessions',
  'proxies',
  'secrets',
  'settings',
];
const sectionName = (section: Section) => t(`navigation.sections.${section}`);

/** The app rail of a computer. */
const rail = (page: Page) =>
  page.getByRole('complementary', { name: t('navigation.landmark') });

const railLink = (page: Page, section: Section) =>
  rail(page).getByRole('link', { name: sectionName(section), exact: true });

/** The tab bar of a phone. */
const tabBar = (page: Page) =>
  page.getByRole('navigation', { name: t('navigation.aria.primary') });

const tabOf = (page: Page, section: Section) =>
  tabBar(page).getByRole('button', { name: sectionName(section), exact: true });

/** The panel of the Sessions section, beside the page. */
const sessionsPanel = (page: Page) =>
  page.getByRole('navigation', {
    name: t('sessions.panel.title'),
    exact: true,
  });

/** The panel of the Settings section, beside the page. */
const settingsPanel = (page: Page) =>
  page.getByRole('navigation', { name: t('settings.nav.label') });

const heading = (page: Page, name: string) =>
  page.getByRole('heading', { level: 1, name, exact: true });

function onADesktop(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= MD_BREAKPOINT;
}

/** Exactly this section is marked as the current one, in the rail or in the tab bar, whichever the window shows. */
async function expectCurrentSection(
  page: Page,
  current: Section | null,
): Promise<void> {
  for (const section of SECTIONS) {
    const item = onADesktop(page)
      ? railLink(page, section)
      : tabOf(page, section);
    if (section === current) {
      await expect(item, `${section} is current`).toHaveAttribute(
        'aria-current',
        'page',
      );
    } else {
      await expect(item, `${section} is not current`).not.toHaveAttribute(
        'aria-current',
        'page',
      );
    }
  }
}

/**
 * The rail's pill: the sections and Settings are lists of their own in the one
 * navigation, and each list has a pill; this is the one of the list that holds
 * the current section (the other rests, unseen).
 */
const railPill = (page: Page) =>
  rail(page)
    .locator('ul')
    .filter({ has: page.locator('a[aria-current="page"]') })
    .locator(':scope > span[aria-hidden="true"]');

async function expectPillOnCurrentSection(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        pillState(
          railPill(page),
          rail(page).getByRole('navigation').locator('a[aria-current="page"]'),
        ),
      { message: "the rail's pill rests on the current section" },
    )
    .toEqual(AT_REST);
}

/** Where the person is: the address, the page's one heading and the section marked. */
async function expectAt(
  page: Page,
  where: { path: RegExp; heading: string; section: Section | null },
): Promise<void> {
  await expect(page).toHaveURL(where.path);
  await expect(heading(page, where.heading)).toBeVisible();
  await expectCurrentSection(page, where.section);
}

// =============================================================================
// The rail
// =============================================================================

test.describe('The rail (computer)', () => {
  test('offers the sections in order, with Settings at the foot', async ({
    page,
  }) => {
    await page.goto('/sessions');
    // One navigation holds the sections and, in a list of its own, Settings.
    const nav = rail(page).getByRole('navigation', {
      name: t('navigation.aria.main'),
    });
    await expect(rail(page).getByRole('navigation')).toHaveCount(1);
    await expect(nav.getByRole('list')).toHaveCount(2);

    const links = nav.getByRole('link');
    await expect(links).toHaveCount(SECTIONS.length);
    for (const [index, section] of SECTIONS.entries()) {
      await expect(links.nth(index)).toHaveAccessibleName(sectionName(section));
      await expect(links.nth(index)).toHaveAttribute('href', `/${section}`);
    }
    await expect(nav.getByRole('list').last().getByRole('link')).toHaveCount(1);
    await expect(
      nav.getByRole('list').last().getByRole('link'),
    ).toHaveAccessibleName(sectionName('settings'));

    // Settings sits at the bottom of the rail, below the others.
    const [last, settings] = await Promise.all([
      railLink(page, 'secrets').boundingBox(),
      railLink(page, 'settings').boundingBox(),
    ]);
    const viewport = page.viewportSize();
    expect(settings?.y ?? 0).toBeGreaterThan((last?.y ?? 0) + 100);
    expect((settings?.y ?? 0) + (settings?.height ?? 0)).toBeGreaterThan(
      (viewport?.height ?? 0) - 60,
    );

    // The logo leads home, and is named for the app.
    await expect(
      rail(page).getByRole('link', { name: APP_NAME, exact: true }),
    ).toHaveAttribute('href', '/sessions');
  });

  test('marks the section the person is in, and only that one', async ({
    page,
    api,
  }) => {
    const running = await api.startSession('alpha');
    const places: Array<{ path: string; section: Section }> = [
      { path: '/sessions', section: 'sessions' },
      { path: `/sessions/${running.id}`, section: 'sessions' },
      { path: '/proxies', section: 'proxies' },
      { path: '/secrets', section: 'secrets' },
      { path: '/settings/general', section: 'settings' },
      { path: '/settings/appearance', section: 'settings' },
      { path: '/settings/ai-access', section: 'settings' },
    ];

    for (const { path, section } of places) {
      await page.goto(path);
      await expectCurrentSection(page, section);
      await expectPillOnCurrentSection(page);
    }
  });

  test('moves its pill to the section that is chosen', async ({ page }) => {
    await page.goto('/sessions');
    await expectPillOnCurrentSection(page);

    for (const section of [
      'proxies',
      'secrets',
      'settings',
      'sessions',
    ] as const) {
      await railLink(page, section).click();
      await expectCurrentSection(page, section);
      await expectPillOnCurrentSection(page);
    }
  });

  test('names a section in a tooltip, to a pointer and to the keyboard', async ({
    page,
  }) => {
    await page.goto('/sessions');
    const tooltip = page.getByRole('tooltip');

    await railLink(page, 'proxies').hover();
    await expect(tooltip).toHaveText(sectionName('proxies'));
    // A pointer that goes away: a mouse moves, it does not jump.
    await page.mouse.move(700, 400, { steps: 5 });
    await expect(tooltip).toHaveCount(0);

    await railLink(page, 'secrets').focus();
    await expect(tooltip).toHaveText(sectionName('secrets'));
  });

  test("opens a section's overview with a click, whatever was open there before", async ({
    page,
    api,
    control,
  }) => {
    const { running } = await sessionsInEveryState(api, control);

    // A session is open; the rail goes to the sessions, not back to that one.
    await page.goto(`/sessions/${running.id}`);
    await expect(heading(page, running.name)).toBeVisible();
    await railLink(page, 'proxies').click();
    await expectAt(page, {
      path: /\/proxies$/,
      heading: t('proxies.title'),
      section: 'proxies',
    });
    await railLink(page, 'sessions').click();
    await expectAt(page, {
      path: /\/sessions$/,
      heading: t('sessions.panel.title'),
      section: 'sessions',
    });
    await expect(
      page.getByRole('heading', { level: 2, name: t('sessions.index.title') }),
    ).toBeVisible();
    await expect(
      sessionsPanel(page).locator('a[aria-current="page"]'),
    ).toHaveCount(0);

    // Settings opens on its first page, whichever page was open last.
    await page.goto('/settings/ai-access');
    await railLink(page, 'sessions').click();
    await railLink(page, 'settings').click();
    await expectAt(page, {
      path: /\/settings\/general$/,
      heading: t('settings.pages.general.title'),
      section: 'settings',
    });
    // Clicking the section one is in goes to its first page as well.
    await settingsPanel(page)
      .getByRole('link', { name: t('settings.pages.appearance.title') })
      .click();
    await expect(page).toHaveURL(/\/settings\/appearance$/);
    await railLink(page, 'settings').click();
    await expect(page).toHaveURL(/\/settings\/general$/);
  });

  test('keeps nothing a person typed in one section when they come back to it', async ({
    page,
    api,
    control,
  }) => {
    await sessionsInEveryState(api, control);
    await proxiesWorkingAndNot(api, control);
    await page.goto('/proxies');
    const search = page.getByRole('textbox', {
      name: t('proxies.search.placeholder'),
    });
    // The field is read-only until it is clicked (it keeps password managers out).
    await search.click();
    await search.fill('203.0.113.90');
    await expect(search).toHaveValue('203.0.113.90');

    await railLink(page, 'sessions').click();
    await expect(heading(page, t('sessions.panel.title'))).toBeVisible();
    await railLink(page, 'proxies').click();
    await expect(heading(page, t('proxies.title'))).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: t('proxies.search.placeholder') }),
    ).toHaveValue('');
  });
});

test.describe('Addresses', () => {
  test('the root address leads to the sessions and leaves no dead entry in the history', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/sessions$/);
    await railLink(page, 'proxies').click();
    await expect(page).toHaveURL(/\/proxies$/);

    await page.goBack();
    // Back from the proxies is the sessions, not "/" bouncing forward again.
    await expect(page).toHaveURL(/\/sessions$/);
    await expect(heading(page, t('sessions.panel.title'))).toBeVisible();
  });

  test('every section has an address that opens it, and a reload keeps the page', async ({
    page,
  }) => {
    for (const [path, name, section] of [
      ['/sessions', t('sessions.panel.title'), 'sessions'],
      ['/proxies', t('proxies.title'), 'proxies'],
      ['/secrets', sectionName('secrets'), 'secrets'],
      ['/settings/general', t('settings.pages.general.title'), 'settings'],
      [
        '/settings/appearance',
        t('settings.pages.appearance.title'),
        'settings',
      ],
      ['/settings/ai-access', t('settings.pages.aiAccess.title'), 'settings'],
    ] as const) {
      await page.goto(path);
      await expectAt(page, {
        path: new RegExp(`${literally(path).source}$`),
        heading: name,
        section,
      });
      await page.reload();
      await expectAt(page, {
        path: new RegExp(`${literally(path).source}$`),
        heading: name,
        section,
      });
    }
  });

  test('a settings page opens with its row marked in the panel', async ({
    page,
  }) => {
    await page.goto('/settings/ai-access');
    const rows = settingsPanel(page).getByRole('link');
    await expect(rows).toHaveCount(3);
    await expect(
      settingsPanel(page).getByRole('link', {
        name: t('settings.pages.aiAccess.title'),
      }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      settingsPanel(page).locator('a[aria-current="page"]'),
    ).toHaveCount(1);
  });

  test('"/settings" opens the first page on a computer, without a dead entry', async ({
    page,
  }) => {
    await page.goto('/sessions');
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings\/general$/);
    await page.goBack();
    // Back from there is where the person came from, not the bare "/settings".
    await expect(page).toHaveURL(/\/sessions$/);
  });

  test('a session has an address that opens it, with its row marked in the panel', async ({
    page,
    api,
    control,
  }) => {
    const { running, stopped, failed } = await sessionsInEveryState(
      api,
      control,
    );

    for (const session of [running, stopped, failed]) {
      await page.goto(`/sessions/${session.id}`);
      await expectAt(page, {
        path: new RegExp(`/sessions/${session.id}$`),
        heading: session.name,
        section: 'sessions',
      });
      const open = sessionsPanel(page).locator('a[aria-current="page"]');
      await expect(open).toHaveCount(1);
      await expect(open).toHaveAttribute('href', `/sessions/${session.id}`);
    }
  });

  test('an address that names no session says so and leads back', async ({
    page,
  }) => {
    for (const path of ['/sessions/999999', '/sessions/abc']) {
      await page.goto(path);
      await expect(
        page.getByRole('heading', { level: 2, name: t('viewer.gone.title') }),
        path,
      ).toBeVisible();
      await expect(heading(page, t('viewer.title'))).toBeVisible();
      await expectCurrentSection(page, 'sessions');

      await page.getByRole('link', { name: t('viewer.gone.back') }).click();
      await expect(page).toHaveURL(/\/sessions$/);
    }
  });
});

test.describe('History', () => {
  test('the back and forward buttons walk across the sections and the settings pages', async ({
    page,
  }) => {
    const steps: Array<{
      path: RegExp;
      heading: string;
      section: Section;
      go: (page: Page) => Promise<void>;
    }> = [
      {
        path: /\/sessions$/,
        heading: t('sessions.panel.title'),
        section: 'sessions',
        go: (p) => p.goto('/sessions').then(() => undefined),
      },
      {
        path: /\/proxies$/,
        heading: t('proxies.title'),
        section: 'proxies',
        go: (p) => railLink(p, 'proxies').click(),
      },
      {
        path: /\/secrets$/,
        heading: sectionName('secrets'),
        section: 'secrets',
        go: (p) => railLink(p, 'secrets').click(),
      },
      {
        path: /\/settings\/general$/,
        heading: t('settings.pages.general.title'),
        section: 'settings',
        go: (p) => railLink(p, 'settings').click(),
      },
      {
        path: /\/settings\/appearance$/,
        heading: t('settings.pages.appearance.title'),
        section: 'settings',
        go: (p) =>
          settingsPanel(p)
            .getByRole('link', { name: t('settings.pages.appearance.title') })
            .click(),
      },
      {
        path: /\/settings\/ai-access$/,
        heading: t('settings.pages.aiAccess.title'),
        section: 'settings',
        go: (p) =>
          settingsPanel(p)
            .getByRole('link', { name: t('settings.pages.aiAccess.title') })
            .click(),
      },
    ];

    for (const step of steps) {
      await step.go(page);
      await expectAt(page, step);
    }
    // Back to the beginning...
    for (const step of [...steps].reverse().slice(1)) {
      await page.goBack();
      await expectAt(page, step);
      await expectPillOnCurrentSection(page);
    }
    // ...and forward to the end again.
    for (const step of steps.slice(1)) {
      await page.goForward();
      await expectAt(page, step);
      await expectPillOnCurrentSection(page);
    }
  });

  test("back from a session's page returns to the list with nothing open", async ({
    page,
    api,
    control,
  }) => {
    const { running } = await sessionsInEveryState(api, control);
    await page.goto('/sessions');
    await sessionsPanel(page)
      .getByRole('link', { name: new RegExp(running.name) })
      .click();
    await expect(heading(page, running.name)).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/sessions$/);
    await expect(
      page.getByRole('heading', { level: 2, name: t('sessions.index.title') }),
    ).toBeVisible();
    await expect(
      sessionsPanel(page).locator('a[aria-current="page"]'),
    ).toHaveCount(0);

    await page.goForward();
    await expect(heading(page, running.name)).toBeVisible();
    await expect(
      sessionsPanel(page).locator('a[aria-current="page"]'),
    ).toHaveCount(1);
  });
});

// =============================================================================
// The panels beside the page
// =============================================================================

test.describe('The panel of Sessions', () => {
  test('lists the sessions with their state, marks the open one and glides its highlight to it', async ({
    page,
    api,
    control,
  }) => {
    const { running, stopped, failed } = await sessionsInEveryState(
      api,
      control,
    );
    await page.goto('/sessions');
    const panel = sessionsPanel(page);
    const list = page.getByRole('region', { name: t('sessions.list.label') });

    await expect(
      panel.getByRole('heading', { level: 2, name: t('sessions.panel.title') }),
    ).toBeVisible();
    await expect(
      panel.getByRole('button', { name: t('sessions.panel.add') }),
    ).toBeEnabled();
    await expect(
      panel.getByRole('button', { name: t('sessions.panel.more') }),
    ).toBeEnabled();

    // Newest first, each with its state in words.
    const rows = list.getByRole('listitem');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText(failed.name);
    await expect(rows.nth(0)).toContainText(t('sessions.status.error'));
    await expect(rows.nth(1)).toContainText(stopped.name);
    await expect(rows.nth(1)).toContainText(t('sessions.status.stopped'));
    await expect(rows.nth(2)).toContainText(running.name);
    await expect(rows.nth(2)).toContainText(t('sessions.status.running'));
    await expect(list).toContainText(plural(t('sessions.list.total'), 3));

    // Nothing is open: no row is marked, and the highlight is not drawn.
    await expect(list.locator('a[aria-current="page"]')).toHaveCount(0);

    // Choosing a row opens it, marks it, and the highlight goes to it.
    for (const session of [stopped, running, failed]) {
      await list
        .getByRole('link', { name: new RegExp(`\\b${session.name}\\b`) })
        .click();
      await expect(page).toHaveURL(new RegExp(`/sessions/${session.id}$`));
      await expect(heading(page, session.name)).toBeVisible();
      const current = list.locator('a[aria-current="page"]');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveAttribute('href', `/sessions/${session.id}`);
      await expect
        .poll(() =>
          pillState(list.locator(':scope > span[aria-hidden="true"]'), current),
        )
        .toEqual(AT_REST);
    }
  });

  test("keeps its place beside every session's page and offers what a session needs", async ({
    page,
    api,
    control,
  }) => {
    const { running } = await sessionsInEveryState(api, control);
    await page.goto(`/sessions/${running.id}`);

    // The panel is still there, and its menu opens on the export.
    await sessionsPanel(page)
      .getByRole('button', { name: t('sessions.panel.more') })
      .click();
    await expect(
      page.getByRole('menuitem', {
        name: new RegExp(literally(t('sessions.panel.export')).source),
      }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    // Adding a session opens it.
    await api.addProxies(1);
    await sessionsPanel(page)
      .getByRole('button', { name: t('sessions.panel.add') })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('sessions.add.submit') })
      .click();
    await expect(page).toHaveURL(/\/sessions\/\d+$/);
    await expect(page).not.toHaveURL(new RegExp(`/sessions/${running.id}$`));
  });
});

test.describe('The panel of Settings', () => {
  test('lists the three pages, marks the open one, and the header names it', async ({
    page,
  }) => {
    await page.goto('/settings/general');
    const panel = settingsPanel(page);
    await expect(
      panel.getByRole('heading', { level: 2, name: sectionName('settings') }),
    ).toBeVisible();

    const pages = [
      ['general', '/settings/general'],
      ['appearance', '/settings/appearance'],
      ['aiAccess', '/settings/ai-access'],
    ] as const;
    for (const [key, path] of pages) {
      const name = t(`settings.pages.${key}.title`);
      await panel.getByRole('link', { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${literally(path).source}$`));
      // The header names the page, the panel marks its row, the section stays current.
      await expect(heading(page, name)).toBeVisible();
      await expect(panel.locator('a[aria-current="page"]')).toHaveText(name);
      await expectCurrentSection(page, 'settings');
      await expect
        .poll(() =>
          pillState(
            panel.locator('span[aria-hidden="true"]'),
            panel.locator('a[aria-current="page"]'),
          ),
        )
        .toEqual(AT_REST);
    }
  });

  test('has no way back on a computer: the panel is the way', async ({
    page,
  }) => {
    await page.goto('/settings/appearance');
    await expect(
      page.getByRole('button', { name: t('common.aria.back'), exact: true }),
    ).toBeHidden();
  });
});

// =============================================================================
// The phone
// =============================================================================

test.describe('The phone layout', () => {
  test.use({ viewport: PHONE, hasTouch: true });

  test('has a tab bar of the four sections instead of the rail', async ({
    page,
  }) => {
    await page.goto('/sessions');
    await expect(tabBar(page)).toBeVisible();
    await expect(rail(page)).toBeHidden();
    await expect(sessionsPanel(page)).toHaveCount(0);

    await expect(tabBar(page).getByRole('button')).toHaveCount(4);
    for (const [index, section] of SECTIONS.entries()) {
      await expect(
        tabBar(page).getByRole('button').nth(index),
      ).toHaveAccessibleName(sectionName(section));
    }
    // The bar sits at the foot of the window.
    const bar = await tabBar(page).boundingBox();
    expect((bar?.y ?? 0) + (bar?.height ?? 0)).toBeGreaterThan(
      PHONE.height - 30,
    );
  });

  // The tab bar and the rail's navigation go by one name in German and in
  // French ("Hauptnavigation", "Navigation principale", as the platform's
  // does): only one of them is ever in the accessibility tree, the other is
  // not displayed, so a person's screen reader finds one navigation of that
  // name whatever the width of the window.
  for (const language of ['de', 'fr'] as const) {
    test.describe(`in ${languageName(language)}`, () => {
      test.use({ locale: language });

      test(`names the tab bar and its tabs in ${languageName(language)}, and the rail's navigation once the window is wide`, async ({
        page,
      }) => {
        const words = tIn[language];
        await page.goto('/sessions');
        const named = (key: 'main' | 'primary') =>
          page.getByRole('navigation', {
            name: words(`navigation.aria.${key}`),
            exact: true,
          });

        const bar = named('primary');
        await expect(bar).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
        await expect(bar).toHaveCount(1);
        for (const [index, section] of SECTIONS.entries()) {
          await expect(bar.getByRole('button').nth(index)).toHaveAccessibleName(
            words(`navigation.sections.${section}`),
          );
        }

        // Wide: the rail's navigation takes the name, and the bar is gone.
        await page.setViewportSize(viewportAt(MD_BREAKPOINT));
        await expect(named('main').getByRole('link')).toHaveCount(
          SECTIONS.length,
        );
        await expect(named('main')).toHaveCount(1);
        await expect(bar.getByRole('button')).toHaveCount(0);
      });
    });
  }

  test("marks the current tab, moves its pill, and a tab opens its section's first page", async ({
    page,
  }) => {
    await page.goto('/sessions');
    for (const section of ['proxies', 'secrets', 'sessions'] as const) {
      await tabOf(page, section).tap();
      await expectCurrentSection(page, section);
      await expect
        .poll(() =>
          pillState(
            tabBar(page).locator('span[aria-hidden="true"]'),
            tabBar(page).locator('button[aria-current="page"]'),
          ),
        )
        .toEqual(AT_REST);
    }

    // Settings, on a phone, is the list of its pages.
    await tabOf(page, 'settings').tap();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(heading(page, sectionName('settings'))).toBeVisible();
    await expectCurrentSection(page, 'settings');
  });

  test('goes from the list of sessions to a session and back', async ({
    page,
    api,
    control,
  }) => {
    const { running } = await sessionsInEveryState(api, control);
    await page.goto('/sessions');

    // The list is the page, with the actions of the panel in its header.
    await expect(heading(page, t('sessions.panel.title'))).toBeVisible();
    const list = page.getByRole('region', { name: t('sessions.list.label') });
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await expect(
      page.getByRole('button', { name: t('sessions.panel.add') }),
    ).toBeVisible();

    await list
      .getByRole('link', { name: new RegExp(`\\b${running.name}\\b`) })
      .tap();
    await expect(page).toHaveURL(new RegExp(`/sessions/${running.id}$`));
    await expect(heading(page, running.name)).toBeVisible();
    // The list is gone; the way back is the header's.
    await expect(list).toHaveCount(0);
    await expectCurrentSection(page, 'sessions');
    await page
      .getByRole('link', { name: t('common.aria.back'), exact: true })
      .tap();
    await expect(page).toHaveURL(/\/sessions$/);
    await expect(heading(page, t('sessions.panel.title'))).toBeVisible();

    // The browser's back button does the same.
    await list
      .getByRole('link', { name: new RegExp(`\\b${running.name}\\b`) })
      .tap();
    await expect(heading(page, running.name)).toBeVisible();
    await page.goBack();
    await expect(heading(page, t('sessions.panel.title'))).toBeVisible();
  });

  test('goes from the list of settings pages to a page and back, by the Back button', async ({
    page,
  }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings$/);
    await expect(heading(page, sectionName('settings'))).toBeVisible();

    // The list: a row for each page, with what it holds.
    const list = page.getByRole('navigation', {
      name: sectionName('settings'),
      exact: true,
    });
    for (const key of ['general', 'appearance', 'aiAccess'] as const) {
      await expect(
        list.getByRole('link', {
          name: new RegExp(literally(t(`settings.pages.${key}.title`)).source),
        }),
      ).toContainText(t(`settings.pages.${key}.summary`));
    }
    await expect(settingsPanel(page)).toBeHidden();

    await list
      .getByRole('link', {
        name: new RegExp(
          `^${literally(t('settings.pages.appearance.title')).source}`,
        ),
      })
      .tap();
    await expect(page).toHaveURL(/\/settings\/appearance$/);
    await expect(
      heading(page, t('settings.pages.appearance.title')),
    ).toBeVisible();

    // Back goes to the list, whatever the history holds.
    await page.goto('/settings/ai-access');
    const back = page.getByRole('button', {
      name: t('common.aria.back'),
      exact: true,
    });
    await expect(back).toBeVisible();
    await back.tap();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(heading(page, sectionName('settings'))).toBeVisible();
  });

  test("has the frame's own bar above the pages that put their title in it, and none above a page that brings its own header", async ({
    page,
    api,
  }) => {
    const running = await api.startSession('own-header');
    const bar = page.locator('main > header');

    for (const path of [
      '/sessions',
      '/proxies',
      '/secrets',
      '/settings',
      '/settings/appearance',
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
        timeout: TIMEOUT.FIRST_PAINT,
      });
      await expect(bar, `${path} has the bar`).toHaveCount(1);
    }
    // A session brings its own header (the way back, its name, its actions),
    // and so does the page that says there is no page: an empty row under a
    // hairline above them would only push them down.
    for (const path of [
      `/sessions/${running.id}`,
      '/sessions/999999',
      '/nowhere/at/all',
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
        timeout: TIMEOUT.FIRST_PAINT,
      });
      await expect(bar, `${path} has none`).toHaveCount(0);
    }
  });

  test('shrinks the tab bar to its icons once a long page has been scrolled down, and gives it back at the top', async ({
    page,
    api,
  }) => {
    // The page of AI access, on, is the longest there is.
    await api.updateSettings({ mcpEnabled: true });
    await page.goto('/settings/ai-access');
    await expect(heading(page, t('settings.pages.aiAccess.title'))).toBeVisible(
      { timeout: TIMEOUT.FIRST_PAINT },
    );
    const bar = tabBar(page);
    await expect(bar).not.toHaveAttribute('data-compact', /./);
    const full = await bar.boundingBox();
    if (!full) throw new Error('The tab bar is on the page');

    await page.mouse.move(PHONE.width / 2, PHONE.height / 2);
    await page.mouse.wheel(0, 600);
    await expect(bar).toHaveAttribute('data-compact', 'true');
    await expect
      .poll(async () => (await bar.boundingBox())?.height ?? full.height, {
        message: 'the bar is lower while it shows only its icons',
      })
      .toBeLessThan(full.height);

    await page.mouse.wheel(0, -2000);
    await expect(bar).not.toHaveAttribute('data-compact', /./);
    await expect
      .poll(async () => (await bar.boundingBox())?.height ?? 0)
      .toBe(full.height);
  });

  test('switches layout when the window crosses the breakpoint', async ({
    page,
  }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings$/);
    await expect(tabBar(page)).toBeVisible();

    // Wider than a phone: the rail takes over and Settings leaves its list for its first page.
    await page.setViewportSize(viewportAt(MD_BREAKPOINT));
    await expect(rail(page)).toBeVisible();
    await expect(tabBar(page)).toBeHidden();
    await expect(page).toHaveURL(/\/settings\/general$/);
    await expect(settingsPanel(page)).toBeVisible();
    await expectCurrentSection(page, 'settings');

    // Narrower again: the tab bar is back, the panel is gone, and a page has its Back button.
    await page.setViewportSize(viewportAt(MD_BREAKPOINT - 1));
    await expect(tabBar(page)).toBeVisible();
    await expect(rail(page)).toBeHidden();
    await expect(settingsPanel(page)).toBeHidden();
    await expect(
      page.getByRole('button', { name: t('common.aria.back'), exact: true }),
    ).toBeVisible();
    await expectCurrentSection(page, 'settings');
  });
});

// =============================================================================
// Nothing runs past the window sideways
// =============================================================================

/**
 * The windows the layout is held to: the widths of phones and screens, and a
 * phone held sideways (844 x 390), where the height is the scarce thing.
 */
const WINDOWS = [
  ...WIDTHS.map((width) => ({
    label: `a window of ${width} px`,
    viewport: viewportAt(width),
  })),
  { label: 'a phone held sideways', viewport: SIDEWAYS.viewport },
];

/**
 * Every page of the app, opened in a window of this `viewport`, reaches no
 * further than the window sideways. A manager with a session in each state, a
 * pool, secrets and AI access on is what the pages show; `words` are the
 * messages of the language the pages are read in.
 */
async function expectNoOverflow(
  page: Page,
  { api, control }: { api: AppApi; control: Control },
  viewport: Viewport,
  label: string,
  words: (key: string) => string = t,
): Promise<void> {
  const { running, stopped, failed } = await sessionsInEveryState(api, control);
  await proxiesWorkingAndNot(api, control);
  await secretsOfEveryKind(api, running.id);
  // The page of AI access is the longest with it on: addresses and code.
  await api.updateSettings({ mcpEnabled: true });
  await page.setViewportSize(viewport);

  const pages: Array<{ path: string; name: string }> = [
    { path: '/sessions', name: words('sessions.panel.title') },
    { path: `/sessions/${running.id}`, name: running.name },
    { path: `/sessions/${stopped.id}`, name: stopped.name },
    { path: `/sessions/${failed.id}`, name: failed.name },
    { path: '/proxies', name: words('proxies.title') },
    { path: '/secrets', name: words('navigation.sections.secrets') },
    { path: '/settings/general', name: words('settings.pages.general.title') },
    {
      path: '/settings/appearance',
      name: words('settings.pages.appearance.title'),
    },
    {
      path: '/settings/ai-access',
      name: words('settings.pages.aiAccess.title'),
    },
  ];
  if (viewport.width < MD_BREAKPOINT) {
    pages.push({
      path: '/settings',
      name: words('navigation.sections.settings'),
    });
  }

  for (const { path, name } of pages) {
    await page.goto(path);
    await expect(heading(page, name), `${path} in ${label}`).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
    // Let a table find its size.
    await page.evaluate(() => document.fonts.ready);
    const overflow = await horizontalOverflow(page);
    expect(overflow, `${path} in ${label}`).toEqual({
      document: 0,
      body: 0,
      main: 0,
      sticking: [],
    });
  }
}

test.describe('Horizontal overflow', () => {
  for (const { label, viewport } of WINDOWS) {
    test(`no page is wider than ${label}`, async ({ page, api, control }) => {
      await expectNoOverflow(page, { api, control }, viewport, label);
    });
  }

  // The words of German and French run longer than English: the narrowest
  // window, and the one that is only 390 px high, are where that shows.
  for (const language of ['de', 'fr'] as const) {
    test.describe(`in ${languageName(language)}`, () => {
      test.use({ locale: language });

      for (const { label, viewport } of [
        { label: 'a window of 320 px', viewport: viewportAt(320) },
        { label: 'a phone held sideways', viewport: SIDEWAYS.viewport },
      ]) {
        test(`no page is wider than ${label}`, async ({
          page,
          api,
          control,
        }) => {
          await expectNoOverflow(
            page,
            { api, control },
            viewport,
            label,
            tIn[language],
          );
        });
      }
    });
  }

  test('the check sees a page that is too wide', async ({ page }) => {
    await page.goto('/sessions');
    await expect(heading(page, t('sessions.panel.title'))).toBeVisible();
    expect((await horizontalOverflow(page)).sticking).toEqual([]);

    await page.evaluate(() => {
      const wide = document.createElement('div');
      wide.textContent = 'too wide';
      wide.style.cssText = 'width:4000px;height:20px;flex:none;';
      document.querySelector('main')?.append(wide);
    });
    const overflow = await horizontalOverflow(page);
    expect(overflow.main).toBeGreaterThan(0);
    expect(overflow.sticking.join('\n')).toContain('too wide');
  });
});

test.describe('Horizontal overflow: dialogs', () => {
  for (const { label, viewport } of [
    { label: 'the smallest window', viewport: viewportAt(320) },
    { label: 'a phone held sideways', viewport: SIDEWAYS.viewport },
  ]) {
    test(`dialogs fit ${label}`, async ({ page, api, control }) => {
      // A dialog slides in; its box is measured at rest.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize(viewport);
      const { running } = await sessionsInEveryState(api, control);
      await secretsOfEveryKind(api, running.id);

      const dialogFits = async (name: string) => {
        const dialog = page.getByRole('dialog', { name });
        await expect(dialog, name).toBeVisible();
        // It slides in whatever the motion setting says (the box is 16px lower
        // on its way): measured once it has stopped.
        await animationsDone(page);
        const box = await dialog.boundingBox();
        expect(box?.x ?? -1, name).toBeGreaterThanOrEqual(0);
        expect(box?.y ?? -1, name).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0), name).toBeLessThanOrEqual(
          viewport.width,
        );
        expect((box?.y ?? 0) + (box?.height ?? 0), name).toBeLessThanOrEqual(
          viewport.height,
        );
        expect((await horizontalOverflow(page)).sticking, name).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
      };

      await page.goto('/sessions');
      await page.getByRole('button', { name: t('sessions.panel.add') }).click();
      await dialogFits(t('sessions.add.title'));

      await page.goto('/proxies');
      await page
        .getByRole('button', { name: t('proxies.actions.add'), exact: true })
        .click();
      await page
        .getByRole('menuitem', { name: t('proxies.actions.addProxy') })
        .click();
      await dialogFits(t('proxies.add.title'));
      await page
        .getByRole('button', { name: t('proxies.actions.add'), exact: true })
        .click();
      await page
        .getByRole('menuitem', { name: t('proxies.actions.importProxies') })
        .click();
      await dialogFits(t('proxies.import.title'));

      await page.goto('/secrets');
      await page
        .getByRole('button', { name: t('secrets.actions.add'), exact: true })
        .first()
        .click();
      await dialogFits(t('secrets.form.createTitle'));
    });
  }
});

// =============================================================================
// The keyboard
// =============================================================================

const LAYOUTS_UNDER_TEST = [
  { name: 'computer', viewport: DESKTOP },
  { name: 'phone', viewport: PHONE },
] as const;

/**
 * The skip link of the page at an address: out of sight until the keyboard
 * reaches it, the first stop of the page, shown when it has the focus, and it
 * moves the focus to the content of the page. With `fromTop` the keyboard
 * starts at the top of the page, where a person who has just arrived is;
 * without it the first Tab goes wherever the browser starts it, which is the
 * top of the page too unless the page scrolled something into view while it
 * loaded (a browser starts the Tab key from the last element scrolled to).
 */
async function expectSkipLinkWorks(
  page: Page,
  path: string,
  { fromTop }: { fromTop: boolean },
): Promise<void> {
  await page.goto(path);
  await expect(page.locator('main')).toBeVisible();
  const skip = page.getByRole('link', { name: t('navigation.skipToContent') });

  // Out of sight until the keyboard reaches it.
  const hidden = await skip.boundingBox();
  expect(hidden?.width ?? 0, path).toBeLessThanOrEqual(1);

  if (fromTop) await startFromTop(page);
  await page.keyboard.press('Tab');
  expect(await focusedStop(page), path).toMatchObject({
    role: 'link',
    name: t('navigation.skipToContent'),
  });
  const shown = await skip.boundingBox();
  expect(shown?.width ?? 0, path).toBeGreaterThan(60);
  expect(shown?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect(shown?.y ?? -1).toBeGreaterThanOrEqual(0);

  // Enter moves the focus to the page's content, and the next Tab is inside it.
  const url = page.url();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.id))
    .toBe('main-content');
  expect(page.url()).toBe(url);
  await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() => document.activeElement?.closest('main') !== null),
    `${path}: the next stop is in the page`,
  ).toBe(true);
}

test.describe('The skip link', () => {
  for (const layout of LAYOUTS_UNDER_TEST) {
    test.describe(layout.name, () => {
      test.use({ viewport: layout.viewport });

      test('is the first stop of every page, shows itself when it has the focus and moves the focus to the page', async ({
        page,
      }) => {
        for (const path of [
          '/sessions',
          '/proxies',
          '/secrets',
          '/settings/general',
          '/settings/appearance',
          '/settings/ai-access',
        ]) {
          await expectSkipLinkWorks(page, path, { fromTop: false });
        }
      });

      test('is there on the page of a session too, and works from the top of it', async ({
        page,
        api,
        control,
      }) => {
        const { stopped, failed } = await sessionsInEveryState(api, control);
        for (const path of [
          `/sessions/${stopped.id}`,
          `/sessions/${failed.id}`,
        ]) {
          await expectSkipLinkWorks(page, path, { fromTop: true });
        }
      });

      // The list of sessions reveals the open row by setting its scroller's
      // `scrollTop`, not with `scrollIntoView`, which would also have moved the
      // place the browser starts the Tab key from (the button beside that
      // row): the first press of Tab is still the skip link.
      test('is also the first stop of the page of a session that is in the list', async ({
        page,
        api,
        control,
      }) => {
        const { stopped, failed } = await sessionsInEveryState(api, control);
        for (const path of [
          `/sessions/${stopped.id}`,
          `/sessions/${failed.id}`,
        ]) {
          await expectSkipLinkWorks(page, path, { fromTop: false });
        }
      });

      // The card of a running session takes no focus of its own when it comes:
      // the starting point of the Tab key is left alone, and the first stop is
      // the skip link.
      test('is also the first stop of the page of a running session', async ({
        page,
        api,
      }) => {
        const running = await api.startSession('running');
        await page.goto(`/sessions/${running.id}`);
        await expect(
          page.getByRole('heading', {
            level: 2,
            name: t('viewer.window.title'),
          }),
        ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

        await page.keyboard.press('Tab');
        expect(await focusedStop(page)).toMatchObject({
          role: 'link',
          name: t('navigation.skipToContent'),
        });
      });
    });
  }
});

test.describe('The order of the keyboard', () => {
  for (const layout of LAYOUTS_UNDER_TEST) {
    test.describe(layout.name, () => {
      test.use({ viewport: layout.viewport });

      test('reaches every control of every page in a logical order, with no trap and a name for each', async ({
        page,
        api,
        control,
      }) => {
        const { running, stopped, failed } = await sessionsInEveryState(
          api,
          control,
        );
        await proxiesWorkingAndNot(api, control);
        await secretsOfEveryKind(api, running.id);
        const paths = [
          '/sessions',
          `/sessions/${running.id}`,
          `/sessions/${stopped.id}`,
          `/sessions/${failed.id}`,
          '/proxies',
          '/secrets',
          '/settings/general',
          '/settings/appearance',
          '/settings/ai-access',
          ...(layout.name === 'phone' ? ['/settings'] : []),
        ];
        const desktop = layout.name === 'computer';

        const walkPage = async (path: string) => {
          await page.goto(path);
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
            timeout: TIMEOUT.FIRST_PAINT,
          });
          await page.waitForLoadState('networkidle');

          const walk = await walkTabOrder(page);
          const names = walk.stops.map(describeStop);

          // The order has an end: the keyboard comes out of the page again.
          expect(
            walk.ended,
            `${path}: the order ends\n${names.join('\n')}`,
          ).toBe(true);
          // The skip link first.
          expect(walk.stops[0], path).toMatchObject({
            role: 'link',
            name: t('navigation.skipToContent'),
          });
          // Every stop is named, and none comes twice.
          expect(
            walk.stops.filter((stop) => stop.name.trim() === ''),
            `${path}: stops without a name`,
          ).toEqual([]);
          const faults = await tabWalkFaults(page);
          expect(faults.repeated, `${path}: a stop came twice`).toEqual([]);
          // Document order: the order of the page is the order of the keys.
          expect(faults.outOfOrder, `${path}: document order`).toEqual([]);
          // Nothing a keyboard should reach was left out.
          expect(
            faults.missed,
            `${path}: controls the keyboard did not reach`,
          ).toEqual([]);

          if (desktop) {
            // The rail follows the skip link, top to bottom: logo, then the sections.
            expect(
              walk.stops.slice(1, 6).map((stop) => stop.name),
              path,
            ).toEqual([APP_NAME, ...SECTIONS.map(sectionName)]);
            const ys = walk.stops.slice(2, 6).map((stop) => stop.box.y);
            expect(ys, `${path}: the rail reads top to bottom`).toEqual(
              [...ys].sort((a, b) => a - b),
            );
          } else {
            // The tab bar closes the page, left to right.
            expect(
              walk.stops.slice(-4).map((stop) => stop.name),
              path,
            ).toEqual(SECTIONS.map(sectionName));
            const xs = walk.stops.slice(-4).map((stop) => stop.box.x);
            expect(xs, `${path}: the tab bar reads left to right`).toEqual(
              [...xs].sort((a, b) => a - b),
            );
          }
        };

        for (const path of paths) {
          await test.step(path, () => walkPage(path));
        }
        // With AI access on, the page of it holds the address, the snippets and the tools.
        await api.updateSettings({ mcpEnabled: true });
        await test.step('/settings/ai-access, AI access on', () =>
          walkPage('/settings/ai-access'));
      });

      test('walks the page of a running session from its header to the card: Show window, then Secrets', async ({
        page,
        api,
      }) => {
        const running = await api.startSession('running');
        await page.goto(`/sessions/${running.id}`);
        await expect(
          page.getByRole('heading', {
            level: 2,
            name: t('viewer.window.title'),
          }),
        ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
        await page.waitForLoadState('networkidle');

        const walk = await walkTabOrder(page);
        const names = walk.stops.map((stop) => stop.name);
        expect(walk.ended, `the order ends\n${names.join('\n')}`).toBe(true);
        // The header says what the session is and stops it; the card that
        // follows leads with the window, then the secrets to type into it.
        const stop = names.indexOf(t('viewer.actions.stop'));
        const show = names.indexOf(t('viewer.window.show'));
        const secrets = names.indexOf(t('viewer.secrets.title'));
        expect(stop, names.join('\n')).toBeGreaterThan(-1);
        expect(show, names.join('\n')).toBeGreaterThan(stop);
        expect(secrets, names.join('\n')).toBe(show + 1);
      });
    });
  }
});

test.describe('Where the focus is after a change', () => {
  test('stays on the control that was used when it opens another page of the same frame', async ({
    page,
    api,
    control,
  }) => {
    const { running } = await sessionsInEveryState(api, control);
    await page.goto('/sessions');

    // The rail, by mouse and by keyboard.
    await railLink(page, 'proxies').click();
    await expect(heading(page, t('proxies.title'))).toBeVisible();
    expect(await focusedStop(page)).toMatchObject({
      name: sectionName('proxies'),
    });

    await railLink(page, 'secrets').focus();
    await page.keyboard.press('Enter');
    await expect(heading(page, sectionName('secrets'))).toBeVisible();
    expect(await focusedStop(page)).toMatchObject({
      name: sectionName('secrets'),
    });

    // A row of the sessions list and a row of the settings panel.
    await railLink(page, 'sessions').click();
    await sessionsPanel(page)
      .getByRole('link', { name: new RegExp(`\\b${running.name}\\b`) })
      .click();
    await expect(heading(page, running.name)).toBeVisible();
    expect(await focusedStop(page)).toMatchObject({ role: 'link' });

    await railLink(page, 'settings').click();
    await settingsPanel(page)
      .getByRole('link', { name: t('settings.pages.aiAccess.title') })
      .click();
    await expect(
      heading(page, t('settings.pages.aiAccess.title')),
    ).toBeVisible();
    expect(await focusedStop(page)).toMatchObject({
      name: t('settings.pages.aiAccess.title'),
    });
  });

  test('is never left on the page itself when a dialog closes or the control it came from goes', async ({
    page,
    api,
    control,
  }) => {
    const { running, stopped } = await sessionsInEveryState(api, control);
    await page.goto('/sessions');
    const list = page.getByRole('region', { name: t('sessions.list.label') });
    const add = page.getByRole('button', { name: t('sessions.panel.add') });
    const menuOf = (name: string) =>
      page.getByRole('menu', { name: fill(t('sessions.row.menu'), { name }) });

    // A dialog closed with Escape gives the focus back to what opened it.
    await add.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(add).toBeFocused();

    // A rename leaves the focus on the session's menu button.
    const row = list.getByRole('listitem').filter({ hasText: running.name });
    await row.hover();
    await row
      .getByRole('button', {
        name: fill(t('sessions.row.menu'), { name: running.name }),
      })
      .click();
    await menuOf(running.name)
      .getByRole('menuitem', { name: t('sessions.menu.rename') })
      .click();
    await page
      .getByRole('textbox', { name: t('sessions.rename.label') })
      .fill('renamed');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(menuOf(running.name)).toHaveCount(0);
    await focusRestsOnAControl(page);

    // A deleted session takes its row's controls: the focus goes on to a neighbour.
    const gone = list.getByRole('listitem').filter({ hasText: stopped.name });
    await gone.hover();
    await gone
      .getByRole('button', {
        name: fill(t('sessions.row.menu'), { name: stopped.name }),
      })
      .click();
    await menuOf(stopped.name)
      .getByRole('menuitem', { name: t('common.actions.delete') })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('sessions.delete.confirm') })
      .click();
    await expect(gone).toHaveCount(0);
    // The list hands the focus on once the dialog has closed.
    await focusRestsOnAControl(page);
    expect(await focusedStop(page)).not.toBeNull();
  });

  test('is never left on the page itself when the last session is deleted', async ({
    page,
    api,
  }) => {
    const only = await api.startSession('only');
    await page.goto(`/sessions/${only.id}`);
    await expect(heading(page, only.name)).toBeVisible();

    // The header's menu: the one after the panel's row in the page.
    await page
      .getByRole('button', {
        name: fill(t('sessions.row.menu'), { name: only.name }),
      })
      .last()
      .click();
    await page
      .getByRole('menuitem', { name: t('common.actions.delete') })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('sessions.delete.confirm') })
      .click();

    await expect(page).toHaveURL(/\/sessions$/);
    await expect(
      page.getByRole('heading', { level: 3, name: t('sessions.empty.title') }),
    ).toBeVisible();
    await focusRestsOnAControl(page);
  });

  test('a dialog takes the focus, keeps it inside while Tab goes round, and gives it back to what opened it', async ({
    page,
    api,
    control,
  }) => {
    await sessionsInEveryState(api, control);
    const inDialog = () =>
      page.evaluate(
        () => document.activeElement?.closest('[role="dialog"]') !== null,
      );

    for (const [path, opener, dialog] of [
      [
        '/sessions',
        page.getByRole('button', { name: t('sessions.panel.add') }),
        t('sessions.add.title'),
      ],
      [
        '/secrets',
        page
          .getByRole('button', { name: t('secrets.actions.add'), exact: true })
          .first(),
        t('secrets.form.createTitle'),
      ],
    ] as const) {
      await page.goto(path);
      await opener.click();
      await expect(page.getByRole('dialog', { name: dialog })).toBeVisible();
      // The focus is in the dialog at once...
      await expect.poll(inDialog, { message: `${dialog}: focus` }).toBe(true);
      // ...and stays there however long Tab goes on, either way round.
      for (let press = 1; press <= 14; press += 1) {
        await page.keyboard.press('Tab');
        expect(await inDialog(), `${dialog}: Tab ${press}`).toBe(true);
      }
      for (let press = 1; press <= 14; press += 1) {
        await page.keyboard.press('Shift+Tab');
        expect(await inDialog(), `${dialog}: Shift+Tab ${press}`).toBe(true);
      }
      // The page behind is out of reach of assistive technology while it is open.
      await expect(page.getByRole('navigation')).toHaveCount(0);

      // The tooltip of a button the keyboard has just left is the top layer
      // until it has faded out, and would take the Escape key for itself.
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(opener, `${dialog}: focus goes back`).toBeFocused();
    }
  });

  test('a menu opens from the keyboard, is walked with the arrow keys and gives the focus back when it closes', async ({
    page,
    api,
    control,
  }) => {
    const { running } = await sessionsInEveryState(api, control);
    await page.goto('/sessions');
    const label = fill(t('sessions.row.menu'), { name: running.name });
    const trigger = page.getByRole('button', { name: label });

    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: label });
    await expect(menu).toBeVisible();
    // The focus is on the menu's first item, and the arrows go down and round.
    const items = menu.getByRole('menuitem');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(4);
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(items.last()).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});

// =============================================================================
// Protection against other websites
// =============================================================================

test.describe('Host protection', () => {
  const REFUSED_HOST = {
    error: 'forbidden_host',
    message: 'Requests must address the app as 127.0.0.1 or localhost.',
  };

  test('the app opens on localhost and on 127.0.0.1', async ({
    page,
    server,
  }) => {
    for (const host of ['localhost', '127.0.0.1']) {
      const response = await page.goto(
        `http://${host}:${server.port}/sessions`,
      );
      expect(response?.status(), host).toBe(200);
      await expect(heading(page, t('sessions.panel.title')), host).toBeVisible({
        timeout: TIMEOUT.FIRST_PAINT,
      });
    }
  });

  test('a browser that opens it under any other name is refused by the server, in JSON', async ({
    playwright,
    server,
  }) => {
    // The name points at this computer, as a rebinding site's would after its
    // second answer: the server must not serve the page, whatever the browser asks.
    const browser = await playwright.chromium.launch({
      args: [
        '--host-resolver-rules=MAP rebound.example 127.0.0.1',
        '--no-proxy-server',
      ],
    });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      for (const path of ['/sessions', '/', '/api/meta', '/assets/', '/mcp']) {
        const response = await page.goto(
          `http://rebound.example:${server.port}${path}`,
        );
        expect(response?.status(), path).toBe(403);
        expect(await response?.json(), path).toEqual(REFUSED_HOST);
      }
      // No page was served, so there is no app in it.
      await expect(page.getByRole('navigation')).toHaveCount(0);
    } finally {
      await browser.close();
    }
  });

  test('every kind of request is refused with 403 forbidden_host when it names another host', async ({
    request,
    server,
  }) => {
    const foreign = [
      'evil.example',
      `evil.example:${server.port}`,
      `0.0.0.0:${server.port}`,
      // The app's own name, without the port it is served on.
      'localhost',
    ];
    for (const host of foreign) {
      for (const path of [
        '/',
        '/sessions',
        '/api/meta',
        '/api/sessions',
        '/api/settings',
        '/assets/missing.js',
        '/favicon.ico',
        '/llms.txt',
      ]) {
        const response = await request.get(path, { headers: { Host: host } });
        expect(response.status(), `GET ${path} as ${host}`).toBe(403);
        expect(await response.json(), `GET ${path} as ${host}`).toEqual(
          REFUSED_HOST,
        );
      }
      const write = await request.patch('/api/settings', {
        headers: { Host: host },
        data: { mcpEnabled: true },
      });
      expect(write.status(), `PATCH as ${host}`).toBe(403);
      expect((await write.json()).error).toBe('forbidden_host');
      const mcp = await request.post('/mcp', {
        headers: { Host: host },
        data: { jsonrpc: '2.0', id: 1, method: 'ping' },
      });
      expect(mcp.status(), `POST /mcp as ${host}`).toBe(403);
      expect((await mcp.json()).error).toBe('forbidden_host');
    }
  });

  test('the host is compared without regard to case, and the app answers on every name it knows', async ({
    request,
    server,
  }) => {
    for (const host of [
      `localhost:${server.port}`,
      `127.0.0.1:${server.port}`,
      `LOCALHOST:${server.port}`,
    ]) {
      const response = await request.get('/api/meta', {
        headers: { Host: host },
      });
      expect(response.status(), host).toBe(200);
    }
  });

  // A Host that is not even an address (here a port that is not a number)
  // leaves the shared server no URL to route: it is a protocol error, answered
  // 400 in plain text by the server itself, not the 500 of a failure and not
  // the app's JSON refusal (no route ran).
  test('a Host that is not even an address is answered "Bad Request" in plain text, with a 400', async ({
    request,
    server,
  }) => {
    const response = await request.get('/api/meta', {
      headers: { Host: `localhost:${server.port}.evil.example` },
    });
    expect(response.status()).toBe(400);
    expect(response.headers()['content-type']).toMatch(/^text\/plain/);
    expect(await response.text()).toBe('Bad Request');
    // The refusal carries the protective headers of every other answer.
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
  });
});

test.describe('Cross-origin protection', () => {
  const FOREIGN = 'https://evil.example';

  test('a write that names another site as its origin is refused with 403 forbidden_origin, and changes nothing', async ({
    request,
    api,
    server,
  }) => {
    const origin = server.origin;
    const writes: Array<{
      method: 'PATCH' | 'POST' | 'DELETE';
      path: string;
      data?: unknown;
    }> = [
      { method: 'PATCH', path: '/api/settings', data: { mcpEnabled: true } },
      {
        method: 'PATCH',
        path: '/api/settings',
        data: { startPage: 'https://evil.example' },
      },
      {
        method: 'POST',
        path: '/api/proxies/import',
        data: { text: '203.0.113.200:8080', defaultScheme: 'http' },
      },
      {
        method: 'POST',
        path: '/api/secrets',
        data: {
          kind: 'note',
          title: 'planted',
          fields: [{ label: 'Note', value: 'x' }],
        },
      },
      {
        method: 'POST',
        path: '/api/sessions',
        data: { name: 'planted', os: 'random' },
      },
    ];

    for (const { method, path, data } of writes) {
      const refused = await request.fetch(path, {
        method,
        data,
        headers: { Origin: FOREIGN },
      });
      expect(refused.status(), `${method} ${path}`).toBe(403);
      expect(await refused.json(), `${method} ${path}`).toEqual({
        error: 'forbidden_origin',
        message: 'Cross-site requests are not allowed.',
      });
    }
    const settings = await api.settings();
    expect(settings.mcpEnabled).toBe(false);
    expect(settings.startPage).toBe(settings.defaultStartPage);
    expect(await api.proxies()).toEqual([]);
    expect(await api.secrets()).toEqual([]);
    expect(await api.sessions()).toEqual([]);

    // The same writes, from the app's own origin, are made.
    const own = await request.patch('/api/settings', {
      headers: { Origin: origin },
      data: { startPage: 'https://own.example' },
    });
    expect(own.status()).toBe(200);
    expect((await api.settings()).startPage).toBe('https://own.example');
  });

  test("another site cannot reach the assistants' door either: /mcp refuses it while AI access is on", async ({
    request,
    api,
    server,
  }) => {
    await api.updateSettings({ mcpEnabled: true });
    const mcp = new McpClient(request);
    await mcp.initialize();

    const refused = await mcp.post(
      { jsonrpc: '2.0', id: 9, method: 'tools/list' },
      { Origin: FOREIGN },
    );
    expect(refused.status()).toBe(403);
    expect((await refused.json()).error).toBe('forbidden_origin');

    // Another address of this computer is another origin, too.
    const sibling = await mcp.post(
      { jsonrpc: '2.0', id: 10, method: 'tools/list' },
      {
        Origin: `http://127.0.0.1:${server.port}`,
        Host: `localhost:${server.port}`,
      },
    );
    expect(sibling.status()).toBe(403);
  });

  test('a body that is not JSON is refused, as a form of another site could only send one', async ({
    request,
    api,
  }) => {
    for (const type of [
      'text/plain',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
    ]) {
      const refused = await request.fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': type },
        data: Buffer.from('{"mcpEnabled":true}'),
      });
      expect(refused.status(), type).toBe(403);
      expect(await refused.json(), type).toEqual({
        error: 'forbidden_origin',
        message: 'Request bodies must be sent as application/json.',
      });
    }
    expect((await api.settings()).mcpEnabled).toBe(false);
    // And one that is JSON, without an Origin (a program), is made.
    expect(
      (
        await request.patch('/api/settings', { data: { mcpEnabled: false } })
      ).status(),
    ).toBe(200);
  });

  test('a page of another website cannot write, whatever it sends', async ({
    page,
    api,
    server,
  }) => {
    const site = await serveOtherSite();
    try {
      // The attacker's page sends the app a proxy of their own.
      await page.goto(site.origin);
      const target = `${server.origin}/api/proxies/import`;
      const attack = JSON.stringify({
        text: '198.51.100.7:8080',
        defaultScheme: 'http',
      });
      const failures: string[] = [];
      page.on('requestfailed', (request) => {
        if (request.url() === target) {
          failures.push(request.failure()?.errorText ?? '');
        }
      });
      const send = (type: string) =>
        page.evaluate(
          async ([url, body, contentType]) => {
            try {
              await fetch(url, {
                method: 'POST',
                mode: contentType === 'text/plain' ? 'no-cors' : 'cors',
                headers: { 'Content-Type': contentType },
                body,
              });
              return 'answered';
            } catch {
              return 'failed';
            }
          },
          [target, attack, type],
        );

      // A POST with a text/plain body is a "simple" request: the browser sends
      // it without asking first. The app refuses it for its origin; the browser
      // then keeps the answer from the page (the app's Cross-Origin-Resource-
      // Policy), which is what `BLOCKED_BY_RESPONSE` says: the request was
      // sent and answered, and nothing was done.
      expect(await send('text/plain')).toBe('failed');
      expect(failures).toEqual([
        expect.stringContaining('BLOCKED_BY_RESPONSE'),
      ]);
      expect(await api.proxies()).toEqual([]);

      // With a JSON body the browser asks first (a preflight); the app grants
      // nothing, so the write itself is never sent.
      failures.length = 0;
      expect(await send('application/json')).toBe('failed');
      expect(failures).not.toEqual([
        expect.stringContaining('BLOCKED_BY_RESPONSE'),
      ]);
      expect(await api.proxies()).toEqual([]);

      // The same write from the app's own page is made: the refusals above
      // were about the origin, not about the request.
      await page.goto(`${server.origin}/settings/general`);
      const own = await page.evaluate(
        async ([url, body]) => {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          });
          return response.status;
        },
        [target, attack],
      );
      expect(own).toBe(200);
      expect(await api.proxies()).toHaveLength(1);
    } finally {
      await site.close();
    }
  });

  test('a page of another website cannot switch AI access on', async ({
    page,
    api,
    server,
  }) => {
    const site = await serveOtherSite();
    try {
      await page.goto(site.origin);
      const target = `${server.origin}/api/settings`;
      const answered: number[] = [];
      page.on('response', (response) => {
        if (response.url() === target) answered.push(response.status());
      });
      // AI access is switched with a PATCH, which a page of another origin
      // cannot send without the app's leave; it is never granted.
      const outcome = await page.evaluate(async (url) => {
        try {
          const response = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mcpEnabled: true }),
          });
          return `answered ${response.status}`;
        } catch {
          return 'blocked by the browser';
        }
      }, target);
      expect(outcome).toBe('blocked by the browser');
      // Nothing answered it, or whatever did refused (never a 200).
      expect(answered.filter((status) => status !== 403)).toEqual([]);
      expect((await api.settings()).mcpEnabled).toBe(false);
    } finally {
      await site.close();
    }
  });

  // Typing into a session's window is the one write that reaches the person's
  // own browser: a value planted in a field they clicked. Another site is
  // turned away from it, and from bringing the window to the front, both by
  // what it names as its origin and by what the browser says of it.
  test("another site cannot type into a session's window, nor bring the window to the front", async ({
    request,
    api,
    control,
    server,
  }) => {
    const session = await api.startSession('typed-into');
    const before = await control.browser(session.name);
    const writes = [
      { path: `/api/sessions/${session.id}/type`, data: { text: 'planted' } },
      { path: `/api/sessions/${session.id}/show`, data: undefined },
    ];
    const foreign: Record<string, string>[] = [
      { Origin: FOREIGN },
      { 'Sec-Fetch-Site': 'cross-site' },
    ];
    for (const headers of foreign) {
      for (const { path, data } of writes) {
        const refused = await request.post(path, { data, headers });
        const what = `POST ${path} with ${JSON.stringify(headers)}`;
        expect(refused.status(), what).toBe(403);
        expect((await refused.json()).error, what).toBe('forbidden_origin');
      }
    }
    const after = await control.browser(session.name);
    expect(typedTexts(after)).toEqual([]);
    expect(timesShown(after)).toBe(timesShown(before));

    // The same writes from the app's own origin are made.
    for (const { path, data } of writes) {
      const made = await request.post(path, {
        data,
        headers: { Origin: server.origin },
      });
      expect(made.status(), path).toBe(204);
    }
  });

  test('the endpoint shows the same refusal whether or not AI access is on for a foreign site', async ({
    request,
    api,
  }) => {
    // Off: the answer is the switch's (403 ai_access_off), for a program.
    const off = await request.post('/mcp', {
      data: { jsonrpc: '2.0', id: 1, method: 'ping' },
    });
    expect(off.status()).toBe(403);
    expect(await off.json()).toEqual(AI_ACCESS_OFF);
    // A foreign site is turned away before the switch is even asked.
    const foreign = await request.post('/mcp', {
      headers: { Origin: FOREIGN },
      data: { jsonrpc: '2.0', id: 1, method: 'ping' },
    });
    expect(foreign.status()).toBe(403);
    expect((await foreign.json()).error).toBe('forbidden_origin');
    expect((await api.settings()).mcpEnabled).toBe(false);
  });

  // A browser says who started a request (`Sec-Fetch-Site`) and a page cannot
  // change it, so the data of the app is only for the page itself and for the
  // person (the address bar, a bookmark); a program says nothing and is not
  // asked. A request can be fetched by a page that may not read the answer.
  test('a request a browser marks as started by another site is refused for the data of the app, whatever the method', async ({
    request,
    api,
  }) => {
    const writes = [
      { method: 'PATCH', path: '/api/settings', data: { mcpEnabled: true } },
      { method: 'POST', path: '/api/proxies/check-all', data: {} },
      { method: 'DELETE', path: '/api/sessions/1', data: undefined },
    ] as const;
    // Another site, another origin of this computer, and a value no browser
    // sends: none of them is the page itself or the person.
    for (const site of ['cross-site', 'same-site', 'bogus']) {
      const headers = { 'Sec-Fetch-Site': site };
      for (const path of [
        '/api/meta',
        '/api/settings',
        '/api/sessions',
        '/api/sessions/export-proxies',
        '/api/secrets',
        '/api/nowhere',
      ]) {
        const refused = await request.get(path, { headers });
        expect(refused.status(), `GET ${path} (${site})`).toBe(403);
        expect(await refused.json(), `GET ${path} (${site})`).toEqual({
          error: 'forbidden_origin',
          message: 'Cross-site requests are not allowed.',
        });
      }
      for (const { method, path, data } of writes) {
        const refused = await request.fetch(path, { method, headers, data });
        expect(refused.status(), `${method} ${path} (${site})`).toBe(403);
        expect((await refused.json()).error).toBe('forbidden_origin');
      }
      const mcp = await request.post('/mcp', {
        headers,
        data: { jsonrpc: '2.0', id: 1, method: 'ping' },
      });
      expect(mcp.status(), `POST /mcp (${site})`).toBe(403);
      expect((await mcp.json()).error).toBe('forbidden_origin');
    }
    expect((await api.settings()).mcpEnabled).toBe(false);
  });

  test('lets the page itself and the person through, and a program that says nothing', async ({
    request,
  }) => {
    for (const site of ['same-origin', 'none', 'SAME-ORIGIN', undefined]) {
      const response = await request.get('/api/meta', {
        headers: site === undefined ? {} : { 'Sec-Fetch-Site': site },
      });
      expect(response.status(), String(site)).toBe(200);
    }
  });

  test('opens the files of the page to a link from another site, which is only a page', async ({
    request,
  }) => {
    for (const path of [
      '/',
      '/sessions',
      '/settings/general',
      '/favicon.ico',
    ]) {
      const response = await request.get(path, {
        headers: {
          'Sec-Fetch-Site': 'cross-site',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Dest': 'document',
        },
      });
      expect(response.status(), path).toBe(200);
    }
  });

  test('a page of another website cannot send the browser to download the proxy passwords, a page of the app can', async ({
    page,
    api,
    server,
  }) => {
    // The file is of the proxies of the sessions: with none there is nothing to save.
    await api.startSession('has-a-proxy');
    const target = `${server.origin}/api/sessions/export-proxies`;
    const downloads: string[] = [];
    page.on('download', (download) => downloads.push(download.url()));
    const site = await serveOtherSite();
    try {
      // The other site's page sends the browser to the export. The browser
      // says "cross-site", and the app answers that instead of the file.
      await page.goto(site.origin);
      const answered = page.waitForResponse(target);
      await page.evaluate((url) => {
        window.location.href = url;
      }, target);
      const refusal = await answered;
      expect(refusal.status()).toBe(403);
      expect(await refusal.json()).toMatchObject({ error: 'forbidden_origin' });
      expect(downloads).toEqual([]);
    } finally {
      await site.close();
    }

    // The same navigation from the app's own page is the person's: the file is saved.
    await page.goto(`${server.origin}/settings/general`);
    const saved = page.waitForEvent('download');
    await page.evaluate((url) => {
      window.location.href = url;
    }, target);
    expect((await saved).suggestedFilename()).toBe('proxy.json');
  });
});

test.describe('Request size', () => {
  // The most a person sends is a list of proxies or a secret with all its
  // values: a few hundred kilobytes. A body over a mebibyte is refused as soon
  // as it is known to be that long, before anything of it is read.
  const MEBIBYTE = 1024 * 1024;

  test('a body over one mebibyte is refused with 413, and changes nothing', async ({
    request,
    api,
  }) => {
    const before = await api.settings();

    const refused = await request.patch('/api/settings', {
      data: { startPage: 'x'.repeat(MEBIBYTE) },
    });

    expect(refused.status()).toBe(413);
    expect(await refused.json()).toMatchObject({ error: 'validation_error' });
    expect(await api.settings()).toEqual(before);
  });

  test("a body over one mebibyte is refused at the assistants' door too", async ({
    request,
    api,
  }) => {
    await api.updateSettings({ mcpEnabled: true });

    const refused = await new McpClient(request).post({
      jsonrpc: '2.0',
      id: 1,
      method: 'ping',
      params: { padding: 'x'.repeat(MEBIBYTE) },
    });

    expect(refused.status()).toBe(413);
  });
});

// =============================================================================
// What the frame says when the server is not at hand
// =============================================================================

test.describe('Banners and refusals', () => {
  const meta = async (
    page: Page,
    change: Record<string, unknown>,
  ): Promise<void> => {
    await page.route('**/api/meta', async (route) => {
      const response = await route.fetch();
      const body: unknown = await response.json();
      await route.fulfill({
        response,
        json: {
          ...(typeof body === 'object' && body !== null ? body : {}),
          ...change,
        },
      });
    });
  };

  test('says the connection is lost while the server cannot be reached, renames the tab for it, and stops when it can', async ({
    page,
  }) => {
    await page.route('**/api/meta', (route) => route.abort());
    await page.goto('/sessions');
    // Not at the first failure: the poll is tried once more after a grace, and
    // only a second failure is told.
    const banner = page.getByText(t('banners.connection.lost'));
    await expect(banner).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    await expect(page.getByText(t('banners.connection.failed'))).toHaveCount(0);
    // A window chooser shows which tab has dropped.
    await expect(page).toHaveTitle(tabTitle(t('banners.connection.tabTitle')));
    // The strip is words only: the app tries again by itself, so there is
    // nothing to press.
    const strip = page
      .getByRole('alert')
      .filter({ hasText: t('banners.connection.lost') });
    await expect(strip.getByRole('button')).toHaveCount(0);
    await expect(strip.getByRole('link')).toHaveCount(0);

    await page.unroute('**/api/meta');
    // The page reads again as soon as the window is in front again.
    await page.evaluate(() =>
      window.dispatchEvent(new Event('visibilitychange')),
    );
    await expect(banner).toHaveCount(0);
    await expect(page).toHaveTitle(tabTitle(t('navigation.sections.sessions')));
  });

  test('tells nothing while the poll that failed is being tried again, and tells once that try fails too', async ({
    page,
  }) => {
    // The first poll fails; the second, which the page makes after its grace,
    // is held until the test lets it fail as well.
    let polls = 0;
    let retryMade: () => void = () => undefined;
    const retry = new Promise<void>((resolve) => {
      retryMade = resolve;
    });
    let decide: () => void = () => undefined;
    const decided = new Promise<void>((resolve) => {
      decide = resolve;
    });
    await page.route('**/api/meta', async (route) => {
      polls += 1;
      if (polls > 1) {
        retryMade();
        await decided;
      }
      await route.abort();
    });
    const banner = page.getByText(t('banners.connection.lost'));

    await page.goto('/sessions');
    await retry;
    // One poll has failed and its second try is on its way: not a word yet.
    await expect(banner).toHaveCount(0);
    await expect(page).toHaveTitle(tabTitle(t('navigation.sections.sessions')));

    decide();
    await expect(banner).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(page).toHaveTitle(tabTitle(t('banners.connection.tabTitle')));
  });

  test('stand above the rail and the page, in a strip across the whole window, and are no part of the page', async ({
    page,
  }) => {
    await meta(page, {
      browserInstalled: false,
      browserInstalling: false,
      browserInstallError: 'ENOSPC: no space left on device',
    });
    await page.goto('/sessions');
    const strip = page
      .getByRole('alert')
      .filter({ hasText: t('banners.browser.installFailed') });
    await expect(strip).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    await expect(
      page.getByRole('main').getByText(t('banners.browser.installFailed')),
    ).toHaveCount(0);

    // Before the rail in the document, so that it is read first...
    expect(
      await strip.evaluate((element) => {
        const sidebar = document.querySelector('aside');
        return (
          sidebar !== null &&
          (element.compareDocumentPosition(sidebar) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
            0
        );
      }),
      'the strip comes before the rail',
    ).toBe(true);
    // ...and above it on the screen: across the window, with the rail and the
    // page under it, level with each other.
    const [above, side, content] = await Promise.all([
      strip.boundingBox(),
      rail(page).boundingBox(),
      page.getByRole('main').boundingBox(),
    ]);
    if (!above || !side || !content)
      throw new Error('The frame is on the page');
    expect(above.x).toBe(0);
    expect(above.y).toBe(0);
    expect(above.width).toBe(page.viewportSize()?.width);
    expect(side.y).toBeCloseTo(above.y + above.height, 0);
    expect(content.y).toBeCloseTo(side.y, 0);
  });

  test('does not tell of a poll that failed once and was answered when it was tried again', async ({
    page,
  }) => {
    let polls = 0;
    let answered = 0;
    page.on('response', (response) => {
      if (new URL(response.url()).pathname === '/api/meta' && response.ok()) {
        answered += 1;
      }
    });
    await page.route('**/api/meta', (route) => {
      polls += 1;
      return polls === 1 ? route.abort() : route.continue();
    });
    await page.goto('/sessions');

    // The second poll, after the grace, is answered: the trouble ends untold.
    await expect
      .poll(() => answered, { timeout: TIMEOUT.FIRST_PAINT })
      .toBeGreaterThanOrEqual(1);
    expect(polls).toBeGreaterThanOrEqual(2);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await expect(page.getByText(t('banners.connection.lost'))).toHaveCount(0);
    await expect(page.getByText(t('banners.connection.failed'))).toHaveCount(0);
    await expect(page).toHaveTitle(tabTitle(t('navigation.sections.sessions')));
  });

  test('says the server answered with an error when it did, in other words than for one that cannot be reached', async ({
    page,
  }) => {
    await page.route('**/api/meta', (route) =>
      route.fulfill({
        status: 500,
        json: { error: 'internal_error', message: 'Something went wrong.' },
      }),
    );
    await page.goto('/sessions');
    await expect(page.getByText(t('banners.connection.failed'))).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
    await expect(page.getByText(t('banners.connection.lost'))).toHaveCount(0);
    // The server is there: the tab keeps the name of the page.
    await expect(page).toHaveTitle(tabTitle(t('navigation.sections.sessions')));
  });

  test('says the browser is being downloaded, and that sessions can start once it is done', async ({
    page,
  }) => {
    await meta(page, {
      browserInstalled: false,
      browserInstalling: true,
      browserInstallProgress: { phase: 'downloading', percent: 45 },
      browserInstallError: null,
    });
    await page.goto('/sessions');
    await expect(page.getByText(t('banners.browser.installing'))).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
    // How much of it is in.
    await expect(
      page.getByRole('progressbar', { name: t('banners.browser.progress') }),
    ).toHaveAttribute('aria-valuenow', '45');
    // Adding a session waits, and the button says why.
    await expect(
      page.getByRole('button', { name: t('sessions.panel.add') }),
    ).toBeDisabled();
  });

  test('says the browser is not installed yet', async ({ page }) => {
    await meta(page, {
      browserInstalled: false,
      browserInstalling: false,
      browserInstallError: null,
    });
    await page.goto('/proxies');
    await expect(page.getByText(t('banners.browser.notInstalled'))).toBeVisible(
      {
        timeout: TIMEOUT.FIRST_PAINT,
      },
    );
  });

  test('says the installation failed, what to do, and keeps what went wrong behind "Technical details"', async ({
    page,
  }) => {
    await meta(page, {
      browserInstalled: false,
      browserInstalling: false,
      browserInstallError: 'ENOSPC: no space left on device',
    });
    await page.goto('/secrets');
    await expect(
      page.getByText(t('banners.browser.installFailed'), { exact: true }),
    ).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
    await expect(
      page.getByText(t('banners.browser.installFailedHint')),
    ).toBeVisible();
    // The command to run by hand is code, and so is the output of the failure.
    await expect(
      page.getByText('camoufox-js fetch', { exact: true }),
    ).toBeVisible();

    const issue = page.locator('pre');
    await expect(issue).toBeHidden();
    await page.getByText(t('banners.browser.issue'), { exact: true }).click();
    await expect(issue).toHaveText('ENOSPC: no space left on device');
    await page.getByText(t('banners.browser.issue'), { exact: true }).click();
    await expect(issue).toBeHidden();
  });

  test('puts a refusal of the server in the words of the page', async ({
    page,
  }) => {
    for (const code of ['forbidden_host', 'forbidden_origin'] as const) {
      await page.route('**/api/settings', (route) =>
        route.fulfill({
          status: 403,
          json: { error: code, message: 'A message the page does not show.' },
        }),
      );
      await page.goto('/settings/general');
      await expectSettingsNotRead(page, code);
      await page.unroute('**/api/settings');
    }
  });

  test('an address the app does not know says so under a heading, in the language shown, and leads back', async ({
    page,
    browser,
  }) => {
    await page.goto('/nowhere/at/all');
    await expect(heading(page, t('navigation.notFound.title'))).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
    await expect(
      page.getByText(t('navigation.notFound.description')),
    ).toBeVisible();
    await expect(page).toHaveTitle(tabTitle(t('navigation.notFound.title')));
    // The frame is there to leave by, and no section is the current one.
    await expectCurrentSection(page, null);
    await page
      .getByRole('link', { name: t('navigation.notFound.back') })
      .click();
    await expect(page).toHaveURL(/\/sessions$/);

    // A page of a section that does not exist is just as unknown: it is not
    // titled by the section the address passed through.
    await page.goto('/settings/nowhere');
    await expect(heading(page, t('navigation.notFound.title'))).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
    await expect(page).toHaveTitle(tabTitle(t('navigation.notFound.title')));

    // A browser set to German gets it in German.
    const context = await browser.newContext({ locale: 'de-DE' });
    try {
      const german = await context.newPage();
      await german.goto('/nowhere');
      await expect(
        heading(german, tIn.de('navigation.notFound.title')),
      ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
      await expect(german).toHaveTitle(
        tabTitle(tIn.de('navigation.notFound.title')),
      );
    } finally {
      await context.close();
    }
  });
});

// =============================================================================
// A page whose code cannot be fetched
// =============================================================================

// The built app fetches the code of each page when the page is first asked for,
// as a file of its own (here, that of AI access). A tab that outlived an update
// of the manager asks for files that are gone. A miss while the router loads a
// page the person asked for reloads the page once, onto the current build; a miss
// again shows the platform's error page, and its Try again reloads on request.
// A miss while the router only preloads a link that is pointed at reloads nothing.
test.describe('A page whose code cannot be fetched', () => {
  const chunkOfAiAccess = /\/assets\/ai-access-[^/]+\.js$/;

  /**
   * Counts the documents the page starts from now on, as the page itself notes
   * them when each begins: a reload is one load however many times it was asked
   * for (the router asks twice in one turn for some), and one that was
   * replaced before it began is none. Read it once the page is at rest.
   */
  async function countLoads(page: Page): Promise<() => Promise<number>> {
    const counter = 'e2e-document-loads';
    await page.addInitScript((key) => {
      const before = Number(window.sessionStorage.getItem(key) ?? '0');
      window.sessionStorage.setItem(key, String(before + 1));
    }, counter);
    return () =>
      page.evaluate(
        (key) => Number(window.sessionStorage.getItem(key) ?? '0'),
        counter,
      );
  }

  /** Opens the first page of Settings, with the code of AI access still to be fetched. */
  async function openSettingsWithoutAiAccess(page: Page): Promise<void> {
    await page.goto('/settings/general');
    await expect(heading(page, t('settings.pages.general.title'))).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
    await page.route(chunkOfAiAccess, (route) => route.abort());
  }

  const linkToAiAccess = (page: Page) =>
    settingsPanel(page).getByRole('link', {
      name: t('settings.pages.aiAccess.title'),
    });

  /** The platform's error page: an alert with the way to try again. */
  const errorPage = (page: Page) =>
    page.getByRole('alert').filter({
      has: page.getByRole('button', { name: t('common.errors.tryAgain') }),
    });

  test('reloads the page once by itself when the page asked for cannot be fetched, then shows the platform error page', async ({
    page,
  }) => {
    await openSettingsWithoutAiAccess(page);
    const loads = await countLoads(page);

    await linkToAiAccess(page).click();

    const failure = errorPage(page);
    await expect(
      failure.getByRole('heading', {
        level: 1,
        name: t('common.errors.somethingWentWrong'),
      }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(
      failure.getByText(t('common.errors.errorLoadingPage')),
    ).toBeVisible();
    // What went wrong is behind a button, for whoever wants it.
    await expect(
      failure.getByRole('button', { name: t('common.errors.showDetails') }),
    ).toBeVisible();
    // Nothing of the page that failed is shown under it.
    await expect(page.getByRole('switch')).toHaveCount(0);

    // One reload, not a loop: once the page is at rest it has been loaded
    // again exactly once.
    await page.waitForLoadState('networkidle');
    expect(await loads()).toBe(1);
  });

  test('reloads once by itself when it is opened at the address of such a page, then shows the error page', async ({
    page,
  }) => {
    await page.route(chunkOfAiAccess, (route) => route.abort());
    const loads = await countLoads(page);

    // Not waited for to load: the page reloads itself before it is done.
    await page.goto('/settings/ai-access', { waitUntil: 'commit' });

    await expect(errorPage(page)).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    await page.waitForLoadState('networkidle');
    // The load that opened it, and one reload.
    expect(await loads()).toBe(2);
  });

  test('loads the page when Try again reloads it once its code can be fetched', async ({
    page,
  }) => {
    await openSettingsWithoutAiAccess(page);
    const loads = await countLoads(page);
    await linkToAiAccess(page).click();
    const failure = errorPage(page);
    await expect(failure).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await page.waitForLoadState('networkidle');
    expect(await loads(), 'the reload the page made by itself').toBe(1);

    await page.unroute(chunkOfAiAccess);
    await failure
      .getByRole('button', { name: t('common.errors.tryAgain') })
      .click();

    await expect(
      page.getByRole('heading', {
        level: 2,
        name: t('settings.aiAccess.assistants.title'),
      }),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    await expect(failure).toHaveCount(0);
    expect(await loads(), 'and the one Try again made').toBe(2);
  });

  for (const how of ['hovered', 'focused'] as const) {
    test(`does not reload for a link whose page cannot be fetched while it is only ${how}, but once it is followed`, async ({
      page,
    }) => {
      await openSettingsWithoutAiAccess(page);
      const loads = await countLoads(page);
      const link = linkToAiAccess(page);

      // The router asks for the page's code as soon as the link is pointed at,
      // and does not get it.
      const asked = page.waitForEvent('requestfailed', (request) =>
        chunkOfAiAccess.test(request.url()),
      );
      if (how === 'hovered') await link.hover();
      else await link.focus();
      await asked;

      await page.waitForLoadState('networkidle');
      expect(await loads(), 'nothing was asked of the page yet').toBe(0);
      await expect(errorPage(page)).toHaveCount(0);
      await expect(page).toHaveURL(/\/settings\/general$/);
      await expect(
        heading(page, t('settings.pages.general.title')),
      ).toBeVisible();

      // Following it is the ask: the page reloads, once.
      await link.click();
      await expect(errorPage(page)).toBeVisible({ timeout: TIMEOUT.VISIBLE });
      await page.waitForLoadState('networkidle');
      expect(await loads()).toBe(1);
    });
  }
});
