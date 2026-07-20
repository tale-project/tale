/**
 * Episode 3 choreography — the in-depth knowledge guide. Real work on
 * camera: the returns-pilot entry created in the add dialog, the products
 * table narrowed by a real search, the website add dialog walked and
 * closed with Escape, the document team-scope dialog opened and cancelled,
 * and two live chat asks (the stale-teal pitfall and the cited verify).
 * Every knowledge hop is a REAL click on the knowledge tab nav (the
 * `_knowledge` layout renders it on every sub-page) — no veiled deep
 * links. On-camera creations (entry, both chat threads) register on
 * `ctx.cleanup` the moment they exist; the dialogs that must not save are
 * closed via Cancel/Escape and the narration says so.
 *
 * cue() timings are first-pass — tuned against the review sheet during the
 * `--mock-tts` rehearsal before anything bills. Cues that pair with
 * end-of-scene words sit a beat EARLY relative to the en take, because the
 * real fr audio runs shorter than the estimates; the minMs floors in
 * episode.ts absorb the difference.
 */

import { videoContentFor } from '../../lib/locale-content';
import type {
  SceneChoreography,
  SceneContext,
  SceneRuntime,
} from '../../lib/scene';
import { ENTRY_CONTENT, ENTRY_TOPIC, PITFALL_PROMPT } from './episode';

/**
 * Seeded file names are locale-resolved DATA, never literal anchors
 * (STORYBOARD.md): the demo orgs seed native documents, so an English
 * `getByText` would fail the de/fr take. Values quote
 * `tests/docs-screenshots/demo-content.ts` (en) and
 * `tests/docs-videos/lib/locale-content.ts` (de/fr).
 */
const BRAND_DOC = {
  en: '2026-brand-guidelines.txt',
  de: 'markenrichtlinien-2026.txt',
  fr: 'charte-graphique-2026.txt',
} as const;

/** What the records scene types into the products search — an exact-case
 * substring of the third seeded product's name in each locale, so the
 * table narrows to that one row. */
const PRODUCT_SEARCH = {
  en: 'workshop',
  de: 'Workshop',
  fr: 'Atelier',
} as const;

/** The domain typed into the website add dialog — never submitted. */
const WEBSITE_DOMAIN = 'northlight.example';

function rail(rt: SceneRuntime, path: string) {
  return rt.page
    .locator(`nav a[href="/dashboard/${rt.ctx.orgId}${path}"]`)
    .first();
}

/** A knowledge sub-page tab — the `_knowledge` layout's TabNavigation,
 * scoped by its aria-label so the sidebar rail's /documents link can
 * never shadow it. */
function knowledgeTab(rt: SceneRuntime, slug: string) {
  return rt.page
    .getByRole('navigation', {
      name: rt.t('common.aria.knowledgeNavigation'),
    })
    .locator(`a[href="/dashboard/${rt.ctx.orgId}/${slug}"]`)
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

/** Register the thread the page just landed on (best effort, by URL). */
function registerCurrentThread(rt: SceneRuntime): void {
  const threadId = THREAD_URL.exec(rt.page.url())?.[1];
  if (threadId) rt.ctx.cleanup.thread(threadId);
}

/** Every route and dialog the take renders, warmed before the screencast.
 * Ends on the cold-open surface: the knowledge-entries list. */
export async function warmup(
  page: import('@playwright/test').Page,
  ctx: SceneContext,
): Promise<void> {
  const { localeT } = await import('../../lib/i18n');
  const t = localeT(ctx.locale);
  const routes = [
    `/dashboard/${ctx.orgId}/documents`,
    `/dashboard/${ctx.orgId}/products`,
    `/dashboard/${ctx.orgId}/websites`,
    `/dashboard/${ctx.orgId}/chat`,
    `/dashboard/${ctx.orgId}/knowledge-entries`,
  ];
  for (const route of routes) {
    await page.goto(route, { waitUntil: 'load' });
    await page
      .waitForLoadState('networkidle', { timeout: 8_000 })
      .catch(() => {});
    await page.waitForTimeout(250);
  }
  // The entries add-dialog chunk.
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
  // The document team-scope dialog chunk (row menu → Assign team).
  await page.goto(`/dashboard/${ctx.orgId}/documents`, { waitUntil: 'load' });
  const brandRow = page
    .getByRole('row')
    .filter({ hasText: BRAND_DOC[ctx.locale] })
    .first();
  await brandRow.waitFor({ state: 'visible', timeout: 15_000 });
  await brandRow.hover();
  await brandRow
    .getByRole('button', { name: t('common.actions.openMenu') })
    .click();
  await page
    .getByRole('menuitem', { name: t('documents.actions.manageTeams') })
    .click();
  await page
    .getByRole('dialog', { name: t('documents.teamTags.title') })
    .waitFor({ state: 'visible', timeout: 15_000 });
  await page.keyboard.press('Escape');
  // End settled on the cold-open surface: the knowledge-entries list.
  await page.goto(`/dashboard/${ctx.orgId}/knowledge-entries`, {
    waitUntil: 'load',
  });
  await page
    .getByRole('button', { name: t('knowledgeEntries.addButton') })
    .waitFor({ state: 'visible', timeout: 15_000 });
  await page
    .waitForLoadState('networkidle', { timeout: 8_000 })
    .catch(() => {});
}

export const SCENES: readonly SceneChoreography[] = [
  {
    // Cold open: the card reveals over the knowledge-entries list, and
    // lifts BEFORE the voice names the page ("This page — knowledge
    // entries…", ~20 s in en, earlier in the shorter fr take).
    id: 'title',
    run: async (rt) => {
      const { page, cue } = rt;
      await page.evaluate(() => window.__taleVideoCard?.reveal());
      await cue(15.0);
      await page.evaluate(() => window.__taleVideoCard?.fadeOutAndRemove(700));
    },
  },
  {
    // The geography: a real tab click to Documents, then the tab row
    // itself — the map for the whole episode.
    id: 'context',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cursor.place(1450, 700);
      await cue(0.6);
      await cursor.show();
      await cue(1.8);
      await cursor.click(knowledgeTab(rt, 'documents'));
      const brandRow = page
        .getByRole('row')
        .filter({ hasText: BRAND_DOC[ctx.locale] })
        .first();
      await brandRow.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(6.5);
      await cursor.hover(brandRow);
      // "…see the tab row at the top?" — point along it.
      await cue(12.0);
      await cursor.hover(knowledgeTab(rt, 'knowledge-entries'));
      await cue(15.5);
      await cursor.hover(knowledgeTab(rt, 'products'));
    },
  },
  {
    // Task 1 opens: back to Knowledge entries (announced tab click), the
    // seeded entries read while the voice weighs entry vs document vs
    // record. The Add click belongs to the next scene's words.
    id: 'entry-why',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(5.8);
      await cursor.click(knowledgeTab(rt, 'knowledge-entries'));
      const addButton = page.getByRole('button', {
        name: rt.t('knowledgeEntries.addButton'),
      });
      await addButton.waitFor({ state: 'visible', timeout: 30_000 });
      const seeded = videoContentFor(ctx.locale).knowledgeEntries[0]?.topic;
      if (seeded) {
        await cue(10.0);
        await cursor.hover(
          page.getByRole('row').filter({ hasText: seeded }).first(),
        );
      }
      await cue(16.0);
      await cursor.hover(addButton);
    },
  },
  {
    // The creation itself: dialog, topic, content, save — the new row.
    // Cleanup registers BEFORE the save, so an aborted take still sweeps.
    id: 'entry-create',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(1.6);
      await cursor.click(
        page.getByRole('button', { name: rt.t('knowledgeEntries.addButton') }),
      );
      const dialog = page.getByRole('dialog', {
        name: rt.t('knowledgeEntries.addEntry'),
      });
      await dialog.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(3.4);
      await cursor.click(
        dialog.getByRole('textbox', { name: rt.t('knowledgeEntries.topic') }),
      );
      await page.keyboard.type(ENTRY_TOPIC[ctx.locale], { delay: 34 });
      await cue(6.2);
      await cursor.click(
        dialog.getByRole('textbox', {
          name: rt.t('knowledgeEntries.content'),
        }),
      );
      await page.keyboard.type(ENTRY_CONTENT[ctx.locale], { delay: 16 });
      ctx.cleanup.knowledgeEntry(ENTRY_TOPIC[ctx.locale]);
      await cue(10.6);
      await cursor.click(
        dialog.getByRole('button', { name: rt.t('common.actions.save') }),
      );
      await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
      const row = page
        .getByRole('row')
        .filter({ hasText: ENTRY_TOPIC[ctx.locale] })
        .first();
      await row.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(13.5);
      await cursor.hover(row);
    },
  },
  {
    // Task 2: Documents again (announced tab click) — the Indexed badge
    // read up close, twice.
    id: 'indexed',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(1.5);
      await cursor.click(knowledgeTab(rt, 'documents'));
      const brandRow = page
        .getByRole('row')
        .filter({ hasText: BRAND_DOC[ctx.locale] })
        .first();
      await brandRow.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(3.5);
      await cursor.hover(
        brandRow.getByText(rt.t('documents.rag.status.indexed')).first(),
      );
      const wowRow = page
        .getByRole('row')
        .filter({ hasText: videoContentFor(ctx.locale).wowSourceDoc })
        .first();
      await cue(14.0);
      if (await wowRow.isVisible().catch(() => false)) {
        await cursor.hover(
          wowRow.getByText(rt.t('documents.rag.status.indexed')).first(),
        );
      }
    },
  },
  {
    // Records: one tab over (announced click), then a REAL lookup — the
    // search narrows the table to the one workshop row.
    id: 'records',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(1.6);
      await cursor.click(knowledgeTab(rt, 'products'));
      const content = videoContentFor(ctx.locale);
      const firstProduct = page
        .getByRole('row')
        .filter({ hasText: content.products[0].name })
        .first();
      await firstProduct.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(13.2);
      const search = page
        .getByPlaceholder(rt.t('products.searchPlaceholder'))
        .first();
      await cursor.click(search);
      await page.keyboard.type(PRODUCT_SEARCH[ctx.locale], { delay: 60 });
      // The honest "narrowed" signal: the first product's row leaves.
      await firstProduct.waitFor({ state: 'hidden', timeout: 15_000 });
      const workshopRow = page
        .getByRole('row')
        .filter({ hasText: content.products[2].name })
        .first();
      await workshopRow.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(18.4);
      await cursor.hover(workshopRow);
    },
  },
  {
    // Websites: the add dialog walked for real — domain typed, the scan
    // interval read — and closed with Escape, never submitted.
    id: 'websites',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await cue(1.5);
      await cursor.click(knowledgeTab(rt, 'websites'));
      const addButton = page.getByRole('button', {
        name: rt.t('websites.addButton'),
      });
      await addButton.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(7.6);
      await cursor.click(addButton);
      const domain = page
        .getByPlaceholder(rt.t('websites.urlPlaceholder'))
        .first();
      await domain.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(8.8);
      await cursor.click(domain);
      await page.keyboard.type(WEBSITE_DOMAIN, { delay: 46 });
      await cue(12.8);
      await cursor.hover(page.getByText(rt.t('websites.scanInterval')).first());
      await cue(25.0);
      await page.keyboard.press('Escape');
      await domain.waitFor({ state: 'hidden', timeout: 10_000 });
    },
  },
  {
    // Scopes: back in Documents, the brand guidelines' team dialog —
    // opened, read, and cancelled. Entries have no such switch; the
    // narration owns that.
    id: 'scopes',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(5.6);
      await cursor.click(knowledgeTab(rt, 'documents'));
      const brandRow = page
        .getByRole('row')
        .filter({ hasText: BRAND_DOC[ctx.locale] })
        .first();
      await brandRow.waitFor({ state: 'visible', timeout: 30_000 });
      // Hover first: the row menu button reveals on row hover.
      await cue(7.0);
      await cursor.hover(brandRow);
      await cue(8.0);
      await cursor.click(
        brandRow.getByRole('button', { name: rt.t('common.actions.openMenu') }),
      );
      await cue(9.6);
      await cursor.click(
        page.getByRole('menuitem', {
          name: rt.t('documents.actions.manageTeams'),
        }),
      );
      const dialog = page.getByRole('dialog', {
        name: rt.t('documents.teamTags.title'),
      });
      await dialog.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(13.0);
      const orgWide = dialog
        .getByText(rt.t('documents.teamTags.orgWide'))
        .first();
      if (await orgWide.isVisible().catch(() => false)) {
        await cursor.hover(orgWide);
      }
      await cue(22.5);
      await cursor.click(
        dialog.getByRole('button', { name: rt.t('common.actions.cancel') }),
      );
      await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    },
  },
  {
    // The pitfall, asked live: rail to chat, the stale-teal question.
    // Streams the NEW pitfall docs-reply (apply the triplet first!).
    id: 'pitfall-ask',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(2.2);
      await cursor.click(rail(rt, '/chat'));
      await page.waitForURL(new RegExp(`/dashboard/${ctx.orgId}/chat$`), {
        timeout: 15_000,
      });
      await composer(rt).waitFor({ state: 'visible', timeout: 30_000 });
      await cue(13.4);
      await cursor.click(composer(rt));
      await page.keyboard.type(PITFALL_PROMPT[ctx.locale], { delay: 30 });
      await cue(16.6);
      await cursor.click(sendButton(rt));
      await page.waitForURL(THREAD_URL, { timeout: 20_000 });
      registerCurrentThread(rt);
      // Let the grounded answer finish streaming under the narration.
      await sendButton(rt).waitFor({ state: 'visible', timeout: 30_000 });
    },
  },
  {
    // The answer at rest: read together, then the bold source (the reply's
    // one strong is the brand-guidelines file name).
    id: 'pitfall-read',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      const answer = page.locator('[data-message-role="assistant"]').last();
      await cue(3.0);
      if (await answer.isVisible().catch(() => false)) {
        await cursor.hover(answer);
      }
      await cue(8.0);
      const source = answer.locator('strong').first();
      if (await source.isVisible().catch(() => false)) {
        await cursor.hover(source);
      }
    },
  },
  {
    // Verify, part 1: a FRESH chat (rail click leaves the pitfall thread),
    // the hero ask about the entry created minutes ago.
    id: 'verify-ask',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(3.4);
      await cursor.click(rail(rt, '/chat'));
      // Insist on the chat INDEX before typing — the old thread's URL also
      // matches THREAD_URL, and a send gated on it would read stale.
      await page.waitForURL(new RegExp(`/dashboard/${ctx.orgId}/chat$`), {
        timeout: 15_000,
      });
      await composer(rt).waitFor({ state: 'visible', timeout: 30_000 });
      await cue(6.2);
      await cursor.click(composer(rt));
      await page.keyboard.type(ctx.heroPrompt, { delay: 30 });
      await cue(9.6);
      await cursor.click(sendButton(rt));
      await page.waitForURL(THREAD_URL, { timeout: 20_000 });
      registerCurrentThread(rt);
      await sendButton(rt).waitFor({ state: 'visible', timeout: 30_000 });
    },
  },
  {
    // Verify, part 2: the citation — the reply's LAST strong is the
    // entry's own name (the first is the 60-day figure).
    id: 'verify-read',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      const answer = page.locator('[data-message-role="assistant"]').last();
      await cue(4.0);
      if (await answer.isVisible().catch(() => false)) {
        await cursor.hover(answer);
      }
      await cue(8.0);
      const source = answer.locator('strong').last();
      if (await source.isVisible().catch(() => false)) {
        await cursor.hover(source);
      }
    },
  },
  {
    // Recap over the cited answer at rest — stillness carries it.
    id: 'recap',
    run: async (rt) => {
      const { cursor, cue } = rt;
      await cue(2.0);
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
