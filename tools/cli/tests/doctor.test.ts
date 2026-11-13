import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { commandTargets } from './fixtures/command-targets';

const [label, executable] = commandTargets(process.env.TALE_BINARY)[0]!;

const INCUS_WORKSPACE = JSON.stringify({
  version: 1,
  cliVersion: '0.5.95',
  createdAt: '2026-11-13T00:00:00.000Z',
  id: 'doctor-a3f1b2',
  runtime: {
    engine: 'incus',
    incus: {
      project: 'tale-doctor',
      pool: 'tank',
      network: {
        name: 'tale-doctor',
        subnet: '10.30.0.0/23',
        gateway: '10.30.0.1',
        block: '10.30.0.0/24',
      },
      sessions: { subnet: '10.31.0.0/24' },
      ingress: { mode: 'proxy-device' },
    },
  },
});

// A synthetic Docker executable proves the public command stays read-only,
// reports failures through one JSON envelope, and works before init.
describe.skipIf(process.platform === 'win32')(`${label} doctor command`, () => {
  let directory: string;
  let bin: string;
  let project: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'tale-doctor-'));
    bin = join(directory, 'bin');
    project = join(directory, 'project');
    await mkdir(bin);
    await mkdir(project);
    const docker = join(bin, 'docker');
    await writeFile(
      docker,
      `#!/bin/sh
if [ -n "$DOCTOR_TEST_LOG" ]; then printf '%s\n' "$*" >> "$DOCTOR_TEST_LOG"; fi
case "$*" in
  'version --format {{.Server.Version}}') printf '29.0.0' ;;
  'version --format {{json .Server}}') printf '{"Os":"linux","Arch":"amd64"}' ;;
  'compose version --short')
    if [ "$DOCTOR_TEST_MISSING_COMPOSE" = 1 ]; then exit 1; fi
    printf '2.40.0' ;;
  'compose up --help') printf '%s' '--wait   --wait-timeout int' ;;
  'context inspect --format {{.Endpoints.docker.Host}}') printf 'ssh://example.test' ;;
  *) printf 'Unexpected mutating or unsupported command' >&2; exit 66 ;;
esac
`,
    );
    await chmod(docker, 0o755);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function run(args: string[], extraEnv: Record<string, string> = {}) {
    const proc = Bun.spawn([...executable, ...args], {
      cwd: project,
      env: {
        ...process.env,
        PATH: bin,
        DOCKER_HOST: '',
        DOCKER_CONTEXT: '',
        TALE_RUNTIME: '',
        ...extraEnv,
      },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode };
  }

  test('works before init and creates no project files', async () => {
    const result = await run(['doctor', '--json']);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({
      ok: true,
      command: 'doctor',
      data: { ready: true, engine: 'docker' },
    });
    expect(report.data.checks[0]).toMatchObject({
      id: 'engine',
      status: 'ok',
    });
    expect(report.data.checks[0].detail).toContain('Docker Compose');
    expect(await readdir(project)).toEqual([]);
  });

  test('an Incus workspace reports its runtime and its credentials, offline without a network call or Docker', async () => {
    await writeFile(join(project, 'tale.json'), INCUS_WORKSPACE);
    const log = join(directory, 'docker.log');
    const result = await run(['--json', 'doctor', '--offline'], {
      DOCTOR_TEST_LOG: log,
      TALE_INCUS_DIR: '',
    });
    expect(result.exitCode).toBe(3);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({
      ok: false,
      command: 'doctor',
      data: { ready: false, engine: 'incus' },
    });
    expect(
      report.data.checks.map((check: { id: string; status: string }) => [
        check.id,
        check.status,
      ]),
    ).toEqual([
      ['engine', 'ok'],
      ['incus-credentials', 'fail'],
      ['incus-api', 'warn'],
    ]);
    expect(report.data.checks[0].detail).toContain('project tale-doctor');
    expect(report.data.checks[1].detail).toContain(join('.tale', 'incus'));
    expect(report.data.checks[2].detail).toContain('--offline');
    // Docker is not this workspace's runtime: it was never asked.
    expect(await Bun.file(log).exists()).toBe(false);
    expect((await readdir(project)).sort()).toEqual(['tale.json']);
  });

  test('a runtime this CLI cannot read fails the runtime row', async () => {
    await writeFile(
      join(project, 'tale.json'),
      JSON.stringify({
        version: 1,
        cliVersion: '0.5.95',
        createdAt: '2026-11-13T00:00:00.000Z',
        runtime: { engine: 'podman' },
      }),
    );
    const result = await run(['--json', 'doctor']);
    expect(result.exitCode).toBe(3);
    const report = JSON.parse(result.stdout);
    expect(report.data.checks[0]).toMatchObject({
      id: 'engine',
      status: 'fail',
    });
    expect(report.data.checks[0].detail).toContain('runtime.engine');
  });

  test('a TALE_RUNTIME that contradicts the declaration fails the runtime row with its own fix', async () => {
    await writeFile(join(project, 'tale.json'), INCUS_WORKSPACE);
    const result = await run(['--json', 'doctor', '--offline'], {
      TALE_RUNTIME: 'docker',
    });
    expect(result.exitCode).toBe(3);
    const report = JSON.parse(result.stdout);
    expect(report.data.checks[0]).toMatchObject({
      id: 'engine',
      status: 'fail',
    });
    expect(report.data.checks[0].detail).toContain('TALE_RUNTIME');
    expect(report.data.checks[0].fix).toContain('unset TALE_RUNTIME');
  });

  test('missing prerequisites return all diagnostic rows with exit 3', async () => {
    const result = await run(['--json', 'doctor'], {
      DOCTOR_TEST_MISSING_COMPOSE: '1',
    });
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe('');
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({
      ok: false,
      command: 'doctor',
      data: { ready: false },
    });
    expect(report.data.checks).toContainEqual(
      expect.objectContaining({ id: 'compose', status: 'fail' }),
    );
    expect(report.data.checks).toContainEqual(
      expect.objectContaining({ id: 'docker', status: 'ok' }),
    );
  });

  test('does not parse or print project secrets or repair a broken project', async () => {
    const secret = 'DOCTOR_SECRET_MUST_NOT_APPEAR';
    await writeFile(join(project, '.env'), `SANDBOX_TOKEN=${secret}\n`);
    await writeFile(join(project, 'tale.json'), 'not valid json');
    const result = await run(['doctor']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(await readFile(join(project, 'tale.json'), 'utf8')).toBe(
      'not valid json',
    );
    expect((await readdir(project)).sort()).toEqual(['.env', 'tale.json']);
  });

  test('invalid port exits with usage guidance', async () => {
    const result = await run(['--json', 'doctor', '--port', '70000']);
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout).error.summary).toContain(
      'expected 1-65535',
    );
  });
});
