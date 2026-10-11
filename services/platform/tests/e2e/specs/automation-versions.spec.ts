import type { Page } from '@playwright/test';

import { deleteAutomationRow } from '../helpers/automations';
import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Versions over the lane that needs no AI provider: two versions saved and
 * the first deployed through the app API; then the Versions tab deploys the
 * second with one click and Undo puts the first back, a version's row opens
 * what it changed against the one before, and Restore brings the first back
 * as the newest version. The probe is deleted so the worker org leaves the
 * spec as it entered.
 */

const SLUG = 'versions-probe';
const DISPLAY_NAME = 'Versions probe';

/** The probe's document: one transform step returning its code's word. */
const probe = (word: string) => ({
  version: 1,
  name: SLUG,
  nodes: [{ id: 'greet', type: 'transform', code: `return '${word}';` }],
  output: '{{ nodes.greet.output }}',
});

/** A message with its placeholders filled; the e2e `t()` returns the raw
 * ICU string. */
const fill = (key: string, values: Record<string, string | number>): string =>
  Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    t(key),
  );

/** A POST to the app API as the signed-in member; its status. The page
 * must be on the app's origin. */
async function appPost(
  page: Page,
  organizationId: string,
  route: string,
  body: unknown,
): Promise<number> {
  return page.evaluate(
    async (call) => {
      const response = await fetch(
        `/api/app${call.route}?orgId=${encodeURIComponent(call.organizationId)}`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(call.body),
        },
      );
      return response.status;
    },
    { organizationId, route, body },
  );
}

test('deploys a version in one click, undoes it, compares and restores', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  await page.goto(`/dashboard/${organizationId}/automations`);
  expect(
    await appPost(page, organizationId, `/automations/${SLUG}/save`, {
      document: probe('one'),
      message: 'First greeting',
      presentation: { name: DISPLAY_NAME },
      create: true,
    }),
  ).toBe(201);
  expect(
    await appPost(page, organizationId, `/automations/${SLUG}/save`, {
      document: probe('two'),
      message: 'Second greeting',
      baseVersion: 1,
    }),
  ).toBe(201);
  expect(
    await appPost(page, organizationId, `/automations/${SLUG}/deploy`, {
      version: 1,
      expectedDeployedVersion: null,
    }),
  ).toBe(200);

  await page.goto(`/dashboard/${organizationId}/automations/${SLUG}/versions`);
  const liveCard = (version: number) =>
    page.getByRole('heading', {
      name: fill('automations.deployments.live.title', { version }),
    });
  await expect(liveCard(1)).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  // One click deploys v2 against the live v1; Undo puts v1 back.
  await page
    .getByRole('button', {
      name: fill('automations.versions.actions.menu', { version: 2 }),
    })
    .click();
  await page
    .getByRole('menuitem', {
      name: fill('automations.detail.deployVersion', { version: 2 }),
    })
    .click();
  await expect(liveCard(2)).toBeVisible({ timeout: TIMEOUT.PERSIST });
  await page
    .getByRole('button', { name: t('automations.deploy.toast.undo') })
    .first()
    .click();
  await expect(liveCard(1)).toBeVisible({ timeout: TIMEOUT.PERSIST });

  // A version's row opens what it changed against the version before.
  await page
    .getByRole('row')
    .filter({ hasText: 'Second greeting' })
    .first()
    .click();
  await page.waitForURL(
    new RegExp(`/automations/${SLUG}/versions/2(?:[?#]|$)`),
    { timeout: TIMEOUT.NAV },
  );
  await expect(
    page.getByRole('combobox', { name: t('automations.compare.from.label') }),
  ).toContainText(fill('automations.versions.versionLabel', { version: 1 }), {
    timeout: TIMEOUT.VISIBLE,
  });

  // Restore brings v1 back as the newest version, marked as restoring it.
  await page.goto(`/dashboard/${organizationId}/automations/${SLUG}/versions`);
  await page
    .getByRole('button', {
      name: fill('automations.versions.actions.menu', { version: 1 }),
    })
    .click();
  await page
    .getByRole('menuitem', { name: t('automations.versions.actions.restore') })
    .click();
  await page
    .getByRole('dialog', {
      name: fill('automations.restore.title', { version: 1 }),
    })
    .getByRole('button', { name: t('automations.restore.confirm') })
    .click();
  await expect(
    page
      .getByRole('row')
      .filter({
        hasText: fill('automations.versions.restores', { version: 1 }),
      })
      .first(),
  ).toBeVisible({ timeout: TIMEOUT.PERSIST });

  // Cleanup: delete the probe from its list row.
  await page.goto(`/dashboard/${organizationId}/automations`);
  await deleteAutomationRow(
    page,
    page.getByRole('row').filter({ hasText: DISPLAY_NAME }).first(),
  );
});
