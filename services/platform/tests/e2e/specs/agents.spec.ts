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
  // The agents table lives on the "All agents" tab; `/agents` is the organigram
  // Overview landing.
  await page.goto(`/dashboard/${organizationId}/agents/all`);

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
    'settings.agents.navigation.delegation',
    'settings.agents.navigation.responseTuning',
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

  await page.goto(`/dashboard/${organizationId}/agents/all`);
  await expect(agentRow(page, SEEDED_AGENT_DISPLAY_NAME)).toBeVisible({
    timeout: TIMEOUT.FIRST_PAINT,
  });

  // "Create agent" is a dropdown trigger whose menu item opens the dialog.
  await page
    .getByRole('button', { name: t('settings.agents.createAgent') })
    .click();
  await page
    .getByRole('menuitem', { name: t('settings.agents.createAgent') })
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
  await page.goto(`/dashboard/${organizationId}/agents/all`);
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

test('renders the organigram delegation graph', async ({ page, org }) => {
  const { organizationId } = org;
  // The organigram is the Overview tab (`/agents/overview`); `/agents` itself
  // now lands on the List tab (`/agents/all`), so deep-link to Overview.
  await page.goto(`/dashboard/${organizationId}/agents/overview`);

  // The agents layout owns the level-1 heading ("Agents"); the organigram's own
  // title is the level-2 section heading beneath it, so pin to level 2 (`exact`
  // keeps the match off the layout's "Agents" h1).
  await expect(
    page.getByRole('heading', {
      name: t('organigram.title'),
      level: 2,
      exact: true,
    }),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  // The React Flow canvas chrome always renders inside FlowCanvas — the zoom
  // controls are a stable, non-empty-state signal that the graph (not the
  // "no agents" empty state) mounted.
  await expect(
    page.getByRole('button', { name: t('common.flow.resetView') }),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // The seeded agent shows up as a node card (AgentOrgNode renders its display
  // name as an <h3>), proving the agents/delegation graph populated.
  await expect(
    page
      .getByRole('heading', { name: SEEDED_AGENT_DISPLAY_NAME, level: 3 })
      .first(),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
});
