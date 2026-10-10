import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeDeploymentBundle } from '../src/lib/deployment/bundle';
import { deploymentSpecSchema } from '../src/lib/deployment/model';
import { commandTargets } from './fixtures/command-targets';

const modes = commandTargets(process.env.TALE_BINARY);
const describePosix = describe.skipIf(process.platform === 'win32');

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tale-deployment-command-'));
  roots.push(root);
  const bundle = join(root, 'bundle');
  await mkdir(join(bundle, 'cli'), { recursive: true });
  await mkdir(join(bundle, 'runtime'));
  await writeFile(
    join(root, 'tale.json'),
    JSON.stringify({ cliVersion: '0.0.1', id: 'unrelated-workspace' }),
  );
  await writeFile(join(bundle, 'cli/tale'), 'synthetic executable', {
    mode: 0o755,
  });
  await writeFile(join(bundle, 'runtime/runtime.json'), '{}');
  await writeFile(join(bundle, 'runtime/compose.yml'), 'services: {}');
  const metadata = await writeDeploymentBundle(bundle, {
    schemaVersion: 1,
    kind: 'tale-deployment',
    cli: { revision: 'a'.repeat(40), path: 'cli/tale' },
    deploymentRef: 'c'.repeat(40),
    spec: deploymentSpecSchema.parse({
      schemaVersion: 1,
      name: 'example',
      stateDirectory: join(root, 'state'),
      composeProject: 'example',
      origin: 'https://example.invalid',
      tlsMode: 'external',
      runtime: { revision: 'b'.repeat(40) },
    }),
  });
  return { root, bundle, metadata };
}

async function run(
  executable: string[],
  cwd: string,
  args: string[],
  stdin?: string,
) {
  const child = Bun.spawn([...executable, ...args], {
    cwd,
    stdin: stdin === undefined ? 'ignore' : new Blob([stdin]),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { PATH: process.env.PATH, HOME: cwd, CI: 'true', NO_COLOR: '1' },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

for (const [mode, executable] of modes) {
  test(`help retains generic deployment commands and omits server lifecycle (${mode})`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'tale-deployment-help-'));
    roots.push(root);
    for (const args of [['--help'], ['deploy', '--help']]) {
      const result = await run(executable, root, args);
      expect(result.code).toBe(0);
      expect(result.stdout).not.toMatch(/inference|omlx|zerotier/i);
      if (args[0] === 'deploy') {
        expect(result.stdout).toContain('export-client');
        expect(result.stdout).toContain('provision');
        expect(result.stdout).toContain('verify-bundle');
        expect(result.stdout).toContain('accept');
      }
    }
  }, 30000);
  test.skipIf(process.platform !== 'win32')(
    `managed deployment refuses Windows before filesystem or native work (${mode})`,
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'tale-managed-windows-'));
      roots.push(root);
      for (const args of [
        ['--bundle', join(root, 'bundle'), '--yes'],
        [
          'prepare',
          '--spec',
          join(root, 'spec.json'),
          '--output',
          join(root, 'output'),
        ],
        ['verify-bundle', '--bundle', join(root, 'bundle')],
        [
          'accept',
          '--bundle',
          join(root, 'bundle'),
          '--expected-version',
          '1.2.3',
        ],
        ['provision', '--bundle', join(root, 'bundle'), '--yes'],
      ]) {
        const result = await run(executable, root, [
          'deploy',
          ...args,
          '--json',
        ]);
        expect(result.code).toBe(3);
        expect(result.stderr).toBe('');
        expect(JSON.parse(result.stdout).ok).toBe(false);
        expect(result.stdout).toContain('not supported on Windows');
        expect(await readdir(root)).toEqual([]);
      }
    },
    30_000,
  );
  // NTFS cannot prove the executable-mode contract of a Linux bundle.
  describePosix(`managed deployment commands (${mode})`, () => {
    test('accept requires exact source pins and refuses inherited deployment effects', async () => {
      const { root, bundle } = await fixture();
      for (const args of [
        ['--expected-version', '1.2.3'],
        [
          '--expected-version',
          '1.2.3',
          '--cli-ref',
          'a'.repeat(40),
          '--deployment-ref',
          'c'.repeat(40),
          '--configuration-only',
        ],
        [
          '--expected-version',
          '1.2.3',
          '--cli-ref',
          'a'.repeat(40),
          '--deployment-ref',
          'c'.repeat(40),
          '--dry-run',
        ],
      ]) {
        const result = await run(executable, root, [
          '--json',
          'deploy',
          'accept',
          '--bundle',
          bundle,
          ...args,
        ]);
        expect(result.code).not.toBe(0);
        expect(result.stderr).toBe('');
        const refusal = JSON.parse(result.stdout);
        expect(refusal.ok).toBe(false);
        expect(result.stdout).toMatch(/requires|not supported/);
      }
    }, 30_000);
    test('configuration-only refuses missing custody and partial retained identity flags', async () => {
      const { root, bundle } = await fixture();
      const input = JSON.stringify({
        origin: 'https://example.invalid',
        email: 'operator@example.invalid',
        password: 'synthetic-password',
        slug: 'example',
        name: 'Example',
        ssoEnabled: false,
        nativeClients: [],
      });
      const missingBundle = await run(executable, root, [
        'deploy',
        '--configuration-only',
        '--yes',
        '--json',
      ]);
      expect(missingBundle.code).toBe(2);
      expect(missingBundle.stdout).toContain('require --bundle');
      for (const args of [
        ['--configuration-only'],
        ['--configuration-only', '--bundle', bundle],
        [
          '--configuration-only',
          '--bundle',
          bundle,
          '--expected-user',
          'operator',
        ],
        [
          '--configuration-only',
          '--bundle',
          bundle,
          '--expected-organization',
          'organization',
        ],
      ]) {
        const result = await run(
          executable,
          root,
          ['deploy', 'provision', ...args, '--yes', '--json'],
          input,
        );
        expect(result.code).toBe(2);
        expect(result.stdout).toContain('both retained identity IDs');
      }
      const unscoped = await run(
        executable,
        root,
        [
          'deploy',
          'provision',
          '--bundle',
          bundle,
          '--expected-user',
          'operator',
          '--yes',
          '--json',
        ],
        input,
      );
      expect(unscoped.code).toBe(2);
      expect(unscoped.stdout).toContain('require --configuration-only');
      expect(await readdir(root)).not.toContain('state');
      expect(await readdir(root)).not.toContain('.tale');
    }, 30_000);

    test('child commands refuse unsupported inherited flags instead of silently ignoring them', async () => {
      const { root, bundle } = await fixture();
      for (const child of [
        ['verify-bundle', '--bundle', bundle],
        [
          'prepare',
          '--spec',
          join(root, 'spec.json'),
          '--output',
          join(root, 'output'),
        ],
      ]) {
        for (const flag of [
          '--dry-run',
          '--override-all',
          '--skip-backup',
          '--configuration-only',
        ]) {
          const result = await run(executable, root, [
            'deploy',
            ...child,
            '--json',
            '--yes',
            flag,
          ]);
          expect(result.code).toBe(2);
          expect(result.stdout).toContain(`${flag} is not supported`);
        }
      }
    }, 30_000);

    test('verify-bundle honors bundle and expected source pins on either side of the child command', async () => {
      const { root, bundle } = await fixture();
      for (const args of [
        [
          '--json',
          'deploy',
          'verify-bundle',
          '--bundle',
          bundle,
          '--cli-ref',
          'a'.repeat(40),
          '--deployment-ref',
          'c'.repeat(40),
        ],
        [
          'deploy',
          '--bundle',
          bundle,
          '--cli-ref',
          'a'.repeat(40),
          '--deployment-ref',
          'c'.repeat(40),
          'verify-bundle',
          '--json',
        ],
      ]) {
        const result = await run(executable, root, args);
        expect(result.code).toBe(0);
        expect(result.stderr).toBe('');
        expect(result.stdout.trim().split('\n')).toHaveLength(1);
        expect(JSON.parse(result.stdout)).toMatchObject({
          ok: true,
          command: 'deploy verify-bundle',
          data: { cli: { revision: 'a'.repeat(40) } },
        });
      }
      for (const flag of ['--cli-ref', '--deployment-ref']) {
        const result = await run(executable, root, [
          'deploy',
          'verify-bundle',
          '--bundle',
          bundle,
          flag,
          'd'.repeat(40),
          '--json',
        ]);
        expect(result.code).toBe(3);
        expect(JSON.parse(result.stdout).ok).toBe(false);
        expect(result.stdout).toContain('source pins');
      }
      await writeFile(join(bundle, 'runtime/compose.yml'), 'tampered bytes');
      const corrupt = await run(executable, root, [
        'deploy',
        'verify-bundle',
        '--bundle',
        bundle,
        '--json',
      ]);
      expect(corrupt.code).toBe(3);
      expect(corrupt.stdout).toContain('bytes');
    }, 30_000);

    test('bundle deployment retains all consent flag positions and refuses workspace flags', async () => {
      const { root, bundle } = await fixture();
      const unconfirmed = await run(executable, root, [
        'deploy',
        '--bundle',
        bundle,
        '--json',
      ]);
      expect(unconfirmed.code).toBe(4);
      for (const args of [
        ['--yes', 'deploy', '--bundle', bundle, '--json'],
        ['deploy', '--yes', '--bundle', bundle, '--json'],
        ['deploy', '--bundle', bundle, '--json', '--yes'],
        ['deploy', '--bundle', bundle, '--json', '--dry-run'],
      ]) {
        const result = await run(executable, root, args);
        // The deliberately invalid runtime is reached only after consent. No
        // Docker call or destination write can pass this boundary.
        expect(result.code).toBe(3);
        expect(result.stdout).toContain('runtime bundle');
      }
      for (const flag of [
        '--stop',
        '--override',
        '--override-all',
        '--skip-backup',
        '--accept-data-loss',
      ]) {
        const result = await run(executable, root, [
          'deploy',
          '--bundle',
          bundle,
          '--json',
          '--yes',
          flag,
        ]);
        expect(result.code).toBe(2);
        expect(result.stdout).toContain('workspace deployment flags');
      }
      expect(
        (await run(executable, root, ['deploy', 'verify-bundle', '--json']))
          .code,
      ).toBe(2);
      expect(
        (
          await run(executable, root, [
            'deploy',
            '--cli-ref',
            'a'.repeat(40),
            '--json',
          ])
        ).code,
      ).toBe(2);
    }, 30_000);
  });
}
