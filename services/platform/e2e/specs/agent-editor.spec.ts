import { expect, test, type Page } from '@playwright/test';

import { t } from '../helpers/i18n';
import { readRunContext } from '../helpers/test-context';

/**
 * Agent editor DEPTH (wave 2) — real edit → save → persistence per tab,
 * complementing `agents.spec.ts` (list / open / create+delete / organigram
 * smokes). Every flow here drives the unified Save cluster
 * (`AgentNavigation` → `EditorActions`) and proves the write survived a full
 * reload (the agent config is filesystem-backed, so a reload re-reads disk).
 *
 * One throwaway agent is created in `beforeAll` and deleted in `afterAll`, so
 * the suite never touches the seeded "E2E Assistant" (depended on by the chat
 * specs). All edits accumulate on that single agent; each test scopes its edit
 * to a distinct field and asserts only that field's persistence, so the serial
 * order (`workers: 1`, `fullyParallel: false`) is safe.
 *
 * Hermetic limits (mock LLM = chat SSE only):
 *  - Instructions, response-tuning, conversation-starters, knowledge mode, and
 *    web-search (a built-in capability) are pure JSON config writes → real
 *    edit+save+reload assertions.
 *  - Tools tab toggles the **web-search** built-in via its i18n'd RadioGroup
 *    rather than the per-tool checkboxes (whose labels are raw, untranslated
 *    tool ids like `pdf`/`customer_read`) — same `tools` tab, fully i18n-driven.
 *  - Webhook (needs real HTTP delivery), delegation (React Flow graph editor),
 *    and metrics (no seeded run data) are NOT hermetically mutable, so those
 *    are RENDER-ONLY: assert the tab's primary section + its main affordance.
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

/**
 * The agent editor renders ONE Save cluster (`EditorActions`) inside the tab
 * navigation. Scope to the visible node and Save is unambiguous; the label
 * lives in a `sr-only sm:not-sr-only` span so its accessible name resolves on
 * the Desktop Chrome viewport.
 */
function saveButton(page: Page) {
  return page
    .getByRole('button', { name: t('common.actions.save'), exact: true })
    .filter({ visible: true })
    .first();
}

/** Navigate straight to a tab of the throwaway agent and wait for its nav. */
async function openAgentTab(
  page: Page,
  organizationId: string,
  subPath: string,
): Promise<void> {
  const base = `/dashboard/${organizationId}/agents/${AGENT_SLUG}`;
  await page.goto(subPath ? `${base}/${subPath}` : base);
  await expect(
    page.getByRole('navigation', { name: t('common.aria.agentsNavigation') }),
  ).toBeVisible({ timeout: 60_000 });
}

/** Click Save, await the success toast, then the cluster goes clean (disabled). */
async function saveAndExpectToast(page: Page): Promise<void> {
  const save = saveButton(page);
  await expect(save).toBeEnabled({ timeout: 20_000 });
  await save.click();
  await expect(
    page.getByText(t('settings.agents.agentSaved')).first(),
  ).toBeVisible({ timeout: 20_000 });
}

test.describe.configure({ mode: 'serial' });

test.describe('agent editor depth', () => {
  test.beforeAll(async ({ browser }) => {
    // Create the throwaway agent once via the create dialog (mirrors the create
    // flow in agents.spec.ts). The seeded mock provider supplies a model, so
    // the form is valid after the two text fields are filled.
    const { organizationId } = readRunContext();
    const page = await browser.newPage();
    try {
      await page.goto(`/dashboard/${organizationId}/agents`);
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
      await expect(continueButton).toBeEnabled({ timeout: 20_000 });
      await continueButton.click();

      // Creation navigates straight to the new agent's editor.
      await page.waitForURL(new RegExp(`/agents/${AGENT_SLUG}(?:[/?#]|$)`), {
        timeout: 60_000,
      });
      await expect(
        page.getByRole('navigation', {
          name: t('common.aria.agentsNavigation'),
        }),
      ).toBeVisible({ timeout: 60_000 });
    } finally {
      await page.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    // Delete the throwaway agent so shared backend state stays clean.
    const { organizationId } = readRunContext();
    const page = await browser.newPage();
    try {
      await page.goto(`/dashboard/${organizationId}/agents`);
      const row = agentRow(page, AGENT_DISPLAY_NAME);
      await expect(row).toBeVisible({ timeout: 60_000 });
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
        timeout: 60_000,
      });
    } finally {
      await page.close();
    }
  });

  test('instructions & model: edits system instructions, saves, persists', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    await openAgentTab(page, organizationId, 'instructions');

    await expect(
      page.getByRole('heading', {
        name: t('settings.agents.form.sectionInstructions'),
        level: 2,
      }),
    ).toBeVisible({ timeout: 60_000 });

    // External <label htmlFor="systemInstructions"> wires the textarea, so
    // getByLabel resolves it. (Created agents start with a default prompt.)
    const instructions = page.getByLabel(
      t('settings.agents.form.systemInstructions'),
    );
    await expect(instructions).toBeVisible({ timeout: 60_000 });

    const newText = `E2E system prompt ${NEW_AGENT_SUFFIX}`;
    await instructions.fill(newText);
    // Blur so the controlled write commits before we read dirty state.
    await instructions.blur();
    await saveAndExpectToast(page);

    // Reload: the value must come back from disk (server migrates it into
    // i18n[defaultLocale].systemInstructions; the tab reads that back).
    await page.reload();
    const reloaded = page.getByLabel(
      t('settings.agents.form.systemInstructions'),
    );
    await expect(reloaded).toHaveValue(newText, { timeout: 20_000 });
  });

  test('response tuning: overrides reasoning effort, saves, persists', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    await openAgentTab(page, organizationId, 'response-tuning');

    await expect(
      page.getByRole('heading', {
        name: t('settings.agents.responseTuning.title'),
        level: 2,
      }),
    ).toBeVisible({ timeout: 60_000 });

    // The overrides live inside a collapsed <details>; expand it so the
    // radios become interactable.
    await page
      .getByText(t('settings.agents.responseTuning.overridesSummary'))
      .click();

    // Scope to the "Reasoning effort" radiogroup — "Medium" also appears in
    // the effort floor/ceiling groups, so the group name disambiguates.
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

    // Reload, re-expand, assert the override stuck.
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
    ).toBeChecked({ timeout: 20_000 });
  });

  test('conversation starters: adds a starter, saves, persists', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    await openAgentTab(page, organizationId, 'conversation-starters');

    await expect(
      page.getByRole('heading', {
        name: t('settings.agents.conversationStarters.title'),
        level: 2,
      }),
    ).toBeVisible({ timeout: 60_000 });

    // The default-locale tab is pre-selected; add an empty slot, fill it, then
    // blur so the value syncs into config (the input has no label — match by
    // its placeholder).
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

    // Reload: the starter persists (server migrates it into
    // i18n[defaultLocale].conversationStarters; the tab reads it back). The
    // inputs carry no label, and Playwright has no `getByDisplayValue`, so read
    // the starter inputs' values directly and assert ours is among them (robust
    // to slot order / an extra empty "add" slot).
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
    }).toPass({ timeout: 20_000 });
  });

  test('knowledge: switches retrieval mode on, saves, persists', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    await openAgentTab(page, organizationId, 'knowledge');

    await expect(
      page.getByRole('heading', {
        name: t('settings.agents.form.sectionKnowledge'),
        level: 2,
      }),
    ).toBeVisible({ timeout: 60_000 });

    // RadioGroup option labels are `<mode> — <description>`; a created agent
    // defaults to "Off". Switch it to "Tool" (no embeddings needed to persist
    // the mode flag itself).
    const toolLabel = `${t('settings.agents.knowledge.modeTool')} — ${t('settings.agents.knowledge.modeToolDescription')}`;
    await page.getByRole('radio', { name: toolLabel, exact: true }).click();
    await saveAndExpectToast(page);

    await page.reload();
    await expect(
      page.getByRole('radio', { name: toolLabel, exact: true }),
    ).toBeChecked({ timeout: 20_000 });
  });

  test('tools: toggles the built-in web-search capability, saves, persists', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    await openAgentTab(page, organizationId, 'tools');

    await expect(
      page.getByRole('heading', {
        name: t('settings.agents.form.sectionTools'),
        level: 2,
      }),
    ).toBeVisible({ timeout: 60_000 });

    // The web-search mode is a built-in capability exposed as a fully-i18n'd
    // RadioGroup (the per-tool checkboxes use raw tool ids, which are not
    // translated UI copy). A created agent defaults to "Off"; switch to "Tool".
    const webToolLabel = `${t('settings.agents.tools.modeTool')} — ${t('settings.agents.tools.webModeToolDescription')}`;
    await page.getByRole('radio', { name: webToolLabel, exact: true }).click();
    await saveAndExpectToast(page);

    await page.reload();
    await expect(
      page.getByRole('radio', { name: webToolLabel, exact: true }),
    ).toBeChecked({ timeout: 20_000 });
  });

  test('webhook tab: renders the section and create affordance (render-only)', async ({
    page,
  }) => {
    // Real webhook delivery isn't hermetic, so assert the tab renders its
    // primary section + the create affordance + the empty state, not a mutate.
    const { organizationId } = readRunContext();
    await openAgentTab(page, organizationId, 'webhook');

    await expect(
      page.getByRole('heading', {
        name: t('settings.agents.webhook.title'),
        level: 2,
      }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByRole('button', {
        name: t('settings.agents.webhook.createButton'),
      }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByText(t('settings.agents.webhook.emptyTitle')).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('delegation tab: renders the organigram editor (render-only)', async ({
    page,
  }) => {
    // Delegation IS the org-chart editor (React Flow); a graph drag/save isn't
    // a hermetic JSON write, so assert the section + the flow canvas chrome.
    const { organizationId } = readRunContext();
    await openAgentTab(page, organizationId, 'delegation');

    await expect(
      page.getByRole('heading', {
        name: t('settings.agents.delegation.title'),
        level: 2,
      }),
    ).toBeVisible({ timeout: 60_000 });
    // The React Flow zoom controls are a stable signal the canvas mounted.
    await expect(
      page.getByRole('button', { name: t('common.flow.resetView') }),
    ).toBeVisible({ timeout: 60_000 });
  });

  test('metrics tab: renders the scorecard (render-only, no run data)', async ({
    page,
  }) => {
    // A freshly-created agent has no runs, so the scorecard shows zeroed KPIs +
    // the "no runs" state. Assert the section renders rather than a mutate.
    const { organizationId } = readRunContext();
    await openAgentTab(page, organizationId, 'metrics');

    await expect(
      page.getByRole('heading', {
        name: t('workforce.scorecard.title'),
        level: 2,
      }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText(t('workforce.scorecard.noRuns')).first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});
