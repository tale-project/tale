/**
 * Episode 7 choreography — the doors to the outside world, all read-only:
 * the integrations catalog (Tavily connected), the connector detail panel
 * (operations + allowed hosts), the deep-research payoff in the chat's plus
 * menu, the MCP servers surface, and the run-code policy. No mutations.
 */

import { videoContentFor } from '../../lib/locale-content';
import {
  spaNavigate,
  type SceneChoreography,
  type SceneRuntime,
} from '../../lib/scene';

/** Modes-entry label — agent catalog DATA, one string for every locale. */
const DEEP_RESEARCH_MODE_LABEL = 'Deep research';

function composer(rt: SceneRuntime) {
  return rt.page.getByRole('textbox', { name: rt.t('chat.aria.chatInput') });
}

export async function warmup(
  page: import('@playwright/test').Page,
  ctx: import('../../lib/scene').SceneContext,
): Promise<void> {
  const routes = [
    `/dashboard/${ctx.orgId}/settings/integrations`,
    `/dashboard/${ctx.orgId}/settings/api/mcp`,
    `/dashboard/${ctx.orgId}/settings/governance/run-code-policy`,
    `/dashboard/${ctx.orgId}/chat`,
  ];
  for (const route of routes) {
    await page.goto(route, { waitUntil: 'load' });
    await page
      .waitForLoadState('networkidle', { timeout: 8_000 })
      .catch(() => {});
    await page.waitForTimeout(250);
  }
  // The connector detail panel chunk (click the Tavily card, close).
  await page.goto(`/dashboard/${ctx.orgId}/settings/integrations`, {
    waitUntil: 'load',
  });
  const { localeT } = await import('../../lib/i18n');
  const t = localeT(ctx.locale);
  const allTab = page
    .getByText(t('settings.integrations.tabs.all'), { exact: true })
    .first();
  await allTab.waitFor({ state: 'visible', timeout: 15_000 });
  await allTab.click();
  const tavily = page.getByRole('button', { name: /Tavily/ }).first();
  await tavily.waitFor({ state: 'visible', timeout: 15_000 });
  await tavily.click();
  await page
    .getByRole('dialog')
    .last()
    .waitFor({ state: 'visible', timeout: 15_000 });
  await page.keyboard.press('Escape');
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
    // The catalog: connected Tavily + the ready-made connectors.
    id: 'catalog',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await page.evaluate(() => window.__taleVideoCard?.fadeOutAndRemove(700));
      await composer(rt).waitFor({ state: 'visible', timeout: 15_000 });
      await cursor.place(1450, 700);
      await spaNavigate(page, `/dashboard/${ctx.orgId}/settings/integrations`);
      const allTab = page
        .getByText(rt.t('settings.integrations.tabs.all'), { exact: true })
        .first();
      await allTab.waitFor({ state: 'visible', timeout: 30_000 });
      await cursor.show();
      await cue(2.4);
      await cursor.click(allTab);
      const gmail = page.getByRole('button', { name: /Gmail/ }).first();
      await gmail.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(5.5);
      await cursor.hover(gmail);
      await cue(8.0);
      await cursor.hover(page.getByRole('button', { name: /GitHub/ }).first());
      await cue(10.5);
      await cursor.hover(page.getByRole('button', { name: /Tavily/ }).first());
    },
  },
  {
    // Read the door: the connector detail — operations + allowed hosts.
    id: 'connector',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await cue(1.4);
      await cursor.click(page.getByRole('button', { name: /Tavily/ }).first());
      const panel = page.getByRole('dialog').last();
      await panel.waitFor({ state: 'visible', timeout: 15_000 });
      const operations = panel
        .getByText(rt.t('settings.integrations.upload.operations'))
        .first();
      await operations.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(5.0);
      await cursor.hover(operations);
      await cue(8.6);
      const hosts = panel
        .getByText(rt.t('settings.integrations.upload.allowedHosts'))
        .first();
      if (await hosts.isVisible().catch(() => false)) {
        await cursor.hover(hosts);
      }
      await cue(12.0);
      await page.keyboard.press('Escape');
    },
  },
  {
    // The payoff: deep research exists because Tavily is bound.
    id: 'payoff',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(page, `/dashboard/${ctx.orgId}/chat`);
      await composer(rt).waitFor({ state: 'visible', timeout: 30_000 });
      await cue(3.0);
      await cursor.click(
        page.getByRole('button', { name: rt.t('composer.openMenu') }).first(),
      );
      const mode = page
        .getByRole('menuitem', { name: DEEP_RESEARCH_MODE_LABEL })
        .first();
      await mode.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(6.5);
      await cursor.hover(mode);
      await cue(10.5);
      await page.keyboard.press('Escape');
    },
  },
  {
    // MCP servers: the internal-wiki server row.
    id: 'mcp',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(page, `/dashboard/${ctx.orgId}/settings/api/mcp`);
      const server = page
        .getByText(videoContentFor(ctx.locale).mcpServer.displayName)
        .first();
      await server.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(5.0);
      await cursor.hover(server);
    },
  },
  {
    // Per-tool approval flags — the trust boundary made visible.
    id: 'flags',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await cue(2.0);
      const row = page
        .getByText(videoContentFor(rt.ctx.locale).mcpServer.displayName)
        .first();
      await cursor.click(row);
      await page
        .waitForLoadState('networkidle', { timeout: 8_000 })
        .catch(() => {});
      await cue(8.0);
      const approval = page.getByText(/approval/i).first();
      if (await approval.isVisible().catch(() => false)) {
        await cursor.hover(approval);
      }
    },
  },
  {
    // The last door: sandboxed code and default-deny egress.
    id: 'egress',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/settings/governance/run-code-policy`,
      );
      await page
        .waitForLoadState('networkidle', { timeout: 10_000 })
        .catch(() => {});
      await cue(5.5);
      const anchor = page.getByText(/allow|deny|egress/i).first();
      if (await anchor.isVisible().catch(() => false)) {
        await cursor.hover(anchor);
      }
      await cue(10.0);
      await cursor.hide();
    },
  },
  {
    // The pattern — stillness.
    id: 'principle',
    run: async (rt) => {
      const { cue, cursor } = rt;
      await cue(12.0);
      await cursor.hide();
    },
  },
  {
    id: 'recap',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cursor.show();
      await spaNavigate(page, `/dashboard/${ctx.orgId}/settings/integrations`);
      await page
        .getByText(rt.t('settings.integrations.tabs.all'), { exact: true })
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 });
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
