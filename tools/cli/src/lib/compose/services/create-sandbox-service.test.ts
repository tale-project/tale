import { afterEach, expect, test } from 'bun:test';

import { setProjectId } from '../../project/project-context';
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
