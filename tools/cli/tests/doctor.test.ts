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
import { join, resolve } from 'node:path';

const cli = resolve(import.meta.dir, '../src/index.ts');

// A synthetic Docker executable proves the public command stays read-only,
// reports failures through one JSON envelope, and works before init.
describe.skipIf(process.platform === 'win32')('doctor command', () => {
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
    const proc = Bun.spawn([process.execPath, cli, ...args], {
      cwd: project,
      env: {
        ...process.env,
        PATH: bin,
        DOCKER_HOST: '',
        DOCKER_CONTEXT: '',
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
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: 'doctor',
      data: { ready: true },
    });
    expect(await readdir(project)).toEqual([]);
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
