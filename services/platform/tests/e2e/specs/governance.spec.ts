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

/**
 * The settings shell's single Save button. Every form-backed governance editor
 * registers with the page-level editor group and is committed from this one
 * control (there are no per-section Save buttons any more). It renders twice —
 * a desktop `hidden md:flex` slot and a `md:hidden` mobile bar — so filter to
 * the copy visible on the Desktop Chrome viewport. Autosaving toggles
 * (voice-output, content-safety) never involve it.
 */
function globalSaveButton(page: Page): Locator {
  return page
    .getByRole('button', { name: t('common.actions.save'), exact: true })
    .filter({ visible: true });
}

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
 * The mandatory-instructions field is a `<textarea aria-label="Custom
 * instructions">` (the pre-cutover mandatory prefix/suffix pair merged into
 * this single field). Its `FormSection` wrapper is a `role="group"` whose
 * `aria-labelledby` carries the SAME text, so `getByLabel(...)` matches BOTH
 * the group and the textarea (strict-mode violation). Scope to the `textbox`
 * role — the group is not a textbox — so the locator resolves to exactly the
 * textarea.
 */
function systemPromptInstructionsField(page: Page): Locator {
  return page.getByRole('textbox', {
    name: t('governance.systemPrompt.instructionsLabel'),
  });
}

async function saveSystemPrompt(page: Page): Promise<void> {
  const save = globalSaveButton(page);
  await expect(save).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
  await save.click();
  await expect(
    page.getByText(t('governance.systemPrompt.saved')).first(),
  ).toBeVisible({ timeout: TIMEOUT.PERSIST });
}

test('system prompt: edits, persists, and restores', async ({ page, org }) => {
  const { organizationId } = org;
  await page.goto(`${governanceBase(organizationId)}/content-models`);

  const prefixField = systemPromptInstructionsField(page);
  await expect(prefixField).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await expect(prefixField).toBeEnabled();

  const original = await prefixField.inputValue();
  const marker = `E2E governance instructions ${Date.now().toString(36)}`;
  expect(marker).not.toBe(original);

  // Editing makes the form dirty, which enables the EditorActions Save button.
  await prefixField.fill(marker);
  await saveSystemPrompt(page);

  await reloadAndSettle(page, systemPromptInstructionsField(page));
  await expect(systemPromptInstructionsField(page)).toHaveValue(marker, {
    timeout: TIMEOUT.PERSIST,
  });

  // Restore unconditionally.
  await systemPromptInstructionsField(page).fill(original);
  await saveSystemPrompt(page);
  await expect(systemPromptInstructionsField(page)).toHaveValue(original);
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
  const save = globalSaveButton(page);
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
// Budget rules — per-API-key scope guard.
//
// The apiKey budget scope targets a specific key via `apiKeyId`; saving it with
// no key selected would persist a permanently dead rule, so the editor blocks
// Confirm and surfaces `budgets.targetRequired`. This exercises that guard
// without needing a seeded API key or mutating any persisted config (Confirm
// never succeeds), so there is nothing to restore.
// =============================================================================

test('budget rules: apiKey scope requires a target before saving', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  await page.goto(`${governanceBase(organizationId)}/policies-limits`);

  // Several editors on this page expose an "Add rule" button, so scope to the
  // Budget-rules section (a `SettingsSection` renders a named `region`).
  const budgetsSection = page.getByRole('region', {
    name: t('governance.budgets.title'),
  });
  await expect(budgetsSection).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await budgetsSection
    .getByRole('button', { name: t('governance.budgets.addRule'), exact: true })
    .click();

  const dialog = page.getByRole('dialog', {
    name: t('governance.budgets.addRuleDialogTitle'),
  });
  await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // Scope is a Radix Select (combobox trigger named by its "Scope" label); pick
  // the "API key" option (its label is a static string equal to `budgets.apiKey`).
  await dialog
    .getByRole('combobox', { name: t('governance.budgets.scope') })
    .click();
  await page
    .getByRole('option', { name: t('governance.budgets.apiKey'), exact: true })
    .click();

  // With apiKey scope chosen and no key selected, the target-required error
  // surfaces immediately (the scope field is now "touched").
  await expect(
    dialog.getByText(t('governance.budgets.targetRequired')),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // Confirm is blocked — the dialog stays open and no rule is persisted.
  await dialog
    .getByRole('button', { name: t('governance.budgets.confirm'), exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(t('governance.budgets.targetRequired')),
  ).toBeVisible();

  // Nothing was saved; close the dialog to leave the org untouched.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden({ timeout: TIMEOUT.VISIBLE });
});

// =============================================================================
// Safe dialogs/tabs (DSAR file-request, legal-hold place-hold open/close), the
// read-only Usage/Audit-logs pages, and the Trash + Feedback render checks
// moved to component tests: data-subject-requests/file-request-dialog,
// legal-hold/legal-hold-dialog, settings/audit-logs/audit-logs-page,
// analytics/usage/usage-metrics-page, governance/trash, analytics/feedback
// (*.test.tsx). Only the real save→reload→read persistence flows stay here.
// =============================================================================
