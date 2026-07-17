/**
 * Episode 6 choreography — the relaunch project deep dive with one live
 * centerpiece: a task created on camera, scored by the triage automation,
 * and visibly taken by the agent. The task is archived off camera
 * (`cleanupTaskTitles` + `cleanupTaskBoardUrl`); nothing else mutates.
 */

import { videoContentFor } from '../../lib/locale-content';
import {
  spaNavigate,
  type SceneChoreography,
  type SceneContext,
  type SceneRuntime,
} from '../../lib/scene';
import { CAMERA_TASK_TITLE } from './episode';

function rail(rt: SceneRuntime, path: string) {
  return rt.page
    .locator(`nav a[href="/dashboard/${rt.ctx.orgId}${path}"]`)
    .first();
}

function composer(rt: SceneRuntime) {
  return rt.page.getByRole('textbox', { name: rt.t('chat.aria.chatInput') });
}

/** The relaunch project's id from the seeded projects map. */
function relaunchId(ctx: SceneContext): string {
  const name = videoContentFor(ctx.locale).projects[0]?.name ?? '';
  const id = ctx.projects.get(name);
  if (!id) throw new Error(`No seeded project "${name}" — seed the org.`);
  return id;
}

export async function warmup(
  page: import('@playwright/test').Page,
  ctx: import('../../lib/scene').SceneContext,
): Promise<void> {
  const projectId = relaunchId(ctx);
  const routes = [
    `/dashboard/${ctx.orgId}/projects/${projectId}/tasks/board`,
    `/dashboard/${ctx.orgId}/projects/${projectId}/tasks/backlog`,
    `/dashboard/${ctx.orgId}/chat`,
  ];
  for (const route of routes) {
    await page.goto(route, { waitUntil: 'load' });
    await page
      .waitForLoadState('networkidle', { timeout: 8_000 })
      .catch(() => {});
    await page.waitForTimeout(250);
  }
  // The project's Knowledge and Discussions views are in-project navigation;
  // visit them for chunk warmth (deep links).
  for (const sub of ['files', 'discussions', 'agents']) {
    await page.goto(`/dashboard/${ctx.orgId}/projects/${projectId}/${sub}`, {
      waitUntil: 'load',
    });
    await page
      .waitForLoadState('networkidle', { timeout: 8_000 })
      .catch(() => {});
    await page.waitForTimeout(250);
  }
  // The task-create dialog chunk.
  await page.goto(`/dashboard/${ctx.orgId}/projects/${projectId}/tasks/board`, {
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
  // End settled on chat (the take's opening surface).
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
    // The board, mid-flight — deep link under the chapter veil.
    id: 'board',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await page.evaluate(() => window.__taleVideoCard?.fadeOutAndRemove(700));
      await composer(rt).waitFor({ state: 'visible', timeout: 15_000 });
      await cursor.place(1450, 700);
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/projects/${relaunchId(ctx)}/tasks/board`,
      );
      const content = videoContentFor(ctx.locale);
      const ready = page.getByText(content.boardReadyTask).first();
      await ready.waitFor({ state: 'visible', timeout: 30_000 });
      await cursor.show();
      await cue(4.0);
      await cursor.hover(ready);
      await cue(8.5);
      await cursor.hover(page.getByText(content.boardHoverTask).first());
    },
  },
  {
    // The project's own shelf: its knowledge files.
    id: 'files',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/projects/${relaunchId(ctx)}/files`,
      );
      const content = videoContentFor(ctx.locale);
      const file = page
        .getByText(content.projectFiles[0]?.fileName ?? '')
        .first();
      await file.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(4.5);
      await cursor.hover(file);
      await cue(8.0);
      await cursor.hover(
        page.getByText(content.projectFiles[1]?.fileName ?? '').first(),
      );
    },
  },
  {
    // Discussions beside the work — open the decisions thread.
    id: 'discussions',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/projects/${relaunchId(ctx)}/discussions`,
      );
      const thread = page
        .getByText(videoContentFor(ctx.locale).discussionTitle)
        .first();
      await thread.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(3.5);
      await cursor.click(thread);
      await page
        .waitForLoadState('networkidle', { timeout: 8_000 })
        .catch(() => {});
    },
  },
  {
    // The centerpiece setup: create the task, plainly.
    id: 'task-create',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/projects/${relaunchId(ctx)}/tasks/board`,
      );
      const createButton = page.getByRole('button', {
        name: rt.t('tasks.actions.create'),
      });
      await createButton.waitFor({ state: 'visible', timeout: 30_000 });
      // Register cleanup BEFORE creating — an abort still archives.
      ctx.notes.set('cleanupTaskTitles', CAMERA_TASK_TITLE[ctx.locale]);
      ctx.notes.set(
        'cleanupTaskBoardUrl',
        `/dashboard/${ctx.orgId}/projects/${relaunchId(ctx)}/tasks/board`,
      );
      await cue(2.6);
      await cursor.click(createButton);
      const dialog = page.getByRole('dialog', {
        name: rt.t('tasks.actions.create'),
      });
      await dialog.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(4.0);
      await cursor.click(
        dialog.getByRole('textbox', { name: rt.t('tasks.fields.title') }),
      );
      await page.keyboard.type(CAMERA_TASK_TITLE[ctx.locale], { delay: 44 });
      await cue(9.0);
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
    // The agent takes it: triage scores, assigns — the assignee lands on
    // the card; the dialog shows the automated reasoning comment.
    id: 'agent-takes',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      const card = page
        .locator('[aria-roledescription="sortable"]')
        .filter({ hasText: CAMERA_TASK_TITLE[ctx.locale] })
        .first();
      await cue(1.5);
      await cursor.hover(card);
      // The honest "agent took it" signal: the assignee avatar appears on
      // the card once the triage run assigns (typically a few seconds).
      await card
        .locator('img, svg, [class*="avatar"], [class*="Avatar"]')
        .first()
        .waitFor({ state: 'visible', timeout: 60_000 });
      await cue(6.5);
      await cursor.click(card);
      const dialog = page.getByRole('dialog').last();
      await dialog.waitFor({ state: 'visible', timeout: 15_000 });
      // The automated comment's REASON is per-locale mock data.
      const reason = {
        en: 'Announcement copy is drafting work',
        de: 'Ankündigungstexte sind Schreibarbeit',
        fr: 'Le texte d’annonce est un travail de rédaction',
      }[ctx.locale];
      const comment = dialog.getByText(reason).first();
      await comment.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(11.0);
      await cursor.hover(comment);
      await cue(17.5);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    },
  },
  {
    // The backlog: proposals wait for a person.
    id: 'backlog',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/projects/${relaunchId(ctx)}/tasks/backlog`,
      );
      await page
        .waitForLoadState('networkidle', { timeout: 10_000 })
        .catch(() => {});
      await cue(6.0);
      const anyRow = page.getByRole('row').nth(1);
      if (await anyRow.isVisible().catch(() => false)) {
        await cursor.hover(anyRow);
      }
    },
  },
  {
    // The project's crew: curated agents & models.
    id: 'curation',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/projects/${relaunchId(ctx)}/agents`,
      );
      await page
        .waitForLoadState('networkidle', { timeout: 10_000 })
        .catch(() => {});
      await cue(5.5);
      const assistant = page.getByText('Assistant').first();
      if (await assistant.isVisible().catch(() => false)) {
        await cursor.hover(assistant);
      }
    },
  },
  {
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
