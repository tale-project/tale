/**
 * Episode 1 choreography. Scene ids pair 1:1 with the narration in
 * episode.ts; `cue(sec)` waits until that second of the running narration so
 * actions land with the voice ("…we will attach a document" → the picker
 * opens). Rules of the road (produce-video skill):
 *
 *  - Navigation between app surfaces is CLIENT-SIDE wherever possible — the
 *    cursor really clicks the nav rail (TanStack Router links, no reload).
 *    The three URL jumps that cannot be clicked (deep automation tab, the
 *    project board, the outro card) happen at scene start, inside a widened
 *    lead-in, so the load flash sits between scenes, not under narration.
 *  - Element targets are locale-proof: rail links by href, UI chrome via the
 *    locale's own catalog (`t`), seeded CONTENT via `videoContentFor` — the
 *    de/fr takes run against their own natively-seeded orgs.
 *  - Every readiness wait is on state (locators), never on time.
 */

import { videoContentFor } from '../../lib/locale-content';
import {
  spaNavigate,
  type SceneChoreography,
  type SceneRuntime,
} from '../../lib/scene';

/** The builtin assistant's display name ships per locale
 * (builtin-configs/agents/chat/assistant.json). */
const ASSISTANT_NAME = {
  en: 'Assistant',
  de: 'Assistent',
  fr: 'Assistant',
} as const;
/** The hidden autoInstall triage automation (see docs-screenshots manifest). */
const TRIAGE_AUTOMATION_PATH = 'projects__tasks__triage-unassigned';

/** Catalog card name — locale-resolved DATA like the assistant's display
 * name: the grid renders automation.json's `i18n` block per locale. */
const RESOLVE_ISSUES_CARD_NAME = {
  en: 'Resolve GitHub issues',
  de: 'GitHub-Issues lösen',
  fr: 'Résoudre les issues GitHub',
} as const;

/** A primary-rail link, located by target URL — immune to locale. */
function rail(rt: SceneRuntime, path: string) {
  return rt.page
    .locator(`nav a[href="/dashboard/${rt.ctx.orgId}${path}"]`)
    .first();
}

/** The composer textbox, by this locale's aria label. */
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

/**
 * Visited by the recorder BEFORE the screencast starts: on a dev server the
 * first visit to a route compiles its chunks and fetches cold data — seconds
 * of skeleton that must never be on camera. Mirrors every surface the scenes
 * touch, including the click-only agent detail route.
 */
export async function warmup(
  page: import('@playwright/test').Page,
  ctx: import('../../lib/scene').SceneContext,
): Promise<void> {
  const content = videoContentFor(ctx.locale);
  const relaunch = ctx.projects.get(content.projects[0]?.name ?? '');
  const routes = [
    `/dashboard/${ctx.orgId}/chat`,
    `/dashboard/${ctx.orgId}/documents`,
    `/dashboard/${ctx.orgId}/automations?tab=all`,
    `/dashboard/${ctx.orgId}/automations/${TRIAGE_AUTOMATION_PATH}?tab=executions`,
    ...(relaunch
      ? [`/dashboard/${ctx.orgId}/projects/${relaunch}/tasks/board`]
      : []),
    `/dashboard/${ctx.orgId}/settings/providers`,
    `/dashboard/${ctx.orgId}/settings/governance/logs`,
    `/dashboard/${ctx.orgId}/agents`,
  ];
  for (const route of routes) {
    await page.goto(route, { waitUntil: 'load' });
    await page
      .waitForLoadState('networkidle', { timeout: 8_000 })
      .catch(() => {});
    await page.waitForTimeout(250);
  }
  // The agent DETAIL page is reachable only by click — compile it too.
  const folder = page.getByRole('row', { name: 'Chat' }).first();
  await folder.waitFor({ state: 'visible', timeout: 15_000 });
  await folder.click();
  const agent = page
    .getByRole('row')
    .filter({ hasText: ASSISTANT_NAME[ctx.locale] })
    .first();
  await agent.waitFor({ state: 'visible', timeout: 15_000 });
  await agent.click();
  await page.waitForURL(/\/agents\/[A-Za-z0-9]+/, { timeout: 15_000 });
  await page
    .waitForLoadState('networkidle', { timeout: 8_000 })
    .catch(() => {});
  // The warmup's contract: end on the take's OPENING surface, settled — the
  // recorder covers it with the title card and starts the screencast.
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
    // "This is your workspace… everything one sidebar click away."
    // The cursor walks the rail as the narration names each area.
    id: 'dashboard',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      // The app is already loaded and settled under the card — unveiling it
      // IS the scene transition. No page load happens on camera.
      await page.evaluate(() => window.__taleVideoCard?.fadeOutAndRemove(700));
      await composer(rt).waitFor({ state: 'visible', timeout: 15_000 });
      await cursor.place(1450, 700);
      await cue(1.4);
      await cursor.show();
      await cursor.hover(rail(rt, '/chat'));
      await cue(3.2);
      await cursor.hover(rail(rt, '/projects'));
      await cue(4.4);
      await cursor.hover(rail(rt, '/agents'));
      await cue(5.3);
      await cursor.hover(rail(rt, '/automations'));
      await cue(6.4);
      await cursor.hover(rail(rt, '/documents'));
      await cue(12.6);
      await cursor.click(rail(rt, '/chat'));
    },
  },
  {
    // "…attach a company document as context… and ask…" — the wow setup:
    // @-mention picker over the org's own documents, then the typed question.
    id: 'chat-ask',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(0.4);
      await cursor.click(composer(rt));
      await cue(4.0);
      await page.keyboard.type('@', { delay: 60 });
      // Scoped to the mention LISTBOX — a bare text match can resolve to a
      // thread-history row once any thread mentions the same document.
      const pickerDoc = page
        .getByRole('listbox')
        .getByRole('option', { name: videoContentFor(ctx.locale).wowSourceDoc })
        .first();
      await pickerDoc.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(5.2);
      await cursor.click(pickerDoc);
      await cue(6.6);
      await page.keyboard.type(ctx.heroPrompt, { delay: 42 });
      await cue(11.6);
      await cursor.click(sendButton(rt));
      await page.waitForURL(THREAD_URL, { timeout: 20_000 });
      const threadId = THREAD_URL.exec(page.url())?.[1];
      if (threadId) ctx.cleanup.thread(threadId);
    },
  },
  {
    // The reply streams in (reasoning first — mock gateway, paced for
    // camera); nothing to do but let it finish and point at the sources.
    id: 'chat-stream',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await sendButton(rt).waitFor({ state: 'visible', timeout: 30_000 });
      await cue(8.2);
      const source = page
        .locator('[data-message-role="assistant"] strong')
        .first();
      if (await source.isVisible().catch(() => false)) {
        await cursor.hover(source);
      }
    },
  },
  {
    // The grounding beat — the camera rests on the cited answer while the
    // narration lands the hallucination point. Stillness is the point.
    id: 'ai-grounding',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await cue(14.0);
      const source = page
        .locator('[data-message-role="assistant"] strong')
        .nth(1);
      if (await source.isVisible().catch(() => false)) {
        await cursor.hover(source);
      }
    },
  },
  {
    // Knowledge: the documents table with its Indexed badges.
    id: 'knowledge',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      const wowDoc = videoContentFor(rt.ctx.locale).wowSourceDoc;
      await cursor.click(rail(rt, '/documents'));
      await page
        .getByText(wowDoc)
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 });
      await cue(3.5);
      const row = page.getByRole('row').filter({ hasText: wowDoc }).first();
      await cursor.hover(row);
      await cue(6.5);
      await cursor.hover(
        row.getByText(rt.t('documents.rag.status.indexed')).first(),
      );
    },
  },
  {
    // Agents: open the builtin Chat folder, then the Assistant agent.
    id: 'agents',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await cursor.click(rail(rt, '/agents'));
      const folder = page.getByRole('row', { name: 'Chat' }).first();
      await folder.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(2.2);
      await cursor.click(folder);
      const agent = page
        .getByRole('row')
        .filter({ hasText: ASSISTANT_NAME[rt.ctx.locale] })
        .first();
      await agent.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(4.8);
      await cursor.click(agent);
      // The agent detail route is the unambiguous "we arrived" signal — the
      // list keeps a hidden 'Assistant' span around after navigation.
      await page.waitForURL(/\/agents\/[A-Za-z0-9]+/, { timeout: 15_000 });
    },
  },
  {
    // Automations: the catalog ("triage, drafting, routing…").
    id: 'automations',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await cursor.click(rail(rt, '/automations'));
      // "Installed" / "All automations" are links, not tabs — locale-proof
      // by their target URL.
      const allTab = page
        .locator(
          `main a[href="/dashboard/${rt.ctx.orgId}/automations?tab=all"]`,
        )
        .first();
      await allTab.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(2.0);
      await cursor.click(allTab);
      const card = page
        .getByText(RESOLVE_ISSUES_CARD_NAME[rt.ctx.locale])
        .first();
      await card.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(5.5);
      await cursor.hover(card);
    },
  },
  {
    // Approvals beat over the execution log — runs, statuses, one honest
    // failure. (A staged pending-approval card is Episode 5 material; the
    // log is where "acting on the world" is visible today.)
    id: 'approvals',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/automations/${TRIAGE_AUTOMATION_PATH}?tab=executions`,
      );
      await page
        .getByText(rt.t('common.status.completed'))
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 });
      await cue(6.0);
      const failed = page.getByText(rt.t('common.status.failed')).first();
      if (await failed.isVisible().catch(() => false)) {
        await cursor.hover(failed);
      }
    },
  },
  {
    // Projects: the relaunch board, mid-flight.
    id: 'projects',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      const content = videoContentFor(ctx.locale);
      const projectId = ctx.projects.get(content.projects[0]?.name ?? '');
      if (!projectId) {
        throw new Error(
          `No seeded project "${content.projects[0]?.name}" — seed the ${ctx.locale} org first.`,
        );
      }
      // Navigate UNDER the scene-change veil (never in the previous scene's
      // tail — the board would be on screen before its card): the ~0.6s
      // task-query skeleton resolves behind the blur and the dissolve
      // unveils a finished board.
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/projects/${projectId}/tasks/board`,
      );
      const firstTask = page.getByText(content.boardReadyTask).first();
      await firstTask.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(3.8);
      await cursor.hover(firstTask);
      await cue(6.8);
      await cursor.hover(page.getByText(content.boardHoverTask).first());
    },
  },
  {
    // Governance: providers, then the audit logs — clicked through the
    // settings navigation so the viewer sees where control lives.
    id: 'governance',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(page, `/dashboard/${ctx.orgId}/settings/providers`);
      await page
        .getByText('OpenRouter')
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 });
      await cue(4.5);
      await cursor.click(
        page.getByRole('button', { name: rt.t('navigation.governance') }),
      );
      await cue(6.2);
      await cursor.click(
        page.getByRole('link', { name: rt.t('governance.groups.logs') }),
      );
    },
  },
  {
    // Recap over the workspace at rest — cursor gone, product breathing.
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
