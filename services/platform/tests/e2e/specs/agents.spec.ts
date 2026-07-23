import { type Page } from '@playwright/test';

import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { t } from '../helpers/i18n';
import { SEEDED_AGENT_DISPLAY_NAME } from '../helpers/seed';

/**
 * Agents smoke: the seeded agent lists and opens into its tab editor, and a
 * custom agent round-trips create → delete. No chat turn, so both modes run.
 */

/** The agents list table row carrying the given display name (exact cell). */
function agentRow(page: Page, displayName: string) {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name: displayName, exact: true }),
  });
}

test('lists the seeded agent and opens its editor tab navigation', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  // The agents roster renders directly on the index route.
  await page.goto(`/dashboard/${organizationId}/agents`);

  // The list loads via a filesystem-backed action behind a textless skeleton,
  // so wait for the seeded row to materialize.
  const row = agentRow(page, SEEDED_AGENT_DISPLAY_NAME);
  await expect(row).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  // Rows navigate to the agent editor on click (AgentsTable#handleRowClick).
  await row.click();
  await page.waitForURL(/\/agents\/[^/]+(?:[/?#]|$)/, { timeout: TIMEOUT.NAV });

  // The editor sub-navigation is a labelled <nav> of tab links; assert each
  // real tab renders.
  const tabNav = page.getByRole('navigation', {
    name: t('common.aria.agentsNavigation'),
  });
  await expect(tabNav).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  for (const tabKey of [
    'settings.agents.navigation.general',
    'settings.agents.navigation.instructionsModel',
    'settings.agents.navigation.tools',
    'settings.agents.navigation.skills',
    'settings.agents.navigation.knowledge',
    'settings.agents.navigation.conversationStarters',
    'settings.agents.navigation.webhook',
  ]) {
    await expect(
      tabNav.getByRole('link', { name: t(tabKey), exact: true }),
    ).toBeVisible();
  }
});

test('creates a custom agent then deletes it', async ({ page, org }) => {
  const { organizationId } = org;
  // The slug must match the create form's `/^[a-z0-9][a-z0-9_-]*$/` pattern.
  const suffix = Date.now().toString(36);
  const agentSlug = `e2e-agent-${suffix}`;
  const agentDisplayName = `E2E Agent ${suffix}`;

  await page.goto(`/dashboard/${organizationId}/agents`);
  await expect(agentRow(page, SEEDED_AGENT_DISPLAY_NAME)).toBeVisible({
    timeout: TIMEOUT.FIRST_PAINT,
  });

  // "Create agent" is a dropdown trigger; its "Blank" item opens the create
  // dialog (sibling: "Upload file").
  await page
    .getByRole('button', { name: t('settings.agents.createAgent') })
    .click();
  await page
    .getByRole('menuitem', { name: t('settings.agents.createMenu.blank') })
    .click();

  // The seeded mock provider supplies a model the dialog pre-selects, so
  // Continue enables once the two text fields are filled. "Name" is exact —
  // "Display name" also contains "Name".
  await page
    .getByLabel(t('settings.agents.form.name'), { exact: true })
    .fill(agentSlug);
  await page
    .getByLabel(t('settings.agents.form.displayName'), { exact: true })
    .fill(agentDisplayName);

  const continueButton = page.getByRole('button', {
    name: t('settings.agents.createDialog.continue'),
    exact: true,
  });
  await expect(continueButton).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
  await continueButton.click();

  // Creation navigates straight to the new agent's editor.
  await page.waitForURL(new RegExp(`/agents/${agentSlug}(?:[/?#]|$)`), {
    timeout: TIMEOUT.NAV,
  });
  await expect(
    page.getByRole('navigation', { name: t('common.aria.agentsNavigation') }),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // Back to the list and delete it via the per-row 3-dot menu.
  await page.goto(`/dashboard/${organizationId}/agents`);
  const newRow = agentRow(page, agentDisplayName);
  await expect(newRow).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await newRow
    .getByRole('button', { name: t('common.actions.openMenu') })
    .click();
  await page
    .getByRole('menuitem', { name: t('common.actions.delete'), exact: true })
    .click();
  await page
    .getByRole('button', {
      name: t('settings.agents.deleteAgent'),
      exact: true,
    })
    .click();

  await expect(agentRow(page, agentDisplayName)).toHaveCount(0, {
    timeout: TIMEOUT.PERSIST,
  });
});
