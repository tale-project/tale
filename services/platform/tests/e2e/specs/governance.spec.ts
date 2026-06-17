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
// Safe dialogs/tabs (DSAR file-request, legal-hold place-hold open/close), the
// read-only Usage/Audit-logs pages, and the Trash + Feedback render checks
// moved to component tests: data-subject-requests/file-request-dialog,
// legal-hold/legal-hold-dialog, settings/audit-logs/audit-logs-page,
// analytics/usage/usage-metrics-page, governance/trash, analytics/feedback
// (*.test.tsx). Only the real save→reload→read persistence flows stay here.
// =============================================================================
