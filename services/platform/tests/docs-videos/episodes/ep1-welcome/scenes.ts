/**
 * Episode 1 choreography — the trailer tour in tutorial grammar: every move
 * is announced by the voice BEFORE the cursor makes it, and every stop shows
 * an artifact (the streamed grounded answer, the cited file's row in
 * Knowledge, the Assistant's detail page, the triage journal). Rules of the
 * road (produce-video skill):
 *
 *  - Navigation between app surfaces is CLIENT-SIDE wherever possible — the
 *    cursor really clicks the nav rail (TanStack Router links, no reload).
 *    The URL jumps that cannot be clicked (the triage executions tab, the
 *    project board, the providers page) happen at scene start, inside a
 *    widened lead-in, so the swap sits in silence, never under narration.
 *  - Element targets are locale-proof: rail links by href, UI chrome via the
 *    locale's own catalog (`t`), seeded CONTENT via `videoContentFor`, and
 *    manifest-translated names via per-locale DATA maps — the de/fr takes
 *    run against their own natively-seeded orgs.
 *  - Every readiness wait is on state (locators), never on time.
 *
 * cue() timings are first-pass against the EN narration — tuned per locale
 * against the review sheet during the `--mock-tts` rehearsal before
 * anything bills.
 */

import { videoContentFor } from '../../lib/locale-content';
import {
  spaNavigate,
  type SceneChoreography,
  type SceneContext,
  type SceneRuntime,
} from '../../lib/scene';

/** The builtin assistant's display name ships per locale
 * (builtin-configs/agents/chat/assistant.json). */
const ASSISTANT_NAME = {
  en: 'Assistant',
  de: 'Assistent',
  fr: 'Assistant',
} as const;

/** The hidden autoInstall triage automation (docs-screenshots contract). */
const TRIAGE_AUTOMATION_PATH = 'projects__tasks__triage-unassigned';

/** Catalog card names are locale-resolved DATA: the grid renders each
 * automation.json's `i18n` block, so anchors must speak the take's locale —
 * an English anchor fails every de/fr take. Values quote the manifests
 * (fixtures config/default). */
const CATALOG_CARD_NAME = {
  resolveGithubIssues: {
    en: 'Resolve GitHub issues',
    de: 'GitHub-Issues lösen',
    fr: 'Résoudre les issues GitHub',
  },
  syncGmailEmails: {
    en: 'Sync Gmail emails',
    de: 'Gmail-E-Mails synchronisieren',
    fr: 'Synchroniser les e-mails Gmail',
  },
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
  ctx: SceneContext,
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
    // Cold open: the card reveals over the settled chat, and lifts as the
    // voice reaches "Here's where we start" — the surface must be VISIBLE
    // while the narration names it, not hidden until the next scene.
    id: 'title',
    run: async (rt) => {
      const { page, cue } = rt;
      await page.evaluate(() => window.__taleVideoCard?.reveal());
      await cue(12.5);
      await page.evaluate(() => window.__taleVideoCard?.fadeOutAndRemove(700));
    },
  },
  {
    // "…read the sidebar" — the cursor walks the rail top to bottom as the
    // narration names each area, in tour order. No navigation yet.
    id: 'dashboard',
    run: async (rt) => {
      const { cursor, cue } = rt;
      await composer(rt).waitFor({ state: 'visible', timeout: 15_000 });
      await cursor.place(1450, 700);
      await cue(1.4);
      await cursor.show();
      await cue(4.6);
      await cursor.hover(rail(rt, '/chat'));
      await cue(5.8);
      await cursor.hover(rail(rt, '/projects'));
      await cue(6.8);
      await cursor.hover(rail(rt, '/agents'));
      await cue(7.8);
      await cursor.hover(rail(rt, '/automations'));
      await cue(9.8);
      await cursor.hover(rail(rt, '/documents'));
    },
  },
  {
    // The hero ask. The chapter scene does its OWN navigation: the rail
    // click opens the (already-current) chat route on camera, then the
    // @-mention picker attaches the org's own document, then the question.
    id: 'chat-ask',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(1.0);
      await cursor.click(rail(rt, '/chat'));
      await composer(rt).waitFor({ state: 'visible', timeout: 15_000 });
      await cue(5.8);
      await cursor.click(composer(rt));
      await cue(8.6);
      await page.keyboard.type('@', { delay: 60 });
      // Scoped to the mention LISTBOX — a bare text match can resolve to a
      // thread-history row once any thread mentions the same document.
      const pickerDoc = page
        .getByRole('listbox')
        .getByRole('option', { name: videoContentFor(ctx.locale).wowSourceDoc })
        .first();
      await pickerDoc.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(10.2);
      await cursor.click(pickerDoc);
      await cue(11.8);
      await page.keyboard.type(ctx.heroPrompt, { delay: 42 });
      await cue(15.4);
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
      await cue(10.6);
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
      await cue(13.6);
      const source = page
        .locator('[data-message-role="assistant"] strong')
        .nth(1);
      if (await source.isVisible().catch(() => false)) {
        await cursor.hover(source);
      }
    },
  },
  {
    // Close the loop: find the exact file the answer cited. The row is the
    // artifact; the Indexed badge is the "ready" evidence.
    id: 'knowledge',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      const wowDoc = videoContentFor(rt.ctx.locale).wowSourceDoc;
      await cue(5.4);
      await cursor.click(rail(rt, '/documents'));
      await page
        .getByText(wowDoc)
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 });
      const row = page.getByRole('row').filter({ hasText: wowDoc }).first();
      await cue(8.4);
      await cursor.hover(row);
      await cue(10.2);
      const badge = row.getByText(rt.t('documents.rag.status.indexed')).first();
      if (await badge.isVisible().catch(() => false)) {
        await cursor.hover(badge);
      }
    },
  },
  {
    // Agents: open the builtin Chat folder, then the Assistant — the agent
    // behind the reply we just read.
    id: 'agents',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await cue(3.4);
      await cursor.click(rail(rt, '/agents'));
      const folder = page.getByRole('row', { name: 'Chat' }).first();
      await folder.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(5.6);
      await cursor.click(folder);
      const agent = page
        .getByRole('row')
        .filter({ hasText: ASSISTANT_NAME[rt.ctx.locale] })
        .first();
      await agent.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(7.4);
      await cursor.click(agent);
      // The agent detail route is the unambiguous "we arrived" signal — the
      // list keeps a hidden 'Assistant' span around after navigation.
      await page.waitForURL(/\/agents\/[A-Za-z0-9]+/, { timeout: 15_000 });
    },
  },
  {
    // Automations: the catalog ("syncing a mailbox… resolving issues"),
    // then a glance at the Installed tab link — the signpost into the
    // triage journal the next scene opens.
    id: 'automations',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(4.4);
      await cursor.click(rail(rt, '/automations'));
      // "Installed" / "All automations" are links, not tabs — locale-proof
      // by their target URL.
      const allTab = page
        .locator(`main a[href="/dashboard/${ctx.orgId}/automations?tab=all"]`)
        .first();
      await allTab.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(6.0);
      await cursor.click(allTab);
      const gmail = page
        .getByText(CATALOG_CARD_NAME.syncGmailEmails[ctx.locale])
        .first();
      await gmail.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(8.8);
      await cursor.hover(gmail);
      await cue(10.2);
      await cursor.hover(
        page
          .getByText(CATALOG_CARD_NAME.resolveGithubIssues[ctx.locale])
          .first(),
      );
      await cue(12.8);
      const installedTab = page
        .locator(
          `main a[href="/dashboard/${ctx.orgId}/automations?tab=installed"]`,
        )
        .first();
      if (await installedTab.isVisible().catch(() => false)) {
        await cursor.hover(installedTab);
      }
    },
  },
  {
    // The triage journal — the deep executions tab cannot be clicked, so
    // the jump happens at scene start inside the widened lead-in. Rows are
    // anchored as ROWS (an expanded neighbour's JSON can contain the same
    // status words — the ep5 lesson).
    id: 'approvals',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/automations/${TRIAGE_AUTOMATION_PATH}?tab=executions`,
      );
      const completed = page
        .getByRole('row')
        .filter({ hasText: rt.t('common.status.completed') })
        .first();
      await completed.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(3.0);
      await cursor.hover(completed);
      await cue(6.8);
      const failed = page
        .getByRole('row')
        .filter({ hasText: rt.t('common.status.failed') })
        .first();
      if (await failed.isVisible().catch(() => false)) {
        await cursor.hover(failed);
      }
    },
  },
  {
    // Projects: the relaunch board, mid-flight (cut under the veil).
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
      await cue(5.2);
      await cursor.hover(firstTask);
      await cue(8.8);
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
      await cue(3.0);
      await cursor.hover(page.getByText('OpenRouter').first());
      await cue(9.2);
      await cursor.click(
        page.getByRole('button', { name: rt.t('navigation.governance') }),
      );
      await cue(10.8);
      await cursor.click(
        page.getByRole('link', { name: rt.t('governance.groups.logs') }),
      );
      const row = page.getByRole('row').nth(1);
      const arrived = await row
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      await cue(12.8);
      if (arrived) {
        await cursor.hover(row);
      }
    },
  },
  {
    // Recap over the workspace at rest — cursor gone, product breathing.
    id: 'recap',
    run: async (rt) => {
      const { cursor, cue } = rt;
      await cue(1.2);
      await cursor.click(rail(rt, '/chat'));
      await composer(rt).waitFor({ state: 'visible', timeout: 30_000 });
      await cue(3.4);
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
