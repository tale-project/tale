import { expect, test, type Page } from '@playwright/test';

import { t } from '../helpers/i18n';
import { readRunContext } from '../helpers/test-context';

/**
 * Governance DEPTH coverage (Wave 2). The two existing governance specs own:
 *  - `governance-settings.spec.ts` — Policies & limits voice-output toggle.
 *  - `governance-pages.spec.ts`    — the all-pages render matrix + the
 *    Guardrails content-safety toggle.
 *
 * This spec adds REAL flows on the OTHER governance pages, and falls back to
 * render + a safe affordance where a real mutation would be destructive or
 * needs an external service:
 *
 *  1. content-models / system prompt — REAL MUTATE: edit the mandatory-prefix
 *     prompt → save → reload → assert persisted → RESTORE the original.
 *  2. run-code-policy — REAL MUTATE: flip the default-mode radio
 *     (allowlist ⇄ denylist) → save → reload → assert persisted → RESTORE.
 *  3. data-subject-requests — RENDER + AFFORDANCE: filing an Art. 17 erasure
 *     against the only org member (the owner) is destructive and NOT reversible
 *     in-app, so this opens the file-request dialog and closes it without
 *     submitting (touches no backend state).
 *  4. logs — RENDER + safe interaction: assert the audit log table region, then
 *     switch the Tabs strip (read-only navigation, no mutation).
 *  5. usage — RENDER: the analytics page paints its summary cards, controls, and
 *     trend chart once the metrics query settles.
 *  6. trash — RENDER: the page renders its table/empty state. The Restore action
 *     mutates the trash pool and is NOT exercised.
 *  7. legal-hold — RENDER + AFFORDANCE: assert Active holds, open the Place-hold
 *     dialog and close it (placing a hold mutates and is not exercised).
 *  8. feedback — RENDER: the analytics page paints its sections.
 *
 * Idempotency: the two REAL-MUTATE flows (1, 2) capture the original value up
 * front and restore it at the end; everything else is read-only or open/close.
 * Runs as the pre-authenticated owner (chromium storageState) against the
 * seeded org from `readRunContext()`.
 */

const GOVERNANCE_BASE = (organizationId: string) =>
  `/dashboard/${organizationId}/settings/governance`;

// =============================================================================
// 1. Content models — system prompt (mandatory prefix): edit → save → persist.
// =============================================================================

/**
 * The SystemPromptEditor renders its save affordance via the unified
 * `EditorActions` cluster as a submit button bound to the editor's form
 * (`<button type="submit" form="governance-system-prompt-form">`). The
 * content-models page mounts three editors (system-prompt / default-model /
 * model-access), each with its own "Save"; scope to THIS form so the locator is
 * unambiguous and we only drive the system-prompt save.
 */
function systemPromptSaveButton(page: Page) {
  // EditorActions renders the Save twice (a `md:hidden` mobile action bar + the
  // desktop slot), both bound via `form=`. At the desktop test viewport the
  // mobile copy is hidden; clicking it is a no-op (the form never submits), so
  // scope to the visible one.
  return page.locator('button[form="governance-system-prompt-form"]:visible');
}

test('content-models: edits the system prompt, persists, and restores', async ({
  page,
}) => {
  const { organizationId } = readRunContext();
  await page.goto(`${GOVERNANCE_BASE(organizationId)}/content-models`);

  // The PageSection heading proves the editor mounted and resolved its policy.
  await expect(
    page
      .getByRole('heading', { name: t('governance.systemPrompt.title') })
      .first(),
  ).toBeVisible({ timeout: 60_000 });

  // The mandatory-prefix textarea is labelled via `aria-label`. Its wrapping
  // FormSection renders a `role=group` with the SAME accessible name, so
  // `getByLabel` is ambiguous (group + textbox) — scope to the textbox role.
  const prefixField = page.getByRole('textbox', {
    name: t('governance.systemPrompt.prefixLabel'),
  });
  await expect(prefixField).toBeVisible({ timeout: 60_000 });
  await expect(prefixField).toBeEnabled();

  // Capture the original so the run is restorable (this is shared org state).
  const originalPrefix = await prefixField.inputValue();
  const marker = `E2E governance prefix ${Date.now().toString(36)}`;
  expect(marker).not.toBe(originalPrefix);

  // Editing makes the form dirty, which enables the EditorActions Save button.
  await prefixField.fill(marker);
  const save = systemPromptSaveButton(page);
  await expect(save).toBeEnabled({ timeout: 20_000 });
  await save.click();

  await expect(
    page.getByText(t('governance.systemPrompt.saved')).first(),
  ).toBeVisible({ timeout: 20_000 });

  // Reload: the new value must come back from the backend, not local state.
  await page.reload();
  const reloadedPrefix = page.getByRole('textbox', {
    name: t('governance.systemPrompt.prefixLabel'),
  });
  await expect(reloadedPrefix).toBeVisible({ timeout: 60_000 });
  await expect(reloadedPrefix).toHaveValue(marker, { timeout: 20_000 });

  // Restore the original value (keeps re-runs deterministic) and confirm save.
  await reloadedPrefix.fill(originalPrefix);
  const restoreSave = systemPromptSaveButton(page);
  await expect(restoreSave).toBeEnabled({ timeout: 20_000 });
  await restoreSave.click();
  await expect(
    page.getByText(t('governance.systemPrompt.saved')).first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect(reloadedPrefix).toHaveValue(originalPrefix);
});

// =============================================================================
// 2. Run-code policy — flip the default-mode radio: save → persist → restore.
// =============================================================================

/**
 * The default-mode `RadioGroup` renders two Radix radios. Each radio is wrapped
 * in a `<label>` whose text is the option label + its description, so the radio's
 * accessible name CONTAINS the label (substring match — Playwright's `name`
 * option is substring + case-insensitive unless `exact`). `aria-checked`
 * exposes the selected state.
 */
function denylistRadio(page: Page) {
  return page.getByRole('radio', {
    name: t('governance.runCodePolicy.modeDenylistLabel'),
  });
}
function allowlistRadio(page: Page) {
  return page.getByRole('radio', {
    name: t('governance.runCodePolicy.modeAllowlistLabel'),
  });
}

function runCodeSaveButton(page: Page) {
  return page.getByRole('button', {
    name: t('governance.runCodePolicy.save'),
    exact: true,
  });
}

async function saveRunCodePolicy(page: Page): Promise<void> {
  const save = runCodeSaveButton(page);
  await expect(save).toBeEnabled({ timeout: 20_000 });
  await save.click();
  await expect(
    page.getByText(t('governance.runCodePolicy.saved')).first(),
  ).toBeVisible({ timeout: 20_000 });
}

test('run-code-policy: flips the default mode, persists, and restores', async ({
  page,
}) => {
  const { organizationId } = readRunContext();
  await page.goto(`${GOVERNANCE_BASE(organizationId)}/run-code-policy`);

  // The page title section proves the policy query settled (the radios paint
  // their real state behind a skeleton on cold load).
  await expect(
    page
      .getByRole('heading', { name: t('governance.runCodePolicy.title') })
      .first(),
  ).toBeVisible({ timeout: 60_000 });

  const denylist = denylistRadio(page);
  const allowlist = allowlistRadio(page);
  await expect(denylist).toBeVisible({ timeout: 60_000 });
  await expect(allowlist).toBeVisible({ timeout: 60_000 });
  await expect(denylist).toBeEnabled();

  // Capture which mode is currently selected so we can flip to the OTHER and
  // restore afterward. Default (no saved policy) is denylist.
  const denylistChecked =
    (await denylist.getAttribute('aria-checked')) === 'true';
  const flippedRadio = denylistChecked ? allowlist : denylist;

  // Flip + save.
  await flippedRadio.click();
  await expect(flippedRadio).toHaveAttribute('aria-checked', 'true');
  await saveRunCodePolicy(page);

  // Reload: the flipped mode must come back from the backend, not local state.
  await page.reload();
  const reloadedFlipped = denylistChecked
    ? allowlistRadio(page)
    : denylistRadio(page);
  await expect(reloadedFlipped).toBeVisible({ timeout: 60_000 });
  await expect(reloadedFlipped).toHaveAttribute('aria-checked', 'true', {
    timeout: 20_000,
  });

  // Restore the original mode + save so re-runs (and the suite) start clean.
  const reloadedOriginal = denylistChecked
    ? denylistRadio(page)
    : allowlistRadio(page);
  await reloadedOriginal.click();
  await expect(reloadedOriginal).toHaveAttribute('aria-checked', 'true');
  await saveRunCodePolicy(page);
});

// =============================================================================
// 3. Data-subject-requests — render + open/close the file-request dialog.
//    NOT submitted: filing an Art. 17 erasure against the only org member (the
//    owner) is destructive and not reversible in-app, so this is render-only.
// =============================================================================

test('data-subject-requests: renders and opens the file-request dialog', async ({
  page,
}) => {
  const { organizationId } = readRunContext();
  await page.goto(`${GOVERNANCE_BASE(organizationId)}/data-subject-requests`);

  // The requests-list section heading (the DSAR policy editor sits above it).
  await expect(
    page
      .getByRole('heading', { name: t('governance.dataSubjectRequests.title') })
      .first(),
  ).toBeVisible({ timeout: 60_000 });

  // Open the file-request dialog from the section action button. The action
  // button text ("File request") differs from the dialog heading ("File erasure
  // request"), so the dialog heading is an unambiguous open signal.
  await page
    .getByRole('button', {
      name: t('governance.dataSubjectRequests.actions.fileRequest'),
    })
    .click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(
    dialog.getByRole('heading', {
      name: t('governance.dataSubjectRequests.dialogs.fileRequest.title'),
    }),
  ).toBeVisible();

  // Close WITHOUT submitting — no DSAR record is created (no shared state
  // mutated). The Cancel button lives in the dialog footer.
  await dialog
    .getByRole('button', { name: t('common.actions.cancel'), exact: true })
    .click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
});

// =============================================================================
// 4. Logs — render the audit log table region + exercise the Tabs strip.
//    Read-only: tab switching is navigation, not a mutation. Row presence is
//    not asserted (an empty audit table is a valid state on a fresh backend);
//    we assert the table region + that tabs switch.
// =============================================================================

test('logs: renders the audit log table and switches tabs', async ({
  page,
}) => {
  const { organizationId } = readRunContext();
  await page.goto(`${GOVERNANCE_BASE(organizationId)}/logs`);

  // The Logs section heading (`SettingsSection` <h2>).
  await expect(
    page.getByRole('heading', { name: t('settings.logs.heading') }).first(),
  ).toBeVisible({ timeout: 60_000 });

  // The default "Audit logs" tab is selected; its table region renders (the
  // DataTable carries the audit-logs caption regardless of row count).
  const auditTab = page.getByRole('tab', {
    name: t('settings.logs.auditLogs'),
  });
  await expect(auditTab).toBeVisible({ timeout: 60_000 });
  await expect(auditTab).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.getByRole('table', { name: t('settings.logs.audit.tableCaption') }),
  ).toBeVisible({ timeout: 60_000 });

  // Safe interaction: switch to the Activity logs tab and back. No mutation —
  // tab content is read-only, and switching proves the strip is interactive.
  const activityTab = page.getByRole('tab', {
    name: t('settings.logs.activityLogs'),
  });
  await activityTab.click();
  await expect(activityTab).toHaveAttribute('aria-selected', 'true');
  await expect(auditTab).toHaveAttribute('aria-selected', 'false');

  await auditTab.click();
  await expect(auditTab).toHaveAttribute('aria-selected', 'true');
});

// =============================================================================
// 5. Usage — the analytics page renders its sections/cards/chart.
// =============================================================================

test('usage: renders the analytics summary cards and controls', async ({
  page,
}) => {
  const { organizationId } = readRunContext();
  await page.goto(`${GOVERNANCE_BASE(organizationId)}/usage`);

  // The page heading is an <h3> (analytics pages title with a heading element).
  await expect(
    page.getByRole('heading', { name: t('analytics.usage.title') }).first(),
  ).toBeVisible({ timeout: 60_000 });

  // The period Select control renders once the metrics query settles (it is
  // skeleton-masked while loading), proving the page is past its skeleton.
  await expect(page.getByLabel(t('analytics.usage.period.label'))).toBeVisible({
    timeout: 60_000,
  });

  // Summary cards render their labels (values are masked while loading; the
  // labels are static and present in both states once mounted).
  await expect(
    page.getByText(t('analytics.usage.cards.totalRequests')).first(),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByText(t('analytics.usage.cards.activeUsers')).first(),
  ).toBeVisible();
});

// =============================================================================
// 6. Trash — render the page (table or empty state). Restore is NOT exercised
//    (it mutates the trash pool); render + the column header proves the table.
// =============================================================================

test('trash: renders the page and its table/empty state', async ({ page }) => {
  const { organizationId } = readRunContext();
  await page.goto(`${GOVERNANCE_BASE(organizationId)}/trash`);

  await expect(
    page.getByRole('heading', { name: t('governance.trash.title') }).first(),
  ).toBeVisible({ timeout: 60_000 });

  // The page is past its skeleton when EITHER the loaded-empty notice OR the
  // table header column ("Type") is present. A fresh backend has nothing
  // trashed, so the empty notice is the common case; assert either.
  const emptyNotice = page.getByText(t('governance.trash.empty'));
  const typeColumn = page
    .getByRole('columnheader', { name: t('governance.trash.column.type') })
    .first();
  await expect(emptyNotice.or(typeColumn).first()).toBeVisible({
    timeout: 60_000,
  });
});

// =============================================================================
// 7. Legal hold — render Active holds + open/close the Place-hold dialog.
//    Placing a hold mutates and is NOT exercised; open/close touches no state.
// =============================================================================

test('legal-hold: renders active holds and opens the place-hold dialog', async ({
  page,
}) => {
  const { organizationId } = readRunContext();
  await page.goto(`${GOVERNANCE_BASE(organizationId)}/legal-hold`);

  await expect(
    page
      .getByRole('heading', {
        name: t('governance.legalHold.sections.activeHolds.title'),
      })
      .first(),
  ).toBeVisible({ timeout: 60_000 });

  // Open the Place-hold dialog from the section action button.
  await page
    .getByRole('button', { name: t('governance.legalHold.actions.placeHold') })
    .click();

  // The dialog title equals the trigger label ("Place legal hold"), so assert
  // the dialog ROLE is visible (disambiguates from the button) and close it via
  // the dialog's Close affordance — no hold is placed.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: t('common.aria.close') }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
});

// =============================================================================
// 8. Feedback — the analytics page renders its sections.
// =============================================================================

test('feedback: renders the analytics page', async ({ page }) => {
  const { organizationId } = readRunContext();
  await page.goto(`${GOVERNANCE_BASE(organizationId)}/feedback`);

  // The page heading is an <h3> (analytics pages title with a heading element).
  await expect(
    page.getByRole('heading', { name: t('analytics.feedback.title') }).first(),
  ).toBeVisible({ timeout: 60_000 });
});
