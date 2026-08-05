/**
 * Episode 5 choreography — the in-depth automations guide. Real work on
 * camera: the bundle preview panel opened, the triage workflow read
 * (editor → score step → triggers → tester), a task created live on the
 * board and auto-assigned by the running automation, its journal opened,
 * the seeded red run diagnosed, and a pending `request_human_input`
 * approval decided. On-camera creations (task, chat thread) register on
 * `ctx.cleanup` the moment they exist; nothing else mutates.
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
import { APPROVAL_FIELD_TEXT, CAMERA_TASK_TITLE } from './episode';

/** The hidden autoInstall triage automation (docs-screenshots contract). */
const TRIAGE_AUTOMATION_PATH = 'projects__tasks__triage-unassigned';

/** The approval card's field label — mock DATA per locale (docs-replies). */
const APPROVAL_FIELD_LABEL = {
  en: 'Final adjustments',
  de: 'Letzte Anpassungen',
  fr: 'Derniers ajustements',
} as const;

/** Catalog card names are locale-resolved DATA: the grid renders each
 * automation.json's `i18n` block, so anchors must speak the take's locale —
 * an English anchor fails every de/fr take (and before the grid fix, it
 * silently PASSED on the untranslated cards). Values quote the manifests
 * (fixtures config/default + builtin triage-unassigned). */
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
  triageUnassigned: {
    en: 'Triage unassigned tasks',
    de: 'Unzugewiesene Aufgaben sichten',
    fr: 'Trier les tâches non assignées',
  },
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

function composer(rt: SceneRuntime) {
  return rt.page.getByRole('textbox', { name: rt.t('chat.aria.chatInput') });
}

function sendButton(rt: SceneRuntime) {
  return rt.page.getByRole('button', {
    name: rt.t('chat.send'),
    exact: true,
  });
}

/** The relaunch project's id from the seeded projects map. */
function relaunchId(ctx: SceneContext): string {
  const name = videoContentFor(ctx.locale).projects[0]?.name ?? '';
  const id = ctx.projects.get(name);
  if (!id) throw new Error(`No seeded project "${name}" — seed the org.`);
  return id;
}

const THREAD_URL = /\/chat\/([A-Za-z0-9]{16,})(?:[/?#]|$)/;

export async function warmup(
  page: import('@playwright/test').Page,
  ctx: SceneContext,
): Promise<void> {
  const projectId = (() => {
    const name = videoContentFor(ctx.locale).projects[0]?.name ?? '';
    return ctx.projects.get(name) ?? '';
  })();
  const routes = [
    `/dashboard/${ctx.orgId}/projects/${projectId}/tasks/board`,
    `/dashboard/${ctx.orgId}/automations?tab=installed`,
    `/dashboard/${ctx.orgId}/automations?tab=all`,
    `/dashboard/${ctx.orgId}/automations/${TRIAGE_AUTOMATION_PATH}`,
    `/dashboard/${ctx.orgId}/automations/${TRIAGE_AUTOMATION_PATH}?tab=editor`,
    `/dashboard/${ctx.orgId}/automations/${TRIAGE_AUTOMATION_PATH}?tab=triggers`,
    `/dashboard/${ctx.orgId}/settings/governance/logs`,
    `/dashboard/${ctx.orgId}/chat`,
    // Last: the cold-open surface — the title card reveals over the journal.
    `/dashboard/${ctx.orgId}/automations/${TRIAGE_AUTOMATION_PATH}?tab=executions`,
  ];
  for (const route of routes) {
    await page.goto(route, { waitUntil: 'load' });
    await page
      .waitForLoadState('networkidle', { timeout: 8_000 })
      .catch(() => {});
    await page.waitForTimeout(250);
  }
}

export const SCENES: readonly SceneChoreography[] = [
  {
    // Cold open: the card reveals over the run journal (the end state).
    id: 'title',
    run: async (rt) => {
      const { page, cue } = rt;
      await page.evaluate(() => window.__taleVideoCard?.reveal());
      // The card lifts as the voice reaches "This page — the run journal" —
      // the surface must be VISIBLE while the narration names it, not hidden
      // behind the card until the next scene.
      await cue(17.0);
      await page.evaluate(() => window.__taleVideoCard?.fadeOutAndRemove(700));
    },
  },
  {
    // The job: the board with unowned To-do tasks (cut under the veil).
    id: 'context',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/projects/${relaunchId(ctx)}/tasks/board`,
      );
      const content = videoContentFor(ctx.locale);
      const ready = page.getByText(content.boardReadyTask).first();
      await ready.waitFor({ state: 'visible', timeout: 30_000 });
      await cursor.place(1450, 700);
      await cue(1.2);
      await cursor.show();
      await cue(6.0);
      await cursor.hover(ready);
    },
  },
  {
    // Where automations come from: rail click, All tab, two bundles.
    id: 'catalog',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await cue(2.5);
      await cursor.click(rail(rt, '/automations'));
      const allTab = page
        .locator(
          `main a[href="/dashboard/${rt.ctx.orgId}/automations?tab=all"]`,
        )
        .first();
      await allTab.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(5.5);
      await cursor.click(allTab);
      const github = page
        .getByText(CATALOG_CARD_NAME.resolveGithubIssues[rt.ctx.locale])
        .first();
      await github.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(9.0);
      await cursor.hover(github);
      await cue(12.0);
      await cursor.hover(
        page
          .getByText(CATALOG_CARD_NAME.syncGmailEmails[rt.ctx.locale])
          .first(),
      );
    },
  },
  {
    // A real click: the bundle's preview panel — what installing would add.
    id: 'panel',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      const card = page
        .getByRole('button', {
          name: CATALOG_CARD_NAME.resolveGithubIssues[ctx.locale],
        })
        .first();
      await cue(2.0);
      await cursor.click(card);
      const panel = page.getByRole('dialog').last();
      await panel.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(7.0);
      const contents = panel
        .getByText(CATALOG_CARD_NAME.resolveGithubIssues[ctx.locale])
        .first();
      if (await contents.isVisible().catch(() => false)) {
        await cursor.hover(contents);
      }
      await cue(12.5);
      await page.keyboard.press('Escape');
      await panel.waitFor({ state: 'hidden', timeout: 10_000 });
    },
  },
  {
    // The installed triage automation, opened from the Installed tab.
    id: 'installed',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      const installedTab = page
        .locator(
          `main a[href="/dashboard/${ctx.orgId}/automations?tab=installed"]`,
        )
        .first();
      await cue(1.0);
      await cursor.click(installedTab);
      const triage = page
        .getByRole('button', {
          name: CATALOG_CARD_NAME.triageUnassigned[ctx.locale],
        })
        .first();
      await triage.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(7.5);
      await cursor.click(triage);
      await page.waitForURL(new RegExp(`/automations/`), { timeout: 15_000 });
    },
  },
  {
    // The workflow, readable before it runs — editor tab under the veil.
    id: 'editor',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/automations/${TRIAGE_AUTOMATION_PATH}?tab=editor`,
      );
      await page
        .waitForLoadState('networkidle', { timeout: 10_000 })
        .catch(() => {});
      await cue(6.5);
      const trigger = page.getByText(/task/i).first();
      if (await trigger.isVisible().catch(() => false)) {
        await cursor.hover(trigger);
      }
      await cue(10.0);
      const stepNode = page.getByText('score', { exact: false }).first();
      if (await stepNode.isVisible().catch(() => false)) {
        await cursor.hover(stepNode);
      }
    },
  },
  {
    // The score step opened: structured output, the schema safety net.
    id: 'step-detail',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      const stepNode = page.getByText('score', { exact: false }).first();
      await cue(1.5);
      if (await stepNode.isVisible().catch(() => false)) {
        await cursor.click(stepNode);
      }
      await page
        .waitForLoadState('networkidle', { timeout: 6_000 })
        .catch(() => {});
      await cue(8.0);
      const schema = page.getByText(/confidence/i).first();
      if (await schema.isVisible().catch(() => false)) {
        await cursor.hover(schema);
      }
      await cue(16.5);
      await page.keyboard.press('Escape');
    },
  },
  {
    // When it wakes up: the Triggers tab, on camera.
    id: 'trigger',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await cue(1.0);
      await cursor.click(pageTab(rt, 'triggers'));
      await page
        .waitForLoadState('networkidle', { timeout: 8_000 })
        .catch(() => {});
      await cue(5.0);
      const eventRow = page.getByText(/task\.created/i).first();
      if (await eventRow.isVisible().catch(() => false)) {
        await cursor.hover(eventRow);
      }
    },
  },
  {
    // The tester, read honestly: input shape + Execute; the real trigger next.
    id: 'tester',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await cue(1.2);
      await cursor.click(pageTab(rt, 'editor'));
      const testButton = page
        .getByRole('button', {
          name: rt.t('workflows.steps.toolbar.testWorkflow'),
        })
        .first();
      await testButton.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(3.5);
      await cursor.click(testButton);
      const input = page.getByText(rt.t('workflows.tester.inputLabel')).first();
      await input.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(8.0);
      await cursor.hover(input);
      await cue(13.0);
      const execute = page
        .getByRole('button', { name: rt.t('workflows.tester.execute') })
        .first();
      if (await execute.isVisible().catch(() => false)) {
        await cursor.hover(execute);
      }
      await page.keyboard.press('Escape');
    },
  },
  {
    // The real trigger: create the task on the board, hands off, the
    // assignee lands by itself. minMs floors the triage-run wait — bump it
    // at rehearsal if assignment regularly lands after the narration.
    id: 'for-real',
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
      ctx.cleanup.task(
        CAMERA_TASK_TITLE[ctx.locale],
        `/dashboard/${ctx.orgId}/projects/${relaunchId(ctx)}/tasks/board`,
      );
      await cue(1.8);
      await cursor.click(createButton);
      const dialog = page.getByRole('dialog', {
        name: rt.t('tasks.actions.create'),
      });
      await dialog.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(3.5);
      await cursor.click(
        dialog.getByRole('textbox', { name: rt.t('tasks.fields.title') }),
      );
      await page.keyboard.type(CAMERA_TASK_TITLE[ctx.locale], { delay: 46 });
      await cue(8.0);
      await cursor.click(
        dialog.getByRole('button', { name: rt.t('tasks.actions.create') }),
      );
      await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
      const card = page
        .locator('[aria-roledescription="sortable"]')
        .filter({ hasText: CAMERA_TASK_TITLE[ctx.locale] })
        .first();
      await card.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(11.5);
      await cursor.hover(card);
      // The honest "the automation took it" signal: the assignee avatar.
      await card
        .locator('img, svg, [class*="avatar"], [class*="Avatar"]')
        .first()
        .waitFor({ state: 'visible', timeout: 60_000 });
    },
  },
  {
    // Back to the journal ON CAMERA — the viewer learns the path.
    id: 'live-journal',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(1.8);
      await cursor.click(rail(rt, '/automations'));
      const triage = page
        .getByRole('button', {
          name: CATALOG_CARD_NAME.triageUnassigned[ctx.locale],
        })
        .first();
      await triage.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(4.5);
      await cursor.click(triage);
      await page.waitForURL(new RegExp(`/automations/`), { timeout: 15_000 });
      await cue(7.0);
      await cursor.click(pageTab(rt, 'executions'));
      // Row-scoped like the failure scene: after expanding, the first
      // "Completed" TEXT node may sit inside the expanded detail, not the
      // row header — the collapse click needs the row itself.
      const completed = page
        .getByRole('row')
        .filter({ hasText: rt.t('common.status.completed') })
        .first();
      await completed.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(10.5);
      await cursor.click(completed);
      await page
        .waitForLoadState('networkidle', { timeout: 8_000 })
        .catch(() => {});
      await cue(16.0);
      const reason = page.getByText(/0[.,]8/).first();
      if (await reason.isVisible().catch(() => false)) {
        await cursor.hover(reason);
      }
      // Close the run again — the next scene clicks the FAILED row, and an
      // expanded run above it reflows the list mid-click (the cursor landed
      // between rows on camera) and pollutes page-wide text matches.
      await cue(20.0);
      await cursor.click(completed);
      await page.waitForTimeout(500);
    },
  },
  {
    // The honest red run — back to the list, then the failure opened.
    id: 'failure',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await cursor.click(pageTab(rt, 'executions'));
      // Anchor the ROW, not any text node — an expanded neighbour's JSON can
      // contain the same words, and a text-node match re-measured mid-reflow
      // dropped the click between rows on camera. Let the list settle first.
      const failed = page
        .getByRole('row')
        .filter({ hasText: rt.t('common.status.failed') })
        .first();
      await failed.waitFor({ state: 'visible', timeout: 15_000 });
      await page.waitForTimeout(500);
      await cue(3.5);
      await cursor.click(failed);
      await page
        .waitForLoadState('networkidle', { timeout: 8_000 })
        .catch(() => {});
      await cue(11.0);
      const errorText = page.getByText(/validation|schema/i).first();
      if (await errorText.isVisible().catch(() => false)) {
        await cursor.hover(errorText);
      }
    },
  },
  {
    // The fix path: journal → step (prompt + schema) → Configuration.
    id: 'diagnose',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await cue(2.0);
      await cursor.click(pageTab(rt, 'editor'));
      await page
        .waitForLoadState('networkidle', { timeout: 8_000 })
        .catch(() => {});
      await cue(5.0);
      const stepNode = page.getByText('score', { exact: false }).first();
      if (await stepNode.isVisible().catch(() => false)) {
        await cursor.hover(stepNode);
      }
      await cue(9.5);
      await cursor.click(pageTab(rt, 'configuration'));
      await page
        .waitForLoadState('networkidle', { timeout: 8_000 })
        .catch(() => {});
    },
  },
  {
    // The approval: ask for a gated send; the draft streams, then stops.
    id: 'approval',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(8.5);
      await cursor.click(rail(rt, '/chat'));
      await composer(rt).waitFor({ state: 'visible', timeout: 30_000 });
      await cue(10.5);
      await cursor.click(composer(rt));
      await page.keyboard.type(ctx.heroPrompt, { delay: 30 });
      await cue(15.5);
      await cursor.click(sendButton(rt));
      await page.waitForURL(THREAD_URL, { timeout: 20_000 });
      const threadId = THREAD_URL.exec(page.url())?.[1];
      if (threadId) ctx.cleanup.thread(threadId);
      // The pending card carries the draft; wait on its field label — the
      // hover follows the card's own appearance, not a narration second.
      const field = page
        .getByRole('textbox', { name: APPROVAL_FIELD_LABEL[ctx.locale] })
        .first();
      await field.waitFor({ state: 'visible', timeout: 60_000 });
      await cursor.hover(field);
    },
  },
  {
    // Read, add the note, submit — only now does the mail go out.
    id: 'card',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      const field = page
        .getByRole('textbox', { name: APPROVAL_FIELD_LABEL[ctx.locale] })
        .first();
      await cue(3.5);
      await cursor.click(field);
      await page.keyboard.type(APPROVAL_FIELD_TEXT[ctx.locale], { delay: 34 });
      await cue(8.5);
      await cursor.click(
        page.getByRole('button', {
          name: rt.t('automations.runs.ask.submit'),
          exact: true,
        }),
      );
      // The resumed turn streams the ack.
      await sendButton(rt).waitFor({ state: 'visible', timeout: 30_000 });
    },
  },
  {
    // The decision, on the record — the audit log under Settings.
    id: 'verify',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/settings/governance/logs`,
      );
      const row = page.getByRole('row').nth(1);
      await row.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(5.5);
      await cursor.hover(row);
    },
  },
  {
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
