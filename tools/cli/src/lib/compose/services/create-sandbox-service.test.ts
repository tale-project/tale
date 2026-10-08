import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { setProjectId } from '../../project/project-context';
import { generateStatefulCompose } from '../generators/generate-stateful-compose';
import { createSandboxService } from './create-sandbox-service';

const originalRoot = process.env.SANDBOX_DOCKER_DATA_ROOT;
const originalPath = process.env.SANDBOX_DOCKER_DATA_PATH;
const config = { version: 'test', registry: 'registry.test/tale' };
setProjectId('sandbox-observation-test');
afterEach(() => {
  if (originalRoot === undefined) delete process.env.SANDBOX_DOCKER_DATA_ROOT;
  else process.env.SANDBOX_DOCKER_DATA_ROOT = originalRoot;
  if (originalPath === undefined) delete process.env.SANDBOX_DOCKER_DATA_PATH;
  else process.env.SANDBOX_DOCKER_DATA_PATH = originalPath;
});

test('Docker data observation adds a read-only mount only when the operator configured it', () => {
  delete process.env.SANDBOX_DOCKER_DATA_ROOT;
  delete process.env.SANDBOX_DOCKER_DATA_PATH;
  expect(
    createSandboxService(config).volumes?.some((mount) =>
      mount.includes('/docker-data'),
    ),
  ).toBe(false);
  process.env.SANDBOX_DOCKER_DATA_ROOT = '/srv/docker';
  const service = createSandboxService(config);
  expect(service.volumes).toContain(
    '/srv/docker:/var/lib/tale-sandbox/docker-data:ro',
  );
  expect(service.environment?.SANDBOX_DOCKER_DATA_ROOT).toBe('/srv/docker');
  expect(service.environment?.SANDBOX_DOCKER_DATA_PATH).toBe(
    '/var/lib/tale-sandbox/docker-data',
  );
});

test('mount paths cannot inject another compose mount option', () => {
  process.env.SANDBOX_DOCKER_DATA_ROOT = '/srv/docker:/unexpected';
  expect(() => createSandboxService(config)).toThrow('mount separators');
});

test('the spawner is probed every 30 s once healthy and every 2 s while it boots, alike in every pipeline', () => {
  const repoRoot = fileURLToPath(
    new URL('../../../../../../', import.meta.url),
  );
  const cadence = {
    interval: '30s',
    start_period: '30s',
    start_interval: '2s',
  };
  expect(createSandboxService(config).healthcheck).toMatchObject(cadence);
  // The generated stack file carries the field through to Compose.
  const generated = parse(generateStatefulCompose(config, 'localhost')) as {
    services: Record<string, { healthcheck?: Record<string, unknown> }>;
  };
  expect(generated.services['sandbox']?.healthcheck).toMatchObject(cadence);
  const compose = parse(
    readFileSync(`${repoRoot}compose.yml`, 'utf8'),
  ) as typeof generated;
  expect(compose.services['sandbox']?.healthcheck).toMatchObject(cadence);
  const dockerfile = readFileSync(
    `${repoRoot}services/sandbox/Dockerfile`,
    'utf8',
  ).replace(/\\\n\s*/g, ' ');
  const directive = dockerfile
    .split('\n')
    .find((line) => line.startsWith('HEALTHCHECK'));
  expect(directive).toContain('--interval=30s');
  expect(directive).toContain('--start-period=30s');
  expect(directive).toContain('--start-interval=2s');
});
