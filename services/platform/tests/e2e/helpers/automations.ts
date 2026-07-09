import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type Locator, type Page } from '@playwright/test';

import { TIMEOUT } from './env';
import { t } from './i18n';

/**
 * Helpers for Automations / installed-automation specs
 * (`automations.spec.ts`, `email-automation.spec.ts`).
 *
 * Automation copy lives in TWO places, and the specs must read each from its
 * source:
 *
 * - Platform chrome (hub heading, Install/Uninstall, wizard buttons) is
 *   platform i18n — resolve through `t('automations.…')` as everywhere else.
 *   (The org-level Inbox the email automations gate is platform i18n too,
 *   under `conversations.*`.)
 * - Automation names come from each bundle's `automation.json` manifest
 *   (internal identifiers keep the `automation` spelling). The fixture bundles under
 *   `fixtures/config/default/automations/` are what the hermetic stack
 *   scaffolds into every worker org, and a vitest drift guard
 *   (`convex/automations/fixture_bundle_drift.test.ts`) pins them byte-identical to
 *   `builtin-configs/automations/`, so reading them here asserts the shipped copy.
 */

const dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_AUTOMATIONS_DIR = path.join(
  dirname,
  '..',
  'fixtures',
  'config',
  'default',
  'automations',
);

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

/** The automation's display name, from the fixture bundle's `automation.json` manifest. */
export function automationName(automationSlug: string): string {
  const manifest = readJson(
    path.join(FIXTURE_AUTOMATIONS_DIR, automationSlug, 'automation.json'),
  );
  const name = manifest['name'];
  if (typeof name !== 'string' || name === '') {
    throw new Error(`Fixture bundle "${automationSlug}" has no manifest name`);
  }
  return name;
}

/** The install wizard dialog for `name` ("Set up {name}"). */
export function installWizardDialog(page: Page, name: string): Locator {
  return page.getByRole('dialog', {
    name: t('automations.installWizard.title').replace('{name}', name),
  });
}

/**
 * Walk the install wizard to completion: **Next** through required steps (the
 * Install step's Next performs the install), **I'll do this later** through
 * optional connect steps, then **Finish**. Step count varies with org state
 * (already-connected integrations drop their step), so this advances by
 * whichever footer action the current step offers instead of scripting a
 * fixed sequence. An early dialog close is treated as completion — the
 * install itself runs on the Install step's Next, and setup continues from
 * the automation page's readiness checklist.
 */
/**
 * On the project-scoped install wizard's Project step, pick `projectName` in
 * the SearchableSelect. The trigger shows the placeholder until a value is
 * chosen; the listbox is labelled with `install.projectLabel`.
 */
export async function selectInstallWizardProject(
  wizard: Locator,
  projectName: string,
): Promise<void> {
  const trigger = wizard.getByRole('button').filter({
    hasText: new RegExp(
      `${t('automations.install.projectPlaceholder')}|${projectName}`,
    ),
  });
  await expect(trigger.first()).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  // Already selected — nothing to do.
  if (await trigger.filter({ hasText: projectName }).count()) return;
  await trigger.first().click();
  const listbox = wizard.page().getByRole('listbox', {
    name: t('automations.install.projectLabel'),
  });
  await expect(listbox).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await listbox.getByRole('option', { name: projectName, exact: true }).click();
  await expect(
    wizard.getByRole('button').filter({ hasText: projectName }),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
}

export async function walkInstallWizard(
  wizard: Locator,
  options?: { projectName?: string },
): Promise<void> {
  const finish = wizard.getByRole('button', {
    name: t('automations.installWizard.finish'),
  });
  const skip = wizard.getByRole('button', {
    name: t('automations.installWizard.skipForNow'),
  });
  const next = wizard.getByRole('button', { name: t('common.actions.next') });

  if (options?.projectName) {
    // Project step gates Next until a project is selected.
    await selectInstallWizardProject(wizard, options.projectName);
  }

  // A wizard has strictly fewer steps than this bound; bail out rather than
  // loop forever if the dialog wedges.
  for (let step = 0; step < 10; step++) {
    // Wait until the wizard closed or offers an enabled footer action.
    // verify-live: footer availability while the Install step's async
    // install runs (the Next click resolves only after the install lands).
    await expect
      .poll(
        async () => {
          if (!(await wizard.isVisible())) return 'closed';
          if (await finish.isVisible()) return 'finish';
          if (await skip.isVisible()) return 'skip';
          if ((await next.isVisible()) && (await next.isEnabled())) {
            return 'next';
          }
          return null;
        },
        { timeout: TIMEOUT.EXECUTION },
      )
      .not.toBeNull();

    if (!(await wizard.isVisible())) return;
    if (await finish.isVisible()) {
      await finish.click();
      await expect(wizard).not.toBeVisible({ timeout: TIMEOUT.VISIBLE });
      return;
    }
    if (await skip.isVisible()) {
      await skip.click();
    } else {
      // Project step may still be showing with Next disabled until selection.
      if (
        options?.projectName &&
        (await next.isVisible()) &&
        !(await next.isEnabled())
      ) {
        await selectInstallWizardProject(wizard, options.projectName);
      }
      await next.click();
    }
  }
  throw new Error('Install wizard did not reach its Finish step');
}

/** The lifecycle ⋯ menu trigger for an installed automation ("Manage {name}"). */
function lifecycleMenuTrigger(scope: Locator | Page, name: string): Locator {
  return scope.getByRole('button', {
    name: t('automations.install.menuLabel').replace('{name}', name),
  });
}

/**
 * The hub card titled `name`. The whole card IS a button (Card `asChild`
 * hoists the bordered surface onto it, `aria-label` = the automation name);
 * the ⋯ menu is a positioned SIBLING outside it — locate that via
 * {@link lifecycleMenuTrigger} on the page, never as a card descendant.
 */
function automationCard(page: Page, name: string): Locator {
  return page.getByRole('button', { name, exact: true });
}

/**
 * Open the hub on its All tab (the full catalog union). The hub lands on the
 * Installed tab, where a not-installed automation's card is absent — every
 * flow that must see a card through an install-state flip drives All.
 *
 * The Installed/All switch lives in the page header's shared `TabNavigation`
 * (like Knowledge's), so it renders as a real LINK to `?tab=all` — not a
 * `role="tab"` pill.
 */
export async function gotoAutomationsHubAllTab(
  page: Page,
  organizationId: string,
): Promise<void> {
  await page.goto(`/dashboard/${organizationId}/automations`);
  const allTab = page.getByRole('link', { name: t('automations.tabs.all') });
  await expect(allTab).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await allTab.click();
  await page.waitForURL(/[?&]tab=all/, { timeout: TIMEOUT.FIRST_PAINT });
}

/**
 * Uninstall an org-scoped automation through the hub card's lifecycle menu,
 * if it is
 * installed. Idempotent by design: retried tests and re-runs against the same
 * worker org start from whatever state the previous attempt left, so install
 * flows call this first (and again as cleanup) to converge on "not installed".
 */
export async function uninstallOrgAutomationIfInstalled(
  page: Page,
  organizationId: string,
  name: string,
): Promise<void> {
  // All tab: the card must stay visible when the install row disappears.
  await gotoAutomationsHubAllTab(page, organizationId);
  const card = automationCard(page, name);
  await expect(card).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  // Installed and not-installed cards BOTH carry a "Manage {name}" ⋯ menu
  // (lifecycle vs quick-install) — which menu item renders is the install
  // signal, so open it to find out. `exact` matters: "Install" is a
  // substring of "Uninstall".
  const menu = lifecycleMenuTrigger(page, name);
  await menu.click();
  const uninstallItem = page.getByRole('menuitem', {
    name: t('automations.install.uninstall'),
    exact: true,
  });
  const installItem = page.getByRole('menuitem', {
    name: t('automations.install.install'),
    exact: true,
  });
  await expect(uninstallItem.or(installItem).first()).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });
  if (!(await uninstallItem.isVisible())) {
    await page.keyboard.press('Escape'); // not installed — nothing to do
    return;
  }
  await uninstallItem.click();
  const confirm = page.getByRole('dialog', {
    name: t('automations.install.uninstallTitle'),
  });
  await confirm
    .getByRole('button', { name: t('automations.install.uninstall') })
    .click();
  // Uninstall tears down files + the install row; the card's install-state
  // badge unmounting is the flip back to installable (a not-installed card
  // reserves its badge slot empty — the ⋯ Install action is the affordance).
  for (const badgeText of [
    t('automations.install.installed'),
    t('automations.install.setup'),
    t('automations.install.reinstall'),
  ]) {
    await expect(card.getByText(badgeText, { exact: true })).toBeHidden({
      timeout: TIMEOUT.EXECUTION,
    });
  }
}
