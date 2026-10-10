import { expect, test } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';

import { gotoClientPage } from '../helpers/client-page';

/**
 * Animated homepage demos, asserted deterministically: under
 * `prefers-reduced-motion` the timeline driver pins every demo to its final
 * beat, so the complete end state must be present without waiting on
 * animation timing. This is also the state prerendered HTML ships.
 */

const { t } = createI18n(new URL('../../../messages/en.yml', import.meta.url));
const { t: tFrench } = createI18n(
  new URL('../../../messages/fr.yml', import.meta.url),
);
// The demo window's own chrome (the Share label) ships with the marketing
// design language, not the site catalog.
const { t: tMarketing } = createI18n(
  new URL(
    '../../../../../packages/marketing-ui/src/i18n/messages/en.yml',
    import.meta.url,
  ),
);

test.use({ contextOptions: { reducedMotion: 'reduce' } });

for (const { path, namespace } of [{ path: '/', namespace: 'home' }] as const) {
  test(`French sandbox reserves its final height on ${path} at 320px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 150 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await gotoClientPage(page, `/fr${path}`);
    await page.evaluate(() => document.fonts.ready);
    const demo = page.getByRole('img', {
      name: tFrench(`${namespace}.demos.sandbox.label`),
      exact: true,
    });
    const reply = tFrench(`${namespace}.demos.sandbox.reply`);
    const replyPart = demo.locator('[data-sandbox-part="reply"]');
    const livePart = demo.locator('[data-sandbox-part="live"]');
    // All parts reserve their final geometry while the unplayed scene is
    // transparent. Judge playback by paint, rather than DOM membership.
    await expect(replyPart).toHaveCSS('opacity', '0');
    const before = await demo.boundingBox();
    expect(before).not.toBeNull();
    await page.setViewportSize({ width: 320, height: 900 });
    await demo.scrollIntoViewIfNeeded();
    await expect(replyPart).toHaveCSS('opacity', '1', { timeout: 10_000 });
    await expect(replyPart).toContainText(reply);
    await expect(livePart).toHaveCSS('opacity', '1');
    await expect(livePart).toContainText(
      tFrench(`${namespace}.demos.sandbox.previewDetail3`),
    );
    expect((await demo.boundingBox())?.height).toBe(before?.height);
  });
}

test.describe('homepage demos', () => {
  test('hero shows its actual project task under reduced motion', async ({
    page,
  }) => {
    await gotoClientPage(page, '/');

    const screenshot = page.getByRole('img', {
      name: t('demo.pages.home.label'),
      exact: true,
    });
    await expect(screenshot).toBeVisible();
    expect(
      await screenshot.evaluate(
        (image) => (image as HTMLImageElement).naturalWidth,
      ),
    ).toBeGreaterThan(0);
  });

  test('tour demos render their complete end states under reduced motion', async ({
    page,
  }) => {
    await gotoClientPage(page, '/');

    const sandbox = page.getByRole('img', {
      name: t('home.demos.sandbox.label'),
    });
    await sandbox.scrollIntoViewIfNeeded();
    await expect(sandbox).toContainText(t('home.demos.sandbox.prompt'));
    await expect(sandbox).toContainText(t('home.demos.sandbox.reply'));
    await expect(sandbox).toContainText(t('home.demos.sandbox.file1'));
    await expect(sandbox).toContainText(t('home.demos.sandbox.browserTitle'));
    await expect(sandbox).toContainText(t('home.demos.sandbox.previewTitle'));
    for (const index of [1, 2, 3]) {
      await expect(sandbox).toContainText(
        t(`home.demos.sandbox.previewItem${index}`),
      );
      await expect(sandbox).toContainText(
        t(`home.demos.sandbox.previewDetail${index}`),
      );
    }

    const projects = page.getByRole('img', {
      name: t('home.demos.projects.label'),
    });
    await projects.scrollIntoViewIfNeeded();
    await expect(projects).toContainText(t('home.demos.projects.windowTitle'));
    await expect(projects).toContainText(t('home.demos.projects.project3'));
    await expect(projects).toContainText(t('home.demos.projects.agents2'));
    await expect(projects).not.toContainText(tMarketing('demo.chrome.share'));
  });

  test('two chapters and supporting capabilities link to every module', async ({
    page,
  }) => {
    await gotoClientPage(page, '/');
    for (const stage of [
      'projects',
      'connect',
      'pool',
      'delegate',
      'govern',
      'arena',
    ] as const) {
      await expect(
        page.getByRole('heading', {
          name: t(`home.tour.${stage}.title`).replace('\n', ' '),
        }),
      ).toBeVisible();
    }
    const features = page.locator('#features');
    for (const module of [
      'projects',
      'agents',
      'governance',
      'knowledge',
      'automations',
      'chat',
    ]) {
      await expect(
        features.locator(`a[href="/platform/${module}"]`),
      ).toHaveCount(1);
    }
    await expect(features.getByRole('img')).toHaveCount(2);
  });
});

/**
 * Platform leads use distinct actual product screenshots. Supporting tours
 * retain page-owned scenarios, with complete reduced-motion end states.
 */
test.describe('feature page product screenshots and tours', () => {
  test('automations page shows its real run and protected actions', async ({
    page,
  }) => {
    await gotoClientPage(page, '/platform/automations');
    await expect(
      page.getByRole('img', {
        name: t('demo.pages.automations.label'),
        exact: true,
      }),
    ).toBeVisible();
    const govern = page.getByRole('img', {
      name: t('platformAutomations.demos.govern.label'),
    });
    await govern.scrollIntoViewIfNeeded();
    await expect(govern).toContainText(
      t('platformAutomations.demos.govern.approvalTitle'),
    );
    await expect(govern).toContainText(t('home.demos.govern.approved'));
    const agents = page.getByRole('img', {
      name: t('platformAutomations.demos.connect.label'),
    });
    await agents.scrollIntoViewIfNeeded();
    await expect(agents).toContainText(
      t('platformAutomations.demos.connect.agent1'),
    );
  });

  test('knowledge page shows its real library and cited project context', async ({
    page,
  }) => {
    await gotoClientPage(page, '/platform/knowledge');
    await expect(
      page.getByRole('img', {
        name: t('demo.pages.knowledge.label'),
        exact: true,
      }),
    ).toBeVisible();
    const chat = page.getByRole('img', {
      name: t('platformKnowledge.demos.hero.label'),
    });
    await chat.scrollIntoViewIfNeeded();
    await expect(chat).toContainText(
      t('platformKnowledge.demos.hero.citation1'),
    );
    await expect(chat.locator('.lucide-cpu')).toHaveCount(1);
    await expect(chat.locator('.lucide-chevron-down')).toHaveCount(1);
    await expect(chat.locator('.lucide-bot')).toHaveCount(0);
    const projects = page.getByRole('img', {
      name: t('platformKnowledge.demos.projects.label'),
    });
    await projects.scrollIntoViewIfNeeded();
    await expect(projects).toContainText(
      t('platformKnowledge.demos.projects.project1'),
    );
  });

  test('agents page shows its real agent roster and scoped reference material', async ({
    page,
  }) => {
    await gotoClientPage(page, '/platform/agents');
    await expect(
      page.getByRole('img', {
        name: t('demo.pages.agents.label'),
        exact: true,
      }),
    ).toBeVisible();
    const projects = page.getByRole('img', {
      name: t('platformAgents.demos.projects.label'),
    });
    await projects.scrollIntoViewIfNeeded();
    await expect(projects).toContainText(
      t('platformAgents.demos.projects.project1'),
    );
    const knowledge = page.getByRole('img', {
      name: t('platformAgents.demos.knowledge.label'),
    });
    await knowledge.scrollIntoViewIfNeeded();
    await expect(knowledge).toContainText(
      t('platformAgents.demos.knowledge.source1'),
    );
    await expect(knowledge).not.toContainText(
      t('home.demos.knowledge.source1'),
    );
  });

  test('governance page shows real audit logs and configured policy agents', async ({
    page,
  }) => {
    await gotoClientPage(page, '/platform/governance');
    await expect(
      page.getByRole('img', {
        name: t('demo.pages.governance.label'),
        exact: true,
      }),
    ).toBeVisible();
    const agents = page.getByRole('img', {
      name: t('platformGovernance.demos.connect.label'),
    });
    await agents.scrollIntoViewIfNeeded();
    await expect(agents).toContainText(
      t('platformGovernance.demos.connect.agent1'),
    );
    const automation = page.getByRole('img', {
      name: t('platformGovernance.demos.automation.label'),
    });
    await automation.scrollIntoViewIfNeeded();
    await expect(automation).toContainText(
      t('platformGovernance.demos.automation.trigger'),
    );
  });

  test('chat page shows a real structured reply and its supporting library', async ({
    page,
  }) => {
    await gotoClientPage(page, '/platform/chat');
    await expect(
      page.getByRole('img', { name: t('demo.pages.chat.label'), exact: true }),
    ).toBeVisible();
    const projects = page.getByRole('img', {
      name: t('platformChat.demos.projects.label'),
    });
    await projects.scrollIntoViewIfNeeded();
    await expect(projects).toContainText(
      t('platformChat.demos.projects.project1'),
    );
    const knowledge = page.getByRole('img', {
      name: t('platformChat.demos.knowledge.label'),
    });
    await knowledge.scrollIntoViewIfNeeded();
    await expect(knowledge).toContainText(
      t('platformChat.demos.knowledge.source1'),
    );
  });

  test('platform hub shows its real inbox and two focused project tours', async ({
    page,
  }) => {
    await gotoClientPage(page, '/platform');
    await expect(
      page.getByRole('img', { name: t('demo.pages.hub.label'), exact: true }),
    ).toBeVisible();
    const agents = page.getByRole('img', {
      name: t('platformHub.demos.connect.label'),
    });
    await agents.scrollIntoViewIfNeeded();
    await expect(agents).toContainText(t('platformHub.demos.connect.agent1'));
    await expect(agents).not.toContainText(t('home.demos.connect.agent1'));
    const projects = page.getByRole('img', {
      name: t('platformHub.demos.projects.label'),
    });
    await projects.scrollIntoViewIfNeeded();
    await expect(projects).toContainText(
      t('platformHub.demos.projects.project1'),
    );
    await expect(projects).not.toContainText(t('home.demos.projects.project1'));
    await expect(page.getByRole('main').getByRole('img')).toHaveCount(3);
  });

  test('platform module cards deep-link to every module', async ({ page }) => {
    await gotoClientPage(page, '/platform');
    for (const module of [
      'agents',
      'chat',
      'projects',
      'automations',
      'knowledge',
      'governance',
    ]) {
      await expect(
        page.getByRole('main').locator(`a[href="/platform/${module}"]`).first(),
      ).toBeVisible();
    }
    await page
      .getByRole('main')
      .locator('a[href="/platform/automations"]')
      .first()
      .click();
    await expect(page).toHaveURL(/\/platform\/automations$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      t('platformAutomations.title'),
    );
  });

  test('projects page shows the real board and a project-specific task tour', async ({
    page,
  }) => {
    await gotoClientPage(page, '/platform/projects');
    await expect(
      page.getByRole('img', {
        name: t('demo.pages.projects.label'),
        exact: true,
      }),
    ).toBeVisible();
    const tasks = page.getByRole('img', {
      name: t('platformProjects.demos.tasks.label'),
    });
    await tasks.scrollIntoViewIfNeeded();
    await expect(tasks).toContainText(t('platformProjects.demos.tasks.id3'));
    await expect(tasks).toContainText(t('platformProjects.demos.tasks.title3'));
    await expect(tasks).not.toContainText(t('home.demos.tasks.title3'));
    const chat = page.getByRole('img', {
      name: t('platformProjects.demos.hero.label'),
    });
    await chat.scrollIntoViewIfNeeded();
    await expect(chat).toContainText(t('platformProjects.demos.hero.prompt'));
    await expect(chat).not.toContainText(t('home.demos.hero.prompt'));
  });
});
