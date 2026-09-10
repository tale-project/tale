import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DeployOptions } from '../src/lib/config/releases/deploy';
import { loadClient } from '../src/lib/config/releases/identity';
import { loadRelease } from '../src/lib/config/releases/manifest';
import { stageRelease, verifyStage } from '../src/lib/config/releases/stage';
import {
  commandFixture,
  commandRelease,
} from '../src/lib/config/releases/tests/command-fixture';
import { temporary } from '../src/lib/config/releases/tests/fixture';
import { nativeServer } from '../src/lib/config/releases/tests/native-fixture';

const source = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const binary = process.env.TALE_BINARY
  ? path.resolve(process.env.TALE_BINARY)
  : undefined;
const modes = [
  ['source', [process.execPath, source]],
  ...(binary ? [['compiled', [binary]]] : []),
] as [string, string[]][];

function start(
  command: string[],
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
) {
  const child = Bun.spawn([...command, ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, TALE_CONFIG_COOKIE: '', TALE_ALIGNED: '', ...env },
  });
  const result = Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]).then(([stdout, stderr, code]) => ({ stdout, stderr, code }));
  return { child, result };
}
async function run(
  command: string[],
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
) {
  return start(command, args, cwd, env).result;
}
function success(result: Awaited<ReturnType<typeof run>>, command: string) {
  expect(result.code, result.stderr + result.stdout).toBe(0);
  expect(result.stderr).toBe('');
  const lines = result.stdout.trim().split('\n');
  expect(lines).toHaveLength(1);
  const output = JSON.parse(lines[0]);
  expect(output.ok).toBe(true);
  expect(output.command).toBe(command);
  return output.data;
}

for (const [label, executable] of modes)
  describe(`${label} config CLI outside the checkout`, () => {
    test('SHA-default build and source stage deploy exact artifacts without a generated catalogue commit', async () => {
      const f = commandFixture();
      const cwd = temporary();
      const output = path.join(temporary(), 'built');
      const base = [
        '--repo',
        f.root,
        '--descriptor',
        path.relative(f.root, f.descriptorPath),
        '--automation',
        f.name,
      ];
      const built = success(
        await run(
          executable,
          [
            'config',
            'build',
            ...base,
            '--source-commit',
            f.options.sourceCommit,
            '--skill-owner',
            f.options.skillOwnerUserId!,
            '--output',
            output,
            '--json',
          ],
          cwd,
        ),
        'config build',
      );
      expect(built.releaseRef).toBe(f.options.sourceCommit);
      expect(built.sourceCommit).toBe(f.options.sourceCommit);
      expect(built.configVersion).toBeUndefined();
      const verifiedBuild = success(
        await run(
          executable,
          [
            'config',
            'verify',
            ...base,
            '--manifest',
            path.join(output, `${f.options.sourceCommit}.json`),
            '--rebuild',
            '--json',
          ],
          cwd,
        ),
        'config verify',
      );
      expect(verifiedBuild.artifactSha256).toBe(built.artifactSha256);
      const stage = path.join(temporary(), 'stage');
      writeFileSync(
        path.join(f.pack, 'workflow.yml'),
        'dirty source is never admitted',
      );
      const dirty = f.git('status', '--porcelain=v1', '--untracked-files=all');
      const stageArgs = [
        'config',
        'stage',
        ...base,
        '--config-ref',
        f.options.sourceCommit,
        '--skill-owner',
        f.options.skillOwnerUserId!,
        '--deployment-ref',
        'b'.repeat(40),
        '--output',
        stage,
        '--json',
      ];
      const staged = success(
        await run(executable, stageArgs, cwd),
        'config stage',
      );
      expect(staged.schemaVersion).toBe(2);
      expect(staged.releaseRef).toBe(f.options.sourceCommit);
      expect(staged.artifactSha256).toBe(built.artifactSha256);
      expect(
        success(await run(executable, stageArgs, cwd), 'config stage'),
      ).toEqual(staged);
      expect(existsSync(path.join(f.root, '.tale'))).toBe(false);
      expect(existsSync(path.join(f.directory, 'releases'))).toBe(false);
      expect(f.git('status', '--porcelain=v1', '--untracked-files=all')).toBe(
        dirty,
      );
      const paths = verifyStage(stage);
      const release = loadRelease(
        paths.manifestPath,
        loadClient(paths.descriptorPath, f.name),
      );
      const options: DeployOptions = {
        descriptorPath: paths.descriptorPath,
        manifestPath: paths.manifestPath,
        automationName: f.name,
        url: 'http://127.0.0.1',
        origin: 'https://native.example',
        orgId: 'org-acme',
        projectId: 'bootstrap',
        cookie: 'session=synthetic-sha-proof',
        receiptPath: path.join(temporary(), 'receipt.json'),
      };
      const state = await nativeServer(release, options);
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
          const bytes =
            request.method === 'GET'
              ? undefined
              : Buffer.from(await request.arrayBuffer());
          return options.fetchImpl!(new URL(request.url), {
            method: request.method,
            redirect: 'error',
            headers: Object.fromEntries(request.headers),
            ...(bytes
              ? {
                  body:
                    request.headers.get('content-type') === 'application/json'
                      ? bytes.toString()
                      : bytes,
                }
              : {}),
          });
        },
      });
      const nativeArgs = [
        '--stage',
        stage,
        '--project',
        options.projectId,
        '--org',
        options.orgId,
        '--url',
        `http://127.0.0.1:${server.port}`,
        '--origin',
        options.origin!,
        '--config-ref',
        f.options.sourceCommit,
        '--artifact-sha256',
        built.artifactSha256,
        '--source-repository',
        f.descriptor.sourceRepository,
        '--deployment-ref',
        'b'.repeat(40),
        '--json',
      ];
      const env = { TALE_CONFIG_COOKIE: options.cookie };
      try {
        const refused = await run(
          executable,
          [
            'config',
            'deploy',
            ...nativeArgs,
            '--artifact-sha256',
            '0'.repeat(64),
            '--receipt',
            options.receiptPath!,
            '--yes',
          ],
          cwd,
          env,
        );
        expect(refused.code).toBe(3);
        expect(state.requests).toHaveLength(0);
        for (const unchanged of [false, true]) {
          const deployed = success(
            await run(
              executable,
              [
                'config',
                'deploy',
                ...nativeArgs,
                '--receipt',
                options.receiptPath!,
                '--yes',
              ],
              cwd,
              env,
            ),
            'config deploy',
          );
          expect(deployed.releaseRef).toBe(f.options.sourceCommit);
          expect(deployed.sourceCommit).toBe(f.options.sourceCommit);
          expect(deployed.configVersion).toBeUndefined();
          expect(deployed.artifactSha256).toBe(built.artifactSha256);
          expect(deployed.automationVersion).toBe(7);
          expect(deployed.unchanged).toBe(unchanged);
        }
        expect(state.imports).toBe(1);
        expect(state.deploys).toBe(1);
        const before = state.requests.length;
        const verified = success(
          await run(
            executable,
            ['config', 'verify-native', ...nativeArgs],
            cwd,
            env,
          ),
          'config verify-native',
        );
        expect(verified.verified).toBe(true);
        expect(verified.releaseRef).toBe(f.options.sourceCommit);
        expect(
          state.requests
            .slice(before)
            .every((request) => request.method === 'GET'),
        ).toBe(true);
        const saved = JSON.parse(readFileSync(options.receiptPath!, 'utf8'));
        expect(saved.schemaVersion).toBe(2);
        expect(saved.releaseRef).toBe(f.options.sourceCommit);
        expect(saved.deployment).toEqual({ deploymentRef: 'b'.repeat(40) });
      } finally {
        server.stop(true);
      }
    }, 60_000);

    test('build, exact verification and stage use native embedded admission without project alignment', async () => {
      for (const owned of [true, false]) {
        const f = commandFixture(owned ? 'acme' : 'north-labs', owned);
        const cwd = temporary();
        writeFileSync(
          path.join(cwd, 'tale.json'),
          JSON.stringify({ cliVersion: '0.0.1' }),
        );
        const original = readFileSync(path.join(cwd, 'tale.json'));
        const base = [
          '--repo',
          f.root,
          '--descriptor',
          path.relative(f.root, f.descriptorPath),
          '--automation',
          f.name,
        ];
        const build = success(
          await run(
            executable,
            [
              'config',
              'build',
              ...base,
              '--source-commit',
              f.options.sourceCommit,
              '--config-version',
              f.options.version,
              ...(owned ? ['--skill-owner', f.options.skillOwnerUserId!] : []),
              '--json',
            ],
            cwd,
          ),
          'config build',
        );
        expect(build.verified).toBe(true);
        const manifest = path.relative(
          f.root,
          path.join(f.directory, 'releases', `${f.options.version}.json`),
        );
        const verified = success(
          await run(
            executable,
            [
              '--json',
              'config',
              'verify',
              ...base,
              '--manifest',
              manifest,
              '--rebuild',
            ],
            cwd,
          ),
          'config verify',
        );
        expect(verified.artifactSha256).toBe(build.artifactSha256);
        const catalogue = f.commit();
        const destination = path.join(temporary(), 'client');
        const stage = success(
          await run(
            executable,
            [
              'config',
              'stage',
              ...base,
              '--config-version',
              f.options.version,
              '--catalogue-commit',
              catalogue,
              '--catalogue-repository',
              f.descriptor.sourceRepository,
              '--client',
              f.descriptor.clientId,
              '--ops-commit',
              'a'.repeat(40),
              '--output',
              destination,
              '--json',
            ],
            cwd,
          ),
          'config stage',
        );
        expect(stage.catalogueCommit).toBe(catalogue);
        expect(stage.descriptorPath).toBe('client.json');
        expect(readFileSync(path.join(cwd, 'tale.json'))).toEqual(original);
        const show = success(
          await run(executable, ['--json', 'config', 'show'], temporary()),
          'config',
        );
        expect(show.projectDir).toBeNull();
      }
    }, 60_000);

    test('actual HTTP deploy/replay and read-only verification preserve custody and scrub errors', async () => {
      const f = await commandRelease();
      await stageRelease(f.stageOptions);
      const options: DeployOptions = {
        descriptorPath: f.descriptorPath,
        manifestPath: f.manifestPath,
        automationName: f.name,
        url: 'http://127.0.0.1',
        origin: 'https://native.example',
        orgId: 'org-acme',
        projectId: 'bootstrap',
        cookie: 'session=private-synthetic-command',
        receiptPath: path.join(temporary(), 'receipt.json'),
      };
      const state = await nativeServer(f.release, options);
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
          const type = request.headers.get('content-type');
          const bytes =
            request.method === 'GET'
              ? undefined
              : Buffer.from(await request.arrayBuffer());
          return options.fetchImpl!(new URL(request.url), {
            method: request.method,
            redirect: 'error',
            headers: Object.fromEntries(request.headers),
            ...(bytes
              ? { body: type === 'application/json' ? bytes.toString() : bytes }
              : {}),
          });
        },
      });
      const args = [
        '--stage',
        f.stageOptions.output,
        '--project',
        options.projectId,
        '--url',
        `http://127.0.0.1:${server.port}`,
        '--origin',
        options.origin!,
        '--org',
        options.orgId,
        '--receipt',
        options.receiptPath!,
        '--client',
        'acme',
        '--automation',
        f.name,
        '--config-version',
        f.options.version,
        '--catalogue-commit',
        f.catalogueCommit,
        '--catalogue-repository',
        f.descriptor.sourceRepository,
        '--ops-commit',
        'a'.repeat(40),
        '--json',
      ];
      const verifyArgs = args.filter(
        (value, index) =>
          value !== '--receipt' && args[index - 1] !== '--receipt',
      );
      const env = { TALE_CONFIG_COOKIE: options.cookie };
      const cwd = temporary();
      try {
        const mismatch = await run(
          executable,
          ['config', 'deploy', ...args, '--client', 'foreign', '--yes'],
          cwd,
          env,
        );
        expect(mismatch.code).toBe(3);
        expect(state.requests).toHaveLength(0);
        const noCookie = await run(
          executable,
          ['config', 'deploy', ...args, '--yes'],
          cwd,
        );
        expect(noCookie.code).toBe(3);
        expect(state.requests).toHaveLength(0);
        const noConsent = await run(
          executable,
          ['config', 'deploy', ...args],
          cwd,
          env,
        );
        expect(noConsent.code).toBe(4);
        expect(state.requests).toHaveLength(0);
        const first = success(
          await run(
            executable,
            ['config', 'deploy', ...args, '--yes'],
            cwd,
            env,
          ),
          'config deploy',
        );
        expect(first.automationVersion).toBe(7);
        expect(first.unchanged).toBe(false);
        const bytes = readFileSync(options.receiptPath!);
        const second = success(
          await run(
            executable,
            ['config', 'deploy', ...args, '--yes'],
            cwd,
            env,
          ),
          'config deploy',
        );
        expect(second.unchanged).toBe(true);
        expect(state.imports).toBe(1);
        expect(state.deploys).toBe(1);
        const beforeRead = state.requests.length;
        const verified = success(
          await run(
            executable,
            ['config', 'verify-native', ...verifyArgs],
            cwd,
            env,
          ),
          'config verify-native',
        );
        expect(verified.verified).toBe(true);
        expect(
          state.requests
            .slice(beforeRead)
            .every((request) => request.method === 'GET'),
        ).toBe(true);
        expect(readFileSync(options.receiptPath!)).toEqual(bytes);
        state.faults.add('httpFailure');
        const failed = await run(
          executable,
          ['config', 'verify-native', ...verifyArgs, '--verbose'],
          cwd,
          env,
        );
        expect(failed.code).toBe(5);
        expect(JSON.parse(failed.stdout).error.summary).toContain('HTTP 503');
        expect(failed.stdout + failed.stderr + bytes.toString()).not.toContain(
          options.cookie,
        );
        expect(failed.stdout + failed.stderr).not.toContain(
          'secret error body',
        );
      } finally {
        server.stop(true);
      }
    }, 60_000);

    test('a killed deployment releases the kernel lock without admitting a concurrent native writer', async () => {
      const f = await commandRelease();
      await stageRelease(f.stageOptions);
      const options: DeployOptions = {
        descriptorPath: f.descriptorPath,
        manifestPath: f.manifestPath,
        automationName: f.name,
        url: 'http://127.0.0.1',
        origin: 'https://native.example',
        orgId: 'org-acme',
        projectId: 'bootstrap',
        cookie: 'session=synthetic-lock-proof',
        receiptPath: path.join(temporary(), 'receipt.json'),
      };
      const state = await nativeServer(f.release, options);
      const blocked = Promise.withResolvers<void>();
      const reachedNative = Promise.withResolvers<void>();
      let requests = 0;
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
          requests += 1;
          if (requests === 1) {
            reachedNative.resolve();
            // Pause before any mutation so SIGKILL tests only lock recovery.
            await blocked.promise;
            return new Response(null, { status: 503 });
          }
          const bytes =
            request.method === 'GET'
              ? undefined
              : Buffer.from(await request.arrayBuffer());
          return options.fetchImpl!(new URL(request.url), {
            method: request.method,
            redirect: 'error',
            headers: Object.fromEntries(request.headers),
            ...(bytes
              ? {
                  body:
                    request.headers.get('content-type') === 'application/json'
                      ? bytes.toString()
                      : bytes,
                }
              : {}),
          });
        },
      });
      const args = [
        'config',
        'deploy',
        '--stage',
        f.stageOptions.output,
        '--project',
        options.projectId,
        '--url',
        `http://127.0.0.1:${server.port}`,
        '--origin',
        options.origin!,
        '--org',
        options.orgId,
        '--receipt',
        options.receiptPath!,
        '--json',
        '--yes',
      ];
      const cwd = temporary();
      const env = { TALE_CONFIG_COOKIE: options.cookie };
      const first = start(executable, args, cwd, env);
      const timeout = setTimeout(
        () =>
          reachedNative.reject(
            new Error('deployment did not reach native API'),
          ),
        10_000,
      );
      try {
        await reachedNative.promise;
        const concurrent = await run(executable, args, cwd, env);
        expect(concurrent.code).toBe(3);
        expect(JSON.parse(concurrent.stdout).error.summary).toContain(
          'Another operation holds the local deployment lock',
        );
        expect(requests).toBe(1);
        first.child.kill('SIGKILL');
        await first.result;
        blocked.resolve();
        const recovered = success(
          await run(executable, args, cwd, env),
          'config deploy',
        );
        expect(recovered.automationVersion).toBe(7);
        expect(recovered.unchanged).toBe(false);
        expect(state.imports).toBe(1);
        expect(state.deploys).toBe(1);
      } finally {
        clearTimeout(timeout);
        blocked.resolve();
        if (first.child.exitCode === null) first.child.kill();
        await first.result;
        server.stop(true);
      }
    }, 30_000);

    test('invalid flags and source syntax have typed, single-envelope failures', async () => {
      const f = commandFixture('code-team', false);
      const base = [
        'config',
        'build',
        '--repo',
        f.root,
        '--descriptor',
        path.relative(f.root, f.descriptorPath),
        '--automation',
        f.name,
        '--config-version',
        f.options.version,
        '--source-commit',
        'bad',
        '--json',
      ];
      const invalid = await run(executable, base, temporary());
      expect(invalid.code).toBe(2);
      expect(JSON.parse(invalid.stdout).error.code).toBe(2);
      const newline = await run(
        executable,
        base.map((value) =>
          value === 'bad' ? `${f.options.sourceCommit}\n` : value,
        ),
        temporary(),
      );
      expect(newline.code).toBe(2);
      const noGit = await run(
        executable,
        base.map((value) => (value === 'bad' ? f.options.sourceCommit : value)),
        temporary(),
        { PATH: path.join(temporary(), 'no-tools') },
      );
      expect(noGit.code).toBe(5);
      expect(JSON.parse(noGit.stdout).error.summary).toContain(
        'Git is required',
      );
      writeFileSync(
        path.join(f.pack, 'workflow.yml'),
        `version: 1\nname: ${f.name}\nnodes:\n  - id: work\n    type: transform\n    code: return (\noutput: '{{ nodes.work.output }}'\n`,
      );
      const commit = f.commit();
      const malformed = await run(
        executable,
        base.map((value) => (value === 'bad' ? commit : value)),
        temporary(),
      );
      expect(malformed.code).toBe(3);
      expect(JSON.parse(malformed.stdout).error.summary).toContain(
        'CODE_SYNTAX',
      );
      expect(malformed.stdout).not.toContain('return (');
    }, 30_000);
  });
