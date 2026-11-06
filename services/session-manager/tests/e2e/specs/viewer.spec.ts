import type { Locator, Page } from '@playwright/test';

import type { Session } from '../../../lib/api/schemas';
import { MAX_TAB_TITLE, MAX_TAB_URL, MAX_TEXT } from '../../../lib/live-view';
import type { AppApi } from '../helpers/api';
import { violationsOf } from '../helpers/axe';
import type { BrowserState, Control } from '../helpers/control';
import { TIMEOUT } from '../helpers/env';
import { fill, literally, t } from '../helpers/i18n';
import { waitForPictures, watchLiveView } from '../helpers/live-view';
import { tIn, tabTitle } from '../helpers/settings-i18n';
import { expect, test } from '../helpers/viewer-fixtures';
import {
  ADDRESS_SHORTCUT,
  COMMAND,
  PAGE,
  POINT_TOLERANCE,
  SLOW_START_MS,
  animationsDone,
  answersOf,
  boxOf,
  colourOfPicture,
  colourOfTab,
  distance,
  exitIpOf,
  expectPoint,
  Fake,
  LINE_HEIGHT,
  heldKeys,
  heldWhenPressed,
  historyOf,
  holdLiveView,
  keysOf,
  keyTrace,
  LiveSockets,
  mouseOf,
  navigationsOf,
  NOWHERE,
  notice,
  openTabAt,
  openViewer,
  picksOf,
  plural,
  probePicture,
  recordLiveRegions,
  textsOf,
  titleOf,
  visitViewer,
  WHEEL,
  wheelsOf,
  withNumber,
  Viewer,
} from '../helpers/viewer-stage';
import {
  Finger,
  LONG_PRESS_MS,
  MOUSE_AFTER_DRAG_MS,
  TAP_SLOP,
  letTimePass,
} from '../helpers/viewer-touch';
import { RawViewer } from '../helpers/viewer-wire';

// The live viewer of a running session (`/sessions/:id`): what a person sees and
// does inside it.
//
// The session runs in the fake browser (`backend/testing/fake-browser.ts`): a
// page of 800 x 600 pixels, tabs titled "Title of <url>", one coloured mock-up
// per tab. A test of input asserts what the page sent over the socket
// (`viewer.watch`) and what the fake browser received (`viewer.fake`, the ground
// truth). The fake pushes a new picture whenever the tabs change, as a real
// screencast does, so the canvas follows the tab that is chosen. Labels come
// from the catalogs through `t()`.

test.use({ viewport: { width: 1280, height: 800 } });

/** Tabs enough that they cannot all have room in the strip of a wide window. */
const TABS_IN_MENU = 13;

/**
 * Along the bottom of a mock-up of the fake browser every channel is above 240; a
 * picture that is cut wrongly has an empty, black bar there. Anything above this
 * is a page.
 */
const BLACK_BELOW = 200;

/** Secrets enough that the list of them does not fit in the popover. */
const MANY_SECRETS = 15;

/** The close button of a tab with a mouse: a finger gets a bigger one, and a reach beyond it. */
const MOUSE_CLOSE = 24;

/** A paste a little over what the protocol takes at once, in characters. */
const PASTE_OVER_LIMIT = 5000;

/** A paste over what the socket takes in one message (one MiB): 1.2 million characters. */
const PASTE_OVER_SOCKET = 1_200_000;

/** What the computed style of a border says when it has no colour. */
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

/** WebSocket close code 1013, "try again later": what the server says to a viewer that does not read what it is sent. */
const TRY_AGAIN_LATER = 1013;

/** The characters of the selection that a viewer that does not read asks for, over and over. */
const SELECTION_SIZE = 2 * 1024 * 1024;

/**
 * How many answers it is sent without reading one: far more than the buffers of
 * a socket hold with the 8 MiB that the server keeps for a viewer that is slow.
 */
const ANSWERS_UNREAD = 24;

/** A session's name inside a sentence, quoted the way the language quotes. */
const quoted = (text: string) => fill(t('sessions.quoted'), { text });

/** The Start button of the header: the one way to start a session whose browser is not running. */
const startButton = (page: Page) =>
  page
    .getByRole('main')
    .getByRole('button', { name: t('viewer.actions.start'), exact: true });

test.describe('opening a running session', () => {
  test('shows the session, its exit IP, its tab, its address and the Secrets button', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const { defaultStartPage } = await api.settings();
    const viewer = await openViewer(page, control, session);

    await expect(
      page.getByRole('heading', { level: 1, name: session.name }),
    ).toBeVisible();
    // The line under the name: where the session stands, and where it exits.
    await expect(
      viewer.header.getByText(t('sessions.status.running')),
    ).toBeVisible();
    await expect(viewer.exitChip(exitIpOf(session))).toBeVisible();
    await expect(viewer.stop).toBeVisible();
    await expect(viewer.stop).toBeEnabled();

    await expect(viewer.tabs).toHaveCount(1);
    await expect(viewer.tab(titleOf(defaultStartPage))).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(viewer.address).toHaveValue(defaultStartPage);
    await expect(viewer.address).toBeEnabled();
    for (const button of [
      viewer.back,
      viewer.forward,
      viewer.reload,
      viewer.newTab,
      viewer.secrets,
    ]) {
      await expect(button).toBeEnabled();
    }
    // The tab of the browser names the session, so that several open ones stay apart.
    await expect(page).toHaveTitle(tabTitle(session.name));
  });

  test('draws the pictures of the page on the canvas, and not a blank one', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);

    const probe = await probePicture(page);
    expect(
      probe.colours,
      'the picture holds more than one colour',
    ).toBeGreaterThan(8);
    expect(colourOfPicture(probe), 'the first tab has the first colour').toBe(
      colourOfTab(viewer.serverTabs()[0]?.id ?? 0),
    );
    // The first picture of a view comes after the message that says how big the page is.
    const view = viewer.watch
      .received()
      .find((message) => message.t === 'view');
    expect(view).toMatchObject({ w: PAGE.width, h: PAGE.height });
  });

  test('lays the picture out at the size of the page and scales it down, undistorted, with the window', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);

    const windows = [
      { width: 1600, height: 1000 },
      { width: 1280, height: 800 },
      { width: 1000, height: 700 },
      { width: 820, height: 640 },
    ];
    for (const size of windows) {
      await page.setViewportSize(size);
      await expect
        .poll(
          async () => {
            const room = await boxOf(viewer.room);
            const box = await boxOf(viewer.picture);
            const scale = Math.min(
              room.width / PAGE.width,
              room.height / PAGE.height,
              1,
            );
            // Whole pixels, centred in the room, the shape of the page.
            return {
              width: Math.abs(box.width - PAGE.width * scale) <= 1,
              height: Math.abs(box.height - PAGE.height * scale) <= 1,
              centred:
                Math.abs(box.x - room.x - (room.width - box.width) / 2) <= 1 &&
                Math.abs(box.y - room.y - (room.height - box.height) / 2) <= 1,
              shape:
                Math.abs(box.width / box.height - PAGE.width / PAGE.height) <
                0.01,
              neverLarger: box.width <= PAGE.width && box.height <= PAGE.height,
            };
          },
          {
            message: `the picture fits the room at ${size.width} x ${size.height}`,
            timeout: TIMEOUT.VISIBLE,
          },
        )
        .toEqual({
          width: true,
          height: true,
          centred: true,
          shape: true,
          neverLarger: true,
        });
    }
    // At the end the window is too small for the page: the picture is smaller than it.
    expect((await boxOf(viewer.picture)).width).toBeLessThan(PAGE.width);
    // After all the resizing the canvas still shows the picture it was given.
    expect(colourOfPicture(await probePicture(page))).toBe(colourOfTab(1));
  });

  test('shows the whole picture of the page: nothing of it is cut off at any edge', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    // The picture is cut to what the window of the real browser has room for. The fake browser
    // has a window as big as its page, so no edge is lost: the picture is the page, all of it.
    const view = viewer.watch
      .received()
      .findLast((message) => message.t === 'view');
    expect(view).toMatchObject({ w: PAGE.width, h: PAGE.height });

    const shape = PAGE.width / PAGE.height;
    const box = await boxOf(viewer.picture);
    expect(box.width / box.height).toBeCloseTo(shape, 2);
    const probe = await probePicture(page);
    expect(probe.width / probe.height).toBeCloseTo(shape, 2);
    // The last rows are the page's own, not an empty bar along the bottom.
    for (const channel of probe.foot) {
      expect(channel, 'the foot of the picture is not black').toBeGreaterThan(
        BLACK_BELOW,
      );
    }
  });
});

test.describe('the exit IP and the place of the session', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  const detailsOf = (page: Page) =>
    page.getByRole('dialog', { name: t('viewer.details.title') });
  /** The row of a property in the details: its label and its value. */
  const rowOf = (details: Locator, label: string) =>
    details.getByText(label, { exact: true }).locator('xpath=..');
  /** The proxy of the session now exits through `ip`: the fake checker answers by the proxy's host and port. */
  const exitThrough = async (control: Control, session: Session, ip: string) =>
    control.exitIps({
      [new URL(session.proxy?.display ?? '').host]: { ip, country: 'DE' },
    });

  test('the chip of the exit IP opens the details of the session: its system, screen, language, time zone and location', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const place = session.location;
    const ip = exitIpOf(session);
    const details = detailsOf(page);

    await expect(viewer.exitChip(ip)).toHaveAttribute('aria-expanded', 'false');
    await viewer.exitChip(ip).click();

    await expect(details).toBeVisible();
    await expect(viewer.exitChip(ip)).toHaveAttribute('aria-expanded', 'true');
    const system = t(`sessions.add.os.${session.os}`);
    const rows = [
      [t('viewer.card.system'), system],
      [t('viewer.card.screen'), session.fingerprint.screen?.replace('x', '×')],
      [t('viewer.card.language'), session.fingerprint.locale],
      [t('viewer.card.timeZone'), session.fingerprint.timezone],
      [
        t('viewer.card.location'),
        `${place?.latitude.toFixed(3)} / ${place?.longitude.toFixed(3)}`,
      ],
      [t('viewer.card.ipAddress'), `${ip} · ${session.proxy?.country}`],
    ] as const;
    for (const [label, value] of rows) {
      await expect(rowOf(details, label), label).toContainText(value ?? '');
    }
    // Where the place comes from, and that it still fits the exit IP.
    await expect(details).toContainText(
      fill(t('viewer.details.source'), { ip }),
    );
    await expect(details).toContainText(t('viewer.chip.inSync'));
    // Nothing to restart while it fits.
    await expect(
      details.getByRole('button', { name: t('viewer.place.restart') }),
    ).toHaveCount(0);
  });

  test('Escape closes the details and the keyboard goes back to the chip', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const chip = viewer.exitChip(exitIpOf(session));
    await chip.click();
    await expect(detailsOf(page)).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(detailsOf(page)).toBeHidden();
    await expect(chip).toBeFocused();
    await expect(chip).toHaveAttribute('aria-expanded', 'false');
  });

  test('copying the exit IP in the details puts it on the clipboard', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await page.evaluate(() => navigator.clipboard.writeText('before'));
    await viewer.exitChip(exitIpOf(session)).click();

    await detailsOf(page)
      .getByRole('button', { name: t('viewer.details.copyIp') })
      .click();

    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
        timeout: TIMEOUT.VISIBLE,
        message: 'the exit IP is on the clipboard',
      })
      .toBe(exitIpOf(session));
  });

  test('Check IP in the details looks at the proxy again and says that the place still matches', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const ip = exitIpOf(session);
    await viewer.exitChip(ip).click();

    await detailsOf(page)
      .getByRole('button', { name: t('sessions.menu.checkIp') })
      .click();

    await expect(
      notice(page, fill(t('sessions.notices.ipSame'), { ip })),
    ).toBeVisible();
    // The details stay where they were, and say the same.
    await expect(detailsOf(page)).toContainText(t('viewer.chip.inSync'));
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: t('viewer.place.warningTitle') }),
    ).toHaveCount(0);
  });

  test('warns when the proxy exits through another IP now: the chip, the details and a bar say so', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const was = exitIpOf(session);
    const now = '203.0.113.99';
    await exitThrough(control, session, now);
    await viewer.exitChip(was).click();

    await detailsOf(page)
      .getByRole('button', { name: t('sessions.menu.checkIp') })
      .click();

    await expect(
      notice(page, fill(t('sessions.notices.ipChanged'), { now, was })),
    ).toBeVisible();
    // The chip shows the IP the proxy has now, and a screen reader is told what that means.
    await expect(viewer.exitChip(now)).toHaveAccessibleDescription(
      t('viewer.chip.outOfSync'),
    );
    await expect(detailsOf(page)).toContainText(t('viewer.chip.outOfSync'));
    await expect(
      rowOf(detailsOf(page), t('viewer.card.ipAddress')),
    ).toContainText(now);
    // The place is still the one of the old IP.
    await expect(detailsOf(page)).toContainText(
      fill(t('viewer.details.source'), { ip: was }),
    );
    // The bar under the toolbar: what changed, and the way to put it right.
    const warning = page
      .getByRole('alert')
      .filter({ hasText: t('viewer.place.warningTitle') });
    await expect(warning).toContainText(
      fill(t('viewer.place.warning'), { current: now, reported: was }),
    );
    await expect(warning).toContainText(t('viewer.place.warningHint'));
  });

  test('the bar that warns offers the restart that matches the place to the new IP', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const was = exitIpOf(session);
    const now = '203.0.113.99';
    await exitThrough(control, session, now);
    await viewer.exitChip(was).click();
    await detailsOf(page)
      .getByRole('button', { name: t('sessions.menu.checkIp') })
      .click();
    const warning = page
      .getByRole('alert')
      .filter({ hasText: t('viewer.place.warningTitle') });
    await expect(warning).toBeVisible();

    // The bar is within reach while the details are open: pressing it closes them, as any press outside does.
    const pictures = viewer.watch.pictures();
    await warning
      .getByRole('button', { name: t('viewer.place.restart') })
      .click();
    const dialog = page.getByRole('dialog', {
      name: fill(t('sessions.restart.title'), { name: quoted(session.name) }),
    });
    await expect(dialog).toContainText(t('sessions.restart.description'));
    await dialog
      .getByRole('button', { name: t('sessions.restart.confirm'), exact: true })
      .click();

    // The browser is opened again for the IP the proxy has now: new pictures, no warning.
    await expect
      .poll(() => viewer.watch.pictures(), { timeout: TIMEOUT.BACKGROUND })
      .toBeGreaterThan(pictures);
    await expect(viewer.picture).toBeVisible();
    await expect(warning).toBeHidden();
    await expect(viewer.exitChip(now)).toBeVisible();
    await expect(viewer.exitChip(was)).toHaveCount(0);
    expect(await api.session(session.id)).toMatchObject({
      status: 'running',
      location: { ip: now, inSync: true },
    });
  });

  test('the details offer the same restart, asked first, and the keyboard goes back to the chip when it is given up', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const was = exitIpOf(session);
    const now = '203.0.113.98';
    await exitThrough(control, session, now);
    await viewer.exitChip(was).click();
    const details = detailsOf(page);
    await details
      .getByRole('button', { name: t('sessions.menu.checkIp') })
      .click();
    await expect(viewer.exitChip(now)).toBeVisible();
    const dialog = page.getByRole('dialog', {
      name: fill(t('sessions.restart.title'), { name: quoted(session.name) }),
    });

    await details
      .getByRole('button', { name: t('viewer.place.restart') })
      .click();

    // The details give way to the question; the session is not restarted by asking.
    await expect(dialog).toBeVisible();
    await expect(details).toBeHidden();
    await dialog
      .getByRole('button', { name: t('common.actions.cancel') })
      .click();
    await expect(dialog).toBeHidden();
    await expect(viewer.exitChip(now)).toBeFocused();
    expect(await api.session(session.id)).toMatchObject({
      location: { ip: was, inSync: false },
    });

    // Asked again and confirmed, it restarts the browser for the IP the proxy has now.
    const pictures = viewer.watch.pictures();
    await viewer.exitChip(now).click();
    await details
      .getByRole('button', { name: t('viewer.place.restart') })
      .click();
    await dialog
      .getByRole('button', { name: t('sessions.restart.confirm'), exact: true })
      .click();
    await expect
      .poll(() => viewer.watch.pictures(), { timeout: TIMEOUT.BACKGROUND })
      .toBeGreaterThan(pictures);
    await expect(viewer.exitChip(now)).toBeVisible();
    expect(await api.session(session.id)).toMatchObject({
      status: 'running',
      location: { ip: now, inSync: true },
    });
  });
});

test.describe('the menu of the session in the header', () => {
  const menuOf = (viewer: Viewer) =>
    viewer.header.getByRole('button', {
      name: fill(t('sessions.row.menu'), { name: viewer.session.name }),
    });

  test('renaming changes the name in the header and leaves the live view alone', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const sockets = await LiveSockets.route(page);
    const viewer = await openViewer(page, control, session);

    await menuOf(viewer).click();
    await page
      .getByRole('menuitem', { name: t('sessions.menu.rename') })
      .click();
    const dialog = page.getByRole('dialog', {
      name: fill(t('sessions.rename.title'), { name: quoted('alpha') }),
    });
    await dialog
      .getByRole('textbox', { name: t('sessions.rename.label') })
      .fill('renamed');
    await dialog
      .getByRole('button', { name: t('sessions.rename.submit') })
      .click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'renamed' }),
    ).toBeVisible();
    await expect(page).toHaveTitle(tabTitle('renamed'));
    await expect(dialog).toBeHidden();
    expect(await api.session(session.id)).toMatchObject({
      name: 'renamed',
      status: 'running',
    });
    // The same browser, the same connection: nothing was reopened.
    await expect(viewer.picture).toBeVisible();
    expect(sockets.attempts).toBe(1);
    expect((await viewer.fake.state()).closed).toBe(false);
  });

  test('restarting reopens the browser with the same tabs, and the viewer follows it', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const second = 'https://example.com/second';
    await openTabAt(viewer, second);
    const pictures = viewer.watch.pictures();

    await menuOf(viewer).click();
    await page
      .getByRole('menuitem', { name: t('sessions.menu.restart'), exact: true })
      .click();
    await page
      .getByRole('dialog', {
        name: fill(t('sessions.restart.title'), {
          name: quoted(session.name),
        }),
      })
      .getByRole('button', { name: t('sessions.restart.confirm'), exact: true })
      .click();

    await expect
      .poll(() => viewer.watch.pictures(), { timeout: TIMEOUT.BACKGROUND })
      .toBeGreaterThan(pictures);
    await viewer.waitUntilLive();
    await expect(viewer.tabs).toHaveCount(2);
    await expect(viewer.tab(titleOf(second))).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(viewer.address).toHaveValue(second);
    // Not the browser it was: it has been told nothing yet.
    expect(await viewer.fake.state()).toMatchObject({
      closed: false,
      events: [],
    });
  });

  test('rotating the IP restarts the browser with another proxy, and the header shows the new exit IP', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const [spare] = await api.addProxies(1);
    const viewer = await openViewer(page, control, session);
    const pictures = viewer.watch.pictures();
    const was = exitIpOf(session);
    // The fake checker's rule: a proxy exits through 203.0.113.<its host's last number>.
    const now = `203.0.113.${spare?.host.split('.').at(-1)}`;

    await menuOf(viewer).click();
    await page
      .getByRole('menuitem', {
        name: literally(t('sessions.menu.rotate')),
      })
      .click();
    await page
      .getByRole('dialog', {
        name: fill(t('sessions.rotate.title'), { name: quoted(session.name) }),
      })
      .getByRole('button', { name: t('sessions.rotate.confirm'), exact: true })
      .click();

    await expect
      .poll(() => viewer.watch.pictures(), { timeout: TIMEOUT.BACKGROUND })
      .toBeGreaterThan(pictures);
    await viewer.waitUntilLive();
    await expect(viewer.exitChip(now)).toBeVisible();
    await expect(viewer.exitChip(was)).toHaveCount(0);
    expect(await api.session(session.id)).toMatchObject({
      status: 'running',
      proxy: { exitIp: now },
      location: { ip: now, inSync: true },
    });
  });

  test('deleting the session closes its browser and goes back to the list of sessions, with nothing logged on the way', async ({
    page,
    api,
    control,
  }) => {
    // A console error would fail the test (`viewer-fixtures.ts`): the page must not ask again for the session it has deleted.
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);

    await menuOf(viewer).click();
    await page
      .getByRole('menuitem', { name: t('common.actions.delete') })
      .click();
    const dialog = page.getByRole('dialog', {
      name: fill(t('sessions.delete.title'), { name: quoted(session.name) }),
    });
    await expect(dialog).toContainText(
      t('sessions.delete.descriptionBrowserOpen'),
    );
    await dialog
      .getByRole('button', { name: t('sessions.delete.confirm') })
      .click();

    await expect(page).toHaveURL(/\/sessions$/);
    await expect(page.getByText(t('sessions.empty.title'))).toBeVisible();
    expect(await api.sessions()).toEqual([]);
    expect((await control.browser(session.name)).closed).toBe(true);
  });

  // The page of the session hands the keyboard on when it leaves while it holds it, so that it
  // lands on the main area whether the next page comes at once or is slow to come (its code is
  // held back here until the dialog has gone, which is the order that used to lose it).
  test('after deleting the session from its own page the keyboard is on the main area, also when the next page is slow to come', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await menuOf(viewer).click();
    await page
      .getByRole('menuitem', { name: t('common.actions.delete') })
      .click();
    const dialog = page.getByRole('dialog', {
      name: fill(t('sessions.delete.title'), { name: quoted(session.name) }),
    });
    // The code of the page that comes next is held back until the dialog has gone.
    let release!: () => void;
    const dialogGone = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/assets/*.js', async (route) => {
      await dialogGone;
      await route.continue();
    });

    await dialog
      .getByRole('button', { name: t('sessions.delete.confirm') })
      .click();
    await expect(dialog).toBeHidden();
    release();

    await expect(page).toHaveURL(/\/sessions$/);
    await expect(page.getByText(t('sessions.index.title'))).toBeVisible();
    await expect(page.getByRole('main')).toBeFocused();
  });
});

test.describe('the layout', () => {
  /**
   * A control with its glyph only is at most 48 px wide (the glyph and its
   * padding); one that also shows its words is more than 100. The words stay its
   * accessible name either way.
   */
  const GLYPH_ONLY_WIDTH = 64;
  const showsWords = async (control: Locator) =>
    (await boxOf(control)).width > GLYPH_ONLY_WIDTH;

  test('gives up what does not fit as the window narrows: the words of the exit IP and of Secrets first, then the shortcut badge', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const chip = viewer.exitChip(exitIpOf(session));
    const badge = page.locator('form', { has: viewer.address }).locator('kbd');

    await test.step('a wide window has room for all of it', async () => {
      await expect.poll(() => showsWords(chip)).toBe(true);
      await expect.poll(() => showsWords(viewer.secrets)).toBe(true);
      await expect(badge).toBeVisible();
    });
    await test.step('a narrower one keeps the glyphs of the chip and of Secrets, and still has the badge', async () => {
      await page.setViewportSize({ width: 860, height: 700 });
      await expect.poll(() => showsWords(chip)).toBe(false);
      await expect.poll(() => showsWords(viewer.secrets)).toBe(false);
      // What the words said is still what the controls are called.
      await expect(chip).toBeVisible();
      await expect(viewer.secrets).toBeVisible();
      await expect(badge).toBeVisible();
    });
    await test.step('a narrow one leaves the badge out as well', async () => {
      await page.setViewportSize({ width: 780, height: 700 });
      await expect(badge).toBeHidden();
      await expect(viewer.address).toBeVisible();
      await expect(viewer.stop).toBeVisible();
    });
    await test.step('and it all comes back with the room', async () => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect.poll(() => showsWords(chip)).toBe(true);
      await expect.poll(() => showsWords(viewer.secrets)).toBe(true);
      await expect(badge).toBeVisible();
    });
  });
});

test.describe('the pointer', () => {
  // The first window has room for the whole page, the second shows it smaller.
  for (const size of [
    { width: 1280, height: 800, scaled: false },
    { width: 900, height: 640, scaled: true },
  ]) {
    test.describe(`in a window of ${size.width} x ${size.height}`, () => {
      test.use({ viewport: { width: size.width, height: size.height } });

      test('a click lands on the pixel of the page that is under the pointer', async ({
        page,
        api,
        control,
      }) => {
        const session = await api.startSession('alpha');
        const viewer = await openViewer(page, control, session);
        const aims = [
          await viewer.at(0.1, 0.1),
          await viewer.at(0.5, 0.5),
          await viewer.at(0.9, 0.9),
          await viewer.at(0.25, 0.75),
        ];

        for (const aim of aims) {
          await page.mouse.click(aim.screen.x, aim.screen.y);
        }

        const events = await viewer.fake.when(
          (all) =>
            mouseOf(all).filter(({ action }) => action === 'up').length ===
            aims.length,
          'the four clicks reached the browser',
        );
        const presses = mouseOf(events).filter(
          ({ action }) => action === 'down',
        );
        expect(presses).toHaveLength(aims.length);
        for (const [index, aim] of aims.entries()) {
          expectPoint(
            presses[index] ?? NOWHERE,
            aim.page,
            `press ${index + 1}`,
          );
        }
        // The picture is shown at the size of the page, or smaller, and maps all of it either way.
        const box = await boxOf(viewer.picture);
        if (size.scaled) expect(box.width).toBeLessThan(PAGE.width);
        else expect(box.width).toBe(PAGE.width);
      });
    });
  }

  test('a left click is a press and a release of the left button at the same place', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const aim = await viewer.at(0.25, 0.5);

    await page.mouse.click(aim.screen.x, aim.screen.y);

    const events = await viewer.fake.when(
      (all) => mouseOf(all).some(({ action }) => action === 'up'),
      'the release reached the browser',
    );
    const presses = mouseOf(events).filter(({ action }) => action !== 'move');
    expect(
      presses.map(({ action, button, clicks }) => [action, button, clicks]),
    ).toEqual([
      ['down', 'left', 1],
      ['up', 'left', 1],
    ]);
    for (const press of presses) {
      expectPoint(press, aim.page, `the ${press.action}`);
    }
    // What the page sent is what the browser got.
    expect(
      viewer.watch
        .sent()
        .filter((message) => message.t === 'mouse' && message.a !== 'move'),
    ).toMatchObject([
      { a: 'down', b: 'left', n: 1 },
      { a: 'up', b: 'left', n: 1 },
    ]);
  });

  test('a double click is a second press with a click count of two', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const aim = await viewer.at(0.5, 0.5);

    await page.mouse.dblclick(aim.screen.x, aim.screen.y);

    const events = await viewer.fake.when(
      (all) =>
        mouseOf(all).filter(({ action }) => action === 'up').length === 2,
      'both releases reached the browser',
    );
    const presses = mouseOf(events).filter(({ action }) => action !== 'move');
    expect(
      presses.map(({ action, button, clicks }) => [action, button, clicks]),
    ).toEqual([
      ['down', 'left', 1],
      ['up', 'left', 1],
      ['down', 'left', 2],
      ['up', 'left', 2],
    ]);
    for (const press of presses) expectPoint(press, aim.page, press.action);
  });

  test('a triple click counts up to three, and a press beyond it stays at three', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const aim = await viewer.at(0.5, 0.5);

    // The mouse of the test presses once per count: one, two, three, four, five.
    await page.mouse.click(aim.screen.x, aim.screen.y, { clickCount: 5 });

    const events = await viewer.fake.when(
      (all) =>
        mouseOf(all).filter(({ action }) => action === 'up').length === 5,
      'all five releases reached the browser',
    );
    expect(
      mouseOf(events)
        .filter(({ action }) => action === 'down')
        .map(({ clicks }) => clicks),
    ).toEqual([1, 2, 3, 3, 3]);
    // The page itself counts no further than three.
    expect(
      viewer.watch
        .sent()
        .flatMap((message) =>
          message.t === 'mouse' && message.a === 'down' ? [message.n] : [],
        ),
    ).toEqual([1, 2, 3, 3, 3]);
  });

  test('a right click presses the right button and leaves the context menu to the page', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const aim = await viewer.at(0.75, 0.25);
    // Recorded after the picture's own handler ran: the browser's menu is what it would have opened.
    const contextMenus = await page.evaluateHandle(() => {
      const prevented: boolean[] = [];
      document.addEventListener('contextmenu', (event) => {
        prevented.push(event.defaultPrevented);
      });
      return prevented;
    });

    await page.mouse.click(aim.screen.x, aim.screen.y, { button: 'right' });

    const events = await viewer.fake.when(
      (all) => mouseOf(all).some(({ action }) => action === 'up'),
      'the release reached the browser',
    );
    const presses = mouseOf(events).filter(({ action }) => action !== 'move');
    expect(
      presses.map(({ action, button, clicks }) => [action, button, clicks]),
    ).toEqual([
      ['down', 'right', 1],
      ['up', 'right', 1],
    ]);
    for (const press of presses) expectPoint(press, aim.page, press.action);
    expect(await contextMenus.jsonValue()).toEqual([true]);
  });

  test('a click of the middle button is sent as the middle button', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const aim = await viewer.at(0.75, 0.75);

    await page.mouse.click(aim.screen.x, aim.screen.y, { button: 'middle' });

    const events = await viewer.fake.when(
      (all) => mouseOf(all).some(({ action }) => action === 'up'),
      'the release reached the browser',
    );
    expect(
      mouseOf(events)
        .filter(({ action }) => action !== 'move')
        .map(({ action, button }) => [action, button]),
    ).toEqual([
      ['down', 'middle'],
      ['up', 'middle'],
    ]);
  });

  test('moving the pointer over the picture sends where it goes, at most once per move, ending where it stopped', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const start = await viewer.at(0.1, 0.2);
    const end = await viewer.at(0.8, 0.6);
    const steps = 10;

    await page.mouse.move(start.screen.x, start.screen.y);
    await page.mouse.move(end.screen.x, end.screen.y, { steps });

    const events = await viewer.fake.when((all) => {
      const last = mouseOf(all).at(-1);
      return last !== undefined && distance(last, end.page) <= POINT_TOLERANCE;
    }, 'the pointer arrived');
    const moves = mouseOf(events);
    expect(moves.every(({ action }) => action === 'move')).toBe(true);
    expect(moves.length).toBeLessThanOrEqual(steps + 1);
    // On its way: from left to right and from top to bottom, never back.
    for (const [index, move] of moves.entries()) {
      const before = moves[index - 1];
      if (before === undefined) continue;
      expect(move.x).toBeGreaterThanOrEqual(before.x - 1);
      expect(move.y).toBeGreaterThanOrEqual(before.y - 1);
    }
    expectPoint(moves[0] ?? NOWHERE, start.page, 'first move');
  });

  test('the wheel scrolls the page at the pointer: what turns within a frame is added up', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const aim = await viewer.at(0.5, 0.5);

    await page.mouse.move(aim.screen.x, aim.screen.y);
    for (const dy of [40, 40, 40]) await page.mouse.wheel(0, dy);
    await page.mouse.wheel(25, 0);
    await page.mouse.wheel(0, -30);

    const total = (events: BrowserState['events']) =>
      wheelsOf(events).reduce(
        (sum, wheel) => ({ dx: sum.dx + wheel.dx, dy: sum.dy + wheel.dy }),
        { dx: 0, dy: 0 },
      );
    const events = await viewer.fake.when(
      (all) => total(all).dx === 25 && total(all).dy === 90,
      'the page scrolled by what the wheel turned',
    );
    for (const wheel of wheelsOf(events)) {
      expectPoint(wheel, aim.page, 'the wheel');
    }
    // Several ticks may share one message, but never more messages than ticks.
    expect(wheelsOf(events).length).toBeLessThanOrEqual(5);
  });

  test('a wheel that counts in lines or in pages scrolls the page by pixels', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const aim = await viewer.at(0.25, 0.2);

    // Firefox's wheel turns by lines, some mice by pages: a line is 16 pixels, a page the height of the page.
    await viewer.picture.evaluate(
      (picture, [x, y]) => {
        for (const [deltaMode, deltaX, deltaY] of [
          [1, 2, 3],
          [2, 0, 1],
          [0, 0, 5],
        ] as const) {
          picture.dispatchEvent(
            new WheelEvent('wheel', {
              deltaMode,
              deltaX,
              deltaY,
              clientX: x,
              clientY: y,
              bubbles: true,
              cancelable: true,
            }),
          );
        }
      },
      [aim.screen.x, aim.screen.y],
    );

    const total = (events: BrowserState['events']) =>
      wheelsOf(events).reduce(
        (sum, wheel) => ({ dx: sum.dx + wheel.dx, dy: sum.dy + wheel.dy }),
        { dx: 0, dy: 0 },
      );
    const events = await viewer.fake.when(
      (all) => total(all).dy === 3 * 16 + PAGE.height + 5,
      'the page scrolled by the lines, the page and the pixels',
    );
    expect(total(events)).toEqual({ dx: 2 * 16, dy: 3 * 16 + PAGE.height + 5 });
    for (const wheel of wheelsOf(events)) {
      expectPoint(wheel, aim.page, 'the wheel');
    }
  });

  test('a drag presses where it starts, follows the pointer and releases where it ends', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const from = await viewer.at(0.2, 0.2);
    const to = await viewer.at(0.8, 0.8);

    await page.mouse.move(from.screen.x, from.screen.y);
    await page.mouse.down();
    await page.mouse.move(to.screen.x, to.screen.y, { steps: 6 });
    await page.mouse.up();

    const events = await viewer.fake.when(
      (all) => mouseOf(all).some(({ action }) => action === 'up'),
      'the release reached the browser',
    );
    const trail = mouseOf(events);
    const down = trail.findIndex(({ action }) => action === 'down');
    const up = trail.findIndex(({ action }) => action === 'up');
    expect(down).toBeGreaterThanOrEqual(0);
    expect(up).toBeGreaterThan(down);
    expectPoint(trail[down] ?? NOWHERE, from.page, 'the press');
    expectPoint(trail[up] ?? NOWHERE, to.page, 'the release');
    // Between the two the page saw the pointer move across it, with the button held.
    const between = trail.slice(down + 1, up);
    expect(between.length).toBeGreaterThan(0);
    for (const move of between) {
      expect(move.action).toBe('move');
      expect(move.x).toBeGreaterThan(from.page.x - POINT_TOLERANCE);
      expect(move.x).toBeLessThanOrEqual(to.page.x + POINT_TOLERANCE);
    }
  });

  test('a drag that leaves the picture goes on in the page, and the release outside still arrives', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const from = await viewer.at(0.9, 0.9);
    const box = await boxOf(viewer.picture);
    // 100 pixels right of the picture and 50 below it, on the screen.
    const out = { x: box.x + box.width + 100, y: box.y + box.height + 50 };
    const scale = box.width / PAGE.width;
    const expectedOut = {
      x: PAGE.width + 100 / scale,
      y: PAGE.height + 50 / scale,
    };

    await page.mouse.move(from.screen.x, from.screen.y);
    await page.mouse.down();
    await page.mouse.move(out.x, out.y, { steps: 4 });
    await page.mouse.up();

    const events = await viewer.fake.when(
      (all) => mouseOf(all).some(({ action }) => action === 'up'),
      'the release outside the picture reached the browser',
    );
    const release = mouseOf(events).find(({ action }) => action === 'up');
    expect(release).toBeDefined();
    // Outside the picture means outside the page's pixels: the position is not clamped.
    expect(release?.x).toBeGreaterThan(PAGE.width);
    expect(release?.y).toBeGreaterThan(PAGE.height);
    expectPoint(release ?? NOWHERE, expectedOut, 'the release');
    // The drag was the page's: it selected nothing of the manager's own text.
    expect(await page.evaluate(() => getSelection()?.toString())).toBe('');
  });

  test('the side buttons of a mouse go back and forward in the page', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const aim = await viewer.at(0.5, 0.5);
    // Playwright's mouse has three buttons; the browser's own protocol has five.
    const cdp = await page.context().newCDPSession(page);
    const side = async (button: 'back' | 'forward', buttons: number) => {
      const { x, y } = aim.screen;
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button,
        buttons,
        clickCount: 1,
      });
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button,
        buttons: 0,
        clickCount: 1,
      });
    };

    await side('back', 8);
    await side('forward', 16);

    const events = await viewer.fake.when(
      (all) => historyOf(all).length === 2,
      'both side buttons reached the browser',
    );
    expect(historyOf(events)).toEqual(['back', 'forward']);
    // They act on release: no press of a button of the page came of them.
    expect(mouseOf(events).filter(({ action }) => action === 'down')).toEqual(
      [],
    );
  });

  test('a file that is dropped on the picture is not opened by the manager', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);

    // The drop is the page's business; the manager's own page must not navigate to the file.
    const prevented = await viewer.picture.evaluate((picture) => {
      const files = new DataTransfer();
      files.items.add(new File(['x'], 'x.txt', { type: 'text/plain' }));
      const result: Record<string, boolean> = {};
      for (const type of ['dragover', 'drop', 'dragstart']) {
        const event = new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: files,
        });
        picture.dispatchEvent(event);
        result[type] = event.defaultPrevented;
      }
      return result;
    });

    expect(prevented).toEqual({ dragover: true, drop: true, dragstart: true });
  });

  test('a press on the picture gives the page the keyboard', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await viewer.address.focus();
    await expect(viewer.address).toBeFocused();

    const aim = await viewer.at(0.5, 0.5);
    await page.mouse.click(aim.screen.x, aim.screen.y);

    await expect(viewer.keyboard).toBeFocused();
  });
});

/** The trace of typing `text` one key at a time: each key goes down and up. */
function typed(text: string): string[] {
  return Array.from(text).flatMap((key) => [`down ${key}`, `up ${key}`]);
}

/** The trace of a combination: its keys go down in order and up in the reverse one. */
function combined(keys: readonly string[]): string[] {
  return [
    ...keys.map((key) => `down ${key}`),
    ...keys.toReversed().map((key) => `up ${key}`),
  ];
}

test.describe('the keyboard', () => {
  test('typing sends every key to the page: letters, space, Enter, Backspace, the arrows and the rest', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const keys = [
      'Enter',
      'Backspace',
      'Delete',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'Tab',
      'Escape',
      'F2',
    ];

    await viewer.picture.focus();
    await expect(viewer.keyboard).toBeFocused();
    await page.keyboard.type('Hi there 42');
    for (const key of keys) await page.keyboard.press(key);

    const events = await viewer.fake.when(
      (all) => keyTrace(all).at(-1) === 'up F2',
      'the last key reached the browser',
    );
    expect(keyTrace(events)).toEqual([
      ...typed('Hi there 42'),
      ...keys.flatMap((key) => [`down ${key}`, `up ${key}`]),
    ]);
    // A key is a key, not text: the hidden field took none of it as text.
    expect(textsOf(events)).toEqual([]);
    await expect(viewer.keyboard).toHaveValue('');
    // The page keeps the Tab key for itself: the keyboard did not move on.
    await expect(viewer.keyboard).toBeFocused();
  });

  test('a modifier goes down before the key it changes and up after it', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const combinations = [
      ['Shift+A', ['Shift', 'A']],
      ['Control+a', ['Control', 'a']],
      ['Control+Shift+ArrowLeft', ['Control', 'Shift', 'ArrowLeft']],
      ['Alt+F', ['Alt', 'F']],
    ] as const;

    await viewer.picture.focus();
    for (const [combination] of combinations) {
      await page.keyboard.press(combination);
    }

    const events = await viewer.fake.when(
      (all) => keyTrace(all).filter((one) => one === 'up Alt').length === 1,
      'the last combination reached the browser',
    );
    expect(keyTrace(events)).toEqual(
      combinations.flatMap(([, keys]) => combined(keys)),
    );
  });

  test('every key that went down comes up, also the ones typed in a rush', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);

    await viewer.picture.focus();
    await page.keyboard.type('The quick brown fox jumps over 13 lazy dogs!', {
      delay: 0,
    });
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Control+Shift+Z');
    await viewer.flush();

    const events = await viewer.fake.events();
    const trace = keyTrace(events);
    expect(trace.length).toBeGreaterThan(80);
    expect(heldKeys(events)).toEqual([]);
    // As many keys went up as went down.
    expect(trace.filter((one) => one.startsWith('up ')).length).toBe(
      trace.filter((one) => one.startsWith('down ')).length,
    );
  });

  test('keys still held when the focus leaves the page are let go: none stays stuck down', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);

    await viewer.picture.focus();
    await page.keyboard.down('b');
    await page.keyboard.down('Shift');
    await viewer.fake.when(
      (all) => heldKeys(all).length === 2,
      'both keys went down in the page',
    );
    await viewer.address.focus();

    const events = await viewer.fake.when(
      (all) => heldKeys(all).length === 0,
      'the held keys were let go when the focus left the page',
    );
    expect(keyTrace(events)).toEqual([
      'down b',
      'down Shift',
      'up b',
      'up Shift',
    ]);
    // The keys come up on the address bar later: the page is not told twice.
    await page.keyboard.up('b');
    await page.keyboard.up('Shift');
    await viewer.picture.focus();
    await viewer.flush();
    expect(keyTrace(await viewer.fake.events())).toEqual([
      'down b',
      'down Shift',
      'up b',
      'up Shift',
    ]);
  });

  test('a key is let go as the key it pressed, even when the layout changed in between', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    // Playwright's keyboard releases a key as it pressed it; a real one does not
    // when Shift goes up first, so the events are made by hand.
    const cdp = await page.context().newCDPSession(page);
    const shift = {
      key: 'Shift',
      code: 'ShiftLeft',
      windowsVirtualKeyCode: 16,
    };
    const h = { code: 'KeyH', windowsVirtualKeyCode: 72 };
    const SHIFT_HELD = 8;

    await viewer.picture.focus();
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      ...shift,
      modifiers: SHIFT_HELD,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      ...h,
      key: 'H',
      modifiers: SHIFT_HELD,
    });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...shift });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...h, key: 'h' });

    const events = await viewer.fake.when(
      (all) => keyTrace(all).length === 4,
      'the four key events reached the browser',
    );
    // Not "up h": that would leave the capital H down in the page.
    expect(keyTrace(events)).toEqual([
      'down Shift',
      'down H',
      'up Shift',
      'up H',
    ]);
  });

  test('holding a key repeats it as a keyboard does, and one release lets it go', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const repeats = 6;

    await viewer.picture.focus();
    for (let count = 0; count < repeats; count++) await page.keyboard.down('a');
    await page.keyboard.up('a');

    const events = await viewer.fake.when(
      (all) => keyTrace(all).includes('up a'),
      'the release reached the browser',
    );
    // One key down per repeat of the keyboard, one key up for the release: nothing is added.
    expect(keyTrace(events)).toEqual([
      ...Array.from({ length: repeats }, () => 'down a'),
      'up a',
    ]);
    expect(
      viewer.watch.sent().filter((message) => message.t === 'key'),
    ).toHaveLength(repeats + 1);
  });

  test('the shortcuts of this browser stay with it: reload, the developer keys, quit', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);

    await viewer.picture.focus();
    await page.keyboard.press('F5');
    await page.keyboard.press('F11');
    await page.keyboard.press('F12');
    await page.keyboard.press('ControlOrMeta+R');
    await page.keyboard.press('ControlOrMeta+Q');
    await page.keyboard.press('z');

    const events = await viewer.fake.when(
      (all) => keyTrace(all).includes('up z'),
      'the last key reached the browser',
    );
    // The modifier is the page's; what it was held for is not.
    expect(keyTrace(events)).toEqual([
      ...Array.from({ length: 2 }, () => [
        `down ${COMMAND}`,
        `up ${COMMAND}`,
      ]).flat(),
      'down z',
      'up z',
    ]);
  });

  test('text from an on-screen keyboard or a dictation is sent as text, in one piece', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const spoken = 'héllo wörld 😀 日本語';

    await viewer.picture.focus();
    await page.keyboard.insertText(spoken);

    const events = await viewer.fake.when(
      (all) => textsOf(all).length === 1,
      'the text reached the browser',
    );
    expect(textsOf(events)).toEqual([spoken]);
    expect(keysOf(events)).toEqual([]);
    // The hidden field is emptied for the next one.
    await expect(viewer.keyboard).toHaveValue('');
  });

  test('a word composed with an input method is sent once, when it is done', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const cdp = await page.context().newCDPSession(page);

    await viewer.picture.focus();
    await cdp.send('Input.imeSetComposition', {
      text: 'に',
      selectionStart: 1,
      selectionEnd: 1,
    });
    await cdp.send('Input.imeSetComposition', {
      text: 'にほ',
      selectionStart: 2,
      selectionEnd: 2,
    });
    await cdp.send('Input.insertText', { text: '日本' });
    // Ordered after the composition: once this arrived, the composition has.
    await page.keyboard.insertText('!');

    const events = await viewer.fake.when(
      (all) => textsOf(all).length === 2,
      'the composed text reached the browser',
    );
    expect(textsOf(events)).toEqual(['日本', '!']);
  });

  test('the picture is the one tab stop of the page and hands the keyboard to it', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);

    await viewer.secrets.focus();
    await page.keyboard.press('Tab');

    await expect(viewer.keyboard).toBeFocused();
    await page.keyboard.press('x');
    const events = await viewer.fake.when(
      (all) => keyTrace(all).includes('up x'),
      'the key reached the browser',
    );
    expect(keyTrace(events)).toEqual(['down x', 'up x']);
    // A screen reader is told the way out of the page.
    await expect(viewer.picture).toHaveAccessibleDescription(
      fill(t('viewer.stage.canvasHint'), { shortcut: ADDRESS_SHORTCUT }),
    );
  });

  test('coming into the page with the Tab key says on the screen how to leave it, and the first key takes the hint away', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    // The hint is a status at the foot of the screen: said to a screen reader as well, once.
    const hint = page.getByRole('status').filter({
      hasText: fill(t('viewer.stage.keyboardHint'), {
        shortcut: ADDRESS_SHORTCUT,
      }),
    });
    await expect(hint).toHaveCount(0);

    await viewer.secrets.focus();
    await page.keyboard.press('Tab');

    await expect(viewer.keyboard).toBeFocused();
    await expect(hint).toBeVisible();
    await page.keyboard.press('x');
    await expect(hint).toHaveCount(0);
  });

  test('a press on the picture gives the page the keyboard without the hint: the person did not have to find their way in', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const hint = page.getByRole('status').filter({
      hasText: fill(t('viewer.stage.keyboardHint'), {
        shortcut: ADDRESS_SHORTCUT,
      }),
    });
    const aim = await viewer.at(0.5, 0.5);

    await page.mouse.click(aim.screen.x, aim.screen.y);

    await expect(viewer.keyboard).toBeFocused();
    // What the page did with the press has reached the browser: the hint, if there was to be one, is there by now.
    await viewer.fake.when(
      (all) => mouseOf(all).some(({ action }) => action === 'up'),
      'the click reached the browser',
    );
    await expect(hint).toHaveCount(0);
  });
});

test.describe('the clipboard', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('paste types the text of the clipboard into the page, as text', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const pasted = 'first line\nsecond line\twith a tab, ünïcode and 😀';
    await page.evaluate((text) => navigator.clipboard.writeText(text), pasted);

    await viewer.picture.focus();
    await page.keyboard.press('ControlOrMeta+V');

    const events = await viewer.fake.when(
      (all) => textsOf(all).length === 1,
      'the pasted text reached the browser',
    );
    expect(textsOf(events)).toEqual([pasted]);
    // The shortcut itself is not a key of the page: only the modifier went down and up.
    expect(keyTrace(events)).toEqual([`down ${COMMAND}`, `up ${COMMAND}`]);
    // All of it went in: nothing is said about a rest that was left out.
    await expect(notice(page, t('viewer.notice.pasteCutTitle'))).toHaveCount(0);
  });

  /** What the page says when a paste was cut to what the protocol takes at once. */
  const pasteCutNotice = (page: Page) =>
    notice(page, t('viewer.notice.pasteCutTitle'));
  const pasteCutSentence = withNumber(
    t('viewer.notice.pasteCut'),
    'max',
    MAX_TEXT,
  );

  test('a paste longer than the limit still gets its beginning into the page, and says that the rest was left out', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const sockets = await LiveSockets.route(page);
    const viewer = await openViewer(page, control, session);
    const long = 'abcdefghij'.repeat((MAX_TEXT + PASTE_OVER_LIMIT) / 10);
    await page.evaluate((text) => navigator.clipboard.writeText(text), long);

    await viewer.picture.focus();
    await page.keyboard.press('ControlOrMeta+V');

    const events = await viewer.fake.when(
      (all) => textsOf(all).length === 1,
      'the pasted text reached the browser',
    );
    const [pasted = ''] = textsOf(events);
    expect(pasted).toHaveLength(MAX_TEXT);
    expect(long.startsWith(pasted)).toBe(true);
    // The page cut it before it sent it: one message of what the protocol takes.
    await expect
      .poll(
        () =>
          viewer.watch
            .sent()
            .flatMap((one) => (one.t === 'text' ? [one.text.length] : [])),
        { timeout: TIMEOUT.VISIBLE },
      )
      .toEqual([MAX_TEXT]);
    await expect(pasteCutNotice(page)).toContainText(pasteCutSentence);
    expect(sockets.attempts).toBe(1);
  });

  test('a paste of more than the socket takes at once keeps the connection and the beginning of the text', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const sockets = await LiveSockets.route(page);
    const viewer = await openViewer(page, control, session);
    const huge = 'abcdefghij'.repeat(PASTE_OVER_SOCKET / 10);
    await page.evaluate((text) => navigator.clipboard.writeText(text), huge);

    await viewer.picture.focus();
    await page.keyboard.press('ControlOrMeta+V');

    const events = await viewer.fake.when(
      (all) => textsOf(all).length === 1,
      'the beginning of the pasted text reached the browser',
    );
    expect(textsOf(events)).toEqual([huge.slice(0, MAX_TEXT)]);
    await expect(pasteCutNotice(page)).toContainText(pasteCutSentence);
    // The live view was never left, and the key that went down for the paste came up.
    expect(sockets.attempts).toBe(1);
    await viewer.flush();
    expect(heldKeys(await viewer.fake.events())).toEqual([]);
  });

  test('copy puts the selection of the page on the clipboard', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await control.setSelection(session.name, 'abc');
    await page.evaluate(() => navigator.clipboard.writeText('before'));

    await viewer.picture.focus();
    await page.keyboard.press('ControlOrMeta+C');

    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
        timeout: TIMEOUT.VISIBLE,
        message: 'the selection of the page is on the clipboard',
      })
      .toBe('abc');
    expect(
      viewer.watch.sent().filter((message) => message.t === 'copy'),
    ).toEqual([{ t: 'copy', cut: false }]);
    // A copy takes nothing out of the page.
    const events = await viewer.fake.events();
    expect(keyTrace(events)).toEqual([`down ${COMMAND}`, `up ${COMMAND}`]);
  });

  test('cut puts the selection on the clipboard and deletes it in the page', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await control.setSelection(session.name, 'cut me');

    await viewer.picture.focus();
    await page.keyboard.press('ControlOrMeta+X');

    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
        timeout: TIMEOUT.VISIBLE,
        message: 'the selection of the page is on the clipboard',
      })
      .toBe('cut me');
    const events = await viewer.fake.when(
      (all) => keyTrace(all).length === 5,
      'the page deleted the selection and the shortcut was let go',
    );
    // Ctrl or Command under a Delete is another shortcut and deletes nothing (Ctrl+Delete
    // takes a word): the page lets go of it for the Delete and holds it again, as the
    // viewer holds it, until the viewer's own release.
    expect(keyTrace(events)).toEqual([
      `down ${COMMAND}`,
      `up ${COMMAND}`,
      'press Delete',
      `down ${COMMAND}`,
      `up ${COMMAND}`,
    ]);
    expect(heldWhenPressed(events, 'Delete')).toEqual([]);
    expect(
      viewer.watch.sent().filter((message) => message.t === 'copy'),
    ).toEqual([{ t: 'copy', cut: true }]);
  });

  test('copy and cut of nothing leave the clipboard and the page alone', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await page.evaluate(() => navigator.clipboard.writeText('keep me'));

    await viewer.picture.focus();
    await page.keyboard.press('ControlOrMeta+C');
    await page.keyboard.press('ControlOrMeta+X');

    await expect
      .poll(
        () =>
          viewer.watch.received().filter((message) => message.t === 'selection')
            .length,
        { timeout: TIMEOUT.VISIBLE },
      )
      .toBe(2);
    await viewer.flush();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'keep me',
    );
    expect(
      keysOf(await viewer.fake.events()).filter(
        ({ action }) => action === 'press',
      ),
    ).toEqual([]);
  });
});

/** What the server says to a page when an address cannot be opened (`backend/domains/live_view`). */
const REFUSED_ADDRESS =
  'That address cannot be opened. Addresses start with http:// or https://.';

test.describe('the address bar', () => {
  test('the shortcut on its badge takes the keyboard from the page to the bar and selects the address', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const { defaultStartPage } = await api.settings();
    const viewer = await openViewer(page, control, session);
    const badge = page.locator('form', { has: viewer.address }).locator('kbd');

    // The badge says the shortcut to the eyes; the field that has the keyboard says it to a screen reader.
    await expect(badge).toHaveText(COMMAND === 'Meta' ? '⌘ L' : 'Ctrl+L');
    await expect(viewer.keyboard).toHaveAttribute(
      'aria-keyshortcuts',
      `${COMMAND}+L`,
    );
    await viewer.picture.focus();
    await page.keyboard.press(`${COMMAND}+L`);

    await expect(viewer.address).toBeFocused();
    expect(
      await viewer.address.evaluate((input: HTMLInputElement) =>
        input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0),
      ),
    ).toBe(defaultStartPage);
    await expect(badge).toBeHidden();
    // The L is not the page's, and the page is let go of the modifier.
    const events = await viewer.fake.when(
      (all) => keyTrace(all).length === 2,
      'the modifier was let go',
    );
    expect(keyTrace(events)).toEqual([`down ${COMMAND}`, `up ${COMMAND}`]);
  });

  test('an address typed in the bar and entered opens that page, and the keyboard goes back to the page', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);

    await viewer.picture.focus();
    await page.keyboard.press(`${COMMAND}+L`);
    await page.keyboard.type('example.com/page');
    await page.keyboard.press('Enter');

    const events = await viewer.fake.when(
      (all) => navigationsOf(all).length === 1,
      'the address reached the browser',
    );
    expect(navigationsOf(events)).toEqual(['https://example.com/page']);
    // The page sent what was typed; the server worked out the address.
    expect(viewer.watch.sent().filter((message) => message.t === 'go')).toEqual(
      [{ t: 'go', a: 'goto', url: 'example.com/page' }],
    );
    await expect(
      viewer.tab(titleOf('https://example.com/page')),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(viewer.address).toHaveValue('https://example.com/page');
    await expect(viewer.keyboard).toBeFocused();
  });

  test('what is typed is turned into the address it means: a host gets https, local ones http, words are searched', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const search = 'https://www.google.com/search?q=';
    const cases = [
      ['example.com/page', 'https://example.com/page'],
      ['https://example.com/a?b=1#c', 'https://example.com/a?b=1#c'],
      ['http://example.org', 'http://example.org'],
      ['localhost:3000/app', 'http://localhost:3000/app'],
      ['192.168.1.20:8080', 'http://192.168.1.20:8080'],
      ['example.net:80', 'http://example.net:80'],
      ['  spaced.example.dev  ', 'https://spaced.example.dev'],
      ['weather in berlin', `${search}weather+in+berlin`],
      ['cats', `${search}cats`],
      // Not an address: looked for, never opened as a script.
      ['javascript:alert(1)', `${search}javascript%3Aalert%281%29`],
    ] as const;

    for (const [index, [typedText, address]] of cases.entries()) {
      await test.step(`${JSON.stringify(typedText)} opens ${address}`, async () => {
        await viewer.address.fill(typedText);
        await viewer.address.press('Enter');
        const events = await viewer.fake.when(
          (all) => navigationsOf(all).length === index + 1,
          'the address reached the browser',
        );
        expect(navigationsOf(events).at(-1)).toBe(address);
      });
    }
  });

  test('what was typed stays in the bar while its page is awaited, and the address of the page is back when none comes', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const { defaultStartPage } = await api.settings();
    const viewer = await openViewer(page, control, session);

    await viewer.address.fill('file:///etc/passwd');
    await viewer.address.press('Enter');

    // The page it asks for would come in a moment: the bar says what was asked for...
    await expect(viewer.address).toHaveValue('file:///etc/passwd');
    // ... but it is refused, so a few seconds on the bar shows the page that is there.
    await expect(viewer.address).toHaveValue(defaultStartPage, {
      timeout: TIMEOUT.VISIBLE,
    });
  });

  test('an address that cannot be opened is refused with the reason, and the page stays where it was', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const { defaultStartPage } = await api.settings();
    const viewer = await openViewer(page, control, session);

    await viewer.address.fill('file:///etc/passwd');
    await viewer.address.press('Enter');

    await expect(notice(page, t('viewer.notice.title'))).toContainText(
      t('viewer.notice.addressRefused'),
    );
    // The server says what it could not do, and which kind of thing it was: the page words it.
    expect(
      viewer.watch.received().filter((message) => message.t === 'error'),
    ).toEqual([
      { t: 'error', message: REFUSED_ADDRESS, notice: 'address_refused' },
    ]);
    // The keyboard is back in the page: the flush proves nothing else was sent before it.
    await expect(viewer.keyboard).toBeFocused();
    await viewer.flush();
    expect(navigationsOf(await viewer.fake.events())).toEqual([]);
    expect(viewer.serverTabs().map((tab) => tab.url)).toEqual([
      defaultStartPage,
    ]);
  });

  test('no address with a scheme other than http and https is opened', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const refused = [
      'ftp://example.com/file.txt',
      'chrome://settings',
      'file:///C:/Windows',
    ];

    for (const [index, address] of refused.entries()) {
      await viewer.address.fill(address);
      await viewer.address.press('Enter');
      await expect
        .poll(
          () =>
            viewer.watch.received().filter((message) => message.t === 'error')
              .length,
          { timeout: TIMEOUT.VISIBLE, message: `${address} was refused` },
        )
        .toBe(index + 1);
    }

    await viewer.flush();
    expect(navigationsOf(await viewer.fake.events())).toEqual([]);
    expect(
      viewer.watch
        .received()
        .filter((message) => message.t === 'error')
        .map((message) => message.message),
    ).toEqual(refused.map(() => REFUSED_ADDRESS));
    // Each one is shown to the person, in their own words, and not as the server's English.
    await expect(
      notice(page, t('viewer.notice.addressRefused')).first(),
    ).toBeVisible();
  });

  test('Escape gives up what was typed, shows the address of the page again and gives the keyboard back', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const { defaultStartPage } = await api.settings();
    const viewer = await openViewer(page, control, session);

    await viewer.address.fill('half typed and given up');
    await viewer.address.press('Escape');

    await expect(viewer.address).toHaveValue(defaultStartPage);
    await expect(viewer.keyboard).toBeFocused();
    await viewer.flush();
    expect(navigationsOf(await viewer.fake.events())).toEqual([]);
  });

  test('leaving the bar without Enter drops what was typed', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const { defaultStartPage } = await api.settings();
    const viewer = await openViewer(page, control, session);

    await viewer.address.fill('typed but not entered');
    await viewer.secrets.focus();

    await expect(viewer.address).toHaveValue(defaultStartPage);
    await viewer.picture.focus();
    await viewer.flush();
    expect(navigationsOf(await viewer.fake.events())).toEqual([]);
  });

  test('an empty address is not sent, and the bar keeps the keyboard', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);

    await viewer.address.fill('   ');
    await viewer.address.press('Enter');

    await expect(viewer.address).toBeFocused();
    await viewer.address.press('Escape');
    await viewer.flush();
    expect(navigationsOf(await viewer.fake.events())).toEqual([]);
    expect(viewer.watch.sent().filter((message) => message.t === 'go')).toEqual(
      [],
    );
  });

  test('back, forward and reload ask the page to go back, forward and load again', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);

    await viewer.back.click();
    await viewer.forward.click();
    await viewer.reload.click();

    const events = await viewer.fake.when(
      (all) => historyOf(all).length === 3,
      'the three buttons reached the browser',
    );
    expect(historyOf(events)).toEqual(['back', 'forward', 'reload']);
    expect(viewer.watch.sent().filter((message) => message.t === 'go')).toEqual(
      [
        { t: 'go', a: 'back' },
        { t: 'go', a: 'forward' },
        { t: 'go', a: 'reload' },
      ],
    );
  });
});

test.describe('what the browser could not do', () => {
  /** The sentence the page words for each kind of notice, with the browser's own words only as a quoted detail. */
  const SENTENCES = [
    ['address_refused', () => t('viewer.notice.addressRefused')],
    ['tab_gone', () => t('viewer.notice.tabGone')],
    [
      'tab_not_opened',
      (detail: string) => fill(t('viewer.notice.tabNotOpened'), { detail }),
    ],
    [
      'key_failed',
      (detail: string) => fill(t('viewer.notice.keyFailed'), { detail }),
    ],
    ['input_stuck', () => t('viewer.notice.inputStuck')],
    [
      'action_failed',
      (detail: string) => fill(t('viewer.notice.actionFailed'), { detail }),
    ],
  ] as const;
  const BROWSER_WORDS = 'The browser said no';

  for (const [code, sentence] of SENTENCES) {
    test(`a notice of the kind ${code} is told in the words of the page, and the live view goes on`, async ({
      page,
      api,
      control,
    }) => {
      const session = await api.startSession('alpha');
      const sockets = await LiveSockets.route(page);
      const viewer = await openViewer(page, control, session);

      sockets.tell({ t: 'error', message: BROWSER_WORDS, notice: code });

      const told = notice(page, t('viewer.notice.title'));
      await expect(told).toContainText(sentence(quoted(BROWSER_WORDS)));
      // The browser's own English is a detail where the sentence needs one, never the sentence.
      if (
        code === 'address_refused' ||
        code === 'tab_gone' ||
        code === 'input_stuck'
      ) {
        await expect(told).not.toContainText(BROWSER_WORDS);
      }
      // Nothing ended: the picture is usable and what is typed goes on to the page.
      await expect(viewer.picture).not.toHaveAttribute('aria-disabled', 'true');
      await viewer.picture.focus();
      await page.keyboard.press('x');
      const events = await viewer.fake.when(
        (all) => keyTrace(all).includes('up x'),
        'the key reached the browser',
      );
      expect(keyTrace(events)).toEqual(['down x', 'up x']);
      expect(sockets.attempts).toBe(1);
    });
  }

  test('a notice without a kind is the general one', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const sockets = await LiveSockets.route(page);
    await openViewer(page, control, session);

    sockets.tell({ t: 'error', message: BROWSER_WORDS });

    await expect(notice(page, t('viewer.notice.title'))).toContainText(
      fill(t('viewer.notice.actionFailed'), { detail: quoted(BROWSER_WORDS) }),
    );
  });

  test('closing a tab that is already gone is answered by the browser, and the page tells the person', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    // The tab is gone in the browser before the page has heard of it: what the page asks for is a tab that is not there.
    const sockets = await LiveSockets.route(page, {
      toServer: (text) => text.replace(/"id":2\b/, '"id":99'),
    });
    const viewer = await openViewer(page, control, session);
    const second = 'https://example.com/second';
    await openTabAt(viewer, second);

    await viewer.closeButton(titleOf(second)).click();

    await expect(notice(page, t('viewer.notice.title'))).toContainText(
      t('viewer.notice.tabGone'),
    );
    expect(
      viewer.watch.received().filter((message) => message.t === 'error'),
    ).toMatchObject([{ notice: 'tab_gone' }]);
    // Nothing was closed: the tab that the person meant is still there.
    await expect(viewer.tabs).toHaveCount(2);
    expect(sockets.attempts).toBe(1);
  });
});

test.describe('tabs', () => {
  test('a new tab opens the start page, becomes the active one and takes the keyboard to the address bar', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const { defaultStartPage } = await api.settings();
    const viewer = await openViewer(page, control, session);

    await viewer.newTab.click();

    await expect(viewer.tabs).toHaveCount(2);
    await expect(viewer.tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(viewer.tabs.nth(0)).toHaveAttribute('aria-selected', 'false');
    await expect(viewer.tabs.nth(1)).toHaveAccessibleName(
      titleOf(defaultStartPage),
    );
    await expect(viewer.address).toBeFocused();
    await expect(viewer.address).toHaveValue(defaultStartPage);
    // What the browser says: two tabs, the new one active, on the start page.
    expect(
      viewer.watch.sent().filter((message) => message.t === 'tab'),
    ).toEqual([{ t: 'tab', a: 'open' }]);
    await expect
      .poll(() => viewer.serverTabs().map(({ active, url }) => [active, url]))
      .toEqual([
        [false, defaultStartPage],
        [true, defaultStartPage],
      ]);
  });

  test('a new tab opens the start page of the settings, which is also the one of a new session', async ({
    page,
    api,
    control,
  }) => {
    const startPage = 'https://start.example.org/home';
    await api.updateSettings({ startPage });
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);

    await expect(viewer.tab(titleOf(startPage))).toBeVisible();
    await viewer.newTab.click();

    await expect(viewer.tabs).toHaveCount(2);
    await expect(viewer.tabs.nth(1)).toHaveAccessibleName(titleOf(startPage));
    await expect(viewer.address).toHaveValue(startPage);
  });

  test('choosing a tab makes it the active one: its address is shown, the keyboard goes back to the page, and its picture is drawn', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const { defaultStartPage } = await api.settings();
    const second = 'https://example.com/second';
    const viewer = await openViewer(page, control, session);
    // Every tab of the fake browser has a mock-up of its own colour.
    const drawn = () => probePicture(page).then(colourOfPicture);
    await openTabAt(viewer, second);
    await expect(viewer.address).toHaveValue(second);
    await expect.poll(drawn).toBe(colourOfTab(2));

    await viewer.tab(titleOf(defaultStartPage)).click();

    await expect(viewer.tab(titleOf(defaultStartPage))).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(viewer.address).toHaveValue(defaultStartPage);
    await expect(viewer.keyboard).toBeFocused();
    expect(viewer.watch.sent()).toContainEqual({
      t: 'tab',
      a: 'activate',
      id: 1,
    });
    await expect
      .poll(() => viewer.serverTabs().find(({ active }) => active)?.id)
      .toBe(1);
    // The browser shows the active tab, and the canvas follows it without a new connection.
    await expect.poll(drawn).toBe(colourOfTab(1));
    await viewer.tab(titleOf(second)).click();
    await expect(viewer.address).toHaveValue(second);
    await expect.poll(drawn).toBe(colourOfTab(2));
    expect(colourOfTab(1)).not.toBe(colourOfTab(2));

    // A new connection starts with the picture of the tab that is active.
    await page.reload();
    await viewer.waitUntilLive();
    await expect.poll(drawn).toBe(colourOfTab(2));
  });

  test('the arrow keys, Home and End move between the tabs and keep the keyboard on them', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const urls = ['https://example.com/two', 'https://example.com/three'];
    for (const url of urls) await openTabAt(viewer, url);
    const active = () => viewer.serverTabs().find((tab) => tab.active)?.id;

    await viewer.tabs.first().focus();
    // Left of the first tab is the last one, right of the last is the first.
    const moves = [
      ['ArrowRight', 2],
      ['ArrowRight', 3],
      ['ArrowRight', 1],
      ['ArrowLeft', 3],
      ['Home', 1],
      ['End', 3],
    ] as const;
    for (const [key, id] of moves) {
      await page.keyboard.press(key);
      await expect
        .poll(active, { message: `${key} activates tab ${id}` })
        .toBe(id);
      await expect(viewer.tabs.nth(id - 1)).toBeFocused();
    }
    // They are keys of the tab strip, not the page's.
    expect(keysOf(await viewer.fake.events())).toEqual([]);
  });

  test('a tab is closed with its button, with the middle button or with Delete', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const { defaultStartPage } = await api.settings();
    const viewer = await openViewer(page, control, session);
    const urls = [
      'https://example.com/two',
      'https://example.com/three',
      'https://example.com/four',
    ];
    for (const url of urls) await openTabAt(viewer, url);
    await expect(viewer.tabs).toHaveCount(4);

    await viewer.closeButton(titleOf(urls[0] ?? '')).click();
    await expect(viewer.tab(titleOf(urls[0] ?? ''))).toHaveCount(0);

    await viewer.tab(titleOf(urls[1] ?? '')).click({ button: 'middle' });
    await expect(viewer.tab(titleOf(urls[1] ?? ''))).toHaveCount(0);

    await viewer.tab(titleOf(urls[2] ?? '')).focus();
    await page.keyboard.press('Delete');
    await expect(viewer.tab(titleOf(urls[2] ?? ''))).toHaveCount(0);
    // The keyboard stays on the strip: it goes to the tab next to the one that went.
    await expect(viewer.tab(titleOf(defaultStartPage))).toBeFocused();

    // Only the first tab is left, and it is the active one.
    await expect(viewer.tabs).toHaveCount(1);
    await expect(viewer.tab(titleOf(defaultStartPage))).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      viewer.watch
        .sent()
        .filter((message) => message.t === 'tab' && message.a === 'close')
        .map((message) => message.t === 'tab' && message.id),
    ).toEqual([2, 3, 4]);
    await expect
      .poll(() => viewer.serverTabs().map(({ id }) => id))
      .toEqual([1]);
  });

  test('closing the last tab ends the session, and it opens the start page next time', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const { defaultStartPage } = await api.settings();
    const lastPage = 'https://example.com/the-last-one';
    const viewer = await openViewer(page, control, session);
    await viewer.address.fill(lastPage);
    await viewer.address.press('Enter');
    await expect(viewer.tab(titleOf(lastPage))).toBeVisible();

    await viewer.closeLastButton(titleOf(lastPage)).click();

    // The session has no browser without a tab: it stopped, and says how to go on.
    const start = startButton(page);
    await expect(start).toBeVisible({ timeout: TIMEOUT.BACKGROUND });
    await expect(viewer.picture).toHaveCount(0);
    expect(await api.session(session.id)).toMatchObject({ status: 'stopped' });
    expect((await control.browser(session.name)).closed).toBe(true);

    const pictures = viewer.watch.pictures();
    await start.click();
    await viewer.waitUntilLive();
    await waitForPictures(viewer.watch, pictures + 1);
    // The tab that was closed is not reopened: the session starts from the start page.
    await expect(viewer.tabs).toHaveCount(1);
    await expect(viewer.tab(titleOf(defaultStartPage))).toBeVisible();
    await expect(viewer.address).toHaveValue(defaultStartPage);
  });

  test('when the person closes every tab in the browser itself, the viewer follows the session to its end', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await openTabAt(viewer, 'https://example.com/two');
    await openTabAt(viewer, 'https://example.com/three');
    await expect(viewer.tabs).toHaveCount(3);

    await control.closeAllTabs(session.name);

    await expect(startButton(page)).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await expect(viewer.picture).toHaveCount(0);
    await expect(viewer.tabs).toHaveCount(0);
    expect(await api.session(session.id)).toMatchObject({ status: 'stopped' });
  });

  test('a long title is cut short in the tab and whole in its name and its tooltip', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const url = `https://example.com/${'a-very-long-path-segment-'.repeat(6)}end`;
    await viewer.address.fill(url);
    await viewer.address.press('Enter');
    const tab = viewer.tab(titleOf(url));
    await expect(tab).toBeVisible();

    const label = tab.locator('span').last();
    const { scrollWidth, clientWidth } = await label.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    // The label is cut (it would need far more room), and the tab keeps its size.
    expect(scrollWidth).toBeGreaterThan(clientWidth * 3);
    expect((await boxOf(tab)).width).toBeLessThan(260);
    // The name that a screen reader and a search of the page use is the whole title.
    await expect(tab).toHaveAccessibleName(titleOf(url));
    await expect(viewer.closeLastButton(titleOf(url))).toBeAttached();

    await tab.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toContainText(titleOf(url));
    await expect(tooltip).toContainText(`${titleOf(url)}${url}`);
  });

  test('a tab address with markup in it is shown as the text it is, and runs nothing', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const url = 'https://example.com/<img/src=x/onerror=alert(1)>';
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });

    await viewer.address.fill(url);
    await viewer.address.press('Enter');

    await expect(viewer.tab(titleOf(url))).toBeVisible();
    await expect(viewer.address).toHaveValue(url);
    await viewer.tab(titleOf(url)).hover();
    await expect(page.getByRole('tooltip')).toContainText(url);
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('many tabs scroll sideways, and the tab that became active comes into view', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const urls = Array.from(
      { length: 8 },
      (_unused, index) => `https://example.com/tab-${index + 2}`,
    );
    for (const url of urls) await openTabAt(viewer, url);
    // The tabs lie in a strip that scrolls: the tab list is its grandchild.
    const strip = viewer.tablist.locator('xpath=../..');
    const scroll = () =>
      strip.evaluate((element) => ({
        left: element.scrollLeft,
        wide: element.scrollWidth,
        room: element.clientWidth,
      }));
    const insideStrip = async (tab: Locator) => {
      const [tabBox, stripBox] = [await boxOf(tab), await boxOf(strip)];
      return (
        tabBox.x >= stripBox.x - 1 &&
        tabBox.x + tabBox.width <= stripBox.x + stripBox.width + 1
      );
    };
    const last = viewer.tab(titleOf(urls.at(-1) ?? ''));

    // The new tab was scrolled to as it became the active one.
    await expect
      .poll(async () => (await scroll()).left, { timeout: TIMEOUT.VISIBLE })
      .toBeGreaterThan(0);
    const scrolled = await scroll();
    expect(scrolled.wide).toBeGreaterThan(scrolled.room);
    await expect.poll(() => insideStrip(last)).toBe(true);

    // A wheel that only turns up and down scrolls the strip sideways.
    await strip.hover();
    await page.mouse.wheel(0, -200);
    await expect
      .poll(async () => (await scroll()).left, { timeout: TIMEOUT.VISIBLE })
      .toBeLessThan(scrolled.left);

    // Choosing the first tab brings it into view.
    await viewer.tabs.first().click();
    await expect(viewer.tabs.first()).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => insideStrip(viewer.tabs.first())).toBe(true);
  });

  test('a tab closed from the keyboard with its button leaves the keyboard on the strip, on the tab next to it', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const { defaultStartPage } = await api.settings();
    const viewer = await openViewer(page, control, session);
    const second = 'https://example.com/second';
    await openTabAt(viewer, second);
    await viewer.closeButton(titleOf(second)).focus();

    await page.keyboard.press('Enter');

    await expect(viewer.tab(titleOf(second))).toHaveCount(0);
    // Not on the page behind the strip, which is where a button that goes drops the keyboard.
    await expect(viewer.tab(titleOf(defaultStartPage))).toBeFocused();
    await expect
      .poll(() => viewer.serverTabs().map(({ id }) => id))
      .toEqual([1]);
    expect(keysOf(await viewer.fake.events())).toEqual([]);
  });

  test('in forced colours the selected tab is told apart from the others by its mark', async ({
    page,
    api,
    control,
  }) => {
    // The fill of a tab is dropped in forced colours: the mark under it is what says which one it is.
    await page.emulateMedia({ forcedColors: 'active' });
    const session = await api.startSession('alpha');
    const { defaultStartPage } = await api.settings();
    const viewer = await openViewer(page, control, session);
    const second = 'https://example.com/second';
    await openTabAt(viewer, second);
    await expect(viewer.tab(titleOf(second))).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // The marks change colour with a transition: they are read where they come to rest.
    await animationsDone(page);
    const markOf = (title: string) =>
      viewer
        .tab(title)
        .evaluate((tab) => getComputedStyle(tab).borderBottomColor);

    expect(
      await page.evaluate(() => matchMedia('(forced-colors: active)').matches),
    ).toBe(true);
    const [selected, idle] = [
      await markOf(titleOf(second)),
      await markOf(titleOf(defaultStartPage)),
    ];
    // Both marks are the system's own colours (outside forced colours an idle tab has a transparent one), and differ.
    expect(selected).not.toBe(TRANSPARENT);
    expect(idle).not.toBe(TRANSPARENT);
    expect(selected).not.toBe(idle);
  });

  test('the wheel of the strip counts a line as 16 pixels and a page as the width of the strip, as the wheel of the picture does', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    for (let number = 2; number <= TABS_IN_MENU; number += 1) {
      await openTabAt(viewer, `https://example.com/tab-${number}`);
    }
    // The tabs lie in a strip that scrolls: the tab list is its grandchild.
    const strip = viewer.tablist.locator('xpath=../..');
    const { width, room } = await strip.evaluate((element) => ({
      width: element.clientWidth,
      room: element.scrollWidth - element.clientWidth,
    }));
    // From the start of the strip, the room for what is turned below.
    const NOTCH = 3;
    const QUARTER = 0.25;
    expect(room).toBeGreaterThan(width * QUARTER);
    /** Turns the wheel once over the strip, from its start, and says how far it went. */
    const turn = (deltaMode: number, deltaY: number) =>
      strip.evaluate(
        (element, [mode, delta]) => {
          element.scrollLeft = 0;
          element.dispatchEvent(
            new WheelEvent('wheel', {
              deltaMode: mode,
              deltaY: delta,
              bubbles: true,
              cancelable: true,
            }),
          );
          return element.scrollLeft;
        },
        [deltaMode, deltaY] as const,
      );

    // A notch of a wheel that turns by lines is three lines.
    expect(await turn(WHEEL.LINES, NOTCH)).toBe(NOTCH * LINE_HEIGHT);
    // A page is the width of the strip.
    const quarter = await turn(WHEEL.PAGES, QUARTER);
    expect(Math.abs(quarter - width * QUARTER)).toBeLessThanOrEqual(1);
    // Pixels are pixels.
    expect(await turn(WHEEL.PIXELS, 100)).toBe(100);
  });

  test('a page with a very long address and title is shown cut in the live view: 2,048 characters of the address and 512 of the title', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const address = `https://example.com/${'a'.repeat(3 * MAX_TAB_URL)}`;

    await viewer.address.fill(address);
    await viewer.address.press('Enter');

    // What the live view carries of the page is cut: a page decides both, and could make them as long as it liked.
    await expect
      .poll(() => viewer.serverTabs()[0]?.title.length, {
        timeout: TIMEOUT.VISIBLE,
        message: 'the tab of the long address arrived',
      })
      .toBe(MAX_TAB_TITLE);
    const [tab] = viewer.serverTabs();
    expect(tab?.url).toBe(address.slice(0, MAX_TAB_URL));
    // A title ends in an ellipsis where it was cut; an address is cut as it is, and is no address any more.
    expect(tab?.title.endsWith('…')).toBe(true);
    expect(titleOf(address).startsWith(tab?.title.slice(0, -1) ?? '')).toBe(
      true,
    );
    // The person sees what came, and the browser was sent the whole address.
    await expect(viewer.tab(tab?.title ?? '')).toBeVisible();
    await expect(viewer.address).toHaveValue(address.slice(0, MAX_TAB_URL));
    expect(navigationsOf(await viewer.fake.events())).toEqual([address]);
  });

  test('with a mouse the controls have no invisible reach, and the close button stays 24 pixels', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const { defaultStartPage } = await api.settings();
    const viewer = await openViewer(page, control, session);
    const close = viewer.closeLastButton(titleOf(defaultStartPage));
    const controls = [
      viewer.tab(titleOf(defaultStartPage)),
      close,
      viewer.newTab,
      viewer.back,
      viewer.forward,
      viewer.reload,
      viewer.secrets,
    ];

    // The reach is a finger's: nothing of it is there for a pointer that is fine.
    for (const one of controls) {
      expect(
        await one.evaluate(
          (element) => getComputedStyle(element, '::after').content,
        ),
      ).toBe('none');
    }
    const box = await boxOf(close);
    expect([box.width, box.height]).toEqual([MOUSE_CLOSE, MOUSE_CLOSE]);
  });

  test('the close button of the only tab says that it also stops the session, and says the plain thing once there are others', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const { defaultStartPage } = await api.settings();
    const second = 'https://example.com/second';
    const viewer = await openViewer(page, control, session);
    const first = titleOf(defaultStartPage);

    // One tab: closing it ends the browser, so the button says it.
    await expect(viewer.closeLastButton(first)).toBeVisible();
    await expect(viewer.closeButton(first)).toHaveCount(0);

    await openTabAt(viewer, second);

    // Two tabs: each can go and the session stays.
    await expect(viewer.closeButton(first)).toBeVisible();
    await expect(viewer.closeButton(titleOf(second))).toBeVisible();
    await expect(viewer.closeLastButton(first)).toHaveCount(0);
    await expect(viewer.closeLastButton(titleOf(second))).toHaveCount(0);

    await viewer.closeButton(titleOf(second)).click();

    // Back to one: the warning is back with it.
    await expect(viewer.tabs).toHaveCount(1);
    await expect(viewer.closeLastButton(first)).toBeVisible();
    await expect(viewer.closeButton(first)).toHaveCount(0);
  });

  test('when the tabs do not fit a menu lists all of them, and choosing one makes it the active one', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const { defaultStartPage } = await api.settings();
    const viewer = await openViewer(page, control, session);
    const more = page.getByRole('button', { name: t('viewer.tabs.more') });
    // Few tabs have room: there is no menu to look in.
    await expect(more).toHaveCount(0);
    const urls = Array.from(
      { length: TABS_IN_MENU - 1 },
      (_unused, index) => `https://example.com/tab-${index + 2}`,
    );
    for (const url of urls) await openTabAt(viewer, url);
    await expect(viewer.tabs).toHaveCount(TABS_IN_MENU);
    const titles = [defaultStartPage, ...urls].map(titleOf);

    await more.click();

    // Every tab is in it, in the order of the strip, whether it is on the screen or not.
    const menu = page.getByRole('menu', { name: t('viewer.tabs.more') });
    await expect(menu.getByRole('menuitem')).toHaveText(titles);
    // The first one is far off to the left of the strip: choose it from the menu.
    await menu.getByRole('menuitem', { name: titles[0], exact: true }).click();

    await expect(menu).toBeHidden();
    await expect(viewer.tab(titles[0] ?? '')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(viewer.address).toHaveValue(defaultStartPage);
    await expect
      .poll(() => viewer.serverTabs().find(({ active }) => active)?.id)
      .toBe(1);
    expect(viewer.watch.sent()).toContainEqual({
      t: 'tab',
      a: 'activate',
      id: 1,
    });
    // The menu hands the keyboard back to its own button, and the strip scrolled to the tab that was chosen.
    await expect(more).toBeFocused();
    await expect
      .poll(async () => {
        const [tabBox, stripBox] = [
          await boxOf(viewer.tab(titles[0] ?? '')),
          await boxOf(viewer.tablist.locator('xpath=../..')),
        ];
        return (
          tabBox.x >= stripBox.x - 1 &&
          tabBox.x + tabBox.width <= stripBox.x + stripBox.width + 1
        );
      })
      .toBe(true);
  });
});

/** The ids of the dialogs the server has shown the page, in order. */
function dialogIds(viewer: Viewer): number[] {
  return viewer.watch
    .received()
    .flatMap((message) => (message.t === 'dialog' ? [message.id] : []));
}

test.describe('the dialogs of the page', () => {
  const dialogOf = (page: Page) =>
    page.getByRole('dialog', { name: t('viewer.dialog.title') });

  test('an alert shows what the page says and where from, and OK answers it and gives the keyboard back', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const { defaultStartPage } = await api.settings();
    const viewer = await openViewer(page, control, session);
    await viewer.picture.focus();

    await control.openDialog(session.name, {
      kind: 'alert',
      message: 'Hello from the page',
    });

    const dialog = dialogOf(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Hello from the page');
    // What the page says is the description of the dialog: a screen reader reads it with the name.
    await expect(dialog).toHaveAccessibleDescription('Hello from the page');
    // It says where it comes from: the host of the tab that asked, never the title that page gave itself.
    await expect(dialog).toContainText(new URL(defaultStartPage).host);
    await expect(dialog).not.toContainText(titleOf(defaultStartPage));
    await expect(dialog.getByRole('button')).toHaveText([
      t('viewer.dialog.ok'),
    ]);
    await expect(
      dialog.getByRole('button', { name: t('viewer.dialog.ok') }),
    ).toBeFocused();

    await dialog.getByRole('button', { name: t('viewer.dialog.ok') }).click();

    await expect(dialog).toBeHidden();
    const events = await viewer.fake.when(
      (all) => answersOf(all).length === 1,
      'the answer reached the browser',
    );
    expect(answersOf(events)).toEqual([
      { id: dialogIds(viewer)[0], accept: true, text: null },
    ]);
    expect((await viewer.fake.state()).dialogs).toEqual([]);
    await expect(viewer.keyboard).toBeFocused();
    // The page has the keyboard again: typing goes to it.
    await page.keyboard.press('x');
    await viewer.fake.when(
      (all) => keyTrace(all).includes('up x'),
      'the key reached the browser',
    );
  });

  test('a confirm is answered with OK, with Enter, or with Cancel', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await viewer.picture.focus();
    const dialog = dialogOf(page);

    await control.openDialog(session.name, {
      kind: 'confirm',
      message: 'Delete everything?',
    });
    await expect(dialog).toContainText('Delete everything?');
    await expect(dialog.getByRole('button')).toHaveText([
      t('common.actions.cancel'),
      t('viewer.dialog.ok'),
    ]);
    await dialog
      .getByRole('button', { name: t('common.actions.cancel') })
      .click();
    await expect(dialog).toBeHidden();

    await control.openDialog(session.name, {
      kind: 'confirm',
      message: 'Sure?',
    });
    await expect(dialog).toContainText('Sure?');
    await dialog.getByRole('button', { name: t('viewer.dialog.ok') }).click();
    await expect(dialog).toBeHidden();

    await control.openDialog(session.name, {
      kind: 'confirm',
      message: 'Really?',
    });
    await expect(dialog).toContainText('Really?');
    // The OK button has the focus once the dialog has settled: Enter answers yes.
    await expect(
      dialog.getByRole('button', { name: t('viewer.dialog.ok') }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();

    const events = await viewer.fake.when(
      (all) => answersOf(all).length === 3,
      'the three answers reached the browser',
    );
    const ids = dialogIds(viewer);
    expect(ids).toHaveLength(3);
    expect(answersOf(events)).toEqual([
      { id: ids[0], accept: false, text: null },
      { id: ids[1], accept: true, text: null },
      { id: ids[2], accept: true, text: null },
    ]);
    await expect(viewer.keyboard).toBeFocused();
  });

  test('a prompt starts with its default answer, and what is typed is the answer', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await viewer.picture.focus();
    const dialog = dialogOf(page);
    // The question names the field.
    const answer = dialog.getByRole('textbox', { name: 'Your name?' });

    await control.openDialog(session.name, {
      kind: 'prompt',
      message: 'Your name?',
      defaultValue: 'Ada',
    });
    await expect(dialog).toContainText('Your name?');
    await expect(answer).toHaveValue('Ada');
    // The answer is where the keyboard is, with its text selected: typing replaces it.
    await expect(answer).toBeFocused();
    await page.keyboard.type('Grace Hopper');
    await expect(answer).toHaveValue('Grace Hopper');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();

    await control.openDialog(session.name, {
      kind: 'prompt',
      message: 'And your name again?',
      defaultValue: 'Ada',
    });
    await expect(
      dialog.getByRole('textbox', { name: 'And your name again?' }),
    ).toHaveValue('Ada');
    await dialog.getByRole('button', { name: t('viewer.dialog.ok') }).click();
    await expect(dialog).toBeHidden();

    await control.openDialog(session.name, {
      kind: 'prompt',
      message: 'Never mind',
      defaultValue: 'unused',
    });
    await expect(dialog).toContainText('Never mind');
    await dialog
      .getByRole('button', { name: t('common.actions.cancel') })
      .click();
    await expect(dialog).toBeHidden();

    const events = await viewer.fake.when(
      (all) => answersOf(all).length === 3,
      'the three answers reached the browser',
    );
    const ids = dialogIds(viewer);
    const [first, second, third] = answersOf(events);
    expect(first).toEqual({ id: ids[0], accept: true, text: 'Grace Hopper' });
    expect(second).toEqual({ id: ids[1], accept: true, text: 'Ada' });
    // A refusal carries no answer worth reading: it is not accepted.
    expect(third).toMatchObject({ id: ids[2], accept: false });
    await expect(viewer.keyboard).toBeFocused();
  });

  test('leaving a page asks whether to leave, in the words of the browser when the page has none', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await viewer.picture.focus();
    const dialog = page.getByRole('dialog', {
      name: t('viewer.dialog.leaveTitle'),
    });

    await control.openDialog(session.name, {
      kind: 'beforeunload',
      message: '',
    });
    await expect(dialog).toContainText(t('viewer.dialog.leaveBody'));
    await expect(dialog.getByRole('button')).toHaveText([
      t('viewer.dialog.stay'),
      t('viewer.dialog.leave'),
    ]);
    await dialog.getByRole('button', { name: t('viewer.dialog.stay') }).click();
    await expect(dialog).toBeHidden();

    await control.openDialog(session.name, {
      kind: 'beforeunload',
      message: 'You have unsaved changes',
    });
    await expect(dialog).toContainText('You have unsaved changes');
    await dialog
      .getByRole('button', { name: t('viewer.dialog.leave') })
      .click();
    await expect(dialog).toBeHidden();

    const events = await viewer.fake.when(
      (all) => answersOf(all).length === 2,
      'both answers reached the browser',
    );
    const ids = dialogIds(viewer);
    expect(answersOf(events)).toEqual([
      { id: ids[0], accept: false, text: null },
      { id: ids[1], accept: true, text: null },
    ]);
  });

  test('a dialog shows the words of the page as text, with its line breaks', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await viewer.picture.focus();
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    const words =
      '<b>bold</b> & <script>alert(2)</script>\nsecond line\n\n  indented';

    await control.openDialog(session.name, { kind: 'alert', message: words });

    const dialog = dialogOf(page);
    const message = dialog.getByText('second line');
    await expect(message).toBeVisible();
    await expect(message).toHaveText(words);
    // Not markup: no element came of it, and the line breaks are the dialog's own.
    await expect(dialog.locator('b, script')).toHaveCount(0);
    await expect(message).toHaveCSS('white-space', 'pre-wrap');
    expect(dialogs).toEqual([]);
    await dialog.getByRole('button', { name: t('viewer.dialog.ok') }).click();
    await expect(dialog).toBeHidden();
  });

  test('a dialog says where it comes from by the host of the tab, which a page cannot choose, and not by the title it gave itself', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const address = 'https://shop.example.com:8443/cart?id=7';
    await viewer.address.fill(address);
    await viewer.address.press('Enter');
    await expect(viewer.tab(titleOf(address))).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const dialog = dialogOf(page);

    await control.openDialog(session.name, {
      kind: 'confirm',
      message: 'Pay now?',
    });

    // The host with its port, and nothing of the path or of the title the page is called.
    await expect(dialog).toContainText('shop.example.com:8443');
    await expect(dialog).not.toContainText('/cart');
    await expect(dialog).not.toContainText(titleOf(address));
    await expect(dialog).toHaveAccessibleDescription('Pay now?');
  });

  test('a prompt that asks nothing has a field called Answer', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await viewer.picture.focus();
    const dialog = dialogOf(page);

    await control.openDialog(session.name, {
      kind: 'prompt',
      message: '',
      defaultValue: 'Ada',
    });

    const answer = dialog.getByRole('textbox', {
      name: t('viewer.dialog.answer'),
    });
    await expect(answer).toHaveValue('Ada');
    await expect(answer).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    const events = await viewer.fake.when(
      (all) => answersOf(all).length === 1,
      'the answer reached the browser',
    );
    expect(answersOf(events)).toMatchObject([{ accept: true, text: 'Ada' }]);
  });

  test('closing a dialog with Escape is the careful answer: no', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await viewer.picture.focus();
    const dialog = dialogOf(page);

    await control.openDialog(session.name, {
      kind: 'confirm',
      message: 'Escape me',
    });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(dialog).toBeHidden();
    const events = await viewer.fake.when(
      (all) => answersOf(all).length === 1,
      'the answer reached the browser',
    );
    expect(answersOf(events)).toEqual([
      { id: dialogIds(viewer)[0], accept: false, text: null },
    ]);
    await expect(viewer.keyboard).toBeFocused();
  });

  test('two dialogs in a row are asked one at a time, in the order they came', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await viewer.picture.focus();
    const dialog = dialogOf(page);

    await control.openDialog(session.name, {
      kind: 'alert',
      message: 'First one',
    });
    await control.openDialog(session.name, {
      kind: 'confirm',
      message: 'Second one',
    });

    await expect(dialog).toHaveCount(1);
    await expect(dialog).toContainText('First one');
    await expect(dialog).not.toContainText('Second one');
    await dialog.getByRole('button', { name: t('viewer.dialog.ok') }).click();

    await expect(dialog).toContainText('Second one');
    await expect(dialog).toHaveCount(1);
    // The second one is a dialog of its own: the focus is in it, not in the page.
    await expect(
      dialog.getByRole('button', { name: t('viewer.dialog.ok') }),
    ).toBeFocused();
    await dialog
      .getByRole('button', { name: t('common.actions.cancel') })
      .click();

    await expect(dialog).toBeHidden();
    const events = await viewer.fake.when(
      (all) => answersOf(all).length === 2,
      'both answers reached the browser',
    );
    const ids = dialogIds(viewer);
    expect(ids).toHaveLength(2);
    expect(answersOf(events)).toEqual([
      { id: ids[0], accept: true, text: null },
      { id: ids[1], accept: false, text: null },
    ]);
    await expect(viewer.keyboard).toBeFocused();
    expect((await viewer.fake.state()).dialogs).toEqual([]);
  });

  test('a list of secrets that is open gives way to a dialog of the page, and the keyboard goes to the page after it', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const secrets = page.getByRole('dialog', {
      name: t('viewer.secrets.title'),
    });
    await viewer.secrets.click();
    await expect(secrets).toBeVisible();

    await control.openDialog(session.name, {
      kind: 'confirm',
      message: 'While you were choosing',
    });

    const dialog = dialogOf(page);
    await expect(dialog).toContainText('While you were choosing');
    await expect(secrets).toBeHidden();
    await dialog.getByRole('button', { name: t('viewer.dialog.ok') }).click();
    await expect(dialog).toBeHidden();
    await expect(viewer.keyboard).toBeFocused();
    const events = await viewer.fake.when(
      (all) => answersOf(all).length === 1,
      'the answer reached the browser',
    );
    expect(answersOf(events)).toMatchObject([{ accept: true }]);
  });

  test('a dialog that is open when the browser closes goes with it, and leaves the page usable', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await control.openDialog(session.name, {
      kind: 'confirm',
      message: 'Then the browser dies',
    });
    const dialog = dialogOf(page);
    await expect(dialog).toBeVisible();

    await control.crash(session.name);

    await expect(dialog).toBeHidden();
    await expect(startButton(page)).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    // Nothing of the modal is left over the page: the person can go on.
    await startButton(page).click();
    await viewer.waitUntilLive();
    await expect(viewer.address).toBeEnabled();
  });

  test('a dialog that was waiting before the viewer opened is asked as soon as it does', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    await control.openDialog(session.name, {
      kind: 'confirm',
      message: 'Asked while nobody looked',
    });

    const viewer = await visitViewer(page, control, session);

    const dialog = dialogOf(page);
    await expect(dialog).toContainText('Asked while nobody looked');
    await waitForPictures(viewer.watch);
    await dialog.getByRole('button', { name: t('viewer.dialog.ok') }).click();
    await expect(dialog).toBeHidden();
    const events = await viewer.fake.when(
      (all) => answersOf(all).length === 1,
      'the answer reached the browser',
    );
    expect(answersOf(events)).toMatchObject([{ accept: true }]);
    expect((await viewer.fake.state()).dialogs).toEqual([]);
  });
});

/** The tokens of the lists the server has opened in the page, in order. */
function listTokens(viewer: Viewer): number[] {
  return viewer.watch
    .received()
    .flatMap((message) => (message.t === 'select' ? [message.token] : []));
}

test.describe('the drop-down lists of the page', () => {
  const listOf = (page: Page) =>
    page.getByRole('listbox', { name: t('viewer.select.label') });
  const FRUIT = ['Apple', 'Banana', 'Cherry', 'Date'];

  for (const size of [
    { width: 1280, height: 800 },
    { width: 900, height: 640 },
  ]) {
    test.describe(`in a window of ${size.width} x ${size.height}`, () => {
      test.use({ viewport: size });

      test('a list opens under the field of the page, as wide as it is, with the choice of the page marked', async ({
        page,
        api,
        control,
      }) => {
        const session = await api.startSession('alpha');
        const viewer = await openViewer(page, control, session);
        await viewer.picture.focus();

        await control.openSelect(session.name, ['First', 'Second', 'Third']);

        const list = listOf(page);
        await expect(list).toBeVisible();
        await expect(list.getByRole('option')).toHaveText([
          'First',
          'Second',
          'Third',
        ]);
        await expect(
          list.getByRole('option', { name: 'First' }),
        ).toHaveAttribute('aria-selected', 'true');
        await expect(
          list.getByRole('option', { name: 'Second' }),
        ).toHaveAttribute('aria-selected', 'false');
        await expect(list.getByRole('option', { name: 'First' })).toBeFocused();
        // The field of the fake page: 120 x 24 pixels at 10, 20 of the page.
        const [select] = viewer.watch
          .received()
          .flatMap((message) => (message.t === 'select' ? [message] : []));
        expect(select).toMatchObject({ x: 10, y: 20, width: 120, height: 24 });
        const picture = await boxOf(viewer.picture);
        const scale = picture.width / PAGE.width;
        const box = await boxOf(list);
        expectPoint(
          box,
          {
            x: picture.x + (select?.x ?? 0) * scale,
            y:
              picture.y +
              ((select?.y ?? 0) + (select?.height ?? 0)) * scale +
              2,
          },
          'the top left corner of the list',
        );
        expect(box.width).toBeGreaterThanOrEqual(
          Math.max((select?.width ?? 0) * scale, 120) - 1,
        );
      });
    });
  }

  test('choosing an option answers the list with its place, closes it and gives the keyboard back', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await viewer.picture.focus();
    const list = listOf(page);

    await control.openSelect(session.name, ['First', 'Second', 'Third']);
    await list.getByRole('option', { name: 'Third' }).click();

    await expect(list).toBeHidden();
    const events = await viewer.fake.when(
      (all) => picksOf(all).length === 1,
      'the choice reached the browser',
    );
    expect(picksOf(events)).toEqual([
      { token: listTokens(viewer)[0], index: 2 },
    ]);
    await expect(viewer.keyboard).toBeFocused();
  });

  test('Escape closes a list without a choice, and tells the page so', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await viewer.picture.focus();
    const list = listOf(page);

    await control.openSelect(session.name, ['First', 'Second']);
    await expect(list).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(list).toBeHidden();
    const events = await viewer.fake.when(
      (all) => picksOf(all).length === 1,
      'the answer reached the browser',
    );
    expect(picksOf(events)).toEqual([
      { token: listTokens(viewer)[0], index: null },
    ]);
    await expect(viewer.keyboard).toBeFocused();
    // The Escape was the list's: the page did not get it.
    await viewer.flush();
    expect(keysOf(await viewer.fake.events())).toEqual([]);
  });

  test('a list is used with the keyboard: arrows, Home and End, the first letters, Enter and Space', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await viewer.picture.focus();
    const list = listOf(page);
    const option = (name: string) => list.getByRole('option', { name });
    const open = async () => {
      await control.openSelect(session.name, FRUIT);
      await expect(option('Apple')).toBeFocused();
    };

    await open();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(option('Cherry')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(list).toBeHidden();

    await open();
    await page.keyboard.press('End');
    await expect(option('Date')).toBeFocused();
    // Round the end, in both directions.
    await page.keyboard.press('ArrowDown');
    await expect(option('Apple')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(option('Date')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(option('Apple')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(list).toBeHidden();

    await open();
    await page.keyboard.press('c');
    await expect(option('Cherry')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(list).toBeHidden();

    await open();
    await page.keyboard.press('Tab');
    await expect(list).toBeHidden();

    const events = await viewer.fake.when(
      (all) => picksOf(all).length === 4,
      'the four answers reached the browser',
    );
    const tokens = listTokens(viewer);
    expect(picksOf(events)).toEqual([
      { token: tokens[0], index: 2 },
      { token: tokens[1], index: 0 },
      { token: tokens[2], index: 2 },
      // Tab is the way out: no choice.
      { token: tokens[3], index: null },
    ]);
    // None of it was the page's keyboard.
    await viewer.flush();
    expect(keysOf(await viewer.fake.events())).toEqual([]);
  });

  test('a press elsewhere closes the list without a choice, and still reaches the page', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await viewer.picture.focus();
    const list = listOf(page);
    const aim = await viewer.at(0.5, 0.8);

    await control.openSelect(session.name, FRUIT);
    await expect(list).toBeVisible();
    await page.mouse.click(aim.screen.x, aim.screen.y);

    await expect(list).toBeHidden();
    const events = await viewer.fake.when(
      (all) =>
        picksOf(all).length === 1 &&
        mouseOf(all).some(({ action }) => action === 'up'),
      'the answer and the click reached the browser',
    );
    expect(picksOf(events)).toEqual([
      { token: listTokens(viewer)[0], index: null },
    ]);
    const press = mouseOf(events).find(({ action }) => action === 'down');
    expectPoint(press ?? NOWHERE, aim.page, 'the press');
  });

  test('a long list scrolls in a height of its own and the keyboard brings the option it is on into view', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await viewer.picture.focus();
    const list = listOf(page);
    const options = Array.from(
      { length: 60 },
      (_unused, index) => `Option ${index + 1}`,
    );

    await control.openSelect(session.name, options);
    await expect(list).toBeVisible();
    const sizes = await list.evaluate((element) => ({
      shown: element.clientHeight,
      whole: element.scrollHeight,
    }));
    expect(sizes.whole).toBeGreaterThan(sizes.shown);
    expect(sizes.shown).toBeLessThanOrEqual(320);

    await page.keyboard.press('End');
    const last = list.getByRole('option', { name: 'Option 60', exact: true });
    await expect(last).toBeFocused();
    const [listBox, lastBox] = [await boxOf(list), await boxOf(last)];
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(
      listBox.y + listBox.height + 1,
    );
    await page.keyboard.press('Enter');
    await expect(list).toBeHidden();
    const events = await viewer.fake.when(
      (all) => picksOf(all).length === 1,
      'the choice reached the browser',
    );
    expect(picksOf(events)).toEqual([
      { token: listTokens(viewer)[0], index: 59 },
    ]);
  });
});

/** Presses Tab until `target` has the keyboard (at most `limit` presses). */
async function tabTo(page: Page, target: Locator, limit = 20): Promise<void> {
  for (let presses = 0; presses < limit; presses++) {
    if (
      await target.evaluate((element) => element === document.activeElement)
    ) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

/** Everything the page holds as text and markup: what a masked value must never be in. */
async function everythingShown(page: Page): Promise<string> {
  return `${await page.locator('body').innerText()}\n${await page.content()}`;
}

test.describe('secrets in the viewer', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  const PASSWORD = 'hunter2 / s3cret ü';
  /** The name of the button that adds a secret for the session. */
  const addLabel = (name: string) =>
    fill(t('viewer.secrets.add'), {
      name: fill(t('sessions.quoted'), { text: name }),
    });
  const popoverOf = (page: Page) =>
    page.getByRole('dialog', { name: t('viewer.secrets.title') });

  /** A session with one secret of its own, one for every session, and one of another session. */
  async function setUp(api: AppApi) {
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

  test('lists the secrets of this session and those of every session in groups by kind, and none of another session', async ({
    page,
    api,
    control,
  }) => {
    const session = await setUp(api);
    // Newer than the login of the shop, and of the same kind.
    await api.createSecret({
      kind: 'credentials',
      title: 'Bank login',
      sessionId: session.id,
      fields: [{ label: 'Username', value: 'ada@bank.example' }],
    });
    const viewer = await openViewer(page, control, session);

    await viewer.secrets.click();

    const popover = popoverOf(page);
    await expect(popover).toBeVisible();
    // The groups are in the order of the kinds, the secrets of a group newest first.
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
    const [newer, older] = [
      await boxOf(popover.getByRole('button', { name: /Bank login/ })),
      await boxOf(mine),
    ];
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

  test('typing a field puts its exact value into the page and never shows a masked one on the screen', async ({
    page,
    api,
    control,
  }) => {
    const session = await setUp(api);
    const viewer = await openViewer(page, control, session);
    await viewer.picture.focus();
    await viewer.secrets.click();
    const popover = popoverOf(page);
    await popover.getByRole('button', { name: /Shop login/ }).click();

    // Opened, the secret shows its fields; the password is dots, named for a screen reader.
    await expect(
      popover.getByText('ada@example.com', { exact: true }),
    ).toBeVisible();
    await expect(
      popover.getByText(t('viewer.secrets.maskedValue')),
    ).toHaveCount(1);
    expect(await everythingShown(page)).not.toContain(PASSWORD);

    await popover
      .getByRole('button', {
        name: fill(t('viewer.secrets.typeLabel'), { label: 'Password' }),
      })
      .click();

    await expect(popover).toBeHidden();
    const events = await viewer.fake.when(
      (all) => textsOf(all).length === 1,
      'the value reached the browser',
    );
    expect(textsOf(events)).toEqual([PASSWORD]);
    // It went to the page as text; it is not on the screen of the manager.
    expect(await everythingShown(page)).not.toContain(PASSWORD);
    // The keyboard is in the page: what is typed next goes there.
    await expect(viewer.keyboard).toBeFocused();
    await page.keyboard.press('x');
    const typedAfter = await viewer.fake.when(
      (all) => keyTrace(all).includes('up x'),
      'the next key reached the browser',
    );
    expect(textsOf(typedAfter)).toEqual([PASSWORD]);
  });

  test('a masked value is shown only while its eye is pressed, and copying it does not show it', async ({
    page,
    api,
    control,
  }) => {
    const session = await setUp(api);
    const viewer = await openViewer(page, control, session);
    await viewer.secrets.click();
    const popover = popoverOf(page);
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
    // Copying is not typing: nothing went to the page.
    await viewer.picture.focus();
    await viewer.flush();
    expect(textsOf(await viewer.fake.events())).toHaveLength(1);
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
    const viewer = await openViewer(page, control, session);

    await viewer.secrets.click();
    const popover = popoverOf(page);
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
    await popover
      .getByRole('button', {
        name: fill(t('viewer.secrets.typeLabel'), { label: 'Note' }),
      })
      .click();
    const events = await viewer.fake.when(
      (all) => textsOf(all).length === 1,
      'the value reached the browser',
    );
    expect(textsOf(events)).toEqual([note]);
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
    const viewer = await openViewer(page, control, session);
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });

    await viewer.secrets.click();
    const popover = popoverOf(page);
    await popover.getByRole('button', { name: literally(title) }).click();
    // The row's preview line says the same words: the value is the one in the opened secret.
    const opened = popover.getByRole('group', { name: title, exact: true });
    await expect(opened.getByText(value, { exact: true })).toBeVisible();
    await expect(popover.locator('i, b, script')).toHaveCount(0);
    await popover
      .getByRole('button', {
        name: fill(t('viewer.secrets.typeLabel'), { label: 'Note' }),
      })
      .click();

    const events = await viewer.fake.when(
      (all) => textsOf(all).length === 1,
      'the value reached the browser',
    );
    expect(textsOf(events)).toEqual([value]);
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
    const viewer = await openViewer(page, control, session);
    // The server words a card's date as "Expiry", and the page as the person reads it.
    const expiry = t('secrets.fields.expiry');
    expect(expiry).not.toBe('Expiry');

    await viewer.secrets.click();
    const popover = popoverOf(page);
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
    await popover
      .getByRole('button', {
        name: fill(t('viewer.secrets.typeLabel'), { label: expiry }),
      })
      .click();
    const events = await viewer.fake.when(
      (all) => textsOf(all).length === 1,
      'the value reached the browser',
    );
    expect(textsOf(events)).toEqual(['12/30']);
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
      // Named after what it opens, in German; it works once the live view does.
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
      const events = await new Fake(control, session.name).when(
        (all) => textsOf(all).length === 1,
        'the value reached the browser',
      );
      expect(textsOf(events)).toEqual(['12/30']);
    });
  });

  test('a long list scrolls inside the popover while its heading and its foot stay where they are', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    for (let number = 1; number <= MANY_SECRETS; number += 1) {
      await api.createSecret({
        kind: 'note',
        title: `Note ${number}`,
        sessionId: session.id,
        fields: [{ label: 'Note', value: `text ${number}` }],
      });
    }
    const viewer = await openViewer(page, control, session);
    await viewer.secrets.click();
    const popover = popoverOf(page);
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

  test('works by keyboard: open it, choose a secret, type a value, and the keyboard is in the page', async ({
    page,
    api,
    control,
  }) => {
    const session = await setUp(api);
    const viewer = await openViewer(page, control, session);
    const popover = popoverOf(page);

    await viewer.secrets.focus();
    await page.keyboard.press('Enter');
    await expect(popover).toBeVisible();
    const secret = popover.getByRole('button', { name: /Shop login/ });
    await tabTo(page, secret);
    await page.keyboard.press('Enter');
    await expect(secret).toHaveAttribute('aria-expanded', 'true');
    await tabTo(
      page,
      popover.getByRole('button', {
        name: fill(t('viewer.secrets.typeLabel'), { label: 'Username' }),
      }),
    );
    await page.keyboard.press('Enter');

    await expect(popover).toBeHidden();
    await expect(viewer.keyboard).toBeFocused();
    await viewer.fake.when(
      (all) => textsOf(all).length === 1,
      'the value reached the browser',
    );
    // Typed once, and the Enter that chose it did not go to the page as a key.
    await viewer.flush();
    const all = await viewer.fake.events();
    expect(textsOf(all).filter((text) => text === 'ada@example.com')).toEqual([
      'ada@example.com',
    ]);
    expect(keyTrace(all)).not.toContain('down Enter');

    // Escape closes it, and the keyboard goes back to the button that opened it.
    await viewer.secrets.focus();
    await page.keyboard.press('Space');
    await expect(popover).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(viewer.secrets).toBeFocused();
  });

  test('says that there is no secret yet, and offers to add one for the session', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);

    await viewer.secrets.click();

    const popover = popoverOf(page);
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

  test("adding a secret for the session opens its form over the live view, and the secret is the session's at once", async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const sockets = await LiveSockets.route(page);
    const viewer = await openViewer(page, control, session);
    await viewer.secrets.click();
    const popover = popoverOf(page);

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
    await expect(notice(page, t('secrets.toasts.created'))).toBeVisible();
    expect(await api.secrets()).toMatchObject([
      { title: 'Shop login', session: { id: session.id } },
    ]);
    // The live view was never left, and the keyboard is back on the button that opened the list.
    await expect(viewer.picture).toBeVisible();
    expect(sockets.attempts).toBe(1);
    await expect(viewer.secrets).toBeFocused();

    // The list has the new secret, and its value can be typed.
    await viewer.secrets.click();
    await popover.getByRole('button', { name: /Shop login/ }).click();
    await popover
      .getByRole('button', {
        name: fill(t('viewer.secrets.typeLabel'), { label: 'Username' }),
      })
      .click();
    const events = await viewer.fake.when(
      (all) => textsOf(all).length === 1,
      'the value reached the browser',
    );
    expect(textsOf(events)).toEqual(['ada@example.com']);
  });

  test('giving up a form with something in it asks first, and nothing is added when it is given up', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await viewer.secrets.click();
    await popoverOf(page)
      .getByRole('button', { name: addLabel(session.name) })
      .click();
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
    await expect(viewer.secrets).toBeFocused();
  });

  test('a form with nothing in it is given up without asking', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await viewer.secrets.click();
    await popoverOf(page)
      .getByRole('button', { name: addLabel(session.name) })
      .click();
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
    await expect(viewer.secrets).toBeFocused();
  });

  test('the arrow keys, Home and End move between the secrets of the list, round the ends', async ({
    page,
    api,
    control,
  }) => {
    const session = await setUp(api);
    const viewer = await openViewer(page, control, session);
    await viewer.secrets.click();
    const popover = popoverOf(page);
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
    // They are the list's keys: the page got none.
    await viewer.picture.focus();
    await viewer.flush();
    expect(keysOf(await viewer.fake.events())).toEqual([]);
  });
});

test.describe('the session around the stage', () => {
  test('while the session starts the page shows its progress and no picture', async ({
    page,
    api,
    control,
  }) => {
    // The browser takes its time to come up, so that the page can be looked at meanwhile.
    await control.faults({ launchDelayMs: SLOW_START_MS });
    await api.addProxies(1);
    const created = await api.createSession('alpha');

    const viewer = await visitViewer(page, control, created);

    const progress = page
      .getByRole('status')
      .filter({ hasText: t('sessions.status.starting') });
    await expect(progress).toBeVisible();
    // The header names the session and says where it stands; the card tells what it is.
    await expect(
      page.getByRole('heading', { level: 1, name: created.name }),
    ).toBeVisible();
    await expect(
      viewer.header.getByText(t('sessions.status.starting')),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: t('viewer.details.title') }),
    ).toBeVisible();
    await expect(page.getByRole('application')).toHaveCount(0);
    await expect(page.locator('canvas')).toHaveCount(0);
    // The one button is Stop while it starts: there is nothing to start.
    await expect(startButton(page)).toHaveCount(0);
    await expect(viewer.stop).toBeVisible();

    // Then the browser is there, and so is its picture.
    await expect(viewer.picture).toBeVisible({ timeout: TIMEOUT.BACKGROUND });
    await expect(progress).toBeHidden();
  });

  test('Stop in the header stops the session and shows the card of a stopped session, with Start in the header', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);

    await viewer.stop.click();

    await expect(startButton(page)).toBeVisible();
    // The header says where the session stands; the card does not say it again.
    await expect(
      viewer.header.getByText(t('sessions.status.stopped')),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: t('viewer.details.title') }),
    ).toBeVisible();
    await expect(page.getByText(t('viewer.card.hint'))).toBeVisible();
    // What the card tells of the session: the same list as the details of a running one.
    const place = session.location;
    for (const [label, value] of [
      [t('viewer.card.timeZone'), session.fingerprint.timezone],
      [t('viewer.card.language'), session.fingerprint.locale],
      [
        t('viewer.card.location'),
        `${place?.latitude.toFixed(3)} / ${place?.longitude.toFixed(3)}`,
      ],
      [
        t('viewer.card.ipAddress'),
        `${exitIpOf(session)} · ${session.proxy?.country}`,
      ],
    ] as const) {
      await expect(
        page
          .getByRole('main')
          .getByText(label, { exact: true })
          .locator('xpath=..'),
        label,
      ).toContainText(value ?? '');
    }
    // The chip with the exit IP is there for a session that is stopped too.
    await expect(viewer.exitChip(exitIpOf(session))).toBeVisible();
    await expect(viewer.picture).toHaveCount(0);
    await expect(viewer.tablist).toHaveCount(0);
    await expect(viewer.stop).toHaveCount(0);
    // One Start for the page, and it is the header's.
    await expect(
      viewer.header.getByRole('button', {
        name: t('viewer.actions.start'),
        exact: true,
      }),
    ).toBeVisible();
    await expect(startButton(page)).toHaveCount(1);
    expect(await api.session(session.id)).toMatchObject({ status: 'stopped' });
    expect((await viewer.fake.state()).closed).toBe(true);
    // The server told the page that the browser was gone.
    expect(viewer.watch.received()).toContainEqual({ t: 'closed' });
  });

  test('the exit IP chip of a stopped session opens the same details, without the actions that need a browser', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await viewer.stop.click();
    await expect(startButton(page)).toBeVisible();

    await viewer.exitChip(exitIpOf(session)).click();

    const details = page.getByRole('dialog', {
      name: t('viewer.details.title'),
    });
    await expect(details).toBeVisible();
    await expect(details).toContainText(session.fingerprint.timezone ?? '');
    await expect(details).toContainText(
      fill(t('viewer.details.source'), { ip: exitIpOf(session) }),
    );
    // Looking at the proxy again and restarting need a browser that runs: the one button left is the copy of the IP.
    await expect(details.getByRole('button')).toHaveCount(1);
    await expect(
      details.getByRole('button', { name: t('viewer.details.copyIp') }),
    ).toBeVisible();
    await expect(
      details.getByRole('button', { name: t('sessions.menu.checkIp') }),
    ).toHaveCount(0);
  });

  test('Start brings the live view back, from a new browser that reopens the tabs it had', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const first = 'https://example.com/where-i-was';
    const second = 'https://example.com/where-i-am';
    const viewer = await openViewer(page, control, session);
    await viewer.address.fill(first);
    await viewer.address.press('Enter');
    await expect(viewer.tab(titleOf(first))).toBeVisible();
    await openTabAt(viewer, second);
    await viewer.stop.click();
    await expect(startButton(page)).toBeVisible();
    // A slow start shows that the old picture is gone while the new browser comes up.
    await control.faults({ launchDelayMs: SLOW_START_MS });
    const pictures = viewer.watch.pictures();

    await startButton(page).click();

    await expect(
      page
        .getByRole('status')
        .filter({ hasText: t('sessions.status.starting') }),
    ).toBeVisible();
    await expect(viewer.picture).toHaveCount(0);
    await expect(page.locator('canvas')).toHaveCount(0);
    await viewer.waitUntilLive();
    await waitForPictures(viewer.watch, pictures + 1);
    // The tabs it had, the one that was looked at active.
    await expect(viewer.tabs).toHaveCount(2);
    await expect(viewer.tab(titleOf(first))).toHaveAttribute(
      'aria-selected',
      'false',
    );
    await expect(viewer.tab(titleOf(second))).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(viewer.address).toHaveValue(second);
    const browser = await viewer.fake.state();
    expect(browser.closed).toBe(false);
    // A new browser: it has not been told anything yet.
    expect(browser.events).toEqual([]);
  });

  test('Stop while the session is still starting ends it, and the browser that comes up is let go', async ({
    page,
    api,
    control,
  }) => {
    await control.faults({ launchDelayMs: SLOW_START_MS });
    await api.addProxies(1);
    const created = await api.createSession('alpha');
    const viewer = await visitViewer(page, control, created);
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: t('sessions.status.starting') }),
    ).toBeVisible();

    await viewer.stop.click();

    await expect(startButton(page)).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await api.waitForStatus(created.id, 'stopped');
    // The browser that was on its way comes up all the same, and is closed at once.
    await expect
      .poll(
        async () => {
          try {
            return (await control.browser(created.name)).closed;
          } catch {
            // Until it is launched the control server knows no browser of that name.
            return false;
          }
        },
        { timeout: TIMEOUT.BACKGROUND, message: 'the late browser is closed' },
      )
      .toBe(true);
    await expect(viewer.picture).toHaveCount(0);
    expect(await api.session(created.id)).toMatchObject({ status: 'stopped' });
  });

  test('a stopped session has no live view: the page opens no connection for it', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    await api.stopSession(session.id);
    const sockets = await LiveSockets.route(page);

    const viewer = await visitViewer(page, control, session);

    await expect(startButton(page)).toBeVisible();
    await expect(viewer.picture).toHaveCount(0);
    expect(sockets.attempts).toBe(0);
  });

  test('leaving the viewer closes its connection', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const sockets = await LiveSockets.route(page);
    await openViewer(page, control, session);

    await page
      .getByRole('link', { name: t('navigation.sections.proxies') })
      .click();

    await expect(page).toHaveURL(/\/proxies$/);
    await expect
      .poll(() => sockets.closed, { timeout: TIMEOUT.VISIBLE })
      .toBe(1);
    expect(sockets.attempts).toBe(1);
  });

  test('a session that fails to start says why, and starts once what failed is fixed', async ({
    page,
    api,
    control,
  }) => {
    const reason = 'The browser could not start: out of memory';
    await control.faults({ launchError: reason });
    await api.addProxies(1);
    const created = await api.createSession('alpha');
    await api.waitForStatus(created.id, 'error');

    const viewer = await visitViewer(page, control, created);

    // The header says where the session stands; the reason is in the card (it is also in the row of the list).
    await expect(
      viewer.header.getByText(t('sessions.status.error')),
    ).toBeVisible();
    const why = page
      .getByRole('status')
      .getByRole('paragraph')
      .filter({ hasText: reason });
    await expect(why).toBeVisible();
    await expect(viewer.picture).toHaveCount(0);

    await control.faults({ launchError: null });
    await startButton(page).click();
    await expect(viewer.picture).toBeVisible({ timeout: TIMEOUT.BACKGROUND });
    await expect(why).toHaveCount(0);
  });

  test('when the browser crashes the page says it has closed, and then offers to start the session again', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    // The page asks the server what became of the session; holding the answer shows what it says meanwhile.
    let open!: () => void;
    const answer = new Promise<void>((resolve) => {
      open = resolve;
    });
    let hold = false;
    await page.route(`**/api/sessions/${session.id}`, async (route) => {
      if (hold) await answer;
      await route.continue();
    });
    hold = true;

    await control.crash(session.name);

    await expect(page.getByText(t('viewer.card.closed'))).toBeVisible();
    await expect(page.getByText(t('viewer.card.closedHint'))).toBeVisible();
    await expect(viewer.picture).toHaveCount(0);
    // Nothing to press yet: the session is still finding out.
    await expect(startButton(page)).toHaveCount(0);

    open();
    await expect(startButton(page)).toBeVisible();
    await expect(page.getByText(t('viewer.card.closed'))).toHaveCount(0);
    expect(await api.session(session.id)).toMatchObject({
      status: 'stopped',
      error: null,
    });

    await startButton(page).click();
    await viewer.waitUntilLive();
    expect((await viewer.fake.state()).closed).toBe(false);
  });

  for (const [what, end] of [
    [
      'the browser crashes',
      (api: AppApi, control: Control, session: Session) =>
        control.crash(session.name),
    ],
    [
      'the session is stopped',
      async (api: AppApi, _control: Control, session: Session) => {
        await api.stopSession(session.id);
      },
    ],
  ] as const) {
    test(`when ${what} while the page has the keyboard, the keyboard goes to the title of the page, not to the top of the document`, async ({
      page,
      api,
      control,
    }) => {
      const session = await api.startSession('alpha');
      const viewer = await openViewer(page, control, session);
      await viewer.picture.focus();
      await expect(viewer.keyboard).toBeFocused();

      await end(api, control, session);

      await expect(startButton(page)).toBeVisible({
        timeout: TIMEOUT.BACKGROUND,
      });
      await expect(
        page.getByRole('heading', { level: 1, name: session.name }),
      ).toBeFocused();
    });
  }

  test('when the session is deleted by another client while the page has the keyboard, the keyboard goes to the main area, not to the top of the document', async ({
    page,
    api,
    control,
    allowConsoleError,
  }) => {
    allowConsoleError(/status of 404/);
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await viewer.picture.focus();
    await expect(viewer.keyboard).toBeFocused();

    await api.deleteSession(session.id);

    await expect(
      page.getByRole('heading', { level: 2, name: t('viewer.gone.title') }),
    ).toBeVisible({ timeout: TIMEOUT.BACKGROUND });
    await expect(page.getByRole('main')).toBeFocused();
  });

  test('a session deleted while its page is open says that it no longer exists', async ({
    page,
    api,
    control,
    allowConsoleError,
  }) => {
    allowConsoleError(/status of 404/);
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const address = page.url();

    await api.deleteSession(session.id);

    const gone = page.getByRole('heading', {
      level: 2,
      name: t('viewer.gone.title'),
    });
    await expect(gone).toBeVisible({ timeout: TIMEOUT.BACKGROUND });
    await expect(page.getByText(t('viewer.gone.description'))).toBeVisible();
    // The page's one heading names the page, not a session that is not there; the tab says what happened.
    await expect(
      page.getByRole('heading', { level: 1, name: t('viewer.title') }),
    ).toBeVisible();
    await expect(page).toHaveTitle(tabTitle(t('viewer.gone.title')));
    await expect(viewer.picture).toHaveCount(0);
    // It stays where it is, and the way out is a link.
    expect(page.url()).toBe(address);
    await page.getByRole('link', { name: t('viewer.gone.back') }).click();
    await expect(page).toHaveURL(/\/sessions$/);
    await expect(page.getByText(t('sessions.empty.title'))).toBeVisible();
  });

  test('while the session is read the page shows a placeholder, then the live view', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    let release!: () => void;
    const answer = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/api/sessions/${session.id}`, async (route) => {
      await answer;
      await route.continue();
    });

    const viewer = await visitViewer(page, control, session);

    // The header and the card stand masked, each as a status of its own: both are read out.
    const placeholder = page.getByRole('status', { name: t('viewer.loading') });
    await expect(placeholder).toHaveCount(2);
    await expect(placeholder.first()).toBeVisible();
    await expect(viewer.picture).toHaveCount(0);
    await expect(startButton(page)).toHaveCount(0);

    release();
    await viewer.waitUntilLive();
    await expect(placeholder).toHaveCount(0);
  });

  test('a session that cannot be read says so, and is shown when the person tries again', async ({
    page,
    api,
    control,
    allowConsoleError,
  }) => {
    allowConsoleError(/ERR_FAILED/);
    const session = await api.startSession('alpha');
    const address = `**/api/sessions/${session.id}`;
    await page.route(address, (route) => route.abort('failed'));

    const viewer = await visitViewer(page, control, session);

    await expect(
      page.getByRole('heading', {
        level: 2,
        name: t('viewer.loadFailed.title'),
      }),
    ).toBeVisible();
    // The page is named by its own title: there is no session to name.
    await expect(
      page.getByRole('heading', { level: 1, name: t('viewer.title') }),
    ).toBeVisible();
    // Beside a Try again the words do not say it twice: a network failure has no sentence of its own.
    await expect(page.getByText(t('errors.network'))).toHaveCount(0);
    await expect(viewer.picture).toHaveCount(0);

    await page.unroute(address);
    await page
      .getByRole('button', { name: t('common.actions.tryAgain') })
      .click();

    await viewer.waitUntilLive();
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: t('viewer.loadFailed.title'),
      }),
    ).toHaveCount(0);
    // The button that had the keyboard is gone: it goes to the title of the page.
    await expect(
      page.getByRole('heading', { level: 1, name: session.name }),
    ).toBeFocused();
  });

  test('after a failed read the header no longer says that the session is loading', async ({
    page,
    api,
    control,
    allowConsoleError,
  }) => {
    allowConsoleError(/ERR_FAILED/);
    const session = await api.startSession('alpha');
    await page.route(`**/api/sessions/${session.id}`, (route) =>
      route.abort('failed'),
    );

    await visitViewer(page, control, session);

    await expect(
      page.getByRole('heading', {
        level: 2,
        name: t('viewer.loadFailed.title'),
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('status', { name: t('viewer.loading') }),
    ).toHaveCount(0);
  });

  test('another session of the list has a live view of its own, and the one before it is let go', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await api.startSession('alpha');
    const beta = await api.startSession('beta');
    const viewer = await openViewer(page, control, alpha);
    const pictures = viewer.watch.pictures();

    await page.getByRole('link', { name: literally(beta.name) }).click();

    await expect(page).toHaveURL(new RegExp(`/sessions/${beta.id}$`));
    await expect(
      page.getByRole('heading', { level: 1, name: beta.name }),
    ).toBeVisible();
    await expect
      .poll(() => viewer.watch.pictures(), { timeout: TIMEOUT.PICTURE })
      .toBeGreaterThan(pictures);
    await expect(viewer.picture).toBeVisible();
    const aim = await viewer.at(0.5, 0.5);
    await page.mouse.click(aim.screen.x, aim.screen.y);

    // The click went to the browser of the session on the screen, and to that one only.
    const second = new Fake(control, beta.name);
    const events = await second.when(
      (all) => mouseOf(all).some(({ action }) => action === 'up'),
      'the click reached the second browser',
    );
    expectPoint(
      mouseOf(events).find(({ action }) => action === 'down') ?? NOWHERE,
      aim.page,
      'the press',
    );
    expect(mouseOf(await viewer.fake.events())).toEqual([]);
  });

  test('the address bar stays where it is while another session of the list connects, and when its tabs come', async ({
    page,
    api,
    control,
  }) => {
    const alpha = await api.startSession('alpha');
    const beta = await api.startSession('beta');
    // Every connection waits until it is released (the route must be there
    // before the page loads: the next session's comes without a load).
    const held = await holdLiveView(page);
    const connecting = page
      .getByRole('status')
      .filter({ hasText: t('viewer.stage.connecting') })
      .first();
    const socketOf = (session: Session) =>
      new RegExp(`/api/sessions/${session.id}/stream$`);
    const viewer = await visitViewer(page, control, alpha);
    await expect.poll(() => held.url()).toMatch(socketOf(alpha));
    held.release();
    await expect(viewer.picture).toBeVisible({ timeout: TIMEOUT.PICTURE });
    const address = await boxOf(viewer.address);

    // The connection of the next session answers nothing yet: what stands in
    // for its tabs keeps their place.
    await page.getByRole('link', { name: literally(beta.name) }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: beta.name }),
    ).toBeVisible();
    await expect(connecting).toBeVisible();
    await expect.poll(() => held.url()).toMatch(socketOf(beta));
    expect(await boxOf(viewer.address)).toEqual(address);

    held.release();
    await expect(viewer.picture).toBeVisible({ timeout: TIMEOUT.PICTURE });
    expect(await boxOf(viewer.address)).toEqual(address);
  });

  for (const address of ['abc', '99999', '0', '-1', '1.5', '007']) {
    test(`/sessions/${address} says that there is no such session`, async ({
      page,
      allowConsoleError,
    }) => {
      // The unknown id is asked of the server, which answers 404.
      allowConsoleError(/status of 404/);

      await page.goto(`/sessions/${address}`);

      await expect(
        page.getByRole('heading', { level: 2, name: t('viewer.gone.title') }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { level: 1, name: t('viewer.title') }),
      ).toBeVisible();
      await expect(page.getByText(t('viewer.gone.description'))).toBeVisible();
      await expect(
        page.getByRole('link', { name: t('viewer.gone.back') }),
      ).toHaveAttribute('href', '/sessions');
      await expect(page.getByRole('application')).toHaveCount(0);
    });
  }
});

test.describe('the connection', () => {
  // The overlay and the spinner inside it are both statuses that say it: the overlay comes first.
  const lostNotice = (page: Page) =>
    page
      .getByRole('status')
      .filter({ hasText: t('viewer.stage.lost') })
      .first();

  test('reconnects by itself when the session is stopped and started again through the API', async ({
    page,
    api,
    control,
    request,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const pictures = viewer.watch.pictures();

    await api.stopSession(session.id);
    await expect(startButton(page)).toBeVisible({
      timeout: TIMEOUT.BACKGROUND,
    });
    await expect(viewer.picture).toHaveCount(0);

    const started = await request.post(`/api/sessions/${session.id}/start`, {
      data: {},
    });
    expect(started.ok()).toBe(true);
    await api.waitForStatus(session.id, 'running');

    // Nobody pressed anything: the page saw the session run and connected to its new browser.
    await expect(viewer.picture).toBeVisible({ timeout: TIMEOUT.BACKGROUND });
    await waitForPictures(viewer.watch, pictures + 1);
    await expect(viewer.address).toBeEnabled();
    const aim = await viewer.at(0.5, 0.5);
    await page.mouse.click(aim.screen.x, aim.screen.y);
    const events = await viewer.fake.when(
      (all) => mouseOf(all).some(({ action }) => action === 'up'),
      'a click reached the new browser',
    );
    expectPoint(
      mouseOf(events).find(({ action }) => action === 'down') ?? NOWHERE,
      aim.page,
      'the press',
    );
  });

  test('says that the connection is lost while it is, keeps the tabs, takes no input, and takes the connection up again by itself', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const { defaultStartPage } = await api.settings();
    const sockets = await LiveSockets.route(page);
    const viewer = await openViewer(page, control, session);
    const pictures = viewer.watch.pictures();

    // The network drops: every try to connect is cut short until it is back.
    await sockets.cut();

    await expect(lostNotice(page)).toBeVisible();
    // What was there stays, dimmed: the last picture and the tabs, and nothing can be used.
    await expect(viewer.picture).toHaveAttribute('aria-disabled', 'true');
    await expect(viewer.tabs).toHaveCount(1);
    await expect(viewer.tabs.first()).toHaveAttribute('aria-disabled', 'true');
    for (const part of [
      viewer.address,
      viewer.back,
      viewer.forward,
      viewer.reload,
      viewer.newTab,
      viewer.secrets,
    ]) {
      await expect(part).toBeDisabled();
    }
    // A tab cannot be closed: its button is not even shown.
    await expect(viewer.closeButton(titleOf(defaultStartPage))).toBeHidden();
    const aim = await viewer.at(0.5, 0.9);
    await page.mouse.click(aim.screen.x, aim.screen.y);
    await page.mouse.wheel(0, 100);
    await viewer.tabs.first().focus();
    await page.keyboard.press('ArrowRight');

    // It comes back by itself, and the input made meanwhile was not kept to be sent later.
    sockets.up = true;
    await expect(lostNotice(page)).toBeHidden({ timeout: TIMEOUT.BACKGROUND });
    await expect(viewer.picture).not.toHaveAttribute('aria-disabled', 'true');
    await expect(viewer.address).toBeEnabled();
    await expect(viewer.back).toBeEnabled();
    await expect(viewer.secrets).toBeEnabled();
    await expect(viewer.tabs.first()).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await waitForPictures(viewer.watch, pictures + 1);
    expect(await viewer.fake.events()).toEqual([]);
    await viewer.picture.focus();
    await page.keyboard.press('x');
    const events = await viewer.fake.when(
      (all) => keyTrace(all).includes('up x'),
      'the first input after the recovery reached the browser',
    );
    expect(keyTrace(events)).toEqual(['down x', 'up x']);
    expect(mouseOf(events)).toEqual([]);
  });

  test('a key that is held when the connection drops is let go in the page', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const sockets = await LiveSockets.route(page);
    const viewer = await openViewer(page, control, session);
    await viewer.picture.focus();
    await page.keyboard.down('Shift');
    await viewer.fake.when(
      (all) => heldKeys(all).includes('Shift'),
      'Shift went down in the page',
    );

    await sockets.drop();
    await expect(lostNotice(page)).toBeVisible();
    // The person lets go of it while the connection is down: nobody hears it.
    await page.keyboard.up('Shift');
    await expect(lostNotice(page)).toBeHidden({ timeout: TIMEOUT.BACKGROUND });

    // The server let go of what the connection held when it ended.
    await expect
      .poll(async () => heldKeys(await viewer.fake.events()), {
        timeout: TIMEOUT.VISIBLE,
        message: 'Shift is not left down in the page',
      })
      .toEqual([]);
    expect(keyTrace(await viewer.fake.events())).toEqual([
      'down Shift',
      'up Shift',
    ]);
  });

  test('leaving the viewer while a key is held lets it go in the page before the connection is closed', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const sockets = await LiveSockets.route(page);
    const watch = watchLiveView(page);
    // From the list to the session, so that going back leaves the page without unloading it.
    await page.goto('/sessions');
    await page.getByRole('link', { name: literally(session.name) }).click();
    const viewer = new Viewer(page, watch, session, control);
    await viewer.waitUntilLive();
    await viewer.picture.focus();
    await page.keyboard.down('Shift');
    await viewer.fake.when(
      (all) => heldKeys(all).includes('Shift'),
      'Shift went down in the page',
    );

    // The page goes away with the key down: the viewer closes its connection.
    await page.goBack();

    await expect(page).toHaveURL(/\/sessions$/);
    await expect
      .poll(() => sockets.closed, { timeout: TIMEOUT.VISIBLE })
      .toBe(1);
    const events = await viewer.fake.when(
      (all) => heldKeys(all).length === 0,
      'Shift was let go in the page',
    );
    expect(keyTrace(events)).toEqual(['down Shift', 'up Shift']);
    // The page said so itself, while the server could still hear it.
    expect(
      viewer.watch.sent().filter((message) => message.t === 'key'),
    ).toEqual([
      { t: 'key', a: 'down', k: 'Shift' },
      { t: 'key', a: 'up', k: 'Shift' },
    ]);
  });

  test('keeps saying that the connection is lost for as long as the page tries again: the outage is announced once, not once per attempt', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const sockets = await LiveSockets.route(page);
    const viewer = await openViewer(page, control, session);
    const regions = await recordLiveRegions(page);

    await sockets.cut();
    // The page looks again after a second, and again two seconds later: every try fails.
    await expect
      .poll(() => sockets.attempts, {
        timeout: TIMEOUT.BACKGROUND,
        message: 'the page tried again twice',
      })
      .toBeGreaterThanOrEqual(3);

    const during = await regions.said();
    expect(during).toHaveLength(1);
    expect(during[0]).toContain(t('viewer.stage.lost'));
    // "Connecting" is for a connection that has not failed yet: it is not said between the tries.
    expect(during.join('\n')).not.toContain(t('viewer.stage.connecting'));

    // It is back: nothing more is said, the overlay just goes.
    sockets.up = true;
    await expect(lostNotice(page)).toBeHidden({ timeout: TIMEOUT.BACKGROUND });
    await expect(viewer.picture).not.toHaveAttribute('aria-disabled', 'true');
    expect(await regions.said()).toEqual(during);
  });

  test('after two connections in a row have failed the overlay offers to connect at once, and that connects without waiting', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const sockets = await LiveSockets.route(page);
    const viewer = await openViewer(page, control, session);
    const regions = await recordLiveRegions(page);
    const tryAgain = page.getByRole('button', {
      name: t('common.actions.tryAgain'),
    });
    await expect(tryAgain).toHaveCount(0);

    // The network is down: the connection that was lost and the one that is tried again both fail.
    await sockets.cut();

    await expect(lostNotice(page)).toBeVisible();
    await expect(tryAgain).toBeVisible({ timeout: TIMEOUT.BACKGROUND });
    expect(sockets.attempts).toBeGreaterThanOrEqual(2);
    // The network is back, and the person does not wait for the page to look again by itself.
    sockets.up = true;
    const attempts = sockets.attempts;
    await tryAgain.click();

    await expect(lostNotice(page)).toBeHidden({ timeout: TIMEOUT.PICTURE });
    await expect(viewer.picture).not.toHaveAttribute('aria-disabled', 'true');
    await expect(tryAgain).toHaveCount(0);
    expect(sockets.attempts).toBeGreaterThan(attempts);
    // Pressing it starts the count over: the connection it makes is a first one, and says so.
    const said = await regions.said();
    expect(said).toHaveLength(2);
    expect(said[0]).toContain(t('viewer.stage.lost'));
    expect(said[1]).toContain(t('viewer.stage.connecting'));
  });

  test('a viewer that stops reading is sent away with the code "try again later" instead of being kept in memory, and the viewer that reads is not touched', async ({
    page,
    api,
    control,
    server,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    await control.setSelection(session.name, 'x'.repeat(SELECTION_SIZE));
    // A viewer that is no browser: it asks for the selection of the page over and over and reads none of the answers.
    const stuck = await RawViewer.connect({
      port: server.port,
      sessionId: session.id,
    });
    stuck.send({ t: 'key', a: 'down', k: 'Shift' });
    await viewer.fake.when(
      (all) => heldKeys(all).includes('Shift'),
      'the viewer that does not read holds a key down in the page',
    );

    for (let asked = 0; asked < ANSWERS_UNREAD; asked += 1) {
      stuck.send({ t: 'copy', cut: false });
    }

    // The server gives up on it, which it does by ending the connection: what the viewer held down is let go of.
    await viewer.fake.when(
      (all) => heldKeys(all).length === 0,
      'the server ended the connection of the viewer that does not read',
    );
    // It learns why only when it reads again: everything sent before is there first.
    const goodbye = await stuck.untilGoodbye(TIMEOUT.BACKGROUND);
    stuck.destroy();
    expect(goodbye.code).toBe(TRY_AGAIN_LATER);
    expect(goodbye.reason).not.toBe('');

    // The viewer that reads went on all the while: the picture is live and a click reaches the browser.
    await expect(viewer.picture).not.toHaveAttribute('aria-disabled', 'true');
    const aim = await viewer.at(0.5, 0.5);
    await page.mouse.click(aim.screen.x, aim.screen.y);
    const events = await viewer.fake.when(
      (all) => mouseOf(all).some(({ action }) => action === 'up'),
      'a click reached the browser',
    );
    expectPoint(
      mouseOf(events).find(({ action }) => action === 'down') ?? NOWHERE,
      aim.page,
      'the press',
    );
  });

  test('sends no input before the first picture has come, and all of it after', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    // The socket is open, but nothing comes of it: the view is not ready.
    const held = await holdLiveView(page);

    const viewer = await visitViewer(page, control, session);

    // The overlay and the spinner inside it are both statuses that say it: the overlay comes first.
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: t('viewer.stage.connecting') })
        .first(),
    ).toBeVisible();
    await expect(viewer.picture).toHaveCount(0);
    for (const part of [
      viewer.address,
      viewer.back,
      viewer.forward,
      viewer.reload,
      viewer.newTab,
      viewer.secrets,
    ]) {
      await expect(part).toBeDisabled();
    }
    // Whatever a person does to the empty stage and the page is not sent.
    const room = await boxOf(viewer.room);
    await page.mouse.click(room.x + room.width / 2, room.y + room.height / 2);
    await page.mouse.wheel(0, 100);
    await page.keyboard.type('hello');
    await page.keyboard.press(`${COMMAND}+L`);
    expect(held.sent).toEqual([]);

    // The server answers: the first picture makes the view live.
    held.release();
    await expect(viewer.picture).toBeVisible({ timeout: TIMEOUT.PICTURE });
    expect(held.sent).toEqual([]);
    const aim = await viewer.at(0.5, 0.5);
    await page.mouse.click(aim.screen.x, aim.screen.y);

    const events = await viewer.fake.when(
      (all) => mouseOf(all).some(({ action }) => action === 'up'),
      'the click reached the browser',
    );
    expect(mouseOf(events).some(({ action }) => action === 'down')).toBe(true);
    expect(held.sent.length).toBeGreaterThan(0);
    expect(
      held.sent.every((message) => message.startsWith('{"t":"mouse"')),
    ).toBe(true);
  });

  test('a list of secrets that is open when the connection drops closes, and stays closed when it is back', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    await api.createSecret({
      kind: 'note',
      title: 'A note',
      fields: [{ label: 'Note', value: 'some text' }],
    });
    const sockets = await LiveSockets.route(page);
    const viewer = await openViewer(page, control, session);
    await viewer.secrets.click();
    const popover = page.getByRole('dialog', {
      name: t('viewer.secrets.title'),
    });
    await expect(popover).toBeVisible();

    await sockets.drop();

    await expect(popover).toBeHidden();
    await expect(viewer.secrets).toBeDisabled();
    // The page connects again by itself, and the list does not come back with it.
    await expect(viewer.secrets).toBeEnabled({ timeout: TIMEOUT.BACKGROUND });
    expect(sockets.attempts).toBe(2);
    await expect(popover).toBeHidden();
  });

  test('a dialog that is waiting when the connection drops is asked again when it is back', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const sockets = await LiveSockets.route(page);
    const viewer = await openViewer(page, control, session);
    await control.openDialog(session.name, {
      kind: 'confirm',
      message: 'Still there?',
    });
    const dialog = page.getByRole('dialog', { name: t('viewer.dialog.title') });
    await expect(dialog).toContainText('Still there?');

    await sockets.drop();

    // It cannot be answered while there is nobody to answer to: the server asks again.
    await expect(dialog).toBeHidden();
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.BACKGROUND });
    await expect(dialog).toContainText('Still there?');
    await dialog.getByRole('button', { name: t('viewer.dialog.ok') }).click();
    const events = await viewer.fake.when(
      (all) => answersOf(all).length === 1,
      'the answer reached the browser',
    );
    expect(answersOf(events)).toMatchObject([{ accept: true }]);
    expect((await viewer.fake.state()).dialogs).toEqual([]);
  });

  test('says why the connection was refused, and connects when asked to try again once the session runs', async ({
    page,
    api,
    control,
    request,
  }) => {
    const session = await api.startSession('alpha');
    await api.stopSession(session.id);
    // The page believes what it read a moment ago: that the session runs.
    await page.route(`**/api/sessions/${session.id}`, async (route) => {
      const response = await route.fetch();
      const stale = {
        ...(await response.json()),
        status: 'running',
        activity: null,
      };
      await route.fulfill({ response, json: stale });
    });

    const viewer = await visitViewer(page, control, session);

    // What is said is a heading and the reason, with the way to try again: it is no status.
    const refusal = page
      .getByRole('heading', { level: 2, name: t('viewer.stage.refusedTitle') })
      .locator('xpath=..');
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText(t('errors.session_not_running'));
    await expect(viewer.picture).toHaveCount(0);
    await expect(viewer.address).toBeDisabled();
    // The server said it with a code: the page does not keep trying by itself.
    expect(
      viewer.watch.received().filter((message) => message.t === 'error'),
    ).toMatchObject([{ code: 'session_not_running' }]);

    const started = await request.post(`/api/sessions/${session.id}/start`, {
      data: {},
    });
    expect(started.ok()).toBe(true);
    await api.waitForStatus(session.id, 'running');
    await refusal
      .getByRole('button', { name: t('common.actions.tryAgain') })
      .click();

    await expect(viewer.picture).toBeVisible({ timeout: TIMEOUT.PICTURE });
    await expect(refusal).toBeHidden();
    await expect(viewer.address).toBeEnabled();
  });
});

test.describe('two viewers of one session', () => {
  test('both show the tabs, and a tab that is opened in one is there in the other', async ({
    page,
    context,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const first = await openViewer(page, control, session);
    const second = await openViewer(await context.newPage(), control, session);
    await expect(first.tabs).toHaveCount(1);
    await expect(second.tabs).toHaveCount(1);

    await openTabAt(first, 'https://example.com/shared');

    await expect(second.tabs).toHaveCount(2);
    await expect(
      second.tab(titleOf('https://example.com/shared')),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(second.address).toHaveValue('https://example.com/shared');
  });

  test('a dialog of the page is asked in both, and the answer of one closes it in the other', async ({
    page,
    context,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const first = await openViewer(page, control, session);
    const otherPage = await context.newPage();
    const second = await openViewer(otherPage, control, session);
    const dialogs = [page, otherPage].map((one) =>
      one.getByRole('dialog', { name: t('viewer.dialog.title') }),
    );

    await control.openDialog(session.name, {
      kind: 'confirm',
      message: 'Both of you?',
    });
    for (const dialog of dialogs) {
      await expect(dialog).toContainText('Both of you?');
    }
    await dialogs[0]
      ?.getByRole('button', { name: t('viewer.dialog.ok') })
      .click();

    await expect(dialogs[0] ?? page.locator('html')).toBeHidden();
    await expect(dialogs[1] ?? page.locator('html')).toBeHidden();
    // One answer reached the browser: the other viewer did not have to give one.
    const events = await first.fake.when(
      (all) => answersOf(all).length === 1,
      'the answer reached the browser',
    );
    expect(answersOf(events)).toMatchObject([{ accept: true }]);
    expect(second.fake.name).toBe(first.fake.name);
  });

  test('the viewer that stays open keeps working when the other one is closed', async ({
    page,
    context,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const first = await openViewer(page, control, session);
    const otherPage = await context.newPage();
    await openViewer(otherPage, control, session);

    await otherPage.close();

    const aim = await first.at(0.5, 0.5);
    await page.mouse.click(aim.screen.x, aim.screen.y);
    const events = await first.fake.when(
      (all) => mouseOf(all).some(({ action }) => action === 'up'),
      'the click reached the browser',
    );
    expectPoint(
      mouseOf(events).find(({ action }) => action === 'down') ?? NOWHERE,
      aim.page,
      'the press',
    );
    await expect(first.picture).toBeVisible();
    await expect(page.getByText(t('viewer.stage.lost'))).toHaveCount(0);
  });
});

test.describe('on a phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  });

  /** The width of the phone (CSS pixels): nothing of the page may lie beyond it. */
  const PHONE_WIDTH = 390;
  /** Tabs enough that the strip of a phone cannot hold them and has a menu. */
  const PHONE_TABS = 5;
  /** The least a control is to reach under a finger, whatever its own size (CSS pixels). */
  const FINGER_REACH = 44;
  /** How far above a control's box a finger lands for the test: inside the reach of the smallest control (4 pixels). */
  const REACH_PROBE = 3;

  test('the header, the tabs, the address bar and the Secrets button are all on the screen', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const { defaultStartPage } = await api.settings();
    const viewer = await openViewer(page, control, session);
    const controls = {
      back: page.getByRole('link', { name: t('common.aria.back') }),
      stop: viewer.stop,
      menu: page.getByRole('button', {
        name: fill(t('sessions.row.menu'), { name: session.name }),
      }),
      exitIp: viewer.exitChip(exitIpOf(session)),
      tab: viewer.tab(titleOf(defaultStartPage)),
      closeTab: viewer.closeLastButton(titleOf(defaultStartPage)),
      newTab: viewer.newTab,
      previous: viewer.back,
      forward: viewer.forward,
      reload: viewer.reload,
      address: viewer.address,
      secrets: viewer.secrets,
    };

    await expect(
      page.getByRole('heading', { level: 1, name: session.name }),
    ).toBeVisible();
    // The state is the line under the name, and the exit IP is a glyph beside it.
    await expect(
      page.getByText(t('sessions.status.running'), { exact: true }),
    ).toBeVisible();
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
    // The picture stops above the bar of the app that floats over the page.
    const bar = await boxOf(
      page.getByRole('navigation', { name: t('navigation.aria.primary') }),
    );
    const picture = await boxOf(viewer.picture);
    expect(picture.y + picture.height).toBeLessThanOrEqual(bar.y);
    expect(picture.width).toBeLessThanOrEqual(PHONE_WIDTH);
  });

  test('the arrow of the header is the way back to the list of sessions', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    await openViewer(page, control, session);
    const back = page.getByRole('link', { name: t('common.aria.back') });
    // The list is the section the page is in, not the page that is open: the arrow does not claim to be the current page.
    await expect(back).toHaveAttribute('href', '/sessions');
    await expect(back).not.toHaveAttribute('aria-current');

    await back.tap();

    await expect(page).toHaveURL(/\/sessions$/);
    await expect(
      page.getByRole('link', { name: literally(session.name) }),
    ).toBeVisible();
  });

  test('after the arrow of the header the keyboard is on the main area, not at the top of the document', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    await openViewer(page, control, session);

    await page.getByRole('link', { name: t('common.aria.back') }).tap();

    await expect(page).toHaveURL(/\/sessions$/);
    await expect(page.getByRole('main')).toBeFocused();
  });

  test('every small control of the toolbar reaches 44 pixels under a finger, without taking room from the layout', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    // Tabs enough that the strip has a menu of them.
    const urls = Array.from(
      { length: PHONE_TABS - 1 },
      (_unused, index) => `https://example.com/tab-${index + 2}`,
    );
    for (const url of urls) await openTabAt(viewer, url);
    const active = titleOf(urls.at(-1) ?? '');
    const controls = {
      'the active tab': viewer.tab(active),
      'its close button': viewer.closeButton(active),
      'New tab': viewer.newTab,
      'More tabs': page.getByRole('button', { name: t('viewer.tabs.more') }),
      'the previous page': viewer.back,
      'the next page': viewer.forward,
      reload: viewer.reload,
      Secrets: viewer.secrets,
    };

    for (const [name, one] of Object.entries(controls)) {
      await expect(one, name).toBeVisible();
      const visible = await boxOf(one);
      // The reach is an element of the control's own that is out of the flow: it makes the control
      // 44 pixels in each direction it falls short of, and leaves the ones that are 44 or more alone.
      const reach = await one.evaluate((element) => {
        const after = getComputedStyle(element, '::after');
        return {
          position: after.position,
          width: Number.parseFloat(after.width),
          height: Number.parseFloat(after.height),
        };
      });
      expect(reach.position, `${name} reaches out of the flow`).toBe(
        'absolute',
      );
      expect(
        Math.abs(reach.width - Math.max(visible.width, FINGER_REACH)),
        `${name} is ${reach.width} wide under a finger`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(reach.height - Math.max(visible.height, FINGER_REACH)),
        `${name} is ${reach.height} tall under a finger`,
      ).toBeLessThanOrEqual(1);
      // A finger that lands a little above it lands on it, and not on what lies behind.
      const hit = await one.evaluate(
        (element, [x, y]) => {
          const found = document.elementFromPoint(x, y);
          return found !== null && element.contains(found);
        },
        [visible.x + visible.width / 2, visible.y - REACH_PROBE] as const,
      );
      expect(hit, `${name} is hit ${REACH_PROBE} pixels above its box`).toBe(
        true,
      );
    }
  });

  test('the exit IP is a glyph that says the whole line, and its details fit the screen', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const chip = viewer.exitChip(exitIpOf(session));
    // The words are the name of a glyph the header has no room to spell out.
    await expect(chip).toHaveAccessibleName(
      `${exitIpOf(session)} · ${session.proxy?.country}`,
    );

    await chip.tap();

    const details = page.getByRole('dialog', {
      name: t('viewer.details.title'),
    });
    await expect(details).toBeVisible();
    const box = await boxOf(details);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE_WIDTH);
    await details
      .getByRole('button', { name: t('sessions.menu.checkIp') })
      .tap();
    await expect(notice(page, t('sessions.notices.ipSameTitle'))).toBeVisible();
  });

  test('a tap lands on the pixel of the page under the finger', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const aims = [await viewer.at(0.25, 0.5), await viewer.at(0.8, 0.2)];

    for (const aim of aims) {
      await page.touchscreen.tap(aim.screen.x, aim.screen.y);
    }

    const events = await viewer.fake.when(
      (all) =>
        mouseOf(all).filter(({ action }) => action === 'up').length ===
        aims.length,
      'both taps reached the browser',
    );
    const presses = mouseOf(events).filter(({ action }) => action === 'down');
    expect(presses.map(({ button, clicks }) => [button, clicks])).toEqual([
      ['left', 1],
      ['left', 1],
    ]);
    for (const [index, aim] of aims.entries()) {
      expectPoint(presses[index] ?? NOWHERE, aim.page, `tap ${index + 1}`);
    }
    await expect(viewer.keyboard).toBeFocused();
  });

  test('two taps in a row are a double click in the page', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const aim = await viewer.at(0.5, 0.5);

    await page.touchscreen.tap(aim.screen.x, aim.screen.y);
    await page.touchscreen.tap(aim.screen.x, aim.screen.y);

    const events = await viewer.fake.when(
      (all) =>
        mouseOf(all).filter(({ action }) => action === 'up').length === 2,
      'both taps reached the browser',
    );
    expect(
      mouseOf(events)
        .filter(({ action }) => action !== 'move')
        .map(({ action, clicks }) => [action, clicks]),
    ).toEqual([
      ['down', 1],
      ['up', 1],
      ['down', 2],
      ['up', 2],
    ]);
  });

  /** Every wheel message added up: how far the page was told to scroll. */
  const scrolled = (events: BrowserState['events']) =>
    wheelsOf(events).reduce(
      (sum, wheel) => ({ dx: sum.dx + wheel.dx, dy: sum.dy + wheel.dy }),
      { dx: 0, dy: 0 },
    );

  test('a finger that drags over the picture scrolls the page by the distance it moved, in the pixels of the page, and clicks nothing', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const finger = await Finger.of(page);
    const picture = await boxOf(viewer.picture);
    // The picture is smaller than the page: the page moves further than the finger does.
    const scale = picture.width / PAGE.width;
    expect(scale).toBeLessThan(1);
    const from = {
      x: picture.x + picture.width / 2,
      y: picture.y + picture.height * 0.8,
    };
    const to = { x: from.x - 60, y: from.y - 120 };

    await finger.press(from);
    await finger.dragTo(from, to, 8);
    await finger.lift();

    // The content follows the finger: up scrolls down and left scrolls right.
    const expected = { dx: 60 / scale, dy: 120 / scale };
    const events = await viewer.fake.when((all) => {
      const sum = scrolled(all);
      return (
        Math.abs(sum.dy - expected.dy) <= 1 &&
        Math.abs(sum.dx - expected.dx) <= 1
      );
    }, 'the page scrolled by what the finger moved');
    // Each message is at the place under the finger, which ends where it was lifted.
    const places = wheelsOf(events);
    for (const place of places) {
      expect(place.x).toBeGreaterThanOrEqual(0);
      expect(place.x).toBeLessThanOrEqual(PAGE.width);
      expect(place.y).toBeGreaterThanOrEqual(0);
      expect(place.y).toBeLessThanOrEqual(PAGE.height);
    }
    expectPoint(
      places.at(-1) ?? NOWHERE,
      {
        x: ((to.x - picture.x) / picture.width) * PAGE.width,
        y: ((to.y - picture.y) / picture.height) * PAGE.height,
      },
      'the last scroll',
    );

    // A drag is not a click, whatever mouse events the browser makes of a finger that lifts: a tap
    // after it proves that nothing else was sent before. The page lets go of a finger's mouse events
    // for a while after a drag (a tap sooner is one of them), so the tap comes when that is over, by
    // the page's own clock.
    await letTimePass(page, MOUSE_AFTER_DRAG_MS);
    const aim = await viewer.at(0.5, 0.2);
    await page.touchscreen.tap(aim.screen.x, aim.screen.y);
    const after = await viewer.fake.when(
      (all) => mouseOf(all).some(({ action }) => action === 'up'),
      'the tap reached the browser',
    );
    expect(
      mouseOf(after)
        .filter(({ action }) => action !== 'move')
        .map(({ action, button }) => [action, button]),
    ).toEqual([
      ['down', 'left'],
      ['up', 'left'],
    ]);
  });

  test('a finger that rests on the picture presses the right button where it came down, and its lifting is no click', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const finger = await Finger.of(page);
    const aim = await viewer.at(0.3, 0.6);

    await finger.press(aim.screen);
    // A wobble is no move: it rests as long as it stays within a tap's reach.
    await finger.moveTo({ x: aim.screen.x + TAP_SLOP / 2, y: aim.screen.y });
    // The page's own timer decides that it rests: the right button comes with no further input.
    const events = await viewer.fake.when(
      (all) =>
        mouseOf(all).some(
          ({ action, button }) => action === 'up' && button === 'right',
        ),
      'the long press reached the browser as a right click',
    );
    await finger.lift();

    const clicks = mouseOf(events).filter(({ action }) => action !== 'move');
    expect(
      clicks.map(({ action, button, clicks: count }) => [
        action,
        button,
        count,
      ]),
    ).toEqual([
      ['down', 'right', 1],
      ['up', 'right', 1],
    ]);
    for (const click of clicks) expectPoint(click, aim.page, click.action);
    // The page itself is not scrolled by a finger that rests.
    expect(wheelsOf(events)).toEqual([]);

    // Lifting it is no left click after the right one: a tap after it proves that nothing else came before.
    const other = await viewer.at(0.7, 0.3);
    await page.touchscreen.tap(other.screen.x, other.screen.y);
    const after = await viewer.fake.when(
      (all) =>
        mouseOf(all).filter(({ action }) => action === 'up').length === 2,
      'the tap reached the browser',
    );
    expect(
      mouseOf(after)
        .filter(({ action }) => action !== 'move')
        .map(({ action, button }) => [action, button]),
    ).toEqual([
      ['down', 'right'],
      ['up', 'right'],
      ['down', 'left'],
      ['up', 'left'],
    ]);
  });

  test('a finger that moves further than a tap does is dragging, not resting: it never presses the right button', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const finger = await Finger.of(page);
    const aim = await viewer.at(0.5, 0.7);
    const to = { x: aim.screen.x, y: aim.screen.y - 4 * TAP_SLOP };

    await finger.press(aim.screen);
    await finger.dragTo(aim.screen, to, 4);
    await viewer.fake.when(
      (all) => wheelsOf(all).length > 0,
      'the page was scrolled by the finger',
    );
    // It stays down longer than a finger takes to rest: the page has had its say.
    await letTimePass(page, LONG_PRESS_MS);
    await finger.lift();

    const other = await viewer.at(0.5, 0.2);
    await page.touchscreen.tap(other.screen.x, other.screen.y);
    const events = await viewer.fake.when(
      (all) => mouseOf(all).some(({ action }) => action === 'up'),
      'the tap reached the browser',
    );
    expect(
      mouseOf(events)
        .filter(({ action }) => action !== 'move')
        .map(({ action, button }) => [action, button]),
    ).toEqual([
      ['down', 'left'],
      ['up', 'left'],
    ]);
  });

  test('a tap opens the keyboard of the phone on a field made for the page: text arrives as text, Enter and Backspace as keys', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);

    await viewer.picture.tap();

    // The field that has the keyboard asks the phone for none of its helpers.
    await expect(viewer.keyboard).toBeFocused();
    await expect(viewer.keyboard).toHaveAttribute('autocapitalize', 'off');
    await expect(viewer.keyboard).toHaveAttribute('autocomplete', 'off');
    await expect(viewer.keyboard).toHaveAttribute('autocorrect', 'off');
    await expect(viewer.keyboard).toHaveAttribute('spellcheck', 'false');
    // At 16 pixels or more a phone does not zoom the page in when the field is focused.
    expect(
      await viewer.keyboard.evaluate((field) =>
        Number.parseFloat(getComputedStyle(field).fontSize),
      ),
    ).toBeGreaterThanOrEqual(16);

    await page.keyboard.insertText('Grüße 👋');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');

    const events = await viewer.fake.when(
      (all) => keyTrace(all).includes('up Enter'),
      'the keys reached the browser',
    );
    expect(textsOf(events)).toEqual(['Grüße 👋']);
    expect(keyTrace(events)).toEqual([
      'down Backspace',
      'up Backspace',
      'down Enter',
      'up Enter',
    ]);
  });

  test('the address bar takes an address with the go key of the phone', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);

    await viewer.address.tap();
    await expect(viewer.address).toBeFocused();
    await expect(viewer.address).toHaveAttribute('enterkeyhint', 'go');
    await page.keyboard.type('example.com/phone');
    await page.keyboard.press('Enter');

    const events = await viewer.fake.when(
      (all) => navigationsOf(all).length === 1,
      'the address reached the browser',
    );
    expect(navigationsOf(events)).toEqual(['https://example.com/phone']);
    await expect(
      viewer.tab(titleOf('https://example.com/phone')),
    ).toBeVisible();
  });

  test('tabs are opened, chosen and closed with a finger', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const { defaultStartPage } = await api.settings();
    const viewer = await openViewer(page, control, session);
    const second = 'https://example.com/second';

    await viewer.newTab.tap();
    await expect(viewer.tabs).toHaveCount(2);
    await viewer.address.fill(second);
    await viewer.address.press('Enter');
    await expect(viewer.tab(titleOf(second))).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await viewer.tab(titleOf(defaultStartPage)).tap();
    await expect(viewer.tab(titleOf(defaultStartPage))).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await viewer.closeButton(titleOf(second)).tap();

    await expect(viewer.tabs).toHaveCount(1);
    await expect
      .poll(() => viewer.serverTabs().map(({ id }) => id))
      .toEqual([1]);
  });

  test('the list of secrets fits the screen, and a tap on Type puts the value in the page', async ({
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
    const viewer = await openViewer(page, control, session);

    await viewer.secrets.tap();

    const popover = page.getByRole('dialog', {
      name: t('viewer.secrets.title'),
    });
    await expect(popover).toBeVisible();
    const box = await boxOf(popover);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE_WIDTH);
    await popover.getByRole('button', { name: /Shop login/ }).tap();
    await popover
      .getByRole('button', {
        name: fill(t('viewer.secrets.typeLabel'), { label: 'Username' }),
      })
      .tap();

    await expect(popover).toBeHidden();
    const events = await viewer.fake.when(
      (all) => textsOf(all).length === 1,
      'the value reached the browser',
    );
    expect(textsOf(events)).toEqual(['ada@example.com']);
  });

  test('a dialog and a list of the page fit the screen and are answered with a finger', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);
    const dialog = page.getByRole('dialog', { name: t('viewer.dialog.title') });
    const list = page.getByRole('listbox', { name: t('viewer.select.label') });

    await control.openDialog(session.name, {
      kind: 'confirm',
      message: 'Is this fine on a phone?',
    });
    await expect(dialog).toContainText('Is this fine on a phone?');
    const dialogBox = await boxOf(dialog);
    expect(dialogBox.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(PHONE_WIDTH);
    await dialog.getByRole('button', { name: t('viewer.dialog.ok') }).tap();
    await expect(dialog).toBeHidden();

    await control.openSelect(session.name, ['First', 'Second', 'Third']);
    await expect(list).toBeVisible();
    const listBox = await boxOf(list);
    expect(listBox.x).toBeGreaterThanOrEqual(0);
    expect(listBox.x + listBox.width).toBeLessThanOrEqual(PHONE_WIDTH);
    await list.getByRole('option', { name: 'Second' }).tap();
    await expect(list).toBeHidden();

    const events = await viewer.fake.when(
      (all) => answersOf(all).length === 1 && picksOf(all).length === 1,
      'both answers reached the browser',
    );
    expect(answersOf(events)).toMatchObject([{ accept: true }]);
    expect(picksOf(events)).toMatchObject([{ index: 1 }]);
  });

  test('the session is stopped and started again from the phone', async ({
    page,
    api,
    control,
  }) => {
    const session = await api.startSession('alpha');
    const viewer = await openViewer(page, control, session);

    await viewer.stop.tap();

    await expect(startButton(page)).toBeVisible();
    await expect(viewer.picture).toHaveCount(0);
    await startButton(page).tap();
    await viewer.waitUntilLive();
    await expect(viewer.stop).toBeVisible();
  });
});

test.describe('accessibility', () => {
  /** What the page shows now, once what is fading in or out has settled. */
  async function audit(page: Page) {
    await animationsDone(page);
    return violationsOf(page);
  }

  /** The viewer as it is, then with what opens over it: the details, the list of secrets, a list of the page, a dialog. */
  async function expectNoViolations(
    page: Page,
    viewer: Viewer,
    control: Control,
  ): Promise<void> {
    await test.step('the viewer', async () => {
      expect(await audit(page)).toEqual([]);
    });
    await test.step('with the details of the session open', async () => {
      await viewer.exitChip(exitIpOf(viewer.session)).click();
      await expect(
        page.getByRole('dialog', { name: t('viewer.details.title') }),
      ).toBeVisible();
      expect(await audit(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('dialog', { name: t('viewer.details.title') }),
      ).toBeHidden();
    });
    await test.step('with the list of secrets open', async () => {
      await viewer.secrets.click();
      await expect(
        page.getByRole('dialog', { name: t('viewer.secrets.title') }),
      ).toBeVisible();
      expect(await audit(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('dialog', { name: t('viewer.secrets.title') }),
      ).toBeHidden();
    });
    await test.step('with a list of the page open', async () => {
      await control.openSelect(viewer.session.name, ['First', 'Second']);
      await expect(
        page.getByRole('listbox', { name: t('viewer.select.label') }),
      ).toBeVisible();
      expect(await audit(page)).toEqual([]);
      await page.keyboard.press('Escape');
    });
    await test.step('with a dialog of the page open', async () => {
      await control.openDialog(viewer.session.name, {
        kind: 'prompt',
        message: 'Your name?',
        defaultValue: 'Ada',
      });
      await expect(
        page.getByRole('dialog', { name: t('viewer.dialog.title') }),
      ).toBeVisible();
      expect(await audit(page)).toEqual([]);
    });
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`the live viewer has no accessibility violation in ${scheme} colours`, async ({
      page,
      api,
      control,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const session = await api.startSession('alpha');
      await api.createSecret({
        kind: 'credentials',
        title: 'Shop login',
        sessionId: session.id,
        fields: [{ label: 'Website', value: 'https://shop.example.com' }],
      });
      const viewer = await openViewer(page, control, session);

      await expectNoViolations(page, viewer, control);
    });

    test(`the live viewer while the connection comes and goes has no accessibility violation in ${scheme} colours`, async ({
      page,
      api,
      control,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const session = await api.startSession('alpha');
      const sockets = await LiveSockets.route(page);
      const viewer = await openViewer(page, control, session);

      await test.step('while the connection is lost', async () => {
        await sockets.cut();
        await expect(
          page
            .getByRole('status')
            .filter({ hasText: t('viewer.stage.lost') })
            .first(),
        ).toBeVisible();
        expect(await audit(page)).toEqual([]);
      });
      await test.step('while it is made again', async () => {
        sockets.up = true;
        await expect(viewer.picture).not.toHaveAttribute(
          'aria-disabled',
          'true',
          { timeout: TIMEOUT.BACKGROUND },
        );
        expect(await audit(page)).toEqual([]);
      });
    });

    test(`the live viewer while it connects has no accessibility violation in ${scheme} colours`, async ({
      page,
      api,
      control,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const session = await api.startSession('alpha');
      const held = await holdLiveView(page);

      await visitViewer(page, control, session);

      await expect(
        page
          .getByRole('status')
          .filter({ hasText: t('viewer.stage.connecting') })
          .first(),
      ).toBeVisible();
      expect(await audit(page)).toEqual([]);
      held.release();
    });

    test(`the live viewer that the server refused has no accessibility violation in ${scheme} colours`, async ({
      page,
      api,
      control,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const session = await api.startSession('alpha');
      await api.stopSession(session.id);
      // The page believes what it read a moment ago: that the session runs.
      await page.route(`**/api/sessions/${session.id}`, async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          json: {
            ...(await response.json()),
            status: 'running',
            activity: null,
          },
        });
      });

      await visitViewer(page, control, session);

      await expect(
        page.getByRole('heading', {
          level: 2,
          name: t('viewer.stage.refusedTitle'),
        }),
      ).toBeVisible();
      expect(await audit(page)).toEqual([]);
    });

    test(`the stopped card has no accessibility violation in ${scheme} colours`, async ({
      page,
      api,
      control,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const session = await api.startSession('alpha');
      const viewer = await openViewer(page, control, session);

      await viewer.stop.click();

      await expect(startButton(page)).toBeVisible();
      expect(await audit(page)).toEqual([]);
    });
  }

  test.describe('on a phone', () => {
    test.use({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });

    test('the live viewer has no accessibility violation', async ({
      page,
      api,
      control,
    }) => {
      const session = await api.startSession('alpha');
      await api.createSecret({
        kind: 'credentials',
        title: 'Shop login',
        sessionId: session.id,
        fields: [{ label: 'Website', value: 'https://shop.example.com' }],
      });
      const viewer = await openViewer(page, control, session);

      await expectNoViolations(page, viewer, control);
    });
  });
});
