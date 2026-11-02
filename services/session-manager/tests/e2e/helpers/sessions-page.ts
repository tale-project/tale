import { expect, type Locator, type Page } from '@playwright/test';

import type { OsChoice } from '../../../lib/api/schemas';
import { TIMEOUT } from './env';
import { fill, literally, t } from './i18n';

/** What a row, a header and a details list call a session's state. */
export type Shown =
  | 'stopped'
  | 'assigning'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error';

/** The entries of a session's menu, by the words they carry. */
const MENU_ITEMS = {
  rename: () => t('sessions.menu.rename'),
  restart: () => t('sessions.menu.restart'),
  rotate: () => t('sessions.menu.rotate'),
  checkIp: () => t('sessions.menu.checkIp'),
  delete: () => t('common.actions.delete'),
} as const;
export type MenuItem = keyof typeof MENU_ITEMS;

/** A session's name inside a sentence, quoted the way the page quotes it. */
export function quoted(text: string): string {
  return fill(t('sessions.quoted'), { text });
}

/** The line a running session's row (and its exit-IP chip) shows: where it exits. */
export function exitLine(ip: string, country: string): string {
  return `${ip} · ${country}`;
}

/**
 * A message with one `{count, plural, one {…} other {…}}` block, as English
 * says it for `count` (`#` is the number). Its other `{name}` arguments stay
 * for `fill`.
 */
export function plural(message: string, count: number): string {
  const head = /\{\w+, plural, /.exec(message);
  if (head === null) throw new Error(`There is no plural in "${message}"`);
  const branches = new Map<string, string>();
  let at = head.index + head[0].length;
  while (message[at] !== '}') {
    const open = message.indexOf('{', at);
    if (open === -1) throw new Error(`Unfinished plural in "${message}"`);
    let depth = 0;
    let end = open;
    for (; end < message.length; end += 1) {
      if (message[end] === '{') depth += 1;
      if (message[end] === '}') depth -= 1;
      if (depth === 0) break;
    }
    branches.set(message.slice(at, open).trim(), message.slice(open + 1, end));
    at = end + 1;
    while (message[at] === ' ') at += 1;
  }
  const chosen = branches.get(new Intl.PluralRules('en').select(count));
  if (chosen === undefined) throw new Error(`No branch for ${count}`);
  return (
    message.slice(0, head.index) +
    chosen.replaceAll('#', String(count)) +
    message.slice(at + 1)
  );
}

/**
 * A message's `{name, number}` arguments, set the way English writes a whole
 * number (`fill` only knows the plain `{name}`).
 */
function fillNumbers(message: string, values: Record<string, number>): string {
  return message.replaceAll(/\{(\w+), number\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : value.toLocaleString('en');
  });
}

/** The id in a session page's address (`/sessions/12`). */
export function sessionIdOf(url: string): number {
  const id = /\/sessions\/(\d+)$/.exec(new URL(url).pathname)?.[1];
  if (id === undefined) throw new Error(`${url} is not the page of a session`);
  return Number(id);
}

/**
 * What the link of a row is called (its accessible name): the session's name,
 * then its state ONCE, then the line under the name when that says more than
 * the state does (where a running session exits, what a failed one failed
 * with). The dot in front of the name is only a colour and has no words.
 */
export function rowName(name: string, status: Shown, line?: string): string {
  const state = t(`sessions.status.${status}`);
  return line === undefined ? `${name} ${state}` : `${name} ${state} ${line}`;
}

/**
 * The sessions list and the page of one session, found the way a person finds
 * them: by role and name, with the words of the catalog. The list is the panel
 * beside the page on a desktop and a screen of its own on a phone: every
 * locator here holds for both.
 */
export class SessionsPage {
  constructor(readonly page: Page) {}

  // -- the list ---------------------------------------------------------------

  /** The panel that holds the list: beside the page, on a desktop only. */
  get panel(): Locator {
    return this.page.getByRole('navigation', {
      name: t('sessions.panel.title'),
    });
  }

  get list(): Locator {
    return this.page.getByRole('region', { name: t('sessions.list.label') });
  }

  get rows(): Locator {
    return this.list.getByRole('listitem');
  }

  /** The row of the session called `name`, found by its menu button. */
  row(name: string): Locator {
    return this.rows.filter({
      has: this.page.getByRole('button', {
        name: fill(t('sessions.row.menu'), { name }),
        exact: true,
      }),
    });
  }

  /** The link of a row: the session's page. */
  rowLink(name: string): Locator {
    return this.row(name).getByRole('link');
  }

  /** The names of the rows, top to bottom. */
  async names(): Promise<string[]> {
    const [before = '', after = ''] = t('sessions.row.menu').split('{name}');
    const labels = await this.list
      .getByRole('button', {
        name: new RegExp(
          `^${literally(before).source}.*${literally(after).source}$`,
        ),
      })
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute('aria-label') ?? ''),
      );
    return labels.map((label) =>
      label.slice(before.length, label.length - after.length),
    );
  }

  /** The first rows have come, or the list says it is empty. */
  async expectLoaded(): Promise<void> {
    await expect(
      this.rows
        .first()
        .or(
          this.list.getByRole('heading', { name: t('sessions.empty.title') }),
        ),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  }

  /** Opens the list (or the page of a session) and waits until it has answered. */
  async open(path = '/sessions'): Promise<void> {
    await this.page.goto(path);
    await this.expectLoaded();
  }

  /**
   * Opens the page of a session and waits for its heading. For where the list
   * is not beside it: a window narrower than a panel and a page take, which
   * shows the page alone.
   */
  async openSession(id: number, name: string): Promise<void> {
    await this.page.goto(`/sessions/${id}`);
    await expect(this.titleOf(name)).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
  }

  /** The count under the rows: "3 sessions", or "2 of 3 sessions" while more are to load. */
  total(count: number): Locator {
    return this.list.getByText(plural(t('sessions.list.total'), count), {
      exact: true,
    });
  }

  partial(loaded: number, count: number): Locator {
    return this.list.getByText(
      fillNumbers(plural(t('sessions.list.partial'), count), { loaded }),
      { exact: true },
    );
  }

  /**
   * What the row says as a whole, in the name of its link: the session's name,
   * its state, and the line under the name when that is more than the state
   * (`rowName`).
   */
  async expectRow(
    name: string,
    status: Shown,
    line?: string,
    timeout: number = TIMEOUT.VISIBLE,
  ): Promise<void> {
    await expect(this.rowLink(name)).toHaveAccessibleName(
      rowName(name, status, line),
      { timeout },
    );
  }

  // -- what a person does to a row ---------------------------------------------

  /** The pointer over the row: on a desktop its buttons wait for that. */
  async hover(name: string): Promise<void> {
    await this.row(name).hover();
  }

  startButton(name: string): Locator {
    return this.row(name).getByRole('button', {
      name: fill(t('sessions.row.start'), { name }),
      exact: true,
    });
  }

  stopButton(name: string): Locator {
    return this.row(name).getByRole('button', {
      name: fill(t('sessions.row.stop'), { name }),
      exact: true,
    });
  }

  menuButton(name: string): Locator {
    return this.row(name).getByRole('button', {
      name: fill(t('sessions.row.menu'), { name }),
      exact: true,
    });
  }

  async start(name: string): Promise<void> {
    await this.hover(name);
    await this.startButton(name).click();
  }

  async stop(name: string): Promise<void> {
    await this.hover(name);
    await this.stopButton(name).click();
  }

  /** The menu of the session that is open. */
  menu(name: string): Locator {
    return this.page.getByRole('menu', {
      name: fill(t('sessions.row.menu'), { name }),
    });
  }

  menuItem(name: string, item: MenuItem): Locator {
    return this.menu(name).getByRole('menuitem', { name: MENU_ITEMS[item]() });
  }

  async openMenu(name: string): Promise<void> {
    await this.hover(name);
    await this.menuButton(name).click();
    await expect(this.menu(name)).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  }

  async choose(name: string, item: MenuItem): Promise<void> {
    await this.openMenu(name);
    await this.menuItem(name, item).click();
  }

  // -- the page of a session ----------------------------------------------------

  /** The page's one heading: the name of the session that is open. */
  get title(): Locator {
    return this.page.getByRole('heading', { level: 1 });
  }

  titleOf(name: string): Locator {
    return this.page.getByRole('heading', { level: 1, name, exact: true });
  }

  /**
   * The menu button in the header of the open session's page. The list has one
   * of the same name for the row, and it comes before the page in the document.
   */
  pageMenuButton(name: string): Locator {
    return this.page
      .getByRole('button', {
        name: fill(t('sessions.row.menu'), { name }),
        exact: true,
      })
      .last();
  }

  /** The header's Start and Stop (the list's own say "Start Alpha"). */
  get headerStart(): Locator {
    return this.page.getByRole('button', {
      name: t('viewer.actions.start'),
      exact: true,
    });
  }

  get headerStop(): Locator {
    return this.page.getByRole('button', {
      name: t('viewer.actions.stop'),
      exact: true,
    });
  }

  /** The one button of the header that starts or stops the session, whichever it is now. */
  get headerButton(): Locator {
    return this.headerStart.or(this.headerStop);
  }

  /**
   * The header of the open session's page: the smallest block that holds both
   * its name and its Start or Stop button (the library's `ThreadHeader`, which
   * has no role of its own). Every block around it holds both as well, so the
   * innermost, the last in the document, is the header.
   */
  get header(): Locator {
    return this.page
      .locator('div')
      .filter({ has: this.title })
      .filter({ has: this.headerButton })
      .last();
  }

  /** The state, in words, on the line under the name. */
  headerState(status: Shown): Locator {
    return this.header.getByText(t(`sessions.status.${status}`), {
      exact: true,
    });
  }

  /**
   * "Session details" on the page of a session that is not running: the
   * heading of its body. A running session shows its browser instead.
   */
  get detailsHeading(): Locator {
    return this.page
      .getByRole('main')
      .getByRole('heading', { level: 2, name: t('viewer.details.title') });
  }

  /** The body of the page of a session that is not running: its heading, the list of details and what follows it. */
  get pageDetails(): Locator {
    return this.detailsHeading.locator('xpath=..');
  }

  /** What the page of a session that is not running says it is doing or why it failed. */
  pageStatus(text: string | RegExp): Locator {
    return this.page.getByRole('status').filter({ hasText: text });
  }

  /** The browser of a running session: its tabs. */
  get liveStage(): Locator {
    return this.page.getByRole('tablist', { name: t('viewer.tabs.label') });
  }

  /** The picture of the browser of a running session. */
  get picture(): Locator {
    return this.page.getByRole('application', {
      name: t('viewer.stage.canvas'),
    });
  }

  /** The bar under the toolbar of a running session whose proxy now exits through another IP. */
  get outOfSyncBar(): Locator {
    return this.page
      .getByRole('alert')
      .filter({ hasText: t('viewer.place.warningTitle') });
  }

  /** The bar with its border and padding: the room it takes from the picture. */
  get outOfSyncStrip(): Locator {
    return this.outOfSyncBar.locator('xpath=..');
  }

  /** The exit IP of a session, as the chip in its header says it. */
  exitChip(line: string): Locator {
    return this.page.getByRole('button', { name: line, exact: true });
  }

  /** The details the chip opens, over the page. */
  get detailsPopover(): Locator {
    return this.page.getByRole('dialog', {
      name: t('viewer.details.title'),
      exact: true,
    });
  }

  /** Presses the chip and waits for the details. */
  async openDetails(line: string): Promise<Locator> {
    await this.exitChip(line).click();
    await expect(this.detailsPopover).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    return this.detailsPopover;
  }

  /**
   * The tip a button shows while it has the keyboard, which the button names
   * as its description. Looked up through that name: a tip of the control the
   * keyboard has just left may still be on its way out.
   */
  async expectTip(button: Locator, text: string): Promise<void> {
    await expect(button).toHaveAttribute('aria-describedby', /./);
    const id = await button.getAttribute('aria-describedby');
    await expect(this.page.locator(`[id="${id}"]`)).toHaveText(text);
  }

  // -- dialogs and notices ------------------------------------------------------

  dialog(title: string): Locator {
    return this.page.getByRole('dialog', { name: title, exact: true });
  }

  get addDialog(): Locator {
    return this.dialog(t('sessions.add.title'));
  }

  /** The rename dialog is named by its action: the field holds the name. */
  get renameDialog(): Locator {
    return this.dialog(t('sessions.rename.title'));
  }

  deleteDialog(name: string): Locator {
    return this.dialog(
      fill(t('sessions.delete.title'), { name: quoted(name) }),
    );
  }

  restartDialog(name: string): Locator {
    return this.dialog(
      fill(t('sessions.restart.title'), { name: quoted(name) }),
    );
  }

  rotateDialog(name: string): Locator {
    return this.dialog(
      fill(t('sessions.rotate.title'), { name: quoted(name) }),
    );
  }

  get sharedIpDialog(): Locator {
    return this.dialog(t('sessions.sharedIp.title'));
  }

  /** The form that adds proxies, opened because an action needs one that is free. */
  get noFreeProxyDialog(): Locator {
    return this.dialog(t('sessions.noProxy.title'));
  }

  /** The same form, opened because sessions ended with no proxy that works. */
  get noWorkingProxyDialog(): Locator {
    return this.dialog(t('sessions.noWorking.title'));
  }

  /** The question asked when the proxy of a session did not work as it started. */
  brokenProxyDialog(name: string): Locator {
    return this.dialog(
      fill(t('sessions.brokenProxy.title'), { name: quoted(name) }),
    );
  }

  /** The field of a form that adds proxies. */
  proxyList(dialog: Locator): Locator {
    return dialog.getByRole('textbox', {
      name: t('proxies.import.label'),
      exact: true,
    });
  }

  /** Pastes `lines` into the form that adds proxies and presses its button. */
  async addProxiesIn(dialog: Locator, lines: readonly string[]): Promise<void> {
    await this.proxyList(dialog).fill(lines.join('\n'));
    await dialog
      .getByRole('button', { name: t('sessions.addProxies'), exact: true })
      .click();
  }

  /** A button of a dialog, by the words of the catalog. */
  button(dialog: Locator, name: string): Locator {
    return dialog.getByRole('button', { name, exact: true });
  }

  /**
   * A toast with `text` in it. An open dialog hides the rest of the page from
   * the accessibility tree, the toasts' region with it (they are announced
   * to a screen reader on their own), so they are looked up through it.
   */
  toast(text: string | RegExp): Locator {
    return this.page
      .getByRole('region', { name: /notifications/i, includeHidden: true })
      .getByRole('listitem', { includeHidden: true })
      .filter({ hasText: text });
  }

  // -- adding a session -----------------------------------------------------------

  /**
   * The header's "Add session". The page's header comes first in the document;
   * an empty list offers a second one below it.
   */
  get addButton(): Locator {
    return this.page
      .getByRole('button', { name: t('sessions.panel.add'), exact: true })
      .first();
  }

  get moreButton(): Locator {
    return this.page.getByRole('button', {
      name: t('sessions.panel.more'),
      exact: true,
    });
  }

  async openAddDialog(): Promise<Locator> {
    await this.addButton.click();
    await expect(this.addDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    return this.addDialog;
  }

  /** The dialog's field for the name. */
  nameField(dialog: Locator): Locator {
    return dialog.getByRole('textbox', {
      name: t('sessions.add.name'),
      exact: true,
    });
  }

  async chooseSystem(dialog: Locator, os: OsChoice): Promise<void> {
    await dialog
      .getByRole('combobox', { name: t('sessions.add.system'), exact: true })
      .click();
    await this.page
      .getByRole('option', { name: t(`sessions.add.os.${os}`), exact: true })
      .click();
  }

  /** Presses the dialog's "Add session". */
  async submitAdd(dialog: Locator): Promise<void> {
    await dialog
      .getByRole('button', { name: t('sessions.add.submit'), exact: true })
      .click();
  }

  /** Opens the dialog, fills what was given and presses "Add session". */
  async add(options: { name?: string; os?: OsChoice } = {}): Promise<Locator> {
    const dialog = await this.openAddDialog();
    if (options.name !== undefined) {
      await this.nameField(dialog).fill(options.name);
    }
    if (options.os !== undefined) await this.chooseSystem(dialog, options.os);
    await this.submitAdd(dialog);
    return dialog;
  }
}
