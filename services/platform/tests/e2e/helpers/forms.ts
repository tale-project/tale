import { expect, type Locator, type Page } from '@playwright/test';

import { TIMEOUT } from './env';

/**
 * Save→reload→assert helper. The old depth specs reloaded and immediately
 * asserted a field, which raced the post-reload skeleton (false pass) or the
 * backend commit (false fail), and they keyed success off the transient success
 * toast. The discipline now: reload, wait for a STABLE anchor to settle, then
 * assert the persisted FIELD value (Playwright's web-first `toHaveValue` /
 * `toBeChecked` retry, so no toast dependence). Restores must be unconditional
 * (always write the original value back) so re-runs are idempotent.
 */
export async function reloadAndSettle(
  page: Page,
  anchor: Locator,
): Promise<void> {
  await page.reload();
  await expect(anchor).toBeVisible({ timeout: TIMEOUT.NAV });
}

/**
 * Match a form control by the START of its label.
 *
 * The shared `Input` folds its required marker into the control's accessible
 * name, so a required "Name" field is announced as `Namerequired`. That breaks
 * both obvious locators: `getByLabel('Name', { exact: true })` never matches,
 * and a loose `getByLabel('Name')` is ambiguous the moment the same form also
 * has a "Display name". Anchoring the label is the only form that survives both.
 *
 * Pass the label through `t()` — never a hardcoded English literal.
 */
export function labelStart(label: string): RegExp {
  const escaped = label.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(`^${escaped}`);
}
