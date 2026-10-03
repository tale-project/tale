import { expect, test, type Locator } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

const demoFields = {
  connect: [
    'agent1',
    'agent2',
    'agent3',
    'agent4',
    'agent5',
    'model1',
    'model2',
    'model3',
    'model4',
    'model5',
  ],
  knowledge: ['source1', 'source2', 'source3', 'source4'],
  arena: [
    'prompt',
    'modelA',
    'modelB',
    'replyA1',
    'replyA2',
    'replyA3',
    'replyB1',
    'replyB2',
    'replyB3',
  ],
  automation: [
    'trigger',
    'llm',
    'condition',
    'action',
    'actionAlt',
    'run1',
    'run2',
    'run3',
    'duration1',
    'duration2',
    'duration3',
  ],
  govern: [
    'approvalTitle',
    'requester',
    'audit1',
    'audit2',
    'audit3',
    'budgetValue',
  ],
  tasks: [
    'id1',
    'title1',
    'assignee1',
    'id2',
    'title2',
    'assignee2',
    'id3',
    'title3',
    'assignee3',
    'id4',
    'title4',
    'assignee4',
    'id5',
    'title5',
    'assignee5',
  ],
  sandbox: [
    'prompt',
    'reply',
    'agent',
    'model',
    'file1',
    'file2',
    'file3',
    'file4',
    'browserTitle',
    'previewTitle',
    'previewDescription',
    'previewItem1',
    'previewDetail1',
    'previewItem2',
    'previewDetail2',
    'previewItem3',
    'previewDetail3',
  ],
} as const;

const demoChrome = {
  connect: ['statusReady'],
  knowledge: ['statusIndexed'],
  arena: ['vs'],
  automation: [
    'kindTrigger',
    'kindLlm',
    'kindCondition',
    'kindAction',
    'logTitle',
    'logColRun',
    'logColStatus',
    'logColDuration',
    'statusCompleted',
    'statusAwaiting',
    'statusRunning',
  ],
  govern: ['approved', 'auditTitle', 'budgetLabel'],
  tasks: ['colTodo', 'colInProgress', 'colInReview', 'colDone', 'working'],
  sandbox: ['filesTab', 'liveTab', 'treeRoot', 'liveHint'],
} as const;

/** A visible figure can still hide a whole node inside its canvas. Measure
 * actual text fragments against every clipping ancestor, not only the frame. */
async function expectReadable(locator: Locator) {
  await expect(locator).toBeVisible();
  const clipped = await locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const fragments = [...range.getClientRects()];
    const failures: string[] = [];
    for (
      let ancestor: Element | null = element;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      const style = getComputedStyle(ancestor);
      const bounds = ancestor.getBoundingClientRect();
      const clipsX = /hidden|clip|auto|scroll/.test(style.overflowX);
      const clipsY = /hidden|clip|auto|scroll/.test(style.overflowY);
      if (
        fragments.some(
          (rect) =>
            (clipsX &&
              (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) ||
            (clipsY &&
              (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1)),
        )
      ) {
        failures.push(`${ancestor.tagName}.${ancestor.className}`);
      }
      if (ancestor.getAttribute('role') === 'img') break;
    }
    return failures;
  });
  expect(clipped, `Clipped text: ${await locator.textContent()}`).toEqual([]);
}

for (const locale of ['en', 'de', 'fr'] as const) {
  const { t } = createI18n(
    new URL(`../../../messages/${locale}.yml`, import.meta.url),
  );
  const prefix = locale === 'en' ? '' : `/${locale}`;

  for (const width of [320, 390, 768, 1024, 1440]) {
    test(`${locale} demo text remains readable at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const route of [
        {
          path: '/',
          namespace: 'home',
          demos: ['tasks', 'sandbox', 'govern'],
        },
        {
          path: '/platform/projects',
          namespace: 'platformProjects',
          demos: ['tasks'],
        },
        {
          path: '/platform/agents',
          namespace: 'platformAgents',
          demos: ['connect', 'sandbox'],
        },
        {
          path: '/platform/knowledge',
          namespace: 'platformKnowledge',
          demos: ['knowledge'],
        },
        {
          path: '/platform/chat',
          namespace: 'platformChat',
          demos: ['arena'],
        },
        {
          path: '/platform/automations',
          namespace: 'platformAutomations',
          demos: ['automation', 'govern'],
        },
        {
          path: '/platform/governance',
          namespace: 'platformGovernance',
          demos: ['govern'],
        },
      ] as const) {
        await page.goto(`${prefix}${route.path}`);
        await page.evaluate(() => document.fonts.ready);
        for (const name of route.demos) {
          const key = `${route.namespace}.demos.${name}`;
          const demo = page.getByRole('img', {
            name: t(`${key}.label`),
            exact: true,
          });
          await demo.scrollIntoViewIfNeeded();
          for (const field of demoFields[name]) {
            const labels = demo.getByText(t(`${key}.${field}`), {
              exact: true,
            });
            await expect(labels.first()).toBeVisible();
            for (const label of await labels.all()) {
              await expectReadable(label);
            }
          }
          for (const field of demoChrome[name]) {
            const labels = demo.getByText(t(`home.demos.${name}.${field}`), {
              exact: true,
            });
            await expect(labels.first()).toBeVisible();
            for (const label of await labels.all()) {
              await expectReadable(label);
            }
          }
          if (name === 'tasks') {
            const cards = demo.locator('article');
            await expect(cards).toHaveCount(5);
            for (const card of await cards.all()) {
              expect((await card.boundingBox())?.width).toBeGreaterThanOrEqual(
                140,
              );
            }
            const boxes = await cards.evaluateAll((elements) =>
              elements.map((element) => {
                const { left, right, top, bottom } =
                  element.getBoundingClientRect();
                return { left, right, top, bottom };
              }),
            );
            for (const [index, box] of boxes.entries()) {
              for (const other of boxes.slice(index + 1)) {
                expect(
                  box.right <= other.left ||
                    box.left >= other.right ||
                    box.bottom <= other.top ||
                    box.top >= other.bottom,
                  'Task cards must not overlap adjacent lanes',
                ).toBe(true);
              }
            }
          }
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
      }
    });
  }
}

test('the mobile GitHub link has a 44px touch target', async ({ page }) => {
  const { t } = createI18n(
    new URL('../../../messages/en.yml', import.meta.url),
  );
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/');
  await page
    .getByRole('button', { name: t('nav.openMenu'), exact: true })
    .click();
  const link = page
    .getByRole('dialog')
    .getByRole('link', { name: t('footer.githubAriaLabel'), exact: true });
  await expect(link).toBeVisible();
  expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
});
