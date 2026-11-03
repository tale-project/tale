import {
  expect,
  type Browser,
  type Locator,
  type Page,
} from '@playwright/test';

import type { SecretKind } from '../../../lib/api/schemas';
import { TIMEOUT } from './env';
import { fill, literally, t } from './i18n';
import { scrollThrough } from './proxies-scroll';
import { format } from './proxies-text';

/** An assertion that waits for what the page answers at once. */
export const soon = expect.configure({ timeout: TIMEOUT.VISIBLE });
/** An assertion that waits for what the page learns by polling the backend. */
export const eventually = expect.configure({ timeout: TIMEOUT.BACKGROUND });

// -- the words ------------------------------------------------------------------

export const KINDS = ['personal', 'credentials', 'card', 'note'] as const;

/** "Credit card": the name of a kind of secret. */
export function kindLabel(kind: SecretKind): string {
  return t(`secrets.kinds.${kind}`);
}

/** "Every session" or `Session "alpha"`: who a secret is for. */
export function scopeText(session: string | null): string {
  return session === null
    ? t('secrets.scope.everySession')
    : fill(t('secrets.scope.session'), { name: session });
}

/** "Credentials · Every session": what the secret is and who it is for. */
export function summaryText(kind: SecretKind, session: string | null): string {
  return fill(t('secrets.summary'), {
    kind: kindLabel(kind),
    scope: scopeText(session),
  });
}

/** "Showing all 4 secrets": the table's footer. */
export function showingAll(count: number): string {
  return format(t('common.pagination.showingAll'), {
    count,
    entityOne: t('secrets.table.entityOne'),
    entityOther: t('secrets.table.entityOther'),
  });
}

/** The label of one of the fields a kind starts with, as the person reads it. */
export function startingField(
  key:
    | 'name'
    | 'email'
    | 'phone'
    | 'address'
    | 'company'
    | 'companyAddress'
    | 'website'
    | 'username'
    | 'password'
    | 'cardholder'
    | 'cardNumber'
    | 'expiry'
    | 'cvc'
    | 'note',
): string {
  return t(`secrets.fields.${key}`);
}

/** The fields each kind of secret starts with, in the order of the form. */
export const STARTING_FIELDS: Record<
  SecretKind,
  Array<Parameters<typeof startingField>[0]>
> = {
  personal: ['name', 'email', 'phone', 'address', 'company', 'companyAddress'],
  credentials: ['website', 'username', 'password'],
  card: ['cardholder', 'cardNumber', 'expiry', 'cvc'],
  note: ['note'],
};

/**
 * Where the text of a table cell ends and where the room the cell leaves it
 * ends (the padding is not room). A text that needs more than its room ends
 * past the room: it is cut short and drawn as dots, or it runs over the next
 * cell.
 */
async function textEnd(cell: Locator): Promise<{ text: number; room: number }> {
  return cell.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return {
      text: range.getBoundingClientRect().right,
      room:
        element.getBoundingClientRect().right -
        Number.parseFloat(getComputedStyle(element).paddingRight),
    };
  });
}

// -- the page -------------------------------------------------------------------

/** The columns of the table, in the order of `secrets.table.columns.*`. */
const COLUMN = { title: 0, kind: 1, scope: 2, details: 3, updated: 4 } as const;

/**
 * The row of the secret titled `title`, found without a word of the page's
 * language: by the title, which is the person's own text.
 */
function rowTitled(page: Page, title: string): Locator {
  return page.getByRole('row').filter({
    has: page.getByRole('button', { name: title, exact: true }),
  });
}

/**
 * The cell that tells how long ago the secret titled `title` was changed ("a
 * few seconds ago"), found by its place, so the page can be in any language.
 */
export function ageCell(page: Page, title: string): Locator {
  return rowTitled(page, title).getByRole('cell').nth(COLUMN.updated);
}

/**
 * Where the age of the secret titled `title` ends in its cell, where the room
 * of the cell ends, and where the button of the row's menu begins. The page's
 * own font is waited for: the same words are wider in the one it falls back to.
 */
export async function ageOf(
  page: Page,
  title: string,
): Promise<{ text: number; room: number; menu: number }> {
  await page.evaluate(() => document.fonts.ready);
  const menu = await rowTitled(page, title)
    .getByRole('cell')
    .last()
    .getByRole('button')
    .boundingBox();
  if (menu === null) throw new Error(`The row of "${title}" has no menu`);
  return { ...(await textEnd(ageCell(page, title))), menu: menu.x };
}

const ACTIONS_FOR = new RegExp(
  `^${literally(fill(t('secrets.table.actionsFor'), { title: '' })).source}`,
);

const FIELD_SCOPE = new RegExp(
  `^${literally(t('secrets.scope.label')).source}`,
);

export interface SecretRow {
  row: Locator;
  /** The button that opens the secret, named by its title. */
  title: Locator;
  kind: Locator;
  scope: Locator;
  details: Locator;
  /** How long ago the secret was changed. */
  updated: Locator;
  /** The button of the row's menu. */
  menu: Locator;
}

/** The Secrets section, reached the way a person reaches it: by its address. */
export class SecretsPage {
  readonly heading: Locator;
  readonly region: Locator;
  readonly table: Locator;
  readonly search: Locator;
  readonly addButton: Locator;
  /** The button that opens the panel of the filters. */
  readonly filterButton: Locator;
  /** The panel of the filters: the type, and who the secrets are available to. */
  readonly filterPanel: Locator;
  /** The filters in force, each a button that lifts it. */
  readonly chips: Locator;
  /** The secrets on the table, not its header or its empty state. */
  readonly rows: Locator;
  readonly footer: Locator;
  readonly createDialog: Locator;
  readonly editDialog: Locator;
  readonly viewDialog: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', {
      level: 1,
      name: t('navigation.sections.secrets'),
    });
    this.region = page.getByRole('region', {
      name: t('secrets.table.caption'),
    });
    this.table = this.region.getByRole('table', {
      name: t('secrets.table.caption'),
    });
    this.search = this.region.getByRole('textbox', {
      name: t('secrets.table.searchPlaceholder'),
    });
    this.addButton = this.region.getByRole('button', {
      name: t('secrets.actions.add'),
    });
    this.filterButton = this.region.getByRole('button', {
      name: t('common.labels.filter'),
      exact: true,
    });
    this.filterPanel = page.getByRole('dialog', {
      name: t('common.labels.filters'),
    });
    this.chips = this.region.getByRole('list', {
      name: t('secrets.filters.active'),
    });
    this.rows = this.table
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: ACTIONS_FOR }) });
    this.footer = this.region.getByRole('status');
    this.createDialog = page.getByRole('dialog', {
      name: t('secrets.form.createTitle'),
    });
    this.editDialog = page.getByRole('dialog', {
      name: t('secrets.form.editTitle'),
    });
    this.viewDialog = page.getByRole('dialog', {
      name: t('secrets.view.title'),
    });
  }

  static async open(page: Page): Promise<SecretsPage> {
    const secrets = new SecretsPage(page);
    await page.goto('/secrets');
    await expect(secrets.heading).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    return secrets;
  }

  /** The row of the secret with this title. */
  row(title: string): SecretRow {
    const row = this.table.getByRole('row').filter({
      has: this.page.getByRole('button', { name: title, exact: true }),
    });
    const cells = row.getByRole('cell');
    return {
      row,
      title: row.getByRole('button', { name: title, exact: true }),
      kind: cells.nth(COLUMN.kind),
      scope: cells.nth(COLUMN.scope),
      details: cells.nth(COLUMN.details),
      updated: cells.nth(COLUMN.updated),
      menu: row.getByRole('button', {
        name: fill(t('secrets.table.actionsFor'), { title }),
      }),
    };
  }

  /** The box is read-only until it has the focus (against autofill). */
  async searchFor(text: string): Promise<void> {
    await this.search.click();
    await this.search.fill(text);
  }

  /**
   * Narrows the list in the panel of the filters: opens it, opens the group
   * (`type`, or who the secrets are `scope`d to), chooses, and closes it.
   */
  async filterBy(group: 'type' | 'scope', choice: string): Promise<void> {
    await this.filterButton.click();
    await soon(this.filterPanel).toBeVisible();
    const title = t(`secrets.filters.${group}`);
    const section = this.filterPanel.getByRole('button', {
      name: title,
      exact: true,
    });
    if ((await section.getAttribute('aria-expanded')) !== 'true') {
      await section.click();
    }
    await this.filterPanel
      .getByRole('radiogroup', { name: title })
      .getByRole('radio', { name: choice, exact: true })
      .click();
    await this.page.keyboard.press('Escape');
    await soon(this.filterPanel).toBeHidden();
  }

  /** Narrows the list to a kind of secret, or to all of them. */
  filterByKind(kind: SecretKind | 'all'): Promise<void> {
    return this.filterBy(
      'type',
      kind === 'all' ? t('secrets.filters.all') : kindLabel(kind),
    );
  }

  /** The button of the filter "Type: Note" that lifts it. */
  chip(group: 'type' | 'scope', value: string): Locator {
    const chip = fill(t('secrets.filters.chip'), {
      filter: t(`secrets.filters.${group}`),
      value,
    });
    return this.chips.getByRole('button', {
      name: fill(t('secrets.filters.remove'), { chip }),
    });
  }

  /**
   * The toolbar's button that lifts every filter and the search ("Clear
   * filters"): the service's own, not the library's "Clear all", which in German
   * reads as deleting the secrets. It stands there only while something narrows
   * the list, on a screen wide enough for it.
   */
  get clearAll(): Locator {
    return this.region.getByRole('button', {
      name: t('secrets.filters.clearAll'),
    });
  }

  /** The "Clear all" at the top of the filters' panel: the library's own, which lifts both groups. */
  get clearInPanel(): Locator {
    return this.filterPanel.getByRole('button', {
      name: t('common.actions.clearAll'),
    });
  }

  /** A transient notice, such as the one that says a secret was deleted. */
  toast(text: string): Locator {
    return this.page.getByText(text, { exact: true });
  }

  async titles(): Promise<string[]> {
    const names = await this.rows
      .getByRole('button', { name: ACTIONS_FOR })
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute('aria-label') ?? ''),
      );
    const prefix = fill(t('secrets.table.actionsFor'), { title: '' });
    return names.map((name) => name.slice(prefix.length));
  }

  /**
   * Scrolls the table down with the wheel until `count` different secrets came
   * into view: the order they came in, and the ones drawn twice at once. The
   * list starts with the secret `first`.
   */
  scrollThrough(
    count: number,
    first: string,
  ): Promise<{ seen: string[]; drawnTwice: string[] }> {
    return scrollThrough(
      this.page,
      this.table,
      () => this.titles(),
      count,
      first,
    );
  }

  // -- the dialogs ---------------------------------------------------------------

  async openCreate(): Promise<Locator> {
    await this.addButton.click();
    await soon(this.createDialog).toBeVisible();
    return this.createDialog;
  }

  async chooseInRowMenu(title: string, item: string): Promise<void> {
    await this.row(title).menu.click();
    await this.page.getByRole('menuitem', { name: item }).click();
  }

  async openEdit(title: string): Promise<Locator> {
    await this.chooseInRowMenu(title, t('secrets.actions.edit'));
    await soon(this.editDialog).toBeVisible();
    // Changing a secret reads the whole of it first.
    await soon(
      this.editDialog.getByRole('textbox', { name: t('secrets.form.title') }),
    ).toHaveValue(title);
    return this.editDialog;
  }

  async openView(title: string): Promise<Locator> {
    await this.row(title).title.click();
    await soon(this.viewDialog).toBeVisible();
    return this.viewDialog;
  }

  async openDelete(title: string): Promise<Locator> {
    await this.chooseInRowMenu(title, t('common.actions.delete'));
    const dialog = this.deleteDialog(title);
    await soon(dialog).toBeVisible();
    return dialog;
  }

  deleteDialog(title: string): Locator {
    return this.page.getByRole('dialog', {
      name: fill(t('secrets.delete.title'), { title }),
    });
  }

  /** The button of the question that deletes the secret: it names the object ("Delete secret"). */
  deleteConfirm(dialog: Locator): Locator {
    return dialog.getByRole('button', {
      name: t('secrets.delete.confirm'),
      exact: true,
    });
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

  // -- the form ------------------------------------------------------------------

  /** Chooses the kind of the secret being added. */
  async chooseKind(dialog: Locator, kind: SecretKind): Promise<void> {
    await dialog
      .getByRole('combobox', { name: t('secrets.form.kind') })
      .click();
    await this.page
      .getByRole('option', { name: kindLabel(kind), exact: true })
      .click();
  }

  titleField(dialog: Locator): Locator {
    return dialog.getByRole('textbox', { name: t('secrets.form.title') });
  }

  /** The group of the secret's values. */
  values(dialog: Locator): Locator {
    return dialog.getByRole('group', { name: t('secrets.form.values') });
  }

  /** The value of a starting field, by its label as the person reads it. */
  valueField(dialog: Locator, label: string): Locator {
    return this.values(dialog).getByRole('textbox', {
      name: label,
      exact: true,
    });
  }

  /** The choice to keep a value hidden, by the label of the value. */
  keepHidden(dialog: Locator, label: string): Locator {
    return dialog.getByRole('checkbox', {
      name: fill(t('secrets.row.keepHiddenFor'), { label }),
      exact: true,
    });
  }

  /**
   * The buttons beside a value, by the label of the value: in the form and in
   * the details dialog, which has the same Show, Hide and Copy.
   */
  valueButton(
    dialog: Locator,
    action: 'show' | 'hide' | 'copy' | 'remove',
    label: string,
  ): Locator {
    return dialog.getByRole('button', {
      name: fill(t(`secrets.row.${action}`), { label }),
      exact: true,
    });
  }

  /** The rows a person added, in the order they were added. */
  customRows(dialog: Locator): Locator {
    return this.values(dialog).getByRole('group');
  }

  customLabel(dialog: Locator, index: number): Locator {
    return this.customRows(dialog)
      .nth(index)
      .getByRole('textbox', { name: t('secrets.row.label'), exact: true });
  }

  customValue(dialog: Locator, index: number): Locator {
    return this.customRows(dialog)
      .nth(index)
      .getByRole('textbox', { name: t('secrets.row.value'), exact: true });
  }

  addFieldButton(dialog: Locator): Locator {
    return dialog.getByRole('button', { name: t('secrets.form.addField') });
  }

  /** Who the secret is for, as the form's select shows it. */
  scopeSelect(dialog: Locator): Locator {
    return dialog.getByRole('button', { name: FIELD_SCOPE });
  }

  /** Chooses who the secret is for in the form: `null` is every session. */
  async chooseScope(dialog: Locator, session: string | null): Promise<void> {
    await this.scopeSelect(dialog).click();
    await this.page
      .getByRole('option', { name: scopeText(session), exact: true })
      .click();
  }

  submit(dialog: Locator, label: string): Locator {
    return dialog.getByRole('button', { name: label, exact: true });
  }
}

/**
 * How long ago a fresh change reads in English. A page of another language
 * paints these words first, until the data of its own language has arrived,
 * so they are what to wait to see gone before its words are measured.
 */
export async function englishAge(
  browser: Browser,
  title: string,
): Promise<string> {
  const context = await browser.newContext({ locale: 'en-US' });
  try {
    const secrets = await SecretsPage.open(await context.newPage());
    const { updated } = secrets.row(title);
    await soon(updated).toHaveText(/\S/);
    return (await updated.innerText()).trim();
  } finally {
    await context.close();
  }
}
