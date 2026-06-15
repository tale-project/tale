import { expect, test, type Page } from '@playwright/test';

import { t } from '../helpers/i18n';
import { readRunContext } from '../helpers/test-context';

/**
 * Agents feature smoke flows against the seeded org (one agent "E2E Assistant",
 * one chat-only provider "E2E Mock Provider"):
 *
 *  1. List — the agents table loads and shows the seeded agent.
 *  2. Editor — opening the seeded agent renders its tab sub-navigation.
 *  3. Create + delete — a uniquely-named custom agent is created through the
 *     create dialog (the mock provider supplies a model so the form is valid),
 *     lands on its editor, then is deleted from the list to keep state clean.
 *  4. Organigram — the delegation graph renders with the seeded agent's node.
 *
 * None of these need a live LLM (no chat turn), so they run in both modes.
 *
 * The seeded agent's DISPLAY NAME, defined in
 * `fixtures/config/default/agents/chat-agent.json`. Not translated UI copy —
 * this is rename-safety, so it stays a single literal rather than going through
 * `t()` (mirrors `automation.spec.ts`'s `WORKFLOW_NAME`).
 */
const SEEDED_AGENT_DISPLAY_NAME = 'E2E Assistant';

/** The agents list table row carrying the given display name (exact cell). */
function agentRow(page: Page, displayName: string) {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name: displayName, exact: true }),
  });
}

test('lists the seeded agent on the agents page', async ({ page }) => {
  const { organizationId } = readRunContext();

  await page.goto(`/dashboard/${organizationId}/agents`);

  // The list loads via a filesystem-backed Convex action behind a skeleton
  // (whose rows carry no text), so wait for the seeded row to materialize.
  await expect(agentRow(page, SEEDED_AGENT_DISPLAY_NAME)).toBeVisible({
    timeout: 60_000,
  });
});

test('opens the seeded agent editor and renders its tab navigation', async ({
  page,
}) => {
  const { organizationId } = readRunContext();

  await page.goto(`/dashboard/${organizationId}/agents`);
  const row = agentRow(page, SEEDED_AGENT_DISPLAY_NAME);
  await expect(row).toBeVisible({ timeout: 60_000 });

  // Rows navigate to the agent editor on click (AgentsTable#handleRowClick).
  await row.click();
  await page.waitForURL(/\/agents\/[^/]+(?:[/?#]|$)/, { timeout: 60_000 });

  // The editor's sub-navigation is a labelled <nav> of tab links
  // (AgentNavigation → TabNavigation). Assert the real tabs render.
  const tabNav = page.getByRole('navigation', {
    name: t('common.aria.agentsNavigation'),
  });
  await expect(tabNav).toBeVisible({ timeout: 60_000 });

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

test('creates a custom agent then deletes it', async ({ page }) => {
  const { organizationId } = readRunContext();

  // Unique per-run identity so re-runs never collide with existing agents.
  // The slug must match the create form's `/^[a-z0-9][a-z0-9_-]*$/` pattern.
  const suffix = Date.now().toString(36);
  const agentSlug = `e2e-agent-${suffix}`;
  const agentDisplayName = `E2E Agent ${suffix}`;

  await page.goto(`/dashboard/${organizationId}/agents`);
  // Wait for the list to settle (seeded row present) before opening the menu.
  await expect(agentRow(page, SEEDED_AGENT_DISPLAY_NAME)).toBeVisible({
    timeout: 60_000,
  });

  // "Create agent" is a dropdown trigger (AgentsActionMenu → DataTableActionMenu);
  // opening it surfaces the "Create agent" menu item that opens the dialog.
  await page
    .getByRole('button', { name: t('settings.agents.createAgent') })
    .click();
  await page
    .getByRole('menuitem', { name: t('settings.agents.createAgent') })
    .click();

  // Create dialog: name (slug), display name. The seeded mock provider supplies
  // a model, which the dialog pre-selects, so "Continue" enables once the two
  // required text fields are filled. "Name" is exact — "Display name" also
  // contains "Name".
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
  await expect(continueButton).toBeEnabled({ timeout: 20_000 });
  await continueButton.click();

  // Creation navigates straight to the new agent's editor (CreateAgentDialog's
  // default onCreated → navigate to /agents/$agentId).
  await page.waitForURL(new RegExp(`/agents/${agentSlug}(?:[/?#]|$)`), {
    timeout: 60_000,
  });
  await expect(
    page.getByRole('navigation', {
      name: t('common.aria.agentsNavigation'),
    }),
  ).toBeVisible({ timeout: 60_000 });

  // Back to the list and delete the agent this test just created (exercises the
  // delete affordance + keeps shared state clean).
  await page.goto(`/dashboard/${organizationId}/agents`);
  const newRow = agentRow(page, agentDisplayName);
  await expect(newRow).toBeVisible({ timeout: 60_000 });

  // Per-row 3-dot menu (EntityRowActions) → destructive "Delete" item.
  await newRow
    .getByRole('button', { name: t('common.actions.openMenu') })
    .click();
  await page
    .getByRole('menuitem', { name: t('common.actions.delete'), exact: true })
    .click();

  // DeleteDialog confirm button (its label is the "Delete agent" string; the
  // dialog title shares that text but is a heading, so the button is unique).
  await page
    .getByRole('button', {
      name: t('settings.agents.deleteAgent'),
      exact: true,
    })
    .click();

  // The row is gone once the delete + list invalidation settle.
  await expect(agentRow(page, agentDisplayName)).toHaveCount(0, {
    timeout: 60_000,
  });
});

test('renders the organigram delegation graph', async ({ page }) => {
  const { organizationId } = readRunContext();

  await page.goto(`/dashboard/${organizationId}/agents/organigram`);

  // Page title block (organigram route). `exact` — the app-shell breadcrumb
  // renders its own level-1 heading ("Agents Organigram"), so a substring match
  // on "Organigram" is ambiguous (strict-mode violation).
  await expect(
    page.getByRole('heading', {
      name: t('organigram.title'),
      level: 1,
      exact: true,
    }),
  ).toBeVisible({ timeout: 60_000 });

  // The React Flow canvas chrome always renders inside FlowCanvas — the zoom
  // controls are a stable, non-empty-state signal that the graph (not the
  // "no agents" empty state) mounted.
  await expect(
    page.getByRole('button', { name: t('common.flow.resetView') }),
  ).toBeVisible({ timeout: 60_000 });

  // The seeded agent shows up as a node card (AgentOrgNode renders its display
  // name as an <h3>), proving the agents/delegation graph populated.
  await expect(
    page
      .getByRole('heading', { name: SEEDED_AGENT_DISPLAY_NAME, level: 3 })
      .first(),
  ).toBeVisible({ timeout: 60_000 });
});
