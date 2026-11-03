import { expect, type Locator, type Page } from '@playwright/test';

import type { Scheme } from '../../../lib/api/schemas';
import { TIMEOUT } from './env';
import { fill, literally, t } from './i18n';
import { scrollThrough } from './proxies-scroll';
import { format } from './proxies-text';

/** An assertion that waits for what the page answers at once. */
export const soon = expect.configure({ timeout: TIMEOUT.VISIBLE });
/** An assertion that waits for what the page learns by polling the backend. */
export const eventually = expect.configure({ timeout: TIMEOUT.BACKGROUND });

// -- the words ------------------------------------------------------------------

const ENTITY = {
  entityOne: t('proxies.entity.one'),
  entityOther: t('proxies.entity.other'),
};

const REGION_NAMES = new Intl.DisplayNames(['en-US'], { type: 'region' });

/** "3 proxies · 2 free · 1 not working": the counts above the table. */
export function poolSummary(counts: {
  proxies: number;
  free: number;
  failed?: number;
}): string {
  return format(t('proxies.summary.line'), {
    total: counts.proxies,
    free: counts.free,
    failed: counts.failed ?? 0,
  });
}

/** "Ctrl + Enter to import" (on a Mac "⌘ Enter"): the hint under the list. */
export const SHORTCUT_HINT = new RegExp(
  `^(?:${['Ctrl + Enter', '⌘ Enter']
    .map(
      (shortcut) =>
        literally(fill(t('proxies.import.shortcut'), { shortcut })).source,
    )
    .join('|')})$`,
);

/** "Showing all 3 proxies": the table's footer once every proxy is on it. */
export function showingAll(count: number): string {
  return format(t('common.pagination.showingAll'), { count, ...ENTITY });
}

/** "Showing 1 of 700 proxies": the footer while part of the pool is on the table. */
export function showingSome(shown: number, total: number): string {
  return format(t('common.pagination.showingFiltered'), {
    filtered: shown,
    total,
    ...ENTITY,
  });
}

/** "42 ms". */
export function pingText(ms: number): string {
  return format(t('proxies.ping'), { ms });
}

/** "DE · Germany": a country code with its name. */
export function countryText(code: string): string {
  return `${code} · ${REGION_NAMES.of(code)}`;
}

/** The sentence of the reason the backend gives for a line it cannot read. */
export function refusalText(
  code: string,
  params: Record<string, string | number> = {},
): string {
  return format(t(`proxies.parseErrors.${code}`), params);
}

/** "Added 3, 1 duplicate, 2 errors": the import's report. */
export function importSummary(counts: {
  added: number;
  duplicates: number;
  errors: number;
}): string {
  return format(t('proxies.result.summary'), counts);
}

/** "3 proxies added": the notice of an import that added every line. */
export function importedText(count: number): string {
  return format(t('proxies.toasts.imported'), { count });
}

/** The protocol as the Type control names it. */
function schemeLabel(scheme: Scheme): string {
  return scheme.toUpperCase();
}

/**
 * What a row's first cell reads: the muted front (`socks5://bob@`), then the
 * `host:port`, with or without a space between them (a matter of layout).
 */
export function addressText(front: string, hostPort: string): RegExp {
  return new RegExp(
    `^${literally(front).source}\\s*${literally(hostPort).source}$`,
  );
}

/**
 * Waits until nothing on the page is moving: every transition and animation
 * that ends has ended (a spinner never does, and does not count). A colour
 * measured while a menu or a dialog fades in or out is a blend of two, which an
 * audit would report as a contrast of its own.
 */
export async function untilStill(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== 'running' ||
          animation.effect?.getComputedTiming().iterations === Infinity,
      ),
  );
}

// -- the page -------------------------------------------------------------------

/** The columns of the table, in the order of `proxies.columns.*`. */
const COLUMN = { address: 0, exit: 1, ping: 2, health: 3, session: 4 } as const;

const ACTIONS_FOR = new RegExp(
  `^${literally(fill(t('proxies.row.actionsFor'), { proxy: '' })).source}`,
);

const ACTIONS_PREFIX = fill(t('proxies.row.actionsFor'), { proxy: '' });

const HEALTH = {
  ok: t('proxies.health.ok'),
  failed: t('proxies.health.failed'),
  checking: t('proxies.health.checking'),
  unchecked: t('proxies.health.unchecked'),
} as const;

export interface ProxyRow {
  row: Locator;
  address: Locator;
  exit: Locator;
  ping: Locator;
  health: Locator;
  session: Locator;
  /** The button of the row's menu. */
  menu: Locator;
}

/**
 * The badge of a row's health: "Working", "Not working", "Checking" or "Not
 * checked". The cell holds more (the reason it does not work, when it was last
 * checked), so a row is asked for its badge, not for the text of its cell.
 */
export function badge(
  row: Pick<ProxyRow, 'row'>,
  state: keyof typeof HEALTH,
): Locator {
  return row.row.getByText(HEALTH[state], { exact: true });
}

/** The Proxies section, reached the way a person reaches it: by its address. */
export class ProxiesPage {
  readonly heading: Locator;
  /** The toolbar's button that checks every proxy, before the Add menu. */
  readonly checkAll: Locator;
  readonly region: Locator;
  readonly search: Locator;
  /** The toolbar's button that lifts the search (while one is typed, on a screen wide enough for it). */
  readonly clearSearch: Locator;
  /** The toolbar's Add menu. */
  readonly addMenu: Locator;
  readonly table: Locator;
  /** The proxies on the table, not its header, its spacers or its empty state. */
  readonly rows: Locator;
  readonly footer: Locator;
  readonly addDialog: Locator;
  readonly importDialog: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', {
      level: 1,
      name: t('proxies.title'),
    });
    this.region = page.getByRole('region', { name: t('proxies.table.region') });
    this.checkAll = this.region.getByRole('button', {
      name: t('proxies.actions.checkAll'),
    });
    this.search = this.region.getByRole('textbox', {
      name: t('proxies.search.placeholder'),
    });
    this.clearSearch = this.region.getByRole('button', {
      name: t('proxies.search.clear'),
    });
    // The menu of the toolbar: the empty state has an "Add proxy" button of
    // its own, so the one that opens a menu is told by that.
    this.addMenu = this.region
      .getByRole('button', { name: t('proxies.actions.add'), exact: true })
      .and(page.locator('[aria-haspopup]'));
    this.table = this.region.getByRole('table', {
      name: t('proxies.table.caption'),
    });
    this.rows = this.table
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: ACTIONS_FOR }) });
    this.footer = this.region.getByRole('status');
    this.addDialog = page.getByRole('dialog', { name: t('proxies.add.title') });
    this.importDialog = page.getByRole('dialog', {
      name: t('proxies.import.title'),
    });
  }

  static async open(page: Page): Promise<ProxiesPage> {
    const proxies = new ProxiesPage(page);
    await page.goto('/proxies');
    await expect(proxies.heading).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
    return proxies;
  }

  /** The row of the proxy `host:port` (an IPv6 host in brackets). */
  row(hostPort: string): ProxyRow {
    const row = this.table
      .getByRole('row')
      .filter({ has: this.page.getByText(hostPort, { exact: true }) });
    const cells = row.getByRole('cell');
    return {
      row,
      address: cells.nth(COLUMN.address),
      exit: cells.nth(COLUMN.exit),
      ping: cells.nth(COLUMN.ping),
      health: cells.nth(COLUMN.health),
      session: cells.nth(COLUMN.session),
      menu: row.getByRole('button', {
        name: fill(t('proxies.row.actionsFor'), { proxy: hostPort }),
      }),
    };
  }

  /** The box is read-only until it has the focus (against autofill). */
  async searchFor(text: string): Promise<void> {
    await this.search.click();
    await this.search.fill(text);
  }

  /** A transient notice, such as the one that says a proxy was deleted. */
  toast(text: string): Locator {
    return this.page.getByText(text, { exact: true });
  }

  /**
   * Sends a notice away. A notice stands at the top right for five seconds, over
   * the end of the toolbar where the Add menu is, and a click on that menu waits
   * for it to go; one that comes while the notice slides in even leaves the
   * pointer resting on it, which keeps it there for as long as the pointer
   * stays. Escape dismisses it, for a person at the keyboard as for a spec, and
   * the way to the toolbar is clear when it returns.
   */
  async dismissNotice(text: string): Promise<void> {
    const notice = this.toast(text);
    await soon(notice).toBeVisible();
    await this.page.keyboard.press('Escape');
    await soon(notice).toBeHidden();
  }

  async expectSummary(counts: {
    proxies: number;
    free: number;
    failed?: number;
  }): Promise<void> {
    await eventually(
      this.region.getByText(poolSummary(counts), { exact: true }),
    ).toBeVisible();
  }

  /**
   * The `host:port` of the proxies the table has drawn now: a long table draws
   * only the rows near the part in view.
   */
  async drawnHostPorts(): Promise<string[]> {
    const labels = await this.rows
      .getByRole('button', { name: ACTIONS_FOR })
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute('aria-label') ?? ''),
      );
    return labels.map((label) => label.slice(ACTIONS_PREFIX.length));
  }

  /**
   * Scrolls the table down with the wheel until `count` different proxies came
   * into view: the order they came in, and the ones drawn twice at once. The
   * list starts with the proxy `first`.
   */
  scrollThrough(
    count: number,
    first: string,
  ): Promise<{ seen: string[]; drawnTwice: string[] }> {
    return scrollThrough(
      this.page,
      this.table,
      () => this.drawnHostPorts(),
      count,
      first,
    );
  }

  // -- the row menu --------------------------------------------------------------

  async chooseInRowMenu(hostPort: string, item: string): Promise<void> {
    await this.row(hostPort).menu.click();
    await this.page.getByRole('menuitem', { name: item }).click();
  }

  async checkRow(hostPort: string): Promise<void> {
    await this.chooseInRowMenu(hostPort, t('proxies.row.check'));
  }

  async deleteRow(hostPort: string): Promise<void> {
    await this.chooseInRowMenu(hostPort, t('common.actions.delete'));
  }

  // -- the dialogs ---------------------------------------------------------------

  async openAddDialog(): Promise<Locator> {
    await this.addMenu.click();
    await this.page
      .getByRole('menuitem', { name: t('proxies.actions.addProxy') })
      .click();
    await soon(this.addDialog).toBeVisible();
    return this.addDialog;
  }

  async openImportDialog(): Promise<Locator> {
    await this.addMenu.click();
    await this.page
      .getByRole('menuitem', { name: t('proxies.actions.importProxies') })
      .click();
    await soon(this.importDialog).toBeVisible();
    return this.importDialog;
  }

  get addField(): Locator {
    return this.addDialog.getByRole('textbox', {
      name: t('proxies.add.label'),
    });
  }

  get addSubmit(): Locator {
    return this.addDialog.getByRole('button', {
      name: t('proxies.add.submit'),
    });
  }

  get importField(): Locator {
    return this.importDialog.getByRole('textbox', {
      name: t('proxies.import.label'),
    });
  }

  get importSubmit(): Locator {
    return this.importDialog.getByRole('button', {
      name: t('proxies.import.submit'),
    });
  }

  /** The choice of the type a proxy without one of its own gets. */
  schemeChoice(dialog: Locator, scheme: Scheme): Locator {
    return dialog.getByRole('radio', {
      name: schemeLabel(scheme),
      exact: true,
    });
  }

  /** Types the proxy into the open Add dialog and submits it. */
  async submitProxy(text: string, scheme?: Scheme): Promise<void> {
    if (scheme !== undefined)
      await this.schemeChoice(this.addDialog, scheme).click();
    await this.addField.fill(text);
    await this.addSubmit.click();
  }

  /** The whole way: the Add menu, the dialog, the proxy typed in, submitted. */
  async add(text: string, scheme?: Scheme): Promise<void> {
    await this.openAddDialog();
    await this.submitProxy(text, scheme);
  }

  /**
   * Adds a proxy the backend accepts, and sees the notice of it away, so that
   * the next click on the toolbar does not meet it.
   */
  async addAccepted(text: string, scheme?: Scheme): Promise<void> {
    await this.add(text, scheme);
    await soon(this.addDialog).toBeHidden();
    await this.dismissNotice(t('proxies.toasts.added'));
  }

  /** Pastes the list into the Import dialog and imports it. */
  async importList(text: string, scheme?: Scheme): Promise<void> {
    await this.openImportDialog();
    if (scheme !== undefined) {
      await this.schemeChoice(this.importDialog, scheme).click();
    }
    await this.importField.fill(text);
    await this.importSubmit.click();
  }

  /** The `details` of the report that has this summary line. */
  importGroup(summary: string): Locator {
    return this.importDialog
      .getByRole('group')
      .filter({ has: this.page.getByText(summary, { exact: true }) });
  }

  /**
   * The dialog is open and has finished fading in. A dialog closed while it
   * still fades in leaves a menu that the keyboard opens next without the
   * focus, which no person's pace can reach.
   */
  async expectOpen(dialog: Locator): Promise<void> {
    await soon(dialog).toBeVisible();
    await soon(dialog).toHaveCSS('opacity', '1');
  }

  /** The dialogs of deleting a proxy, by what they ask. */
  deleteDialog(kind: 'plain' | 'in-use' | 'busy'): Locator {
    const titles = {
      plain: t('proxies.delete.title'),
      'in-use': t('proxies.delete.inUseTitle'),
      busy: t('proxies.delete.busyTitle'),
    };
    return this.page.getByRole('dialog', { name: titles[kind] });
  }
}
