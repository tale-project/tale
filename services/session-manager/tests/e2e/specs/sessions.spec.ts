import { readFile } from 'node:fs/promises';

import type { Page } from '@playwright/test';

import { proxyExportSchema } from '../../../lib/api/schemas';
import type { AppApi } from '../helpers/api';
import type { Control } from '../helpers/control';
import { TIMEOUT } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { fill, literally, t } from '../helpers/i18n';
import { detail, expectDetails } from '../helpers/sessions-details';
import {
  describeFocus,
  focusRestsOnAControl,
  isFocusedNode,
} from '../helpers/sessions-focus';
import {
  SessionsPage,
  exitLine,
  plural,
  quoted,
  rowName,
  sessionIdOf,
} from '../helpers/sessions-page';
import {
  API_SENTENCE,
  SESSIONS_PAGE_SIZE,
  SLOW_CHECK_MS,
  SLOW_START_MS,
  changeMetaOnTheWire,
  changeSessionsOnTheWire,
  checkIpOf,
  createSessions,
  hostPortOf,
  importWithCredentials,
  lineOf,
  nameLimitOf,
  refuseWrites,
  renameElsewhere,
  settlePage,
  startAgain,
  stoppedSession,
  stoppedWithoutProxy,
  waitUntilAllRun,
  watchPageProblems,
} from '../helpers/sessions-scene';
import { tIn, tabTitle } from '../helpers/settings-i18n';

/** The first words of the long text a browser failure carries after its first line. */
const CALL_LOG = 'Call log';

// The sessions list and the life of a session, as a person uses them through
// the page: the add dialog, the row buttons and menu, the header of a
// session's page and the details its chip opens, the questions the page asks,
// and what it shows while the backend works. Scenes are set up through `api`
// and `control`; every assertion on state goes to what the page shows, and to
// `api` where the page cannot say it.
//
// To know when reading or extending it:
//  - A row's buttons wait for the pointer on a desktop (`SessionsPage.start`,
//    `stop` and `choose` hover the row first); a phone shows them always.
//  - The fakes are quick (a start takes 400 ms, a proxy check 150 ms), so a
//    test that looks at "Starting" or "Assigning proxy" slows them down
//    first (`SLOW_START_MS`, `SLOW_CHECK_MS`).
//  - The page asks again every 1.5 s while something is busy and every 5 s
//    otherwise: what changes behind its back is waited for with
//    `TIMEOUT.BACKGROUND`.
//  - Every text comes from the catalog (`t`); a sentence the page builds from
//    an error code and the cause the backend names is `errors.<code>_<what>`.
//  - A row is called `<name> <state>` or `<name> <state> <line>` (`rowName`);
//    a session's page is its name as the heading, its state and where it exits
//    on the line under it, and, when the browser is not running, the details
//    of the session in its body.
//  - A toast lives five seconds and is read through `SessionsPage.toast`.

test.describe('the empty list', () => {
  test('says there are no sessions and, with no proxy yet, adds proxies right there', async ({
    page,
    api,
  }) => {
    const sessions = new SessionsPage(page);
    await sessions.open();

    await expect(
      sessions.list.getByRole('heading', { name: t('sessions.empty.title') }),
    ).toBeVisible();
    await expect(
      sessions.list.getByText(t('sessions.empty.noProxies')),
    ).toBeVisible();
    // The pane beside it says nothing is open and what to do about it.
    await expect(
      page.getByRole('heading', { name: t('sessions.index.title') }),
    ).toBeVisible();
    await expect(page.getByText(t('sessions.index.addFirst'))).toBeVisible();
    // No session can be added yet: the one button there is adds proxies.
    await expect(
      sessions.list.getByRole('button', { name: t('sessions.panel.add') }),
    ).toHaveCount(0);
    const addProxies = sessions.list.getByRole('button', {
      name: t('sessions.addProxies'),
      exact: true,
    });
    await addProxies.click();

    // The form that imports proxies opens where the person is.
    const dialog = sessions.dialog(t('proxies.import.title'));
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/sessions$/);
    await expect(sessions.proxyList(dialog)).toBeFocused();
    await sessions.proxyList(dialog).fill('203.0.113.70:8080');
    await sessions.button(dialog, t('proxies.import.submit')).click();
    await expect(dialog).toBeHidden();
    await expect(
      sessions.toast(plural(t('proxies.toasts.imported'), 1)),
    ).toBeVisible();

    // With a proxy in the pool, the same button offers the first session.
    await expect(
      sessions.list.getByText(t('sessions.empty.description')),
    ).toBeVisible({ timeout: TIMEOUT.BACKGROUND });
    await expect(
      sessions.list.getByRole('button', {
        name: t('sessions.panel.add'),
        exact: true,
      }),
    ).toBeEnabled();
    expect(await api.sessions()).toEqual([]);
    expect(await api.proxies()).toHaveLength(1);
  });

  test('offers to add the first session once a proxy exists, without a reload', async ({
    page,
    api,
  }) => {
    const sessions = new SessionsPage(page);
    await sessions.open();
    await expect(
      sessions.list.getByText(t('sessions.empty.noProxies')),
    ).toBeVisible();

    // The page asks again every few seconds: the pool filling up is noticed.
    await api.addProxies(1);
    await expect(
      sessions.list.getByText(t('sessions.empty.description')),
    ).toBeVisible({ timeout: TIMEOUT.BACKGROUND });
    const add = sessions.list.getByRole('button', {
      name: t('sessions.panel.add'),
      exact: true,
    });
    await expect(add).toBeEnabled();
    await expect(
      sessions.list.getByRole('button', { name: t('sessions.addProxies') }),
    ).toHaveCount(0);

    await add.click();
    await expect(sessions.addDialog).toBeVisible();
  });

  test('the pane beside the list tells where sessions will appear, then to choose one once there are some', async ({
    page,
    api,
  }) => {
    const sessions = new SessionsPage(page);
    await sessions.open();
    await expect(page.getByText(t('sessions.index.addFirst'))).toBeVisible();
    await expect(page.getByText(t('sessions.index.choose'))).toHaveCount(0);

    await api.startSession('Alpha');
    await expect(page.getByText(t('sessions.index.choose'))).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await expect(page.getByText(t('sessions.index.addFirst'))).toHaveCount(0);
  });
});

test.describe('adding a session when no proxy is free', () => {
  test('opens the form that adds proxies, and adds the session by itself, with the name and system it was given, once a proxy has been added', async ({
    page,
    api,
  }) => {
    const sessions = new SessionsPage(page);
    await sessions.open();

    const asked = await sessions.add({ name: 'Alpha', os: 'linux' });
    const dialog = sessions.noFreeProxyDialog;
    await expect(dialog).toBeVisible();
    // The add dialog gives way to the form that adds proxies.
    await expect(asked).toBeHidden();
    await expect(dialog).toContainText(t('sessions.noProxy.intro.create'));
    // No trip to the Proxies page: the dialog is the form, ready for a list.
    await expect(sessions.proxyList(dialog)).toBeFocused();
    expect(await api.sessions()).toEqual([]);
    // A refusal the dialog answers is not told again as a toast.
    await expect(sessions.toast(t('sessions.toasts.createFailed'))).toHaveCount(
      0,
    );

    await sessions.addProxiesIn(dialog, ['203.0.113.60:8080']);
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/sessions\/\d+$/);
    const created = await api.waitForStatus(sessionIdOf(page.url()), 'running');
    expect(created.name).toBe('Alpha');
    expect(created.os).toBe('linux');
    await sessions.expectRow(
      'Alpha',
      'running',
      lineOf(created),
      TIMEOUT.BACKGROUND,
    );
    await expect(
      sessions.toast(plural(t('proxies.toasts.imported'), 1)),
    ).toBeVisible();
  });

  test('gives up quietly on Cancel: nothing is added, and nothing is told', async ({
    page,
    api,
  }) => {
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.add({ name: 'Alpha' });
    const dialog = sessions.noFreeProxyDialog;
    await expect(dialog).toBeVisible();
    await sessions.button(dialog, t('common.actions.cancel')).click();

    await expect(dialog).toBeHidden();
    await expect(sessions.toast(t('sessions.toasts.createFailed'))).toHaveCount(
      0,
    );
    await expect(page).toHaveURL(/\/sessions$/);
    await expect(
      sessions.list.getByRole('heading', { name: t('sessions.empty.title') }),
    ).toBeVisible();
    expect(await api.sessions()).toEqual([]);
  });

  test('asks the same when every proxy belongs to a session already', async ({
    page,
    api,
  }) => {
    await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.add({ name: 'Bravo' });
    const dialog = sessions.noFreeProxyDialog;
    await expect(dialog).toContainText(t('sessions.noProxy.intro.create'));
    await sessions.button(dialog, t('common.actions.cancel')).click();
    await expect(dialog).toBeHidden();
    expect(await api.sessions()).toHaveLength(1);
    await expect(sessions.row('Bravo')).toHaveCount(0);
  });

  test('does not throw away a list that was typed without asking', async ({
    page,
    api,
  }) => {
    const sessions = new SessionsPage(page);
    await sessions.open();
    await sessions.add({ name: 'Alpha' });
    const dialog = sessions.noFreeProxyDialog;
    await expect(dialog).toBeVisible();
    await sessions.proxyList(dialog).fill('203.0.113.69:8080');

    // Escape asks first, and "no" keeps the form and what was typed in it.
    const asked: string[] = [];
    page.once('dialog', (question) => {
      asked.push(question.message());
      void question.dismiss();
    });
    await page.keyboard.press('Escape');
    await expect.poll(() => asked).toEqual([t('common.discardChangesConfirm')]);
    await expect(dialog).toBeVisible();
    await expect(sessions.proxyList(dialog)).toHaveValue('203.0.113.69:8080');

    // "Yes" gives the form up, and nothing was added.
    page.once('dialog', (question) => {
      void question.accept();
    });
    await sessions.button(dialog, t('common.actions.cancel')).click();
    await expect(dialog).toBeHidden();
    expect(await api.proxies()).toEqual([]);
    expect(await api.sessions()).toEqual([]);
  });

  test('tells a name that was taken meanwhile, once, because the dialog that had it is gone', async ({
    page,
    api,
  }) => {
    const sessions = new SessionsPage(page);
    await sessions.open();
    await sessions.add({ name: 'Alpha' });
    const dialog = sessions.noFreeProxyDialog;
    await expect(dialog).toBeVisible();

    // While the form waits for proxies, somebody else adds a session of that name.
    await api.startSession('Alpha');
    await sessions.addProxiesIn(dialog, ['203.0.113.66:8080']);
    await expect(dialog).toBeHidden();

    const toast = sessions.toast(t('errors.name_taken'));
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(t('sessions.toasts.createFailed'));
    await expect(page).toHaveURL(/\/sessions$/);
    expect((await api.sessions()).map((session) => session.name)).toEqual([
      'Alpha',
    ]);
  });
});

test.describe('starting a session that has no proxy when none is free', () => {
  test('asks for proxies, from the list and from the page, and starts the session by itself once there are some', async ({
    page,
    api,
  }) => {
    // Its proxy was deleted, and the pool has nothing else.
    const alpha = await stoppedWithoutProxy(api, 'Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();
    await sessions.expectRow('Alpha', 'stopped');

    await sessions.start('Alpha');
    const dialog = sessions.noFreeProxyDialog;
    const intro = t('sessions.noProxy.intro.start');
    await expect(dialog).toContainText(intro);
    await expect(sessions.proxyList(dialog)).toBeFocused();
    // A refusal the dialog answers is not told again as a toast.
    await expect(sessions.toast(t('sessions.toasts.startFailed'))).toHaveCount(
      0,
    );
    await sessions.button(dialog, t('common.actions.cancel')).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/sessions$/);
    await sessions.expectRow('Alpha', 'stopped');

    // The page of the session asks the same, from its header.
    await sessions.rowLink('Alpha').click();
    await sessions.headerStart.click();
    await expect(dialog).toContainText(intro);
    expect((await api.session(alpha.id)).status).toBe('stopped');

    // Proxies added in the dialog: the session is given one, and starts.
    await sessions.addProxiesIn(dialog, ['203.0.113.61:8080']);
    await expect(dialog).toBeHidden();
    const running = await api.waitForStatus(alpha.id, 'running');
    expect(running.proxy).not.toBeNull();
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await sessions.expectRow(
      'Alpha',
      'running',
      lineOf(running),
      TIMEOUT.BACKGROUND,
    );
  });
});

test.describe('adding a session', () => {
  test('asks for an optional name and the system, with Random the default', async ({
    page,
    api,
  }) => {
    await api.addProxies(1);
    const sessions = new SessionsPage(page);
    await sessions.open();

    const dialog = await sessions.openAddDialog();
    await expect(
      dialog.getByRole('heading', { name: t('sessions.add.title') }),
    ).toBeVisible();
    await expect(dialog.getByText(t('sessions.add.description'))).toBeVisible();
    // The field says what an empty name will become, and the line under it the rule.
    await expect(dialog.getByText(t('sessions.add.nameHint'))).toBeVisible();
    await expect(sessions.nameField(dialog)).toHaveAttribute(
      'placeholder',
      '0001',
    );
    const system = dialog.getByRole('combobox', {
      name: t('sessions.add.system'),
      exact: true,
    });
    await expect(system).toHaveText(t('sessions.add.os.random'));

    await system.click();
    const choices = page.getByRole('option');
    await expect(choices).toHaveText([
      t('sessions.add.os.random'),
      t('sessions.add.os.windows'),
      t('sessions.add.os.macos'),
      t('sessions.add.os.linux'),
    ]);
    await expect(
      page.getByRole('option', {
        name: t('sessions.add.os.random'),
        exact: true,
      }),
    ).toHaveAttribute('aria-selected', 'true');
  });

  test('gives a session with no name the next number, 0001, then 0002', async ({
    page,
    api,
  }) => {
    await api.addProxies(2);
    const sessions = new SessionsPage(page);
    await sessions.open();

    const first = await sessions.add();
    await expect(first).toBeHidden();
    await expect(page).toHaveURL(/\/sessions\/\d+$/);
    expect((await api.session(sessionIdOf(page.url()))).name).toBe('0001');

    // Spaces are no name either. The field already says what comes next.
    const second = await sessions.openAddDialog();
    await expect(sessions.nameField(second)).toHaveAttribute(
      'placeholder',
      '0002',
    );
    await sessions.nameField(second).fill('   ');
    await sessions.submitAdd(second);
    await expect(second).toBeHidden();
    await expect.poll(() => sessions.names()).toEqual(['0002', '0001']);
    expect((await api.sessions()).map((session) => session.name)).toEqual([
      '0002',
      '0001',
    ]);
  });

  test('keeps the name it is given, without the spaces around it', async ({
    page,
    api,
  }) => {
    await api.addProxies(1);
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.add({ name: '  Shop front  ' });
    await expect(sessions.row('Shop front')).toBeVisible();
    await expect(sessions.titleOf('Shop front')).toBeVisible();
    expect((await api.sessions()).map((session) => session.name)).toEqual([
      'Shop front',
    ]);
  });

  test('applies the system that was chosen', async ({ page, api }) => {
    await api.addProxies(3);
    const sessions = new SessionsPage(page);
    await sessions.open();

    for (const os of ['macos', 'linux', 'windows'] as const) {
      const name = `For ${os}`;
      const dialog = await sessions.add({ name, os });
      await expect(dialog).toBeHidden();
      await expect(sessions.row(name)).toBeVisible();
    }
    const byName = new Map(
      (await api.sessions()).map((session) => [session.name, session.os]),
    );
    expect(Object.fromEntries(byName)).toEqual({
      'For macos': 'macos',
      'For linux': 'linux',
      'For windows': 'windows',
    });
  });

  test('draws a system of its own for Random', async ({ page, api }) => {
    await api.addProxies(1);
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.add({ name: 'Anything' });
    await expect(sessions.row('Anything')).toBeVisible();
    const [created] = await api.sessions();
    expect(['windows', 'macos', 'linux']).toContain(created?.os);
  });

  test('puts the new row at the top and takes it from Starting to Running by itself', async ({
    page,
    api,
    control,
  }) => {
    await api.startSession('Alpha');
    await api.addProxies(1);
    await control.faults({ launchDelayMs: SLOW_START_MS });
    const sessions = new SessionsPage(page);
    await sessions.open();
    await page.evaluate(() => Reflect.set(window, 'sessionsStayedOpen', true));

    await sessions.add({ name: 'Bravo' });
    // The newest session is the first row, and its page opens at once.
    await expect.poll(() => sessions.names()).toEqual(['Bravo', 'Alpha']);
    const id = sessionIdOf(page.url());
    await sessions.expectRow('Bravo', 'starting');
    await expect(sessions.titleOf('Bravo')).toBeVisible();
    await expect(sessions.headerState('starting')).toBeVisible();
    await expect(
      sessions.pageStatus(t('sessions.status.starting')),
    ).toBeVisible();
    await expect(sessions.detailsHeading).toBeVisible();

    // Nobody reloads or navigates: the page asks again while the session is busy.
    const created = await api.waitForStatus(id, 'running');
    await sessions.expectRow(
      'Bravo',
      'running',
      lineOf(created),
      TIMEOUT.BACKGROUND,
    );
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await expect(sessions.headerState('running')).toBeVisible();
    await expect(
      sessions.exitChip(
        exitLine(created.proxy?.exitIp ?? '', created.proxy?.country ?? ''),
      ),
    ).toBeVisible();
    await expect(sessions.detailsHeading).toHaveCount(0);
    expect(
      await page.evaluate(() => Reflect.get(window, 'sessionsStayedOpen')),
    ).toBe(true);
  });

  test('gives the new session a proxy first, and says so while it does', async ({
    page,
    api,
    control,
  }) => {
    await api.addProxies(1);
    await control.faults({ checkDelayMs: SLOW_CHECK_MS });
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.add({ name: 'Alpha' });
    await sessions.expectRow('Alpha', 'assigning');
    await expect(sessions.headerState('assigning')).toBeVisible();
    await expect(
      sessions.pageStatus(t('sessions.status.assigning')),
    ).toBeVisible();
    // No proxy is shown before one has been chosen and checked: the header
    // holds Stop and the menu and no chip, and the details say the exit IP
    // comes with the start.
    await expect(
      detail(sessions.pageDetails, t('viewer.card.ipAddress')),
    ).toHaveText(t('viewer.card.noProxyYet'));
    await expect(sessions.header.getByRole('button')).toHaveCount(2);

    const running = await api.waitForStatus(sessionIdOf(page.url()), 'running');
    await sessions.expectRow(
      'Alpha',
      'running',
      lineOf(running),
      TIMEOUT.BACKGROUND,
    );
  });

  test('opens the page of a session from its row', async ({ page, api }) => {
    const alpha = await api.startSession('Alpha');
    const bravo = await api.startSession('Bravo');
    const sessions = new SessionsPage(page);
    await sessions.open();
    await expect(
      page.getByRole('heading', { name: t('sessions.index.title') }),
    ).toBeVisible();

    await sessions.rowLink('Alpha').click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${alpha.id}$`));
    await expect(sessions.titleOf('Alpha')).toBeVisible();
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    // The row of the open page is marked as the current one.
    await expect(sessions.rowLink('Alpha')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(sessions.rowLink('Bravo')).not.toHaveAttribute(
      'aria-current',
      'page',
    );

    await sessions.rowLink('Bravo').click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${bravo.id}$`));
    await expect(sessions.titleOf('Bravo')).toBeVisible();
  });
});

test.describe('the header of a session’s page', () => {
  test('names the session as the page’s one heading, whole, and names the tab after it', async ({
    page,
    api,
  }) => {
    const name = 'Shop – Berlin';
    const shop = await api.startSession(name);
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${shop.id}`);

    await expect(sessions.title).toHaveCount(1);
    await expect(sessions.titleOf(name)).toBeVisible();
    await expect(sessions.titleOf(name)).toHaveAttribute('title', name);
    await expect(page).toHaveTitle(tabTitle(name));
  });

  test('tells the state and where the session exits on the line under its name, a stopped session included', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const bravo = await stoppedSession(api, 'Bravo');
    const sessions = new SessionsPage(page);

    await sessions.open(`/sessions/${alpha.id}`);
    await expect(sessions.headerState('running')).toBeVisible();
    await expect(sessions.exitChip(lineOf(alpha))).toBeVisible();

    // A stopped session keeps its proxy, and the chip with it.
    await sessions.rowLink('Bravo').click();
    await expect(sessions.headerState('stopped')).toBeVisible();
    await expect(sessions.exitChip(lineOf(bravo))).toBeVisible();
    await expect(sessions.headerState('running')).toHaveCount(0);
  });

  test('has one button that starts or stops the session, which keeps the keyboard through the whole turn', async ({
    page,
    api,
  }) => {
    const alpha = await stoppedSession(api, 'Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);
    await expect(sessions.detailsHeading).toBeVisible();
    const button = await sessions.headerButton.elementHandle();
    if (button === null) throw new Error('The header has no Start button');

    await sessions.headerStart.focus();
    await page.keyboard.press('Enter');
    // The session starts, and the same button now says Stop.
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await expect(sessions.headerStop).toBeVisible();
    await expect(sessions.headerStart).toHaveCount(0);
    expect(await isFocusedNode(page, button), await describeFocus(page)).toBe(
      true,
    );

    await page.keyboard.press('Enter');
    await expect(sessions.detailsHeading).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await expect(sessions.headerStart).toBeVisible();
    expect(await isFocusedNode(page, button), await describeFocus(page)).toBe(
      true,
    );
  });

  test('while the session stops, the button is busy and off, and says why', async ({
    page,
    api,
    control,
  }) => {
    await api.addProxies(1);
    await control.faults({ launchDelayMs: SLOW_START_MS });
    const alpha = await api.createSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);
    await expect(sessions.headerState('starting')).toBeVisible();

    await sessions.headerStop.click();
    // Off but not gone: it stays in the tab order, so the keyboard keeps it and
    // can be told why.
    const button = sessions.headerStop;
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).not.toHaveAttribute('disabled');
    // The press left the keyboard on the button; coming to it again opens its tip.
    await button.blur();
    await button.focus();
    await sessions.expectTip(button, t('sessions.block.stopping'));

    await expect(sessions.headerStart).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await expect(sessions.headerStart).not.toHaveAttribute('aria-busy');
    await expect(sessions.headerStart).not.toHaveAttribute('aria-disabled');
  });

  test('while a stopped session is given another proxy, the button is busy and off', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await stoppedSession(api, 'Alpha');
    await api.addProxies(1);
    await control.faults({ checkDelayMs: SLOW_CHECK_MS });
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);
    await expect(sessions.detailsHeading).toBeVisible();

    await sessions.pageMenuButton('Alpha').click();
    await sessions.menuItem('Alpha', 'rotate').click();
    const button = sessions.headerStart;
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(sessions.headerState('assigning')).toBeVisible();
    await button.focus();
    await sessions.expectTip(button, t('sessions.status.starting'));

    // It is ready again when the proxy is given, and the session is still stopped.
    await expect(button).not.toHaveAttribute('aria-busy', {
      timeout: TIMEOUT.BACKGROUND,
    });
    await expect(button).not.toHaveAttribute('aria-disabled');
    await expect(sessions.headerState('stopped')).toBeVisible();
  });
});

test.describe('the details of a session', () => {
  test('the chip opens them over the page: system, screen, language, time zone, location, exit IP and where these come from', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);

    const popover = await sessions.openDetails(lineOf(alpha));
    await expect(
      popover.getByRole('heading', {
        level: 2,
        name: t('viewer.details.title'),
      }),
    ).toBeVisible();
    await expectDetails(popover, alpha);
    await expect(
      popover.getByText(
        fill(t('viewer.details.source'), { ip: alpha.location?.ip ?? '' }),
      ),
    ).toBeVisible();
    // The place still fits the IP, which the details say, and the proxy can be looked at again.
    await expect(popover.getByText(t('viewer.chip.inSync'))).toBeVisible();
    await expect(
      sessions.button(popover, t('sessions.menu.checkIp')),
    ).toBeVisible();
    await expect(
      sessions.button(popover, t('viewer.place.restart')),
    ).toHaveCount(0);
  });

  test('Escape closes them and returns the keyboard to the chip', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);
    const chip = sessions.exitChip(lineOf(alpha));
    await expect(chip).toBeVisible({ timeout: TIMEOUT.BACKGROUND });

    await chip.focus();
    await page.keyboard.press('Enter');
    await expect(sessions.detailsPopover).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sessions.detailsPopover).toBeHidden();
    await expect(chip).toBeFocused();
  });

  test('the button beside the exit IP copies it', async ({
    page,
    api,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);

    const popover = await sessions.openDetails(lineOf(alpha));
    await popover
      .getByRole('button', { name: t('viewer.details.copyIp'), exact: true })
      .click();
    await expect(popover.getByText(t('common.actions.copied'))).toBeAttached();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(alpha.proxy?.exitIp);
  });

  test('a stopped session shows the same list as the body of its page, and says its tabs come back', async ({
    page,
    api,
  }) => {
    const bravo = await stoppedSession(api, 'Bravo');
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${bravo.id}`);

    await expect(sessions.detailsHeading).toBeVisible();
    await expectDetails(sessions.pageDetails, bravo);
    await expect(
      sessions.pageDetails.getByText(
        fill(t('viewer.details.source'), { ip: bravo.location?.ip ?? '' }),
      ),
    ).toBeVisible();
    await expect(page.getByText(t('viewer.card.hint'))).toBeVisible();
    // Nothing is said about the state of the page: the header says it. And
    // there is no IP to look at again while no browser runs.
    await expect(sessions.pageStatus(/./)).toHaveCount(0);
    await expect(
      sessions.button(sessions.pageDetails, t('sessions.menu.checkIp')),
    ).toHaveCount(0);

    // The chip opens the same list.
    const popover = await sessions.openDetails(lineOf(bravo));
    await expectDetails(popover, bravo);
    await expect(
      sessions.button(popover, t('sessions.menu.checkIp')),
    ).toHaveCount(0);
  });
});

test.describe('reading the list', () => {
  test('a row’s buttons wait for the pointer or the keyboard on a desktop, so that a stray tap stops nothing', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));

    // Inert until the row is looked at: a click that lands there does nothing.
    await page.mouse.move(0, 0);
    await expect(sessions.stopButton('Alpha')).toHaveCSS(
      'pointer-events',
      'none',
    );
    await expect(sessions.menuButton('Alpha')).toHaveCSS(
      'pointer-events',
      'none',
    );

    await sessions.hover('Alpha');
    await expect(sessions.stopButton('Alpha')).toHaveCSS(
      'pointer-events',
      'auto',
    );
    await expect(sessions.menuButton('Alpha')).toHaveCSS(
      'pointer-events',
      'auto',
    );

    // The keyboard's focus on the row brings them as well.
    await page.mouse.move(0, 0);
    await expect(sessions.stopButton('Alpha')).toHaveCSS(
      'pointer-events',
      'none',
    );
    await sessions.rowLink('Alpha').focus();
    await page.keyboard.press('Tab');
    await expect(sessions.stopButton('Alpha')).toBeFocused();
    await expect(sessions.stopButton('Alpha')).toHaveCSS(
      'pointer-events',
      'auto',
    );
  });

  test('a row is called by the session’s name, then its state once, then the line when that says more than the state', async ({
    page,
    api,
    control,
    request,
  }) => {
    await stoppedSession(api, 'Ad verification');
    const running = await api.startSession('Price monitor');
    const moved = await api.startSession('Social accounts');
    await control.exitIps({
      [hostPortOf(moved)]: { ip: '198.51.100.7', country: 'FR' },
    });
    await checkIpOf(request, moved.id);
    await api.addProxies(1);
    const reason = 'Camoufox exited unexpectedly (code 1)';
    await control.faults({ launchError: reason });
    const failed = await api.createSession('Weekend trip');
    await api.waitForStatus(failed.id, 'error');
    const sessions = new SessionsPage(page);
    await sessions.open();

    // The state is said once, after the name: a line that is only the state is not said twice.
    const names = new Map<string, string>([
      ['Ad verification', rowName('Ad verification', 'stopped')],
      ['Price monitor', rowName('Price monitor', 'running', lineOf(running))],
      [
        'Social accounts',
        rowName('Social accounts', 'running', t('sessions.row.ipChanged')),
      ],
      ['Weekend trip', rowName('Weekend trip', 'error', reason)],
    ]);
    for (const [name, accessibleName] of names) {
      await expect(sessions.rowLink(name), name).toHaveAccessibleName(
        accessibleName,
      );
    }
  });

  test('a running session whose proxy has not told where it exits is called by its name and state only, and the chip tells the place it was taken from', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const place = alpha.location;
    if (place?.country == null) throw new Error('Alpha has no place');
    await changeSessionsOnTheWire(page, (session) => ({
      ...session,
      proxy:
        session.proxy === null
          ? null
          : { ...session.proxy, exitIp: null, country: null },
    }));
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);

    // The line under the name is the state, so it is said once.
    await expect(sessions.rowLink('Alpha')).toHaveAccessibleName(
      rowName('Alpha', 'running'),
    );
    await expect(
      sessions.exitChip(exitLine(place.ip, place.country)),
    ).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
  });

  test('a long name is cut in the list, shown whole as a tooltip, and in full on the page', async ({
    page,
    api,
  }) => {
    const name = `A session named ${'very '.repeat(12)}long`;
    const session = await api.startSession(name);
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${session.id}`);

    const shown = sessions.row(name).getByTitle(name, { exact: true });
    await expect(shown).toBeVisible();
    // Cut by the panel's width, with an ellipsis…
    expect(
      await shown.evaluate((node) => node.scrollWidth > node.clientWidth),
    ).toBe(true);
    await expect(shown).toHaveCSS('text-overflow', 'ellipsis');
    // …and whole on the page: as its heading, and as the tooltip of that.
    await expect(sessions.titleOf(name)).toBeVisible();
    await expect(sessions.titleOf(name)).toHaveAttribute('title', name);
  });

  // The list and the page read the id of the open session from the address by
  // one rule (`parseSessionId`): a plain whole number from 1, that a session can
  // have. What is not one names no session, however the number reads.
  const notAnId = [
    { title: 'zeros in front of an id', address: (id: number) => `00${id}` },
    { title: 'zero', address: () => '0' },
    { title: 'a number no id can be', address: () => '99999999999999999999' },
    { title: 'an exponent', address: () => '1e3' },
  ];

  for (const { title, address } of notAnId) {
    test(`an address with ${title} names no session: no row is the open page, and the backend is asked for nothing`, async ({
      page,
      api,
    }) => {
      const alpha = await api.startSession('Alpha');
      const asked: string[] = [];
      page.on('request', (request) => {
        const { pathname } = new URL(request.url());
        if (/^\/api\/sessions\/\d+$/.test(pathname)) asked.push(pathname);
      });
      const sessions = new SessionsPage(page);

      await sessions.open(`/sessions/${address(alpha.id)}`);
      await expect(
        page.getByRole('heading', { level: 2, name: t('viewer.gone.title') }),
      ).toBeVisible();
      await expect(sessions.rowLink('Alpha')).not.toHaveAttribute(
        'aria-current',
        'page',
      );
      await settlePage(page);
      expect(asked).toEqual([]);
    });
  }

  test('Back and Forward follow the sessions that were opened from the list', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const bravo = await api.startSession('Bravo');
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.rowLink('Alpha').click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${alpha.id}$`));
    await sessions.rowLink('Bravo').click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${bravo.id}$`));

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/sessions/${alpha.id}$`));
    await expect(sessions.rowLink('Alpha')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.goBack();
    await expect(page).toHaveURL(/\/sessions$/);
    await expect(sessions.rowLink('Alpha')).not.toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.goForward();
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`/sessions/${bravo.id}$`));
    await expect(sessions.rowLink('Bravo')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

test.describe('the rules for a name', () => {
  test('a name another session has is refused in the page’s own words, and the dialog stays usable', async ({
    page,
    api,
  }) => {
    await api.startSession('Alpha');
    await api.addProxies(1);
    const sessions = new SessionsPage(page);
    await sessions.open();

    // Names are compared without regard to case.
    const dialog = await sessions.add({ name: 'ALPHA' });
    const field = sessions.nameField(dialog);
    await expect(dialog.getByRole('alert')).toHaveText(t('errors.name_taken'));
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).toHaveValue('ALPHA');
    // The keyboard comes back to the field to change it.
    await expect(field).toBeFocused();
    expect(await api.sessions()).toHaveLength(1);
    await expect(page).toHaveURL(/\/sessions$/);

    // Typing takes the complaint away, and a free name goes through.
    await field.fill('Bravo');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await sessions.submitAdd(dialog);
    await expect(dialog).toBeHidden();
    await expect(sessions.row('Bravo')).toBeVisible();
    expect((await api.sessions()).map((session) => session.name)).toEqual([
      'Bravo',
      'Alpha',
    ]);
  });

  test('a name field takes no more characters than a name may have', async ({
    page,
    api,
  }) => {
    await api.addProxies(1);
    const limit = nameLimitOf(t('errors.invalid_name'));
    const sessions = new SessionsPage(page);
    await sessions.open();

    const dialog = await sessions.openAddDialog();
    const field = sessions.nameField(dialog);
    // More than fits cannot be typed or pasted: the field keeps what fits.
    await field.fill('n'.repeat(limit + 20));
    await expect(field).toHaveValue('n'.repeat(limit));
    await sessions.submitAdd(dialog);
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/sessions\/\d+$/);
    const [created] = await api.sessions();
    expect(created?.name).toBe('n'.repeat(limit));
  });

  // What is no part of a name: a line separator, a tab, a NUL, a control of the
  // second block (a "next line"). They would break a line of a log, an answer
  // to an assistant and the lists of a page, so the backend refuses them.
  const NOT_NAME_CHARACTERS = ['\u2028', '\t', '\u0000', '\u0085'];

  test('a character that is no part of a name is refused in the page’s words, beside the field, when adding', async ({
    page,
    api,
  }) => {
    await api.addProxies(1);
    const sessions = new SessionsPage(page);
    await sessions.open();
    const dialog = await sessions.openAddDialog();
    const field = sessions.nameField(dialog);

    for (const character of NOT_NAME_CHARACTERS) {
      await field.fill(`Al${character}pha`);
      await sessions.submitAdd(dialog);
      await expect(dialog.getByRole('alert')).toHaveText(
        t('errors.invalid_name'),
      );
      await expect(field).toHaveAttribute('aria-invalid', 'true');
      await expect(field).toBeFocused();
    }
    expect(await api.sessions()).toEqual([]);

    // Without it the name goes through.
    await field.fill('Alpha');
    await sessions.submitAdd(dialog);
    await expect(dialog).toBeHidden();
    await expect(sessions.row('Alpha')).toBeVisible();
  });

  test('a character that is no part of a name is refused in the page’s words, beside the field, when renaming', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.choose('Alpha', 'rename');
    const dialog = sessions.renameDialog;
    const field = dialog.getByRole('textbox', {
      name: t('sessions.rename.label'),
      exact: true,
    });
    for (const character of NOT_NAME_CHARACTERS) {
      await field.fill(`Al${character}pha 2`);
      await sessions.button(dialog, t('sessions.rename.submit')).click();
      await expect(dialog.getByRole('alert')).toHaveText(
        t('errors.invalid_name'),
      );
      await expect(field).toBeFocused();
    }
    expect((await api.session(alpha.id)).name).toBe('Alpha');
    await sessions.button(dialog, t('common.actions.cancel')).click();
    await expect(dialog).toBeHidden();
  });

  test('a name that looks like markup is shown as the text it is, in the list, the header, the tab and the questions', async ({
    page,
    api,
  }) => {
    // Names come from the person, from a script and from the assistants that
    // use the API: whatever they are, the page prints them and runs nothing.
    const name =
      '<img src=x onerror="window.sessionsInjected=1"> <b>Alpha</b> & "co"';
    const session = await api.startSession(name);
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${session.id}`);

    await sessions.expectRow(name, 'running', lineOf(session));
    await expect(sessions.titleOf(name)).toBeVisible();
    await expect(page).toHaveTitle(tabTitle(name));
    await sessions.pageMenuButton(name).click();
    await sessions.menuItem(name, 'delete').click();
    await expect(sessions.deleteDialog(name)).toBeVisible();

    // Nothing was made of the markup: no bold text, no image, no script run.
    await expect(page.locator('b').filter({ hasText: 'Alpha' })).toHaveCount(0);
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(
      await page.evaluate(() => Reflect.get(window, 'sessionsInjected')),
    ).toBeUndefined();
  });

  test('an emoji counts as one character: a name of the most characters there may be, in emoji, is accepted by the rename dialog though it takes twice the room in the text', async ({
    page,
    api,
  }) => {
    const limit = nameLimitOf(t('errors.invalid_name'));
    const name = '😀'.repeat(limit);
    // The backend counts characters, so it takes all of them.
    await api.addProxies(1);
    const longest = await api.createSession(name);
    await api.waitForStatus(longest.id, 'running');
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.choose(name, 'rename');
    const dialog = sessions.renameDialog;
    const field = dialog.getByRole('textbox', {
      name: t('sessions.rename.label'),
      exact: true,
    });
    await expect(field).toHaveValue(name);
    // Pressing the button is the page's own check of the length: an emoji is
    // one character to it, as to the backend, so the name passes.
    await sessions.button(dialog, t('sessions.rename.submit')).click();
    await expect(dialog).toBeHidden();
    expect((await api.session(longest.id)).name).toBe(name);
  });
});

test.describe('renaming a session', () => {
  test('from the row menu shows the new name at once and keeps it after a reload', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.choose('Alpha', 'rename');
    const dialog = sessions.renameDialog;
    await expect(dialog).toBeVisible();
    const field = dialog.getByRole('textbox', {
      name: t('sessions.rename.label'),
      exact: true,
    });
    await expect(field).toHaveValue('Alpha');
    await field.fill('Zulu');
    await dialog
      .getByRole('button', { name: t('sessions.rename.submit'), exact: true })
      .click();
    await expect(dialog).toBeHidden();

    // Only the label changed: the session runs on, with the same proxy.
    await sessions.expectRow('Zulu', 'running', lineOf(alpha));
    await expect(sessions.row('Alpha')).toHaveCount(0);
    expect((await api.session(alpha.id)).name).toBe('Zulu');

    await page.reload();
    await sessions.expectLoaded();
    await sessions.expectRow('Zulu', 'running', lineOf(alpha));
    await expect(sessions.row('Alpha')).toHaveCount(0);
  });

  test('from the menu of its own page, whatever its state', async ({
    page,
    api,
  }) => {
    const alpha = await stoppedSession(api, 'Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);
    await expect(sessions.detailsHeading).toBeVisible();

    await sessions.pageMenuButton('Alpha').click();
    await sessions.menuItem('Alpha', 'rename').click();
    const dialog = sessions.renameDialog;
    const field = dialog.getByRole('textbox', {
      name: t('sessions.rename.label'),
      exact: true,
    });
    await field.fill('Zulu');
    await field.press('Enter');
    await expect(dialog).toBeHidden();

    await expect(sessions.titleOf('Zulu')).toBeVisible();
    await expect(sessions.detailsHeading).toBeVisible();
    await sessions.expectRow('Zulu', 'stopped');
    await expect(page).toHaveURL(new RegExp(`/sessions/${alpha.id}$`));
    await expect(page).toHaveTitle(tabTitle('Zulu'));

    await page.reload();
    await expect(sessions.titleOf('Zulu')).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
    expect((await api.session(alpha.id)).name).toBe('Zulu');
  });

  test('to a name another session has is refused beside the field, and nothing changes', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    await api.startSession('Bravo');
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.choose('Alpha', 'rename');
    const dialog = sessions.renameDialog;
    const field = dialog.getByRole('textbox', {
      name: t('sessions.rename.label'),
      exact: true,
    });
    await field.fill('bravo');
    await dialog
      .getByRole('button', { name: t('sessions.rename.submit'), exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toHaveText(t('errors.name_taken'));
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    // The keyboard comes back to the field, from the button that was pressed.
    await expect(field).toBeFocused();
    expect((await api.session(alpha.id)).name).toBe('Alpha');
    // It is told beside the field, not also as a toast.
    await expect(sessions.toast(t('errors.name_taken'))).toHaveCount(0);

    // The dialog is still usable.
    await field.fill('Charlie');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await field.press('Enter');
    await expect(dialog).toBeHidden();
    await expect.poll(() => sessions.names()).toEqual(['Bravo', 'Charlie']);
  });

  test('to nothing is refused with the sentence for a bad name, and Cancel leaves the name alone', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.choose('Alpha', 'rename');
    const dialog = sessions.renameDialog;
    const field = dialog.getByRole('textbox', {
      name: t('sessions.rename.label'),
      exact: true,
    });
    await field.fill('   ');
    await field.press('Enter');
    await expect(dialog.getByRole('alert')).toHaveText(
      t('errors.invalid_name'),
    );
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    expect((await api.session(alpha.id)).name).toBe('Alpha');

    await dialog
      .getByRole('button', { name: t('common.actions.cancel'), exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(sessions.row('Alpha')).toBeVisible();
    expect((await api.session(alpha.id)).name).toBe('Alpha');
  });
});

test.describe('stopping, starting and restarting', () => {
  test('Stop stops a running session, which keeps its proxy, and Start runs it again', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));
    await expect(sessions.stopButton('Alpha')).toBeEnabled();
    await expect(sessions.startButton('Alpha')).toHaveCount(0);

    await sessions.stop('Alpha');
    await sessions.expectRow('Alpha', 'stopped');
    // The button follows the state: it starts the session now.
    await expect(sessions.startButton('Alpha')).toBeEnabled();
    await expect(sessions.stopButton('Alpha')).toHaveCount(0);
    // A stopped session keeps its proxy: the pool still has it with the session.
    const stopped = await api.session(alpha.id);
    expect(stopped.status).toBe('stopped');
    expect(stopped.proxy?.id).toBe(alpha.proxy?.id);
    const pool = await api.proxies();
    expect(
      pool.find((proxy) => proxy.id === alpha.proxy?.id)?.session?.name,
    ).toBe('Alpha');

    // Starting it again opens its page, so the start can be watched.
    await sessions.start('Alpha');
    await expect(page).toHaveURL(new RegExp(`/sessions/${alpha.id}$`));
    await sessions.expectRow(
      'Alpha',
      'running',
      lineOf(alpha),
      TIMEOUT.BACKGROUND,
    );
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    const again = await api.session(alpha.id);
    expect(again.proxy?.id).toBe(alpha.proxy?.id);
    await expect(sessions.stopButton('Alpha')).toBeEnabled();
  });

  test('a session that is stopped while it starts says Stopping until its browser has closed', async ({
    page,
    api,
    control,
  }) => {
    await api.addProxies(1);
    await control.faults({ launchDelayMs: SLOW_START_MS });
    const alpha = await api.createSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);
    await sessions.expectRow('Alpha', 'starting');

    await sessions.stop('Alpha');
    // The browser cannot be interrupted while it launches: the stop waits for
    // it, and says so everywhere, instead of going on saying Starting.
    await sessions.expectRow('Alpha', 'stopping');
    await expect(sessions.headerState('stopping')).toBeVisible();
    await expect(
      sessions.pageStatus(t('sessions.status.stopping')),
    ).toBeVisible();
    await sessions.expectRow('Alpha', 'stopped', undefined, TIMEOUT.BACKGROUND);
    await expect(sessions.headerState('stopped')).toBeVisible();
  });

  test('a session that is stopping cannot be stopped twice: the buttons that would are off, with the reason', async ({
    page,
    api,
    control,
  }) => {
    await api.addProxies(1);
    await control.faults({ launchDelayMs: SLOW_START_MS });
    const alpha = await api.createSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);
    await sessions.expectRow('Alpha', 'starting');

    await sessions.stop('Alpha');
    await expect(sessions.stopButton('Alpha')).toBeDisabled();
    await expect(sessions.headerStop).toBeDisabled();
    // A press on an off button does nothing: a second stop would be refused
    // by the backend and told in a toast.
    await sessions.headerStop.click({ force: true });
    await sessions.headerStop.focus();
    await page.keyboard.press('Enter');
    // Tabbing from the row's link to the button says why it is off.
    await sessions.rowLink('Alpha').focus();
    await page.keyboard.press('Tab');
    await expect(sessions.stopButton('Alpha')).toBeFocused();
    await sessions.expectTip(
      sessions.stopButton('Alpha'),
      t('sessions.block.stopping'),
    );
    expect((await api.session(alpha.id)).status).toBe('stopping');

    await sessions.expectRow('Alpha', 'stopped', undefined, TIMEOUT.BACKGROUND);
    await expect(sessions.toast(t('sessions.toasts.stopFailed'))).toHaveCount(
      0,
    );
    await expect(sessions.startButton('Alpha')).toBeEnabled();
    await expect(sessions.headerStart).toBeEnabled();
    expect((await api.session(alpha.id)).status).toBe('stopped');
  });

  test('a session that is stopped while it gets a proxy stops at once and keeps none', async ({
    page,
    api,
    control,
  }) => {
    await api.addProxies(1);
    await control.faults({ checkDelayMs: SLOW_CHECK_MS });
    const alpha = await api.createSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);
    await sessions.expectRow('Alpha', 'assigning');

    await sessions.stop('Alpha');
    await sessions.expectRow('Alpha', 'stopped');
    await expect(sessions.headerState('stopped')).toBeVisible();
    // No proxy was claimed by the start that was cancelled, and there are no
    // tabs of an earlier run to bring back.
    await expect(
      detail(sessions.pageDetails, t('viewer.card.ipAddress')),
    ).toHaveText(t('viewer.card.noProxyYet'));
    await expect(page.getByText(t('viewer.card.hint'))).toHaveCount(0);
    const stopped = await api.session(alpha.id);
    expect(stopped.status).toBe('stopped');
    expect(stopped.proxy).toBeNull();
    expect((await api.proxies())[0]?.session).toBeNull();

    // Starting it again, now that checks are quick, gives it a proxy and runs it.
    await control.clear();
    await sessions.start('Alpha');
    const running = await api.waitForStatus(alpha.id, 'running');
    await sessions.expectRow(
      'Alpha',
      'running',
      lineOf(running),
      TIMEOUT.BACKGROUND,
    );
  });

  test('Restart asks first, then closes the browser and opens it again with the same proxy', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await api.startSession('Alpha');
    await control.faults({ launchDelayMs: SLOW_START_MS });
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.choose('Alpha', 'restart');
    const dialog = sessions.restartDialog('Alpha');
    await expect(
      dialog.getByText(t('sessions.restart.description')),
    ).toBeVisible();
    // Leaving the question alone changes nothing, and the keyboard is where it was.
    await dialog
      .getByRole('button', { name: t('common.actions.cancel'), exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(sessions.menuButton('Alpha')).toBeFocused();
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));

    await sessions.choose('Alpha', 'restart');
    await dialog
      .getByRole('button', { name: t('sessions.restart.confirm'), exact: true })
      .click();
    await expect(dialog).toBeHidden();
    // The browser goes down and comes up again: that is a start.
    await sessions.expectRow('Alpha', 'starting');
    await sessions.expectRow(
      'Alpha',
      'running',
      lineOf(alpha),
      TIMEOUT.BACKGROUND,
    );
    const restarted = await api.session(alpha.id);
    expect(restarted.proxy?.id).toBe(alpha.proxy?.id);
    expect(restarted.status).toBe('running');
  });

  test('Restart and Check IP say why a stopped session cannot use them', async ({
    page,
    api,
  }) => {
    await stoppedSession(api, 'Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.openMenu('Alpha');
    const restart = sessions.menuItem('Alpha', 'restart');
    await expect(restart).toBeDisabled();
    await expect(restart).toContainText(t('sessions.menu.restartOnlyRunning'));
    const check = sessions.menuItem('Alpha', 'checkIp');
    await expect(check).toBeDisabled();
    await expect(check).toContainText(t('sessions.menu.checkIpOnlyRunning'));
    // What a stopped session can do is open.
    await expect(sessions.menuItem('Alpha', 'rename')).toBeEnabled();
    await expect(sessions.menuItem('Alpha', 'rotate')).toBeEnabled();
    await expect(sessions.menuItem('Alpha', 'delete')).toBeEnabled();
  });

  test('the open page follows a session that is stopped and started from the list', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await expect(sessions.headerStop).toBeEnabled();

    await sessions.stop('Alpha');
    // The browser gives way to the details of a stopped session.
    await expect(sessions.detailsHeading).toBeVisible();
    await expect(sessions.headerState('stopped')).toBeVisible();
    await expect(sessions.headerStart).toBeEnabled();
    await expect(sessions.liveStage).toHaveCount(0);

    await control.faults({ launchDelayMs: SLOW_START_MS });
    await sessions.start('Alpha');
    await expect(
      sessions.pageStatus(t('sessions.status.starting')),
    ).toBeVisible();
    await expect(sessions.headerStop).toBeEnabled();
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await expect(sessions.detailsHeading).toHaveCount(0);
  });

  test('the page of a session starts and stops it from its own header', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });

    await sessions.headerStop.click();
    await expect(sessions.detailsHeading).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await sessions.expectRow('Alpha', 'stopped');
    expect((await api.session(alpha.id)).status).toBe('stopped');

    await sessions.headerStart.click();
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await sessions.expectRow(
      'Alpha',
      'running',
      lineOf(alpha),
      TIMEOUT.BACKGROUND,
    );
  });

  test('the keyboard goes to the page’s heading when the browser it was typing into goes away', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);
    await expect(sessions.picture).toBeVisible({ timeout: TIMEOUT.PICTURE });
    await sessions.picture.focus();
    await expect(
      page.getByRole('textbox', { name: t('viewer.stage.keyboard') }),
    ).toBeFocused();

    // Somewhere else the session is stopped: the field the person typed into
    // is gone with its browser, and the keyboard must not fall to the page.
    await api.stopSession(alpha.id);
    await expect(sessions.detailsHeading).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await expect(sessions.title).toBeFocused();
  });
});

test.describe('the keyboard when a page gives way', () => {
  test('goes to the page’s heading when the details it was in give way to the browser', async ({
    page,
    api,
    request,
  }) => {
    const alpha = await stoppedSession(api, 'Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);
    await expect(sessions.detailsHeading).toBeVisible();
    await sessions.pageDetails
      .getByRole('button', { name: t('viewer.details.copyIp'), exact: true })
      .focus();

    // Started somewhere else: the details are replaced by the browser, with
    // the button the keyboard was on.
    await startAgain(request, alpha.id);
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await expect(sessions.title).toBeFocused();
  });
});

test.describe('deleting a session', () => {
  test('can be called off with Cancel or Escape: the session stays', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.choose('Alpha', 'delete');
    const dialog = sessions.deleteDialog('Alpha');
    // It says what goes with the session, and that a running browser is closed.
    await expect(dialog).toContainText(
      t('sessions.delete.descriptionBrowserOpen'),
    );
    await dialog
      .getByRole('button', { name: t('common.actions.cancel'), exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));
    // The focus is back on the button that opened the menu.
    await expect(sessions.menuButton('Alpha')).toBeFocused();

    await sessions.choose('Alpha', 'delete');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));

    expect((await api.session(alpha.id)).status).toBe('running');
    expect((await control.browser('Alpha')).closed).toBe(false);
  });

  test('a stopped session is removed and its proxy is free again', async ({
    page,
    api,
  }) => {
    const alpha = await stoppedSession(api, 'Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();
    const before = await api.proxies();
    expect(
      before.find((proxy) => proxy.id === alpha.proxy?.id)?.session?.name,
    ).toBe('Alpha');

    await sessions.choose('Alpha', 'delete');
    const dialog = sessions.deleteDialog('Alpha');
    // No browser is open, so none is closed first.
    await expect(dialog).toContainText(t('sessions.delete.description'));
    await expect(dialog).not.toContainText(
      t('sessions.delete.descriptionBrowserOpen'),
    );
    await dialog
      .getByRole('button', { name: t('sessions.delete.confirm'), exact: true })
      .click();
    await expect(dialog).toBeHidden();

    await expect(sessions.row('Alpha')).toHaveCount(0);
    await expect(
      sessions.list.getByRole('heading', { name: t('sessions.empty.title') }),
    ).toBeVisible();
    expect(await api.sessions()).toEqual([]);
    const after = await api.proxies();
    expect(
      after.find((proxy) => proxy.id === alpha.proxy?.id)?.session,
    ).toBeNull();
    expect((await api.meta()).counts.freeProxies).toBe(1);

    // Free means it can be given out again: the next session gets it.
    await sessions.add({ name: 'Bravo' });
    await expect(page).toHaveURL(/\/sessions\/\d+$/);
    const bravo = await api.waitForStatus(sessionIdOf(page.url()), 'running');
    expect(bravo.proxy?.id).toBe(alpha.proxy?.id);
    await sessions.expectRow(
      'Bravo',
      'running',
      lineOf(alpha),
      TIMEOUT.BACKGROUND,
    );
  });

  test('a running session is deleted with its browser, which is closed first', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await api.startSession('Alpha');
    await api.startSession('Bravo');
    const sessions = new SessionsPage(page);
    await sessions.open();
    expect((await control.browser('Alpha')).closed).toBe(false);

    await sessions.choose('Alpha', 'delete');
    const dialog = sessions.deleteDialog('Alpha');
    await dialog
      .getByRole('button', { name: t('sessions.delete.confirm'), exact: true })
      .click();
    await expect(dialog).toBeHidden();

    await expect(sessions.row('Alpha')).toHaveCount(0);
    await expect.poll(() => sessions.names()).toEqual(['Bravo']);
    await expect(sessions.total(1)).toBeVisible();
    expect((await control.browser('Alpha')).closed).toBe(true);
    const pool = await api.proxies();
    expect(
      pool.find((proxy) => proxy.id === alpha.proxy?.id)?.session,
    ).toBeNull();
    await expect(api.session(alpha.id)).rejects.toThrow(/session_not_found/);
    // The other session did not notice.
    await expect(sessions.stopButton('Bravo')).toBeEnabled();
  });

  test('the session whose page is open is deleted from its header, and the page leaves for the list', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });

    await sessions.pageMenuButton('Alpha').click();
    await sessions.menuItem('Alpha', 'delete').click();
    await sessions
      .deleteDialog('Alpha')
      .getByRole('button', { name: t('sessions.delete.confirm'), exact: true })
      .click();

    await expect(page).toHaveURL(/\/sessions$/);
    await expect(
      page.getByRole('heading', { name: t('sessions.index.title') }),
    ).toBeVisible();
    await expect(sessions.row('Alpha')).toHaveCount(0);
    expect(await api.sessions()).toEqual([]);
    // The page the keyboard was on is gone: it is on the main area, not the document.
    await expect(page.getByRole('main')).toBeFocused();
  });

  test('a session that is not running, deleted from its own page, hands the keyboard to the main area as a running one does', async ({
    page,
    api,
  }) => {
    const alpha = await stoppedSession(api, 'Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);
    await expect(sessions.detailsHeading).toBeVisible();

    await sessions.pageMenuButton('Alpha').click();
    await sessions.menuItem('Alpha', 'delete').click();
    await sessions
      .deleteDialog('Alpha')
      .getByRole('button', { name: t('sessions.delete.confirm'), exact: true })
      .click();

    await expect(page).toHaveURL(/\/sessions$/);
    await expect(sessions.row('Alpha')).toHaveCount(0);
    // The page the keyboard was on is gone: it is on the main area, not the document.
    await expect(page.getByRole('main')).toBeFocused();
  });

  test('from its row leaves the open page only when it is the open session’s own row', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    await api.startSession('Bravo');
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });

    // Another session's row: the page stays where it is.
    await sessions.choose('Bravo', 'delete');
    await sessions
      .deleteDialog('Bravo')
      .getByRole('button', { name: t('sessions.delete.confirm'), exact: true })
      .click();
    await expect(sessions.row('Bravo')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/sessions/${alpha.id}$`));
    await expect(sessions.liveStage).toBeVisible();

    // The row of the open session: its page is gone with it.
    await sessions.choose('Alpha', 'delete');
    await sessions
      .deleteDialog('Alpha')
      .getByRole('button', { name: t('sessions.delete.confirm'), exact: true })
      .click();
    await expect(page).toHaveURL(/\/sessions$/);
    await expect(sessions.row('Alpha')).toHaveCount(0);
    expect(await api.sessions()).toEqual([]);
  });

  test('a page left open on a session that is deleted elsewhere says it no longer exists', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });

    // Deleted by someone else while the page is open.
    await api.deleteSession(alpha.id);
    await expect(
      page.getByRole('heading', { level: 2, name: t('viewer.gone.title') }),
    ).toBeVisible({ timeout: TIMEOUT.BACKGROUND });
    await expect(page.getByText(t('viewer.gone.description'))).toBeVisible();
    // The page is still a page of the app, with a heading and the way back.
    await expect(sessions.title).toHaveText(t('viewer.title'));
    await expect(page).toHaveTitle(tabTitle(t('viewer.gone.title')));
    await expect(sessions.row('Alpha')).toHaveCount(0);
    await page.getByRole('link', { name: t('viewer.gone.back') }).click();
    await expect(page).toHaveURL(/\/sessions$/);
  });

  test('counts the secrets that go with the session, and only its own', async ({
    page,
    api,
  }) => {
    const alpha = await stoppedSession(api, 'Alpha');
    const note = (title: string, sessionId: number | null) =>
      api.createSecret({
        kind: 'note',
        title,
        sessionId,
        fields: [{ label: 'Note', value: title }],
      });
    await note('For Alpha', alpha.id);
    await note('Also for Alpha', alpha.id);
    await note('For every session', null);
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.choose('Alpha', 'delete');
    const dialog = sessions.deleteDialog('Alpha');
    await expect(dialog).toContainText(plural(t('sessions.delete.secrets'), 2));
    await dialog
      .getByRole('button', { name: t('sessions.delete.confirm'), exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(sessions.row('Alpha')).toHaveCount(0);
    expect((await api.secrets()).map((secret) => secret.title)).toEqual([
      'For every session',
    ]);
  });
});

test.describe('rotating the IP', () => {
  test('moves a running session to another free proxy and shows its new exit IP', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await api.startSession('Alpha');
    const [spare] = await api.addProxies(1);
    await control.faults({ launchDelayMs: SLOW_START_MS });
    const sessions = new SessionsPage(page);
    await sessions.open();
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));

    await sessions.choose('Alpha', 'rotate');
    const dialog = sessions.rotateDialog('Alpha');
    await expect(
      dialog.getByText(t('sessions.rotate.description')),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: t('sessions.rotate.confirm'), exact: true })
      .click();
    await expect(dialog).toBeHidden();

    // The browser restarts with the other proxy.
    await sessions.expectRow('Alpha', 'starting');
    const rotated = await api.waitForStatus(alpha.id, 'running');
    expect(rotated.proxy?.id).toBe(spare?.id);
    expect(lineOf(rotated)).not.toBe(lineOf(alpha));
    // Where it says it is follows the new exit IP.
    expect(rotated.location?.ip).toBe(rotated.proxy?.exitIp);
    await sessions.expectRow(
      'Alpha',
      'running',
      lineOf(rotated),
      TIMEOUT.BACKGROUND,
    );

    // The old proxy is free again and the new one is the session's.
    const pool = await api.proxies();
    expect(
      pool.find((proxy) => proxy.id === alpha.proxy?.id)?.session,
    ).toBeNull();
    expect(pool.find((proxy) => proxy.id === spare?.id)?.session?.name).toBe(
      'Alpha',
    );
  });

  test('with no spare proxy asks for proxies, and moves the session by itself once there are some', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.choose('Alpha', 'rotate');
    await sessions
      .button(sessions.rotateDialog('Alpha'), t('sessions.rotate.confirm'))
      .click();

    // The question gives way to the form that adds proxies, worded for a rotation.
    const dialog = sessions.noFreeProxyDialog;
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(t('sessions.noProxy.intro.rotate'));
    await expect(sessions.rotateDialog('Alpha')).toHaveCount(0);
    // A refusal the dialog answers is not told again as a toast.
    await expect(sessions.toast(t('sessions.toasts.rotateFailed'))).toHaveCount(
      0,
    );

    // Giving up leaves the session alone: same proxy, still running.
    await sessions.button(dialog, t('common.actions.cancel')).click();
    await expect(dialog).toBeHidden();
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));
    const same = await api.session(alpha.id);
    expect(same.proxy?.id).toBe(alpha.proxy?.id);
    expect(same.activity).toBeNull();

    // With a proxy added, the rotation goes on by itself.
    await sessions.choose('Alpha', 'rotate');
    await sessions
      .button(sessions.rotateDialog('Alpha'), t('sessions.rotate.confirm'))
      .click();
    await expect(dialog).toBeVisible();
    await sessions.addProxiesIn(dialog, ['203.0.113.62:8080']);
    await expect(dialog).toBeHidden();
    await expect
      .poll(async () => (await api.session(alpha.id)).proxy?.id, {
        timeout: TIMEOUT.BACKGROUND,
      })
      .not.toBe(alpha.proxy?.id);
    const rotated = await api.waitForStatus(alpha.id, 'running');
    expect(lineOf(rotated)).not.toBe(lineOf(alpha));
    await sessions.expectRow(
      'Alpha',
      'running',
      lineOf(rotated),
      TIMEOUT.BACKGROUND,
    );
  });

  test('gives a stopped session another proxy without asking, and says it is busy meanwhile', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await stoppedSession(api, 'Alpha');
    const [spare] = await api.addProxies(1);
    await control.faults({ checkDelayMs: SLOW_CHECK_MS });
    const sessions = new SessionsPage(page);
    await sessions.open();
    await sessions.expectRow('Alpha', 'stopped');

    await sessions.choose('Alpha', 'rotate');
    // A stopped session loses nothing: there is no question.
    await expect(sessions.rotateDialog('Alpha')).toHaveCount(0);
    await sessions.expectRow('Alpha', 'assigning');
    await expect(sessions.startButton('Alpha')).toBeDisabled();
    // Start is off, and the keyboard is told why.
    await sessions.rowLink('Alpha').focus();
    await page.keyboard.press('Tab');
    await expect(sessions.startButton('Alpha')).toBeFocused();
    await sessions.expectTip(
      sessions.startButton('Alpha'),
      t('sessions.block.busy'),
    );
    await sessions.openMenu('Alpha');
    const rotate = sessions.menuItem('Alpha', 'rotate');
    await expect(rotate).toBeDisabled();
    await expect(rotate).toContainText(t('sessions.menu.rotateBusy'));
    await page.keyboard.press('Escape');

    // It stays stopped, with the other proxy.
    await sessions.expectRow('Alpha', 'stopped', undefined, TIMEOUT.BACKGROUND);
    const rotated = await api.session(alpha.id);
    expect(rotated.status).toBe('stopped');
    expect(rotated.proxy?.id).toBe(spare?.id);
    await sessions.rowLink('Alpha').click();
    await expect(sessions.detailsHeading).toBeVisible();
    await expect(
      detail(sessions.pageDetails, t('viewer.card.ipAddress')),
    ).toHaveText(lineOf(rotated));
    await expect(sessions.exitChip(lineOf(rotated))).toBeVisible();
  });

  test('with a spare proxy that does not work closes the session on its old proxy and asks for one that does', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await api.startSession('Alpha');
    const [spare] = await api.addProxies(1);
    if (spare === undefined) throw new Error('No spare proxy was added');
    await control.exitIps({
      [`${spare.host}:${spare.port}`]: {
        error: 'the proxy refused the connection',
      },
    });
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.choose('Alpha', 'rotate');
    await sessions
      .button(sessions.rotateDialog('Alpha'), t('sessions.rotate.confirm'))
      .click();

    // The server found no other proxy that works: the browser is closed, and
    // the page, which began the rotation, asks for one.
    const dialog = sessions.noWorkingProxyDialog;
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.BACKGROUND });
    await expect(
      dialog.getByText(
        fill(plural(plural(t('sessions.noWorking.introFailed'), 1), 1), {
          names: quoted('Alpha'),
        }),
        { exact: true },
      ),
    ).toBeVisible();
    const closed = await api.session(alpha.id);
    expect(closed.errorCode).toBe('no_working_proxy');
    // It keeps the proxy it had; the one that failed its check is not given out.
    expect(closed.proxy?.id).toBe(alpha.proxy?.id);
    expect((await control.browser('Alpha')).closed).toBe(true);
    const pool = await api.proxies();
    expect(pool.find((proxy) => proxy.id === spare.id)?.check.status).toBe(
      'failed',
    );

    // Giving up leaves the session closed, and the row says why.
    await sessions.button(dialog, t('common.actions.cancel')).click();
    await expect(dialog).toBeHidden();
    await sessions.expectRow(
      'Alpha',
      'error',
      plural(t('errors.no_working_proxy_failed'), 1),
      TIMEOUT.BACKGROUND,
    );
    expect((await api.session(alpha.id)).status).toBe('error');
  });

  test('with a spare proxy that does not work is put right by a proxy that does, added when the page asks', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await api.startSession('Alpha');
    const [spare] = await api.addProxies(1);
    if (spare === undefined) throw new Error('No spare proxy was added');
    await control.exitIps({
      [`${spare.host}:${spare.port}`]: {
        error: 'the proxy refused the connection',
      },
    });
    const sessions = new SessionsPage(page);
    await sessions.open();
    await sessions.choose('Alpha', 'rotate');
    await sessions
      .button(sessions.rotateDialog('Alpha'), t('sessions.rotate.confirm'))
      .click();
    const dialog = sessions.noWorkingProxyDialog;
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.BACKGROUND });

    // A proxy that works: the session is rotated to it and started again.
    await sessions.addProxiesIn(dialog, ['203.0.113.63:8080']);
    await expect(dialog).toBeHidden();
    await expect
      .poll(async () => (await api.session(alpha.id)).proxy?.id, {
        timeout: TIMEOUT.BACKGROUND,
      })
      .not.toBe(alpha.proxy?.id);
    const running = await api.waitForStatus(alpha.id, 'running');
    expect(running.proxy?.exitIp).toBe('203.0.113.63');
    await sessions.expectRow(
      'Alpha',
      'running',
      lineOf(running),
      TIMEOUT.BACKGROUND,
    );
    // The old proxy was given back.
    const pool = await api.proxies();
    expect(
      pool.find((proxy) => proxy.id === alpha.proxy?.id)?.session,
    ).toBeNull();
  });

  test('asks for proxies without counting any that failed once those are gone', async ({
    page,
    api,
    control,
  }) => {
    // The only spare proxy fails its check, the session ends without a proxy
    // that works, and the person deletes the proxy that failed before coming back.
    await api.startSession('Alpha');
    const [spare] = await api.addProxies(1);
    if (spare === undefined) throw new Error('No spare proxy was added');
    await control.exitIps({
      [`${spare.host}:${spare.port}`]: {
        error: 'the proxy refused the connection',
      },
    });
    const sessions = new SessionsPage(page);
    await sessions.open();
    await sessions.choose('Alpha', 'rotate');
    await sessions
      .button(sessions.rotateDialog('Alpha'), t('sessions.rotate.confirm'))
      .click();
    const dialog = sessions.noWorkingProxyDialog;
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.BACKGROUND });
    await sessions.button(dialog, t('common.actions.cancel')).click();
    await expect(dialog).toBeHidden();

    await api.deleteProxy(spare.id);
    await sessions.rowLink('Alpha').click();
    await page
      .getByRole('button', {
        name: t('viewer.actions.addProxies'),
        exact: true,
      })
      .click();
    // No proxy failed its check any more, and the form no longer says one did:
    // its sentence is the plain one, and nothing else.
    await expect(
      dialog.getByText(
        fill(plural(t('sessions.noWorking.intro'), 1), {
          names: quoted('Alpha'),
        }),
        { exact: true },
      ),
    ).toBeVisible();
  });

  test('a stopped session that finds no other proxy that works stays stopped, and its row and page say why, the row in one line', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await stoppedSession(api, 'Alpha');
    await api.startSession('Bravo');
    const [spare] = await api.addProxies(1);
    if (spare === undefined) throw new Error('No spare proxy was added');
    await control.exitIps({
      [`${spare.host}:${spare.port}`]: {
        error: 'the proxy refused the connection',
      },
    });
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.choose('Alpha', 'rotate');
    // The page asks for proxies that work; giving it up leaves the session as it was.
    const dialog = sessions.noWorkingProxyDialog;
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.BACKGROUND });
    await sessions.button(dialog, t('common.actions.cancel')).click();
    await expect(dialog).toBeHidden();

    // The failure stays with the session, in the row and on its page, though it only stopped.
    const failure = plural(t('errors.no_working_proxy_failed'), 1);
    await sessions.expectRow('Alpha', 'stopped', failure);
    expect((await api.session(alpha.id)).status).toBe('stopped');
    // It is long, and one line: cut with an ellipsis, whole as its tooltip, and
    // the row is no taller than a row that says only where it exits.
    const line = sessions.row('Alpha').getByText(failure, { exact: true });
    await expect(line).toHaveCSS('text-overflow', 'ellipsis');
    expect(
      await line.evaluate((node) => node.scrollWidth > node.clientWidth),
    ).toBe(true);
    await expect(sessions.row('Alpha').getByTitle(failure)).toBeVisible();
    const [failed, plain] = await Promise.all([
      sessions.row('Alpha').boundingBox(),
      sessions.row('Bravo').boundingBox(),
    ]);
    expect(failed?.height).toBe(plain?.height);

    await sessions.rowLink('Alpha').click();
    await expect(sessions.headerState('stopped')).toBeVisible();
    await expect(sessions.pageStatus(failure)).toBeVisible();
    // The way on is on the page: proxies to add.
    await expect(
      page.getByRole('button', {
        name: t('viewer.actions.addProxies'),
        exact: true,
      }),
    ).toBeVisible();
  });
});

test.describe('checking the exit IP', () => {
  test('confirms that the proxy still exits where the session says it is', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.choose('Alpha', 'checkIp');
    await expect(
      sessions.toast(
        fill(t('sessions.notices.ipSame'), { ip: alpha.proxy?.exitIp ?? '' }),
      ),
    ).toBeVisible();
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));
  });

  test('finds the new exit IP and country, and the session is told to restart to match', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await api.startSession('Alpha');
    const was = alpha.proxy?.exitIp ?? '';
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);
    await expect(sessions.exitChip(lineOf(alpha))).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });

    // The provider moved the IP behind the same proxy.
    await control.exitIps({
      [hostPortOf(alpha)]: { ip: '198.51.100.7', country: 'FR' },
    });
    await sessions.choose('Alpha', 'checkIp');
    await expect(
      sessions.toast(
        fill(t('sessions.notices.ipChanged'), { now: '198.51.100.7', was }),
      ),
    ).toBeVisible();

    // The list says so, and the page shows the new IP and country as a warning.
    await sessions.expectRow('Alpha', 'running', t('sessions.row.ipChanged'));
    await expect(
      sessions.exitChip(exitLine('198.51.100.7', 'FR')),
    ).toBeVisible();
    await expect(sessions.outOfSyncBar).toBeVisible();
    // Its first line is a line, not a heading: the page has one heading, its name.
    await expect(
      sessions.outOfSyncBar.getByText(t('viewer.place.warningTitle'), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: t('viewer.place.warningTitle') }),
    ).toHaveCount(0);
    await expect(
      sessions.outOfSyncBar.getByText(
        fill(t('viewer.place.warning'), {
          current: '198.51.100.7',
          reported: was,
        }),
      ),
    ).toBeVisible();
    const checked = await api.session(alpha.id);
    expect(checked.proxy?.exitIp).toBe('198.51.100.7');
    expect(checked.proxy?.country).toBe('FR');
    expect(checked.location?.inSync).toBe(false);

    // Restarting fits the session to the new IP: the warning goes.
    await sessions
      .button(sessions.outOfSyncBar, t('viewer.place.restart'))
      .click();
    await sessions
      .button(sessions.restartDialog('Alpha'), t('sessions.restart.confirm'))
      .click();
    await sessions.expectRow(
      'Alpha',
      'running',
      exitLine('198.51.100.7', 'FR'),
      TIMEOUT.BACKGROUND,
    );
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await expect(sessions.outOfSyncBar).toHaveCount(0);
    const fitted = await api.session(alpha.id);
    expect(fitted.location?.ip).toBe('198.51.100.7');
    expect(fitted.location?.inSync).toBe(true);
  });

  test('Check IP in the details looks at the proxy again, and the chip, the details and the row follow what it finds', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await api.startSession('Alpha');
    const was = alpha.proxy?.exitIp ?? '';
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);
    const popover = await sessions.openDetails(lineOf(alpha));

    await sessions.button(popover, t('sessions.menu.checkIp')).click();
    await expect(
      sessions.toast(fill(t('sessions.notices.ipSame'), { ip: was })),
    ).toBeVisible();
    await expect(popover.getByText(t('viewer.chip.inSync'))).toBeVisible();

    await control.exitIps({
      [hostPortOf(alpha)]: { ip: '198.51.100.9', country: 'US' },
    });
    await sessions.button(popover, t('sessions.menu.checkIp')).click();
    // The details stay open, and say what changed.
    await expect(
      sessions.toast(
        fill(t('sessions.notices.ipChanged'), { now: '198.51.100.9', was }),
      ),
    ).toBeVisible();
    await expect(detail(popover, t('viewer.card.ipAddress'))).toHaveText(
      exitLine('198.51.100.9', 'US'),
    );
    await expect(popover.getByText(t('viewer.chip.outOfSync'))).toBeVisible();
    await expect(
      sessions.button(popover, t('viewer.place.restart')),
    ).toBeVisible();
    await expect(
      sessions.exitChip(exitLine('198.51.100.9', 'US')),
    ).toBeVisible();
    await sessions.expectRow('Alpha', 'running', t('sessions.row.ipChanged'));
  });

  test('Restart session in the details asks first, and fits the session to the new IP', async ({
    page,
    api,
    control,
    request,
  }) => {
    const alpha = await api.startSession('Alpha');
    await control.exitIps({
      [hostPortOf(alpha)]: { ip: '198.51.100.7', country: 'FR' },
    });
    await checkIpOf(request, alpha.id);
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);
    const chip = sessions.exitChip(exitLine('198.51.100.7', 'FR'));
    await expect(chip).toBeVisible({ timeout: TIMEOUT.BACKGROUND });

    const popover = await sessions.openDetails(exitLine('198.51.100.7', 'FR'));
    await sessions.button(popover, t('viewer.place.restart')).click();
    // The details give way to the question; leaving it alone changes nothing,
    // and the keyboard goes back to the chip once the details are gone.
    const dialog = sessions.restartDialog('Alpha');
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole('dialog', {
        name: t('viewer.details.title'),
        includeHidden: true,
      }),
    ).toHaveCount(0);
    await sessions.button(dialog, t('common.actions.cancel')).click();
    await expect(dialog).toBeHidden();
    await expect(chip).toBeFocused();
    expect((await api.session(alpha.id)).location?.inSync).toBe(false);

    // Asked again and confirmed, the session restarts on the new IP.
    await sessions.openDetails(exitLine('198.51.100.7', 'FR'));
    await sessions
      .button(sessions.detailsPopover, t('viewer.place.restart'))
      .click();
    await sessions.button(dialog, t('sessions.restart.confirm')).click();
    await expect(dialog).toBeHidden();
    await sessions.expectRow(
      'Alpha',
      'running',
      exitLine('198.51.100.7', 'FR'),
      TIMEOUT.BACKGROUND,
    );
    await expect(sessions.outOfSyncBar).toHaveCount(0);
    const fitted = await api.session(alpha.id);
    expect(fitted.location?.ip).toBe('198.51.100.7');
    expect(fitted.location?.inSync).toBe(true);
    await focusRestsOnAControl(page);
  });
});

test.describe('starting a session whose exit IP another running session uses', () => {
  // Two proxy entries that lead to one exit IP: the proxy of Bravo, which
  // exited elsewhere when it was assigned, now exits where Alpha's does.
  async function sharedIp({ api, control }: { api: AppApi; control: Control }) {
    const alpha = await api.startSession('Alpha');
    const bravo = await stoppedSession(api, 'Bravo');
    const ip = alpha.proxy?.exitIp ?? '';
    await control.exitIps({ [hostPortOf(bravo)]: { ip, country: 'DE' } });
    return { alpha, bravo, ip };
  }

  test('asks first from the list, naming the session and the IP, and Cancel leaves it stopped', async ({
    page,
    api,
    control,
  }) => {
    const { bravo, ip } = await sharedIp({ api, control });
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.start('Bravo');
    const dialog = sessions.sharedIpDialog;
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(
        fill(plural(t('sessions.sharedIp.running'), 1), {
          names: quoted('Alpha'),
          ip,
        }),
      ),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        fill(t('sessions.sharedIp.consequence'), { name: quoted('Bravo') }),
      ),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        fill(t('sessions.sharedIp.hint'), { name: quoted('Bravo') }),
      ),
    ).toBeVisible();
    // The page asks instead of telling it as a failure.
    await expect(sessions.toast(t('sessions.toasts.startFailed'))).toHaveCount(
      0,
    );

    await dialog
      .getByRole('button', { name: t('common.actions.cancel'), exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await sessions.expectRow('Bravo', 'stopped');
    await expect(page).toHaveURL(/\/sessions$/);
    // The keyboard is back on the button that asked.
    await expect(sessions.startButton('Bravo')).toBeFocused();
    const left = await api.session(bravo.id);
    expect(left.status).toBe('stopped');
    expect(left.error).toBeNull();
  });

  test('gives three ways out, the one that is advised last and with the keyboard', async ({
    page,
    api,
    control,
  }) => {
    await sharedIp({ api, control });
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.start('Bravo');
    const dialog = sessions.sharedIpDialog;
    await expect(dialog).toBeVisible();
    const cancel = sessions.button(dialog, t('common.actions.cancel'));
    const anyway = sessions.button(dialog, t('sessions.sharedIp.confirm'));
    const rotate = sessions.button(dialog, t('sessions.sharedIp.rotate'));
    // Leave it, start it anyway, or give it another proxy: in that order,
    // from the least advised to the most.
    const [at, atAnyway, atRotate] = await Promise.all(
      [cancel, anyway, rotate].map((button) => button.boundingBox()),
    );
    expect(at?.x).toBeLessThan(atAnyway?.x ?? 0);
    expect(atAnyway?.x).toBeLessThan(atRotate?.x ?? 0);
    // Side by side on one row, as the dialog is wide enough for all three.
    expect(atAnyway?.y).toBeCloseTo(at?.y ?? 0, 0);
    expect(atRotate?.y).toBeCloseTo(at?.y ?? 0, 0);
    await expect(rotate).toBeFocused();
  });

  test('starts anyway from the list when asked to, and opens the session', async ({
    page,
    api,
    control,
  }) => {
    const { alpha, bravo, ip } = await sharedIp({ api, control });
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.start('Bravo');
    await sessions.sharedIpDialog
      .getByRole('button', {
        name: t('sessions.sharedIp.confirm'),
        exact: true,
      })
      .click();
    await expect(sessions.sharedIpDialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/sessions/${bravo.id}$`));

    const started = await api.waitForStatus(bravo.id, 'running');
    expect(started.proxy?.exitIp).toBe(ip);
    // Both sessions now show the same exit IP.
    await sessions.expectRow(
      'Bravo',
      'running',
      exitLine(ip, 'DE'),
      TIMEOUT.BACKGROUND,
    );
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
  });

  test('asks first from the session’s page too, and Start anyway starts it there', async ({
    page,
    api,
    control,
  }) => {
    const { bravo, ip } = await sharedIp({ api, control });
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${bravo.id}`);
    await expect(sessions.detailsHeading).toBeVisible();

    await sessions.headerStart.click();
    const dialog = sessions.sharedIpDialog;
    await expect(
      dialog.getByText(
        fill(plural(t('sessions.sharedIp.running'), 1), {
          names: quoted('Alpha'),
          ip,
        }),
      ),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: t('common.actions.cancel'), exact: true })
      .click();
    await expect(dialog).toBeHidden();
    expect((await api.session(bravo.id)).status).toBe('stopped');
    await expect(sessions.detailsHeading).toBeVisible();
    // The keyboard is back on the header's button.
    await expect(sessions.headerStart).toBeFocused();

    // Asked again, it goes on when told to.
    await sessions.headerStart.click();
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('button', {
        name: t('sessions.sharedIp.confirm'),
        exact: true,
      })
      .click();
    await expect(dialog).toBeHidden();
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    expect((await api.session(bravo.id)).status).toBe('running');
    await expect(sessions.exitChip(exitLine(ip, 'DE'))).toBeVisible();
  });

  test('offers Rotate IP in the question: Enter gives the session another proxy and starts it with that', async ({
    page,
    api,
    control,
  }) => {
    const { alpha, bravo } = await sharedIp({ api, control });
    const [spare] = await api.addProxies(1);
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.start('Bravo');
    const dialog = sessions.sharedIpDialog;
    await expect(dialog).toBeVisible();
    // The advised way out is the one that has the keyboard: Enter takes it.
    await expect(
      sessions.button(dialog, t('sessions.sharedIp.rotate')),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();

    // Bravo moves to the proxy that was free, and starts with it by itself.
    await expect
      .poll(async () => (await api.session(bravo.id)).proxy?.id, {
        timeout: TIMEOUT.BACKGROUND,
      })
      .toBe(spare?.id);
    const started = await api.waitForStatus(bravo.id, 'running');
    expect(started.proxy?.exitIp).not.toBe(alpha.proxy?.exitIp);
    await expect(page).toHaveURL(new RegExp(`/sessions/${bravo.id}$`));
    await sessions.expectRow(
      'Bravo',
      'running',
      lineOf(started),
      TIMEOUT.BACKGROUND,
    );
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));
    // The proxy that led to the shared IP is free again.
    const pool = await api.proxies();
    expect(
      pool.find((proxy) => proxy.id === bravo.proxy?.id)?.session,
    ).toBeNull();
  });

  test('names every running session that uses the IP', async ({
    page,
    api,
    control,
    request,
  }) => {
    const alpha = await api.startSession('Alpha');
    const bravo = await api.startSession('Bravo');
    const charlie = await stoppedSession(api, 'Charlie');
    const ip = alpha.proxy?.exitIp ?? '';
    // Alpha, Bravo and Charlie come to exit through the same IP; the check of
    // Bravo's proxy is how the app learns that Bravo's does.
    await control.exitIps({
      [hostPortOf(bravo)]: { ip, country: 'DE' },
      [hostPortOf(charlie)]: { ip, country: 'DE' },
    });
    await checkIpOf(request, bravo.id);
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.start('Charlie');
    // "The running sessions "Alpha" and "Bravo" already use the exit IP …": the
    // order of the names is the backend's.
    const [before = '', after = ''] = fill(
      plural(t('sessions.sharedIp.running'), 2),
      { ip },
    ).split('{names}');
    const sentence = sessions.sharedIpDialog.getByText(
      new RegExp(`^${literally(before).source}(.+)${literally(after).source}$`),
    );
    await expect(sentence).toBeVisible();
    const names = (await sentence.innerText()).slice(
      before.length,
      -after.length,
    );
    expect(names).toContain(quoted('Alpha'));
    expect(names).toContain(quoted('Bravo'));
    expect(names).not.toContain('Charlie');
    await sessions.sharedIpDialog
      .getByRole('button', { name: t('common.actions.cancel'), exact: true })
      .click();
    expect((await api.session(charlie.id)).status).toBe('stopped');
  });

  for (const [language, locale] of [
    ['de', 'de-DE'],
    ['fr', 'fr-FR'],
  ] as const) {
    test(`keeps its three buttons inside the dialog, side by side, in ${language}`, async ({
      browser,
      api,
      control,
    }) => {
      const { bravo } = await sharedIp({ api, control });
      const words = tIn[language];
      const context = await browser.newContext({
        locale,
        viewport: { width: 1440, height: 900 },
      });
      try {
        const page = await context.newPage();
        await page.goto(`/sessions/${bravo.id}`);
        await page
          .getByRole('button', {
            name: words('viewer.actions.start'),
            exact: true,
          })
          .click();
        const dialog = page.getByRole('dialog', {
          name: words('sessions.sharedIp.title'),
          exact: true,
        });
        await expect(dialog).toBeVisible();

        const frame = await dialog.boundingBox();
        if (frame === null) throw new Error('The dialog has no box');
        const rows = new Set<number>();
        for (const label of [
          words('common.actions.cancel'),
          words('sessions.sharedIp.confirm'),
          words('sessions.sharedIp.rotate'),
        ]) {
          const button = dialog.getByRole('button', {
            name: label,
            exact: true,
          });
          await expect(button, label).toBeVisible();
          const box = await button.boundingBox();
          if (box === null) throw new Error(`${label} has no box`);
          expect(box.x, `${label}: left edge`).toBeGreaterThanOrEqual(frame.x);
          expect(box.x + box.width, `${label}: right edge`).toBeLessThanOrEqual(
            frame.x + frame.width,
          );
          expect(box.y, `${label}: top edge`).toBeGreaterThanOrEqual(frame.y);
          expect(
            box.y + box.height,
            `${label}: bottom edge`,
          ).toBeLessThanOrEqual(frame.y + frame.height);
          rows.add(Math.round(box.y));
        }
        // On one row: the dialog is wide enough for the longest of the three languages.
        expect([...rows], 'the rows the buttons are on').toHaveLength(1);
      } finally {
        await context.close();
      }
    });
  }
});

test.describe('a start that goes wrong', () => {
  test('ends in the error state, worded alike in the list and on the page, and works once the fault is gone', async ({
    page,
    api,
    control,
  }) => {
    await api.addProxies(1);
    // Playwright-style errors carry a long call log after their first line.
    const reason = 'Camoufox exited with code 9';
    await control.faults({
      launchError: `${reason}\n${CALL_LOG}:\n  - <launching> /path/to/camoufox`,
    });
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.add({ name: 'Alpha' });
    await expect(page).toHaveURL(/\/sessions\/\d+$/);
    const id = sessionIdOf(page.url());
    // The list gives the first line of what the browser said.
    await sessions.expectRow('Alpha', 'error', reason, TIMEOUT.BACKGROUND);
    await expect(sessions.headerState('error')).toBeVisible();
    await expect(sessions.pageStatus(reason)).toBeVisible();
    // The same sentence in the row and on the page, and nothing of the call log.
    await expect(page.getByText(reason, { exact: true })).toHaveCount(2);
    await expect(page.getByText(CALL_LOG)).toHaveCount(0);
    const failed = await api.session(id);
    expect(failed.status).toBe('error');
    expect(failed.error).toBe(reason);
    // The body is the details of the session, as for any session that is not running.
    await expectDetails(sessions.pageDetails, failed);
    // The header says how to go on: start again, the session keeps its proxy.
    await expect(sessions.headerStart).toBeEnabled();

    await control.faults({ launchError: null });
    await sessions.headerStart.click();
    const running = await api.waitForStatus(id, 'running');
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await sessions.expectRow(
      'Alpha',
      'running',
      lineOf(running),
      TIMEOUT.BACKGROUND,
    );
    expect(running.error).toBeNull();
    expect(running.proxy?.id).toBe(failed.proxy?.id);
  });

  test('can be started again from the row of the failed session', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await stoppedSession(api, 'Alpha');
    await control.faults({ launchError: 'The browser could not be opened' });
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.start('Alpha');
    await sessions.expectRow(
      'Alpha',
      'error',
      'The browser could not be opened',
      TIMEOUT.BACKGROUND,
    );
    // An error is not a dead end: the row offers Start, not Stop.
    await expect(sessions.startButton('Alpha')).toBeEnabled();
    await expect(sessions.stopButton('Alpha')).toHaveCount(0);

    await control.faults({ launchError: null });
    await sessions.start('Alpha');
    await sessions.expectRow(
      'Alpha',
      'running',
      lineOf(alpha),
      TIMEOUT.BACKGROUND,
    );
  });

  test('a session that finds no proxy that works says how many failed, asks for proxies, and starts once one is added', async ({
    page,
    api,
    control,
  }) => {
    // A session without a proxy (its proxy was deleted) is given one when it
    // starts; the only proxy there is fails its check.
    const alpha = await stoppedWithoutProxy(api, 'Alpha');
    const [only] = await api.addProxies(1);
    await control.exitIps({
      [`${only?.host}:${only?.port}`]: { error: 'connection refused' },
    });
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);
    await expect(sessions.detailsHeading).toBeVisible();

    await sessions.headerStart.click();
    // The page watched the start: it ended for want of a proxy that works, and it asks.
    const dialog = sessions.noWorkingProxyDialog;
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.BACKGROUND });
    const intro = fill(
      plural(plural(t('sessions.noWorking.introFailed'), 1), 1),
      { names: quoted('Alpha') },
    );
    await expect(dialog.getByText(intro, { exact: true })).toBeVisible();
    await sessions.button(dialog, t('common.actions.cancel')).click();
    await expect(dialog).toBeHidden();

    // The session says it in the page's words, with the count, in the list and on its page.
    const sentence = plural(t('errors.no_working_proxy_failed'), 1);
    await sessions.expectRow('Alpha', 'error', sentence);
    await expect(sessions.headerState('error')).toBeVisible();
    await expect(sessions.pageStatus(sentence)).toBeVisible();
    await expect(page.getByText(sentence, { exact: true })).toHaveCount(2);
    expect((await api.session(alpha.id)).errorCode).toBe('no_working_proxy');

    // The page leads to adding proxies, and the session starts once one is added.
    await page
      .getByRole('button', {
        name: t('viewer.actions.addProxies'),
        exact: true,
      })
      .click();
    await expect(dialog).toBeVisible();
    await sessions.addProxiesIn(dialog, ['203.0.113.64:8080']);
    await expect(dialog).toBeHidden();
    const running = await api.waitForStatus(alpha.id, 'running');
    expect(running.proxy?.exitIp).toBe('203.0.113.64');
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
  });

  test('a session that cannot be given an identity is refused with a toast, and nothing is created', async ({
    page,
    api,
    control,
  }) => {
    await api.addProxies(1);
    await control.faults({ identityError: 'No unused fingerprint is left' });
    const sessions = new SessionsPage(page);
    await sessions.open();

    const dialog = await sessions.add({ name: 'Alpha' });
    const toast = sessions.toast(t('errors.fingerprint_exhausted'));
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(t('sessions.toasts.createFailed'));
    expect(await api.sessions()).toEqual([]);
    // The dialog is still there, and works once the fault is gone.
    await expect(dialog).toBeVisible();
    await expect(sessions.nameField(dialog)).toHaveValue('Alpha');

    await control.faults({ identityError: null });
    await sessions.submitAdd(dialog);
    await expect(dialog).toBeHidden();
    await expect(sessions.row('Alpha')).toBeVisible();
    expect(await api.sessions()).toHaveLength(1);
  });
});

test.describe('a browser that dies', () => {
  test('is noticed by the open list within its poll interval, without a reload, and the session starts again', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await api.startSession('Alpha');
    const bravo = await api.startSession('Bravo');
    const sessions = new SessionsPage(page);
    await sessions.open();
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));
    await page.evaluate(() => Reflect.set(window, 'sessionsStayedOpen', true));

    await control.crash('Alpha');
    await sessions.expectRow('Alpha', 'stopped', undefined, TIMEOUT.BACKGROUND);
    await expect(sessions.startButton('Alpha')).toBeEnabled();
    // The other session did not notice, and the page was not reloaded.
    await sessions.expectRow('Bravo', 'running', lineOf(bravo));
    expect(
      await page.evaluate(() => Reflect.get(window, 'sessionsStayedOpen')),
    ).toBe(true);
    const crashed = await api.session(alpha.id);
    expect(crashed.status).toBe('stopped');
    expect(crashed.error).toBeNull();
    expect((await control.browser('Alpha')).closed).toBe(true);

    // A browser that died is a session that stopped: it starts like one.
    await sessions.start('Alpha');
    await expect(page).toHaveURL(new RegExp(`/sessions/${alpha.id}$`));
    await sessions.expectRow(
      'Alpha',
      'running',
      lineOf(alpha),
      TIMEOUT.BACKGROUND,
    );
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    expect((await control.browser('Alpha')).closed).toBe(false);
  });

  test('is noticed by the open page of the session, which offers to start it again', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });

    await control.crash('Alpha');
    await expect(sessions.detailsHeading).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await expect(sessions.headerState('stopped')).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await expect(sessions.liveStage).toHaveCount(0);
    await sessions.expectRow('Alpha', 'stopped');

    await sessions.headerStart.click();
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await sessions.expectRow(
      'Alpha',
      'running',
      lineOf(alpha),
      TIMEOUT.BACKGROUND,
    );
  });
});

test.describe('a proxy that stops working', () => {
  const REASON = 'the proxy refused the connection';
  /** The sentence for a proxy that does not work, with the cause the check found. */
  const unreachable = fill(t('errors.proxy_unreachable_reason'), {
    reason: REASON,
  });

  test('is told once by Check IP, with its cause, while the session keeps running, and is forgiven when it works again', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();
    await control.exitIps({ [hostPortOf(alpha)]: { error: REASON } });

    await sessions.choose('Alpha', 'checkIp');
    const toast = sessions.toast(unreachable);
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(t('sessions.toasts.checkIpFailed'));
    // A running session is not touched by a failed look at its proxy.
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));
    expect((await api.session(alpha.id)).status).toBe('running');
    const [failed] = await api.proxies();
    expect(failed?.check.status).toBe('failed');
    expect(failed?.check.error).toBe(REASON);

    await control.exitIps({
      [hostPortOf(alpha)]: { ip: alpha.proxy?.exitIp ?? '', country: 'DE' },
    });
    await sessions.choose('Alpha', 'checkIp');
    await expect(
      sessions.toast(
        fill(t('sessions.notices.ipSame'), { ip: alpha.proxy?.exitIp ?? '' }),
      ),
    ).toBeVisible();
    expect((await api.proxies())[0]?.check.status).toBe('ok');
  });

  test('refuses a start with a question, and Cancel leaves the session in the error it shows, from which the page’s Rotate IP leads to a running session', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await stoppedSession(api, 'Alpha');
    const [spare] = await api.addProxies(1);
    await control.exitIps({ [hostPortOf(alpha)]: { error: REASON } });
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.start('Alpha');
    const dialog = sessions.brokenProxyDialog('Alpha');
    await expect(dialog).toBeVisible();
    // The title says which proxy does not work, the description why, the hint what the button does.
    await expect(
      dialog.getByText(
        fill(t('sessions.brokenProxy.reason'), { reason: REASON }),
      ),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        fill(t('sessions.brokenProxy.hint'), { name: quoted('Alpha') }),
      ),
    ).toBeVisible();
    // The page asks instead of telling it as a failure.
    await expect(sessions.toast(t('sessions.toasts.startFailed'))).toHaveCount(
      0,
    );
    await sessions.button(dialog, t('common.actions.cancel')).click();
    await expect(dialog).toBeHidden();
    await expect(sessions.startButton('Alpha')).toBeFocused();

    // The failure is the session's state, in the page's words with its cause.
    await sessions.expectRow('Alpha', 'error', unreachable, TIMEOUT.BACKGROUND);
    const failed = await api.session(alpha.id);
    expect(failed.errorCode).toBe('proxy_unreachable');
    expect(failed.proxy?.id).toBe(alpha.proxy?.id);
    await sessions.rowLink('Alpha').click();
    await expect(sessions.headerState('error')).toBeVisible();
    await expect(sessions.pageStatus(unreachable)).toBeVisible();
    await expect(page.getByText(unreachable, { exact: true })).toHaveCount(2);

    // The page puts Rotate IP first: another proxy is the way on, and it starts.
    await page
      .getByRole('button', { name: t('viewer.actions.rotate'), exact: true })
      .click();
    await expect
      .poll(async () => (await api.session(alpha.id)).proxy?.id, {
        timeout: TIMEOUT.BACKGROUND,
      })
      .toBe(spare?.id);
    const running = await api.waitForStatus(alpha.id, 'running');
    expect(running.error).toBeNull();
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await sessions.expectRow(
      'Alpha',
      'running',
      lineOf(running),
      TIMEOUT.BACKGROUND,
    );
  });

  test('offers Rotate IP in the question: Enter gives the session another proxy and starts it with that', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await stoppedSession(api, 'Alpha');
    const [spare] = await api.addProxies(1);
    await control.exitIps({ [hostPortOf(alpha)]: { error: REASON } });
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.start('Alpha');
    const dialog = sessions.brokenProxyDialog('Alpha');
    await expect(dialog).toBeVisible();
    // The way advised has the keyboard: Enter takes it.
    await expect(
      sessions.button(dialog, t('sessions.brokenProxy.rotate')),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();

    await expect
      .poll(async () => (await api.session(alpha.id)).proxy?.id, {
        timeout: TIMEOUT.BACKGROUND,
      })
      .toBe(spare?.id);
    const running = await api.waitForStatus(alpha.id, 'running');
    await expect(page).toHaveURL(new RegExp(`/sessions/${alpha.id}$`));
    await sessions.expectRow(
      'Alpha',
      'running',
      lineOf(running),
      TIMEOUT.BACKGROUND,
    );
    // The proxy that failed is free of the session, and still not given out.
    const pool = await api.proxies();
    const old = pool.find((proxy) => proxy.id === alpha.proxy?.id);
    expect(old?.session).toBeNull();
    expect(old?.check.status).toBe('failed');
  });

  test('asks for proxies when Rotate IP finds no other one, and the session moves and starts once one is added', async ({
    page,
    api,
    control,
  }) => {
    // The only proxy there is does not work any more.
    const alpha = await stoppedSession(api, 'Alpha');
    await control.exitIps({ [hostPortOf(alpha)]: { error: REASON } });
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.start('Alpha');
    await expect(sessions.brokenProxyDialog('Alpha')).toBeVisible();
    await sessions
      .button(
        sessions.brokenProxyDialog('Alpha'),
        t('sessions.brokenProxy.rotate'),
      )
      .click();

    // The question gives way to the form that adds proxies, worded for a rotation.
    const dialog = sessions.noFreeProxyDialog;
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(t('sessions.noProxy.intro.rotate'));
    await sessions.addProxiesIn(dialog, ['203.0.113.67:8080']);
    await expect(dialog).toBeHidden();

    await expect
      .poll(async () => (await api.session(alpha.id)).proxy?.exitIp, {
        timeout: TIMEOUT.BACKGROUND,
      })
      .toBe('203.0.113.67');
    const running = await api.waitForStatus(alpha.id, 'running');
    await expect(page).toHaveURL(new RegExp(`/sessions/${alpha.id}$`));
    await sessions.expectRow(
      'Alpha',
      'running',
      lineOf(running),
      TIMEOUT.BACKGROUND,
    );
  });

  test('refuses a restart for a proxy that does not work, tells it once, and leaves the browser open', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();
    await control.exitIps({ [hostPortOf(alpha)]: { error: REASON } });

    await sessions.choose('Alpha', 'restart');
    const dialog = sessions.restartDialog('Alpha');
    await sessions.button(dialog, t('sessions.restart.confirm')).click();
    const toast = sessions.toast(unreachable);
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(t('sessions.toasts.restartFailed'));

    // The proxy was looked at before anything was closed: the session runs on.
    await sessions.button(dialog, t('common.actions.cancel')).click();
    await expect(dialog).toBeHidden();
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));
    const same = await api.session(alpha.id);
    expect(same.status).toBe('running');
    expect(same.error).toBeNull();
    expect((await control.browser('Alpha')).closed).toBe(false);
  });
});

test.describe('the words of an error', () => {
  // The backend's own sentence is for API and MCP clients: the page words an
  // error from its code, and from what the backend names beside it.
  const BACKEND_SENTENCE = API_SENTENCE;

  const failures: Array<{
    title: string;
    code: string;
    extra: Record<string, string | number> | null;
    /** What the row and the page say. */
    says: () => string;
    /** The button the page offers to go on. */
    offers: () => string;
  }> = [
    {
      title: 'a proxy that does not work, with the cause its check found',
      code: 'proxy_unreachable',
      extra: { proxyId: 1, reason: 'connection reset by peer' },
      says: () =>
        fill(t('errors.proxy_unreachable_reason'), {
          reason: 'connection reset by peer',
        }),
      offers: () => t('viewer.actions.rotate'),
    },
    {
      title: 'a proxy that does not work, when no cause is known',
      code: 'proxy_unreachable',
      extra: { proxyId: 1 },
      says: () => t('errors.proxy_unreachable'),
      offers: () => t('viewer.actions.rotate'),
    },
    {
      title: 'an exit IP whose place cannot be found, with the cause',
      code: 'unknown_ip_location',
      extra: { reason: 'the database has no entry for it' },
      says: () =>
        fill(t('errors.unknown_ip_location_reason'), {
          reason: 'the database has no entry for it',
        }),
      offers: () => t('viewer.actions.rotate'),
    },
    {
      title: 'an exit IP whose place cannot be found, when no cause is known',
      code: 'unknown_ip_location',
      extra: null,
      says: () => t('errors.unknown_ip_location'),
      offers: () => t('viewer.actions.rotate'),
    },
    {
      title: 'no proxy that works, with how many failed their check',
      code: 'no_working_proxy',
      extra: { failed: 3 },
      says: () => plural(t('errors.no_working_proxy_failed'), 3),
      offers: () => t('viewer.actions.addProxies'),
    },
    {
      title: 'no proxy that works, when the count is not known',
      code: 'no_working_proxy',
      extra: null,
      says: () => t('errors.no_working_proxy'),
      offers: () => t('viewer.actions.addProxies'),
    },
  ];

  for (const failure of failures) {
    test(`${failure.title}: the row and the page say it alike, in the page’s words`, async ({
      page,
      api,
    }) => {
      const alpha = await stoppedSession(api, 'Alpha');
      await changeSessionsOnTheWire(page, (session) => ({
        ...session,
        status: 'error',
        error: BACKEND_SENTENCE,
        errorCode: failure.code,
        errorExtra: failure.extra,
      }));
      const sessions = new SessionsPage(page);
      await sessions.open(`/sessions/${alpha.id}`);

      await sessions.expectRow('Alpha', 'error', failure.says());
      await expect(sessions.pageStatus(failure.says())).toBeVisible();
      await expect(
        page.getByRole('button', { name: failure.offers(), exact: true }),
      ).toBeVisible();
      await expect(page.getByText(BACKEND_SENTENCE)).toHaveCount(0);
    });
  }

  test('a failure the page has no words for says what the backend said', async ({
    page,
    api,
  }) => {
    const alpha = await stoppedSession(api, 'Alpha');
    const said = 'The browser could not be opened';
    await changeSessionsOnTheWire(page, (session) => ({
      ...session,
      status: 'error',
      error: said,
      errorCode: 'a_code_from_the_future',
      errorExtra: null,
    }));
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);

    await sessions.expectRow('Alpha', 'error', said);
    await expect(sessions.pageStatus(said)).toBeVisible();
  });

  test('an error with nothing to say about it is only called an error, and the page says the start failed', async ({
    page,
    api,
  }) => {
    const alpha = await stoppedSession(api, 'Alpha');
    await changeSessionsOnTheWire(page, (session) => ({
      ...session,
      status: 'error',
      error: null,
      errorCode: null,
      errorExtra: null,
    }));
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);

    await sessions.expectRow('Alpha', 'error');
    await expect(sessions.headerState('error')).toBeVisible();
    await expect(
      sessions.pageStatus(t('viewer.card.couldNotStart')),
    ).toBeVisible();
  });

  const refusals: Array<{
    title: string;
    refusal: { status: number; error: string; extra?: Record<string, unknown> };
    says: () => string;
  }> = [
    {
      title: 'a session that is getting a proxy',
      refusal: {
        status: 409,
        error: 'session_busy',
        extra: { doing: 'assigning_proxy' },
      },
      says: () => t('errors.session_busy_assigning_proxy'),
    },
    {
      title: 'a session that is starting',
      refusal: {
        status: 409,
        error: 'session_busy',
        extra: { doing: 'starting' },
      },
      says: () => t('errors.session_busy_starting'),
    },
    {
      title: 'a session that is stopping',
      refusal: {
        status: 409,
        error: 'session_busy',
        extra: { doing: 'stopping' },
      },
      says: () => t('errors.session_busy_stopping'),
    },
    {
      title: 'a session that is busy with something else',
      refusal: { status: 409, error: 'session_busy' },
      says: () => t('errors.session_busy'),
    },
    {
      title: 'a proxy that does not work, with its cause',
      refusal: {
        status: 409,
        error: 'proxy_unreachable',
        extra: { reason: 'connection reset by peer' },
      },
      says: () =>
        fill(t('errors.proxy_unreachable_reason'), {
          reason: 'connection reset by peer',
        }),
    },
    {
      title: 'a session that no longer exists',
      refusal: { status: 404, error: 'session_not_found' },
      says: () => t('errors.session_not_found'),
    },
    {
      title: 'a session that is not running',
      refusal: { status: 409, error: 'session_not_running' },
      says: () => t('errors.session_not_running'),
    },
    {
      title: 'a session that is running already',
      refusal: { status: 409, error: 'session_running' },
      says: () => t('errors.session_running'),
    },
    {
      title: 'a browser that is still being installed',
      refusal: { status: 409, error: 'browser_installing' },
      says: () => t('errors.browser_installing'),
    },
    {
      title: 'a browser that is not installed',
      refusal: { status: 409, error: 'browser_not_installed' },
      says: () => t('errors.browser_not_installed'),
    },
    {
      title: 'a fault of the manager’s own',
      refusal: { status: 500, error: 'internal_error' },
      says: () => t('errors.internal_error'),
    },
    {
      title: 'a code the page has no words for',
      refusal: { status: 400, error: 'a_code_from_the_future' },
      says: () => t('errors.fallback'),
    },
  ];

  for (const { title, refusal, says } of refusals) {
    test(`${title}: Check IP is refused in one toast, in the page’s words and not the backend’s`, async ({
      page,
      api,
    }) => {
      const alpha = await api.startSession('Alpha');
      await refuseWrites(page, /\/api\/sessions\/\d+\/check-ip$/, refusal);
      const sessions = new SessionsPage(page);
      await sessions.open();

      await sessions.choose('Alpha', 'checkIp');
      const toast = sessions.toast(says());
      await expect(toast).toBeVisible();
      await expect(toast).toContainText(t('sessions.toasts.checkIpFailed'));
      await expect(page.getByText(API_SENTENCE)).toHaveCount(0);
      await sessions.expectRow('Alpha', 'running', lineOf(alpha));
    });
  }

  test('a manager that cannot be reached is told as such in the toast of the action', async ({
    page,
    api,
  }) => {
    await api.startSession('Alpha');
    await page.route(/\/api\/sessions\/\d+\/check-ip$/, (route) =>
      route.abort('connectionrefused'),
    );
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.choose('Alpha', 'checkIp');
    const toast = sessions.toast(t('errors.network'));
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(t('sessions.toasts.checkIpFailed'));
  });

  test('an answer that is no answer of the manager’s (a gateway’s page) is told as a server error', async ({
    page,
    api,
  }) => {
    await api.startSession('Alpha');
    await page.route(/\/api\/sessions\/\d+\/check-ip$/, (route) =>
      route.fulfill({
        status: 502,
        contentType: 'text/html',
        body: '<html><body>Bad gateway</body></html>',
      }),
    );
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.choose('Alpha', 'checkIp');
    const toast = sessions.toast(t('errors.server_error'));
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(t('sessions.toasts.checkIpFailed'));
    await expect(page.getByText('Bad gateway')).toHaveCount(0);
  });

  test('an answer the page cannot read is told as one, with what to do', async ({
    page,
    api,
  }) => {
    await api.startSession('Alpha');
    // A success whose body is not a session: a page of another version, a proxy in between.
    await page.route(/\/api\/sessions\/\d+\/check-ip$/, (route) =>
      route.fulfill({ status: 200, json: { unexpected: true } }),
    );
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.choose('Alpha', 'checkIp');
    const toast = sessions.toast(t('errors.bad_answer'));
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(t('sessions.toasts.checkIpFailed'));
  });
});

test.describe('while the browser is not there', () => {
  const states = [
    {
      title: 'is being installed',
      browserInstalling: true,
      reason: () => t('sessions.block.installing'),
    },
    {
      title: 'is not installed',
      browserInstalling: false,
      reason: () => t('sessions.block.missing'),
    },
  ];

  for (const { title, browserInstalling, reason } of states) {
    test(`a browser that ${title}: adding and starting a session are off, and say why`, async ({
      page,
      api,
    }) => {
      const alpha = await stoppedSession(api, 'Alpha');
      await changeMetaOnTheWire(page, (meta) => ({
        ...meta,
        browserInstalled: false,
        browserInstalling,
      }));
      const sessions = new SessionsPage(page);
      await sessions.open();

      // Off, but in the tab order, so that the keyboard is told why too.
      await expect(sessions.addButton).toHaveAttribute(
        'aria-disabled',
        'true',
        {
          timeout: TIMEOUT.BACKGROUND,
        },
      );
      await sessions.addButton.focus();
      await sessions.expectTip(sessions.addButton, reason());
      await expect(sessions.startButton('Alpha')).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      await sessions.rowLink('Alpha').focus();
      await page.keyboard.press('Tab');
      await expect(sessions.startButton('Alpha')).toBeFocused();
      await sessions.expectTip(sessions.startButton('Alpha'), reason());

      // The page of the session says the same of its Start.
      await sessions.rowLink('Alpha').click();
      await expect(sessions.detailsHeading).toBeVisible();
      await expect(sessions.headerStart).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      await sessions.headerStart.focus();
      await sessions.expectTip(sessions.headerStart, reason());
      expect((await api.session(alpha.id)).status).toBe('stopped');
    });
  }
});

test.describe('a refusal is told to the person, and raises no error in the page', () => {
  test('a name that is taken, when renaming', async ({ page, api }) => {
    await api.startSession('Alpha');
    await api.startSession('Bravo');
    const sessions = new SessionsPage(page);
    await sessions.open();
    const problems = watchPageProblems(page);

    await sessions.choose('Alpha', 'rename');
    const dialog = sessions.renameDialog;
    await dialog
      .getByRole('textbox', { name: t('sessions.rename.label'), exact: true })
      .fill('Bravo');
    await sessions.button(dialog, t('sessions.rename.submit')).click();
    await expect(dialog.getByRole('alert')).toHaveText(t('errors.name_taken'));
    await settlePage(page);

    expect(problems).toEqual([]);
  });

  test('a proxy that does not work, when checking the IP', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await api.startSession('Alpha');
    await control.exitIps({
      [hostPortOf(alpha)]: { error: 'the proxy refused the connection' },
    });
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);
    const problems = watchPageProblems(page);

    const popover = await sessions.openDetails(lineOf(alpha));
    await sessions.button(popover, t('sessions.menu.checkIp')).click();
    await expect(
      sessions.toast(t('sessions.toasts.checkIpFailed')),
    ).toBeVisible();
    await settlePage(page);

    expect(problems).toEqual([]);
  });

  test('a proxy that does not work, when restarting', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await api.startSession('Alpha');
    await control.exitIps({
      [hostPortOf(alpha)]: { error: 'the proxy refused the connection' },
    });
    const sessions = new SessionsPage(page);
    await sessions.open();
    const problems = watchPageProblems(page);

    await sessions.choose('Alpha', 'restart');
    await sessions
      .button(sessions.restartDialog('Alpha'), t('sessions.restart.confirm'))
      .click();
    await expect(
      sessions.toast(t('sessions.toasts.restartFailed')),
    ).toBeVisible();
    await settlePage(page);

    expect(problems).toEqual([]);
  });

  test('no proxy to export, when exporting', async ({ page, api }) => {
    await stoppedWithoutProxy(api, 'Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();
    const problems = watchPageProblems(page);

    await sessions.moreButton.click();
    await page
      .getByRole('menuitem', { name: t('sessions.panel.export') })
      .click();
    await expect(
      sessions.toast(t('sessions.toasts.exportFailed')),
    ).toBeVisible();
    await settlePage(page);

    expect(problems).toEqual([]);
  });

  test('an identity that cannot be drawn, when adding', async ({
    page,
    api,
    control,
  }) => {
    await api.addProxies(1);
    await control.faults({ identityError: 'No unused fingerprint is left' });
    const sessions = new SessionsPage(page);
    await sessions.open();
    const problems = watchPageProblems(page);

    await sessions.add({ name: 'Alpha' });
    await expect(
      sessions.toast(t('sessions.toasts.createFailed')),
    ).toBeVisible();
    await settlePage(page);

    expect(problems).toEqual([]);
  });
});

test.describe('exporting the proxies of the sessions', () => {
  test('downloads proxy.json with an entry for each session that has a proxy, credentials included', async ({
    page,
    api,
  }) => {
    // One proxy with a login, as a provider exports it, and one without.
    await importWithCredentials(api, [
      '203.0.113.201:8080:alice:s3cret',
      '203.0.113.202:3128',
    ]);
    await api.createSession('Alpha');
    await api.createSession('Bravo');
    await waitUntilAllRun(api);
    // A session that lost its proxy has nothing to export.
    await stoppedWithoutProxy(api, 'Charlie');
    const sessions = new SessionsPage(page);
    await sessions.open();
    await expect(sessions.total(3)).toBeVisible();

    await sessions.moreButton.click();
    const item = page.getByRole('menuitem', {
      name: t('sessions.panel.export'),
    });
    await expect(item).toContainText(t('sessions.panel.exportNote'));
    const download = page.waitForEvent('download');
    await item.click();
    const file = await download;

    expect(file.suggestedFilename()).toBe('proxy.json');
    const text = await readFile(await file.path(), 'utf8');
    // One entry per proxy, the oldest session first, as sub2api's proxy file is.
    expect(text.match(/"proxy_key":/g)).toHaveLength(2);
    expect(text).toContain(
      '"proxy_key": "http|203.0.113.201|8080|alice|s3cret"',
    );
    expect(text).toContain('"proxy_key": "http|203.0.113.202|3128||"');
    expect(text.endsWith('\n')).toBe(true);
    const exported = proxyExportSchema.parse(JSON.parse(text));
    expect(exported.exported_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(exported.accounts).toEqual([]);
    expect(exported.proxies).toEqual([
      {
        proxy_key: 'http|203.0.113.201|8080|alice|s3cret',
        name: 'Alpha',
        protocol: 'http',
        host: '203.0.113.201',
        port: 8080,
        username: 'alice',
        password: 's3cret',
        status: 'active',
        fallback_mode: 'none',
        expiry_warn_days: 7,
      },
      {
        proxy_key: 'http|203.0.113.202|3128||',
        name: 'Bravo',
        protocol: 'http',
        host: '203.0.113.202',
        port: 3128,
        status: 'active',
        fallback_mode: 'none',
        expiry_warn_days: 7,
      },
    ]);
    await expect(
      sessions.toast(
        fill(t('sessions.notices.exported'), { filename: 'proxy.json' }),
      ),
    ).toBeVisible();
  });

  test('says there is nothing to export while no session has a proxy, and downloads nothing', async ({
    page,
    api,
  }) => {
    await stoppedWithoutProxy(api, 'Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();
    let downloads = 0;
    page.on('download', () => {
      downloads += 1;
    });

    await sessions.moreButton.click();
    await page
      .getByRole('menuitem', { name: t('sessions.panel.export') })
      .click();
    const toast = sessions.toast(t('errors.nothing_to_export'));
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(t('sessions.toasts.exportFailed'));
    expect(downloads).toBe(0);
    await expect(
      sessions.toast(
        fill(t('sessions.notices.exported'), { filename: 'proxy.json' }),
      ),
    ).toHaveCount(0);
  });
});

test.describe('a list longer than a page', () => {
  test('shows the newest sessions first with a count, and loads the rest when the end is reached', async ({
    page,
    api,
  }) => {
    // One session more than a page holds, then one more: each with a proxy of its own.
    const total = SESSIONS_PAGE_SIZE + 2;
    const oldestFirst = Array.from(
      { length: total },
      (_, index) => `S${String(index + 1).padStart(3, '0')}`,
    );
    const created = await createSessions(api, oldestFirst);
    const newestFirst = [...oldestFirst].reverse();
    const byName = new Map(created.map((session) => [session.name, session]));
    const sessions = new SessionsPage(page);
    // Every row says its own name, state and exit IP.
    const expectRows = async (names: readonly string[]) => {
      expect(await sessions.names()).toEqual(names);
      for (const [index, name] of names.entries()) {
        const session = byName.get(name);
        if (session === undefined) throw new Error(`${name} was not created`);
        await expect(
          sessions.rows.nth(index).getByRole('link'),
        ).toHaveAccessibleName(rowName(name, 'running', lineOf(session)));
      }
    };

    // The rest is held back until the test lets it through, so that the list
    // can be seen waiting for it.
    let letThrough: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      letThrough = resolve;
    });
    await page.route(
      new RegExp(`/api/sessions\\?limit=${SESSIONS_PAGE_SIZE * 2}$`),
      async (route) => {
        await held;
        await route.continue();
      },
    );

    await sessions.open();
    await expect(sessions.partial(SESSIONS_PAGE_SIZE, total)).toBeVisible();
    await expect(sessions.rows).toHaveCount(SESSIONS_PAGE_SIZE);
    await expectRows(newestFirst.slice(0, SESSIONS_PAGE_SIZE));

    // Reaching the end of the list asks for the next page, and says it is loading.
    await sessions.partial(SESSIONS_PAGE_SIZE, total).scrollIntoViewIfNeeded();
    await expect(
      sessions.list.getByRole('status').filter({
        hasText: t('sessions.list.loadingMore'),
      }),
    ).toBeVisible();
    await expect(sessions.rows).toHaveCount(SESSIONS_PAGE_SIZE);
    letThrough();
    await expect(sessions.total(total)).toBeVisible();
    await expect(
      sessions.list.getByText(t('sessions.list.loadingMore')),
    ).toHaveCount(0);
    await expect(sessions.rows).toHaveCount(total);
    await expectRows(newestFirst);
    await expect(sessions.partial(SESSIONS_PAGE_SIZE, total)).toHaveCount(0);

    // What was loaded stays current: the oldest row follows its session.
    const oldest = byName.get('S001');
    if (oldest === undefined) throw new Error('S001 was not created');
    await api.stopSession(oldest.id);
    await sessions.expectRow('S001', 'stopped', undefined, TIMEOUT.BACKGROUND);
    await sessions.expectRow(
      'S052',
      'running',
      lineOf(byName.get('S052') ?? oldest),
    );
    await expect(sessions.rows).toHaveCount(total);
  });
});

test.describe('a session opened from its address, in a list longer than a page', () => {
  test('has its row brought into sight, though it is the oldest of all', async ({
    page,
    api,
  }) => {
    const total = SESSIONS_PAGE_SIZE + 2;
    const names = Array.from(
      { length: total },
      (_, index) => `S${String(index + 1).padStart(3, '0')}`,
    );
    const [oldest] = await createSessions(api, names);
    if (oldest === undefined) throw new Error('No session was created');
    const sessions = new SessionsPage(page);
    // The oldest is not among the rows of the first page.
    await sessions.open(`/sessions/${oldest.id}`);

    const row = sessions.rowLink(oldest.name);
    await expect(row).toHaveAttribute('aria-current', 'page', {
      timeout: TIMEOUT.BACKGROUND,
    });
    await expect(sessions.total(total)).toBeVisible();
    await expect(row).toBeInViewport({ ratio: 1 });
  });

  test('is reached in one read from its own id up, and the list pages on from there', async ({
    page,
    api,
  }) => {
    const total = SESSIONS_PAGE_SIZE + 2;
    const names = Array.from(
      { length: total },
      (_, index) => `S${String(index + 1).padStart(3, '0')}`,
    );
    const created = await createSessions(api, names);
    const [oldest, second] = created;
    if (oldest === undefined || second === undefined) {
      throw new Error('The sessions were not created');
    }
    // What the list asks the backend for: the cost of reaching a session that
    // is older than the newest rows is one read, not a page after page.
    const reads: string[] = [];
    page.on('request', (request) => {
      const { pathname, searchParams } = new URL(request.url());
      if (pathname === '/api/sessions') reads.push(searchParams.toString());
    });
    const sessions = new SessionsPage(page);

    // The second oldest is not among the newest rows.
    await sessions.open(`/sessions/${second.id}`);
    const row = sessions.rowLink(second.name);
    await expect(row).toHaveAttribute('aria-current', 'page', {
      timeout: TIMEOUT.BACKGROUND,
    });
    await expect(row).toBeInViewport({ ratio: 1 });
    expect(reads).toContain(`limit=${total}&minId=${second.id}`);
    // The row is at the end of what was read, so the list pages on by itself,
    // from there: the oldest comes with the rest.
    await expect(sessions.total(total)).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await expect(sessions.rowLink(oldest.name)).toBeAttached();
    await expect(sessions.rows).toHaveCount(total);
    // Not the page-by-page read of 50, 100, 150 rows from the newest.
    expect(reads).not.toContain(`limit=${SESSIONS_PAGE_SIZE * 2}`);
  });
});

test.describe('the open list follows the backend, without a reload', () => {
  test('shows a session that was added elsewhere, newest first, and takes it to Running', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));
    await expect(sessions.total(1)).toBeVisible();
    await page.evaluate(() => Reflect.set(window, 'sessionsStayedOpen', true));

    await api.addProxies(1);
    const bravo = await api.createSession('Bravo');
    await expect
      .poll(() => sessions.names(), { timeout: TIMEOUT.BACKGROUND })
      .toEqual(['Bravo', 'Alpha']);
    await expect(sessions.total(2)).toBeVisible();
    const running = await api.waitForStatus(bravo.id, 'running');
    await sessions.expectRow(
      'Bravo',
      'running',
      lineOf(running),
      TIMEOUT.BACKGROUND,
    );
    expect(
      await page.evaluate(() => Reflect.get(window, 'sessionsStayedOpen')),
    ).toBe(true);
  });

  test('follows a session that is stopped and started elsewhere', async ({
    page,
    api,
    request,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));

    await api.stopSession(alpha.id);
    await sessions.expectRow('Alpha', 'stopped', undefined, TIMEOUT.BACKGROUND);
    await expect(sessions.startButton('Alpha')).toBeEnabled();

    await startAgain(request, alpha.id);
    await sessions.expectRow(
      'Alpha',
      'running',
      lineOf(alpha),
      TIMEOUT.BACKGROUND,
    );
    await expect(sessions.stopButton('Alpha')).toBeEnabled();
  });

  test('follows a session that is renamed elsewhere', async ({
    page,
    api,
    request,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));

    await renameElsewhere(request, alpha.id, 'Zulu');
    await expect
      .poll(() => sessions.names(), { timeout: TIMEOUT.BACKGROUND })
      .toEqual(['Zulu']);
    await sessions.expectRow('Zulu', 'running', lineOf(alpha));
  });

  test('drops a session that is deleted elsewhere and counts the rest', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const bravo = await api.startSession('Bravo');
    const sessions = new SessionsPage(page);
    await sessions.open();
    await expect(sessions.total(2)).toBeVisible();

    await api.deleteSession(bravo.id);
    await expect
      .poll(() => sessions.names(), { timeout: TIMEOUT.BACKGROUND })
      .toEqual(['Alpha']);
    await expect(sessions.total(1)).toBeVisible();

    await api.deleteSession(alpha.id);
    await expect(
      sessions.list.getByRole('heading', { name: t('sessions.empty.title') }),
    ).toBeVisible({ timeout: TIMEOUT.BACKGROUND });
  });
});

test.describe('a list that cannot be loaded', () => {
  // The alert says what could not be loaded, and the page's banner says why:
  // the sentence for an unreachable manager is not repeated beside the list.
  const unreachable = t('sessions.list.loadFailed');
  const refreshFailed = t('sessions.list.refreshFailed');

  test('says it, offers Try again, and shows the sessions once the manager answers', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    let reachable = false;
    await page.route(/\/api\/sessions\?/, (route) =>
      reachable ? route.continue() : route.abort('connectionrefused'),
    );
    const sessions = new SessionsPage(page);
    await page.goto('/sessions');

    const failure = sessions.list.getByText(unreachable);
    await expect(failure).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    await expect(sessions.list.getByText(t('errors.network'))).toHaveCount(0);
    const tryAgain = sessions.list.getByRole('button', {
      name: t('common.actions.tryAgain'),
    });
    // Trying again while it is still out of reach says the same.
    await tryAgain.click();
    await expect(failure).toBeVisible();
    await expect(sessions.rows).toHaveCount(0);

    reachable = true;
    await tryAgain.click();
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));
    await expect(failure).toHaveCount(0);
    // The keyboard was on Try again, which is gone: it goes to the list's first control.
    await expect(sessions.addButton).toBeFocused();
  });

  test('keeps the rows it has when a refresh fails, says so above them, and recovers by itself', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));

    let reachable = false;
    await page.route(/\/api\/sessions\?/, (route) =>
      reachable ? route.continue() : route.abort('connectionrefused'),
    );
    // The page asks again within a few seconds, and says it could not.
    const failure = sessions.list.getByText(refreshFailed);
    await expect(failure).toBeVisible({ timeout: TIMEOUT.BACKGROUND });
    await expect(sessions.list.getByText(t('errors.network'))).toHaveCount(0);
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));

    // It goes on asking: the notice goes when the manager answers again.
    reachable = true;
    await expect(failure).toHaveCount(0, { timeout: TIMEOUT.BACKGROUND });
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));
  });
});

test.describe('the out-of-sync bar on a window that is not tall', () => {
  /** The most a bar of one line takes of the window, border and padding with it (CSS pixels). */
  const ONE_LINE_BAR_MAX_PX = 56;
  /** Under it, the bar took more of the picture than a line of text is worth. */
  const PICTURE_KEEPS = 0.75;
  /** Where the window has room to spare, the picture is the size it had. */
  const PICTURE_UNCHANGED = 0.95;

  const windows = [
    { width: 844, height: 390, label: 'a phone held sideways' },
    { width: 640, height: 450, label: 'a small window' },
  ] as const;

  for (const { width, height, label } of windows) {
    test.describe(`${label} (${width} × ${height})`, () => {
      test.use({ viewport: { width, height } });

      test('has a bar of one line, which leaves the picture most of its size', async ({
        page,
        api,
        control,
        request,
      }) => {
        const alpha = await api.startSession('Alpha');
        const sessions = new SessionsPage(page);
        await sessions.openSession(alpha.id, alpha.name);
        await expect(sessions.picture).toBeVisible({
          timeout: TIMEOUT.PICTURE,
        });
        const without = await sessions.picture.boundingBox();
        if (without === null) throw new Error('The picture has no box');

        await control.exitIps({
          [hostPortOf(alpha)]: { ip: '198.51.100.7', country: 'FR' },
        });
        await checkIpOf(request, alpha.id);
        await expect(sessions.outOfSyncBar).toBeVisible({
          timeout: TIMEOUT.BACKGROUND,
        });

        const bar = await sessions.outOfSyncStrip.boundingBox();
        expect(bar?.height).toBeLessThanOrEqual(ONE_LINE_BAR_MAX_PX);
        // The picture made room for it: smaller, but by the bar's height and no more.
        await expect
          .poll(async () => (await sessions.picture.boundingBox())?.height ?? 0)
          .toBeLessThan(without.height);
        const withBar = await sessions.picture.boundingBox();
        expect((withBar?.height ?? 0) / without.height).toBeGreaterThan(
          PICTURE_KEEPS,
        );
        expect((withBar?.width ?? 0) / without.width).toBeGreaterThan(
          PICTURE_KEEPS,
        );
        // Restart session is still there, in the bar's one line.
        await expect(
          sessions.button(sessions.outOfSyncBar, t('viewer.place.restart')),
        ).toBeVisible();
      });
    });
  }

  const roomy = [
    { width: 390, height: 844, label: 'a phone held upright' },
    { width: 1440, height: 900, label: 'a large window' },
  ] as const;

  for (const { width, height, label } of roomy) {
    test.describe(`${label} (${width} × ${height})`, () => {
      test.use({ viewport: { width, height } });

      test('has the roomy bar, and the picture keeps its size', async ({
        page,
        api,
        control,
        request,
      }) => {
        const alpha = await api.startSession('Alpha');
        const sessions = new SessionsPage(page);
        await sessions.openSession(alpha.id, alpha.name);
        await expect(sessions.picture).toBeVisible({
          timeout: TIMEOUT.PICTURE,
        });
        const without = await sessions.picture.boundingBox();
        if (without === null) throw new Error('The picture has no box');

        await control.exitIps({
          [hostPortOf(alpha)]: { ip: '198.51.100.7', country: 'FR' },
        });
        await checkIpOf(request, alpha.id);
        await expect(sessions.outOfSyncBar).toBeVisible({
          timeout: TIMEOUT.BACKGROUND,
        });

        // It says what to do about it too, which a bar of one line leaves out.
        const bar = await sessions.outOfSyncStrip.boundingBox();
        expect(bar?.height).toBeGreaterThan(ONE_LINE_BAR_MAX_PX);
        await expect(
          sessions.outOfSyncBar.getByText(t('viewer.place.warningHint')),
        ).toBeVisible();
        const withBar = await sessions.picture.boundingBox();
        expect((withBar?.height ?? 0) / without.height).toBeGreaterThan(
          PICTURE_UNCHANGED,
        );
      });
    });
  }
});

test.describe('on a phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  const tabBar = (page: Page) =>
    page.getByRole('navigation', { name: t('navigation.aria.primary') });

  test('the list is a screen of its own, with the tab bar under it, and leads to a session and back', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();

    // No panel beside a page: the list is the page, under the section's name.
    await expect(sessions.panel).toHaveCount(0);
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: t('sessions.panel.title'),
        exact: true,
      }),
    ).toBeVisible();
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));
    await expect(tabBar(page).getByRole('button')).toHaveText([
      t('navigation.sections.sessions'),
      t('navigation.sections.proxies'),
      t('navigation.sections.secrets'),
      t('navigation.sections.settings'),
    ]);
    const sessionsTab = tabBar(page).getByRole('button', {
      name: t('navigation.sections.sessions'),
    });
    await expect(sessionsTab).toHaveAttribute('aria-current', 'page');

    // A tap on the row opens the session, which has the screen to itself.
    await sessions.rowLink('Alpha').tap();
    await expect(page).toHaveURL(new RegExp(`/sessions/${alpha.id}$`));
    await expect(sessions.titleOf('Alpha')).toBeVisible();
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await expect(sessions.list).toHaveCount(0);
    await expect(sessionsTab).toHaveAttribute('aria-current', 'page');

    // The arrow in the header goes back to the list: it leads there, and is
    // not the page the person is on.
    const back = page.getByRole('link', {
      name: t('common.aria.back'),
      exact: true,
    });
    await expect(back).not.toHaveAttribute('aria-current');
    await back.tap();
    await expect(page).toHaveURL(/\/sessions$/);
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));

    // The tab bar leads to the other sections and back.
    await tabBar(page)
      .getByRole('button', { name: t('navigation.sections.proxies') })
      .tap();
    await expect(page).toHaveURL(/\/proxies$/);
    await sessionsTab.tap();
    await expect(page).toHaveURL(/\/sessions$/);
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));
  });

  test('every row action is there without hovering', async ({ page, api }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));

    for (const button of [
      sessions.stopButton('Alpha'),
      sessions.menuButton('Alpha'),
      sessions.addButton,
      sessions.moreButton,
    ]) {
      await expect(button).toBeVisible();
      await expect(button).toHaveCSS('pointer-events', 'auto');
    }

    await sessions.stopButton('Alpha').tap();
    await sessions.expectRow('Alpha', 'stopped', undefined, TIMEOUT.BACKGROUND);
    await sessions.menuButton('Alpha').tap();
    await expect(sessions.menu('Alpha')).toBeVisible();
    await sessions.menuItem('Alpha', 'rename').tap();
    const dialog = sessions.renameDialog;
    await dialog
      .getByRole('textbox', { name: t('sessions.rename.label'), exact: true })
      .fill('Zulu');
    await dialog
      .getByRole('button', { name: t('sessions.rename.submit'), exact: true })
      .tap();
    await expect(dialog).toBeHidden();
    await sessions.expectRow('Zulu', 'stopped');

    // Start opens the session, as it does beside a page.
    await sessions.startButton('Zulu').tap();
    await expect(page).toHaveURL(new RegExp(`/sessions/${alpha.id}$`));
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
  });

  test('a session is added from the phone’s list, and the export is in its menu', async ({
    page,
    api,
  }) => {
    await api.addProxies(1);
    const sessions = new SessionsPage(page);
    await sessions.open();
    await expect(
      sessions.list.getByText(t('sessions.empty.description')),
    ).toBeVisible();

    const dialog = await sessions.add({ name: 'Alpha', os: 'linux' });
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/sessions\/\d+$/);
    await expect(sessions.liveStage).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    expect((await api.sessions()).map((session) => session.os)).toEqual([
      'linux',
    ]);

    await page
      .getByRole('link', { name: t('common.aria.back'), exact: true })
      .tap();
    await sessions.moreButton.tap();
    await expect(
      page.getByRole('menuitem', { name: t('sessions.panel.export') }),
    ).toBeVisible();
  });

  test('the empty list is the whole screen too, and adds proxies right there', async ({
    page,
  }) => {
    const sessions = new SessionsPage(page);
    await sessions.open();

    await expect(
      sessions.list.getByRole('heading', { name: t('sessions.empty.title') }),
    ).toBeVisible();
    await sessions.list
      .getByRole('button', { name: t('sessions.addProxies'), exact: true })
      .tap();
    await expect(sessions.dialog(t('proxies.import.title'))).toBeVisible();
  });

  test('the header of a session keeps its name, state and chip on one screen, and the details fit it', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.openSession(alpha.id, alpha.name);

    await expect(sessions.titleOf('Alpha')).toBeVisible();
    await expect(sessions.headerState('running')).toBeVisible();
    await expect(sessions.headerButton).toBeVisible();
    await expect(sessions.pageMenuButton('Alpha')).toBeVisible();
    // The chip names where the session exits, whether or not its words show.
    await sessions.exitChip(lineOf(alpha)).tap();
    await expect(sessions.detailsPopover).toBeVisible();
    const box = await sessions.detailsPopover.boundingBox();
    const viewport = page.viewportSize();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
      viewport?.width ?? 0,
    );
    await expectDetails(sessions.detailsPopover, alpha);
  });

  test('the first Tab on the page of a session reaches the skip link', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.openSession(alpha.id, alpha.name);

    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('link', { name: t('navigation.skipToContent') }),
    ).toBeFocused();
  });
});

test.describe('with the keyboard', () => {
  test('a row’s buttons are reached by Tab, and Stop is pressed with Space', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();
    await sessions.expectRow('Alpha', 'running', lineOf(alpha));

    // The row's buttons appear when the row is focused, and are next in line.
    await sessions.rowLink('Alpha').focus();
    await page.keyboard.press('Tab');
    await expect(sessions.stopButton('Alpha')).toBeFocused();
    await page.keyboard.press('Space');
    await sessions.expectRow('Alpha', 'stopped', undefined, TIMEOUT.BACKGROUND);
    await expect(sessions.startButton('Alpha')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(sessions.menuButton('Alpha')).toBeFocused();
  });

  test('a row’s menu opens with Enter, is walked with the arrows and closes with Escape, which returns the focus to its button', async ({
    page,
    api,
  }) => {
    await api.startSession('Alpha');
    await api.startSession('Bravo');
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.rowLink('Bravo').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(sessions.menuButton('Bravo')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(sessions.menu('Bravo')).toBeVisible();
    await expect(sessions.menuItem('Bravo', 'rename')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(sessions.menuItem('Bravo', 'restart')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(sessions.menuItem('Bravo', 'rename')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(sessions.menu('Bravo')).toBeHidden();
    await expect(sessions.menuButton('Bravo')).toBeFocused();

    // The same again with Space, and a choice made with Enter.
    await page.keyboard.press('Space');
    await expect(sessions.menu('Bravo')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sessions.menu('Bravo')).toBeHidden();
    await expect(sessions.menuButton('Bravo')).toBeFocused();
    expect(await sessions.names()).toEqual(['Bravo', 'Alpha']);
  });

  test('the arrows, Home and End move between the rows’ links, and Alt with Down or Up opens the next or previous session', async ({
    page,
    api,
  }) => {
    const [alpha, bravo, charlie] = await createSessions(api, [
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
    const sessions = new SessionsPage(page);
    await sessions.open();
    await expect
      .poll(() => sessions.names())
      .toEqual(['Charlie', 'Bravo', 'Alpha']);

    await sessions.rowLink('Charlie').focus();
    await page.keyboard.press('ArrowDown');
    await expect(sessions.rowLink('Bravo')).toBeFocused();
    await page.keyboard.press('End');
    await expect(sessions.rowLink('Alpha')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(sessions.rowLink('Bravo')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(sessions.rowLink('Charlie')).toBeFocused();

    // Alt with an arrow opens a neighbour from wherever the keyboard is: with
    // nothing open yet, the first row; then the next, or the previous.
    await page.keyboard.press('Alt+ArrowDown');
    await expect(page).toHaveURL(new RegExp(`/sessions/${charlie?.id}$`));
    await page.keyboard.press('Alt+ArrowDown');
    await expect(page).toHaveURL(new RegExp(`/sessions/${bravo?.id}$`));
    await page.keyboard.press('Alt+ArrowDown');
    await expect(page).toHaveURL(new RegExp(`/sessions/${alpha?.id}$`));
    await page.keyboard.press('Alt+ArrowUp');
    await expect(page).toHaveURL(new RegExp(`/sessions/${bravo?.id}$`));
  });

  test('Alt with an arrow keeps its meaning in a dialog and in a text field: it opens no session', async ({
    page,
    api,
  }) => {
    const [alpha] = await createSessions(api, ['Alpha', 'Bravo']);
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha?.id}`);

    // In a dialog, and in the field that has the keyboard there.
    const dialog = await sessions.openAddDialog();
    await expect(sessions.nameField(dialog)).toBeFocused();
    await page.keyboard.press('Alt+ArrowDown');
    await page.keyboard.press('Alt+ArrowUp');
    await expect(page).toHaveURL(new RegExp(`/sessions/${alpha?.id}$`));
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // In the address field of the browser, a text field of the page itself.
    const address = page.getByRole('textbox', {
      name: t('viewer.address.label'),
    });
    await address.focus();
    await page.keyboard.press('Alt+ArrowDown');
    await page.keyboard.press('Alt+ArrowUp');
    await expect(page).toHaveURL(new RegExp(`/sessions/${alpha?.id}$`));
    await expect(address).toBeFocused();
  });

  test('the rename dialog keeps the focus inside, starts in its field, and Escape closes it and returns the focus to the menu button', async ({
    page,
    api,
  }) => {
    await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.rowLink('Alpha').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(sessions.menuButton('Alpha')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(sessions.menuItem('Alpha', 'rename')).toBeFocused();
    await page.keyboard.press('Enter');

    const dialog = sessions.renameDialog;
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('textbox', {
        name: t('sessions.rename.label'),
        exact: true,
      }),
    ).toBeFocused();
    // Round and round, forwards and then backwards: the focus never leaves.
    for (let press = 0; press < 9; press += 1) {
      await page.keyboard.press('Tab');
      await expect(dialog.locator(':focus')).toHaveCount(1);
    }
    for (let press = 0; press < 9; press += 1) {
      await page.keyboard.press('Shift+Tab');
      await expect(dialog.locator(':focus')).toHaveCount(1);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(sessions.menuButton('Alpha')).toBeFocused();
    expect(await sessions.names()).toEqual(['Alpha']);
  });

  test('the add dialog keeps the focus inside, and Escape closes it and returns the focus to the button that opened it', async ({
    page,
    api,
  }) => {
    await api.addProxies(1);
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.addButton.focus();
    await page.keyboard.press('Enter');
    const dialog = sessions.addDialog;
    await expect(dialog).toBeVisible();
    await expect(sessions.nameField(dialog)).toBeFocused();
    for (let press = 0; press < 9; press += 1) {
      await page.keyboard.press('Tab');
      await expect(dialog.locator(':focus')).toHaveCount(1);
    }
    // The system is chosen with the keyboard too.
    const system = dialog.getByRole('combobox', {
      name: t('sessions.add.system'),
      exact: true,
    });
    await system.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('option', {
        name: t('sessions.add.os.random'),
        exact: true,
      }),
    ).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(
      page.getByRole('option', {
        name: t('sessions.add.os.windows'),
        exact: true,
      }),
    ).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(
      page.getByRole('option', {
        name: t('sessions.add.os.macos'),
        exact: true,
      }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(system).toHaveText(t('sessions.add.os.macos'));
    await expect(system).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(sessions.addButton).toBeFocused();
    expect(await api.sessions()).toEqual([]);
  });

  test('the delete question keeps the focus inside and Escape leaves the session alone', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.rowLink('Alpha').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(sessions.menuButton('Alpha')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(sessions.menuItem('Alpha', 'rename')).toBeFocused();
    await page.keyboard.press('End');
    await expect(sessions.menuItem('Alpha', 'delete')).toBeFocused();
    await page.keyboard.press('Enter');

    const dialog = sessions.deleteDialog('Alpha');
    await expect(dialog).toBeVisible();
    for (let press = 0; press < 7; press += 1) {
      await page.keyboard.press('Tab');
      await expect(dialog.locator(':focus')).toHaveCount(1);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(sessions.menuButton('Alpha')).toBeFocused();
    expect((await api.session(alpha.id)).status).toBe('running');
  });

  test('the form that adds proxies, opened by a start that lacks one, keeps the focus inside, and Escape gives up and returns the focus to Start', async ({
    page,
    api,
  }) => {
    // Its proxy was deleted, and the pool has nothing else.
    const alpha = await stoppedWithoutProxy(api, 'Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.rowLink('Alpha').focus();
    await page.keyboard.press('Tab');
    await expect(sessions.startButton('Alpha')).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = sessions.noFreeProxyDialog;
    await expect(dialog).toBeVisible();
    // It opens ready for a list, and the focus goes round inside it.
    await expect(sessions.proxyList(dialog)).toBeFocused();
    for (let press = 0; press < 12; press += 1) {
      await page.keyboard.press('Tab');
      await expect(dialog.locator(':focus')).toHaveCount(1);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(sessions.startButton('Alpha')).toBeFocused();
    expect((await api.session(alpha.id)).status).toBe('stopped');
  });

  test('the form that adds proxies, opened by Add session, returns the focus to Add session when it is given up', async ({
    page,
  }) => {
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.addButton.focus();
    await page.keyboard.press('Enter');
    await expect(sessions.addDialog).toBeVisible();
    await page.keyboard.press('Enter');
    const dialog = sessions.noFreeProxyDialog;
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(sessions.addButton).toBeFocused();
  });

  test('the form that adds proxies, opened by the Rotate IP question of a row’s menu, returns the focus to that menu’s button when it is given up', async ({
    page,
    api,
  }) => {
    await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open();

    await sessions.choose('Alpha', 'rotate');
    await sessions
      .button(sessions.rotateDialog('Alpha'), t('sessions.rotate.confirm'))
      .click();
    const dialog = sessions.noFreeProxyDialog;
    await expect(dialog).toBeVisible();

    await sessions.button(dialog, t('common.actions.cancel')).click();
    await expect(dialog).toBeHidden();
    await expect(sessions.menuButton('Alpha')).toBeFocused();
  });

  test('the form that adds proxies, opened by the Rotate IP question of the page’s menu, returns the focus to the header’s menu button when it is given up', async ({
    page,
    api,
  }) => {
    const alpha = await api.startSession('Alpha');
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${alpha.id}`);

    await sessions.pageMenuButton('Alpha').click();
    await sessions.menuItem('Alpha', 'rotate').click();
    await sessions
      .button(sessions.rotateDialog('Alpha'), t('sessions.rotate.confirm'))
      .click();
    const dialog = sessions.noFreeProxyDialog;
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(sessions.pageMenuButton('Alpha')).toBeFocused();
  });

  test('a deleted row leaves the focus in the list, on the row that took its place', async ({
    page,
    api,
  }) => {
    await api.startSession('Alpha');
    await api.startSession('Bravo');
    await api.startSession('Charlie');
    const sessions = new SessionsPage(page);
    await sessions.open();
    await expect
      .poll(() => sessions.names())
      .toEqual(['Charlie', 'Bravo', 'Alpha']);

    // Delete the middle one with the keyboard alone.
    await sessions.rowLink('Bravo').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(sessions.menuButton('Bravo')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(sessions.menuItem('Bravo', 'rename')).toBeFocused();
    await page.keyboard.press('End');
    await expect(sessions.menuItem('Bravo', 'delete')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(sessions.deleteDialog('Bravo')).toBeVisible();
    await sessions
      .deleteDialog('Bravo')
      .getByRole('button', { name: t('sessions.delete.confirm'), exact: true })
      .click();
    await expect(sessions.row('Bravo')).toHaveCount(0);

    // The focus did not fall to the page: it is on a control of the list.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const active = document.activeElement;
          return (
            active !== null &&
            active.closest('[role="region"]') !== null &&
            active !== document.body
          );
        }),
      )
      .toBe(true);
    await expect(sessions.row('Alpha').locator(':focus')).toHaveCount(1);
  });

  test('the first Tab on the page of a session reaches the skip link, though the list scrolled that session’s row into sight', async ({
    page,
    api,
  }) => {
    // More rows than the window shows, and the open session is the oldest.
    const names = Array.from(
      { length: 12 },
      (_, index) => `S${String(index + 1).padStart(2, '0')}`,
    );
    const [oldest] = await createSessions(api, names);
    if (oldest === undefined) throw new Error('No session was created');
    await page.setViewportSize({ width: 1000, height: 420 });
    const sessions = new SessionsPage(page);
    await sessions.open(`/sessions/${oldest.id}`);

    const row = sessions.rowLink(oldest.name);
    await expect(row).toHaveAttribute('aria-current', 'page');
    await expect(row).toBeInViewport();
    // The list was scrolled to it, by its own scroll position, so that the
    // first press of Tab still starts at the top of the page: at the skip link.
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('link', { name: t('navigation.skipToContent') }),
    ).toBeFocused();
  });
});
