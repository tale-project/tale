import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Automations smoke over the one lane that needs no AI provider: upload a
 * minimal workflow package, decline the deploy offer, open the draft from the
 * list row, prove the detail header's breadcrumb leaf is the entity switcher
 * (the same pattern the project detail carries), then delete the probe so the
 * worker org leaves the spec as it entered.
 */

const PROBE_SLUG = 'switcher-probe';
const PROBE_DISPLAY_NAME = 'Switcher probe';

// The manual plan's deterministic probe pack: one transform node, no
// connectors, valid without any provider or secret.
const PROBE_WORKFLOW_YML = `name: ${PROBE_SLUG}
description: E2E probe — one transform node, no connectors.
nodes:
  - id: greet
    type: transform
    input: { who: 'world' }
    code: 'return { text: "hi " + input.who };'
output:
  text: '{{ nodes.greet.output.text }}'
`;

test('uploads a package and switches automations from the breadcrumb leaf', async ({
  page,
  org,
}) => {
  const { organizationId } = org;

  // The list toolbar's create menu — a dropdown of three lanes.
  await page.goto(`/dashboard/${organizationId}/automations`);
  const createButton = page
    .getByRole('button', { name: t('automations.list.createButton') })
    .first();
  await expect(createButton).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await createButton.click();
  await page
    .getByRole('menuitem', { name: t('automations.upload.trigger') })
    .click();

  // Upload the probe. The drop zone's aria-label duplicates the field label,
  // so target the file input directly rather than by accessible name.
  const uploadDialog = page.getByRole('dialog', {
    name: t('automations.upload.title'),
  });
  await expect(uploadDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await uploadDialog.locator('input[type="file"]').setInputFiles({
    name: 'workflow.yml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(PROBE_WORKFLOW_YML, 'utf8'),
  });
  await uploadDialog
    .getByRole('button', { name: t('automations.upload.submit'), exact: true })
    .click();

  // Saved as a draft — the dialog re-titles itself and offers to deploy;
  // decline so the probe stays a draft.
  const successDialog = page.getByRole('dialog', {
    name: t('automations.upload.successTitle'),
  });
  await expect(successDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await successDialog
    .getByRole('button', { name: t('automations.upload.deployLater') })
    .click();

  // The draft row appears (rows show the display name over the raw slug);
  // clicking it opens the org-level detail — the probe has no project bound.
  const probeRow = page
    .getByRole('row')
    .filter({ hasText: PROBE_DISPLAY_NAME })
    .first();
  await expect(probeRow).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await probeRow.click();
  await page.waitForURL(new RegExp(`/automations/${PROBE_SLUG}(?:[/?#]|$)`), {
    timeout: TIMEOUT.NAV,
  });

  // The breadcrumb leaf is the entity switcher, so the trigger's accessible
  // name carries the current automation. The e2e `t()` returns the raw ICU
  // string, hence the manual {name} substitution. The trail renders twice
  // (desktop strip + mobile slot) — pin the visible copy.
  const switcherLabel = t('automations.switcher.ariaLabel').replace(
    '{name}',
    PROBE_DISPLAY_NAME,
  );
  const breadcrumbs = page.getByRole('navigation', {
    name: t('common.aria.breadcrumb'),
  });
  const switcherTrigger = breadcrumbs
    .getByRole('button', { name: switcherLabel })
    .filter({ visible: true })
    .first();
  await expect(switcherTrigger).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // Opening it lists the org's automations; the probe itself is among them.
  await switcherTrigger.click();
  await expect(
    page.getByRole('option', { name: new RegExp(PROBE_DISPLAY_NAME) }),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await page.keyboard.press('Escape');

  // Cleanup: back to the list via the parent crumb, then delete the probe
  // from the row menu.
  await breadcrumbs
    .getByRole('link', { name: t('automations.title') })
    .filter({ visible: true })
    .first()
    .click();
  await page.waitForURL(/\/automations(?:[/?#]|$)/, { timeout: TIMEOUT.NAV });
  await expect(probeRow).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await probeRow
    .getByRole('button', { name: t('common.actions.openMenu') })
    .click();
  await page
    .getByRole('menuitem', { name: t('common.actions.delete') })
    .click();
  const deleteDialog = page.getByRole('dialog', {
    name: t('automations.detail.delete.title'),
  });
  await expect(deleteDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await deleteDialog
    .getByRole('button', { name: t('common.actions.delete'), exact: true })
    .click();
  await expect(probeRow).not.toBeVisible({ timeout: TIMEOUT.VISIBLE });
});
