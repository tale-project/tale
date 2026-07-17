/**
 * Episode 3 choreography — the knowledge library, surface by surface. The
 * one on-camera mutation (the knowledge entry) is registered under the
 * `cleanupEntryTopics` note and deleted off camera by the recorder; the wow
 * thread rides the `cleanupThreadIds` contract from Episode 2. Knowledge
 * sub-pages are deep links (`spaNavigate` under 'cut' chapter veils); the
 * documents and agents hops are real rail clicks.
 */

import { videoContentFor } from '../../lib/locale-content';
import {
  spaNavigate,
  type SceneChoreography,
  type SceneContext,
  type SceneRuntime,
} from '../../lib/scene';
import { ENTRY_CONTENT, ENTRY_TOPIC } from './episode';

/** The builtin assistant's display name ships per locale. */
const ASSISTANT_NAME = {
  en: 'Assistant',
  de: 'Assistent',
  fr: 'Assistant',
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

function registerThreadForCleanup(ctx: SceneContext, threadId: string): void {
  const existing = ctx.notes.get('cleanupThreadIds');
  ctx.notes.set(
    'cleanupThreadIds',
    existing ? `${existing},${threadId}` : threadId,
  );
}

/** Every route the take renders, warmed before the screencast. */
export async function warmup(
  page: import('@playwright/test').Page,
  ctx: import('../../lib/scene').SceneContext,
): Promise<void> {
  const { localeT } = await import('../../lib/i18n');
  const t = localeT(ctx.locale);
  const routes = [
    `/dashboard/${ctx.orgId}/documents`,
    `/dashboard/${ctx.orgId}/knowledge-entries`,
    `/dashboard/${ctx.orgId}/products`,
    `/dashboard/${ctx.orgId}/websites`,
    `/dashboard/${ctx.orgId}/agents`,
    `/dashboard/${ctx.orgId}/chat`,
  ];
  for (const route of routes) {
    await page.goto(route, { waitUntil: 'load' });
    await page
      .waitForLoadState('networkidle', { timeout: 8_000 })
      .catch(() => {});
    await page.waitForTimeout(250);
  }
  // The agent detail + its Knowledge view are click-only — compile them.
  await page.goto(`/dashboard/${ctx.orgId}/agents`, { waitUntil: 'load' });
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
    .getByText(t('settings.agents.navigation.knowledge'))
    .first()
    .click();
  await page
    .getByText(t('settings.agents.knowledge.retrievalMode'))
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  // The entries add-dialog chunk.
  await page.goto(`/dashboard/${ctx.orgId}/knowledge-entries`, {
    waitUntil: 'load',
  });
  await page
    .getByRole('button', { name: t('knowledgeEntries.addButton') })
    .click();
  await page
    .getByRole('dialog', { name: t('knowledgeEntries.addEntry') })
    .waitFor({ state: 'visible', timeout: 15_000 });
  await page.keyboard.press('Escape');
  // The websites add-dialog chunk.
  await page.goto(`/dashboard/${ctx.orgId}/websites`, { waitUntil: 'load' });
  await page.getByRole('button', { name: t('websites.addButton') }).click();
  await page
    .getByPlaceholder(t('websites.urlPlaceholder'))
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  await page.keyboard.press('Escape');
  // End settled on the opening surface.
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
    // Documents table with its Indexed badges — a real rail click.
    id: 'documents',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await page.evaluate(() => window.__taleVideoCard?.fadeOutAndRemove(700));
      await composer(rt).waitFor({ state: 'visible', timeout: 15_000 });
      await cursor.place(1450, 700);
      await cue(0.8);
      await cursor.show();
      await cursor.click(rail(rt, '/documents'));
      const wowDoc = videoContentFor(ctx.locale).wowSourceDoc;
      const row = page.getByRole('row').filter({ hasText: wowDoc }).first();
      await row.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(5.5);
      await cursor.hover(row);
      await cue(10.5);
      await cursor.hover(
        row.getByText(rt.t('documents.rag.status.indexed')).first(),
      );
    },
  },
  {
    // Indexing ≠ training — the camera rests on the table; one badge hover.
    id: 'indexing',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await cue(12.0);
      const badge = page.getByText(rt.t('documents.rag.status.indexed')).nth(1);
      if (await badge.isVisible().catch(() => false)) {
        await cursor.hover(badge);
      }
    },
  },
  {
    // Add the returns-pilot entry ON CAMERA; registered for cleanup.
    id: 'entries',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(page, `/dashboard/${ctx.orgId}/knowledge-entries`);
      const addButton = page.getByRole('button', {
        name: rt.t('knowledgeEntries.addButton'),
      });
      await addButton.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(3.2);
      await cursor.click(addButton);
      const dialog = page.getByRole('dialog', {
        name: rt.t('knowledgeEntries.addEntry'),
      });
      await dialog.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(4.6);
      await cursor.click(
        dialog.getByRole('textbox', { name: rt.t('knowledgeEntries.topic') }),
      );
      await page.keyboard.type(ENTRY_TOPIC[ctx.locale], { delay: 34 });
      await cue(7.4);
      await cursor.click(
        dialog.getByRole('textbox', {
          name: rt.t('knowledgeEntries.content'),
        }),
      );
      await page.keyboard.type(ENTRY_CONTENT[ctx.locale], { delay: 16 });
      await cue(12.4);
      await cursor.click(
        dialog.getByRole('button', { name: rt.t('common.actions.save') }),
      );
      await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
      const existing = ctx.notes.get('cleanupEntryTopics');
      ctx.notes.set(
        'cleanupEntryTopics',
        existing
          ? `${existing},${ENTRY_TOPIC[ctx.locale]}`
          : ENTRY_TOPIC[ctx.locale],
      );
      await page
        .getByText(ENTRY_TOPIC[ctx.locale])
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 });
    },
  },
  {
    // Typed records: the seeded products table.
    id: 'structured',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(page, `/dashboard/${ctx.orgId}/products`);
      const firstProduct = page
        .getByRole('row')
        .filter({ hasText: videoContentFor(ctx.locale).products[0].name })
        .first();
      await firstProduct.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(4.0);
      await cursor.hover(firstProduct);
      await cue(8.0);
      await cursor.hover(
        page
          .getByRole('row')
          .filter({ hasText: videoContentFor(ctx.locale).products[2].name })
          .first(),
      );
    },
  },
  {
    // The crawler: open the add dialog, type a domain, close — never submit.
    id: 'websites',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(page, `/dashboard/${ctx.orgId}/websites`);
      const addButton = page.getByRole('button', {
        name: rt.t('websites.addButton'),
      });
      await addButton.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(2.6);
      await cursor.click(addButton);
      const domain = page
        .getByPlaceholder(rt.t('websites.urlPlaceholder'))
        .first();
      await domain.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(4.2);
      await cursor.click(domain);
      await page.keyboard.type('northlight.example', { delay: 46 });
      await cue(11.4);
      await page.keyboard.press('Escape');
    },
  },
  {
    // Scopes: the Assistant's knowledge view — real clicks through agents.
    id: 'scopes',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cursor.click(rail(rt, '/agents'));
      const folder = page.getByRole('row', { name: 'Chat' }).first();
      await folder.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(2.0);
      await cursor.click(folder);
      const agent = page
        .getByRole('row')
        .filter({ hasText: ASSISTANT_NAME[ctx.locale] })
        .first();
      await agent.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(3.4);
      await cursor.click(agent);
      await page.waitForURL(/\/agents\/[A-Za-z0-9]+/, { timeout: 15_000 });
      await cue(5.2);
      await cursor.click(
        page.getByText(rt.t('settings.agents.navigation.knowledge')).first(),
      );
      await page
        .getByText(rt.t('settings.agents.knowledge.retrievalMode'))
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 });
    },
  },
  {
    // Curation — stillness over the knowledge view; no motion needed.
    id: 'curation',
    run: async (rt) => {
      const { cursor, cue } = rt;
      await cue(14.0);
      await cursor.hide();
    },
  },
  {
    // The proof: ask about the entry added minutes ago.
    id: 'wow',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cursor.show();
      await cursor.click(rail(rt, '/chat'));
      await composer(rt).waitFor({ state: 'visible', timeout: 30_000 });
      await cue(1.6);
      await cursor.click(composer(rt));
      await page.keyboard.type(ctx.heroPrompt, { delay: 40 });
      await cue(5.4);
      await cursor.click(sendButton(rt));
      await page.waitForURL(THREAD_URL, { timeout: 20_000 });
      const threadId = THREAD_URL.exec(page.url())?.[1];
      if (threadId) registerThreadForCleanup(ctx, threadId);
      await sendButton(rt).waitFor({ state: 'visible', timeout: 30_000 });
      await cue(11.5);
      const source = page
        .locator('[data-message-role="assistant"] strong')
        .nth(1);
      if (await source.isVisible().catch(() => false)) {
        await cursor.hover(source);
      }
    },
  },
  {
    // Recap over the fresh answer at rest.
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
