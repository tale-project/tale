/**
 * Episode 5 choreography — the triage automation opened up (catalog →
 * detail → editor → executions → the red run), then the approval card: a
 * real pending `request_human_input` approval, decided on camera. The chat
 * thread is registered for off-camera cleanup; nothing else mutates.
 */

import {
  spaNavigate,
  type SceneChoreography,
  type SceneContext,
  type SceneRuntime,
} from '../../lib/scene';
import { APPROVAL_FIELD_TEXT } from './episode';

/** The hidden autoInstall triage automation (docs-screenshots contract). */
const TRIAGE_AUTOMATION_PATH = 'projects__tasks__triage-unassigned';

/** The approval card's field label — mock DATA per locale (docs-replies). */
const APPROVAL_FIELD_LABEL = {
  en: 'Final adjustments',
  de: 'Letzte Anpassungen',
  fr: 'Derniers ajustements',
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

export async function warmup(
  page: import('@playwright/test').Page,
  ctx: import('../../lib/scene').SceneContext,
): Promise<void> {
  const routes = [
    `/dashboard/${ctx.orgId}/automations?tab=installed`,
    `/dashboard/${ctx.orgId}/automations?tab=all`,
    `/dashboard/${ctx.orgId}/automations/${TRIAGE_AUTOMATION_PATH}`,
    `/dashboard/${ctx.orgId}/automations/${TRIAGE_AUTOMATION_PATH}?tab=editor`,
    `/dashboard/${ctx.orgId}/automations/${TRIAGE_AUTOMATION_PATH}?tab=executions`,
    `/dashboard/${ctx.orgId}/chat`,
  ];
  for (const route of routes) {
    await page.goto(route, { waitUntil: 'load' });
    await page
      .waitForLoadState('networkidle', { timeout: 8_000 })
      .catch(() => {});
    await page.waitForTimeout(250);
  }
  await page
    .getByRole('textbox')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
}

export const SCENES: readonly SceneChoreography[] = [
  {
    id: 'title',
    run: async ({ page }) => {
      await page.evaluate(() => window.__taleVideoCard?.reveal());
    },
  },
  {
    // The catalog: rail click, All tab, an unhurried scan over the bundles.
    id: 'catalog',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await page.evaluate(() => window.__taleVideoCard?.fadeOutAndRemove(700));
      await composer(rt).waitFor({ state: 'visible', timeout: 15_000 });
      await cursor.place(1450, 700);
      await cue(0.8);
      await cursor.show();
      await cursor.click(rail(rt, '/automations'));
      const allTab = page
        .locator(
          `main a[href="/dashboard/${rt.ctx.orgId}/automations?tab=all"]`,
        )
        .first();
      await allTab.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(3.0);
      await cursor.click(allTab);
      const github = page.getByText('Resolve GitHub issues').first();
      await github.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(6.5);
      await cursor.hover(github);
      await cue(10.0);
      await cursor.hover(page.getByText('Sync Gmail emails').first());
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
      await cue(2.6);
      await cursor.click(installedTab);
      const triage = page
        .getByRole('button', { name: /Triage unassigned tasks/ })
        .first();
      await triage.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(6.4);
      await cursor.click(triage);
      await page.waitForURL(new RegExp(`/automations/`), { timeout: 15_000 });
    },
  },
  {
    // The workflow, readable like a recipe — the editor tab via deep link.
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
      await cue(5.0);
      const stepNode = page.getByText('score', { exact: false }).first();
      if (await stepNode.isVisible().catch(() => false)) {
        await cursor.hover(stepNode);
      }
    },
  },
  {
    // Every run leaves a journal — the executions tab.
    id: 'executions',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/automations/${TRIAGE_AUTOMATION_PATH}?tab=executions`,
      );
      const completed = page.getByText(rt.t('common.status.completed')).first();
      await completed.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(4.0);
      await cursor.hover(completed);
    },
  },
  {
    // The honest red run — click it open, point at the address of failure.
    id: 'failure',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      const failed = page.getByText(rt.t('common.status.failed')).first();
      await failed.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(2.4);
      await cursor.click(failed);
      await page
        .waitForLoadState('networkidle', { timeout: 8_000 })
        .catch(() => {});
      await cue(8.0);
      const errorText = page.getByText(/validation|schema|error/i).first();
      if (await errorText.isVisible().catch(() => false)) {
        await cursor.hover(errorText);
      }
    },
  },
  {
    // The approval card: ask for a gated send, read, decide, approve.
    id: 'approval',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cursor.click(rail(rt, '/chat'));
      await composer(rt).waitFor({ state: 'visible', timeout: 30_000 });
      await cue(2.0);
      await cursor.click(composer(rt));
      await page.keyboard.type(ctx.heroPrompt, { delay: 30 });
      await cue(6.0);
      await cursor.click(sendButton(rt));
      await page.waitForURL(THREAD_URL, { timeout: 20_000 });
      const threadId = THREAD_URL.exec(page.url())?.[1];
      if (threadId) ctx.cleanup.thread(threadId);
      // The pending card carries the draft; wait on its field label.
      const field = page
        .getByRole('textbox', { name: APPROVAL_FIELD_LABEL[ctx.locale] })
        .first();
      await field.waitFor({ state: 'visible', timeout: 60_000 });
      await cue(15.5);
      await cursor.click(field);
      await page.keyboard.type(APPROVAL_FIELD_TEXT[ctx.locale], { delay: 34 });
      await cue(20.5);
      await cursor.click(
        page.getByRole('button', {
          name: rt.t('humanInputRequest.submit'),
          exact: true,
        }),
      );
      // The resumed turn streams the ack.
      await sendButton(rt).waitFor({ state: 'visible', timeout: 30_000 });
    },
  },
  {
    // The principle — stillness on the decided card and its ack.
    id: 'principle',
    run: async (rt) => {
      const { cursor, cue } = rt;
      await cue(16.0);
      await cursor.hide();
    },
  },
  {
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
