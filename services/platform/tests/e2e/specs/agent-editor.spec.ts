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
 * The webhook tab isn't hermetically mutable (real HTTP delivery), so its
 * render-only coverage lives in a component test rather than here.
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
      // The agents table + "Create agent" trigger live on the agents index;
      // the "Blank" menu item opens the create dialog.
      await page.goto(`/dashboard/${workerOrg.organizationId}/agents`);
      await page
        .getByRole('button', { name: t('settings.agents.createAgent') })
        .click();
      await page
        .getByRole('menuitem', { name: t('settings.agents.createMenu.blank') })
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
    // Tabs carry no tab-level heading (the tab strip names the tab) — the
    // description lead-in is the render-complete anchor.
    await expect(
      page.getByText(t('settings.agents.form.sectionInstructionsDescription')),
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

  test('conversation starters: adds a starter, saves, persists', async ({
    page,
    org,
  }) => {
    await openAgentTab(page, org.organizationId, 'conversation-starters');
    // No tab-level heading — anchor on the description lead-in.
    await expect(
      page.getByText(t('settings.agents.conversationStarters.description')),
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
    // No tab-level heading — anchor on the description lead-in.
    await expect(
      page.getByText(t('settings.agents.form.sectionKnowledgeDescription')),
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
    // No tab-level heading — anchor on the description lead-in.
    await expect(
      page.getByText(t('settings.agents.form.sectionToolsDescription')),
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

  // The webhook-tab render-only smoke moved to a component test
  // (agent-webhook-section.test.tsx).
});
