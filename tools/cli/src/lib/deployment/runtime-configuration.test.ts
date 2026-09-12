import { afterEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { valueHash } from '../config/releases/identity';
import { applyRuntime, activateRuntimeConfiguration } from './runtime-apply';
import type { RuntimeConfigurationEffect } from './runtime-configuration';
import { ConfigurationDockerFixture } from './runtime-configuration-fixture';
import { prepareRuntime } from './runtime-prepare';
import {
  RuntimeDockerFixture,
  runtimeFixture,
  type RuntimeFixture,
} from './runtime-test-helper';

const fixtures: RuntimeFixture[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0))
    rmSync(fixture.directory, { recursive: true, force: true });
});
async function create() {
  const fixture = runtimeFixture();
  fixtures.push(fixture);
  const docker = new RuntimeDockerFixture(fixture);
  const configuration = new ConfigurationDockerFixture(docker);
  await prepareRuntime(
    {
      repoRoot: fixture.repoRoot,
      revision: fixture.revision,
      output: fixture.options.bundleDirectory,
      platform: 'linux/amd64',
    },
    docker.dependencies(),
  );
  await applyRuntime(fixture.options, configuration.dependencies());
  const config = {
    version: 1 as const,
    sandboxRuntime: { tier: 'runc' as const },
  };
  const effect: RuntimeConfigurationEffect = {
    deploymentBundleSha256: 'a'.repeat(64),
    configurationSha256: 'b'.repeat(64),
    target: {
      origin: fixture.options.origin,
      organizationId: 'example-org',
      organizationSlug: 'example-team',
    },
    resourceSha256: valueHash(config),
    config,
  };
  const receipt = join(
    fixture.options.stateDirectory,
    '.tale/configuration-runtime.json',
  );
  docker.calls = [];
  return {
    fixture,
    docker,
    configuration,
    effect,
    receipt,
    activate: () =>
      activateRuntimeConfiguration(
        fixture.options,
        effect,
        configuration.dependencies(),
      ),
  };
}
describe.skipIf(process.platform === 'win32')(
  'managed boot-time configuration activation',
  () => {
    test('drains the exact proved spawner, verifies new boot/bytes/health, preserves all other state and does not restart ready replay', async () => {
      const run = await create();
      const before = structuredClone(run.docker.containers);
      const secrets = readFileSync(
        join(run.fixture.options.stateDirectory, 'secrets.env'),
      );
      const result = await run.activate();
      expect(result.phase).toBe('ready');
      expect(result.after?.containerId).toBe(result.before.containerId);
      expect(result.after?.startedAt).not.toBe(result.before.startedAt);
      expect(run.configuration.restarted).toBe(1);
      expect(
        run.docker.containers.filter((c) => c.Id !== result.before.containerId),
      ).toEqual(before.filter((c) => c.Id !== result.before.containerId));
      expect(
        readFileSync(join(run.fixture.options.stateDirectory, 'secrets.env')),
      ).toEqual(secrets);
      const bytes = readFileSync(run.receipt);
      run.docker.calls = [];
      expect(await run.activate()).toEqual(result);
      expect(readFileSync(run.receipt)).toEqual(bytes);
      expect(run.configuration.restarted).toBe(1);
      expect(
        run.docker.calls.some(
          (c) =>
            c.args[0] === 'restart' ||
            c.args.at(-1) === 'drain' ||
            c.args.includes('up') ||
            c.args[0] === 'pull',
        ),
      ).toBe(false);
    });
    test.each(['before', 'after'] as const)(
      'retains pending across restart failure %s acceptance; recovery restarts only when needed',
      async (failure) => {
        const run = await create();
        run.configuration.restartFailure = failure;
        await expect(run.activate()).rejects.toThrow('Docker could not');
        const pending = JSON.parse(readFileSync(run.receipt, 'utf8'));
        expect(pending.phase).toBe('pending');
        expect(pending.after).toBeUndefined();
        expect(run.configuration.restarted).toBe(failure === 'before' ? 0 : 1);
        run.configuration.restartFailure = undefined;
        expect(await run.activate()).toMatchObject({
          phase: 'ready',
          before: pending.before,
        });
        expect(run.configuration.restarted).toBe(1);
      },
    );
    test('unhealthy restart retains pending and a healthy retry reconciles the same boot', async () => {
      const run = await create();
      run.configuration.onRestart = () => {
        run.configuration.healthFailure = true;
      };
      await expect(run.activate()).rejects.toThrow('did not become healthy');
      expect(JSON.parse(readFileSync(run.receipt, 'utf8')).phase).toBe(
        'pending',
      );
      run.configuration.healthFailure = false;
      expect(await run.activate()).toMatchObject({ phase: 'ready' });
      expect(run.configuration.restarted).toBe(1);
    });
    test('active sessions time out without cancelling sessions or restarting; later empty drain resumes', async () => {
      const run = await create();
      run.configuration.sessions = ['session-preserved'];
      await expect(run.activate()).rejects.toThrow('active sessions');
      expect(JSON.parse(readFileSync(run.receipt, 'utf8')).phase).toBe(
        'pending',
      );
      expect(run.configuration.restarted).toBe(0);
      expect(run.configuration.sessions).toEqual(['session-preserved']);
      run.configuration.sessions = [];
      expect(await run.activate()).toMatchObject({ phase: 'ready' });
      expect(run.configuration.restarted).toBe(1);
    });
    test.each([
      'health',
      'image',
      'mount',
      'origin',
      'boot',
      'config',
    ] as const)(
      'refuses %s drift before any drain/restart or receipt',
      async (kind) => {
        const run = await create();
        const sandbox = run.configuration.sandbox();
        if (kind === 'health')
          (sandbox.State as { Health: { Status: string } }).Health.Status =
            'unhealthy';
        if (kind === 'image')
          (sandbox.Config as { Image: string }).Image =
            'foreign@sha256:' + 'f'.repeat(64);
        if (kind === 'mount')
          (sandbox.Mounts as { Source: string }[])[0].Source = '/foreign';
        if (kind === 'origin')
          run.effect.target.origin = 'https://foreign.invalid';
        if (kind === 'boot')
          (sandbox.State as { StartedAt: string }).StartedAt =
            '2026-09-10T00:00:00Z\n';
        if (kind === 'config')
          run.configuration.text =
            '{"version":1,"sandboxRuntime":{"tier":"kata"}}';
        await expect(run.activate()).rejects.toThrow();
        expect(existsSync(run.receipt)).toBe(false);
        expect(
          run.docker.calls.some(
            (c) => c.args[0] === 'restart' || c.args.at(-1) === 'drain',
          ),
        ).toBe(false);
      },
    );
    test.each(['organization', 'bundle', 'mode', 'bytes'] as const)(
      'pending %s drift holds before another mutation',
      async (kind) => {
        const run = await create();
        run.configuration.restartFailure = 'before';
        await expect(run.activate()).rejects.toThrow();
        run.configuration.restartFailure = undefined;
        if (kind === 'organization')
          run.effect.target.organizationId = 'foreign';
        if (kind === 'bundle')
          run.effect.deploymentBundleSha256 = 'c'.repeat(64);
        if (kind === 'mode') chmodSync(run.receipt, 0o644);
        if (kind === 'bytes') run.configuration.text += '\n';
        run.docker.calls = [];
        await expect(run.activate()).rejects.toThrow();
        expect(run.configuration.restarted).toBe(0);
        expect(
          run.docker.calls.some(
            (c) => c.args[0] === 'restart' || c.args.at(-1) === 'drain',
          ),
        ).toBe(false);
      },
    );
    test.each([
      'unchanged-boot',
      'malformed-status',
      'post-bytes',
      'post-drain',
    ] as const)(
      'refuses %s activation evidence and retains pending',
      async (kind) => {
        const run = await create();
        if (kind === 'unchanged-boot')
          run.configuration.restartChangesBoot = false;
        if (kind === 'malformed-status')
          run.configuration.statusOverride = { draining: true, inFlight: 0 };
        if (kind === 'post-bytes')
          run.configuration.onRestart = () => {
            run.configuration.text += '\n';
          };
        if (kind === 'post-drain')
          run.configuration.onRestart = () => {
            run.configuration.draining = true;
          };
        await expect(run.activate()).rejects.toThrow();
        expect(JSON.parse(readFileSync(run.receipt, 'utf8')).phase).toBe(
          'pending',
        );
      },
    );
    test('default absent config and legacy JSON follow the native boot lookup, without creating config files', async () => {
      for (const file of [null, 'deployment.json'] as const) {
        const run = await create();
        run.configuration.file = file;
        if (file === null) {
          run.effect.config = { version: 1 };
          run.effect.resourceSha256 = valueHash(run.effect.config);
        }
        expect(await run.activate()).toMatchObject({
          phase: 'ready',
          mounted: { file },
        });
        expect(
          run.docker.calls.every(
            (c) => !c.args.includes('cp') && !c.args.includes('rm'),
          ),
        ).toBe(true);
      }
    });
    test('the actual fixed reader executes bounded same-file lookup and refuses links, oversized input and alternate mounts', async () => {
      const run = await create();
      await run.activate();
      const invocation = run.docker.calls.find(({ args }) =>
        args.includes('-e'),
      );
      if (!invocation) throw Error('Missing actual reader invocation');
      const script = invocation.args.at(-1)!;
      const root = join(run.fixture.directory, 'reader-mount');
      mkdirSync(root);
      // Only the fixed root literal is redirected into this owned fixture.
      // Execute the exact production reader bytes with the release Bun.
      const read = async (extra: Record<string, string> = {}) => {
        const child = Bun.spawn(
          [
            process.execPath,
            '-e',
            script.replace(
              "const root = '/app/platform-config';",
              `const root = ${JSON.stringify(root)};`,
            ),
          ],
          {
            env: { PATH: process.env.PATH ?? '', ...extra },
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        return { stdout, stderr, code };
      };
      expect(await read()).toMatchObject({
        code: 0,
        stdout: '{"file":null,"data":null}',
      });
      const yaml = join(root, 'deployment.yml');
      const legacy = join(root, 'deployment.json');
      writeFileSync(legacy, '{"version":1}');
      expect(JSON.parse((await read()).stdout)).toEqual({
        file: 'deployment.json',
        data: Buffer.from('{"version":1}').toString('base64'),
      });
      writeFileSync(yaml, 'version: 1\n');
      expect(JSON.parse((await read()).stdout).file).toBe('deployment.yml');
      expect(
        (await read({ TALE_PLATFORM_SHARED_CONFIG_DIR: '/foreign' })).code,
      ).not.toBe(0);
      const original = readFileSync(yaml);
      rmSync(yaml);
      symlinkSync(legacy, yaml);
      expect((await read()).code).not.toBe(0);
      rmSync(yaml);
      linkSync(legacy, yaml);
      expect((await read()).code).not.toBe(0);
      rmSync(yaml);
      writeFileSync(yaml, Buffer.alloc(65537));
      expect((await read()).code).not.toBe(0);
      rmSync(yaml);
      mkdirSync(yaml);
      expect((await read()).code).not.toBe(0);
      rmSync(yaml, { recursive: true });
      writeFileSync(yaml, original);
      expect((await read()).code).toBe(0);
      expect(readFileSync(yaml)).toEqual(original);
      expect(readFileSync(legacy, 'utf8')).toBe('{"version":1}');
    });
    test('malformed private activation metadata refuses before native mutations', async () => {
      const run = await create();
      writeFileSync(run.receipt, '{}', { mode: 0o600 });
      await expect(run.activate()).rejects.toThrow();
      expect(run.docker.calls).toEqual([]);
    });
  },
);
