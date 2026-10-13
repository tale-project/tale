import type { Locator, Page } from '@playwright/test';

import { deleteAutomationRow } from '../helpers/automations';
import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Testing over the lane that needs no AI provider: an automation saved with
 * one test through the app API, then the editor's Tests dock end to end —
 * run all, break the expectation and read what the test expected against
 * what it got, try the draft, mend the expectation, save the version with
 * its tests recorded and deploy it — and a failed run saved as a test from
 * the Runs tab. Each probe is deleted from its list row so the worker org
 * leaves the spec as it entered.
 */

/** A message with its placeholders filled; the e2e `t()` returns the raw
 * ICU string. */
const fill = (key: string, values: Record<string, string | number>): string =>
  Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    t(key),
  );

/** The text of one branch of an ICU `select` or `plural` message, its own
 * placeholders left in: the e2e `t()` returns the raw message. */
function branch(message: string, name: string): string {
  const at = message.search(new RegExp(`\\b${name} \\{`));
  if (at < 0) throw new Error(`no branch "${name}" in: ${message}`);
  const start = message.indexOf('{', at);
  let depth = 0;
  for (let index = start; index < message.length; index += 1) {
    if (message[index] === '{') depth += 1;
    else if (message[index] === '}') {
      depth -= 1;
      if (depth === 0) return message.slice(start + 1, index);
    }
  }
  throw new Error(`unbalanced branch "${name}" in: ${message}`);
}

/** What a message says before its first placeholder: the part a rendered
 * value follows. */
const before = (key: string): string => t(key).split('{')[0] ?? '';

/** A POST to the app API as the signed-in member; its status and body. The
 * page must be on the app's origin. */
async function appPost(
  page: Page,
  organizationId: string,
  route: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async (call) => {
      const response = await fetch(
        `/api/app${call.route}?orgId=${encodeURIComponent(call.organizationId)}`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(call.body),
        },
      );
      return {
        status: response.status,
        body: (await response.json().catch(() => null)) as unknown,
      };
    },
    { organizationId, route, body },
  );
}

/** Replaces a test's YAML in the open inspector with `text`. */
async function setTestYaml(
  page: Page,
  inspector: Locator,
  text: string,
): Promise<void> {
  await inspector
    .getByRole('tab', { name: t('automations.tests.inspector.setup') })
    .click();
  const toggle = inspector.getByRole('switch', {
    name: t('automations.tests.inspector.editYaml'),
  });
  if ((await toggle.getAttribute('aria-checked')) !== 'true') {
    await toggle.click();
  }
  const field = inspector.getByRole('textbox', {
    name: t('automations.tests.inspector.yaml'),
  });
  await field.click();
  await page.keyboard.press('ControlOrMeta+A');
  // Inserted as one input, so the editor's auto-indent has nothing to add.
  await page.keyboard.insertText(text);
}

const SAYS = 'testing-probe';
const SAYS_NAME = 'Testing probe';

/** The probe: one transform step returning a word, and a test expecting one. */
const sayer = (word: string, expected: string) => ({
  version: 1,
  name: SAYS,
  nodes: [{ id: 'greet', type: 'transform', code: `return '${word}';` }],
  output: '{{ nodes.greet.output }}',
  tests: [{ name: 'Says hello', input: {}, expect: { output: expected } }],
});

const testYaml = (expected: string): string =>
  `name: Says hello\ninput: {}\nexpect:\n  output: ${expected}\n`;

test('runs, breaks and mends a test, tries the draft, saves with its tests and deploys', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  await page.goto(`/dashboard/${organizationId}/automations`);
  const saved = await appPost(
    page,
    organizationId,
    `/automations/${SAYS}/save`,
    {
      document: sayer('hello', 'hello'),
      message: 'Says hello',
      presentation: { name: SAYS_NAME },
      create: true,
    },
  );
  expect(saved.status).toBe(201);

  await page.goto(
    `/dashboard/${organizationId}/automations/${SAYS}/editor?panel=tests`,
  );
  const dock = page.getByRole('region', {
    name: t('automations.tests.title'),
    exact: true,
  });
  const row = (status: 'passed' | 'failed') =>
    dock.getByRole('button', {
      name: `${fill('testResults.statusPrefix', {
        status: t(`testResults.status.${status}`),
      })} Says hello`,
    });
  // The save ran the test: the version's tests are recorded and read as a tick.
  await expect(row('passed')).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  // Run all: the same test again, now checked by hand.
  await dock
    .getByRole('button', { name: t('automations.tests.runAll') })
    .click();
  await expect(
    dock.getByText(branch(t('automations.tests.source.checked'), 'manual')),
  ).toBeVisible({
    timeout: TIMEOUT.PERSIST,
  });

  // Break the expectation: the draft's test now expects another word.
  await row('passed').click();
  const inspector = page.getByRole('region', { name: 'Says hello' });
  await setTestYaml(page, inspector, testYaml('goodbye'));
  await inspector
    .getByRole('button', {
      name: fill('automations.tests.runOne', { name: 'Says hello' }),
    })
    .click();
  await expect(row('failed')).toBeVisible({ timeout: TIMEOUT.PERSIST });
  await inspector
    .getByRole('tab', { name: t('automations.tests.inspector.result') })
    .click();
  // What it expected against what it got, in words and side by side.
  await expect(
    inspector.getByText(
      branch(t('automations.tests.failure.output'), 'one').replace('#', '1'),
    ),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  const diff = inspector.getByRole('group', {
    name: t('automations.tests.result.diffLabel'),
  });
  await expect(diff).toContainText('goodbye');
  await expect(diff).toContainText('hello');

  // Try the draft: one run of the unsaved document, shown above the canvas.
  await page
    .getByRole('button', { name: t('automations.detail.runMock') })
    .first()
    .click();
  const runDialog = page.getByRole('dialog', {
    name: t('automations.detail.runMock'),
  });
  await expect(
    runDialog.getByRole('radio', {
      name: t('automations.detail.runTarget.draft'),
    }),
  ).toBeChecked({ timeout: TIMEOUT.VISIBLE });
  await runDialog
    .getByRole('button', { name: t('automations.detail.runMock'), exact: true })
    .click();
  const strip = page.getByRole('region', {
    name: t('automations.try.unsaved'),
  });
  await expect(strip).toContainText(
    before('automations.try.succeeded').trim(),
    {
      timeout: TIMEOUT.PERSIST,
    },
  );

  // Mend the expectation: the test passes again on the draft.
  await setTestYaml(page, inspector, testYaml('hello'));
  await inspector
    .getByRole('button', {
      name: fill('automations.tests.runOne', { name: 'Says hello' }),
    })
    .click();
  await expect(row('passed')).toBeVisible({ timeout: TIMEOUT.PERSIST });

  // Save: the new version is saved with its tests run and recorded.
  // Exact: the try strip's Save as test also contains the word.
  await page
    .getByRole('button', { name: t('common.actions.save'), exact: true })
    .click();
  const saveDialog = page.getByRole('dialog', {
    name: t('automations.detail.saveDialog.title'),
  });
  await saveDialog
    .getByRole('textbox', { name: t('automations.detail.saveMessageLabel') })
    .fill('Mended the expectation');
  await saveDialog
    .getByRole('button', { name: t('automations.detail.saveVersion') })
    .click();
  await expect(
    dock.getByText(
      branch(t('automations.tests.source.checked'), 'save').replace(
        '{version}',
        '2',
      ),
    ),
  ).toBeVisible({
    timeout: TIMEOUT.PERSIST,
  });

  // Deploy the version its tests passed: it goes live in one click.
  await page
    .getByRole('button', {
      name: fill('automations.detail.deployVersion', { version: 2 }),
    })
    .click();
  await page.goto(`/dashboard/${organizationId}/automations/${SAYS}/versions`);
  await expect(
    page.getByRole('heading', {
      name: fill('automations.deployments.live.title', { version: 2 }),
    }),
  ).toBeVisible({ timeout: TIMEOUT.PERSIST });

  // Cleanup: delete the probe from its list row.
  await page.goto(`/dashboard/${organizationId}/automations`);
  await deleteAutomationRow(
    page,
    page.getByRole('row').filter({ hasText: SAYS_NAME }).first(),
  );
});

const FAILS = 'testing-failing-probe';
const FAILS_NAME = 'Testing failing probe';

test('saves a failed run as a test that fails until it is fixed', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  await page.goto(`/dashboard/${organizationId}/automations`);
  expect(
    (
      await appPost(page, organizationId, `/automations/${FAILS}/save`, {
        document: {
          version: 1,
          name: FAILS,
          nodes: [
            {
              id: 'boom',
              type: 'transform',
              code: "throw new Error('Probe failure');",
            },
          ],
          output: '{{ nodes.boom.output }}',
        },
        message: 'Fails on purpose',
        presentation: { name: FAILS_NAME },
        create: true,
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await appPost(page, organizationId, `/automations/${FAILS}/deploy`, {
        version: 1,
        expectedDeployedVersion: null,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await appPost(page, organizationId, `/automations/${FAILS}/start`, {
        mode: 'mock',
        input: {},
      })
    ).status,
  ).toBe(201);

  // The run ends failed; its row's menu offers Save as test.
  await page.goto(`/dashboard/${organizationId}/automations/${FAILS}/runs`);
  const menu = page
    .getByRole('button', { name: /^More for the run of / })
    .first();
  await expect(menu).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: t('automations.runs.status.failed') })
      .first(),
  ).toBeVisible({ timeout: TIMEOUT.PERSIST });
  await menu.click();
  await page
    .getByRole('menuitem', { name: t('automationRuns.again.saveAsTest') })
    .click();

  // The editor opens on Tests with the dialog for that run; a failed run's
  // test expects it to succeed, which it does not yet.
  const dialog = page.getByRole('dialog', {
    name: t('automations.tests.fromRun.title'),
  });
  await expect(dialog).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await expect(
    dialog.getByRole('radio', {
      name: t('automations.tests.fromRun.expect.succeeds'),
    }),
  ).toBeChecked();
  await dialog
    .getByRole('button', { name: t('automations.tests.fromRun.confirm') })
    .click();

  const dock = page.getByRole('region', {
    name: t('automations.tests.title'),
    exact: true,
  });
  await dock
    .getByRole('button', { name: t('automations.tests.runAll') })
    .click();
  await expect(
    dock.getByRole('button', {
      name: `${fill('testResults.statusPrefix', {
        status: t('testResults.status.failed'),
      })} ${before('automations.tests.fromRun.defaultName')}`,
    }),
  ).toBeVisible({ timeout: TIMEOUT.PERSIST });

  // Cleanup: the draft is thrown away with the page, and the probe deleted.
  await page.goto(`/dashboard/${organizationId}/automations`);
  await deleteAutomationRow(
    page,
    page.getByRole('row').filter({ hasText: FAILS_NAME }).first(),
  );
});
