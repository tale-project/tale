import { expect, test, type Locator, type Page } from '@playwright/test';

import { t } from '../helpers/i18n';
import { readRunContext } from '../helpers/test-context';

/**
 * Cross-cutting DataTable / list-behaviour coverage (WAVE 3).
 *
 * The existing entity specs (agents, knowledge, projects, …) only exercise
 * CRUD + render against a shared `DataTable`. They never touch the table's
 * generic behaviours — client-side search, the filtered-empty ("no results")
 * state, or page navigation. This spec covers those once, on a single
 * representative list, instead of repeating them per entity.
 *
 * WHY CUSTOMERS. The customers list is the only seeded list page that exposes
 * ALL THREE behaviours we want:
 *   - managed client-side SEARCH over `name`/`email`/`externalId`
 *     (`CustomersTable` → `useListPage({ search: { fields: [...] } })` →
 *     `filterByTextSearch`, case-insensitive substring);
 *   - `displayMode: 'pagination'` → real prev/next page controls
 *     (`DataTablePagination`) with a fixed `DEFAULT_TABLE_PAGE_SIZE` of 20, so
 *     21+ rows span two pages;
 *   - a HERMETIC create path (manual-entry CSV import, already proven by
 *     `knowledge.spec.ts`) — one `email,name` line per customer, no header row,
 *     no file upload, no embeddings. That lets every test build its own
 *     throwaway rows and tear them down, leaving the shared org empty.
 *
 * The agents list also has managed search, but it ships ONE seeded row and uses
 * infinite-scroll (no page controls), so it can't demonstrate "unrelated rows
 * drop" or pagination without seeding volume.
 *
 * SORTING is intentionally NOT covered: no production list table wires a
 * `DataTableSortingConfig` (the `sorting` prop is only used in stories), so the
 * shared `DataTable` renders plain, non-sortable column headers everywhere.
 * There is nothing to click. See the note on the missing sorting test below.
 *
 * IDEMPOTENCY. Every customer is created with a per-run unique token
 * (`Date.now().toString(36)`), so rows never collide across re-runs on the one
 * shared backend, and each test deletes the rows it created (single-row delete
 * via the row menu, or select-all + bulk delete for the 21-row pagination set),
 * restoring the customers list to the empty state it started in.
 */

/** Navigate to the customers list and wait for the skeleton to settle. */
async function gotoCustomers(
  page: Page,
  organizationId: string,
): Promise<void> {
  await page.goto(`/dashboard/${organizationId}/customers`);
  // The list paints behind a skeleton (rows carry no text); the header import
  // menu renders immediately for a writer regardless of row count, so its
  // visibility means the page mounted and isn't mid-skeleton. Mirrors
  // `knowledge.spec.ts`'s `actionMenu.or(emptyState)` settle wait — here the
  // action menu alone suffices because every test seeds its own rows.
  await expect(
    page.getByRole('button', {
      name: t('customers.importMenu.importCustomers'),
    }),
  ).toBeVisible({ timeout: 60_000 });
}

/** The list's search box (`SearchInput` has no label, so match its placeholder). */
function searchBox(page: Page): Locator {
  return page.getByPlaceholder(t('customers.searchPlaceholder'));
}

/**
 * Set the search query. `SearchInput` ships `readOnly` until it receives focus
 * (an anti-autofill trick: the `onFocus` handler removes the `readonly`
 * attribute), so a bare `.fill()` would hang on Playwright's editability check —
 * which never focuses the element. Click to focus first (clearing `readonly`),
 * then fill. Works for both setting a query and clearing it (`''`).
 */
async function fillSearch(page: Page, value: string): Promise<void> {
  const box = searchBox(page);
  await box.click();
  await box.fill(value);
}

/** The customers-list row whose Name cell exactly equals `name`. */
function customerRow(page: Page, name: string): Locator {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name, exact: true }),
  });
}

/**
 * Client-side page size of the customers `DataTable` (`displayMode:
 * 'pagination'` → `DEFAULT_TABLE_PAGE_SIZE`). Only rows on the current page
 * exist in the DOM; rows beyond it render only after a page change.
 */
const PAGE_SIZE = 20;

/**
 * Create customers via the manual-entry import dialog. Each line is a
 * header-less `email,name` CSV row → exactly one `manual_import` customer
 * (the only `source` whose rows expose edit/delete row actions). Returns once
 * the batch is settled in the list.
 */
async function importCustomers(
  page: Page,
  rows: { email: string; name: string }[],
): Promise<void> {
  await page
    .getByRole('button', { name: t('customers.importMenu.importCustomers') })
    .click();
  await page
    .getByRole('menuitem', { name: t('customers.importMenu.manualEntry') })
    .click();

  const dialog = page.getByRole('dialog', {
    name: t('customers.import.addCustomers'),
  });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog
    .getByRole('textbox')
    .first()
    .fill(rows.map((r) => `${r.email},${r.name}`).join('\n'));
  await dialog
    .getByRole('button', { name: t('customers.import.import'), exact: true })
    .click();

  // One bulk mutation inserts the whole batch in array order, so the rows land
  // in a single reactive update — newest `_creationTime` first (the list orders
  // `desc`). Under `displayMode: 'pagination'` only the current page's rows
  // exist in the DOM, so the oldest rows of a >PAGE_SIZE batch sit on page 2
  // and are NOT visible. Anchor the settle on rows guaranteed to be on page 1:
  // the newest (`rows[len-1]`, top of the list) and the oldest that still fits
  // the first page (`rows[len - PAGE_SIZE]`, clamped). For batches ≤ PAGE_SIZE
  // that clamps to `rows[0]`, so every row is asserted as before.
  const newestRow = rows[rows.length - 1];
  const oldestOnPage1 = rows[Math.max(0, rows.length - PAGE_SIZE)];
  if (!newestRow || !oldestOnPage1) {
    throw new Error('importCustomers needs ≥1 row');
  }
  await expect(customerRow(page, newestRow.name)).toBeVisible({
    timeout: 60_000,
  });
  await expect(customerRow(page, oldestOnPage1.name)).toBeVisible({
    timeout: 60_000,
  });
}

/** Delete one customer through its row-actions menu + confirm dialog. */
async function deleteCustomerRow(page: Page, name: string): Promise<void> {
  const row = customerRow(page, name);
  await row.getByRole('button', { name: t('common.actions.openMenu') }).click();
  await page
    .getByRole('menuitem', { name: t('common.actions.delete') })
    .click();

  const deleteDialog = page.getByRole('dialog', {
    name: t('customers.deleteCustomer'),
  });
  await expect(deleteDialog).toBeVisible({ timeout: 20_000 });
  // The confirm button shares the menu item's label, so scope it to the dialog.
  await deleteDialog
    .getByRole('button', { name: t('common.actions.delete'), exact: true })
    .click();
  await expect(row).toHaveCount(0, { timeout: 60_000 });
}

test('search filters the customers list and clearing restores it', async ({
  page,
}) => {
  const { organizationId } = readRunContext();
  await gotoCustomers(page, organizationId);

  // Two throwaway rows with disjoint tokens: searching one must hide the other.
  const token = Date.now().toString(36);
  const matchName = `E2E Match ${token}`;
  const otherName = `E2E Other ${token}o`;
  const matchEmail = `e2e-match-${token}@example.test`;
  const otherEmail = `e2e-other-${token}@example.test`;

  await importCustomers(page, [
    { email: matchEmail, name: matchName },
    { email: otherEmail, name: otherName },
  ]);

  const matchRow = customerRow(page, matchName);
  const otherRow = customerRow(page, otherName);
  await expect(matchRow).toBeVisible();
  await expect(otherRow).toBeVisible();

  // Filter to the match row by its unique name (substring, case-insensitive).
  await fillSearch(page, matchName);
  await expect(matchRow).toBeVisible({ timeout: 20_000 });
  await expect(otherRow).toHaveCount(0, { timeout: 20_000 });

  // Clearing the query brings the full list back.
  await fillSearch(page, '');
  await expect(matchRow).toBeVisible({ timeout: 20_000 });
  await expect(otherRow).toBeVisible({ timeout: 20_000 });

  // Cleanup — restore the shared org to an empty customers list.
  await deleteCustomerRow(page, matchName);
  await deleteCustomerRow(page, otherName);
});

test('shows the no-results empty state for an unmatched search', async ({
  page,
}) => {
  const { organizationId } = readRunContext();
  await gotoCustomers(page, organizationId);

  // One row so the dataset is non-empty (the search box is disabled only when
  // the table has no rows AND no active filters — see `DataTable#searchDisabled`).
  const token = Date.now().toString(36);
  const name = `E2E Solo ${token}`;
  const email = `e2e-solo-${token}@example.test`;
  await importCustomers(page, [{ email, name }]);

  const row = customerRow(page, name);
  await expect(row).toBeVisible();

  // A query that matches nothing flips the body to the `filtered-empty` state,
  // which renders the shared `common.search.*` no-results copy.
  await fillSearch(page, `zzz-no-match-${token}-zzz`);
  await expect(row).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText(t('common.search.noResults'))).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(t('common.search.tryAdjusting'))).toBeVisible();

  // Clearing the query returns the row (and re-enables a clean list).
  await fillSearch(page, '');
  await expect(row).toBeVisible({ timeout: 20_000 });

  await deleteCustomerRow(page, name);
});

test('paginates a filtered customers list across pages', async ({ page }) => {
  const { organizationId } = readRunContext();
  await gotoCustomers(page, organizationId);

  // `PAGE_SIZE` (DEFAULT_TABLE_PAGE_SIZE) is 20, so 21 rows guarantee a second
  // page. All 21 share one token; searching by it filters the table to EXACTLY
  // these rows, making the per-page counts deterministic regardless of any
  // other customers on the shared backend (and regardless of sort order).
  const TOTAL = PAGE_SIZE + 1;
  const token = Date.now().toString(36);
  const tokenRe = new RegExp(token);
  const rows = Array.from({ length: TOTAL }, (_, i) => {
    const n = i.toString().padStart(2, '0');
    return {
      email: `e2e-page-${token}-${n}@example.test`,
      name: `E2E Page ${token} ${n}`,
    };
  });

  await importCustomers(page, rows);

  // Scope to just this run's rows so counts/assertions ignore other data.
  await fillSearch(page, token);
  const tokenRows = page.getByRole('row').filter({
    has: page.getByRole('cell', { name: tokenRe }),
  });

  const prev = page.getByRole('button', {
    name: t('common.aria.previousPage'),
  });
  const next = page.getByRole('button', { name: t('common.aria.nextPage') });

  // Page 1: a full page of the filtered set; previous is the boundary, next isn't.
  await expect(tokenRows).toHaveCount(PAGE_SIZE, { timeout: 20_000 });
  await expect(prev).toBeDisabled();
  await expect(next).toBeEnabled();

  // Advance: client-side pagination swaps the page's rows in the DOM, so the
  // last page holds only the remaining row and `next` becomes the boundary.
  await next.click();
  await expect(tokenRows).toHaveCount(TOTAL - PAGE_SIZE, { timeout: 20_000 });
  await expect(prev).toBeEnabled();
  await expect(next).toBeDisabled();

  // Back to the first full page.
  await prev.click();
  await expect(tokenRows).toHaveCount(PAGE_SIZE, { timeout: 20_000 });
  await expect(prev).toBeDisabled();

  // --- Cleanup: bulk-delete this run's rows, restoring an empty list. ---
  // The search filter stays applied so "Select all" only touches this run's
  // rows. The header checkbox toggles the CURRENT PAGE only
  // (`toggleAllPageRowsSelected` in `createSelectColumn`), so one cycle clears
  // at most a full page; iterate until the filtered set is empty. The loop is
  // bounded (≤ ceil(TOTAL / PAGE_SIZE) + 1 cycles) and each cycle asserts
  // progress, so it can't spin forever.
  const maxCycles = Math.ceil(TOTAL / PAGE_SIZE) + 1;
  for (let cycle = 0; cycle < maxCycles; cycle++) {
    const before = await tokenRows.count();
    if (before === 0) break;

    await page
      .getByRole('checkbox', { name: t('common.aria.selectAll') })
      .check();
    await page
      .getByRole('button', { name: t('common.actions.deleteSelected') })
      .click();
    // The bulk confirm dialog's title is count-parameterized, so scope by role
    // and click its confirm button (label === common.actions.delete).
    const bulkDialog = page.getByRole('dialog');
    await expect(bulkDialog).toBeVisible({ timeout: 20_000 });
    await bulkDialog
      .getByRole('button', { name: t('common.actions.delete'), exact: true })
      .click();

    // The deleted rows leave the filtered set before the next cycle reads it.
    await expect(tokenRows).toHaveCount(Math.max(before - PAGE_SIZE, 0), {
      timeout: 60_000,
    });
  }

  // All of this run's rows are gone — shared org restored to empty customers.
  await expect(tokenRows).toHaveCount(0, { timeout: 60_000 });
});
