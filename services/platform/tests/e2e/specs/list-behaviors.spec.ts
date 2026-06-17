import { type Locator, type Page } from '@playwright/test';

import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Cross-cutting DataTable behaviours covered once on the customers list rather
 * than per entity: managed client-side search and `displayMode: 'pagination'`
 * page navigation. Customers is the only seeded list exposing BOTH plus a
 * hermetic manual-entry import path (one `email,name` CSV line per row, no file,
 * no embeddings) so each test builds its own rows and tears them down.
 *
 * Sorting is intentionally not covered: no production list wires a
 * `DataTableSortingConfig`, so headers are non-sortable everywhere.
 *
 * Idempotency: every row carries a per-run token; each test deletes the rows it
 * created, restoring the worker org's customers list to empty.
 */

/** Navigate to the customers list and wait for the skeleton to settle. */
async function gotoCustomers(
  page: Page,
  organizationId: string,
): Promise<void> {
  await page.goto(`/dashboard/${organizationId}/customers`);
  // The header import menu renders immediately for a writer regardless of row
  // count, so its visibility means the page mounted and isn't mid-skeleton.
  await expect(
    page.getByRole('button', {
      name: t('customers.importMenu.importCustomers'),
    }),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
}

/** The list's search box (`SearchInput` has no label, so match its placeholder). */
function searchBox(page: Page): Locator {
  return page.getByPlaceholder(t('customers.searchPlaceholder'));
}

/** The customers-list row whose Name cell exactly equals `name`. */
function customerRow(page: Page, name: string): Locator {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name, exact: true }),
  });
}

/**
 * Create customers via the manual-entry import dialog. Each line is a
 * header-less `email,name` CSV row → one `manual_import` customer. Resolves once
 * the first and last created rows are visible.
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
  await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await dialog
    .getByRole('textbox')
    .first()
    .fill(rows.map((r) => `${r.email},${r.name}`).join('\n'));
  await dialog
    .getByRole('button', { name: t('customers.import.import'), exact: true })
    .click();

  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];
  if (!firstRow || !lastRow) throw new Error('importCustomers needs ≥1 row');
  await expect(customerRow(page, firstRow.name)).toBeVisible({
    timeout: TIMEOUT.NAV,
  });
  await expect(customerRow(page, lastRow.name)).toBeVisible({
    timeout: TIMEOUT.NAV,
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
  await expect(deleteDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await deleteDialog
    .getByRole('button', { name: t('common.actions.delete'), exact: true })
    .click();
  await expect(row).toHaveCount(0, { timeout: TIMEOUT.NAV });
}

test('search filters the customers list and clearing restores it', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
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
  await searchBox(page).fill(matchName);
  await expect(matchRow).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expect(otherRow).toHaveCount(0, { timeout: TIMEOUT.VISIBLE });

  // Clearing the query brings the full list back.
  await searchBox(page).fill('');
  await expect(matchRow).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expect(otherRow).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // Cleanup — restore the worker org to an empty customers list.
  await deleteCustomerRow(page, matchName);
  await deleteCustomerRow(page, otherName);
});

test('shows the no-results empty state for an unmatched search', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
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
  await searchBox(page).fill(`zzz-no-match-${token}-zzz`);
  await expect(row).toHaveCount(0, { timeout: TIMEOUT.VISIBLE });
  await expect(page.getByText(t('common.search.noResults'))).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });
  await expect(page.getByText(t('common.search.tryAdjusting'))).toBeVisible();

  // Clearing the query returns the row (and re-enables a clean list).
  await searchBox(page).fill('');
  await expect(row).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // Cleanup — restore the worker org to an empty customers list.
  await deleteCustomerRow(page, name);
});

test('paginates a filtered customers list across pages', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  await gotoCustomers(page, organizationId);

  // DEFAULT_TABLE_PAGE_SIZE is 20, so 21 rows guarantee a second page. All 21
  // share one token; searching by it filters to EXACTLY these rows, making the
  // per-page counts deterministic regardless of any other data or sort order.
  const PAGE_SIZE = 20;
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
  await searchBox(page).fill(token);
  const tokenRows = page.getByRole('row').filter({
    has: page.getByRole('cell', { name: tokenRe }),
  });

  const prev = page.getByRole('button', {
    name: t('common.aria.previousPage'),
  });
  const next = page.getByRole('button', { name: t('common.aria.nextPage') });

  // Page 1: a full page; previous is the boundary, next isn't.
  await expect(tokenRows).toHaveCount(PAGE_SIZE, { timeout: TIMEOUT.VISIBLE });
  await expect(prev).toBeDisabled();
  await expect(next).toBeEnabled();

  // Advance: the last page holds only the remaining row; next is now boundary.
  await next.click();
  await expect(tokenRows).toHaveCount(TOTAL - PAGE_SIZE, {
    timeout: TIMEOUT.VISIBLE,
  });
  await expect(prev).toBeEnabled();
  await expect(next).toBeDisabled();

  // Back to the first full page.
  await prev.click();
  await expect(tokenRows).toHaveCount(PAGE_SIZE, { timeout: TIMEOUT.VISIBLE });
  await expect(prev).toBeDisabled();

  // Cleanup: the search filter stays applied so "Select all" only touches this
  // run's rows. The header checkbox toggles the CURRENT PAGE only, so iterate
  // until the filtered set is empty. The loop is bounded and asserts progress.
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
    const bulkDialog = page.getByRole('dialog');
    await expect(bulkDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await bulkDialog
      .getByRole('button', { name: t('common.actions.delete'), exact: true })
      .click();

    await expect(tokenRows).toHaveCount(Math.max(before - PAGE_SIZE, 0), {
      timeout: TIMEOUT.NAV,
    });
  }

  await expect(tokenRows).toHaveCount(0, { timeout: TIMEOUT.NAV });
});
