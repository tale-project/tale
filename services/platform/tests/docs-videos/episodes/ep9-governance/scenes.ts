/**
 * Episode 9 choreography — the control room, all read-only: providers,
 * content-model policy, guardrails, the audit log, usage and feedback
 * analytics, and data residency. The finale closes over a calm chat.
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
  const routes = [
    `/dashboard/${ctx.orgId}/settings/providers`,
    `/dashboard/${ctx.orgId}/settings/governance/content-models`,
    `/dashboard/${ctx.orgId}/settings/governance/guardrails`,
    `/dashboard/${ctx.orgId}/settings/governance/logs`,
    `/dashboard/${ctx.orgId}/settings/metrics/usage`,
    `/dashboard/${ctx.orgId}/settings/metrics/feedback`,
    `/dashboard/${ctx.orgId}/settings/data-residency`,
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
    // Providers: the machinery choice.
    id: 'providers',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await page.evaluate(() => window.__taleVideoCard?.fadeOutAndRemove(700));
      await composer(rt).waitFor({ state: 'visible', timeout: 15_000 });
      await cursor.place(1450, 700);
      await spaNavigate(page, `/dashboard/${ctx.orgId}/settings/providers`);
      const openrouter = page.getByText('OpenRouter').first();
      await openrouter.waitFor({ state: 'visible', timeout: 30_000 });
      await cursor.show();
      await cue(4.0);
      await cursor.hover(openrouter);
    },
  },
  {
    // Model policy: allow-lists per role and team.
    id: 'model-policy',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/settings/governance/content-models`,
      );
      await page
        .waitForLoadState('networkidle', { timeout: 10_000 })
        .catch(() => {});
      await cue(5.0);
      const anchor = page.getByRole('row').nth(1);
      if (await anchor.isVisible().catch(() => false)) {
        await cursor.hover(anchor);
      }
    },
  },
  {
    // Guardrails: PII masking, content safety, both directions.
    id: 'guardrails',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/settings/governance/guardrails`,
      );
      await page
        .waitForLoadState('networkidle', { timeout: 10_000 })
        .catch(() => {});
      await cue(4.5);
      const anchor = page.getByRole('switch').first();
      if (await anchor.isVisible().catch(() => false)) {
        await cursor.hover(anchor);
      }
      await cue(9.0);
      const second = page.getByRole('switch').nth(1);
      if (await second.isVisible().catch(() => false)) {
        await cursor.hover(second);
      }
    },
  },
  {
    // The audit log — where episode five's approval landed.
    id: 'audit',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/settings/governance/logs`,
      );
      const row = page.getByRole('row').nth(1);
      await row.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(5.0);
      await cursor.hover(row);
      await cue(9.5);
      const second = page.getByRole('row').nth(2);
      if (await second.isVisible().catch(() => false)) {
        await cursor.hover(second);
      }
    },
  },
  {
    // Usage analytics: cost with names on it.
    id: 'usage',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(page, `/dashboard/${ctx.orgId}/settings/metrics/usage`);
      await page
        .waitForLoadState('networkidle', { timeout: 10_000 })
        .catch(() => {});
      await cue(6.0);
      const chart = page.locator('svg, canvas, [class*="chart"]').first();
      if (await chart.isVisible().catch(() => false)) {
        await cursor.hover(chart);
      }
    },
  },
  {
    // Feedback analytics: quality measured, arena verdicts included.
    id: 'feedback',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/settings/metrics/feedback`,
      );
      await page
        .waitForLoadState('networkidle', { timeout: 10_000 })
        .catch(() => {});
      await cue(5.5);
      const anchor = page.locator('svg, canvas, [class*="chart"]').first();
      if (await anchor.isVisible().catch(() => false)) {
        await cursor.hover(anchor);
      }
    },
  },
  {
    // Data residency: the region dial.
    id: 'residency',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/settings/data-residency`,
      );
      await page
        .waitForLoadState('networkidle', { timeout: 10_000 })
        .catch(() => {});
      await cue(5.0);
      const anchor = page.getByText(/Switzerland|Schweiz|Suisse|EU/i).first();
      if (await anchor.isVisible().catch(() => false)) {
        await cursor.hover(anchor);
      }
      await cue(9.0);
      await cursor.hide();
    },
  },
  {
    // The five habits — over the workspace at rest.
    id: 'habits',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cursor.show();
      await spaNavigate(page, `/dashboard/${ctx.orgId}/chat`);
      await composer(rt).waitFor({ state: 'visible', timeout: 30_000 });
      await cue(1.5);
      await cursor.hide();
    },
  },
  {
    id: 'recap',
    run: async (rt) => {
      const { cue, cursor } = rt;
      await cue(1.0);
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
