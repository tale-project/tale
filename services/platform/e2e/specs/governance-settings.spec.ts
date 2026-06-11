import { expect, test, type Page } from '@playwright/test';

import { t } from '../helpers/i18n';
import { readRunContext } from '../helpers/test-context';

/**
 * Governance settings save smoke flow: toggle the voice-output policy on the
 * Policies & limits page, assert the save toast, reload to prove persistence,
 * then restore the original value so the spec is idempotent across runs.
 */

function voiceOutputSwitch(page: Page) {
  return page.getByRole('switch', {
    name: t('governance.voiceOutput.enabledLabel'),
  });
}

async function toggleAndAssertSaved(page: Page): Promise<void> {
  await voiceOutputSwitch(page).click();
  await expect(
    page.getByText(t('governance.voiceOutput.saved')).first(),
  ).toBeVisible({ timeout: 20_000 });
}

test('saves and persists a governance policy change', async ({ page }) => {
  const { organizationId } = readRunContext();
  const url = `/dashboard/${organizationId}/settings/governance/policies-limits`;

  await page.goto(url);
  const toggle = voiceOutputSwitch(page);
  await expect(toggle).toBeVisible({ timeout: 60_000 });
  await expect(toggle).toBeEnabled();
  // Radix switch: checked state is exposed via aria-checked.
  const initiallyChecked =
    (await toggle.getAttribute('aria-checked')) === 'true';

  await toggleAndAssertSaved(page);
  await expect(toggle).toHaveAttribute(
    'aria-checked',
    String(!initiallyChecked),
  );

  // Reload: the flipped value must come back from the backend, not local state.
  await page.reload();
  await expect(voiceOutputSwitch(page)).toBeVisible({ timeout: 60_000 });
  await expect(voiceOutputSwitch(page)).toHaveAttribute(
    'aria-checked',
    String(!initiallyChecked),
    { timeout: 20_000 },
  );

  // Restore the original value (keeps re-runs deterministic).
  await toggleAndAssertSaved(page);
  await expect(voiceOutputSwitch(page)).toHaveAttribute(
    'aria-checked',
    String(initiallyChecked),
  );
});
