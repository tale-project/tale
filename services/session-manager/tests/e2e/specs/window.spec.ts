import type { Page } from '@playwright/test';
import { collectConsoleErrors } from '@tale/e2e/smoke';

import type { Session } from '../../../lib/api/schemas';
import type { AppApi } from '../helpers/api';
import { TIMEOUT } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { fill, literally, t } from '../helpers/i18n';
import { animationsDone } from '../helpers/nav-a11y';
import { expectDetails } from '../helpers/sessions-details';
import {
  SessionsPage,
  plural,
  quoted,
  sessionIdOf,
} from '../helpers/sessions-page';
import {
  API_SENTENCE,
  changeSessionsOnTheWire,
  lineOf,
  refuseWrites,
  stoppedSession,
  type Refusal,
} from '../helpers/sessions-scene';
import { tIn, tabTitle } from '../helpers/settings-i18n';
import { McpClient } from '../helpers/settings-mcp';
import {
  SessionWindow,
  boxOf,
  everythingShown,
  secretsPopover,
  tabUntil,
  typeButton,
} from '../helpers/window-page';

// The page of a running session (`/sessions/:id`). Its browser is a window of
// its own on the person's screen, where they use it; the page is a card that
// brings that window to the front (Show window), types the value of a secret
// into the field they clicked in it (Secrets), and has the details of the
// session. A session that comes up from the page (added, started, restarted,
// moved to another proxy) comes up in front; one an assistant starts does not.
//
// The fake browser opens no window: what the page did to it is read from the
// control server (`SessionWindow`), `['toFront']` for each time it was brought
// to the front and `['text', value]` for a value typed into it. A session made
// through `api` was added through the page's API, so its window has come to
// the front once already. Labels come from the catalogs through `t()`.

/** Opens the page of a running session and waits for the card of its window. */
async function openCard(
  sessions: SessionsPage,
  session: Session,
): Promise<void> {
  await sessions.openSession(session.id, session.name);
  await expect(sessions.windowCard).toBeVisible({
    timeout: TIMEOUT.BACKGROUND,
  });
}

/** The request the page sends for an action on the window of a session. */
function windowRequest(page: Page, id: number, action: 'show' | 'type') {
  return page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      new URL(request.url()).pathname === `/api/sessions/${id}/${action}`,
  );
}

test.describe('the card of a running session', () => {
  test('shows the session, where it exits, and the card: what it is, Show window, Secrets and the details', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await openCard(sessions, alpha);

    await expect(sessions.titleOf('Alpha')).toBeVisible();
    await expect(sessions.headerState('running')).toBeVisible();
    await expect(sessions.exitChip(lineOf(alpha))).toBeVisible();
    await expect(sessions.headerStop).toBeEnabled();

    // What the card is about, and the two ways to the window.
    await expect(
      sessions.windowCard.getByText(t('viewer.window.description'), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(sessions.showWindowButton).toBeEnabled();
    await expect(sessions.secretsButton).toBeEnabled();
    // Secrets says its word, and is named after what it opens.
    await expect(sessions.secretsButton).toHaveText(t('viewer.secrets.button'));
    // The card ends with the details of the session.
    await expect(sessions.detailsHeading).toBeVisible();
    await expectDetails(sessions.pageDetails, alpha);
    // The browser is the window: nothing of it is drawn in the page.
    await expect(page.getByRole('application')).toHaveCount(0);
    await expect(page.locator('canvas')).toHaveCount(0);
    // The tab of the browser names the session, so that several open ones stay apart.
    await expect(page).toHaveTitle(tabTitle('Alpha'));
  });

  test('Show window brings the window of the session to the front, and says nothing else', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await api.startSession('Alpha');
    const window = new SessionWindow(control, 'Alpha');
    await window.expectShown(1);
    const sessions = new SessionsPage(page);
    await openCard(sessions, alpha);

    const asked = windowRequest(page, alpha.id, 'show');
    await sessions.showWindowButton.click();

    const request = await asked;
    expect((await request.response())?.status()).toBe(204);
    await window.expectShown(2);
    expect(await window.typed()).toEqual([]);
    // The window is the answer: the page says nothing, and stays as it was.
    await expect(sessions.toast(/./)).toHaveCount(0);
    await expect(sessions.showWindowButton).toBeEnabled();
    await expect(sessions.showWindowButton).not.toHaveAttribute('aria-busy');
    await expect(page).toHaveURL(new RegExp(`/sessions/${alpha.id}$`));
  });

  test('Show window for a session that stopped meanwhile says so in a toast, in the words of the page', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    // The page goes on believing that the session runs; the manager knows better.
    await changeSessionsOnTheWire(page, (session) =>
      session.id === alpha.id
        ? { ...session, status: 'running', activity: null }
        : session,
    );
    const sessions = new SessionsPage(page);
    await openCard(sessions, alpha);
    await api.stopSession(alpha.id);

    await sessions.showWindowButton.click();

    const toast = sessions.toast(t('errors.session_not_running'));
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(t('sessions.toasts.showFailed'));
  });

  test('Show window that the browser could not do says why, in a toast', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await api.startSession('Alpha');
    await refuseWrites(page, /\/api\/sessions\/\d+\/show$/, {
      status: 502,
      error: 'browser_error',
      extra: { reason: 'the window is gone' },
    });
    const sessions = new SessionsPage(page);
    await openCard(sessions, alpha);

    await sessions.showWindowButton.click();

    const toast = sessions.toast(
      fill(t('errors.browser_error_reason'), { reason: 'the window is gone' }),
    );
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(t('sessions.toasts.showFailed'));
    await expect(page.getByText(API_SENTENCE)).toHaveCount(0);
    expect(await new SessionWindow(control, 'Alpha').shown()).toBe(1);
  });

  test('another session of the list has a card of its own: its Show window brings its own window, not the one before', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await api.startSession('Alpha');
    const bravo = await api.startSession('Bravo');
    const first = new SessionWindow(control, 'Alpha');
    const second = new SessionWindow(control, 'Bravo');
    await second.expectShown(1);
    const sessions = new SessionsPage(page);
    await openCard(sessions, alpha);

    await sessions.rowLink('Bravo').click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${bravo.id}$`));
    await expect(sessions.titleOf('Bravo')).toBeVisible();
    await sessions.showWindowButton.click();

    await second.expectShown(2);
    expect(await first.shown()).toBe(1);
  });

  test('renaming the session from its page keeps its window: nothing is closed or opened again', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await api.startSession('Alpha');
    const window = new SessionWindow(control, 'Alpha');
    await window.expectShown(1);
    const sessions = new SessionsPage(page);
    await openCard(sessions, alpha);

    await sessions.pageMenuButton('Alpha').click();
    await sessions.menuItem('Alpha', 'rename').click();
    const field = sessions.renameDialog.getByRole('textbox', {
      name: t('sessions.rename.label'),
      exact: true,
    });
    await field.fill('Renamed');
    await field.press('Enter');
    await expect(sessions.renameDialog).toBeHidden();

    await expect(sessions.titleOf('Renamed')).toBeVisible();
    await expect(page).toHaveTitle(tabTitle('Renamed'));
    await expect(sessions.windowCard).toBeVisible();
    expect(await api.session(alpha.id)).toMatchObject({
      name: 'Renamed',
      status: 'running',
    });
    // The browser it had, told nothing new; none was launched under the new name.
    expect(await window.state()).toMatchObject({
      closed: false,
      events: [['toFront']],
    });
    await expect(control.browser('Renamed')).rejects.toThrow(/404/);
  });

  test('deleted from its own page, it closes its window and leaves for the list with nothing logged, the keyboard on the main area though the list is slow to come', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await api.startSession('Alpha');
    const errors = collectConsoleErrors(page);
    const sessions = new SessionsPage(page);
    await openCard(sessions, alpha);
    await sessions.pageMenuButton('Alpha').click();
    await sessions.menuItem('Alpha', 'delete').click();
    const dialog = sessions.deleteDialog('Alpha');
    await expect(dialog).toContainText(
      t('sessions.delete.descriptionBrowserOpen'),
    );
    // The code of the page that comes next is held back until the dialog has
    // gone, the order in which the keyboard used to be lost.
    let release!: () => void;
    const dialogGone = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/assets/*.js', async (route) => {
      await dialogGone;
      await route.continue();
    });

    await sessions.button(dialog, t('sessions.delete.confirm')).click();
    await expect(dialog).toBeHidden();
    release();

    await expect(page).toHaveURL(/\/sessions$/);
    await expect(page.getByRole('main')).toBeFocused();
    expect(await api.sessions()).toEqual([]);
    expect((await control.browser('Alpha')).closed).toBe(true);
    // The page did not ask again for the session it had deleted.
    expect(errors).toEqual([]);
  });
});

test.describe('the page of a running session while it is read', () => {
  test('shows a placeholder while the session is read, then the card of its window', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    let release!: () => void;
    const answer = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/api/sessions/${alpha.id}`, async (route) => {
      await answer;
      await route.continue();
    });
    const sessions = new SessionsPage(page);

    await page.goto(`/sessions/${alpha.id}`);

    // The header and the card stand masked, each as a status of its own: both are read out.
    const placeholder = page.getByRole('status', { name: t('viewer.loading') });
    await expect(placeholder).toHaveCount(2);
    await expect(placeholder.first()).toBeVisible();
    await expect(sessions.windowCard).toHaveCount(0);
    await expect(sessions.headerButton).toHaveCount(0);

    release();
    await expect(sessions.windowCard).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await expect(placeholder).toHaveCount(0);
  });

  test('says when the session cannot be read, and shows its card when the person tries again', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const address = `**/api/sessions/${alpha.id}`;
    await page.route(address, (route) => route.abort('failed'));
    const sessions = new SessionsPage(page);
    const failed = page.getByRole('heading', {
      level: 2,
      name: t('viewer.loadFailed.title'),
    });

    await page.goto(`/sessions/${alpha.id}`);

    await expect(failed).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    // The page is named by its own title: there is no session to name.
    await expect(sessions.titleOf(t('viewer.title'))).toBeVisible();
    // Beside a Try again the words do not say it twice: a network failure has no sentence of its own.
    await expect(page.getByText(t('errors.network'))).toHaveCount(0);
    await expect(sessions.windowCard).toHaveCount(0);
    // While nothing was read, the header does not go on saying it is loading.
    await expect(
      page.getByRole('status', { name: t('viewer.loading') }),
    ).toHaveCount(0);

    await page.unroute(address);
    await page
      .getByRole('button', { name: t('common.actions.tryAgain') })
      .click();

    await expect(sessions.windowCard).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await expect(failed).toHaveCount(0);
    // The button that had the keyboard is gone: it goes to the title of the page.
    await expect(sessions.titleOf('Alpha')).toBeFocused();
  });
});

test.describe('the menu of a session', () => {
  test('leads with Show window for a running session, in its row and in the header of its page, and it brings the window to the front', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await api.startSession('Alpha');
    const window = new SessionWindow(control, 'Alpha');
    await window.expectShown(1);
    const sessions = new SessionsPage(page);
    await sessions.open();

    // The row's menu: Show window first, and it can be chosen.
    await sessions.openMenu('Alpha');
    await expect(
      sessions.menu('Alpha').getByRole('menuitem').first(),
    ).toHaveAccessibleName(t('sessions.menu.showWindow'));
    const asked = windowRequest(page, alpha.id, 'show');
    await sessions.menuItem('Alpha', 'showWindow').click();
    await asked;
    await expect(sessions.menu('Alpha')).toBeHidden();
    await window.expectShown(2);
    // The window came; the page stays where it was.
    await expect(page).toHaveURL(/\/sessions$/);

    // The same from the header of its page.
    await sessions.rowLink('Alpha').click();
    await expect(sessions.windowCard).toBeVisible();
    await sessions.pageMenuButton('Alpha').click();
    await expect(
      sessions.menu('Alpha').getByRole('menuitem').first(),
    ).toHaveAccessibleName(t('sessions.menu.showWindow'));
    await sessions.menuItem('Alpha', 'showWindow').click();
    await window.expectShown(3);
    expect(await window.typed()).toEqual([]);
  });

  test('has Show window off for a session that is not running, and says why', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await stoppedSession(api, 'Alpha');
    await api.addProxies(1);
    await control.faults({ launchError: 'The browser could not start.' });
    const created = await api.createSession('Bravo');
    await api.waitForStatus(created.id, 'error');
    await control.clear();
    const shows: string[] = [];
    page.on('request', (request) => {
      if (/\/api\/sessions\/\d+\/show$/.test(new URL(request.url()).pathname)) {
        shows.push(request.url());
      }
    });
    const sessions = new SessionsPage(page);
    await sessions.open();

    for (const name of ['Alpha', 'Bravo']) {
      await sessions.openMenu(name);
      const show = sessions.menuItem(name, 'showWindow');
      await expect(show, name).toBeDisabled();
      await expect(show, name).toContainText(
        t('sessions.menu.showWindowOnlyRunning'),
      );
      await page.keyboard.press('Escape');
      await expect(sessions.menu(name)).toBeHidden();
    }

    // The header of a stopped session's page says the same.
    await sessions.rowLink('Alpha').click();
    await expect(sessions.titleOf('Alpha')).toBeVisible();
    await sessions.pageMenuButton('Alpha').click();
    await expect(sessions.menuItem('Alpha', 'showWindow')).toBeDisabled();
    expect(shows).toEqual([]);
    expect((await api.session(alpha.id)).status).toBe('stopped');
  });
});

test.describe('the window comes to the front when the page brings it up', () => {
  test('a session added on the page comes up in front', async ({
    page,
    api,
    control,
  }) => {
    await api.addProxies(1);
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.add({ name: 'Alpha' });

    await expect(page).toHaveURL(/\/sessions\/\d+$/);
    await api.waitForStatus(sessionIdOf(page.url()), 'running');
    await expect(sessions.windowCard).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    // Told one thing since it came up: to come to the front.
    await new SessionWindow(control, 'Alpha').expectEvents([['toFront']]);
  });

  test('Start, Restart and Rotate IP on the page each bring the window that comes up to the front', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await stoppedSession(api, 'Alpha');
    // The proxy that Rotate IP moves the session to.
    await api.addProxies(1);
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);
    const window = new SessionWindow(control, 'Alpha');

    // A browser that has just come up has been told one thing: to come to the
    // front. Shown once more by hand, it is told apart from the next one.
    const cameUpInFront = async () => {
      await window.expectEvents([['toFront']]);
      await expect(sessions.windowCard).toBeVisible({
        timeout: TIMEOUT.BACKGROUND,
      });
      await sessions.showWindowButton.click();
      await window.expectEvents([['toFront'], ['toFront']]);
    };

    await sessions.headerStart.click();
    await cameUpInFront();

    await sessions.pageMenuButton('Alpha').click();
    await sessions.menuItem('Alpha', 'restart').click();
    await sessions
      .button(sessions.restartDialog('Alpha'), t('sessions.restart.confirm'))
      .click();
    await cameUpInFront();

    await sessions.pageMenuButton('Alpha').click();
    await sessions.menuItem('Alpha', 'rotate').click();
    await sessions
      .button(sessions.rotateDialog('Alpha'), t('sessions.rotate.confirm'))
      .click();
    await cameUpInFront();
    expect((await api.session(alpha.id)).proxy?.id).not.toBe(alpha.proxy?.id);
  });

  test('a session an assistant starts stays out of the way, until the assistant shows its window', async ({
    request,
    api,
    control,
  }) => {
    await api.updateSettings({ mcpEnabled: true });
    await api.addProxies(1);
    const mcp = new McpClient(request);
    await mcp.initialize();

    const created = await mcp.call('create_session', { name: 'Alpha' });
    expect(created.isError, created.text).toBe(false);
    const window = new SessionWindow(control, 'Alpha');
    expect(await window.state()).toMatchObject({ closed: false, events: [] });

    const shown = await mcp.call('show_window', { session: 'Alpha' });
    expect(shown.isError, shown.text).toBe(false);
    await window.expectEvents([['toFront']]);
  });
});

test.describe('secrets typed into the window', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  const PASSWORD = 'hunter2 / s3cret ü';
  /** The name of the button that adds a secret for the session. */
  const addLabel = (name: string) =>
    fill(t('viewer.secrets.add'), { name: quoted(name) });

  /** A session with one secret of its own, one for every session, and one of another session. */
  async function setUp(api: AppApi): Promise<Session> {
    const session = await api.startSession('alpha');
    const other = await api.startSession('beta');
    await api.createSecret({
      kind: 'credentials',
      title: 'Shop login',
      sessionId: session.id,
      fields: [
        { label: 'Website', value: 'https://shop.example.com' },
        { label: 'Username', value: 'ada@example.com' },
        { label: 'Password', value: PASSWORD },
      ],
    });
    await api.createSecret({
      kind: 'personal',
      title: 'My details',
      fields: [
        { label: 'Name', value: 'Ada Lovelace' },
        { label: 'Email', value: 'ada@lovelace.test' },
      ],
    });
    await api.createSecret({
      kind: 'note',
      title: 'Beta only note',
      sessionId: other.id,
      fields: [{ label: 'Note', value: 'only for the other session' }],
    });
    return session;
  }

  /** Opens the card of the session and its Secrets, and waits for the list. */
  async function openSecrets(page: Page, session: Session) {
    const sessions = new SessionsPage(page);
    await openCard(sessions, session);
    await sessions.secretsButton.click();
    const popover = secretsPopover(page);
    await expect(popover).toBeVisible();
    return { sessions, popover };
  }

  test('lists the secrets of this session and those of every session in groups by kind, and none of another session', async ({
    page,
    api,
  }) => {
    const session = await setUp(api);
    // Newer than the login of the shop, and of the same kind.
    await api.createSecret({
      kind: 'credentials',
      title: 'Bank login',
      sessionId: session.id,
      fields: [{ label: 'Username', value: 'ada@bank.example' }],
    });

    const { popover } = await openSecrets(page, session);

    // The groups are in the order of the kinds, the secrets of a group newest first.
    await expect(popover.getByRole('region')).toHaveCount(2);
    expect(
      await popover
        .getByRole('region')
        .evaluateAll((groups) =>
          groups.map((group) => group.getAttribute('aria-label')),
        ),
    ).toEqual([t('secrets.kinds.personal'), t('secrets.kinds.credentials')]);
    const mine = popover.getByRole('button', { name: /Shop login/ });
    const everyones = popover.getByRole('button', { name: /My details/ });
    // Once the list is there the keyboard is on its first secret, where Tab would take it next.
    await expect(everyones).toBeFocused();
    // A row is named by its title alone; whose it is, and what it holds, is its description.
    await expect(mine).toHaveAccessibleName('Shop login');
    await expect(mine).toHaveAccessibleDescription(
      new RegExp(`^${t('viewer.secrets.forThis')}`),
    );
    const newer = await boxOf(
      popover.getByRole('button', { name: /Bank login/ }),
    );
    const older = await boxOf(mine);
    expect(newer.y).toBeLessThan(older.y);
    await expect(mine).toContainText(t('viewer.secrets.forThis'));
    await expect(everyones).toContainText(t('viewer.secrets.forEvery'));
    // What lists show of a secret: a preview, without a masked value.
    await expect(mine).toContainText('https://shop.example.com');
    await expect(popover).not.toContainText(PASSWORD);
    await expect(popover).not.toContainText('Beta only note');
    await expect(popover).not.toContainText(t('secrets.kinds.note'));
    await expect(
      popover.getByRole('link', { name: t('viewer.secrets.manage') }),
    ).toHaveAttribute('href', '/secrets');
  });

  test('typing a value puts it, exact, into the field of the window, then brings the window to the front, and never shows a masked one on the screen', async ({
    page,
    api,
    control,
  }) => {
    const session = await setUp(api);
    const window = new SessionWindow(control, session.name);
    await window.expectEvents([['toFront']]);
    const { sessions, popover } = await openSecrets(page, session);
    await popover.getByRole('button', { name: /Shop login/ }).click();

    // Opened, the secret shows its fields; the password is dots, named for a screen reader.
    await expect(
      popover.getByText('ada@example.com', { exact: true }),
    ).toBeVisible();
    await expect(
      popover.getByText(t('viewer.secrets.maskedValue')),
    ).toHaveCount(1);
    expect(await everythingShown(page)).not.toContain(PASSWORD);

    const typed = windowRequest(page, session.id, 'type');
    await typeButton(popover, 'Password').click();

    await expect(popover).toBeHidden();
    expect((await typed).postDataJSON()).toEqual({ text: PASSWORD });
    // Typed into the field, then the window came to the front, where the person goes on.
    await window.expectEvents([['toFront'], ['text', PASSWORD], ['toFront']]);
    // It went to the window as text; it is not on the screen of the manager.
    expect(await everythingShown(page)).not.toContain(PASSWORD);
    await expect(sessions.toast(/./)).toHaveCount(0);
    // The keyboard is back on the button that opened the list.
    await expect(sessions.secretsButton).toBeFocused();
  });

  test('a value is typed only into a field that has the focus: the toast says why, and the window stays where it is', async ({
    page,
    api,
    control,
  }) => {
    const session = await setUp(api);
    const window = new SessionWindow(control, session.name);
    await window.expectShown(1);
    await control.focusField(session.name, false);
    const { sessions, popover } = await openSecrets(page, session);
    await popover.getByRole('button', { name: /Shop login/ }).click();

    await typeButton(popover, 'Username').click();

    await expect(popover).toBeHidden();
    const toast = sessions.toast(t('errors.no_field_focused'));
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(t('sessions.toasts.typeFailed'));
    // Nothing went in, and the window was not brought up for it.
    expect(await window.typed()).toEqual([]);
    expect(await window.shown()).toBe(1);

    // Once the person has clicked a field in the window, the same value goes
    // in. The list opens anew, its secrets closed.
    await control.focusField(session.name, true);
    await sessions.secretsButton.click();
    await popover.getByRole('button', { name: /Shop login/ }).click();
    await typeButton(popover, 'Username').click();
    await window.expectEvents([
      ['toFront'],
      ['text', 'ada@example.com'],
      ['toFront'],
    ]);
  });

  const refusals: Array<{
    title: string;
    refusal: Refusal;
    says: () => string;
  }> = [
    {
      title: 'a browser that could not do it',
      refusal: {
        status: 502,
        error: 'browser_error',
        extra: { reason: 'the page went away' },
      },
      says: () =>
        fill(t('errors.browser_error_reason'), {
          reason: 'the page went away',
        }),
    },
    {
      title: 'a browser that does not answer',
      refusal: { status: 504, error: 'browser_not_responding' },
      says: () => t('errors.browser_not_responding'),
    },
    {
      title: 'a session that is no longer running',
      refusal: { status: 409, error: 'session_not_running' },
      says: () => t('errors.session_not_running'),
    },
  ];

  for (const { title, refusal, says } of refusals) {
    test(`${title}: a value that could not be typed is told in a toast, in the page’s words, and the window is not brought up`, async ({
      page,
      api,
      control,
    }) => {
      const session = await setUp(api);
      const window = new SessionWindow(control, session.name);
      await window.expectShown(1);
      await refuseWrites(page, /\/api\/sessions\/\d+\/type$/, refusal);
      const { sessions, popover } = await openSecrets(page, session);
      await popover.getByRole('button', { name: /Shop login/ }).click();

      await typeButton(popover, 'Username').click();

      const toast = sessions.toast(says());
      await expect(toast).toBeVisible();
      await expect(toast).toContainText(t('sessions.toasts.typeFailed'));
      await expect(page.getByText(API_SENTENCE)).toHaveCount(0);
      expect(await window.shown()).toBe(1);
      expect(await window.typed()).toEqual([]);
    });
  }

  test('a masked value is shown only while its eye is pressed, and copying it neither shows it nor types it', async ({
    page,
    api,
    control,
  }) => {
    const session = await setUp(api);
    const { popover } = await openSecrets(page, session);
    await popover.getByRole('button', { name: /Shop login/ }).click();
    const eye = popover.getByRole('button', {
      name: fill(t('viewer.secrets.show'), { label: 'Password' }),
    });

    await expect(eye).toHaveAttribute('aria-pressed', 'false');
    await eye.click();
    await expect(eye).toHaveAttribute('aria-pressed', 'true');
    await expect(popover.getByText(PASSWORD, { exact: true })).toBeVisible();
    await eye.click();
    await expect(eye).toHaveAttribute('aria-pressed', 'false');
    await expect(popover.getByText(PASSWORD, { exact: true })).toHaveCount(0);
    expect(await everythingShown(page)).not.toContain(PASSWORD);

    await popover
      .getByRole('button', {
        name: fill(t('viewer.secrets.copy'), { label: 'Password' }),
      })
      .click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
        timeout: TIMEOUT.VISIBLE,
      })
      .toBe(PASSWORD);
    expect(await everythingShown(page)).not.toContain(PASSWORD);
    // Copying is not typing: nothing went to the window.
    expect(await new SessionWindow(control, session.name).typed()).toEqual([]);
  });

  test('the whole text of a long value is typed, though the list shows its first line', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const note =
      'First line of the note\nSecond line\n\tThird, indented — ünïcode';
    await api.createSecret({
      kind: 'note',
      title: 'Long note',
      sessionId: session.id,
      fields: [{ label: 'Note', value: note }],
    });
    const { popover } = await openSecrets(page, session);
    await popover.getByRole('button', { name: /Long note/ }).click();

    // The field shows its first line and says how many more it has (the preview above it runs the lines together).
    await expect(
      popover.getByText('First line of the note', { exact: true }),
    ).toBeVisible();
    await expect(
      popover.getByText(plural(t('viewer.secrets.moreLines'), 2), {
        exact: true,
      }),
    ).toBeVisible();
    await typeButton(popover, 'Note').click();

    await new SessionWindow(control, session.name).expectEvents([
      ['toFront'],
      ['text', note],
      ['toFront'],
    ]);
  });

  test('a secret with markup in its words is shown as text and typed as it is', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const title = '<i>Italic</i> & "quotes"';
    const value = '<b>bold</b> & <script>alert(1)</script>';
    await api.createSecret({
      kind: 'note',
      title,
      sessionId: session.id,
      fields: [{ label: 'Note', value }],
    });
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    const { popover } = await openSecrets(page, session);

    await popover.getByRole('button', { name: literally(title) }).click();
    // The row's preview line says the same words: the value is the one in the opened secret.
    const opened = popover.getByRole('group', { name: title, exact: true });
    await expect(opened.getByText(value, { exact: true })).toBeVisible();
    await expect(popover.locator('i, b, script')).toHaveCount(0);
    await typeButton(popover, 'Note').click();

    await new SessionWindow(control, session.name).expectEvents([
      ['toFront'],
      ['text', value],
      ['toFront'],
    ]);
    expect(dialogs).toEqual([]);
  });

  const CARD = [
    { label: 'Cardholder', value: 'Ada Lovelace' },
    { label: 'Card number', value: '4242 4242 4242 4242', hidden: true },
    { label: 'Expiry', value: '12/30' },
    { label: 'CVC', value: '123', hidden: true },
  ];

  test('words the kind of a secret and its fields as the page does, whatever the server called them', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    await api.createSecret({
      kind: 'card',
      title: 'Visa',
      sessionId: session.id,
      fields: CARD,
    });
    // The server words a card's date as "Expiry", and the page as the person reads it.
    const expiry = t('secrets.fields.expiry');
    expect(expiry).not.toBe('Expiry');
    const { popover } = await openSecrets(page, session);

    await expect(
      popover.getByRole('region', { name: t('secrets.kinds.card') }),
    ).toBeVisible();
    await popover.getByRole('button', { name: /Visa/ }).click();

    await expect(popover.getByText(expiry, { exact: true })).toBeVisible();
    await expect(popover.getByText('Expiry', { exact: true })).toHaveCount(0);
    for (const key of ['cardholder', 'cardNumber', 'cvc'] as const) {
      await expect(
        popover.getByText(t(`secrets.fields.${key}`), { exact: true }),
      ).toBeVisible();
    }
    // The buttons are named by the words the person reads, and the value that is typed is the one that was stored.
    await typeButton(popover, expiry).click();
    await new SessionWindow(control, session.name).expectEvents([
      ['toFront'],
      ['text', '12/30'],
      ['toFront'],
    ]);
  });

  test.describe('in German', () => {
    test.use({ locale: 'de-DE' });

    test('the list is in the language of the person: its groups, its fields and its buttons', async ({
      page,
      api,
      control,
    }) => {
      const de = tIn.de;
      const session = await api.startSession('alpha');
      await api.createSecret({
        kind: 'card',
        title: 'Visa',
        sessionId: session.id,
        fields: CARD,
      });
      await page.goto(`/sessions/${session.id}`);
      // Named after what it opens, in German.
      await page
        .getByRole('main')
        .getByRole('button', { name: de('viewer.secrets.title'), exact: true })
        .click();

      const popover = page.getByRole('dialog', {
        name: de('viewer.secrets.title'),
      });
      await expect(popover).toBeVisible();
      await expect(
        popover.getByRole('region', { name: de('secrets.kinds.card') }),
      ).toBeVisible();
      const visa = popover.getByRole('button', { name: /Visa/ });
      await expect(visa).toContainText(de('viewer.secrets.forThis'));
      await visa.click();
      for (const key of [
        'cardholder',
        'cardNumber',
        'expiry',
        'cvc',
      ] as const) {
        await expect(
          popover.getByText(de(`secrets.fields.${key}`), { exact: true }),
        ).toBeVisible();
      }
      await expect(
        popover.getByRole('button', {
          name: fill(de('viewer.secrets.add'), {
            name: fill(de('sessions.quoted'), { text: session.name }),
          }),
        }),
      ).toBeVisible();
      await expect(
        popover.getByRole('link', { name: de('viewer.secrets.manage') }),
      ).toHaveAttribute('href', '/secrets');

      await popover
        .getByRole('button', {
          name: fill(de('viewer.secrets.typeLabel'), {
            label: de('secrets.fields.expiry'),
          }),
        })
        .click();
      await new SessionWindow(control, session.name).expectEvents([
        ['toFront'],
        ['text', '12/30'],
        ['toFront'],
      ]);
    });
  });

  test('a long list scrolls inside the popover while its heading and its foot stay where they are', async ({
    page,
    api,
  }) => {
    /** Secrets enough that the list of them does not fit in the popover. */
    const MANY_SECRETS = 15;
    const session = await api.startSession('alpha');
    for (let number = 1; number <= MANY_SECRETS; number += 1) {
      await api.createSecret({
        kind: 'note',
        title: `Note ${number}`,
        sessionId: session.id,
        fields: [{ label: 'Note', value: `text ${number}` }],
      });
    }
    const { popover } = await openSecrets(page, session);
    const heading = popover.getByRole('heading', {
      name: t('viewer.secrets.title'),
    });
    const add = popover.getByRole('button', { name: addLabel(session.name) });
    const manage = popover.getByRole('link', {
      name: t('viewer.secrets.manage'),
    });
    // The secrets lie in a list of their own, which is what scrolls.
    const list = popover
      .getByRole('region')
      .first()
      .locator('xpath=ancestor::div[@role="presentation"][1]');
    await expect(list.getByRole('button')).toHaveCount(MANY_SECRETS);
    await animationsDone(page);
    const before = [
      await boxOf(heading),
      await boxOf(add),
      await boxOf(manage),
    ];
    const sizes = await list.evaluate((element) => ({
      shown: element.clientHeight,
      whole: element.scrollHeight,
    }));
    expect(sizes.whole).toBeGreaterThan(sizes.shown);

    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });

    // The newest secret comes first: the oldest is in reach now, the newest has gone by, and the rest of the popover has not moved.
    await expect(
      popover.getByRole('button', { name: 'Note 1', exact: true }),
    ).toBeInViewport();
    await expect(
      popover.getByRole('button', {
        name: `Note ${MANY_SECRETS}`,
        exact: true,
      }),
    ).not.toBeInViewport();
    expect([
      await boxOf(heading),
      await boxOf(add),
      await boxOf(manage),
    ]).toEqual(before);
    // The whole popover stays on the screen.
    const box = await boxOf(popover);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(
      page.viewportSize()?.height ?? 0,
    );
  });

  test('works by keyboard: open it, choose a secret, type a value, and the keyboard is back on Secrets', async ({
    page,
    api,
    control,
  }) => {
    const session = await setUp(api);
    const sessions = new SessionsPage(page);
    await openCard(sessions, session);
    const popover = secretsPopover(page);

    await sessions.secretsButton.focus();
    await page.keyboard.press('Enter');
    await expect(popover).toBeVisible();
    const secret = popover.getByRole('button', { name: /Shop login/ });
    await tabUntil(page, secret);
    await page.keyboard.press('Enter');
    await expect(secret).toHaveAttribute('aria-expanded', 'true');
    await tabUntil(page, typeButton(popover, 'Username'));
    await page.keyboard.press('Enter');

    await expect(popover).toBeHidden();
    await expect(sessions.secretsButton).toBeFocused();
    // Typed once, and then the window came to the front.
    await new SessionWindow(control, session.name).expectEvents([
      ['toFront'],
      ['text', 'ada@example.com'],
      ['toFront'],
    ]);

    // Escape closes it, and the keyboard goes back to the button that opened it.
    await page.keyboard.press('Space');
    await expect(popover).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(sessions.secretsButton).toBeFocused();
  });

  test('the arrow keys, Home and End move between the secrets of the list, round the ends', async ({
    page,
    api,
    control,
  }) => {
    const session = await setUp(api);
    const { popover } = await openSecrets(page, session);
    const first = popover.getByRole('button', { name: /My details/ });
    const last = popover.getByRole('button', { name: /Shop login/ });
    await expect(last).toBeVisible();
    await animationsDone(page);

    await first.focus();
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(last).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(last).toBeFocused();
    await page.keyboard.press('Home');
    await expect(first).toBeFocused();
    await page.keyboard.press('End');
    await expect(last).toBeFocused();
    // They are the list's keys: nothing went to the window.
    expect(await new SessionWindow(control, session.name).typed()).toEqual([]);
  });

  test('says that there is no secret yet, and offers to add one for the session', async ({
    page,
    api,
  }) => {
    const session = await api.startSession('alpha');

    const { popover } = await openSecrets(page, session);

    await expect(popover).toContainText(t('viewer.secrets.empty'));
    await expect(popover).toContainText(t('viewer.secrets.emptyHint'));
    await expect(
      popover.getByRole('button', { name: addLabel(session.name) }),
    ).toBeVisible();
    // Nothing to manage yet.
    await expect(
      popover.getByRole('link', { name: t('viewer.secrets.manage') }),
    ).toHaveCount(0);
  });

  test("adding a secret for the session opens its form over the page, and the secret is the session's at once", async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const { sessions, popover } = await openSecrets(page, session);

    await popover.getByRole('button', { name: addLabel(session.name) }).click();

    const form = page.getByRole('dialog', {
      name: t('secrets.form.createTitle'),
    });
    await expect(form).toBeVisible();
    // The list has gone with the choice, as a person would see it: they fill the form after that.
    await animationsDone(page);
    // It is for this session unless the person says otherwise.
    await expect(form).toContainText(
      fill(t('secrets.scope.session'), { name: session.name }),
    );
    await form
      .getByRole('textbox', { name: t('secrets.form.title') })
      .fill('Shop login');
    await form
      .getByRole('textbox', { name: t('secrets.fields.username'), exact: true })
      .fill('ada@example.com');
    await form
      .getByRole('button', { name: t('secrets.form.createSubmit') })
      .click();

    await expect(form).toBeHidden();
    await expect(sessions.toast(t('secrets.toasts.created'))).toBeVisible();
    expect(await api.secrets()).toMatchObject([
      { title: 'Shop login', session: { id: session.id } },
    ]);
    // The card was never left, and the keyboard is back on the button that opened the list.
    await expect(sessions.windowCard).toBeVisible();
    await expect(sessions.secretsButton).toBeFocused();

    // The list has the new secret, and its value can be typed.
    await sessions.secretsButton.click();
    await popover.getByRole('button', { name: /Shop login/ }).click();
    await typeButton(popover, 'Username').click();
    await new SessionWindow(control, session.name).expectEvents([
      ['toFront'],
      ['text', 'ada@example.com'],
      ['toFront'],
    ]);
  });

  test('giving up a form with something in it asks first, and nothing is added when it is given up', async ({
    page,
    api,
  }) => {
    const session = await api.startSession('alpha');
    const { sessions, popover } = await openSecrets(page, session);
    await popover.getByRole('button', { name: addLabel(session.name) }).click();
    const form = page.getByRole('dialog', {
      name: t('secrets.form.createTitle'),
    });
    await animationsDone(page);
    const title = form.getByRole('textbox', { name: t('secrets.form.title') });
    await title.fill('Never saved');

    // The first time the person keeps the form...
    const asked: string[] = [];
    page.once('dialog', (dialog) => {
      asked.push(dialog.message());
      void dialog.dismiss();
    });
    await form
      .getByRole('button', { name: t('common.actions.cancel') })
      .click();
    await expect.poll(() => asked).toEqual([t('common.discardChangesConfirm')]);
    await expect(form).toBeVisible();
    await expect(title).toHaveValue('Never saved');

    // ... the second time they give it up.
    page.once('dialog', (dialog) => {
      void dialog.accept();
    });
    await form
      .getByRole('button', { name: t('common.actions.cancel') })
      .click();

    await expect(form).toBeHidden();
    expect(await api.secrets()).toEqual([]);
    await expect(sessions.secretsButton).toBeFocused();
  });

  test('a form with nothing in it is given up without asking', async ({
    page,
    api,
  }) => {
    const session = await api.startSession('alpha');
    const { sessions, popover } = await openSecrets(page, session);
    await popover.getByRole('button', { name: addLabel(session.name) }).click();
    const form = page.getByRole('dialog', {
      name: t('secrets.form.createTitle'),
    });
    await animationsDone(page);
    const asked: string[] = [];
    page.on('dialog', (dialog) => {
      asked.push(dialog.message());
      void dialog.dismiss();
    });

    await page.keyboard.press('Escape');

    await expect(form).toBeHidden();
    expect(asked).toEqual([]);
    await expect(sessions.secretsButton).toBeFocused();
  });
});

test.describe('on a phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  /** The width of the phone (CSS pixels): nothing of the page may lie beyond it. */
  const PHONE_WIDTH = 390;

  test('the header and the card are on the screen: the way back, Stop, the menu, the exit IP, Show window and Secrets', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await openCard(sessions, alpha);
    const controls = {
      back: page.getByRole('link', { name: t('common.aria.back') }),
      stop: sessions.headerStop,
      menu: sessions.pageMenuButton('Alpha'),
      exitIp: sessions.exitChip(lineOf(alpha)),
      showWindow: sessions.showWindowButton,
      secrets: sessions.secretsButton,
    };

    for (const [name, part] of Object.entries(controls)) {
      await expect(part, `${name} is on the screen`).toBeVisible();
      const box = await boxOf(part);
      expect(box.x, `${name} starts on the screen`).toBeGreaterThanOrEqual(0);
      expect(
        box.x + box.width,
        `${name} ends on the screen`,
      ).toBeLessThanOrEqual(PHONE_WIDTH);
    }
    // Nothing makes the page wider than the phone.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(PHONE_WIDTH);
    // The buttons of the card stand above the bar of the app that floats over the page.
    const bar = await boxOf(
      page.getByRole('navigation', { name: t('navigation.aria.primary') }),
    );
    for (const button of [sessions.showWindowButton, sessions.secretsButton]) {
      const box = await boxOf(button);
      expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
    }
  });

  test('a tap on Show window brings the window to the front, and a tap on Type puts a value into it, from a list that fits the screen', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    await api.createSecret({
      kind: 'credentials',
      title: 'Shop login',
      sessionId: session.id,
      fields: [{ label: 'Username', value: 'ada@example.com' }],
    });
    const window = new SessionWindow(control, session.name);
    const sessions = new SessionsPage(page);
    await openCard(sessions, session);

    await sessions.showWindowButton.tap();
    await window.expectEvents([['toFront'], ['toFront']]);

    await sessions.secretsButton.tap();
    const popover = secretsPopover(page);
    await expect(popover).toBeVisible();
    const box = await boxOf(popover);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE_WIDTH);
    await popover.getByRole('button', { name: /Shop login/ }).tap();
    await typeButton(popover, 'Username').tap();

    await expect(popover).toBeHidden();
    await window.expectEvents([
      ['toFront'],
      ['toFront'],
      ['text', 'ada@example.com'],
      ['toFront'],
    ]);
  });

  test('after the arrow of the header the keyboard is on the main area, not at the top of the document', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await openCard(sessions, alpha);

    await page.getByRole('link', { name: t('common.aria.back') }).tap();

    await expect(page).toHaveURL(/\/sessions$/);
    await expect(page.getByRole('main')).toBeFocused();
  });

  test('the session is stopped and started again from its page, and its card comes back', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await openCard(sessions, alpha);

    await sessions.headerStop.tap();
    await expect(sessions.headerStart).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await expect(sessions.windowCard).toHaveCount(0);

    await sessions.headerStart.tap();
    await expect(sessions.windowCard).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await expect(sessions.headerStop).toBeVisible();
  });
});
