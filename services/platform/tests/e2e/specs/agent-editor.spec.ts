import { type Page } from '@playwright/test';

import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { reloadAndSettle } from '../helpers/forms';
import { t } from '../helpers/i18n';

/**
 * Agent editor depth — real edit → save → reload-and-assert per config tab. One
 * throwaway agent is created in beforeAll and deleted in afterAll (so the seeded
 * "E2E Assistant" the chat specs depend on is never touched); edits accumulate
 * on it and each test asserts only its own field, so the serial order is safe.
 *
 * The webhook/delegation/metrics tabs aren't hermetically mutable (real HTTP
 * delivery, a React Flow graph editor, and no seeded run data respectively), so
 * those are RENDER-ONLY: each asserts its tab's primary section + main
 * affordance rather than a write. They read no per-test state, so they're safe
 * in the shared serial order and leave the throwaway agent untouched.
 */

const NEW_AGENT_SUFFIX = Date.now().toString(36);
// The create form's slug must match `/^[a-z0-9][a-z0-9_-]*$/`.
const AGENT_SLUG = `e2e-editor-${NEW_AGENT_SUFFIX}`;
const AGENT_DISPLAY_NAME = `E2E Editor ${NEW_AGENT_SUFFIX}`;

/** The agents list table row carrying the given display name (exact cell). */
function agentRow(page: Page, displayName: string) {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name: displayName, exact: true }),
  });
}

/** The single editor Save cluster; the label is in a `sr-only sm:not-sr-only`
 *  span, so scope to the visible node on the Desktop Chrome viewport. */
function saveButton(page: Page) {
  return page
    .getByRole('button', { name: t('common.actions.save'), exact: true })
    .filter({ visible: true })
    .first();
}

/** Navigate to a tab of the throwaway agent and wait for its nav to settle. */
async function openAgentTab(
  page: Page,
  organizationId: string,
  subPath: string,
): Promise<void> {
  const base = `/dashboard/${organizationId}/agents/${AGENT_SLUG}`;
  await page.goto(subPath ? `${base}/${subPath}` : base);
  await expect(
    page.getByRole('navigation', { name: t('common.aria.agentsNavigation') }),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
}

/** Click Save and await the success toast. The toast is raised only after the
 *  backend write action resolves, so its appearance is the durable-commit gate
 *  that a subsequent reload must wait on. */
async function saveAndExpectToast(page: Page): Promise<void> {
  const save = saveButton(page);
  await expect(save).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
  await save.click();
  await expect(
    page.getByText(t('settings.agents.agentSaved')).first(),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
}

test.describe.configure({ mode: 'serial' });

test.describe('agent editor depth', () => {
  // beforeAll/afterAll run outside the test-scoped `page`, so they open their
  // own page from the worker's authenticated storageState (the same identity
  // every test in this worker uses).
  test.beforeAll(async ({ browser, workerOrg }) => {
    const context = await browser.newContext({
      storageState: workerOrg.storageStatePath,
    });
    const page = await context.newPage();
    try {
      await page.goto(`/dashboard/${workerOrg.organizationId}/agents`);
      await page
        .getByRole('button', { name: t('settings.agents.createAgent') })
        .click();
      await page
        .getByRole('menuitem', { name: t('settings.agents.createAgent') })
        .click();

      await page
        .getByLabel(t('settings.agents.form.name'), { exact: true })
        .fill(AGENT_SLUG);
      await page
        .getByLabel(t('settings.agents.form.displayName'), { exact: true })
        .fill(AGENT_DISPLAY_NAME);

      const continueButton = page.getByRole('button', {
        name: t('settings.agents.createDialog.continue'),
        exact: true,
      });
      await expect(continueButton).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
      await continueButton.click();

      await page.waitForURL(new RegExp(`/agents/${AGENT_SLUG}(?:[/?#]|$)`), {
        timeout: TIMEOUT.NAV,
      });
      await expect(
        page.getByRole('navigation', {
          name: t('common.aria.agentsNavigation'),
        }),
      ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    } finally {
      await context.close();
    }
  });

  test.afterAll(async ({ browser, workerOrg }) => {
    const context = await browser.newContext({
      storageState: workerOrg.storageStatePath,
    });
    const page = await context.newPage();
    try {
      await page.goto(`/dashboard/${workerOrg.organizationId}/agents`);
      const row = agentRow(page, AGENT_DISPLAY_NAME);
      await expect(row).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
      await row
        .getByRole('button', { name: t('common.actions.openMenu') })
        .click();
      await page
        .getByRole('menuitem', {
          name: t('common.actions.delete'),
          exact: true,
        })
        .click();
      await page
        .getByRole('button', {
          name: t('settings.agents.deleteAgent'),
          exact: true,
        })
        .click();
      await expect(agentRow(page, AGENT_DISPLAY_NAME)).toHaveCount(0, {
        timeout: TIMEOUT.PERSIST,
      });
    } finally {
      await context.close();
    }
  });

  test('instructions & model: edits system instructions, saves, persists', async ({
    page,
    org,
  }) => {
    await openAgentTab(page, org.organizationId, 'instructions');
    await expect(
      page.getByRole('heading', {
        name: t('settings.agents.form.sectionInstructions'),
        level: 2,
      }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    const instructions = page.getByLabel(
      t('settings.agents.form.systemInstructions'),
    );
    await expect(instructions).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    const newText = `E2E system prompt ${NEW_AGENT_SUFFIX}`;
    await instructions.fill(newText);
    // Blur so the controlled write commits before reading dirty state.
    await instructions.blur();
    // Confirm the controlled `onChange` round-tripped into the field (and thus
    // into the config) before saving — otherwise Save can be clicked while the
    // editor still reads clean and the edit is silently dropped.
    await expect(instructions).toHaveValue(newText, {
      timeout: TIMEOUT.VISIBLE,
    });
    await saveAndExpectToast(page);

    const reloaded = page.getByLabel(
      t('settings.agents.form.systemInstructions'),
    );
    await reloadAndSettle(page, reloaded);
    await expect(reloaded).toHaveValue(newText, { timeout: TIMEOUT.PERSIST });
  });

  test('response tuning: overrides reasoning effort, saves, persists', async ({
    page,
    org,
  }) => {
    await openAgentTab(page, org.organizationId, 'response-tuning');
    await expect(
      page.getByRole('heading', {
        name: t('settings.agents.responseTuning.title'),
        level: 2,
      }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // The overrides live inside a collapsed <details>; expand it.
    await page
      .getByText(t('settings.agents.responseTuning.overridesSummary'))
      .click();

    // "Medium" also appears in the floor/ceiling groups, so scope to the
    // "Reasoning effort" radiogroup.
    const effortGroup = page.getByRole('radiogroup', {
      name: t('settings.agents.responseTuning.effort'),
    });
    await effortGroup
      .getByRole('radio', {
        name: t('settings.agents.responseTuning.effortMedium'),
        exact: true,
      })
      .click();
    await saveAndExpectToast(page);

    await page.reload();
    await page
      .getByText(t('settings.agents.responseTuning.overridesSummary'))
      .click();
    await expect(
      page
        .getByRole('radiogroup', {
          name: t('settings.agents.responseTuning.effort'),
        })
        .getByRole('radio', {
          name: t('settings.agents.responseTuning.effortMedium'),
          exact: true,
        }),
    ).toBeChecked({ timeout: TIMEOUT.PERSIST });
  });

  test('conversation starters: adds a starter, saves, persists', async ({
    page,
    org,
  }) => {
    await openAgentTab(page, org.organizationId, 'conversation-starters');
    await expect(
      page.getByRole('heading', {
        name: t('settings.agents.conversationStarters.title'),
        level: 2,
      }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // Add an empty slot, fill it, then blur so the value syncs into config (the
    // input has no label — match by placeholder).
    await page
      .getByRole('button', {
        name: t('settings.agents.conversationStarters.add'),
      })
      .click();
    const starterText = `E2E starter ${NEW_AGENT_SUFFIX}`;
    const starterInput = page
      .getByPlaceholder(t('settings.agents.conversationStarters.placeholder'))
      .last();
    await starterInput.fill(starterText);
    await starterInput.blur();
    await saveAndExpectToast(page);

    // The inputs carry no label and Playwright has no getByDisplayValue, so
    // read each starter input's value back and assert ours is among them
    // (robust to slot order / an extra empty "add" slot).
    await page.reload();
    const starterInputs = page.getByPlaceholder(
      t('settings.agents.conversationStarters.placeholder'),
    );
    await expect(async () => {
      const count = await starterInputs.count();
      const values = await Promise.all(
        Array.from({ length: count }, (_, i) =>
          starterInputs.nth(i).inputValue(),
        ),
      );
      expect(values).toContain(starterText);
    }).toPass({ timeout: TIMEOUT.PERSIST });
  });

  test('knowledge: switches retrieval mode on, saves, persists', async ({
    page,
    org,
  }) => {
    await openAgentTab(page, org.organizationId, 'knowledge');
    await expect(
      page.getByRole('heading', {
        name: t('settings.agents.form.sectionKnowledge'),
        level: 2,
      }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // Option labels are `<mode> — <description>`; a created agent defaults to
    // "Off". Switch to "Tool" (the mode flag persists without embeddings).
    const toolLabel = `${t('settings.agents.knowledge.modeTool')} — ${t('settings.agents.knowledge.modeToolDescription')}`;
    await page.getByRole('radio', { name: toolLabel, exact: true }).click();
    await saveAndExpectToast(page);

    await page.reload();
    await expect(
      page.getByRole('radio', { name: toolLabel, exact: true }),
    ).toBeChecked({ timeout: TIMEOUT.PERSIST });
  });

  test('tools: toggles the built-in web-search capability, saves, persists', async ({
    page,
    org,
  }) => {
    await openAgentTab(page, org.organizationId, 'tools');
    await expect(
      page.getByRole('heading', {
        name: t('settings.agents.form.sectionTools'),
        level: 2,
      }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // Web-search is a built-in capability exposed as a fully-i18n'd RadioGroup
    // (per-tool checkboxes use raw, untranslated tool ids). Defaults to "Off".
    const webToolLabel = `${t('settings.agents.tools.modeTool')} — ${t('settings.agents.tools.webModeToolDescription')}`;
    await page.getByRole('radio', { name: webToolLabel, exact: true }).click();
    await saveAndExpectToast(page);

    await page.reload();
    await expect(
      page.getByRole('radio', { name: webToolLabel, exact: true }),
    ).toBeChecked({ timeout: TIMEOUT.PERSIST });
  });

  test('webhook tab: renders the section and create affordance (render-only)', async ({
    page,
    org,
  }) => {
    // Real webhook delivery isn't hermetic, so assert the tab renders its
    // primary section + the create affordance + the empty state, not a mutate.
    await openAgentTab(page, org.organizationId, 'webhook');

    await expect(
      page.getByRole('heading', {
        name: t('settings.agents.webhook.title'),
        level: 2,
      }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(
      page.getByRole('button', {
        name: t('settings.agents.webhook.createButton'),
      }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(
      page.getByText(t('settings.agents.webhook.emptyTitle')).first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  });

  test('delegation tab: renders the organigram editor (render-only)', async ({
    page,
    org,
  }) => {
    // Delegation IS the org-chart editor (React Flow); a graph drag/save isn't
    // a hermetic JSON write, so assert the section + the flow canvas chrome.
    await openAgentTab(page, org.organizationId, 'delegation');

    await expect(
      page.getByRole('heading', {
        name: t('settings.agents.delegation.title'),
        level: 2,
      }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    // The React Flow corner controls' "Reset view" button is a stable signal
    // the canvas mounted.
    await expect(
      page.getByRole('button', { name: t('common.flow.resetView') }),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  });

  test('metrics tab: renders the scorecard (render-only, no run data)', async ({
    page,
    org,
  }) => {
    // A freshly-created agent has no runs, so the scorecard shows zeroed KPIs +
    // the "no runs" state. Assert the section renders rather than a mutate.
    await openAgentTab(page, org.organizationId, 'metrics');

    await expect(
      page.getByRole('heading', {
        name: t('workforce.scorecard.title'),
        level: 2,
      }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(
      page.getByText(t('workforce.scorecard.noRuns')).first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  });
});
