import { type Page } from '@playwright/test';

import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { reloadAndSettle } from '../helpers/forms';
import { t } from '../helpers/i18n';

/**
 * External agent editor — switch to External + Cursor runtime, configure BYO
 * runtime models, and surface the agent in chat with a runtime model picker.
 * One throwaway agent per worker; serial so each test builds on the last.
 */

const NEW_AGENT_SUFFIX = Date.now().toString(36);
const AGENT_SLUG = `e2e-external-${NEW_AGENT_SUFFIX}`;
const AGENT_DISPLAY_NAME = `E2E External ${NEW_AGENT_SUFFIX}`;
const PRIMARY_RUNTIME_MODEL = 'auto';
const FALLBACK_RUNTIME_MODEL = 'composer-2.5';

function saveButton(page: Page) {
  return page
    .getByRole('button', { name: t('common.actions.save'), exact: true })
    .filter({ visible: true })
    .first();
}

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

async function saveAndExpectToast(page: Page): Promise<void> {
  const save = saveButton(page);
  await expect(save).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
  await save.click();
  await expect(
    page.getByText(t('settings.agents.agentSaved')).first(),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
}

async function confirmAgentTypeSwitch(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog').filter({
    has: page.getByText(t('settings.agents.form.agentType.switchTitle'), {
      exact: true,
    }),
  });
  await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await dialog
    .getByRole('button', {
      name: t('settings.agents.form.agentType.switchConfirm'),
      exact: true,
    })
    .click();
  await expect(dialog).toBeHidden({ timeout: TIMEOUT.VISIBLE });
}

test.describe.configure({ mode: 'serial' });

test.describe('external agent (Cursor)', () => {
  test.beforeAll(async ({ browser, workerOrg }) => {
    const context = await browser.newContext({
      storageState: workerOrg.storageStatePath,
    });
    const page = await context.newPage();
    try {
      await page.goto(`/dashboard/${workerOrg.organizationId}/agents/all`);
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
      await page.goto(`/dashboard/${workerOrg.organizationId}/agents/all`);
      const row = page.getByRole('row').filter({
        has: page.getByRole('cell', { name: AGENT_DISPLAY_NAME, exact: true }),
      });
      if (await row.isVisible().catch(() => false)) {
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
        await expect(row).toHaveCount(0, { timeout: TIMEOUT.PERSIST });
      }
    } finally {
      await context.close();
    }
  });

  test('switches to External + Cursor runtime and persists after reload', async ({
    page,
    org,
  }) => {
    await openAgentTab(page, org.organizationId, '');

    await page
      .getByRole('radio', {
        name: t('settings.agents.form.agentType.externalLabel'),
      })
      .click();
    await confirmAgentTypeSwitch(page);

    const runtimeSelect = page.getByRole('combobox', {
      name: t('settings.agents.form.agentKind.label'),
    });
    await expect(runtimeSelect).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await runtimeSelect.click();
    await page
      .getByRole('option', {
        name: t('settings.agents.form.agentKind.cursor'),
        exact: true,
      })
      .click();

    await saveAndExpectToast(page);
    await reloadAndSettle(
      page,
      page.getByRole('navigation', {
        name: t('common.aria.agentsNavigation'),
      }),
    );

    await expect(
      page.getByRole('radio', {
        name: t('settings.agents.form.agentType.externalLabel'),
      }),
    ).toBeChecked({ timeout: TIMEOUT.VISIBLE });
    await expect(runtimeSelect).toContainText(
      t('settings.agents.form.agentKind.cursor'),
    );
  });

  test('instructions tab shows runtime model editor for Cursor (no managed auth picker)', async ({
    page,
    org,
  }) => {
    await openAgentTab(page, org.organizationId, 'instructions');

    await expect(
      page.getByRole('radio', {
        name: t('settings.agents.form.byo.managedLabel'),
      }),
    ).toHaveCount(0);

    const modelInput = page.getByLabel(
      t('settings.agents.form.byo.modelLabel'),
      { exact: true },
    );
    await expect(modelInput).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(
      page.getByText(t('settings.agents.form.byo.modelNote')),
    ).toBeVisible();

    await modelInput.fill(PRIMARY_RUNTIME_MODEL);
    await page
      .getByRole('button', {
        name: t('settings.agents.form.addModel'),
        exact: true,
      })
      .click();
    await expect(page.getByText(PRIMARY_RUNTIME_MODEL)).toBeVisible();

    await modelInput.fill(FALLBACK_RUNTIME_MODEL);
    await page
      .getByRole('button', {
        name: t('settings.agents.form.addModel'),
        exact: true,
      })
      .click();
    await expect(page.getByText(FALLBACK_RUNTIME_MODEL)).toBeVisible();

    await saveAndExpectToast(page);
    await reloadAndSettle(
      page,
      page.getByLabel(t('settings.agents.form.byo.modelLabel'), {
        exact: true,
      }),
    );

    await expect(page.getByText(PRIMARY_RUNTIME_MODEL)).toBeVisible({
      timeout: TIMEOUT.VISIBLE,
    });
    await expect(page.getByText(FALLBACK_RUNTIME_MODEL)).toBeVisible();
  });

  test('chat picker lists the Cursor agent with a runtime model selector', async ({
    page,
    org,
  }) => {
    await openAgentTab(page, org.organizationId, '');

    // The agent is created visible in chat (the create dialog sets
    // `visibleInChat`), so the switch settles checked once the loaded config
    // hydrates. Assert that state — it waits out hydration and confirms the
    // chat-picker precondition — rather than toggling and clicking Save on a
    // pristine form, where Save stays disabled and the click times out.
    await expect(
      page.getByRole('switch', {
        name: t('settings.agents.general.visibleInChat'),
      }),
    ).toBeChecked({ timeout: TIMEOUT.VISIBLE });

    await page.goto(`/dashboard/${org.organizationId}/chat`);
    const agentTrigger = page
      .getByRole('button', { name: t('chat.agentSelector.label') })
      .first();
    await expect(agentTrigger).toBeEnabled({ timeout: TIMEOUT.FIRST_PAINT });
    await agentTrigger.click();

    // External agents carry a "Sandbox" badge and a "View agent details" link
    // inside the option, so its accessible name is
    // `"<display name> Sandbox View agent details"` — match by substring on the
    // (unique) display name rather than an exact name that never matches.
    await page.getByRole('option', { name: AGENT_DISPLAY_NAME }).click();
    await expect(agentTrigger).toContainText(AGENT_DISPLAY_NAME, {
      timeout: TIMEOUT.VISIBLE,
    });

    const modelTrigger = page
      .getByRole('button', { name: t('chat.modelSelector.label') })
      .first();
    await expect(modelTrigger).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(modelTrigger).toContainText(PRIMARY_RUNTIME_MODEL);

    await modelTrigger.click();
    await expect(
      page.getByRole('option', { name: FALLBACK_RUNTIME_MODEL }).first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await page.keyboard.press('Escape');
  });

  test('Skills tab is visible for external agents and hides workflow disciplines', async ({
    page,
    org,
  }) => {
    await openAgentTab(page, org.organizationId, 'skills');

    await expect(
      page.getByRole('link', {
        name: t('agents.navigation.skills'),
        exact: true,
      }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    await expect(
      page.getByText(
        t('settings.agents.skills.sectionSkillBindingsExternalDescription'),
      ),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    await expect(page.getByText('fix-bug', { exact: true })).toHaveCount(0);
    await expect(page.getByText('write-notes', { exact: true })).toHaveCount(0);
  });
});
