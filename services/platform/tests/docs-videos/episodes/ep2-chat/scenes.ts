/**
 * Episode 2 choreography — one surface (chat), four on-camera prompts, four
 * created threads. Every thread the take creates is registered under the
 * cleanup registry (`ctx.cleanup.thread`) and deleted off camera,
 * even when the take aborts. Same rules of the road as Episode 1: rail links
 * by href, UI chrome via the locale catalog, seeded content via
 * `videoContentFor`, readiness on state — `cue()` is the only clock.
 */

import { videoContentFor } from '../../lib/locale-content';
import {
  spaNavigate,
  type SceneChoreography,
  type SceneContext,
  type SceneRuntime,
} from '../../lib/scene';
import {
  ARENA_DONE_PHRASE,
  ARENA_PROMPT,
  CANVAS_BRIEF_HEADING,
  CANVAS_PROMPT,
  UNGROUNDED_PROMPT,
} from './episode';

/** The Researcher's display name ships per locale (researcher.json i18n). */
const RESEARCHER_NAME = {
  en: 'Researcher',
  de: 'Rechercheur',
  fr: 'Chercheur',
} as const;

/** The Modes entry label — connector/agent DATA (researcher.json
 * `composerMode.label`), one string for every locale. */
const DEEP_RESEARCH_MODE_LABEL = 'Deep research';

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

/** Capture the thread id from the current URL and register its cleanup. */
function registerCurrentThread(rt: SceneRuntime): void {
  const threadId = THREAD_URL.exec(rt.page.url())?.[1];
  if (threadId) rt.ctx.cleanup.thread(threadId);
}

/**
 * Warm every lazy chunk the take renders: the chat surface, the model and
 * agent pickers, the Arena split view, and the Canvas pane (forced by really
 * sending the canvas prompt once — the thread is registered for the post-take
 * cleanup). Ends settled on /chat.
 */
export async function warmup(
  page: import('@playwright/test').Page,
  ctx: import('../../lib/scene').SceneContext,
): Promise<void> {
  const { t } = await import('../../lib/i18n').then((m) => ({
    t: m.localeT(ctx.locale),
  }));
  await page.goto(`/dashboard/${ctx.orgId}/chat`, { waitUntil: 'load' });
  const input = page.getByRole('textbox', { name: t('chat.aria.chatInput') });
  await input.waitFor({ state: 'visible', timeout: 30_000 });
  await page
    .waitForLoadState('networkidle', { timeout: 8_000 })
    .catch(() => {});

  // Pickers: open + close so their chunks and queries are warm.
  await page
    .getByRole('button', { name: t('chat.modelSelector.label') })
    .first()
    .click();
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: t('chat.agentSelector.label') })
    .first()
    .click();
  await page.keyboard.press('Escape');

  // Arena: enter + leave once (no message sent — nothing persists).
  await page
    .getByRole('button', { name: t('composer.openMenu') })
    .first()
    .click();
  await page
    .getByRole('menuitem', { name: t('chat.arena.label') })
    .first()
    .click();
  // Arena-active signal: the composer's "A <model> vs B <model>" bar — the
  // column labels render only after a prompt is sent.
  await page
    .getByText(t('chat.arena.vs'), { exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  // The menu entry is a TOGGLE — the same "Arena Mode" item exits the mode.
  await page
    .getByRole('button', { name: t('composer.openMenu') })
    .first()
    .click();
  await page
    .getByRole('menuitem', { name: t('chat.arena.label') })
    .first()
    .click();
  await page
    .getByText(t('chat.arena.vs'), { exact: true })
    .first()
    .waitFor({ state: 'hidden', timeout: 15_000 });

  // Canvas: send the real canvas prompt once so the pane's chunk compiles;
  // the thread is deleted off camera after the take.
  await input.click();
  await page.keyboard.type(CANVAS_PROMPT[ctx.locale], { delay: 1 });
  await page.keyboard.press('Enter');
  await page.waitForURL(THREAD_URL, { timeout: 20_000 });
  const warmThread = THREAD_URL.exec(page.url())?.[1];
  if (warmThread) ctx.cleanup.thread(warmThread);
  await page
    .getByText(CANVAS_BRIEF_HEADING[ctx.locale])
    .first()
    .waitFor({ state: 'visible', timeout: 60_000 });

  // End on the take's opening surface, settled.
  await spaNavigate(page, `/dashboard/${ctx.orgId}/chat`);
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
    // "…which agent answers, which model runs, and what context rides along."
    id: 'composer',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await page.evaluate(() => window.__taleVideoCard?.fadeOutAndRemove(700));
      await composer(rt).waitFor({ state: 'visible', timeout: 15_000 });
      await cursor.place(1450, 700);
      await cue(1.2);
      await cursor.show();
      await cursor.hover(composer(rt));
      await cue(3.4);
      await cursor.hover(
        page
          .getByRole('button', { name: rt.t('chat.agentSelector.label') })
          .first(),
      );
      await cue(4.6);
      await cursor.hover(
        page
          .getByRole('button', { name: rt.t('chat.modelSelector.label') })
          .first(),
      );
      await cue(6.0);
      await cursor.hover(
        page.getByRole('button', { name: rt.t('composer.openMenu') }).first(),
      );
    },
  },
  {
    // The ungrounded ask: fluent, confident, generic — no attachment.
    id: 'ask-ungrounded',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(1.6);
      await cursor.click(composer(rt));
      await cue(2.6);
      await page.keyboard.type(UNGROUNDED_PROMPT[ctx.locale], { delay: 42 });
      await cue(6.2);
      await cursor.click(sendButton(rt));
      await page.waitForURL(THREAD_URL, { timeout: 20_000 });
      registerCurrentThread(rt);
      // Let the generic reply finish streaming under the narration.
      await sendButton(rt).waitFor({ state: 'visible', timeout: 30_000 });
    },
  },
  {
    // The grounded re-ask: fresh chat, @-mention the Q2 review, same topic.
    id: 'attach-grounded',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cursor.click(rail(rt, '/chat'));
      await composer(rt).waitFor({ state: 'visible', timeout: 15_000 });
      await cue(1.8);
      await cursor.click(composer(rt));
      await cue(2.6);
      await page.keyboard.type('@', { delay: 60 });
      const pickerDoc = page
        .getByRole('listbox')
        .getByRole('option', {
          name: videoContentFor(ctx.locale).wowSourceDoc,
        })
        .first();
      await pickerDoc.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(3.6);
      await cursor.click(pickerDoc);
      await cue(5.0);
      await page.keyboard.type(ctx.heroPrompt, { delay: 38 });
      await cue(9.6);
      await cursor.click(sendButton(rt));
      await page.waitForURL(THREAD_URL, { timeout: 20_000 });
      registerCurrentThread(rt);
    },
  },
  {
    // The lesson — camera rests on the finished grounded answer; one slow
    // hover over a named source. Stillness carries the beat.
    id: 'grounding-lesson',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await sendButton(rt).waitFor({ state: 'visible', timeout: 30_000 });
      await cue(9.0);
      const source = page
        .locator('[data-message-role="assistant"] strong')
        .first();
      if (await source.isVisible().catch(() => false)) {
        await cursor.hover(source);
      }
    },
  },
  {
    // The model picker: Auto explained, catalog scanned, closed.
    id: 'model-choice',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await cue(1.4);
      await cursor.click(
        page
          .getByRole('button', { name: rt.t('chat.modelSelector.label') })
          .first(),
      );
      await cue(5.4);
      const auto = page
        .getByText(rt.t('chat.modelSelector.auto'), { exact: true })
        .first();
      if (await auto.isVisible().catch(() => false)) {
        await cursor.hover(auto);
      }
      await cue(8.6);
      await page.keyboard.press('Escape');
    },
  },
  {
    // Arena: fresh chat → "+" menu → Arena → native prompt → two columns
    // stream side by side → verdict.
    id: 'arena',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cursor.click(rail(rt, '/chat'));
      await composer(rt).waitFor({ state: 'visible', timeout: 15_000 });
      await cue(1.6);
      await cursor.click(
        page.getByRole('button', { name: rt.t('composer.openMenu') }).first(),
      );
      await cursor.click(
        page.getByRole('menuitem', { name: rt.t('chat.arena.label') }).first(),
      );
      await page
        .getByText(rt.t('chat.arena.vs'), { exact: true })
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 });
      await cue(3.4);
      await cursor.click(composer(rt));
      await page.keyboard.type(ARENA_PROMPT[ctx.locale], { delay: 34 });
      await cue(7.2);
      await page.keyboard.press('Enter');
      registerCurrentThread(rt);
      // Both columns carry the done-phrase exactly once — the second
      // occurrence means both finished.
      await page
        .getByText(ARENA_DONE_PHRASE[ctx.locale])
        .nth(1)
        .waitFor({ state: 'visible', timeout: 60_000 });
      registerCurrentThread(rt);
      await cue(17.5);
      await cursor.click(
        page.getByRole('button', { name: rt.t('chat.arena.bBetter') }),
      );
    },
  },
  {
    // Canvas: fresh chat, the brief prompt, reasoning, the file lands and
    // the pane opens beside the chat.
    id: 'canvas',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cursor.click(rail(rt, '/chat'));
      await composer(rt).waitFor({ state: 'visible', timeout: 15_000 });
      await cue(1.6);
      await cursor.click(composer(rt));
      await page.keyboard.type(CANVAS_PROMPT[ctx.locale], { delay: 34 });
      await cue(5.6);
      await cursor.click(sendButton(rt));
      await page.waitForURL(THREAD_URL, { timeout: 20_000 });
      registerCurrentThread(rt);
      // The brief's H1 renders only once the pane is open on the file — the
      // honest "canvas opened" anchor (the pane's rail tab exists closed).
      const heading = page.getByText(CANVAS_BRIEF_HEADING[ctx.locale]).first();
      await heading.waitFor({ state: 'visible', timeout: 60_000 });
      // The pane opens on the Source view — the rendered Preview is the
      // shot: a leadership brief, not a wall of markdown.
      await cue(12.0);
      await cursor.click(
        page
          .getByRole('button', { name: rt.t('chat.workspaceFiles.preview') })
          .first(),
      );
      await cue(14.5);
      await cursor.hover(heading);
    },
  },
  {
    // Deep research, shown honestly: the Modes entry in the composer's plus
    // menu (docs: platform/chat/deep-research.md). Picking it switches the
    // chat into the Researcher agent — no live run: a deterministic
    // multi-turn research choreography cannot be mocked.
    id: 'research',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(1.2);
      await cursor.click(
        page.getByRole('button', { name: rt.t('composer.openMenu') }).first(),
      );
      const mode = page
        .getByRole('menuitem', { name: DEEP_RESEARCH_MODE_LABEL })
        .first();
      await mode.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(3.2);
      await cursor.click(mode);
      // The chat switches into the Researcher — its display name lands on
      // the composer's agent selector.
      const researcher = page.getByText(RESEARCHER_NAME[ctx.locale]).first();
      await researcher.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(6.5);
      await cursor.hover(researcher);
    },
  },
  {
    // Recap over a fresh chat at rest.
    id: 'recap',
    run: async (rt) => {
      const { cursor, cue } = rt;
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
