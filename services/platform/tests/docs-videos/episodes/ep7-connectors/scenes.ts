/**
 * Episode 7 choreography — a connection made on camera. The GitHub
 * connector is read (operations, allowed hosts), connected with a token
 * (the panel's own live API check is the story), verified under the
 * Connected tab, the seeded MCP server's panel read honestly (no tools
 * until a connection test), the add-server dialog filled and deliberately
 * CANCELLED, and the run-code package policy read.
 *
 * Mutation contract: the ONE persistent change is the GitHub connection —
 * the cleanup registry has no connector type, so the coordinator sweeps
 * it off camera (see episode.ts header). The connect scene is
 * check-then-act: an already-connected panel records a degraded fallback
 * (hover the Active status) instead of double-connecting; sweep and retake
 * for the shipped cut. Everything else opens dialogs and closes them.
 *
 * cue() timings are first-pass — tuned against the review sheet during the
 * `--mock-tts` rehearsal before anything bills.
 */

import { videoContentFor } from '../../lib/locale-content';
import {
  spaNavigate,
  type SceneChoreography,
  type SceneRuntime,
} from '../../lib/scene';
import { GITHUB_TOKEN, MCP_DRAFT_NAME, MCP_DRAFT_URL } from './episode';

/**
 * Anchor a form label at its start — `getByLabel('Name')` alone also
 * matches "Display name". Same shape as the e2e helper
 * (`tests/e2e/helpers/forms.ts`), local so episodes stay self-contained.
 */
function labelStart(label: string): RegExp {
  const escaped = label.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(`^${escaped}`);
}

/** A catalog tab — Radix `role=tab`, so the "Connected" TAB never collides
 * with the identical "Connected" BADGE text on the cards (en + de). */
function catalogTab(rt: SceneRuntime, key: string) {
  return rt.page.getByRole('tab', { name: rt.t(key), exact: true }).first();
}

/** A connector card — its accessible name grows a "Connected" badge once
 * live (docs-screenshots seeder contract), so never match it exactly. */
function connectorCard(rt: SceneRuntime, name: RegExp) {
  return rt.page.getByRole('button', { name }).first();
}

function detailPanel(rt: SceneRuntime) {
  return rt.page.getByRole('dialog').last();
}

/** The "Connect GitHub" button — the panel's connect-and-verify action. */
function connectButton(rt: SceneRuntime) {
  return detailPanel(rt).getByRole('button', {
    name: rt
      .t('settings.connectors.panel.connectName')
      .replace('{name}', 'GitHub'),
  });
}

export async function warmup(
  page: import('@playwright/test').Page,
  ctx: import('../../lib/scene').SceneContext,
): Promise<void> {
  const { localeT } = await import('../../lib/i18n');
  const t = localeT(ctx.locale);
  const routes = [
    `/dashboard/${ctx.orgId}/settings/connectors?tab=all`,
    `/dashboard/${ctx.orgId}/settings/api/mcp`,
    `/dashboard/${ctx.orgId}/settings/governance/run-code-policy`,
  ];
  for (const route of routes) {
    await page.goto(route, { waitUntil: 'load' });
    await page
      .waitForLoadState('networkidle', { timeout: 8_000 })
      .catch(() => {});
    await page.waitForTimeout(250);
  }

  // The connector detail panel chunk (open the GitHub card, close).
  await page.goto(`/dashboard/${ctx.orgId}/settings/connectors?tab=all`, {
    waitUntil: 'load',
  });
  const github = page.getByRole('button', { name: /GitHub/ }).first();
  await github.waitFor({ state: 'visible', timeout: 15_000 });
  await github.click();
  await page
    .getByRole('dialog')
    .last()
    .waitFor({ state: 'visible', timeout: 15_000 });
  await page.keyboard.press('Escape');

  // The MCP panel + add-server dialog chunks (open each, close untouched).
  await page.goto(`/dashboard/${ctx.orgId}/settings/api/mcp`, {
    waitUntil: 'load',
  });
  const wiki = page
    .getByText(videoContentFor(ctx.locale).mcpServer.displayName)
    .first();
  await wiki.waitFor({ state: 'visible', timeout: 15_000 });
  await wiki.click();
  await page
    .getByRole('dialog')
    .last()
    .waitFor({ state: 'visible', timeout: 15_000 });
  await page.keyboard.press('Escape');
  const addServer = page.getByRole('button', {
    name: t('mcpServers.addServer'),
  });
  await addServer.waitFor({ state: 'visible', timeout: 15_000 });
  await addServer.click();
  await page
    .getByRole('dialog', { name: t('mcpServers.addServer') })
    .waitFor({ state: 'visible', timeout: 15_000 });
  await page.keyboard.press('Escape');

  // Last: the cold-open surface — the Connected tab (the default view),
  // where the on-camera GitHub row will land. The title card reveals here.
  await page.goto(`/dashboard/${ctx.orgId}/settings/connectors`, {
    waitUntil: 'load',
  });
  await page
    .getByRole('button', { name: /Tavily/ })
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });
  await page
    .waitForLoadState('networkidle', { timeout: 8_000 })
    .catch(() => {});
  await page.waitForTimeout(250);
}

export const SCENES: readonly SceneChoreography[] = [
  {
    // Cold open: the card reveals over the Connected tab (the end state).
    id: 'title',
    run: async (rt) => {
      const { page, cue } = rt;
      await page.evaluate(() => window.__taleVideoCard?.reveal());
      // The card lifts as the voice reaches "This page — the Connected tab
      // of your connectors" — the surface must be VISIBLE while the
      // narration names it, never hidden behind the card.
      await cue(17.4);
      await page.evaluate(() => window.__taleVideoCard?.fadeOutAndRemove(700));
    },
  },
  {
    // What already exists: the one live connection, its badge pointed at.
    id: 'context',
    run: async (rt) => {
      const { cursor, cue } = rt;
      const tavily = connectorCard(rt, /Tavily/);
      await tavily.waitFor({ state: 'visible', timeout: 30_000 });
      await cursor.place(1450, 700);
      await cue(1.0);
      await cursor.show();
      await cue(3.2);
      await cursor.hover(tavily);
      await cue(7.0);
      await cursor.hover(
        tavily.getByText(rt.t('settings.connectors.badge.connected')).first(),
      );
    },
  },
  {
    // Task 1 opens: the All tab clicked on camera, the catalog surveyed.
    id: 'catalog',
    run: async (rt) => {
      const { cursor, cue } = rt;
      const allTab = catalogTab(rt, 'settings.connectors.tabs.all');
      await allTab.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(3.6);
      await cursor.click(allTab);
      const gmail = connectorCard(rt, /Gmail/);
      await gmail.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(6.0);
      await cursor.hover(gmail);
      await cue(7.6);
      await cursor.hover(connectorCard(rt, /Shopify/));
      await cue(11.4);
      await cursor.hover(connectorCard(rt, /GitHub/));
    },
  },
  {
    // The contract read: the panel's operations list, reads then writes.
    id: 'operations',
    run: async (rt) => {
      const { cursor, cue } = rt;
      await cue(1.4);
      await cursor.click(connectorCard(rt, /GitHub/));
      const panel = detailPanel(rt);
      await panel.waitFor({ state: 'visible', timeout: 15_000 });
      const operations = panel
        .getByText(rt.t('settings.connectors.upload.operations'))
        .first();
      await operations.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(5.2);
      await cursor.hover(operations);
      // Operation rows are connector DATA (English name/title in every
      // locale). Guarded: the list may render name or title, and may sit
      // behind a collapsed section on some widths — the label hover above
      // carries the scene either way.
      await cue(8.6);
      const read = panel.getByText(/list[_ ]repos(itories)?/i).first();
      if (await read.isVisible().catch(() => false)) {
        await cursor.hover(read);
      }
      await cue(13.0);
      const write = panel.getByText(/create[_ ]issue\b/i).first();
      if (await write.isVisible().catch(() => false)) {
        await cursor.hover(write);
      }
    },
  },
  {
    // Allowed hosts — where requests may go, read before any key exists.
    id: 'hosts',
    run: async (rt) => {
      const { cursor, cue } = rt;
      const panel = detailPanel(rt);
      const hosts = panel
        .getByText(rt.t('settings.connectors.upload.allowedHosts'))
        .first();
      await hosts.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(2.2);
      await cursor.hover(hosts);
      await cue(5.5);
      const host = panel.getByText('api.github.com').first();
      if (await host.isVisible().catch(() => false)) {
        await cursor.hover(host);
      }
      // The panel STAYS OPEN — the connect happens right here.
    },
  },
  {
    // Task 2, the centerpiece: token typed (masked), Connect clicked — the
    // panel verifies the credential against the API before persisting.
    id: 'connect',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      const panel = detailPanel(rt);
      // Check-then-act: a retake against an already-connected org shows
      // Active instead of the credential form — record a degraded hover
      // pass rather than failing or double-connecting.
      const active = panel
        .getByText(rt.t('settings.connectors.upload.active'))
        .first();
      if (await active.isVisible().catch(() => false)) {
        console.warn(
          '[ep7] GitHub is already connected — degraded fallback take. ' +
            'Sweep the connection (panel → Disconnect → Delete connector) and retake.',
        );
        await cue(6.6);
        await cursor.hover(active);
        await cue(24.6);
        await cursor.hover(connectButton(rt).or(active).first());
        return;
      }
      // The connector's single auth field; role-scoped so the label's
      // casing (connector data, not chrome) cannot break the fill — the
      // credential input precedes the Configuration inputs (seeder-proven).
      const token = panel.getByRole('textbox').first();
      await token.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(6.6);
      await cursor.click(token);
      await page.keyboard.type(GITHUB_TOKEN, { delay: 42 });
      await cue(10.5);
      await cursor.hover(token);
      await cue(16.0);
      await cursor.hover(connectButton(rt));
      await cue(24.6);
      await cursor.click(connectButton(rt));
      // The live check runs into the next scene; it waits on Active.
    },
  },
  {
    // The verified result: Active in the panel, then the badge on the card.
    id: 'active',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      const panel = detailPanel(rt);
      // The persisted-connection signal (docs-screenshots seeder contract):
      // the panel flips to Active once the API check came back good.
      const active = panel
        .getByText(rt.t('settings.connectors.upload.active'))
        .first();
      await active.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(1.6);
      await cursor.hover(active);
      await cue(9.4);
      await page.keyboard.press('Escape');
      await panel.waitFor({ state: 'hidden', timeout: 10_000 });
      // The card badge refreshes via query invalidation — wait on state,
      // warn (never fail) if it lags: the narration names this badge.
      const github = connectorCard(rt, /GitHub/);
      const badge = github
        .getByText(rt.t('settings.connectors.badge.connected'))
        .first();
      const badgeVisible = await badge
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (!badgeVisible) {
        console.warn(
          '[ep7] GitHub card badge did not live-update after connect — verify at rehearsal',
        );
      }
      await cue(13.0);
      await cursor.hover(badgeVisible ? badge : github);
    },
  },
  {
    // Task 3: the Connected tab lists both; GitHub reopened, now live.
    id: 'connected',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      const connectedTab = catalogTab(rt, 'settings.connectors.tabs.connected');
      await cue(2.4);
      await cursor.click(connectedTab);
      const github = connectorCard(rt, /GitHub/);
      await github.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(4.5);
      await cursor.hover(connectorCard(rt, /Tavily/));
      await cue(6.5);
      await cursor.hover(github);
      await cue(8.8);
      await cursor.click(github);
      const panel = detailPanel(rt);
      await panel.waitFor({ state: 'visible', timeout: 15_000 });
      const operations = panel
        .getByText(rt.t('settings.connectors.upload.operations'))
        .first();
      await operations.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(11.5);
      await cursor.hover(operations);
      // Close before the chapter cut — no dialog under the veil.
      await cue(19.5);
      await page.keyboard.press('Escape');
      await panel.waitFor({ state: 'hidden', timeout: 10_000 });
    },
  },
  {
    // Task 4 opens (cut): the MCP servers page, the seeded wiki server.
    id: 'mcp',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(page, `/dashboard/${ctx.orgId}/settings/api/mcp`);
      const server = page
        .getByText(videoContentFor(ctx.locale).mcpServer.displayName)
        .first();
      await server.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(15.8);
      await cursor.hover(server);
    },
  },
  {
    // The server panel, read honestly: address, status, no tools yet.
    id: 'mcp-panel',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(1.0);
      await cursor.click(
        page
          .getByText(videoContentFor(ctx.locale).mcpServer.displayName)
          .first(),
      );
      const sheet = detailPanel(rt);
      await sheet.waitFor({ state: 'visible', timeout: 15_000 });
      const url = sheet
        .getByText(videoContentFor(ctx.locale).mcpServer.url)
        .first();
      await cue(2.8);
      if (await url.isVisible().catch(() => false)) {
        await cursor.hover(url);
      }
      const noTools = sheet.getByText(rt.t('mcpServers.tools.noTools')).first();
      await noTools.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(9.6);
      await cursor.hover(noTools);
      // Point at Test connection — never click it: dialing the seeded
      // placeholder URL would write an error state onto the server row.
      const test = sheet
        .getByRole('button', { name: rt.t('mcpServers.testConnection') })
        .first();
      await cue(15.0);
      if (await test.isVisible().catch(() => false)) {
        await cursor.hover(test);
      }
      await cue(19.4);
      await page.keyboard.press('Escape');
      await sheet.waitFor({ state: 'hidden', timeout: 10_000 });
    },
  },
  {
    // The add dialog: name + URL typed for real, Save pointed at, then
    // CANCELLED on purpose — nothing may persist (no cleanup type exists).
    id: 'add-server',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cue(1.8);
      await cursor.click(
        page.getByRole('button', { name: rt.t('mcpServers.addServer') }),
      );
      const sheet = page.getByRole('dialog', {
        name: rt.t('mcpServers.addServer'),
      });
      await sheet.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(5.2);
      await cursor.click(
        sheet.getByLabel(labelStart(rt.t('mcpServers.form.name'))),
      );
      await page.keyboard.type(MCP_DRAFT_NAME, { delay: 46 });
      await cue(8.8);
      await cursor.click(
        sheet.getByLabel(labelStart(rt.t('mcpServers.form.url'))),
      );
      await page.keyboard.type(MCP_DRAFT_URL[ctx.locale], { delay: 30 });
      await cue(12.6);
      const transport = sheet
        .getByText(rt.t('mcpServers.form.transportType'))
        .first();
      if (await transport.isVisible().catch(() => false)) {
        await cursor.hover(transport);
      }
      await cue(15.8);
      await cursor.hover(
        sheet.getByRole('button', { name: rt.t('mcpServers.form.save') }),
      );
      await cue(19.2);
      await cursor.click(
        sheet.getByRole('button', { name: rt.t('mcpServers.form.cancel') }),
      );
      await sheet.waitFor({ state: 'hidden', timeout: 10_000 });
    },
  },
  {
    // The closing boundary (cut): the run-code package policy, two modes.
    id: 'runcode',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/settings/governance/run-code-policy`,
      );
      const title = page
        .getByText(rt.t('governance.runCodePolicy.title'))
        .first();
      await title.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(3.0);
      await cursor.hover(title);
      await cue(9.8);
      await cursor.hover(
        page
          .getByText(rt.t('governance.runCodePolicy.modeDenylistLabel'), {
            exact: true,
          })
          .first(),
      );
      await cue(13.6);
      await cursor.hover(
        page
          .getByText(rt.t('governance.runCodePolicy.modeAllowlistLabel'), {
            exact: true,
          })
          .first(),
      );
    },
  },
  {
    // Verify (cut): the Connected tab holds the artifact — GitHub's row.
    id: 'verify',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/settings/connectors?tab=connected`,
      );
      const github = connectorCard(rt, /GitHub/);
      await github.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(6.4);
      await cursor.hover(github);
      await cue(8.4);
      await cursor.hover(connectorCard(rt, /Tavily/));
    },
  },
  {
    // Recap over the Connected tab — stillness on the artifact.
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
