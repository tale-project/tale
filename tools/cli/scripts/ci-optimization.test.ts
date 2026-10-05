import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

import { parse } from 'yaml';

test('informational Scorecard retains weekly, protection-change and manual analysis', async () => {
  const workflow = parse(
    await readFile(
      new URL('../../../.github/workflows/scorecard.yml', import.meta.url),
      'utf8',
    ),
  ) as {
    on: Record<string, unknown>;
    jobs: Record<
      string,
      { steps: { uses?: string; with?: Record<string, unknown> }[] }
    >;
  };
  expect(workflow.on.schedule).toEqual([{ cron: '0 4 * * 1' }]);
  expect(Object.hasOwn(workflow.on, 'branch_protection_rule')).toBe(true);
  expect(Object.hasOwn(workflow.on, 'workflow_dispatch')).toBe(true);
  expect(Object.hasOwn(workflow.on, 'push')).toBe(false);
  expect(
    workflow.jobs.analysis?.steps.find((step) =>
      step.uses?.startsWith('ossf/scorecard-action@'),
    )?.with?.publish_results,
  ).toBe(true);
});
