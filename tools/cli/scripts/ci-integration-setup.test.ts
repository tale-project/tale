import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { z } from 'zod';

const workflow = fileURLToPath(
  new URL('../../../.github/workflows/checks.yml', import.meta.url),
);
const integrationSchema = z.object({
  jobs: z.object({
    'backend-integration': z.object({
      'runs-on': z.string(),
      steps: z.array(
        z.object({
          name: z.string().optional(),
          uses: z.string().optional(),
          run: z.string().optional(),
          env: z.record(z.string(), z.string()).optional(),
          with: z.record(z.string(), z.unknown()).optional(),
        }),
      ),
    }),
  }),
});

test('integration teardown is skipped only on an ephemeral runner while the from-source proof remains strict', async () => {
  const { jobs } = integrationSchema.parse(
    parse(await readFile(workflow, 'utf8')),
  );
  const integration = jobs['backend-integration'];
  expect(integration['runs-on']).toBe('ubuntu-latest');
  const builders = integration.steps.filter((step) =>
    step.uses?.startsWith('docker/setup-buildx-action@'),
  );
  expect(builders).toHaveLength(1);
  expect(builders[0]?.with?.cleanup).toBe(false);

  const image = integration.steps.find((step) =>
    step.uses?.startsWith('docker/build-push-action@'),
  );
  expect(image?.with).toMatchObject({
    context: '.',
    file: 'services/db/Dockerfile',
    push: false,
    load: true,
    'cache-from': 'type=gha,scope=db',
  });
  expect(image?.with?.['cache-to']).toBeUndefined();
  const proof = integration.steps.find(
    (step) => step.name === 'Run backend integration',
  );
  expect(proof?.env?.ITEST_REQUIRE_ALL_LANES).toBe('1');
  expect(proof?.env?.ITEST_LANES).toBeUndefined();
  expect(proof?.run).toContain('bun run backend:integration');
  expect(proof?.run).not.toContain('turbo');
});
