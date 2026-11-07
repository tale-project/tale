import type { APIRequestContext, Locator, Page } from '@playwright/test';

import type { AppApi } from '../helpers/api';
import { violationsOf } from '../helpers/axe';
import type { Control } from '../helpers/control';
import { TIMEOUT } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { fill, literally, t } from '../helpers/i18n';
import {
  LIBRARY_GAPS,
  MIN_FOCUS_CONTRAST,
  borderColoursOfPage,
  describeViolations,
  focusIndicatorOfFocused,
  landmarksOf,
  runningAnimations,
  withoutGaps,
} from '../helpers/nav-a11y';
import { focusedStop, tabTo } from '../helpers/nav-focus';
import {
  CHANGED_EXIT_IP,
  SHOP_TITLE,
  hostPortOf,
  proxiesWorkingAndNot,
  quoted,
  secretsOfEveryKind,
  sessionWhoseIpChanged,
  sessionWithBrokenProxy,
  sessionWithoutWorkingSpare,
  sessionsInEveryState,
  showProxiesChecking,
  showSessionPatches,
} from '../helpers/nav-scenes';
import {
  DESKTOP,
  LAYOUTS,
  PHONE,
  SCHEMES,
  SIDEWAYS,
  type Layout,
  type Scheme,
} from '../helpers/nav-viewports';
import {
  APP_NAME,
  LANGUAGES,
  formatPlurals,
  plural,
  tIn,
  type Language,
} from '../helpers/settings-i18n';
import {
  aiAccessSwitch,
  expectSettingsNotRead,
  languageButton,
  saveButton,
  startPageField,
} from '../helpers/settings-pages';

// What a test changes in the manager's settings, or scripts in the fakes, goes
// back to the defaults when it ends, whether it passed or not.
test.afterEach(async ({ api, control }) => {
  await control.clear();
  await api.updateSettings({ startPage: '', mcpEnabled: false });
});

// =============================================================================
// How the audits run
// =============================================================================

// Every state is audited with axe (WCAG 2.0/2.1 A and AA, colour contrast
// included) in light and in dark, at the width of a computer and of a phone.
// The session screens are audited in a phone held sideways as well (844 x
// 390), where a menu or a dialog has hardly any height to spare.
// A violation is the app's to fix; nothing is excluded from an audit, except
// the one rule of the component library that is a Known gap, in the states of
// that gap only (`LIBRARY_GAPS`). Motion is reduced while auditing, so that no
// dialog is caught half faded in (axe would take a blend of its colours for its
// colours).

interface Mode {
  scheme: Scheme;
  layout: Layout;
  label: string;
}

function modesOf(layouts: readonly Layout[]): readonly Mode[] {
  return SCHEMES.flatMap((scheme) =>
    layouts.map((layout) => ({
      scheme,
      layout,
      label: `${scheme}, ${layout.name}`,
    })),
  );
}

/** A computer and a phone, in light and in dark. */
const MODES = modesOf(LAYOUTS);
/** A phone held sideways, in light and in dark. */
const SIDEWAYS_MODES = modesOf([SIDEWAYS]);

async function inEveryMode(
  page: Page,
  run: (mode: Mode) => Promise<void>,
  modes: readonly Mode[] = MODES,
): Promise<void> {
  // A form with changes in it asks "Discard unsaved changes?" with the
  // browser's own question when it is closed; the audits leave their forms.
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  for (const mode of modes) {
    await test.step(mode.label, async () => {
      await page.emulateMedia({
        colorScheme: mode.scheme,
        reducedMotion: 'reduce',
      });
      await page.setViewportSize(mode.layout.viewport);
      await run(mode);
    });
  }
}

const isDark = (page: Page) =>
  page.evaluate(() => document.documentElement.classList.contains('dark'));

/** What an audit lets through, and what it expects to find on the page. */
interface AuditOptions {
  /**
   * Rules of the component library that the state is known to break in a phone
   * held sideways (Known gaps of the change), and only there: on a computer and
   * on a phone upright nothing is let through.
   */
  gaps?: readonly string[];
  /** The state is one of loading: masks stand where what is to come will be, and stay. */
  loading?: boolean;
}

/**
 * `scrollable-region-focusable`, which the component library breaks in a phone
 * held sideways (a Known gap of the change): a Radix menu taller than the room
 * under its button scrolls, and holds nothing the Tab key reaches (its items
 * take the arrow keys). Measured in these states: the row menus of a running, a
 * stopped and a failed session on the list, and the menu in the header of the
 * page of a stopped session (Show window, which leads each of them, made them
 * taller); the menu in the header of the page of a running session fits. Every
 * other rule is asserted there as well.
 */
const SCROLLING_MENU: AuditOptions = { gaps: [LIBRARY_GAPS.scrollableRegion] };

/** Audits what the page shows now. */
async function expectAccessible(
  page: Page,
  what: string,
  mode: Mode,
  { gaps = [], loading = false }: AuditOptions = {},
): Promise<void> {
  // The page is in the scheme that is audited, nothing is still loading in
  // masks (unless the state is the loading), and no animation is half way.
  await expect
    .poll(() => isDark(page), { message: `the page is ${mode.scheme}` })
    .toBe(mode.scheme === 'dark');
  if (!loading) {
    await expect(page.locator('[data-skeleton-mask]')).toHaveCount(0);
  }
  await expect
    .poll(async () => (await runningAnimations(page)).length, {
      message: 'no animation is running',
    })
    .toBe(0);

  const violations = withoutGaps(
    await violationsOf(page),
    mode.layout.name === SIDEWAYS.name ? gaps : [],
  );
  expect
    .soft(
      violations,
      `${what} (${mode.label})\n${describeViolations(violations)}`,
    )
    .toEqual([]);
}

/** What a test of the session screens is given: the page, and the means to set a scene up. */
interface Scene {
  page: Page;
  api: AppApi;
  control: Control;
  request: APIRequestContext;
}

/**
 * The session screens are audited twice: on a computer and a phone upright,
 * and on a phone held sideways. `body` is the audit of one screen, given the
 * modes of the run.
 */
function auditSessionScreens(
  title: string,
  body: (scene: Scene, modes: readonly Mode[]) => Promise<void>,
): void {
  for (const { suffix, modes } of [
    { suffix: '', modes: MODES },
    { suffix: ' (a phone held sideways)', modes: SIDEWAYS_MODES },
  ]) {
    test(`${title}${suffix}`, ({ page, api, control, request }) =>
      body({ page, api, control, request }, modes));
  }
}

const heading1 = (page: Page, name: string) =>
  page.getByRole('heading', { level: 1, name, exact: true });

/** "Running in its own window": the heading of the card on the page of a running session. */
const windowHeading = (page: Page) =>
  page.getByRole('heading', { level: 2, name: t('viewer.window.title') });

// Things the specs open over and over.

const sessionList = (page: Page) =>
  page.getByRole('region', { name: t('sessions.list.label') });

async function openRowMenu(page: Page, name: string): Promise<Locator> {
  const row = sessionList(page).getByRole('listitem').filter({ hasText: name });
  // The buttons of a row wait for the pointer on a computer.
  await row.hover();
  const label = fill(t('sessions.row.menu'), { name });
  await row.getByRole('button', { name: label }).click();
  const menu = page.getByRole('menu', { name: label });
  await expect(menu).toBeVisible();
  return menu;
}

/** The chip in the header of a session's page that says where it exits, and opens its details. */
const exitChip = (page: Page, ip: string) =>
  page
    .getByRole('main')
    .getByRole('button', { name: new RegExp(`^${literally(ip).source}`) });

/**
 * Closes the dialog, menu or popover that is open: a menu or a list with the
 * keyboard, a dialog with its Close button (a form with changes in it does not
 * close on Escape), a popover without one with the keyboard.
 */
async function closeOverlay(page: Page): Promise<void> {
  const dialogs = page.getByRole('dialog');
  const insideDialog =
    (await dialogs.count()) > 0 &&
    (await page.getByRole('menu').count()) === 0 &&
    (await page.getByRole('listbox').count()) === 0;
  const close = dialogs
    .last()
    .getByRole('button', { name: t('common.aria.close'), exact: true });
  if (insideDialog && (await close.count()) > 0) await close.click();
  else await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('listbox')).toHaveCount(0);
}

// =============================================================================
// Pages
// =============================================================================

/**
 * The manager says, for the page, that its browser is not installed and that
 * nothing is in progress, unless `change` says otherwise.
 */
async function browserIs(
  page: Page,
  change: Record<string, unknown>,
): Promise<void> {
  await page.route('**/api/meta', async (route) => {
    const response = await route.fetch();
    const body: unknown = await response.json();
    await route.fulfill({
      response,
      json: {
        ...(typeof body === 'object' && body !== null ? body : {}),
        browserInstalled: false,
        browserInstalling: false,
        browserInstallError: null,
        ...change,
      },
    });
  });
}

test.describe('Axe: the pages', () => {
  test('the audit sees text that is hard to read, in the colours of the page that is open', async ({
    page,
  }) => {
    await page.goto('/settings/general');
    await expect(startPageField(page)).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
    expect(await violationsOf(page)).toEqual([]);

    // Pale grey on white, 1.6:1.
    await page.evaluate(() => {
      const faint = document.createElement('p');
      faint.textContent = 'Faint text';
      faint.style.cssText =
        'color:#bbb;background:#fff;font-size:14px;padding:8px;';
      document.querySelector('main')?.append(faint);
    });
    const found = await violationsOf(page);
    expect(found.map((violation) => violation.id)).toContain('color-contrast');
    expect(describeViolations(found)).toContain('Faint text');
  });

  auditSessionScreens(
    'the list of sessions, with a session in every state',
    async ({ page, api, control, request }, modes) => {
      const { running, stopped, failed } = await sessionsInEveryState(
        api,
        control,
      );
      // The states that last a moment in the manager are shown by answering the
      // page's reads of three stopped sessions with them.
      const starting = await api.stopSession(
        (await api.startSession('delta')).id,
      );
      const assigning = await api.stopSession(
        (await api.startSession('echo')).id,
      );
      const stopping = await api.stopSession(
        (await api.startSession('foxtrot')).id,
      );
      // A running session whose proxy exits through another IP than it started with.
      const { session: drifted } = await sessionWhoseIpChanged(
        api,
        control,
        request,
      );
      await showSessionPatches(
        page,
        new Map([
          [starting.id, { status: 'starting', activity: 'launching' }],
          [assigning.id, { status: 'stopped', activity: 'assigning_proxy' }],
          [stopping.id, { status: 'stopping', activity: null }],
        ]),
      );

      await inEveryMode(
        page,
        async (mode) => {
          await page.goto('/sessions');
          const rows = sessionList(page).getByRole('listitem');
          await expect(rows).toHaveCount(7, { timeout: TIMEOUT.FIRST_PAINT });

          // Each state is told in words as well as in colour.
          const word = (name: string, status: string) =>
            expect(
              rows.filter({ hasText: name }),
              `${name} says ${status}`,
            ).toContainText(status);
          await word(running.name, t('sessions.status.running'));
          await word(stopped.name, t('sessions.status.stopped'));
          await word(failed.name, t('sessions.status.error'));
          await word(starting.name, t('sessions.status.starting'));
          await word(assigning.name, t('sessions.status.assigning'));
          await word(stopping.name, t('sessions.status.stopping'));
          await word(drifted.name, t('sessions.row.ipChanged'));

          await expectAccessible(page, 'the list of sessions', mode);

          // A row that has the pointer, and one that has the keyboard.
          await rows.filter({ hasText: running.name }).hover();
          await expectAccessible(
            page,
            'the list of sessions, a row hovered',
            mode,
          );
          await tabTo(page, (stop) => stop.name.includes(failed.name));
          await expectAccessible(
            page,
            'the list of sessions, a row focused',
            mode,
          );
        },
        modes,
      );
    },
  );

  auditSessionScreens(
    'the page of a running session',
    async ({ page, api, control, request }, modes) => {
      const { running } = await sessionsInEveryState(api, control);
      const { session: drifted } = await sessionWhoseIpChanged(
        api,
        control,
        request,
      );

      await inEveryMode(
        page,
        async (mode) => {
          // The card: what it says, Show window, Secrets and the details.
          await page.goto(`/sessions/${running.id}`);
          await expect(windowHeading(page)).toBeVisible({
            timeout: TIMEOUT.FIRST_PAINT,
          });
          await expectAccessible(page, 'a running session', mode);

          // The session whose IP changed: the amber bar over the card, and the chip.
          await page.goto(`/sessions/${drifted.id}`);
          await expect(
            page.getByText(t('viewer.place.warningTitle')),
          ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
          await expectAccessible(
            page,
            'a running session whose IP changed',
            mode,
          );
        },
        modes,
      );
    },
  );

  auditSessionScreens(
    'the page of a session that is not running',
    async ({ page, api, control }, modes) => {
      const { stopped, failed } = await sessionsInEveryState(api, control);
      const starting = await api.stopSession(
        (await api.startSession('delta')).id,
      );
      const unreachable = await api.stopSession(
        (await api.startSession('foxtrot')).id,
      );
      const noProxy = await api.stopSession(
        (await api.startSession('golf')).id,
      );
      await showSessionPatches(
        page,
        new Map([
          [starting.id, { status: 'starting', activity: 'launching' }],
          [
            unreachable.id,
            {
              status: 'error',
              error: 'The proxy did not answer.',
              errorCode: 'proxy_unreachable',
            },
          ],
          [
            noProxy.id,
            {
              status: 'error',
              error: 'No working proxy is available.',
              errorCode: 'no_working_proxy',
            },
          ],
        ]),
      );

      await inEveryMode(
        page,
        async (mode) => {
          for (const [session, what] of [
            [stopped, 'a stopped session'],
            [failed, 'a session that could not start'],
            [starting, 'a session that is starting'],
            [unreachable, 'a session whose proxy does not work'],
            [noProxy, 'a session for which no proxy works'],
          ] as const) {
            await page.goto(`/sessions/${session.id}`);
            await expect(heading1(page, session.name)).toBeVisible({
              timeout: TIMEOUT.FIRST_PAINT,
            });
            await expectAccessible(page, what, mode);
          }
        },
        modes,
      );
    },
  );

  // While a session stops, its page names the state in the "warning" colour,
  // which as words must still be read at 4.5:1 on the page.
  auditSessionScreens(
    'the page of a session that is stopping is readable',
    async ({ page, api }, modes) => {
      const stopping = await api.stopSession(
        (await api.startSession('echo')).id,
      );
      await showSessionPatches(
        page,
        new Map([[stopping.id, { status: 'stopping', activity: null }]]),
      );

      await inEveryMode(
        page,
        async (mode) => {
          await page.goto(`/sessions/${stopping.id}`);
          await expect(
            page
              .getByRole('status')
              .filter({ hasText: t('sessions.status.stopping') }),
          ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
          await expectAccessible(page, 'a session that is stopping', mode);
        },
        modes,
      );
    },
  );

  auditSessionScreens(
    'the list of sessions, and the page of a session, when they could not be read',
    async ({ page, api, control }, modes) => {
      const { running } = await sessionsInEveryState(api, control);

      await inEveryMode(
        page,
        async (mode) => {
          await page.route('**/api/sessions?**', (route) => route.abort());
          await page.goto('/sessions');
          await expect(
            page.getByText(t('sessions.list.loadFailed'), { exact: true }),
          ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
          await expectAccessible(
            page,
            'a list of sessions that could not be read',
            mode,
          );
          await page.unroute('**/api/sessions?**');

          const own = `**/api/sessions/${running.id}`;
          await page.route(own, (route) => route.abort());
          await page.goto(`/sessions/${running.id}`);
          await expect(
            page.getByRole('heading', {
              level: 2,
              name: t('viewer.loadFailed.title'),
            }),
          ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
          await expectAccessible(
            page,
            'a session that could not be read',
            mode,
          );
          await page.unroute(own);
        },
        modes,
      );
    },
  );

  test('the table of proxies: working, failing, checking, free, in use and sharing an IP', async ({
    page,
    api,
    control,
  }) => {
    const { running } = await sessionsInEveryState(api, control);
    await proxiesWorkingAndNot(api, control);
    // A free proxy that exits where a running session does: "same IP as".
    await control.exitIps({
      '203.0.113.150:8080': { ip: running.proxy?.exitIp ?? '', country: 'DE' },
    });
    await api.importProxies('203.0.113.150:8080');
    await expect
      .poll(async () =>
        (await api.proxies()).every((p) => p.check.status !== 'checking'),
      )
      .toBe(true);
    const pool = await api.proxies();
    const checking = pool.find(
      (proxy) => proxy.session === null && proxy.check.status === 'ok',
    );
    await showProxiesChecking(page, new Set(checking ? [checking.id] : []));

    await inEveryMode(page, async (mode) => {
      await page.goto('/proxies');
      await expect(heading1(page, t('proxies.title'))).toBeVisible({
        timeout: TIMEOUT.FIRST_PAINT,
      });
      await expect(page.getByRole('table')).toBeVisible();
      await expect(
        page.getByText(t('proxies.health.checking')).first(),
      ).toBeVisible();
      await expect(
        page.getByText(t('proxies.health.failed')).first(),
      ).toBeVisible();
      await expect(
        page.getByText(t('proxies.health.ok')).first(),
      ).toBeVisible();
      await expect(
        page.getByText(
          fill(t('proxies.session.sameIp'), { name: running.name }),
        ),
      ).toBeVisible();
      await expectAccessible(page, 'the table of proxies', mode);
    });
  });

  test('the table of secrets', async ({ page, api, control }) => {
    const { running } = await sessionsInEveryState(api, control);
    await secretsOfEveryKind(api, running.id);

    await inEveryMode(page, async (mode) => {
      await page.goto('/secrets');
      await expect(page.getByRole('table')).toBeVisible({
        timeout: TIMEOUT.FIRST_PAINT,
      });
      await expect(page.getByRole('row')).toHaveCount(5);
      await expectAccessible(page, 'the table of secrets', mode);

      // No secret matches the search.
      const search = page.getByRole('textbox', {
        name: t('secrets.table.searchPlaceholder'),
      });
      await search.click();
      await search.fill('nothing like this');
      await expect(page.getByText(t('common.search.noResults'))).toBeVisible();
      await expectAccessible(page, 'secrets, none matching the search', mode);
    });
  });

  test('the pages when there is nothing yet', async ({ page, api }) => {
    await inEveryMode(page, async (mode) => {
      // No proxies: a session cannot be added, and the page says how to get one.
      await page.goto('/sessions');
      await expect(page.getByText(t('sessions.empty.noProxies'))).toBeVisible({
        timeout: TIMEOUT.FIRST_PAINT,
      });
      await expectAccessible(page, 'no sessions, no proxies', mode);

      await page.goto('/proxies');
      await expect(page.getByText(t('proxies.empty.title'))).toBeVisible();
      await expectAccessible(page, 'no proxies', mode);

      await page.goto('/secrets');
      await expect(page.getByText(t('secrets.empty.title'))).toBeVisible();
      await expectAccessible(page, 'no secrets', mode);

      // With a proxy there is a session to add.
      await api.addProxies(1);
      await page.goto('/sessions');
      await expect(
        page.getByText(t('sessions.empty.description')),
      ).toBeVisible();
      await expectAccessible(page, 'no sessions', mode);
      await api.reset();
    });
  });

  test('the settings pages', async ({ page, api }) => {
    await inEveryMode(page, async (mode) => {
      for (const [path, name] of [
        ['/settings/general', t('settings.pages.general.title')],
        ['/settings/appearance', t('settings.pages.appearance.title')],
        ['/settings/ai-access', t('settings.pages.aiAccess.title')],
      ] as const) {
        await page.goto(path);
        await expect(heading1(page, name)).toBeVisible({
          timeout: TIMEOUT.FIRST_PAINT,
        });
        await expectAccessible(page, name, mode);
      }

      // AI access switched on: the setup of each assistant, then every group
      // of tools opened.
      await api.updateSettings({ mcpEnabled: true });
      await page.goto('/settings/ai-access');
      await expect(aiAccessSwitch(page)).toBeChecked();
      for (const client of [
        'clientClaudeCode',
        'clientCursor',
        'clientClaudeDesktop',
      ] as const) {
        const tab = page.getByRole('tab', {
          name: t(`settings.aiAccess.connect.${client}`),
          exact: true,
        });
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await expectAccessible(
          page,
          `AI access, on, the setup for ${client}`,
          mode,
        );
      }
      for (const summary of await page.locator('summary').all()) {
        await summary.click();
      }
      await expectAccessible(page, 'AI access, on, every group open', mode);
      await api.updateSettings({ mcpEnabled: false });

      // The list of pages, which is what Settings is on a phone.
      if (mode.layout.name === 'phone') {
        await page.goto('/settings');
        await expect(
          heading1(page, t('navigation.sections.settings')),
        ).toBeVisible();
        await expectAccessible(page, 'the list of settings pages', mode);
      }
    });
  });

  test('the start page field with a refusal, and with a change made elsewhere', async ({
    page,
    api,
  }) => {
    await inEveryMode(page, async (mode) => {
      await page.goto('/settings/general');
      const field = startPageField(page);
      await expect(field).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

      // The button that offers the default, and a refusal.
      await field.fill('not a web address');
      await saveButton(page).click();
      await expect(
        page.getByText(t('errors.invalid_start_page')),
      ).toBeVisible();
      await expectAccessible(page, 'the start page, refused', mode);

      // The notice that the address was changed somewhere else.
      await field.fill('draft.example.com');
      await api.updateSettings({ startPage: 'https://elsewhere.example' });
      await page.evaluate(() =>
        window.dispatchEvent(new Event('visibilitychange')),
      );
      await expect(
        page.getByText(t('settings.general.startPage.remote.message')),
      ).toBeVisible();
      await expectAccessible(page, 'the start page, changed elsewhere', mode);
      await api.updateSettings({ startPage: '' });
    });
  });

  test('the pages that say something went wrong', async ({ page }) => {
    await inEveryMode(page, async (mode) => {
      await page.goto('/sessions/999999');
      await expect(page.getByText(t('viewer.gone.title'))).toBeVisible({
        timeout: TIMEOUT.FIRST_PAINT,
      });
      await expectAccessible(page, 'a session that does not exist', mode);

      // The settings could not be read.
      await page.route('**/api/settings', (route) => route.abort());
      await page.goto('/settings/general');
      await expectSettingsNotRead(page, 'network');
      await expectAccessible(page, 'settings that could not be read', mode);
      await page.unroute('**/api/settings');

      // The server cannot be reached.
      await page.route('**/api/meta', (route) => route.abort());
      await page.goto('/proxies');
      await expect(page.getByText(t('banners.connection.lost'))).toBeVisible({
        timeout: TIMEOUT.FIRST_PAINT,
      });
      await expectAccessible(page, 'the connection lost', mode);
      await page.unroute('**/api/meta');

      // The server answers, with an error.
      await page.route('**/api/meta', (route) =>
        route.fulfill({
          status: 500,
          json: { error: 'internal_error', message: 'Something went wrong.' },
        }),
      );
      await page.goto('/proxies');
      await expect(page.getByText(t('banners.connection.failed'))).toBeVisible({
        timeout: TIMEOUT.FIRST_PAINT,
      });
      await expectAccessible(page, 'the server answering with an error', mode);
      await page.unroute('**/api/meta');

      // The browser is not there yet.
      for (const [change, text, what] of [
        [
          { browserInstalling: true },
          t('banners.browser.installing'),
          'being installed',
        ],
        [{}, t('banners.browser.notInstalled'), 'not installed'],
      ] as const) {
        await browserIs(page, change);
        await page.goto('/sessions');
        await expect(page.getByText(text)).toBeVisible({
          timeout: TIMEOUT.FIRST_PAINT,
        });
        await expectAccessible(page, `the browser ${what}`, mode);
        await page.unroute('**/api/meta');
      }
    });
  });

  test("the platform's error page, for a page whose code cannot be loaded", async ({
    page,
  }) => {
    const chunk = /\/assets\/ai-access-[^/]+\.js$/;

    await inEveryMode(page, async (mode) => {
      // The pages of Settings are in a panel on a computer, in a list on a phone.
      const onComputer = mode.layout.name === 'desktop';
      await page.goto(onComputer ? '/settings/general' : '/settings');
      await expect(
        heading1(
          page,
          onComputer
            ? t('settings.pages.general.title')
            : t('navigation.sections.settings'),
        ),
      ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

      await page.route(chunk, (route) => route.abort());
      await page
        .getByRole('navigation', {
          name: onComputer
            ? t('settings.nav.label')
            : t('navigation.sections.settings'),
          exact: true,
        })
        .getByRole('link', {
          name: new RegExp(
            `^${literally(t('settings.pages.aiAccess.title')).source}`,
          ),
        })
        .click();
      await expect(
        page.getByRole('button', { name: t('common.errors.tryAgain') }),
      ).toBeVisible();
      await expectAccessible(page, 'the error page', mode);
      await page.unroute(chunk);
    });
  });

  // The summary "Technical details" sits in muted text on the banner's red
  // tint, and must still be read at 4.5:1 in both states of the disclosure.
  test('the banner of a browser whose installation failed is readable, with its technical details closed and open', async ({
    page,
  }) => {
    await inEveryMode(page, async (mode) => {
      await browserIs(page, {
        browserInstallError: 'ENOSPC: no space left on device',
      });
      await page.goto('/sessions');
      await expect(
        page.getByText(t('banners.browser.installFailed'), { exact: true }),
      ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
      await expectAccessible(page, 'the installation failed', mode);

      // What went wrong waits behind "Technical details".
      await page.getByText(t('banners.browser.issue'), { exact: true }).click();
      await expect(page.locator('pre')).toBeVisible();
      await expectAccessible(
        page,
        'the installation failed, the technical details open',
        mode,
      );
      await page.unroute('**/api/meta');
    });
  });

  test('the page of an address the app does not know', async ({ page }) => {
    await inEveryMode(page, async (mode) => {
      await page.goto('/nowhere/at/all');
      await expect(page.locator('main')).toBeVisible({
        timeout: TIMEOUT.FIRST_PAINT,
      });
      await expectAccessible(page, 'an unknown address', mode);
    });
  });
});

// =============================================================================
// Dialogs, menus and popovers
// =============================================================================

test.describe('Axe: dialogs and menus of the sessions', () => {
  auditSessionScreens(
    'adding, renaming, restarting, rotating and deleting a session, and the menus',
    async ({ page, api, control }, modes) => {
      const { running, stopped, failed } = await sessionsInEveryState(
        api,
        control,
      );
      await secretsOfEveryKind(api, running.id);

      await inEveryMode(
        page,
        async (mode) => {
          await page.goto('/sessions');
          await expect(sessionList(page).getByRole('listitem')).toHaveCount(3, {
            timeout: TIMEOUT.FIRST_PAINT,
          });
          const add = page.getByRole('button', {
            name: t('sessions.panel.add'),
          });
          const dialog = (name: string) => page.getByRole('dialog', { name });

          // Add a session: the form, the list of systems, a name taken, no proxy left.
          await add.click();
          await expect(dialog(t('sessions.add.title'))).toBeVisible();
          await expectAccessible(page, 'add a session', mode);
          await page
            .getByRole('combobox', { name: t('sessions.add.system') })
            .click();
          await expect(page.getByRole('listbox')).toBeVisible();
          await expectAccessible(
            page,
            'add a session, the systems listed',
            mode,
          );
          await page.keyboard.press('Escape');
          await page
            .getByRole('textbox', { name: t('sessions.add.name') })
            .fill(running.name);
          await dialog(t('sessions.add.title'))
            .getByRole('button', { name: t('sessions.add.submit') })
            .click();
          await expect(page.getByText(t('errors.name_taken'))).toBeVisible();
          await expectAccessible(page, 'add a session, the name taken', mode);
          await page
            .getByRole('textbox', { name: t('sessions.add.name') })
            .fill('');
          await dialog(t('sessions.add.title'))
            .getByRole('button', { name: t('sessions.add.submit') })
            .click();
          await expect(
            page.getByText(t('sessions.noProxy.title')),
          ).toBeVisible();
          await expectAccessible(page, 'add a session, no free proxy', mode);
          await closeOverlay(page);

          // The menus.
          const header = page.getByRole('button', {
            name: t('sessions.panel.more'),
          });
          await header.click();
          await expect(page.getByRole('menu')).toBeVisible();
          await expectAccessible(page, 'the menu of the list', mode);
          await closeOverlay(page);

          await openRowMenu(page, running.name);
          await expectAccessible(
            page,
            'the menu of a running session',
            mode,
            SCROLLING_MENU,
          );
          await closeOverlay(page);
          await openRowMenu(page, stopped.name);
          await expectAccessible(
            page,
            'the menu of a stopped session',
            mode,
            SCROLLING_MENU,
          );
          await closeOverlay(page);
          await openRowMenu(page, failed.name);
          await expectAccessible(
            page,
            'the menu of a session that could not start',
            mode,
            SCROLLING_MENU,
          );

          // Rename.
          await page
            .getByRole('menuitem', { name: t('sessions.menu.rename') })
            .click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await expectAccessible(page, 'rename a session', mode);
          await closeOverlay(page);

          // Restart and rotate ask first, for a running session.
          const menu = await openRowMenu(page, running.name);
          await menu
            .getByRole('menuitem', { name: t('sessions.menu.restart') })
            .click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await expectAccessible(page, 'restart a session', mode);
          await closeOverlay(page);
          const menu2 = await openRowMenu(page, running.name);
          await menu2
            .getByRole('menuitem', {
              name: new RegExp(
                `^${literally(t('sessions.menu.rotate')).source}`,
              ),
            })
            .click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await expectAccessible(page, 'rotate the IP of a session', mode);
          // No other proxy is free: the answer is the dialog that says so.
          await page
            .getByRole('dialog')
            .getByRole('button', { name: t('sessions.rotate.confirm') })
            .click();
          await expect(
            page.getByRole('dialog', { name: t('sessions.noProxy.title') }),
          ).toBeVisible();
          await expectAccessible(page, 'no free proxy to rotate to', mode);
          await closeOverlay(page);

          // Delete: a running session with a secret of its own, and a stopped one.
          const menu3 = await openRowMenu(page, running.name);
          await menu3
            .getByRole('menuitem', { name: t('common.actions.delete') })
            .click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await expect(
            page.getByText(plural(t('sessions.delete.secrets'), 1)),
          ).toBeVisible();
          await expectAccessible(
            page,
            'delete a running session that has a secret',
            mode,
          );
          await closeOverlay(page);
          const menu4 = await openRowMenu(page, stopped.name);
          await menu4
            .getByRole('menuitem', { name: t('common.actions.delete') })
            .click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await expectAccessible(page, 'delete a stopped session', mode);
          await closeOverlay(page);
        },
        modes,
      );
    },
  );

  auditSessionScreens(
    'the menu and the dialogs on the page of a session',
    async ({ page, api, control }, modes) => {
      const { running, stopped } = await sessionsInEveryState(api, control);

      await inEveryMode(
        page,
        async (mode) => {
          await page.goto(`/sessions/${stopped.id}`);
          await expect(heading1(page, stopped.name)).toBeVisible({
            timeout: TIMEOUT.FIRST_PAINT,
          });
          await page
            .getByRole('button', {
              name: fill(t('sessions.row.menu'), { name: stopped.name }),
            })
            .last()
            .click();
          await expect(page.getByRole('menu')).toBeVisible();
          await expectAccessible(
            page,
            'the menu in the header of a session',
            mode,
            SCROLLING_MENU,
          );
          await closeOverlay(page);

          await page.goto(`/sessions/${running.id}`);
          await expect(heading1(page, running.name)).toBeVisible({
            timeout: TIMEOUT.FIRST_PAINT,
          });
          await page
            .getByRole('button', {
              name: fill(t('sessions.row.menu'), { name: running.name }),
            })
            .last()
            .click();
          // A running session's menu leads with Show window, which it can do.
          await expect(
            page.getByRole('menuitem', { name: t('sessions.menu.showWindow') }),
          ).toBeEnabled();
          await expectAccessible(
            page,
            'the menu in the header of a running session',
            mode,
          );
          await page
            .getByRole('menuitem', { name: t('common.actions.delete') })
            .click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await expectAccessible(page, 'delete a session from its page', mode);
          await closeOverlay(page);
        },
        modes,
      );
    },
  );

  auditSessionScreens(
    'the notices of a check of the exit IP: the same IP, and one that changed',
    async ({ page, api, control }, modes) => {
      const { running } = await sessionsInEveryState(api, control);
      const drifted = await api.startSession('golf');
      const was = drifted.proxy?.exitIp ?? '';
      await control.exitIps({
        [hostPortOf(drifted)]: { ip: CHANGED_EXIT_IP, country: 'DE' },
      });

      await inEveryMode(
        page,
        async (mode) => {
          await page.goto('/sessions');
          await expect(sessionList(page).getByRole('listitem')).toHaveCount(4, {
            timeout: TIMEOUT.FIRST_PAINT,
          });
          for (const [session, notice, what] of [
            [
              running,
              fill(t('sessions.notices.ipSame'), {
                ip: running.proxy?.exitIp ?? '',
              }),
              'the notice that the IP is the same',
            ],
            [
              drifted,
              fill(t('sessions.notices.ipChanged'), {
                now: CHANGED_EXIT_IP,
                was,
              }),
              'the notice that the IP changed',
            ],
          ] as const) {
            const menu = await openRowMenu(page, session.name);
            await menu
              .getByRole('menuitem', {
                name: new RegExp(
                  `^${literally(t('sessions.menu.checkIp')).source}`,
                ),
              })
              .click();
            const toast = page.getByText(notice, { exact: true });
            await expect(toast).toBeVisible({ timeout: TIMEOUT.VISIBLE });
            await expectAccessible(page, what, mode);
            await expect(toast).toHaveCount(0);
          }
        },
        modes,
      );
    },
  );

  auditSessionScreens(
    'a start that would share an exit IP, and one with no proxy to give',
    async ({ page, api, control }, modes) => {
      // Two proxies lead out through one IP: the second session, started after
      // the first, is the one the person is asked about.
      const first = await api.startSession('first');
      const second = await api.stopSession(
        (await api.startSession('second')).id,
      );
      await control.exitIps({
        [hostPortOf(second)]: {
          ip: first.proxy?.exitIp ?? '',
          country: 'DE',
        },
      });
      // A third session has lost its proxy, and none is free for it.
      const homeless = await api.stopSession(
        (await api.startSession('homeless')).id,
      );
      await api.deleteProxy(homeless.proxy?.id ?? 0);

      await inEveryMode(
        page,
        async (mode) => {
          await page.goto(`/sessions/${second.id}`);
          await expect(heading1(page, second.name)).toBeVisible({
            timeout: TIMEOUT.FIRST_PAINT,
          });
          await page
            .getByRole('button', {
              name: t('viewer.actions.start'),
              exact: true,
            })
            .click();
          await expect(
            page.getByRole('dialog', { name: t('sessions.sharedIp.title') }),
          ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
          await expectAccessible(
            page,
            'a start that would share an exit IP',
            mode,
          );
          await closeOverlay(page);

          await page.goto(`/sessions/${homeless.id}`);
          await expect(heading1(page, homeless.name)).toBeVisible({
            timeout: TIMEOUT.FIRST_PAINT,
          });
          await page
            .getByRole('button', {
              name: t('viewer.actions.start'),
              exact: true,
            })
            .click();
          await expect(
            page.getByRole('dialog', { name: t('sessions.noProxy.title') }),
          ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
          await expectAccessible(page, 'a start with no free proxy', mode);
          await closeOverlay(page);
        },
        modes,
      );
    },
  );

  // Each mode builds its scene anew: what the dialogs ask leaves the session
  // in the error that Cancel accepts, which the next mode must not meet.
  auditSessionScreens(
    'a start whose proxy does not work, and a rotation that finds no proxy that works',
    async ({ page, api, control }, modes) => {
      await inEveryMode(
        page,
        async (mode) => {
          const broken = await sessionWithBrokenProxy(api, control);
          await page.goto(`/sessions/${broken.id}`);
          await expect(heading1(page, broken.name)).toBeVisible({
            timeout: TIMEOUT.FIRST_PAINT,
          });
          await page
            .getByRole('button', {
              name: t('viewer.actions.start'),
              exact: true,
            })
            .click();
          await expect(
            page.getByRole('dialog', {
              name: fill(t('sessions.brokenProxy.title'), {
                name: quoted(broken.name),
              }),
            }),
          ).toBeVisible({ timeout: TIMEOUT.BACKGROUND });
          await expectAccessible(
            page,
            'a start whose proxy does not work',
            mode,
          );
          await closeOverlay(page);
          await api.reset();
          await control.clear();

          const stuck = await sessionWithoutWorkingSpare(api, control);
          await page.goto(`/sessions/${stuck.id}`);
          await expect(heading1(page, stuck.name)).toBeVisible({
            timeout: TIMEOUT.FIRST_PAINT,
          });
          await page
            .getByRole('button', {
              name: fill(t('sessions.row.menu'), { name: stuck.name }),
            })
            .last()
            .click();
          await page
            .getByRole('menuitem', {
              name: new RegExp(
                `^${literally(t('sessions.menu.rotate')).source}`,
              ),
            })
            .click();
          await page
            .getByRole('dialog')
            .getByRole('button', { name: t('sessions.rotate.confirm') })
            .click();
          await expect(
            page.getByRole('dialog', { name: t('sessions.noWorking.title') }),
          ).toBeVisible({ timeout: TIMEOUT.BACKGROUND });
          await expectAccessible(
            page,
            'a rotation that finds no proxy that works',
            mode,
          );
          await closeOverlay(page);
          await api.reset();
          await control.clear();
        },
        modes,
      );
    },
  );

  auditSessionScreens(
    'the details of a session, from the chip in its header: in sync, and once its IP changed',
    async ({ page, api, control, request }, modes) => {
      const { running } = await sessionsInEveryState(api, control);
      const { session: drifted } = await sessionWhoseIpChanged(
        api,
        control,
        request,
      );

      await inEveryMode(
        page,
        async (mode) => {
          for (const [session, what] of [
            [running, 'a running session'],
            [drifted, 'a running session whose IP changed'],
          ] as const) {
            await page.goto(`/sessions/${session.id}`);
            await expect(heading1(page, session.name)).toBeVisible({
              timeout: TIMEOUT.FIRST_PAINT,
            });
            await exitChip(page, session.proxy?.exitIp ?? '').click();
            await expect(
              page.getByRole('dialog', { name: t('viewer.details.title') }),
            ).toBeVisible();
            await expectAccessible(page, `the details of ${what}`, mode);
            await closeOverlay(page);
          }
        },
        modes,
      );
    },
  );
});

test.describe('Axe: dialogs and menus of the proxies', () => {
  test('adding, importing and deleting proxies, and the menus', async ({
    page,
    api,
    control,
  }) => {
    const { running, stopped } = await sessionsInEveryState(api, control);
    const { failing } = await proxiesWorkingAndNot(api, control);
    const pool = await api.proxies();
    const free = pool.find(
      (proxy) => proxy.session === null && proxy.check.status === 'ok',
    );
    const inUse = pool.find((proxy) => proxy.session?.id === stopped.id);
    const busy = pool.find((proxy) => proxy.session?.id === running.id);
    expect([free, inUse, busy].every((proxy) => proxy !== undefined)).toBe(
      true,
    );
    // Every mode imports addresses of its own, so that each import adds.
    let next = 100;

    await inEveryMode(page, async (mode) => {
      await page.goto('/proxies');
      await expect(page.getByRole('table')).toBeVisible({
        timeout: TIMEOUT.FIRST_PAINT,
      });
      const add = page.getByRole('button', {
        name: t('proxies.actions.add'),
        exact: true,
      });

      await add.click();
      await expect(page.getByRole('menu')).toBeVisible();
      await expectAccessible(page, 'the menu to add proxies', mode);

      await page
        .getByRole('menuitem', { name: t('proxies.actions.addProxy') })
        .click();
      const addDialog = page.getByRole('dialog', {
        name: t('proxies.add.title'),
      });
      await expect(addDialog).toBeVisible();
      await expectAccessible(page, 'add a proxy', mode);
      // Not a proxy, then one that is in the pool already.
      const field = addDialog.getByRole('textbox', {
        name: t('proxies.add.label'),
      });
      await field.fill('not a proxy at all');
      await addDialog
        .getByRole('button', { name: t('proxies.add.submit') })
        .click();
      await expect(addDialog.locator('[aria-invalid="true"]')).toBeVisible();
      await expectAccessible(page, 'add a proxy, not a proxy', mode);
      await field.fill(`${failing.host}:${failing.port}`);
      await addDialog
        .getByRole('button', { name: t('proxies.add.submit') })
        .click();
      await expect(
        addDialog.getByRole('button', { name: t('proxies.add.show') }),
      ).toBeVisible();
      await expectAccessible(
        page,
        'add a proxy, one that is in the pool',
        mode,
      );
      await closeOverlay(page);

      await add.click();
      await page
        .getByRole('menuitem', { name: t('proxies.actions.importProxies') })
        .click();
      const importDialog = page.getByRole('dialog', {
        name: t('proxies.import.title'),
      });
      await expect(importDialog).toBeVisible();
      await expectAccessible(page, 'import proxies', mode);
      await importDialog
        .getByRole('textbox', { name: t('proxies.import.label') })
        .fill(
          `198.51.100.${next++}:8080\n${failing.host}:${failing.port}\nbroken line here`,
        );
      await importDialog
        .getByRole('button', { name: t('proxies.import.submit') })
        .click();
      await expect(importDialog.getByRole('status')).toHaveText(
        formatPlurals(t('proxies.result.summary'), {
          added: 1,
          duplicates: 1,
          errors: 1,
        }),
      );
      await expectAccessible(page, 'the result of an import', mode);
      await closeOverlay(page);

      // The menu of a row, and the three questions deleting a proxy can ask.
      for (const [proxy, what] of [
        [free, 'a free proxy'],
        [inUse, 'a proxy of a stopped session'],
        [busy, 'a proxy of a running session'],
      ] as const) {
        if (proxy === undefined) continue;
        const label = fill(t('proxies.row.actionsFor'), {
          proxy: `${proxy.host}:${proxy.port}`,
        });
        await page.getByRole('button', { name: label }).click();
        await expect(page.getByRole('menu', { name: label })).toBeVisible();
        await expectAccessible(page, `the menu of ${what}`, mode);
        await page
          .getByRole('menuitem', { name: t('common.actions.delete') })
          .click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expectAccessible(page, `delete ${what}`, mode);
        await closeOverlay(page);
      }
    });
  });

  test('the notice that a proxy was added', async ({ page, api }) => {
    await api.addProxies(1);
    let next = 10;
    await inEveryMode(page, async (mode) => {
      await page.goto('/proxies');
      await page
        .getByRole('button', { name: t('proxies.actions.add'), exact: true })
        .click();
      await page
        .getByRole('menuitem', { name: t('proxies.actions.addProxy') })
        .click();
      const dialog = page.getByRole('dialog', { name: t('proxies.add.title') });
      await dialog
        .getByRole('textbox', { name: t('proxies.add.label') })
        .fill(`198.51.100.${next++}:8080`);
      await dialog
        .getByRole('button', { name: t('proxies.add.submit') })
        .click();
      await expect(
        page.getByText(t('proxies.toasts.added'), { exact: true }),
      ).toBeVisible();
      await expectAccessible(page, 'the notice that a proxy was added', mode);
      await expect(
        page.getByText(t('proxies.toasts.added'), { exact: true }),
      ).toHaveCount(0);
    });
  });
});

test.describe('Axe: dialogs and menus of the secrets', () => {
  test('adding, viewing, editing and deleting a secret, and the menus', async ({
    page,
    api,
    control,
  }) => {
    const { running } = await sessionsInEveryState(api, control);
    const secrets = await secretsOfEveryKind(api, running.id);
    const [shop] = secrets;
    expect(shop).toBeDefined();
    const title = shop?.title ?? '';

    await inEveryMode(page, async (mode) => {
      await page.goto('/secrets');
      await expect(page.getByRole('table')).toBeVisible({
        timeout: TIMEOUT.FIRST_PAINT,
      });

      // The filters: the panel with a facet open, the choice, and the chip that says what narrows the list.
      await page
        .getByRole('button', { name: t('common.labels.filter'), exact: true })
        .click();
      const filters = page.getByRole('dialog', {
        name: t('common.labels.filters'),
      });
      await expect(filters).toBeVisible();
      await expectAccessible(page, 'the filters of the secrets', mode);
      await filters
        .getByRole('button', { name: t('secrets.filters.type'), exact: true })
        .click();
      await expect(
        filters.getByRole('radiogroup', { name: t('secrets.filters.type') }),
      ).toBeVisible();
      await expectAccessible(page, 'the type filter open', mode);
      await filters
        .getByRole('radio', { name: t('secrets.kinds.credentials') })
        .click();
      await expect(page.getByRole('row')).toHaveCount(2);
      await expectAccessible(
        page,
        'secrets filtered by type, the panel open',
        mode,
      );
      await filters
        .getByRole('button', { name: t('secrets.filters.scope'), exact: true })
        .click();
      await expect(
        filters.getByRole('radiogroup', { name: t('secrets.filters.scope') }),
      ).toBeVisible();
      await expectAccessible(page, 'the scope filter open', mode);
      await closeOverlay(page);
      const chip = fill(t('secrets.filters.chip'), {
        filter: t('secrets.filters.type'),
        value: t('secrets.kinds.credentials'),
      });
      await expect(
        page.getByRole('list', { name: t('secrets.filters.active') }),
      ).toBeVisible();
      await expectAccessible(page, 'secrets filtered by type, the chip', mode);
      await page
        .getByRole('button', {
          name: fill(t('secrets.filters.remove'), { chip }),
        })
        .click();
      await expect(page.getByRole('row')).toHaveCount(secrets.length + 1);

      // Add: a credentials form (the default), the password shown, the lists, a note.
      await page
        .getByRole('button', { name: t('secrets.actions.add'), exact: true })
        .first()
        .click();
      const form = page.getByRole('dialog', {
        name: t('secrets.form.createTitle'),
      });
      await expect(form).toBeVisible();
      await expectAccessible(page, 'add a secret', mode);
      await form
        .getByRole('textbox', { name: t('secrets.fields.password') })
        .fill('hunter2');
      await form
        .getByRole('button', {
          name: fill(t('secrets.row.show'), {
            label: t('secrets.fields.password'),
          }),
        })
        .click();
      await expectAccessible(page, 'add a secret, the password shown', mode);
      await form
        .getByRole('button', { name: t('secrets.form.addField') })
        .click();
      await expectAccessible(page, 'add a secret, a field added', mode);
      await form
        .getByRole('combobox', { name: t('secrets.form.kind') })
        .click();
      await expect(page.getByRole('listbox')).toBeVisible();
      await expectAccessible(page, 'add a secret, the types listed', mode);
      await page.getByRole('option', { name: t('secrets.kinds.note') }).click();
      await expectAccessible(page, 'add a note', mode);
      await form
        .getByRole('button', {
          name: new RegExp(`^${literally(t('secrets.scope.label')).source}`),
        })
        .click();
      await expect(page.getByRole('listbox').first()).toBeVisible();
      await expectAccessible(page, 'add a secret, the sessions listed', mode);
      // The list closes with Escape; the form, which has changes, with its button.
      await page.keyboard.press('Escape');
      await expect(page.getByRole('listbox')).toHaveCount(0);
      await closeOverlay(page);

      // The row's menu, the details, the edit form and the question before deleting.
      const actions = fill(t('secrets.table.actionsFor'), { title });
      await page.getByRole('button', { name: actions }).click();
      await expect(page.getByRole('menu', { name: actions })).toBeVisible();
      await expectAccessible(page, 'the menu of a secret', mode);
      await closeOverlay(page);

      await page.getByRole('button', { name: title, exact: true }).click();
      await expect(
        page.getByRole('dialog', { name: t('secrets.view.title') }),
      ).toBeVisible();
      await expectAccessible(page, 'the details of a secret', mode);
      await page
        .getByRole('button', {
          name: fill(t('secrets.row.show'), {
            label: t('secrets.fields.password'),
          }),
        })
        .click();
      await expectAccessible(
        page,
        'the details of a secret, the password shown',
        mode,
      );
      await closeOverlay(page);

      await page.getByRole('button', { name: actions }).click();
      await page
        .getByRole('menuitem', { name: t('secrets.actions.edit') })
        .click();
      await expect(
        page.getByRole('dialog', { name: t('secrets.form.editTitle') }),
      ).toBeVisible();
      await expectAccessible(page, 'edit a secret', mode);
      await closeOverlay(page);

      await page.getByRole('button', { name: actions }).click();
      await page
        .getByRole('menuitem', { name: t('common.actions.delete') })
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectAccessible(page, 'delete a secret', mode);
      await closeOverlay(page);
    });
  });
});

test.describe('Axe: the secrets of a session, typed into its window', () => {
  /** The card's button that opens the secrets of the session. */
  const secretsButton = (page: Page) =>
    page
      .getByRole('main')
      .getByRole('button', { name: t('viewer.secrets.title'), exact: true });

  auditSessionScreens(
    'the secrets of a session: the groups, a secret opened, its masked value shown, and a value that could not be typed',
    async ({ page, api, control }, modes) => {
      const { running } = await sessionsInEveryState(api, control);
      await secretsOfEveryKind(api, running.id);
      // Nothing in the window takes text: a value chosen is refused, in a toast.
      await control.focusField(running.name, false);

      await inEveryMode(
        page,
        async (mode) => {
          await page.goto(`/sessions/${running.id}`);
          await expect(windowHeading(page)).toBeVisible({
            timeout: TIMEOUT.FIRST_PAINT,
          });

          await secretsButton(page).click();
          await expect(
            page.getByRole('heading', { name: t('viewer.secrets.title') }),
          ).toBeVisible();
          await expectAccessible(page, 'the secrets of a session', mode);
          const popover = page
            .getByRole('dialog')
            .filter({ hasText: t('viewer.secrets.title') });
          await popover
            .getByRole('button', { name: new RegExp(SHOP_TITLE) })
            .click();
          await expect(
            popover.getByText(t('viewer.secrets.maskedValue')),
          ).toBeVisible();
          await expectAccessible(
            page,
            'the secrets of a session, one opened',
            mode,
          );
          await popover
            .getByRole('button', {
              name: fill(t('viewer.secrets.show'), {
                label: t('secrets.fields.password'),
              }),
            })
            .click();
          await expectAccessible(
            page,
            'the secrets of a session, a value shown',
            mode,
          );

          await popover
            .getByRole('button', {
              name: fill(t('viewer.secrets.typeLabel'), {
                label: t('secrets.fields.username'),
              }),
            })
            .click();
          await expect(
            page
              .getByRole('listitem')
              .filter({ hasText: t('errors.no_field_focused') }),
          ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
          await expectAccessible(
            page,
            'the toast of a value that could not be typed',
            mode,
          );
        },
        modes,
      );
    },
  );

  auditSessionScreens(
    'the secrets of a session that has none, and the form that adds one over the page',
    async ({ page, api }, modes) => {
      const bare = await api.startSession('bare');

      await inEveryMode(
        page,
        async (mode) => {
          await page.goto(`/sessions/${bare.id}`);
          await expect(windowHeading(page)).toBeVisible({
            timeout: TIMEOUT.FIRST_PAINT,
          });

          await secretsButton(page).click();
          const popover = page
            .getByRole('dialog')
            .filter({ hasText: t('viewer.secrets.title') });
          await expect(
            popover.getByText(t('viewer.secrets.empty')),
          ).toBeVisible();
          await expectAccessible(
            page,
            'the secrets of a session that has none',
            mode,
          );

          await popover
            .getByRole('button', {
              name: fill(t('viewer.secrets.add'), { name: quoted(bare.name) }),
            })
            .click();
          await expect(
            page.getByRole('dialog', { name: t('secrets.form.createTitle') }),
          ).toBeVisible();
          await expectAccessible(
            page,
            'the form that adds a secret for the session',
            mode,
          );
          await closeOverlay(page);
        },
        modes,
      );
    },
  );
});

test.describe('Axe: Settings', () => {
  test('the language menu, the question before leaving, a notice and a tooltip', async ({
    page,
    api,
  }) => {
    await inEveryMode(page, async (mode) => {
      await page.goto('/settings/appearance');
      await expect(languageButton(page)).toBeVisible({
        timeout: TIMEOUT.FIRST_PAINT,
      });
      await languageButton(page).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await expectAccessible(page, 'the language menu', mode);
      await closeOverlay(page);

      // The question before leaving a page with a draft.
      await page.goto('/settings/general');
      await startPageField(page).fill('draft.example.com');
      await page
        .getByRole('link', {
          name: t('navigation.sections.proxies'),
          exact: true,
        })
        .or(
          page.getByRole('button', {
            name: t('navigation.sections.proxies'),
            exact: true,
          }),
        )
        .click();
      await expect(
        page.getByRole('dialog', { name: t('common.unsavedChanges.title') }),
      ).toBeVisible();
      await expectAccessible(
        page,
        'the question before leaving unsaved changes',
        mode,
      );
      await page
        .getByRole('button', { name: t('common.unsavedChanges.stay') })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);

      // A notice that something failed.
      await page.route('**/api/settings', async (route) => {
        if (route.request().method() !== 'PATCH') return route.continue();
        return route.fulfill({
          status: 500,
          json: { error: 'internal_error', message: 'Something went wrong.' },
        });
      });
      await page.goto('/settings/ai-access');
      await aiAccessSwitch(page).click();
      await expect(
        page.getByText(t('settings.aiAccess.switch.changeFailed'), {
          exact: true,
        }),
      ).toBeVisible();
      await expectAccessible(
        page,
        'the notice that AI access could not be changed',
        mode,
      );
      await page.unroute('**/api/settings');
      await api.updateSettings({ mcpEnabled: false });

      // The tooltip of the rail (a computer has a rail).
      if (mode.layout.name === 'desktop') {
        await page.goto('/sessions');
        await page
          .getByRole('link', {
            name: t('navigation.sections.proxies'),
            exact: true,
          })
          .hover();
        await expect(page.getByRole('tooltip')).toBeVisible();
        await expectAccessible(page, 'a tooltip of the rail', mode);
        await page.mouse.move(700, 400, { steps: 5 });
      }
    });
  });
});

// =============================================================================
// Structure
// =============================================================================

test.describe('Landmarks and headings', () => {
  for (const layout of LAYOUTS) {
    test(`every page has one main, a navigation and one h1 (${layout.name})`, async ({
      page,
      api,
      control,
    }) => {
      await page.setViewportSize(layout.viewport);
      const { running, stopped, failed } = await sessionsInEveryState(
        api,
        control,
      );
      const pages: Array<[string, string]> = [
        ['/sessions', t('sessions.panel.title')],
        [`/sessions/${running.id}`, running.name],
        [`/sessions/${stopped.id}`, stopped.name],
        [`/sessions/${failed.id}`, failed.name],
        ['/sessions/999999', t('viewer.title')],
        ['/nowhere/at/all', t('navigation.notFound.title')],
        ['/proxies', t('proxies.title')],
        ['/secrets', t('navigation.sections.secrets')],
        ['/settings/general', t('settings.pages.general.title')],
        ['/settings/appearance', t('settings.pages.appearance.title')],
        ['/settings/ai-access', t('settings.pages.aiAccess.title')],
      ];
      if (layout.name === 'phone') {
        pages.push(['/settings', t('navigation.sections.settings')]);
      }

      for (const [path, name] of pages) {
        await page.goto(path);
        await expect(heading1(page, name), path).toBeVisible({
          timeout: TIMEOUT.FIRST_PAINT,
        });
        const found = await landmarksOf(page);
        expect(found.main, `${path}: one main`).toBe(1);
        expect(found.h1, `${path}: one h1`).toBe(1);
        // The rail is the one sidebar; a phone has the tab bar instead.
        expect(found.complementary, `${path}: the sidebar`).toBe(
          layout.name === 'desktop' ? 1 : 0,
        );
        expect(
          found.navigation,
          `${path}: a navigation`,
        ).toBeGreaterThanOrEqual(1);
        // The navigations are told apart by name.
        const names = await page
          .getByRole('navigation')
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute('aria-label') ?? ''),
          );
        expect(
          names.every((label) => label !== ''),
          `${path}: unnamed navigation in ${JSON.stringify(names)}`,
        ).toBe(true);
        expect(new Set(names).size, `${path}: navigations share a name`).toBe(
          names.length,
        );
      }
    });
  }
});

test.describe('The language of the document', () => {
  for (const language of LANGUAGES) {
    test(`says ${language} on every page when ${language} is the language chosen`, async ({
      page,
      api,
      control,
    }) => {
      const { running } = await sessionsInEveryState(api, control);
      await page.addInitScript((chosen) => {
        localStorage.setItem('user-locale', chosen);
      }, language);
      const words: (key: string) => string = tIn[language];

      for (const [path, name] of [
        ['/sessions', words('sessions.panel.title')],
        [`/sessions/${running.id}`, running.name],
        ['/proxies', words('proxies.title')],
        ['/secrets', words('navigation.sections.secrets')],
        ['/settings/general', words('settings.pages.general.title')],
        ['/settings/appearance', words('settings.pages.appearance.title')],
        ['/settings/ai-access', words('settings.pages.aiAccess.title')],
      ] as const) {
        await page.goto(path);
        await expect(heading1(page, name), `${language} ${path}`).toBeVisible({
          timeout: TIMEOUT.FIRST_PAINT,
        });
        expect(
          await page.evaluate(() => document.documentElement.lang),
          `${language} ${path}`,
        ).toBe(language);
      }
    });
  }

  test('follows the language when it is changed in the page', async ({
    page,
  }) => {
    await page.goto('/settings/appearance');
    for (const next of ['de', 'fr', 'en'] as const satisfies Language[]) {
      await languageButton(page, tIn.en)
        .or(languageButton(page, tIn.de))
        .or(languageButton(page, tIn.fr))
        .click();
      await page
        .getByRole('menuitem', {
          name: tIn.en(`languageSwitcher.locales.${next}`),
        })
        .click();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.lang))
        .toBe(next);
    }
  });
});

// =============================================================================
// The keyboard focus is seen
// =============================================================================

test.describe('Focus is visible', () => {
  /** A control the keyboard reaches by Tab, and how to recognise it. */
  interface Target {
    path: string;
    what: string;
    is: (stop: { role: string; name: string }) => boolean;
  }

  /** The Tab key is pressed to the control, then its ring is measured once it has settled. */
  async function expectRing(
    page: Page,
    target: Target,
    scheme: Scheme,
  ): Promise<void> {
    await page.goto(target.path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
    await page.waitForLoadState('networkidle');
    const borders = await borderColoursOfPage(page);
    const stop = await tabTo(page, target.is).catch((error: unknown) => {
      throw new Error(
        `${target.what} on ${target.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    // The ring is drawn after a transition: poll until it has settled.
    await expect
      .poll(
        async () =>
          (await focusIndicatorOfFocused(page, borders[stop.index])).contrast,
        {
          message: `${target.what} (${stop.role} "${stop.name}") shows where the focus is, in ${scheme}`,
        },
      )
      .toBeGreaterThanOrEqual(MIN_FOCUS_CONTRAST);
  }

  for (const scheme of SCHEMES) {
    test.describe(scheme, () => {
      test(`on the rail, the buttons, the fields and the rows of a computer (${scheme})`, async ({
        page,
        api,
        control,
      }) => {
        const { running } = await sessionsInEveryState(api, control);
        await proxiesWorkingAndNot(api, control);
        await secretsOfEveryKind(api, running.id);
        // How to connect an assistant is on the page once AI access is on.
        await api.updateSettings({ mcpEnabled: true });
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize(DESKTOP);

        const targets: Target[] = [
          {
            path: '/sessions',
            what: 'the rail',
            is: (s) =>
              s.role === 'link' && s.name === t('navigation.sections.proxies'),
          },
          {
            path: '/sessions',
            what: 'the logo',
            is: (s) => s.role === 'link' && s.name === APP_NAME,
          },
          {
            path: '/sessions',
            what: 'a row of the list',
            is: (s) => s.role === 'link' && s.name.includes(running.name),
          },
          {
            path: `/sessions/${running.id}`,
            what: 'the stop button of the page',
            is: (s) =>
              s.role === 'button' && s.name === t('viewer.actions.stop'),
          },
          {
            path: `/sessions/${running.id}`,
            what: 'the Show window button of the card',
            is: (s) =>
              s.role === 'button' && s.name === t('viewer.window.show'),
          },
          {
            path: `/sessions/${running.id}`,
            what: 'the Secrets button of the card',
            is: (s) =>
              s.role === 'button' && s.name === t('viewer.secrets.title'),
          },
          {
            path: '/proxies',
            what: 'the search field',
            is: (s) =>
              s.role === 'textbox' &&
              s.name === t('proxies.search.placeholder'),
          },
          {
            path: '/proxies',
            what: 'a button with a label',
            is: (s) =>
              s.role === 'button' && s.name === t('proxies.actions.checkAll'),
          },
          {
            path: '/secrets',
            what: 'the search field',
            is: (s) =>
              s.role === 'textbox' &&
              s.name === t('secrets.table.searchPlaceholder'),
          },
          {
            path: '/secrets',
            what: 'the filter button',
            is: (s) =>
              s.role === 'button' && s.name === t('common.labels.filter'),
          },
          {
            path: '/secrets',
            what: 'the title of a secret',
            is: (s) => s.role === 'button' && s.name === SHOP_TITLE,
          },
          {
            path: '/settings/general',
            what: 'a row of the settings panel',
            is: (s) =>
              s.role === 'link' &&
              s.name === t('settings.pages.appearance.title'),
          },
          {
            path: '/settings/general',
            what: 'the start page field',
            is: (s) =>
              s.role === 'textbox' &&
              s.name === t('settings.general.startPage.label'),
          },
          {
            path: '/settings/appearance',
            what: 'a theme choice',
            is: (s) => s.role === 'radio',
          },
          {
            path: '/settings/appearance',
            what: 'the language button',
            is: (s) =>
              s.role === 'button' &&
              s.name.startsWith(t('languageSwitcher.ariaLabel')),
          },
          {
            path: '/settings/ai-access',
            what: 'the AI access switch',
            is: (s) => s.role === 'switch',
          },
          {
            path: '/settings/ai-access',
            what: 'the address to copy',
            is: (s) =>
              s.role === 'button' &&
              s.name.startsWith(t('settings.aiAccess.connect.address')),
          },
          {
            path: '/settings/ai-access',
            what: 'a tab of the assistants',
            is: (s) => s.role === 'tab',
          },
          {
            path: '/settings/ai-access',
            what: 'the copy button of a snippet',
            is: (s) =>
              s.role === 'button' &&
              s.name === t('settings.aiAccess.connect.copyCommand'),
          },
          {
            path: '/settings/ai-access',
            what: 'the summary of a group of tools',
            is: (s) =>
              s.name.includes(t('settings.aiAccess.tools.overview.title')),
          },
        ];

        for (const target of targets) await expectRing(page, target, scheme);
      });

      test(`on the tab bar and the list of pages of a phone (${scheme})`, async ({
        page,
        api,
        control,
      }) => {
        await sessionsInEveryState(api, control);
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize(PHONE);

        const targets: Target[] = [
          {
            path: '/sessions',
            what: 'a tab',
            is: (s) =>
              s.role === 'button' &&
              s.name === t('navigation.sections.proxies'),
          },
          {
            path: '/settings',
            what: 'a row of the list of pages',
            is: (s) =>
              s.role === 'link' &&
              s.name.startsWith(t('settings.pages.appearance.title')),
          },
        ];
        for (const target of targets) await expectRing(page, target, scheme);
      });
    });
  }

  test('the indicator is measured against something that does not have one', async ({
    page,
  }) => {
    // A control that has lost its focus ring would read as no mark at all.
    await page.goto('/settings/general');
    await expect(startPageField(page)).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
    await page.addStyleTag({
      content:
        'button, a, input { outline: none !important; box-shadow: none !important; border-color: transparent !important; }',
    });
    await tabTo(
      page,
      (stop) =>
        stop.role === 'link' && stop.name === t('navigation.sections.sessions'),
    );
    expect((await focusIndicatorOfFocused(page)).contrast).toBeLessThan(
      MIN_FOCUS_CONTRAST,
    );
    expect(await focusedStop(page)).not.toBeNull();
  });
});

// =============================================================================
// Motion
// =============================================================================

test.describe('Reduced motion', () => {
  test('leaves nothing running that the page does not need, while the same states move for those who want motion', async ({
    page,
    api,
    control,
  }) => {
    const { stopped } = await sessionsInEveryState(api, control);
    const starting = await api.stopSession(
      (await api.startSession('delta')).id,
    );
    await api.addProxies(1);
    const checking = (await api.proxies()).find(
      (proxy) => proxy.session === null,
    );
    expect(checking).toBeDefined();
    await showSessionPatches(
      page,
      new Map([[starting.id, { status: 'starting', activity: 'launching' }]]),
    );
    await showProxiesChecking(page, new Set(checking ? [checking.id] : []));

    // The page's reads of the sessions wait for the test to let them through,
    // so that the masks that stand for rows while they load can be seen.
    let letThrough: () => void = () => undefined;
    let gate = Promise.resolve();
    await page.route('**/api/sessions?**', async (route) => {
      await gate;
      await route.fallback();
    });

    const movement = async (reduced: boolean) => {
      await page.emulateMedia({
        reducedMotion: reduced ? 'reduce' : 'no-preference',
      });
      const seen = new Set<string>();
      // Something that goes on for ever, or lasts longer than a blink.
      const watch = async () => {
        for (const animation of await runningAnimations(page)) {
          if (
            animation.iterations === Number.POSITIVE_INFINITY ||
            animation.duration > 1
          ) {
            seen.add(`${animation.kind} ${animation.name}`);
          }
        }
      };

      // Rows that are still on their way: masks in their place.
      gate = new Promise<void>((resolve) => {
        letThrough = resolve;
      });
      await page.goto('/sessions');
      await expect(page.locator('[data-skeleton-mask]').first()).toBeVisible();
      await watch();
      letThrough();
      await expect(page.locator('[data-skeleton-mask]')).toHaveCount(0);

      // A session that is starting, and a proxy that is being checked.
      await page.goto(`/sessions/${starting.id}`);
      await expect(
        page
          .getByRole('status')
          .filter({ hasText: t('sessions.status.starting') }),
      ).toBeVisible();
      await watch();
      await page.goto('/proxies');
      await expect(
        page.getByText(t('proxies.health.checking')).first(),
      ).toBeVisible();
      await watch();

      // Moving about: the rail's pill, a dialog, a menu.
      await page
        .getByRole('link', {
          name: t('navigation.sections.sessions'),
          exact: true,
        })
        .click();
      await watch();
      await page.getByRole('button', { name: t('sessions.panel.add') }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await watch();
      await page.keyboard.press('Escape');
      await openRowMenu(page, stopped.name);
      await watch();
      await page.keyboard.press('Escape');
      return [...seen];
    };

    expect(
      await movement(false),
      'with motion allowed, these states move',
    ).not.toEqual([]);
    expect(
      await movement(true),
      'with motion reduced, nothing keeps moving',
    ).toEqual([]);
  });

  test('the sliding highlights glide for those who allow motion, and do not for those who reduce it', async ({
    page,
  }) => {
    await page.goto('/sessions');
    await expect(
      page.getByRole('navigation', { name: t('navigation.aria.main') }),
    ).toBeVisible();

    // Clicks the link in the page and looks at what is moving two frames later.
    const glidesAfterClickingProxies = () =>
      page.evaluate(
        () =>
          new Promise<number[]>((resolve) => {
            document
              .querySelector<HTMLElement>('aside a[href="/proxies"]')
              ?.click();
            requestAnimationFrame(() =>
              requestAnimationFrame(() =>
                resolve(
                  document
                    .getAnimations()
                    .filter(
                      (animation) =>
                        animation instanceof CSSTransition &&
                        animation.transitionProperty === 'transform',
                    )
                    .map((animation) =>
                      Number(animation.effect?.getComputedTiming().duration),
                    ),
                ),
              ),
            );
          }),
      );

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const glides = await glidesAfterClickingProxies();
    expect(
      glides.some((duration) => duration > 100),
      `a glide of a few hundred milliseconds, saw ${JSON.stringify(glides)}`,
    ).toBe(true);

    await page.goto('/sessions');
    await expect(
      page.getByRole('navigation', { name: t('navigation.aria.main') }),
    ).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await glidesAfterClickingProxies();
    for (const duration of reduced) expect(duration).toBeLessThanOrEqual(1);
  });
});

// =============================================================================
// Colour is not the only message
// =============================================================================

test.describe('Not by colour alone', () => {
  test("a session's state is in its name for assistive technology", async ({
    page,
    api,
    control,
  }) => {
    const { running, stopped, failed } = await sessionsInEveryState(
      api,
      control,
    );
    await page.goto('/sessions');
    const list = sessionList(page);
    for (const [session, status] of [
      [running, t('sessions.status.running')],
      [stopped, t('sessions.status.stopped')],
      [failed, t('sessions.status.error')],
    ] as const) {
      const row = list.getByRole('link', {
        name: new RegExp(`\\b${session.name}\\b`),
      });
      await expect(row, session.name).toHaveAccessibleName(
        new RegExp(literally(status).source),
      );
    }
  });

  test('the health of a proxy is a word, and so is whether it is free', async ({
    page,
    api,
    control,
  }) => {
    await sessionsInEveryState(api, control);
    await proxiesWorkingAndNot(api, control);
    await page.goto('/proxies');
    await expect(page.getByRole('table')).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
    for (const word of [
      t('proxies.health.ok'),
      t('proxies.health.failed'),
      t('proxies.session.free'),
    ]) {
      await expect(
        page
          .getByRole('cell', { name: new RegExp(literally(word).source) })
          .first(),
        word,
      ).toBeVisible();
    }
  });
});
