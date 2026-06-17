import type { Locator, Page } from '@playwright/test';

import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { reloadAndSettle } from '../helpers/forms';
import { t } from '../helpers/i18n';

/**
 * Governance mutation + safe-dialog coverage on the worker's isolated org.
 * Each toggle/edit flow flips → saves → reloads → asserts the PERSISTED field
 * (not the transient toast) → restores the original UNCONDITIONALLY so the
 * worker's org stays order-independent across tests and re-runs.
 */

const governanceBase = (organizationId: string) =>
  `/dashboard/${organizationId}/settings/governance`;

/** Radix `Switch` exposes its checked state via `aria-checked`. */
function isChecked(locator: Locator): Promise<boolean> {
  return locator.getAttribute('aria-checked').then((value) => value === 'true');
}

// =============================================================================
// Policies & limits — voice-output autosave toggle.
// =============================================================================

function voiceOutputSwitch(page: Page): Locator {
  return page.getByRole('switch', {
    name: t('governance.voiceOutput.enabledLabel'),
  });
}

/**
 * The voice-output switch autosaves on toggle and surfaces the
 * `voiceOutput.saved` toast (no separate Save button). Wait for that toast as
 * the commit gate BEFORE reloading — the reload otherwise aborts the in-flight
 * save request and the reloaded switch shows the original value.
 */
async function toggleVoiceOutput(page: Page): Promise<void> {
  await voiceOutputSwitch(page).click();
  await expect(
    page.getByText(t('governance.voiceOutput.saved')).first(),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
}

test('voice-output policy: toggles, persists, and restores', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  await page.goto(`${governanceBase(organizationId)}/policies-limits`);

  const toggle = voiceOutputSwitch(page);
  await expect(toggle).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await expect(toggle).toBeEnabled();
  const original = await isChecked(toggle);

  await toggleVoiceOutput(page);
  await expect(toggle).toHaveAttribute('aria-checked', String(!original));

  await reloadAndSettle(page, voiceOutputSwitch(page));
  await expect(voiceOutputSwitch(page)).toHaveAttribute(
    'aria-checked',
    String(!original),
    { timeout: TIMEOUT.PERSIST },
  );

  // Restore unconditionally.
  await toggleVoiceOutput(page);
  await expect(voiceOutputSwitch(page)).toHaveAttribute(
    'aria-checked',
    String(original),
  );
});

// =============================================================================
// Content models — system prompt mandatory-prefix edit.
// =============================================================================

/**
 * The content-models page mounts three editors (system-prompt / default-model /
 * model-access), each with its own "Save"; scope to THIS form so the locator is
 * unambiguous and only the system-prompt save is driven.
 */
function systemPromptSaveButton(page: Page): Locator {
  return page.locator('button[form="governance-system-prompt-form"]');
}

/**
 * The mandatory-prefix field is a `<textarea aria-label="Mandatory prefix">`.
 * Its `FormSection` wrapper is a `role="group"` whose `aria-labelledby` carries
 * the SAME "Mandatory prefix" text, so `getByLabel(...)` matches BOTH the group
 * and the textarea (strict-mode violation). Scope to the `textbox` role — the
 * group is not a textbox — so the locator resolves to exactly the textarea.
 */
function systemPromptPrefixField(page: Page): Locator {
  return page.getByRole('textbox', {
    name: t('governance.systemPrompt.prefixLabel'),
  });
}

async function saveSystemPrompt(page: Page): Promise<void> {
  const save = systemPromptSaveButton(page);
  await expect(save).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
  await save.click();
  await expect(
    page.getByText(t('governance.systemPrompt.saved')).first(),
  ).toBeVisible({ timeout: TIMEOUT.PERSIST });
}

test('system prompt: edits, persists, and restores', async ({ page, org }) => {
  const { organizationId } = org;
  await page.goto(`${governanceBase(organizationId)}/content-models`);

  const prefixField = systemPromptPrefixField(page);
  await expect(prefixField).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await expect(prefixField).toBeEnabled();

  const original = await prefixField.inputValue();
  const marker = `E2E governance prefix ${Date.now().toString(36)}`;
  expect(marker).not.toBe(original);

  // Editing makes the form dirty, which enables the EditorActions Save button.
  await prefixField.fill(marker);
  await saveSystemPrompt(page);

  await reloadAndSettle(page, systemPromptPrefixField(page));
  await expect(systemPromptPrefixField(page)).toHaveValue(marker, {
    timeout: TIMEOUT.PERSIST,
  });

  // Restore unconditionally.
  await systemPromptPrefixField(page).fill(original);
  await saveSystemPrompt(page);
  await expect(systemPromptPrefixField(page)).toHaveValue(original);
});

// =============================================================================
// Run-code policy — flip the default-mode radio.
// =============================================================================

/**
 * The default-mode `RadioGroup` wraps each Radix radio in a `<label>` whose text
 * is the option label + description, so the radio's accessible name CONTAINS the
 * label (substring match). `aria-checked` exposes the selected state.
 */
function denylistRadio(page: Page): Locator {
  return page.getByRole('radio', {
    name: t('governance.runCodePolicy.modeDenylistLabel'),
  });
}
function allowlistRadio(page: Page): Locator {
  return page.getByRole('radio', {
    name: t('governance.runCodePolicy.modeAllowlistLabel'),
  });
}

async function saveRunCodePolicy(page: Page): Promise<void> {
  const save = page.getByRole('button', {
    name: t('governance.runCodePolicy.save'),
    exact: true,
  });
  await expect(save).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
  await save.click();
  await expect(
    page.getByText(t('governance.runCodePolicy.saved')).first(),
  ).toBeVisible({ timeout: TIMEOUT.PERSIST });
}

test('run-code policy: flips the default mode, persists, and restores', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  await page.goto(`${governanceBase(organizationId)}/run-code-policy`);

  const denylist = denylistRadio(page);
  const allowlist = allowlistRadio(page);
  await expect(denylist).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await expect(allowlist).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expect(denylist).toBeEnabled();

  // Capture which mode is selected, flip to the other, restore afterward.
  const denylistChecked = await isChecked(denylist);
  const flipped = denylistChecked ? allowlist : denylist;

  await flipped.click();
  await expect(flipped).toHaveAttribute('aria-checked', 'true');
  await saveRunCodePolicy(page);

  await reloadAndSettle(
    page,
    denylistChecked ? allowlistRadio(page) : denylistRadio(page),
  );
  const reloadedFlipped = denylistChecked
    ? allowlistRadio(page)
    : denylistRadio(page);
  await expect(reloadedFlipped).toHaveAttribute('aria-checked', 'true', {
    timeout: TIMEOUT.PERSIST,
  });

  // Restore unconditionally.
  const reloadedOriginal = denylistChecked
    ? denylistRadio(page)
    : allowlistRadio(page);
  await reloadedOriginal.click();
  await expect(reloadedOriginal).toHaveAttribute('aria-checked', 'true');
  await saveRunCodePolicy(page);
});

// =============================================================================
// Guardrails — content-safety autosave toggle.
// =============================================================================

function contentSafetySwitch(page: Page): Locator {
  return page.getByRole('switch', {
    name: t('governance.contentSafety.enableLabel'),
  });
}

async function toggleContentSafety(page: Page): Promise<void> {
  await contentSafetySwitch(page).click();
  await expect(
    page.getByText(t('governance.contentSafety.saved')).first(),
  ).toBeVisible({ timeout: TIMEOUT.PERSIST });
}

test('guardrails content-safety: toggles, persists, and restores', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  await page.goto(`${governanceBase(organizationId)}/guardrails`);

  const toggle = contentSafetySwitch(page);
  await expect(toggle).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await expect(toggle).toBeEnabled();
  const original = await isChecked(toggle);

  await toggleContentSafety(page);
  await expect(toggle).toHaveAttribute('aria-checked', String(!original));

  await reloadAndSettle(page, contentSafetySwitch(page));
  await expect(contentSafetySwitch(page)).toHaveAttribute(
    'aria-checked',
    String(!original),
    { timeout: TIMEOUT.PERSIST },
  );

  // Restore unconditionally.
  await toggleContentSafety(page);
  await expect(contentSafetySwitch(page)).toHaveAttribute(
    'aria-checked',
    String(original),
  );
});

// =============================================================================
// Safe dialogs/tabs — open/close + read-only navigation, no mutation.
// =============================================================================

test('data-subject-requests: opens and closes the file-request dialog', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  await page.goto(`${governanceBase(organizationId)}/data-subject-requests`);

  await expect(
    page
      .getByRole('heading', { name: t('governance.dataSubjectRequests.title') })
      .first(),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  await page
    .getByRole('button', {
      name: t('governance.dataSubjectRequests.actions.fileRequest'),
    })
    .click();

  // The action label ("File request") differs from the dialog heading ("File
  // erasure request"), so the dialog heading is an unambiguous open signal.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expect(
    dialog.getByRole('heading', {
      name: t('governance.dataSubjectRequests.dialogs.fileRequest.title'),
    }),
  ).toBeVisible();

  // Close without submitting — no DSAR record is created.
  await dialog
    .getByRole('button', { name: t('common.actions.cancel'), exact: true })
    .click();
  await expect(dialog).toBeHidden({ timeout: TIMEOUT.VISIBLE });
});

test('legal-hold: opens and closes the place-hold dialog', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  await page.goto(`${governanceBase(organizationId)}/legal-hold`);

  await expect(
    page
      .getByRole('heading', {
        name: t('governance.legalHold.sections.activeHolds.title'),
      })
      .first(),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  await page
    .getByRole('button', { name: t('governance.legalHold.actions.placeHold') })
    .click();

  // The dialog title equals the trigger label, so assert the dialog ROLE (which
  // disambiguates from the button) and close it without placing a hold.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await dialog.getByRole('button', { name: t('common.aria.close') }).click();
  await expect(dialog).toBeHidden({ timeout: TIMEOUT.VISIBLE });
});

test('logs: renders the audit table and switches tabs', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  await page.goto(`${governanceBase(organizationId)}/logs`);

  await expect(
    page.getByRole('heading', { name: t('settings.logs.heading') }).first(),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  // The default "Audit logs" tab is selected; its table region renders (the
  // DataTable carries the audit-logs caption regardless of row count).
  const auditTab = page.getByRole('tab', {
    name: t('settings.logs.auditLogs'),
  });
  await expect(auditTab).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await expect(auditTab).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.getByRole('table', { name: t('settings.logs.audit.tableCaption') }),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  // Read-only navigation: switch to Activity logs and back.
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
// Usage — the analytics page renders its summary cards, controls, and chart.
// =============================================================================

test('usage: renders the analytics summary cards and controls', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  await page.goto(`${governanceBase(organizationId)}/usage`);

  await expect(
    page.getByRole('heading', { name: t('analytics.usage.title') }).first(),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  // The period Select control renders once the metrics query settles (it is
  // skeleton-masked while loading), proving the page is past its skeleton.
  await expect(page.getByLabel(t('analytics.usage.period.label'))).toBeVisible({
    timeout: TIMEOUT.FIRST_PAINT,
  });

  // Summary cards render their labels (values are masked while loading; the
  // labels are static and present in both states once mounted).
  await expect(
    page.getByText(t('analytics.usage.cards.totalRequests')).first(),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expect(
    page.getByText(t('analytics.usage.cards.activeUsers')).first(),
  ).toBeVisible();
});

// =============================================================================
// Trash — render the page (table or empty state). Restore is NOT exercised
// (it mutates the trash pool); render + the column header proves the table.
// =============================================================================

test('trash: renders the page and its table/empty state', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  await page.goto(`${governanceBase(organizationId)}/trash`);

  await expect(
    page.getByRole('heading', { name: t('governance.trash.title') }).first(),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  // The page is past its skeleton when EITHER the loaded-empty notice OR the
  // table header column ("Type") is present. A fresh backend has nothing
  // trashed, so the empty notice is the common case; assert either.
  const emptyNotice = page.getByText(t('governance.trash.empty'));
  const typeColumn = page
    .getByRole('columnheader', { name: t('governance.trash.column.type') })
    .first();
  await expect(emptyNotice.or(typeColumn).first()).toBeVisible({
    timeout: TIMEOUT.FIRST_PAINT,
  });
});

// =============================================================================
// Feedback — the analytics page renders its sections.
// =============================================================================

test('feedback: renders the analytics page', async ({ page, org }) => {
  const { organizationId } = org;
  await page.goto(`${governanceBase(organizationId)}/feedback`);

  await expect(
    page.getByRole('heading', { name: t('analytics.feedback.title') }).first(),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
});
