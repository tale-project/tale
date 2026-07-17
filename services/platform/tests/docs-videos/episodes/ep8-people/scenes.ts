/**
 * Episode 8 choreography — the human access layer, with ZERO mutations: the
 * members table, the add-member dialog opened and deliberately abandoned
 * (the role ladder is the lesson), the teams table, and the enterprise SSO
 * surface. Every fill dies with Escape; nothing is saved.
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
    `/dashboard/${ctx.orgId}/settings/organization`,
    `/dashboard/${ctx.orgId}/settings/teams`,
    `/dashboard/${ctx.orgId}/settings/enterprise-sso`,
    `/dashboard/${ctx.orgId}/chat`,
  ];
  for (const route of routes) {
    await page.goto(route, { waitUntil: 'load' });
    await page
      .waitForLoadState('networkidle', { timeout: 8_000 })
      .catch(() => {});
    await page.waitForTimeout(250);
  }
  // The add-member dialog chunk.
  await page.goto(`/dashboard/${ctx.orgId}/settings/organization`, {
    waitUntil: 'load',
  });
  const addButton = page.getByRole('button', {
    name: t('settings.organization.addMember'),
  });
  await addButton.waitFor({ state: 'visible', timeout: 15_000 });
  await addButton.click();
  await page
    .getByRole('dialog', { name: t('dialogs.addMember.title') })
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
    // The roster: members and their roles.
    id: 'people',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await page.evaluate(() => window.__taleVideoCard?.fadeOutAndRemove(700));
      await composer(rt).waitFor({ state: 'visible', timeout: 15_000 });
      await cursor.place(1450, 700);
      await spaNavigate(page, `/dashboard/${ctx.orgId}/settings/organization`);
      const row = page
        .getByRole('row')
        .filter({ hasText: 'Priya Raman' })
        .first();
      await row.waitFor({ state: 'visible', timeout: 30_000 });
      await cursor.show();
      await cue(4.0);
      await cursor.hover(row);
      await cue(8.0);
      await cursor.hover(
        page.getByRole('row').filter({ hasText: 'Sam Okonkwo' }).first(),
      );
    },
  },
  {
    // The add-member dialog: name, email, and the ROLE ladder — abandoned.
    id: 'invite',
    run: async (rt) => {
      const { page, cursor, cue } = rt;
      await cue(1.4);
      await cursor.click(
        page.getByRole('button', {
          name: rt.t('settings.organization.addMember'),
        }),
      );
      const dialog = page.getByRole('dialog', {
        name: rt.t('dialogs.addMember.title'),
      });
      await dialog.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(2.8);
      await cursor.click(dialog.getByLabel(rt.t('settings.form.name')));
      await page.keyboard.type('Emma Larsen', { delay: 48 });
      await cue(4.6);
      await cursor.click(dialog.getByLabel(rt.t('settings.form.email')));
      await page.keyboard.type('emma.larsen@example.com', { delay: 34 });
      await cue(7.2);
      await cursor.click(
        dialog.getByRole('combobox', { name: rt.t('settings.form.role') }),
      );
      const editorOption = page.getByRole('option', {
        name: rt.t('settings.roles.editor'),
        exact: true,
      });
      await editorOption.waitFor({ state: 'visible', timeout: 15_000 });
      await cue(9.2);
      await cursor.hover(editorOption);
      await cue(11.4);
      await cursor.hover(
        page.getByRole('option', {
          name: rt.t('settings.roles.admin'),
          exact: true,
        }),
      );
      await cue(14.4);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    },
  },
  {
    // Blast radius, not status — stillness over the roster.
    id: 'least-privilege',
    run: async (rt) => {
      const { cursor, cue } = rt;
      await cue(12.0);
      await cursor.hide();
    },
  },
  {
    // Teams as knowledge walls.
    id: 'teams',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(page, `/dashboard/${ctx.orgId}/settings/teams`);
      await cursor.show();
      const first = page.getByRole('row').nth(1);
      await first.waitFor({ state: 'visible', timeout: 30_000 });
      await cue(4.5);
      await cursor.hover(first);
      await cue(9.0);
      const second = page.getByRole('row').nth(2);
      if (await second.isVisible().catch(() => false)) {
        await cursor.hover(second);
      }
    },
  },
  {
    // Identity hygiene: the enterprise SSO surface.
    id: 'identity',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await spaNavigate(
        page,
        `/dashboard/${ctx.orgId}/settings/enterprise-sso`,
      );
      await page
        .waitForLoadState('networkidle', { timeout: 10_000 })
        .catch(() => {});
      await cue(6.0);
      const field = page.getByRole('textbox').first();
      if (await field.isVisible().catch(() => false)) {
        await cursor.hover(field);
      }
    },
  },
  {
    // The principle — stillness.
    id: 'principle',
    run: async (rt) => {
      const { cursor, cue } = rt;
      await cue(10.0);
      await cursor.hide();
    },
  },
  {
    id: 'recap',
    run: async (rt) => {
      const { page, cursor, cue, ctx } = rt;
      await cursor.show();
      await spaNavigate(page, `/dashboard/${ctx.orgId}/settings/teams`);
      await page
        .getByRole('row')
        .nth(1)
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
