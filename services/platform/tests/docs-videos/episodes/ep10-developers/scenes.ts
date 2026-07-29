/**
 * Episode 10 choreography — the developer surface, read-only: API keys, the
 * four API doors (REST, MCP, WebDAV, runtimes), an agent's webhook view,
 * the external external agents in the list, and the run-code policy.
 */

import {
  spaNavigate,
  type SceneChoreography,
  type SceneRuntime,
} from '../../lib/scene';

function composer(rt: SceneRuntime) {
  return rt.page.getByRole('textbox', { name: rt.t('chat.aria.chatInput') });
}

export async function warmup(
  page: import('@playwright/test').Page,
  ctx: import('../../lib/scene').SceneContext,
): Promise<void> {
  const { localeT } = await import('../../lib/i18n');
  const t = localeT(ctx.locale);
  const routes = [
    `/dashboard/${ctx.orgId}/settings/api-keys`,
    `/dashboard/${ctx.orgId}/settings/api/rest`,
    `/dashboard/${ctx.orgId}/settings/api/mcp`,
    `/dashboard/${ctx.orgId}/settings/governance/run-code-policy`,
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
  // The agent detail's webhook view is click-only — compile it.
  await page.goto(`/dashboard/${ctx.orgId}/agents`, { waitUntil: 'load' });
  const folder = page.getByRole('row', { name: 'Chat' }).first();
  await folder.waitFor({ state: 'visible', timeout: 15_000 });
  await folder.click();
  const assistant = page
    .getByRole('row')
    .filter({ hasText: /Assistant|Assistent/ })
    .first();
  await assistant.waitFor({ state: 'visible', timeout: 15_000 });
  await assistant.click();
  await page.waitForURL(/\/agents\/[A-Za-z0-9]+/, { timeout: 15_000 });
  const nav = page.getByRole('navigation', {
    name: t('common.aria.agentsNavigation'),
  });
  await nav.waitFor({ state: 'visible', timeout: 15_000 });
  await nav.getByText(t('settings.agents.navigation.webhook')).first().click();
  await page.waitForTimeout(600);
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
    // Scoped, revocable API keys.
    id: 'api-keys',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await page.evaluate(() => window.__taleVideoCard?.fadeOutAndRemove(700));
      await composer(rt).waitFor({ state: 'visible', timeout: 15_000 });
      await cursor.place(1450, 700);
      await spaNavigate(page, `/dashboard/${ctx.orgId}/settings/api-keys`);
      const key = page.getByText('Production ingest').first();
      await key.waitFor({ state: 'visible', timeout: 30_000 });
      await cursor.show();
      await cue(4.5);
      await cursor.hover(key);
      await cue(8.0);
      await cursor.hover(page.getByText('CI pipeline').first());
    },
  },
  {
    // The four doors: REST, MCP, WebDAV, runtimes.
    id: 'surfaces',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(page, `/dashboard/${ctx.orgId}/settings/api/rest`);
      await page
        .waitForLoadState('networkidle', { timeout: 10_000 })
        .catch(() => {});
      await cue(6.0);
      const mcpLink = page
        .locator(`a[href="/dashboard/${ctx.orgId}/settings/api/mcp"]`)
        .first();
      if (await mcpLink.isVisible().catch(() => false)) {
        await cursor.click(mcpLink);
      }
      await page
        .waitForLoadState('networkidle', { timeout: 8_000 })
        .catch(() => {});
    },
  },
  {
    // Webhooks: fire an agent from any system.
    id: 'webhooks',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(page, `/dashboard/${ctx.orgId}/agents`);
      const folder = page.getByRole('row', { name: 'Chat' }).first();
      await folder.waitFor({ state: 'visible', timeout: 30_000 });
      await cursor.click(folder);
      const assistant = page
        .getByRole('row')
        .filter({ hasText: /Assistant|Assistent/ })
        .first();
      await assistant.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(3.0);
      await cursor.click(assistant);
      await page.waitForURL(/\/agents\/[A-Za-z0-9]+/, { timeout: 15_000 });
      const nav = page.getByRole('navigation', {
        name: rt.t('common.aria.agentsNavigation'),
      });
      await nav.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(5.5);
      await cursor.click(
        nav.getByText(rt.t('settings.agents.navigation.webhook')).first(),
      );
      await page
        .waitForLoadState('networkidle', { timeout: 8_000 })
        .catch(() => {});
    },
  },
  {
    // The external external agents, working in sandboxes.
    id: 'external-agents',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(page, `/dashboard/${ctx.orgId}/agents`);
      const folder = page.getByRole('row', { name: 'Chat' }).first();
      await folder.waitFor({ state: 'visible', timeout: 30_000 });
      await cursor.click(folder);
      const claude = page
        .getByRole('row')
        .filter({ hasText: 'Claude Code' })
        .first();
      await claude.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(5.0);
      await cursor.hover(claude);
      await cue(9.0);
      const cursorAgent = page
        .getByRole('row')
        .filter({ hasText: 'Cursor' })
        .first();
      if (await cursorAgent.isVisible().catch(() => false)) {
        await cursor.hover(cursorAgent);
      }
    },
  },
  {
    // The run-code policy: packages and hosts, fail-closed.
    id: 'run-code-policy',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/settings/governance/run-code-policy`,
      );
      await page
        .waitForLoadState('networkidle', { timeout: 10_000 })
        .catch(() => {});
      await cue(5.0);
      const anchor = page.getByText(/allow|deny/i).first();
      if (await anchor.isVisible().catch(() => false)) {
        await cursor.hover(anchor);
      }
      await cue(10.0);
      await cursor.hide();
    },
  },
  {
    id: 'principle',
    run: async (rt) => {
      const { cue, cursor } = rt;
      await cue(10.0);
      await cursor.hide();
    },
  },
  {
    id: 'recap',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cursor.show();
      await spaNavigate(page, `/dashboard/${ctx.orgId}/chat`);
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
