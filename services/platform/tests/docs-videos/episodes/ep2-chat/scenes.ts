/**
 * Episode 2 choreography — one surface (chat), six on-camera prompts, four
 * threads created on camera (ungrounded, grounded + its follow-up turn,
 * Arena, canvas + its refine turn) plus the warmup's canvas thread. Every
 * created thread registers on the cleanup registry (`ctx.cleanup.thread`)
 * the moment its URL exists and is deleted off camera, even when the take
 * aborts. Rules of the road as ep5: rail links by href, UI chrome via the
 * locale catalog (`rt.t`), locale-resolved CONTENT via per-locale data maps
 * (never an English literal), readiness on state — `cue()` is the only
 * clock.
 *
 * cue() timings are first-pass — tuned against the review sheet during the
 * `--mock-tts` rehearsal before anything bills.
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
  CANVAS_REFINE_PROMPT,
  CANVAS_REFINED_MARKER,
  FOLLOWUP_PROMPT,
  UNGROUNDED_PROMPT,
} from './episode';

/** The Modes entry label — connector/agent DATA (researcher.json
 * `composerMode.label`), one string for every locale. */
const DEEP_RESEARCH_MODE_LABEL = 'Deep research';

/** Arena column B's risk-section heading — mock DATA per locale (the
 * claude-sonnet byModel variants in docs-replies.ts). The verdict scene
 * hovers it while the voice names the risks the short answer skipped. */
const ARENA_RISKS_HEADING = {
  en: 'Risks worth flagging',
  de: 'Erwähnenswerte Risiken',
  fr: 'Risques à signaler',
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

/** The always-visible toolbar under the LAST assistant message (history
 * toolbars are hover-revealed) — `.last()` lands on it by construction. */
function thumbsUpButton(rt: SceneRuntime) {
  return rt.page
    .getByRole('button', { name: rt.t('chat.feedback.thumbsUp') })
    .last();
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
 * sending the canvas prompt once — the thread is registered for the
 * post-take cleanup). Ends ON that canvas thread with the brief in Preview:
 * the episode's END STATE, so the title card reveals over the finished
 * brief (cold-open contract).
 */
export async function warmup(
  page: import('@playwright/test').Page,
  ctx: SceneContext,
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

  // Canvas LAST: send the real canvas prompt once so the pane's chunk
  // compiles, then switch to Preview (warms the renderer AND leaves the
  // cold-open end state — the finished brief). Thread deleted off camera.
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
  const preview = page
    .getByRole('button', { name: t('chat.workspaceFiles.preview') })
    .first();
  if (await preview.isVisible().catch(() => false)) {
    await preview.click();
    await page
      .getByText(CANVAS_BRIEF_HEADING[ctx.locale])
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 });
  }
  await page
    .waitForLoadState('networkidle', { timeout: 8_000 })
    .catch(() => {});
}

export const SCENES: readonly SceneChoreography[] = [
  {
    // Cold open: the card reveals over the finished brief (the end state).
    id: 'title',
    run: async (rt) => {
      const { page, cue } = rt;
      await page.evaluate(() => window.__taleVideoCard?.reveal());
      // The card lifts as the voice reaches "and build this: a one-page
      // brief" — the brief must be VISIBLE while the narration names it.
      await cue(12.5);
      await page.evaluate(() => window.__taleVideoCard?.fadeOutAndRemove(700));
    },
  },
  {
    // The composer, empty: three choices before any typing (cut under the
    // veil from the warmup's canvas thread to /chat home).
    id: 'context',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(page, `/dashboard/${ctx.orgId}/chat`);
      await composer(rt).waitFor({ state: 'visible', timeout: 30_000 });
      await cursor.place(1450, 700);
      await cue(1.2);
      await cursor.show();
      await cue(3.0);
      await cursor.hover(composer(rt));
      await cue(6.0);
      await cursor.hover(
        page
          .getByRole('button', { name: rt.t('chat.agentSelector.label') })
          .first(),
      );
      await cue(8.5);
      await cursor.hover(
        page
          .getByRole('button', { name: rt.t('chat.modelSelector.label') })
          .first(),
      );
      await cue(11.0);
      await cursor.hover(
        page.getByRole('button', { name: rt.t('composer.openMenu') }).first(),
      );
    },
  },
  {
    // The ungrounded ask: typed and sent live, no attachment.
    id: 'ask-ungrounded',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(1.5);
      await cursor.click(composer(rt));
      await cue(2.2);
      await page.keyboard.type(UNGROUNDED_PROMPT[ctx.locale], { delay: 42 });
      await cue(6.8);
      await cursor.click(sendButton(rt));
      await page.waitForURL(THREAD_URL, { timeout: 20_000 });
      registerCurrentThread(rt);
      // Let the generic reply finish streaming under the narration.
      await sendButton(rt).waitFor({ state: 'visible', timeout: 30_000 });
    },
  },
  {
    // The pitfall, read together: the camera holds on the fluent answer.
    // Stillness carries the beat — one slow hover over the answer text.
    id: 'pitfall',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      const answer = page.locator('[data-message-role="assistant"]').last();
      await cue(2.5);
      if (await answer.isVisible().catch(() => false)) {
        await cursor.hover(answer);
      }
    },
  },
  {
    // The grounded re-ask: fresh chat, @-mention the Q2 review, same topic.
    id: 'ask-grounded',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(1.5);
      await cursor.click(rail(rt, '/chat'));
      await composer(rt).waitFor({ state: 'visible', timeout: 15_000 });
      await cue(3.2);
      await cursor.click(composer(rt));
      await cue(4.2);
      await page.keyboard.type('@', { delay: 60 });
      const pickerDoc = page
        .getByRole('listbox')
        .getByRole('option', {
          name: videoContentFor(ctx.locale).wowSourceDoc,
        })
        .first();
      await pickerDoc.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(5.6);
      await cursor.click(pickerDoc);
      await cue(6.8);
      await page.keyboard.type(ctx.heroPrompt, { delay: 38 });
      await cue(11.8);
      await cursor.click(sendButton(rt));
      await page.waitForURL(THREAD_URL, { timeout: 20_000 });
      registerCurrentThread(rt);
    },
  },
  {
    // The grounded answer at rest: the number, then the named source.
    id: 'grounded-answer',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await sendButton(rt).waitFor({ state: 'visible', timeout: 30_000 });
      await cue(8.0);
      const source = page
        .locator('[data-message-role="assistant"] strong')
        .first();
      if (await source.isVisible().catch(() => false)) {
        await cursor.hover(source);
      }
    },
  },
  {
    // The source check: a follow-up turn on the SAME thread — the reply
    // names the exact seeded file (NEW docs-replies triplet).
    id: 'follow-up',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(3.5);
      await cursor.click(composer(rt));
      await cue(4.5);
      await page.keyboard.type(FOLLOWUP_PROMPT[ctx.locale], { delay: 42 });
      await cue(8.6);
      await cursor.click(sendButton(rt));
      // Same-thread send: no URL change to gate on. The button leaves while
      // the reply streams — see it GONE first, or "visible" resolves before
      // streaming even starts and the beats below run on the old message.
      await sendButton(rt)
        .waitFor({ state: 'hidden', timeout: 5_000 })
        .catch(() => {});
      await sendButton(rt).waitFor({ state: 'visible', timeout: 30_000 });
      await cue(12.5);
      // The filename lands bold in the LAST assistant message.
      const file = page
        .locator('[data-message-role="assistant"]')
        .last()
        .locator('strong')
        .first();
      if (await file.isVisible().catch(() => false)) {
        await cursor.hover(file);
      }
    },
  },
  {
    // The verify beat: thumbs-up the answer that held. Only the last
    // assistant message's toolbar is always visible — that's the one.
    id: 'thumbs-up',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      const thumbs = thumbsUpButton(rt);
      await thumbs.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(4.5);
      await cursor.hover(thumbs);
      await cue(7.0);
      await cursor.click(thumbs);
      // The honest outcome: the button reports its pressed state.
      await page
        .getByRole('button', {
          name: rt.t('chat.feedback.thumbsUp'),
          pressed: true,
        })
        .last()
        .waitFor({ state: 'visible', timeout: 10_000 })
        .catch(() => {});
    },
  },
  {
    // The model picker: Auto explained, pinning named, closed.
    id: 'model-choice',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await cue(2.8);
      await cursor.click(
        page
          .getByRole('button', { name: rt.t('chat.modelSelector.label') })
          .first(),
      );
      await cue(5.5);
      const auto = page
        .getByText(rt.t('chat.modelSelector.auto'), { exact: true })
        .first();
      if (await auto.isVisible().catch(() => false)) {
        await cursor.hover(auto);
      }
      await cue(15.5);
      await page.keyboard.press('Escape');
    },
  },
  {
    // Arena: fresh chat → "+" menu → Arena Mode → the prompt goes to two
    // columns. The stream finishes under the verdict scene's opening wait.
    id: 'arena',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(3.0);
      await cursor.click(rail(rt, '/chat'));
      await composer(rt).waitFor({ state: 'visible', timeout: 15_000 });
      await cue(4.6);
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
      await cue(8.5);
      await cursor.click(composer(rt));
      await page.keyboard.type(ARENA_PROMPT[ctx.locale], { delay: 34 });
      await cue(13.5);
      await page.keyboard.press('Enter');
      await page.waitForURL(THREAD_URL, { timeout: 20_000 });
      registerCurrentThread(rt);
    },
  },
  {
    // The verdict: both columns read, the difference named, B voted.
    id: 'arena-verdict',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      // Both columns carry the done-phrase exactly once — the second
      // occurrence means both finished streaming.
      await page
        .getByText(ARENA_DONE_PHRASE[ctx.locale])
        .nth(1)
        .waitFor({ state: 'visible', timeout: 60_000 });
      await cue(3.5);
      await cursor.hover(page.getByText(ARENA_DONE_PHRASE[ctx.locale]).first());
      await cue(9.5);
      // Column B's risk section — the evidence the narration points at.
      const risks = page.getByText(ARENA_RISKS_HEADING[ctx.locale]).first();
      if (await risks.isVisible().catch(() => false)) {
        await cursor.hover(risks);
      }
      const voteB = page
        .getByRole('button', { name: rt.t('chat.arena.bBetter') })
        .first();
      await voteB.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(22.0);
      await cursor.click(voteB);
    },
  },
  {
    // Canvas: fresh chat, the brief prompt, the file lands, the pane opens,
    // Preview turns markdown into a page.
    id: 'canvas',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(1.5);
      await cursor.click(rail(rt, '/chat'));
      await composer(rt).waitFor({ state: 'visible', timeout: 15_000 });
      await cue(3.0);
      await cursor.click(composer(rt));
      await page.keyboard.type(CANVAS_PROMPT[ctx.locale], { delay: 34 });
      await cue(11.0);
      await cursor.click(sendButton(rt));
      await page.waitForURL(THREAD_URL, { timeout: 20_000 });
      registerCurrentThread(rt);
      // The brief's H1 renders only once the pane is open on the file — the
      // honest "canvas opened" anchor (the pane's rail tab exists closed).
      const heading = page.getByText(CANVAS_BRIEF_HEADING[ctx.locale]).first();
      await heading.waitFor({ state: 'visible', timeout: 60_000 });
      // The pane opens on the Source view — Preview is the shot: a
      // leadership brief, not a wall of markdown.
      await cue(18.5);
      await cursor.click(
        page
          .getByRole('button', { name: rt.t('chat.workspaceFiles.preview') })
          .first(),
      );
      await cue(21.0);
      await cursor.hover(heading);
    },
  },
  {
    // The refinement: one plain sentence, the SAME file rewritten in place
    // (NEW docs-replies triplet, file_write on the same path).
    id: 'canvas-refine',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(3.5);
      await cursor.click(composer(rt));
      await cue(5.2);
      await page.keyboard.type(CANVAS_REFINE_PROMPT[ctx.locale], {
        delay: 42,
      });
      await cue(8.8);
      await cursor.click(sendButton(rt));
      // The marker line exists ONLY in the refined content — its appearance
      // in the pane IS the rewrite landing.
      const marker = page.getByText(CANVAS_REFINED_MARKER[ctx.locale]).first();
      await marker.waitFor({ state: 'visible', timeout: 60_000 });
      await cue(14.0);
      await cursor.hover(marker);
    },
  },
  {
    // Deep research, shown as a read-beat (per the storyboard brief: announce
    // → open → point → close). We do NOT click it through: picking the mode
    // gates on a live Tavily connection, and an unconnected workspace routes
    // to the connectors page instead of switching the agent — off-story and
    // state-fragile. Opening the menu and naming it is the honest beat.
    id: 'research',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      // Fresh chat first: the canvas pane squeezes the composer, and leaving
      // the canvas thread swaps the whole chat tree. Rail-click to the chat
      // home and gate on the URL before touching the menu — the old
      // composer's plus button matches these locators while it detaches.
      await cue(1.0);
      await cursor.click(rail(rt, '/chat'));
      await page.waitForURL(
        (url) => /\/chat(?:[?#]|$)/.test(url.pathname + url.search),
        { timeout: 15_000 },
      );
      await composer(rt).waitFor({ state: 'visible', timeout: 15_000 });
      await page
        .waitForLoadState('networkidle', { timeout: 5_000 })
        .catch(() => {});
      await cue(3.5);
      // Claim composer focus (the home autofocuses it after hydration; a menu
      // opened inside that window closes on the focus shift), then open the
      // menu — re-open if a late race closed the first.
      await cursor.click(composer(rt));
      await page.waitForTimeout(400);
      const plus = page
        .getByRole('button', { name: rt.t('composer.openMenu') })
        .first();
      await cursor.click(plus);
      const mode = page
        .getByRole('menuitem', { name: DEEP_RESEARCH_MODE_LABEL })
        .first();
      const opened = await mode
        .waitFor({ state: 'visible', timeout: 4_000 })
        .then(() => true)
        .catch(() => false);
      if (!opened) {
        await cursor.click(plus);
        await mode.waitFor({ state: 'visible', timeout: 15_000 });
      }
      await cue(6.0);
      await cursor.hover(mode);
      await cue(11.0);
      // Close the menu without switching mode — the beat is naming it, and
      // Escape leaves the org exactly as found.
      await page.keyboard.press('Escape');
    },
  },
  {
    // Recap over a fresh chat at rest.
    id: 'recap',
    run: async (rt) => {
      const { cursor, cue } = rt;
      await cue(1.2);
      await cursor.click(rail(rt, '/chat'));
      await composer(rt).waitFor({ state: 'visible', timeout: 30_000 });
      await cue(3.0);
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
