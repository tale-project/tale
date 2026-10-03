import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(
  new URL('../../../tests/fixtures/dev-command.ts', import.meta.url),
);
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function run(scenario: string, args: string[]) {
  const cwd = await mkdtemp(join(tmpdir(), 'tale-dev-command-'));
  directories.push(cwd);
  const contents =
    'SITE_URL=https://production.example:9443\nTLS_MODE=letsencrypt\n';
  await writeFile(join(cwd, '.env'), contents);
  const child = Bun.spawn([process.execPath, fixture, 'dev', ...args], {
    cwd,
    env: { ...process.env, TALE_DEV_TEST_SCENARIO: scenario },
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(await readFile(join(cwd, '.env'), 'utf8')).toBe(contents);
  return { stdout, stderr, exitCode, cwd };
}

describe('local dev lifecycle', () => {
  test('detached launch requires Compose readiness and prints a usable stop command', async () => {
    const result = await run('ready', [
      '--detach',
      '--port',
      '8443',
      '--host',
      'tale.localhost',
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('https://tale.localhost:8443');
    expect(result.stdout).toContain('tale dev --stop');
    expect(result.stdout).toContain('"--wait"');
    expect(result.stdout).toContain('"--wait-timeout","600"');
    expect(result.stdout.indexOf('composePreflight')).toBeLessThan(
      result.stdout.indexOf('runtimeImage'),
    );
  });

  test('unhealthy services fail without announcing a running instance', async () => {
    const result = await run('readiness-failed', ['--detach']);
    expect(result.exitCode).toBe(5);
    expect(result.stdout + result.stderr).not.toContain('Tale is running');
    expect(result.stdout + result.stderr).toContain('tale logs');
    expect(result.stdout + result.stderr).toContain('tale dev --stop');
  });

  test('stop targets only exact project containers and never runs setup', async () => {
    const result = await run('stop', ['--stop']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      'label=com.docker.compose.project=onboarding-test-dev',
    );
    expect(result.stdout).toContain(
      'label=com.docker.compose.container-number',
    );
    expect(result.stdout).toContain('label=com.docker.compose.oneoff=False');
    expect(result.stdout).toContain('"stop","abcdef012345","123456abcdef"');
    expect(result.stdout).not.toContain('ensureEnv');
    expect(result.stdout).not.toContain('ensureDocker');
    expect(result.stdout).not.toContain('runtimeImage');
    expect(await readdir(result.cwd)).toEqual(['.env']);
  });

  test('stopping an already stopped stack succeeds', async () => {
    const result = await run('stop-empty', ['--stop']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('already stopped');
    expect(result.stdout).not.toContain('"stop",');
  });

  test.each(['stop-list-failed', 'stop-failed', 'stop-invalid-id'])(
    '%s is not reported as a successful stop',
    async (scenario) => {
      const result = await run(scenario, ['--stop']);
      expect(result.exitCode).toBe(5);
      expect(result.stdout + result.stderr).not.toContain('Tale stopped');
    },
  );

  test('stop outside a project refuses without scaffolding', async () => {
    const result = await run('stop-missing', ['--stop']);
    expect(result.exitCode).toBe(3);
    expect(result.stdout).not.toContain('ensureEnv');
  });

  test.each([
    { args: ['--detach'] },
    { args: ['--port', '8443'] },
    { args: ['--host', 'tale.localhost'] },
  ])('stop refuses launch flags %j', async ({ args }) => {
    const result = await run('stop', ['--stop', ...args]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain('CALL:');
  });

  test('foreground readiness includes the API behind the healthy web tier', async () => {
    const result = await run('foreground-not-ready', []);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('onboarding-test-backend-api');
    expect(result.stdout).not.toContain('Tale is running');
  });

  test('foreground announces the same origin after services are healthy', async () => {
    const result = await run('foreground-ready', ['--port', '8443']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      'Tale is running — open https://localhost:8443',
    );
  });

  test('foreground accepts running services with health probes disabled by an override', async () => {
    const result = await run('foreground-probe-disabled', []);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Tale is running');
  });

  test('invalid host fails before any setup', async () => {
    const result = await run('ready', ['--host', 'https://localhost/path']);
    expect(result.exitCode).toBe(2);
    expect(result.stdout + result.stderr).toContain('Invalid --host');
    expect(result.stdout).not.toContain('CALL:');
  });
});
