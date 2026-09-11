import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseRuntimeEnvironment,
  prepareRuntimeEnvironment,
  readBootstrapPassword,
} from './runtime-env';
import { prepareRuntime } from './runtime-prepare';
import {
  installLegacy,
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
  await prepareRuntime(
    {
      repoRoot: fixture.repoRoot,
      revision: fixture.revision,
      output: fixture.options.bundleDirectory,
      platform: 'linux/amd64',
    },
    docker.dependencies(),
  );
  const legacy = installLegacy(fixture, docker);
  return { fixture, legacy };
}

describe('managed runtime credential adoption', () => {
  test('fresh gateway passwords satisfy every required class even when entropy encodes without them', async () => {
    const fixture = runtimeFixture();
    fixtures.push(fixture);
    // Isolate the deterministic entropy source from Bun's process-wide module
    // mocks. The actual managed generator runs; only safe predicates leave it.
    const program = `
      import { mock } from 'bun:test';
      import * as crypto from 'node:crypto';
      mock.module('node:crypto', () => ({ ...crypto, randomBytes: size => Buffer.alloc(size) }));
      const { prepareRuntimeEnvironment, parseRuntimeEnvironment } = await import(${JSON.stringify(new URL('./runtime-env.ts', import.meta.url).href)});
      const result = prepareRuntimeEnvironment(${JSON.stringify(fixture.options)}, ${JSON.stringify(fixture.revision)}, false);
      const password = parseRuntimeEnvironment(result.secrets, 'secrets').SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD;
      console.log(JSON.stringify({
        upper: /[A-Z]/.test(password), lower: /[a-z]/.test(password),
        digit: /[0-9]/.test(password), special: /[^A-Za-z0-9]/.test(password),
        entropyPreserved: password.startsWith(Buffer.alloc(32).toString('base64url')),
        composeRoundTrip: parseRuntimeEnvironment(result.environment, 'compose').SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD === password,
      }));
    `;
    const child = Bun.spawn([process.execPath, '--eval', program], {
      cwd: fixture.directory,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(JSON.parse(stdout)).toEqual({
      upper: true,
      lower: true,
      digit: true,
      special: true,
      entropyPreserved: true,
      composeRoundTrip: true,
    });
  });

  test('preserves the exact stable secret file and every secret value', async () => {
    const { fixture, legacy } = await create();
    const result = prepareRuntimeEnvironment(
      fixture.options,
      fixture.revision,
      true,
    );
    expect(result.secrets).toBe(legacy.secrets);
    expect(result.regeneratedSecrets).toEqual([]);
    const runtime = parseRuntimeEnvironment(result.environment, 'compose');
    for (const [key, value] of Object.entries(legacy.values)) {
      if (key !== 'TALE_BOOTSTRAP_PASSWORD') expect(runtime[key]).toBe(value);
    }
    expect(runtime.TALE_BOOTSTRAP_PASSWORD).toBeUndefined();
    expect(readBootstrapPassword(fixture.options.stateDirectory)).toBe(
      legacy.values.TALE_BOOTSTRAP_PASSWORD,
    );
  });

  test('retains an existing gateway password below the new bootstrap policy on every replay', async () => {
    const { fixture, legacy } = await create();
    const retained = 'LEGACYONLY';
    const secrets = legacy.secrets.replace(
      /^SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD=.*$/m,
      `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD=${retained}`,
    );
    const environment = legacy.environment.replace(
      /^SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD=.*$/m,
      `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD=${retained}`,
    );
    writeFileSync(join(fixture.options.stateDirectory, 'secrets.env'), secrets);
    writeFileSync(
      join(fixture.options.stateDirectory, 'src/.env'),
      environment,
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = prepareRuntimeEnvironment(
        fixture.options,
        fixture.revision,
        true,
      );
      expect(result.secrets).toBe(secrets);
      expect(result.regeneratedSecrets).toEqual([]);
      expect(
        parseRuntimeEnvironment(result.environment, 'compose')
          .SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD,
      ).toBe(retained);
    }
  });

  test('allows only supported missing-key top-ups and never silently rotates core secrets', async () => {
    const { fixture, legacy } = await create();
    const secretPath = join(fixture.options.stateDirectory, 'secrets.env');
    const envPath = join(fixture.options.stateDirectory, 'src/.env');
    const removed = legacy.secrets.replace(/^SANDBOX_TOKEN=.*\n/m, '');
    writeFileSync(secretPath, removed);
    writeFileSync(
      envPath,
      legacy.environment.replace(/^SANDBOX_TOKEN=.*\n/m, ''),
    );
    const result = prepareRuntimeEnvironment(
      fixture.options,
      fixture.revision,
      true,
    );
    expect(result.regeneratedSecrets).toEqual(['SANDBOX_TOKEN']);
    expect(result.secrets.startsWith(removed)).toBe(true);
    expect(parseRuntimeEnvironment(result.secrets, 'secrets').DB_PASSWORD).toBe(
      legacy.values.DB_PASSWORD,
    );
    writeFileSync(secretPath, removed.replace(/^DB_PASSWORD=.*\n/m, ''));
    writeFileSync(
      envPath,
      readFileSync(envPath, 'utf8').replace(/^DB_PASSWORD=.*\n/m, ''),
    );
    expect(() =>
      prepareRuntimeEnvironment(fixture.options, fixture.revision, true),
    ).toThrow('non-recoverable');
  });

  test('refuses conflicting stores and missing existing environment', async () => {
    const { fixture, legacy } = await create();
    const file = join(fixture.options.stateDirectory, 'src/.env');
    writeFileSync(
      file,
      legacy.environment.replace(/^DB_PASSWORD=.*$/m, 'DB_PASSWORD=changed'),
    );
    expect(() =>
      prepareRuntimeEnvironment(fixture.options, fixture.revision, true),
    ).toThrow('stores disagree');
    rmSync(file);
    expect(() =>
      prepareRuntimeEnvironment(fixture.options, fixture.revision, true),
    ).toThrow('missing');
  });

  test('round-trips literal monitoring values without interpolation or shell execution', async () => {
    const { fixture } = await create();
    const sentinel = join(fixture.directory, 'should-not-exist');
    const literal = `https://example.invalid/a?x=$HOME&y="quote"\n$(touch ${sentinel})`;
    const result = prepareRuntimeEnvironment(
      { ...fixture.options, environment: { SENTRY_DSN: literal } },
      fixture.revision,
      true,
    );
    expect(
      parseRuntimeEnvironment(result.environment, 'compose').SENTRY_DSN,
    ).toBe(literal);
    expect(existsSync(sentinel)).toBe(false);
    expect(
      parseRuntimeEnvironment(
        "TEST='literal $HOME $(not-run)'\nQUOTE='a'\\''b'\n",
        'secrets',
      ),
    ).toEqual({ TEST: 'literal $HOME $(not-run)', QUOTE: "a'b" });
  });

  test.each([
    'A=first\nA=second\n',
    'A=$(false)\n',
    'A=`false`\n',
    'export A=value\n',
  ])('refuses unsafe or ambiguous legacy syntax: %s', (text) => {
    expect(() => parseRuntimeEnvironment(text, 'secrets')).toThrow();
  });

  test.each(['SAFE\n', 'SAFE\r', 'SAFE\0', 'SAFE\u2028'])(
    'rejects control characters in environment names',
    async (key) => {
      const { fixture } = await create();
      expect(() =>
        prepareRuntimeEnvironment(
          { ...fixture.options, environment: { [key]: 'literal' } },
          fixture.revision,
          true,
        ),
      ).toThrow('override');
    },
  );

  test.each([
    'VERSION',
    'COMPOSE_PROJECT_NAME',
    'DATABASE_URL',
    'PLATFORM_SHARED_CONFIG',
    'SANDBOX_RUNTIME_IMAGE',
    'DB_PASSWORD',
  ])('does not accept %s through runtime overrides', async (key) => {
    const { fixture } = await create();
    expect(() =>
      prepareRuntimeEnvironment(
        { ...fixture.options, environment: { [key]: 'wrong' } },
        fixture.revision,
        true,
      ),
    ).toThrow('override');
  });
});
