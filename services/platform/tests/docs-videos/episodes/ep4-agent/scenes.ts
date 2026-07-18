/**
 * Episode 4 choreography — an agent built on camera. The warmup creates and
 * deletes a throwaway agent so every editor chunk is compiled BEFORE the
 * screencast (the real creation must land on a warm editor). The on-camera
 * agent + its test thread are removed off camera via the cleanup registry
 * (`ctx.cleanup.agent` / `.thread`) — registered the moment they exist, so an
 * aborted take still cleans up.
 */

import {
  type SceneChoreography,
  type SceneContext,
  type SceneRuntime,
} from '../../lib/scene';
import { AGENT_DISPLAY_NAME, AGENT_INSTRUCTIONS, AGENT_SLUG } from './episode';

function rail(rt: SceneRuntime, path: string) {
  return rt.page
    .locator(`nav a[href="/dashboard/${rt.ctx.orgId}${path}"]`)
    .first();
}

function composer(rt: SceneRuntime) {
  return rt.page.getByRole('textbox', { name: rt.t('chat.aria.chatInput') });
}

function sendButton(rt: SceneRuntime) {
  return rt.page.getByRole('button', {
    name: rt.t('chat.send'),
    exact: true,
  });
}

const THREAD_URL = /\/chat\/([A-Za-z0-9]{16,})(?:[/?#]|$)/;

/** The agent editor's section navigation, scoped by its aria name. */
function editorNav(rt: SceneRuntime) {
  return rt.page.getByRole('navigation', {
    name: rt.t('common.aria.agentsNavigation'),
  });
}

/** Click Save when the editor has one enabled (some views autosave). */
async function saveIfNeeded(rt: SceneRuntime): Promise<void> {
  const save = rt.page
    .getByRole('button', { name: rt.t('common.actions.save'), exact: true })
    .first();
  const visible = await save.isVisible().catch(() => false);
  if (visible && (await save.isEnabled().catch(() => false))) {
    await rt.cursor.click(save);
    await rt.page.waitForTimeout(600);
  }
}

/**
 * Warm the agents list, the create dialog, and — via a throwaway agent —
 * every editor view the take visits. The throwaway is deleted before the
 * screencast starts, so the on-camera list is exactly as seeded.
 */
export async function warmup(
  page: import('@playwright/test').Page,
  ctx: import('../../lib/scene').SceneContext,
): Promise<void> {
  const { localeT } = await import('../../lib/i18n');
  const t = localeT(ctx.locale);
  await page.goto(`/dashboard/${ctx.orgId}/agents`, { waitUntil: 'load' });
  await page
    .getByRole('button', { name: t('settings.agents.createAgent') })
    .waitFor({ state: 'visible', timeout: 30_000 });

  // Throwaway agent: compile the create dialog + every editor view.
  await page
    .getByRole('button', { name: t('settings.agents.createAgent') })
    .click();
  await page
    .getByRole('menuitem', { name: t('settings.agents.createMenu.blank') })
    .click();
  await page
    .getByLabel(t('settings.agents.form.name'), { exact: true })
    .fill('wu-compile');
  await page
    .getByLabel(t('settings.agents.form.displayName'), { exact: true })
    .fill('Warmup Compile');
  const continueButton = page.getByRole('button', {
    name: t('settings.agents.createDialog.continue'),
    exact: true,
  });
  await continueButton.click();
  await page.waitForURL(/\/agents\/wu-compile(?:[/?#]|$)/, {
    timeout: 30_000,
  });
  const nav = page.getByRole('navigation', {
    name: t('common.aria.agentsNavigation'),
  });
  await nav.waitFor({ state: 'visible', timeout: 15_000 });
  for (const key of [
    'settings.agents.navigation.instructionsModel',
    'settings.agents.navigation.knowledge',
    'settings.agents.navigation.tools',
    'settings.agents.navigation.general',
  ]) {
    await nav.getByText(t(key)).first().click();
    await page.waitForTimeout(500);
  }
  // Delete the throwaway BEFORE the screencast — the list must be as seeded.
  await page.goto(`/dashboard/${ctx.orgId}/agents`, { waitUntil: 'load' });
  const row = page
    .getByRole('row')
    .filter({ hasText: 'Warmup Compile' })
    .first();
  await row.waitFor({ state: 'visible', timeout: 15_000 });
  await row.getByRole('button', { name: t('common.actions.openMenu') }).click();
  await page
    .getByRole('menuitem', { name: t('common.actions.delete'), exact: true })
    .click();
  await page
    .getByRole('button', {
      name: t('settings.agents.deleteAgent'),
      exact: true,
    })
    .click();
  await row.waitFor({ state: 'hidden', timeout: 15_000 });

  // Chat is the take's opening surface and its final stop.
  await page.goto(`/dashboard/${ctx.orgId}/chat`, { waitUntil: 'load' });
  await page
    .getByRole('textbox')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  await page
    .waitForLoadState('networkidle', { timeout: 8_000 })
    .catch(() => {});
}

export const SCENES: readonly SceneChoreography[] = [
  {
    id: 'title',
    run: async ({ page }) => {
      await page.evaluate(() => window.__taleVideoCard?.reveal());
    },
  },
  {
    // The agents list — real rail click; builtins on screen.
    id: 'agents-list',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await page.evaluate(() => window.__taleVideoCard?.fadeOutAndRemove(700));
      await composer(rt).waitFor({ state: 'visible', timeout: 15_000 });
      await cursor.place(1450, 700);
      await cue(0.8);
      await cursor.show();
      await cursor.click(rail(rt, '/agents'));
      const folder = page.getByRole('row', { name: 'Chat' }).first();
      await folder.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(4.5);
      await cursor.hover(folder);
    },
  },
  {
    // Create: menu → Blank → name + display name → Continue → the editor.
    id: 'create',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(2.2);
      await cursor.click(
        page.getByRole('button', {
          name: rt.t('settings.agents.createAgent'),
        }),
      );
      await cue(3.4);
      await cursor.click(
        page.getByRole('menuitem', {
          name: rt.t('settings.agents.createMenu.blank'),
        }),
      );
      const name = page.getByLabel(rt.t('settings.agents.form.name'), {
        exact: true,
      });
      await name.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(4.6);
      await cursor.click(name);
      await page.keyboard.type(AGENT_SLUG, { delay: 48 });
      await cue(7.2);
      await cursor.click(
        page.getByLabel(rt.t('settings.agents.form.displayName'), {
          exact: true,
        }),
      );
      await page.keyboard.type(AGENT_DISPLAY_NAME[ctx.locale], { delay: 48 });
      // Registered the moment it will exist — an aborted take still cleans.
      ctx.cleanup.agent(AGENT_DISPLAY_NAME[ctx.locale]);
      await cue(10.4);
      await cursor.click(
        page.getByRole('button', {
          name: rt.t('settings.agents.createDialog.continue'),
          exact: true,
        }),
      );
      await page.waitForURL(new RegExp(`/agents/${AGENT_SLUG}(?:[/?#]|$)`), {
        timeout: 30_000,
      });
      await editorNav(rt).waitFor({ state: 'visible', timeout: 15_000 });
    },
  },
  {
    // Instructions: open the view, type the mandate.
    id: 'instructions',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(1.6);
      await cursor.click(
        editorNav(rt)
          .getByText(rt.t('settings.agents.navigation.instructionsModel'))
          .first(),
      );
      const field = page
        .getByLabel(rt.t('settings.agents.form.systemInstructions'))
        .first();
      await field.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(4.2);
      await cursor.click(field);
      await field.clear();
      await page.keyboard.type(AGENT_INSTRUCTIONS[ctx.locale], { delay: 14 });
      await cue(13.6);
      await saveIfNeeded(rt);
    },
  },
  {
    // Knowledge scope — the per-agent library.
    id: 'knowledge',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await cue(1.2);
      await cursor.click(
        editorNav(rt)
          .getByText(rt.t('settings.agents.navigation.knowledge'))
          .first(),
      );
      const mode = page
        .getByText(rt.t('settings.agents.knowledge.retrievalMode'))
        .first();
      await mode.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(6.5);
      await cursor.hover(mode);
    },
  },
  {
    // Tools — the trust boundary; hover, tick nothing.
    id: 'tools',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await cue(1.4);
      await cursor.click(
        editorNav(rt)
          .getByText(rt.t('settings.agents.navigation.tools'))
          .first(),
      );
      const firstToggle = page.getByRole('switch').first();
      const anchor = (await firstToggle.isVisible().catch(() => false))
        ? firstToggle
        : page.getByRole('checkbox').first();
      await anchor.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(5.5);
      await cursor.hover(anchor);
      await cue(9.5);
      const second = page.getByRole('switch').nth(2);
      if (await second.isVisible().catch(() => false)) {
        await cursor.hover(second);
      }
    },
  },
  {
    // Model — same editor view as instructions; the Models section.
    id: 'model',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await cue(1.2);
      await cursor.click(
        editorNav(rt)
          .getByText(rt.t('settings.agents.navigation.instructionsModel'))
          .first(),
      );
      const section = page
        .getByText(rt.t('settings.agents.form.sectionModel'))
        .first();
      await section.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(4.0);
      await cursor.hover(section);
    },
  },
  {
    // Publish + live test: visible in chat, then the first real ask.
    id: 'publish',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cursor.click(
        editorNav(rt)
          .getByText(rt.t('settings.agents.navigation.general'))
          .first(),
      );
      const toggle = page
        .getByLabel(rt.t('settings.agents.general.visibleInChat'))
        .first();
      await toggle.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(1.8);
      if (!(await toggle.isChecked().catch(() => false))) {
        await cursor.click(toggle);
      }
      await saveIfNeeded(rt);
      await cue(4.6);
      await cursor.click(rail(rt, '/chat'));
      await composer(rt).waitFor({ state: 'visible', timeout: 15_000 });
      await cue(6.2);
      await cursor.click(
        page
          .getByRole('button', { name: rt.t('chat.agentSelector.label') })
          .first(),
      );
      const option = page
        .getByRole('option', { name: AGENT_DISPLAY_NAME[ctx.locale] })
        .first();
      await option.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(7.6);
      await cursor.click(option);
      await cue(8.8);
      await cursor.click(composer(rt));
      await page.keyboard.type(ctx.heroPrompt, { delay: 34 });
      await cue(13.2);
      await cursor.click(sendButton(rt));
      await page.waitForURL(THREAD_URL, { timeout: 20_000 });
      const threadId = THREAD_URL.exec(page.url())?.[1];
      if (threadId) ctx.cleanup.thread(threadId);
      await sendButton(rt).waitFor({ state: 'visible', timeout: 30_000 });
    },
  },
  {
    // Iterate — stillness over the obedient reply.
    id: 'iterate',
    run: async (rt) => {
      const { cursor, cue } = rt;
      await cue(10.0);
      await cursor.hide();
    },
  },
  {
    // Recap on a fresh chat.
    id: 'recap',
    run: async (rt) => {
      const { cursor, cue } = rt;
      await cursor.show();
      await cursor.click(rail(rt, '/chat'));
      await composer(rt).waitFor({ state: 'visible', timeout: 30_000 });
      await cue(1.2);
      await cursor.hide();
    },
  },
  {
    id: 'outro',
    run: async ({ page, cursor }) => {
      await cursor.hide();
      await page.evaluate(() => window.__taleVideoCard?.showOutro());
    },
  },
];
