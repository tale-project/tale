/**
 * Episode 6 choreography — the in-depth projects guide. Real work on
 * camera: a task created on the relaunch board (cleanup pre-registered),
 * the triage automation's assignment watched hands-off (the avatar lands
 * and the card changes columns by itself), the reasoning comment opened
 * and pointed at, the run traced in the automation's Executions on camera
 * (the ep5 path), the seeded below-the-bar task opened to show the
 * SUGGESTION comment triage left instead of an assignment, then files,
 * and the two-outcome board read. Only the
 * on-camera task mutates; it registers on `ctx.cleanup` before it exists.
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
import { CAMERA_TASK_TITLE } from './episode';

/** The hidden autoInstall triage automation (docs-screenshots contract). */
const TRIAGE_AUTOMATION_PATH = 'projects__tasks__triage-unassigned';

/** The installed-grid card name is locale-resolved DATA (the automation
 * manifest's `i18n` block) — an English anchor fails the de/fr takes.
 * Values quote builtin-configs/automations/projects/tasks/triage-unassigned. */
const TRIAGE_CARD_NAME = {
  en: 'Triage unassigned tasks',
  de: 'Unzugewiesene Aufgaben sichten',
  fr: 'Trier les tâches non assignées',
} as const;

/** A distinctive snippet of the on-camera task's assignment REASON — mock
 * DATA per locale (DOCS_TRIAGE_SCORES, the 0.82 'launch announcement'
 * triplet). The automation posts it as the auto-assign comment, and the
 * same text appears in the run journal's score step. */
const ASSIGN_REASON = {
  en: 'Announcement copy is drafting work',
  de: 'Ankündigungstexte sind Schreibarbeit',
  fr: 'Le texte d’annonce est un travail de rédaction',
} as const;

/** The seeded below-the-bar task (confidence 0.55 → the suggestion branch;
 * DOCS_TRIAGE_SCORES). EN is seeded by the docs-screenshots seeder; de/fr
 * are staged trigger tasks of the locale orgs (locale-content stagedTasks
 * + seed-locale-orgs) — the take waits on the card, so an un-reseeded org
 * fails loudly instead of recording the wrong story. */
const SUGGESTION_TASK_TITLE = {
  en: 'Sign off the launch checklist',
  de: 'Go-live-Freigabe erteilen',
  fr: 'Donner le feu vert à la mise en ligne',
} as const;

/** A distinctive snippet of the suggestion comment's REASON (the 0.55
 * DOCS_TRIAGE_SCORES triplet) — guarded hovers only: the comment is seeded
 * state, not produced by this take. */
const SUGGESTION_REASON = {
  en: 'needs the release owner',
  de: 'liegt beim Release-Verantwortlichen',
  fr: 'revient au responsable du lancement',
} as const;

function rail(rt: SceneRuntime, path: string) {
  return rt.page
    .locator(`nav a[href="/dashboard/${rt.ctx.orgId}${path}"]`)
    .first();
}

/** An automation-page tab, located by target URL — immune to locale. The
 * Editor tab is the DEFAULT tab: its link carries the bare automation path,
 * no `?tab=` param. */
function pageTab(rt: SceneRuntime, tab: string) {
  const base = `/dashboard/${rt.ctx.orgId}/automations/${TRIAGE_AUTOMATION_PATH}`;
  const href = tab === 'editor' ? base : `${base}?tab=${tab}`;
  return rt.page.locator(`main a[href="${href}"]`).first();
}

/** The relaunch project's id from the seeded projects map. */
function relaunchId(ctx: SceneContext): string {
  const name = videoContentFor(ctx.locale).projects[0]?.name ?? '';
  const id = ctx.projects.get(name);
  if (!id) throw new Error(`No seeded project "${name}" — seed the org.`);
  return id;
}

function boardPath(ctx: SceneContext): string {
  return `/dashboard/${ctx.orgId}/projects/${relaunchId(ctx)}/tasks/board`;
}

/** A board card by its (locale-DATA) title. */
function taskCard(rt: SceneRuntime, title: string) {
  return rt.page
    .locator('[aria-roledescription="sortable"]')
    .filter({ hasText: title })
    .first();
}

/**
 * Warm every surface the take visits: the board (plus its create dialog),
 * the automations grid, the triage automation page with its Executions
 * tab, and the project's files. Ends settled on the BOARD — the cold-open
 * surface the title card reveals over.
 */
export async function warmup(
  page: import('@playwright/test').Page,
  ctx: SceneContext,
): Promise<void> {
  const projectId = relaunchId(ctx);
  const base = `/dashboard/${ctx.orgId}`;
  const routes = [
    `${base}/projects/${projectId}/tasks/board`,
    `${base}/automations?tab=installed`,
    // The triage card click lands on the DEFAULT (editor) tab first.
    `${base}/automations/${TRIAGE_AUTOMATION_PATH}`,
    `${base}/automations/${TRIAGE_AUTOMATION_PATH}?tab=executions`,
    `${base}/projects/${projectId}/files`,
  ];
  for (const route of routes) {
    await page.goto(route, { waitUntil: 'load' });
    await page
      .waitForLoadState('networkidle', { timeout: 8_000 })
      .catch(() => {});
    await page.waitForTimeout(250);
  }
  // The task-create dialog chunk, warmed and dismissed on the board.
  await page.goto(`${base}/projects/${projectId}/tasks/board`, {
    waitUntil: 'load',
  });
  const { localeT } = await import('../../lib/i18n');
  const t = localeT(ctx.locale);
  const createButton = page.getByRole('button', {
    name: t('tasks.actions.create'),
  });
  await createButton.waitFor({ state: 'visible', timeout: 15_000 });
  await createButton.click();
  await page
    .getByRole('dialog', { name: t('tasks.actions.create') })
    .waitFor({ state: 'visible', timeout: 15_000 });
  await page.keyboard.press('Escape');
  // End settled on the board — the cold-open surface.
  await createButton.waitFor({ state: 'visible', timeout: 15_000 });
  await page
    .waitForLoadState('networkidle', { timeout: 8_000 })
    .catch(() => {});
  await page.waitForTimeout(250);
}

export const SCENES: readonly SceneChoreography[] = [
  {
    // Cold open: the card reveals over the relaunch board (the end state).
    id: 'title',
    run: async (rt) => {
      const { page, cue } = rt;
      await page.evaluate(() => window.__taleVideoCard?.reveal());
      // The card lifts as the voice reaches "This board — the website
      // relaunch" — the surface must be VISIBLE while the narration names
      // it, never hidden behind the card until the next scene.
      await cue(16.0);
      await page.evaluate(() => window.__taleVideoCard?.fadeOutAndRemove(700));
    },
  },
  {
    // The board's geography: columns, shared ownership, the avatar signal.
    id: 'meet-board',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      const content = videoContentFor(ctx.locale);
      const ready = page.getByText(content.boardReadyTask).first();
      await ready.waitFor({ state: 'visible', timeout: 30_000 });
      await cursor.place(1450, 700);
      await cue(1.0);
      await cursor.show();
      // The voice walks the columns, then the shared-ownership point.
      await cue(4.5);
      await cursor.hover(ready);
      await cue(10.5);
      await cursor.hover(page.getByText(content.boardHoverTask).first());
    },
  },
  {
    // Task 1: create the task, plainly — cleanup registered BEFORE the
    // click, so an aborted take still archives it.
    id: 'task-create',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      const createButton = page.getByRole('button', {
        name: rt.t('tasks.actions.create'),
      });
      await createButton.waitFor({ state: 'visible', timeout: 30_000 });
      ctx.cleanup.task(CAMERA_TASK_TITLE[ctx.locale], boardPath(ctx));
      await cue(2.6);
      await cursor.click(createButton);
      const dialog = page.getByRole('dialog', {
        name: rt.t('tasks.actions.create'),
      });
      await dialog.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(4.2);
      await cursor.click(
        dialog.getByRole('textbox', { name: rt.t('tasks.fields.title') }),
      );
      await page.keyboard.type(CAMERA_TASK_TITLE[ctx.locale], { delay: 44 });
      await cue(9.5);
      await cursor.click(
        dialog.getByRole('button', { name: rt.t('tasks.actions.create') }),
      );
      await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
      await page
        .getByText(CAMERA_TASK_TITLE[ctx.locale])
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 });
    },
  },
  {
    // Hands off: the triage run assigns and the avatar lands by itself
    // (the card also acks into In progress — the cursor follows it).
    // minMs floors the wait; bump it at rehearsal if the assignment
    // regularly lands after the narration.
    id: 'assigned',
    run: async (rt) => {
      const { cursor, cue, ctx } = rt;
      const card = taskCard(rt, CAMERA_TASK_TITLE[ctx.locale]);
      await cue(1.5);
      await cursor.hover(card);
      // The honest "an agent took it" signal: the assignee avatar.
      const avatar = card
        .locator('img, svg, [class*="avatar"], [class*="Avatar"]')
        .first();
      await avatar.waitFor({ state: 'visible', timeout: 60_000 });
      await cue(13.0);
      await cursor.hover(avatar);
    },
  },
  {
    // The meaning: open the card; the automation's reasoning comment is
    // per-locale mock data — posted BEFORE the assign step, so it exists
    // the moment the avatar does.
    id: 'reasoning',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(3.0);
      await cursor.click(taskCard(rt, CAMERA_TASK_TITLE[ctx.locale]));
      const dialog = page.getByRole('dialog').last();
      await dialog.waitFor({ state: 'visible', timeout: 15_000 });
      const comment = dialog.getByText(ASSIGN_REASON[ctx.locale]).first();
      await comment.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(7.0);
      await cursor.hover(comment);
      await cue(21.0);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    },
  },
  {
    // Task 2: the why, traced ON CAMERA — rail → Automations → triage →
    // Executions. The viewer re-walks the ep5 path.
    id: 'trace-why',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(4.5);
      await cursor.click(rail(rt, '/automations'));
      const triage = page
        .getByRole('button', { name: TRIAGE_CARD_NAME[ctx.locale] })
        .first();
      await triage.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(8.0);
      await cursor.click(triage);
      await page.waitForURL(/\/automations\//, { timeout: 15_000 });
      await cue(11.0);
      await cursor.click(pageTab(rt, 'executions'));
      const completed = page
        .getByRole('row')
        .filter({ hasText: rt.t('common.status.completed') })
        .first();
      await completed.waitFor({ state: 'visible', timeout: 30_000 });
    },
  },
  {
    // The newest completed run is the on-camera task's — opened; the
    // confidence (0.82) and the reason pointed at (journal DATA, guarded).
    id: 'run-detail',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      // Row-scoped anchor (ep5 lesson): let the list settle before the
      // click — a text node re-measured mid-reflow drops between rows.
      const completed = page
        .getByRole('row')
        .filter({ hasText: rt.t('common.status.completed') })
        .first();
      await completed.waitFor({ state: 'visible', timeout: 15_000 });
      await page.waitForTimeout(500);
      await cue(4.2);
      await cursor.click(completed);
      await page
        .waitForLoadState('networkidle', { timeout: 8_000 })
        .catch(() => {});
      await cue(8.5);
      const confidence = page.getByText(/0[.,]82/).first();
      if (await confidence.isVisible().catch(() => false)) {
        await cursor.hover(confidence);
      }
      await cue(12.5);
      const reason = page.getByText(ASSIGN_REASON[ctx.locale]).first();
      if (await reason.isVisible().catch(() => false)) {
        await cursor.hover(reason);
      }
    },
  },
  {
    // Task 3, the pitfall beat: back on the board (cut), the seeded
    // below-the-bar task sits in To do with no avatar. The hard wait is
    // the honest gate — an org missing the staged task fails the take
    // instead of recording the wrong story.
    id: 'left-alone',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(page, boardPath(ctx));
      await page
        .getByText(SUGGESTION_TASK_TITLE[ctx.locale])
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 });
      await cue(5.0);
      await cursor.hover(taskCard(rt, SUGGESTION_TASK_TITLE[ctx.locale]));
    },
  },
  {
    // What triage did instead: the suggestion comment — confidence 0.55,
    // the reason, and the decision left with people. The comment is seeded
    // state (created at seed/staging time), so its hovers stay GUARDED.
    id: 'suggestion',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(1.8);
      await cursor.click(taskCard(rt, SUGGESTION_TASK_TITLE[ctx.locale]));
      const dialog = page.getByRole('dialog').last();
      await dialog.waitFor({ state: 'visible', timeout: 15_000 });
      const reason = dialog.getByText(SUGGESTION_REASON[ctx.locale]).first();
      const commentSeen = await reason
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      await cue(6.0);
      const confidence = dialog.getByText(/0[.,]55/).first();
      if (await confidence.isVisible().catch(() => false)) {
        await cursor.hover(confidence);
      }
      await cue(10.5);
      if (commentSeen) {
        await cursor.hover(reason);
      }
      await cue(19.0);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    },
  },
  {
    // Task 4a: the project's files — the bounded context the assignment
    // reason itself cited (runbook first, then the content inventory).
    id: 'files',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/projects/${relaunchId(ctx)}/files`,
      );
      const content = videoContentFor(ctx.locale);
      const inventory = page
        .getByText(content.projectFiles[0]?.fileName ?? '')
        .first();
      await inventory.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(5.0);
      await cursor.hover(
        page.getByText(content.projectFiles[1]?.fileName ?? '').first(),
      );
      await cue(9.0);
      await cursor.hover(inventory);
    },
  },
  {
    // Verify: both outcomes on one board — the assigned card wears the
    // agent's avatar, the suggestion card wears none.
    id: 'verify',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(page, boardPath(ctx));
      const assigned = taskCard(rt, CAMERA_TASK_TITLE[ctx.locale]);
      await assigned.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(4.0);
      await cursor.hover(assigned);
      await cue(9.5);
      await cursor.hover(taskCard(rt, SUGGESTION_TASK_TITLE[ctx.locale]));
    },
  },
  {
    // Recap over the two-outcome board — stillness.
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
