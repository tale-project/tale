import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { applyRuntime, observeReadyRuntime } from './runtime-apply';
import { prepareRuntime } from './runtime-prepare';
import {
  RuntimeDockerFixture,
  runtimeFixture,
  type RuntimeFixture,
} from './runtime-test-helper';

const fixtures: RuntimeFixture[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0))
    rmSync(f.directory, { recursive: true, force: true });
});
async function ready() {
  const f = runtimeFixture();
  fixtures.push(f);
  const docker = new RuntimeDockerFixture(f);
  await prepareRuntime(
    {
      repoRoot: f.repoRoot,
      revision: f.revision,
      output: f.options.bundleDirectory,
      platform: 'linux/amd64',
    },
    docker.dependencies(),
  );
  await applyRuntime(f.options, docker.dependencies());
  docker.calls = [];
  return { f, docker };
}
describe.skipIf(process.platform === 'win32')(
  'read-only ready runtime custody',
  () => {
    test('reuses actual topology, image and health proof without resolving secrets or mutating Docker', async () => {
      const { f, docker } = await ready();
      const file = join(f.options.stateDirectory, '.tale/runtime.json');
      const before = readFileSync(file);
      const actual = await observeReadyRuntime(
        f.options,
        docker.dependencies(),
      );
      expect(actual.backendContainer).toMatch(/^[a-f0-9]{64}$/);
      expect(actual.revision).toBe(f.revision);
      expect(readFileSync(file)).toEqual(before);
      expect(
        docker.calls.every(
          (c) =>
            ['info', 'ps', 'container', 'image', 'network'].includes(
              c.args[0],
            ) &&
            (c.args[0] !== 'network' || c.args[1] === 'inspect'),
        ),
      ).toBe(true);
    });
    test.each([
      'pending',
      'name',
      'revision',
      'origin',
      'image',
      'mount',
      'health',
    ])('refuses %s drift before export', async (kind) => {
      const { f, docker } = await ready();
      const file = join(f.options.stateDirectory, '.tale/runtime.json');
      const receipt = JSON.parse(readFileSync(file, 'utf8'));
      if (kind === 'pending') receipt.phase = 'pending';
      if (kind === 'name') receipt.name = 'other';
      if (kind === 'revision') receipt.revision = 'd'.repeat(40);
      writeFileSync(file, JSON.stringify(receipt));
      if (kind === 'origin') f.options.origin = 'https://foreign.invalid';
      const backend = docker.containers.find(
        (c) =>
          (c.Config as { Labels: Record<string, string> }).Labels[
            'com.docker.compose.service'
          ] === 'backend-api',
      )!;
      if (kind === 'image')
        (backend.Config as { Image: string }).Image =
          'foreign@sha256:' + 'e'.repeat(64);
      if (kind === 'mount')
        (backend.Mounts as { Name: string }[])[0].Name = 'foreign_config-data';
      if (kind === 'health') backend.State = { Running: true };
      await expect(
        observeReadyRuntime(f.options, docker.dependencies()),
      ).rejects.toThrow();
      expect(
        docker.calls.some((c) =>
          ['pull', 'tag', 'compose'].includes(c.args[0]),
        ),
      ).toBe(false);
    });
  },
);
