/**
 * Episode 4 choreography — an agent built and boundary-tested on camera.
 * The warmup creates and deletes a throwaway agent so every editor chunk is
 * compiled BEFORE the screencast (the real creation must land on a warm
 * editor), then ends on the agents list — the cold-open surface the title
 * card reveals over. The on-camera agent + its test thread are removed off
 * camera via the cleanup registry (`ctx.cleanup.agent` / `.thread`) —
 * registered the moment they exist, so an aborted take still cleans up.
 *
 * cue() timings are first-pass — tuned against the review sheet during the
 * `--mock-tts` rehearsal before anything bills.
 */

import { type SceneChoreography, type SceneRuntime } from '../../lib/scene';
import {
  AGENT_DISPLAY_NAME,
  AGENT_INSTRUCTIONS,
  AGENT_SLUG,
  BOUNDARY_PROMPT,
} from './episode';

/** The builtin assistant's display name ships per locale
 * (builtin-configs/agents/chat/assistant.json) — DATA, not chrome. */
const ASSISTANT_NAME = {
  en: 'Assistant',
  de: 'Assistent',
  fr: 'Assistant',
} as const;

/** A distinctive snippet of the in-role reply's LAST line (docs-replies,
 * "asking for an invoice copy" triplet) — the hand-off clause the narration
 * points at. Mock DATA per locale, guarded hovers only. */
const HANDOFF_LINE = {
  en: 'outside my mandate',
  de: 'in meinem Auftrag',
  fr: 'dans mon mandat',
} as const;

/** A distinctive snippet of the boundary DECLINE's rule citation
 * (docs-replies, "invoice 4817" triplet). `.last()` — the first reply also
 * mentions the hand-off, and it sits earlier in the same thread. */
const DECLINE_LINE = {
  en: 'billing disputes go to a human',
  de: 'geht an einen Menschen',
  fr: 'part chez un humain',
} as const;

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
 * every editor view the take visits; then chat (the test surfaces). The
 * throwaway is deleted before the screencast, so the on-camera list is
 * exactly as seeded. Ends on the AGENTS LIST — the cold-open surface.
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

  // Chat: the test scenes' surface (composer + picker chunks).
  await page.goto(`/dashboard/${ctx.orgId}/chat`, { waitUntil: 'load' });
  await page
    .getByRole('textbox')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  await page
    .waitForLoadState('networkidle', { timeout: 8_000 })
    .catch(() => {});

  // Last: the cold-open surface — the title card reveals over the agents
  // list (the end state: where the built agent's row will land).
  await page.goto(`/dashboard/${ctx.orgId}/agents`, { waitUntil: 'load' });
  await page
    .getByRole('button', { name: t('settings.agents.createAgent') })
    .waitFor({ state: 'visible', timeout: 30_000 });
  await page
    .waitForLoadState('networkidle', { timeout: 8_000 })
    .catch(() => {});
  await page.waitForTimeout(250);
}

export const SCENES: readonly SceneChoreography[] = [
  {
    // Cold open: the card reveals over the agents list (the end state).
    id: 'title',
    run: async (rt) => {
      const { page, cue } = rt;
      await page.evaluate(() => window.__taleVideoCard?.reveal());
      // The card lifts as the voice reaches "This list — the agents of this
      // workspace" — the surface must be VISIBLE while the narration names
      // it, never hidden behind the card until the next scene.
      await cue(16.5);
      await page.evaluate(() => window.__taleVideoCard?.fadeOutAndRemove(700));
    },
  },
  {
    // The job: the builtins on screen; the gap a specialist will fill.
    id: 'job',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cursor.place(1450, 700);
      await cue(1.0);
      await cursor.show();
      const folder = page.getByRole('row', { name: 'Chat' }).first();
      await folder.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(2.5);
      await cursor.hover(
        page
          .getByRole('row')
          .filter({ hasText: ASSISTANT_NAME[ctx.locale] })
          .first(),
      );
      await cue(8.5);
      await cursor.hover(folder);
    },
  },
  {
    // Create: the menu opens (templates visible), Blank chosen, dialog up.
    id: 'create',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await cue(2.0);
      await cursor.click(
        page.getByRole('button', {
          name: rt.t('settings.agents.createAgent'),
        }),
      );
      const blank = page.getByRole('menuitem', {
        name: rt.t('settings.agents.createMenu.blank'),
      });
      await blank.waitFor({ state: 'visible', timeout: 15_000 });
      // Hold on the open menu while the voice mentions the templates.
      await cue(4.5);
      await cursor.hover(blank);
      await cue(12.0);
      await cursor.click(blank);
      await page
        .getByLabel(rt.t('settings.agents.form.name'), { exact: true })
        .waitFor({ state: 'visible', timeout: 15_000 });
    },
  },
  {
    // Identity: slug, display name, Continue — into the editor.
    id: 'identity',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      const name = page.getByLabel(rt.t('settings.agents.form.name'), {
        exact: true,
      });
      await cue(1.8);
      await cursor.click(name);
      await page.keyboard.type(AGENT_SLUG, { delay: 48 });
      await cue(9.5);
      await cursor.click(
        page.getByLabel(rt.t('settings.agents.form.displayName'), {
          exact: true,
        }),
      );
      await page.keyboard.type(AGENT_DISPLAY_NAME[ctx.locale], { delay: 48 });
      // Registered the moment it will exist — an aborted take still cleans.
      ctx.cleanup.agent(AGENT_DISPLAY_NAME[ctx.locale]);
      await cue(18.5);
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
    // The four-decision navigation, then the mandate typed in.
    id: 'instructions',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      const navItem = (key: string) =>
        editorNav(rt).getByText(rt.t(key)).first();
      // The voice lists the four decisions — trace them in the navigation.
      await cue(5.0);
      await cursor.hover(navItem('settings.agents.navigation.knowledge'));
      await cue(6.2);
      await cursor.hover(navItem('settings.agents.navigation.tools'));
      await cue(11.5);
      await cursor.click(
        navItem('settings.agents.navigation.instructionsModel'),
      );
      const field = page
        .getByLabel(rt.t('settings.agents.form.systemInstructions'))
        .first();
      await field.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(13.5);
      await cursor.click(field);
      await field.clear();
      await page.keyboard.type(AGENT_INSTRUCTIONS[ctx.locale], { delay: 14 });
    },
  },
  {
    // The mandate read back clause by clause, then saved.
    id: 'instructions-why',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      const field = page
        .getByLabel(rt.t('settings.agents.form.systemInstructions'))
        .first();
      await cue(2.0);
      await cursor.hover(field);
      await cue(23.0);
      await saveIfNeeded(rt);
    },
  },
  {
    // Knowledge scope — the per-agent library, read only.
    id: 'knowledge',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await cue(1.5);
      await cursor.click(
        editorNav(rt)
          .getByText(rt.t('settings.agents.navigation.knowledge'))
          .first(),
      );
      const mode = page
        .getByText(rt.t('settings.agents.knowledge.retrievalMode'))
        .first();
      await mode.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(7.0);
      await cursor.hover(mode);
    },
  },
  {
    // Tools — the trust boundary; hover, tick NOTHING.
    id: 'tools',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await cue(1.5);
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
      await cue(13.5);
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
      await cue(1.5);
      await cursor.click(
        editorNav(rt)
          .getByText(rt.t('settings.agents.navigation.instructionsModel'))
          .first(),
      );
      const section = page
        .getByText(rt.t('settings.agents.form.sectionModel'))
        .first();
      await section.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(5.0);
      await cursor.hover(section);
    },
  },
  {
    // Publish: General → Visible in chat → Save. Stay on General.
    id: 'publish',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await cue(2.8);
      await cursor.click(
        editorNav(rt)
          .getByText(rt.t('settings.agents.navigation.general'))
          .first(),
      );
      const toggle = page
        .getByLabel(rt.t('settings.agents.general.visibleInChat'))
        .first();
      await toggle.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(6.5);
      await cursor.hover(toggle);
      await cue(9.5);
      if (!(await toggle.isChecked().catch(() => false))) {
        await cursor.click(toggle);
      }
      await cue(11.5);
      await saveIfNeeded(rt);
    },
  },
  {
    // The in-role test: picker → Support Coach → the invoice-copy ask.
    id: 'test',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(1.0);
      await cursor.click(rail(rt, '/chat'));
      await composer(rt).waitFor({ state: 'visible', timeout: 30_000 });
      await cue(3.5);
      await cursor.click(
        page
          .getByRole('button', { name: rt.t('chat.agentSelector.label') })
          .first(),
      );
      const option = page
        .getByRole('option', { name: AGENT_DISPLAY_NAME[ctx.locale] })
        .first();
      await option.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(6.0);
      await cursor.hover(option);
      await cue(8.5);
      await cursor.click(option);
      await cue(10.5);
      await cursor.click(composer(rt));
      await page.keyboard.type(ctx.heroPrompt, { delay: 30 });
      await cue(16.0);
      await cursor.click(sendButton(rt));
      await page.waitForURL(THREAD_URL, { timeout: 20_000 });
      const threadId = THREAD_URL.exec(page.url())?.[1];
      if (threadId) ctx.cleanup.thread(threadId);
      // The reply streamed to its end — the composer is sendable again.
      await sendButton(rt).waitFor({ state: 'visible', timeout: 30_000 });
    },
  },
  {
    // Stillness over the in-role answer; the hand-off line pointed at.
    id: 'read-answer',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(9.0);
      const line = page.getByText(HANDOFF_LINE[ctx.locale]).last();
      if (await line.isVisible().catch(() => false)) {
        await cursor.hover(line);
      }
    },
  },
  {
    // The boundary test: the dispute typed into the SAME thread — the
    // decline streams (reasoning first), citing the typed hand-off rule.
    id: 'boundary',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(5.0);
      await cursor.click(composer(rt));
      await page.keyboard.type(BOUNDARY_PROMPT[ctx.locale], { delay: 30 });
      await cue(12.0);
      await cursor.click(sendButton(rt));
      // The decline streamed to its end (reasoning, then the refusal).
      await sendButton(rt).waitFor({ state: 'visible', timeout: 30_000 });
      await cue(25.5);
      const rule = page.getByText(DECLINE_LINE[ctx.locale]).last();
      if (await rule.isVisible().catch(() => false)) {
        await cursor.hover(rule);
      }
    },
  },
  {
    // Verify on a fresh chat: the picker lists the coach for the team.
    id: 'verify',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(2.5);
      await cursor.click(rail(rt, '/chat'));
      await composer(rt).waitFor({ state: 'visible', timeout: 30_000 });
      await cue(7.0);
      await cursor.click(
        page
          .getByRole('button', { name: rt.t('chat.agentSelector.label') })
          .first(),
      );
      const option = page
        .getByRole('option', { name: AGENT_DISPLAY_NAME[ctx.locale] })
        .first();
      await option.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(10.5);
      await cursor.hover(option);
      // Close the picker before the recap — no dangling popover.
      await cue(20.5);
      await page.keyboard.press('Escape');
    },
  },
  {
    // Recap over the fresh chat — stillness.
    id: 'recap',
    run: async (rt) => {
      const { cursor, cue } = rt;
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
