import { expect, test } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';

/**
 * Animated homepage demos, asserted deterministically: under
 * `prefers-reduced-motion` the timeline driver pins every demo to its final
 * beat, so the complete end state must be present without waiting on
 * animation timing. This is also the state prerendered HTML ships.
 */

const { t } = createI18n(new URL('../../../messages/en.yml', import.meta.url));

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test.describe('homepage demos', () => {
  test('hero demo renders its complete end state under reduced motion', async ({
    page,
  }) => {
    await page.goto('/');

    const demo = page.getByRole('img', { name: t('home.demos.hero.label') });
    await expect(demo).toBeVisible();
    await expect(demo).toContainText(t('home.demos.hero.prompt'));
    await expect(demo).toContainText(t('home.demos.hero.routedTitle'));
    await expect(demo).toContainText(t('home.demos.hero.reply4'));
    await expect(demo).toContainText(t('home.demos.hero.citation2'));
    await expect(demo).toContainText(t('home.demos.chrome.share'));
  });

  test('tour demos render their complete end states under reduced motion', async ({
    page,
  }) => {
    await page.goto('/');

    const connect = page.getByRole('img', {
      name: t('home.demos.connect.label'),
    });
    await connect.scrollIntoViewIfNeeded();
    await expect(connect).toContainText(t('home.demos.connect.windowTitle'));
    await expect(connect).toContainText(t('home.demos.connect.agent1'));
    await expect(connect).toContainText(t('home.demos.connect.statusReady'));
    await expect(connect).not.toContainText(t('home.demos.chrome.share'));

    const knowledge = page.getByRole('img', {
      name: t('home.demos.knowledge.label'),
    });
    await knowledge.scrollIntoViewIfNeeded();
    await expect(knowledge).toContainText(
      t('home.demos.knowledge.windowTitle'),
    );
    await expect(knowledge).toContainText(t('home.demos.knowledge.source3'));
    await expect(knowledge).toContainText(
      t('home.demos.knowledge.statusIndexed'),
    );
    await expect(knowledge).not.toContainText(t('home.demos.chrome.share'));

    const automation = page.getByRole('img', {
      name: t('home.demos.automation.label'),
    });
    await automation.scrollIntoViewIfNeeded();
    await expect(automation).toContainText(
      t('home.demos.automation.windowTitle'),
    );
    await expect(automation).toContainText(t('home.demos.automation.trigger'));
    await expect(automation).toContainText(
      t('home.demos.automation.statusAwaiting'),
    );
    await expect(automation).not.toContainText(t('home.demos.chrome.share'));

    const govern = page.getByRole('img', {
      name: t('home.demos.govern.label'),
    });
    await govern.scrollIntoViewIfNeeded();
    await expect(govern).toContainText(t('home.demos.govern.approved'));
    await expect(govern).toContainText(t('home.demos.govern.audit2'));

    const arena = page.getByRole('img', {
      name: t('home.demos.arena.label'),
    });
    await arena.scrollIntoViewIfNeeded();
    await expect(arena).toContainText(t('home.demos.arena.prompt'));
    await expect(arena).toContainText(t('home.demos.arena.replyB2'));

    const projects = page.getByRole('img', {
      name: t('home.demos.projects.label'),
    });
    await projects.scrollIntoViewIfNeeded();
    await expect(projects).toContainText(t('home.demos.projects.windowTitle'));
    await expect(projects).toContainText(t('home.demos.projects.project3'));
    await expect(projects).toContainText(t('home.demos.projects.agents2'));
    await expect(projects).not.toContainText(t('home.demos.chrome.share'));
  });

  test('tour headings carry the six-stage journey', async ({ page }) => {
    await page.goto('/');
    for (const stage of [
      'connect',
      'pool',
      'delegate',
      'govern',
      'arena',
      'projects',
    ] as const) {
      await expect(
        page.getByRole('heading', {
          name: t(`home.tour.${stage}.title`).replace('\n', ' '),
        }),
      ).toBeVisible();
    }
  });
});

/**
 * Every platform page tells its own demo story: the shared demo components
 * take per-page scenarios from `<namespace>.demos.*`, so the same windows
 * must show different content than the homepage. End states again asserted
 * under reduced motion — no timing waits.
 */
test.describe('feature page demo scenarios', () => {
  test('automations page runs the invoice pipeline', async ({ page }) => {
    await page.goto('/platform/automations');

    const hero = page.getByRole('img', {
      name: t('platformAutomations.demos.automation.label'),
    });
    await expect(hero).toBeVisible();
    await expect(hero).toContainText(
      t('platformAutomations.demos.automation.trigger'),
    );
    await expect(hero).toContainText(t('home.demos.automation.statusAwaiting'));

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

    const projects = page.getByRole('img', {
      name: t('platformAutomations.demos.projects.label'),
    });
    await projects.scrollIntoViewIfNeeded();
    await expect(projects).toContainText(
      t('platformAutomations.demos.projects.project1'),
    );
  });

  test('knowledge page cites the indexed manual', async ({ page }) => {
    await page.goto('/platform/knowledge');

    const hero = page.getByRole('img', {
      name: t('platformKnowledge.demos.knowledge.label'),
    });
    await expect(hero).toBeVisible();
    await expect(hero).toContainText(
      t('platformKnowledge.demos.knowledge.source1'),
    );
    await expect(hero).toContainText(t('home.demos.knowledge.typeEntry'));

    const chat = page.getByRole('img', {
      name: t('platformKnowledge.demos.hero.label'),
    });
    await chat.scrollIntoViewIfNeeded();
    await expect(chat).toContainText(
      t('platformKnowledge.demos.hero.citation1'),
    );

    const projects = page.getByRole('img', {
      name: t('platformKnowledge.demos.projects.label'),
    });
    await projects.scrollIntoViewIfNeeded();
    await expect(projects).toContainText(
      t('platformKnowledge.demos.projects.project1'),
    );
  });

  test('agents page shows its own roster and a sandbox Files/Live pane', async ({
    page,
  }) => {
    await page.goto('/platform/agents');

    const hero = page.getByRole('img', {
      name: t('platformAgents.demos.connect.label'),
    });
    await expect(hero).toBeVisible();
    await expect(hero).toContainText(t('platformAgents.demos.connect.agent2'));
    await expect(hero).not.toContainText(t('home.demos.connect.agent2'));

    const projects = page.getByRole('img', {
      name: t('platformAgents.demos.projects.label'),
    });
    await projects.scrollIntoViewIfNeeded();
    await expect(projects).toContainText(
      t('platformAgents.demos.projects.project1'),
    );

    const sandbox = page.getByRole('img', {
      name: t('platformAgents.demos.sandbox.label'),
    });
    await sandbox.scrollIntoViewIfNeeded();
    await expect(sandbox).toContainText(
      t('platformAgents.demos.sandbox.browserTitle'),
    );
    await expect(sandbox).toContainText(
      t('platformAgents.demos.sandbox.activeFile'),
    );
    await expect(sandbox).not.toContainText(t('home.demos.sandbox.prompt'));
  });

  test('governance page holds a knowledge write for approval', async ({
    page,
  }) => {
    await page.goto('/platform/governance');

    const hero = page.getByRole('img', {
      name: t('platformGovernance.demos.govern.label'),
    });
    await expect(hero).toBeVisible();
    await expect(hero).toContainText(
      t('platformGovernance.demos.govern.approvalTitle'),
    );
    await expect(hero).toContainText(
      t('platformGovernance.demos.govern.audit3'),
    );

    const agents = page.getByRole('img', {
      name: t('platformGovernance.demos.connect.label'),
    });
    await agents.scrollIntoViewIfNeeded();
    await expect(agents).toContainText(
      t('platformGovernance.demos.connect.agent1'),
    );
  });

  test('chat page duels announcement drafts in Arena', async ({ page }) => {
    await page.goto('/platform/chat');

    const hero = page.getByRole('img', {
      name: t('platformChat.demos.arena.label'),
    });
    await expect(hero).toBeVisible();
    await expect(hero).toContainText(t('platformChat.demos.arena.prompt'));
    await expect(hero).toContainText(t('platformChat.demos.arena.replyB3'));

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

  test('platform hub samples each module story', async ({ page }) => {
    await page.goto('/platform');

    const hero = page.getByRole('img', {
      name: t('platformHub.demos.hero.label'),
    });
    await expect(hero).toBeVisible();
    await expect(hero).toContainText(t('platformHub.demos.hero.prompt'));
    await expect(hero).not.toContainText(t('home.demos.hero.prompt'));

    const agents = page.getByRole('img', {
      name: t('platformHub.demos.connect.label'),
    });
    await agents.scrollIntoViewIfNeeded();
    await expect(agents).toContainText(t('platformHub.demos.connect.agent1'));
    await expect(agents).not.toContainText(t('home.demos.connect.agent1'));

    const knowledge = page.getByRole('img', {
      name: t('platformHub.demos.knowledge.label'),
    });
    await knowledge.scrollIntoViewIfNeeded();
    await expect(knowledge).toContainText(
      t('platformHub.demos.knowledge.source1'),
    );
    await expect(knowledge).not.toContainText(
      t('platformKnowledge.demos.knowledge.source1'),
    );

    const automation = page.getByRole('img', {
      name: t('platformHub.demos.automation.label'),
    });
    await automation.scrollIntoViewIfNeeded();
    await expect(automation).toContainText(
      t('platformHub.demos.automation.trigger'),
    );
    await expect(automation).not.toContainText(
      t('platformAutomations.demos.automation.trigger'),
    );

    const govern = page.getByRole('img', {
      name: t('platformHub.demos.govern.label'),
    });
    await govern.scrollIntoViewIfNeeded();
    await expect(govern).toContainText(
      t('platformHub.demos.govern.approvalTitle'),
    );

    const arena = page.getByRole('img', {
      name: t('platformHub.demos.arena.label'),
    });
    await arena.scrollIntoViewIfNeeded();
    await expect(arena).toContainText(t('platformHub.demos.arena.prompt'));
    await expect(arena).not.toContainText(t('platformChat.demos.arena.prompt'));

    const projects = page.getByRole('img', {
      name: t('platformHub.demos.projects.label'),
    });
    await projects.scrollIntoViewIfNeeded();
    await expect(projects).toContainText(
      t('platformHub.demos.projects.project1'),
    );
    await expect(projects).not.toContainText(t('home.demos.projects.project1'));
  });

  test('tour stages deep-link to their module pages', async ({ page }) => {
    const exploreAutomations = t('home.tour.explore').replace(
      '{module}',
      t('nav.product.automations.label'),
    );

    await page.goto('/');
    await expect(
      page.getByRole('link', { name: exploreAutomations }),
    ).toBeVisible();

    await page.goto('/platform');
    await expect(
      page.getByRole('link', { name: exploreAutomations }),
    ).toBeVisible();
  });

  test('projects page runs the relaunch workspace story', async ({ page }) => {
    await page.goto('/platform/projects');

    const hero = page.getByRole('img', {
      name: t('platformProjects.demos.projects.label'),
    });
    await expect(hero).toBeVisible();
    await expect(hero).toContainText(
      t('platformProjects.demos.projects.project1'),
    );
    await expect(hero).not.toContainText(t('home.demos.projects.project1'));

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

    const knowledge = page.getByRole('img', {
      name: t('platformProjects.demos.knowledge.label'),
    });
    await knowledge.scrollIntoViewIfNeeded();
    await expect(knowledge).toContainText(
      t('platformProjects.demos.knowledge.source1'),
    );
    await expect(knowledge).not.toContainText(
      t('home.demos.knowledge.source1'),
    );
  });
});
