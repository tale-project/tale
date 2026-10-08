// The real entrypoint helpers that clear the previous incarnation's exec temp
// at a session start: set aside with one rename, deleted in the background,
// never through a symbolic link. Runs the script's helper section under sh
// against a scratch runtime root; nothing there has a side effect of its own.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const entrypoint = readFileSync(
  resolve(import.meta.dir, '../../entrypoint.sh'),
  'utf8',
);
const helpers = entrypoint.slice(
  0,
  entrypoint.indexOf('# K8s transparent-egress native sidecar.'),
);
const scratch = mkdtempSync(join(tmpdir(), 'tale-exec-temp-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let sequence = 0;
/** A runtime root holding an exec temp with a spool in it. */
function runtimeRoot(): string {
  const root = join(scratch, `runtime-${++sequence}`);
  mkdirSync(join(root, 'tmp', 'pip-staging'), { recursive: true });
  writeFileSync(join(root, 'tmp', 'runnerd-spool'), 'replay');
  mkdirSync(join(root, 'home'));
  return root;
}

/** Run the helpers, unprivileged as on the plain session path. */
function run(script: string): { status: number | null; stderr: string } {
  const r = spawnSync('sh', ['-c', `${helpers}\nDROP=""\n${script}`], {
    encoding: 'utf8',
  });
  return { status: r.status, stderr: r.stderr };
}

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('still not so after 10 s');
    await Bun.sleep(20);
  }
}

const aside = (root: string) =>
  readdirSync(root).filter((name) => name.startsWith('tmp.old.'));

describe('exec temp at a session start', () => {
  test('is set aside by one rename, its contents intact until the background purge', async () => {
    const root = runtimeRoot();
    expect(run(`set_aside_exec_temp '${root}'`).status).toBe(0);
    expect(existsSync(join(root, 'tmp'))).toBe(false);
    const [old] = aside(root);
    expect(old).toBeDefined();
    expect(readFileSync(join(root, old ?? '', 'runnerd-spool'), 'utf8')).toBe(
      'replay',
    );
    expect(existsSync(join(root, 'home'))).toBe(true);

    // The purge returns at once and deletes in the background.
    expect(run(`purge_old_exec_temp '${root}' 1`).status).toBe(0);
    expect(aside(root)).toHaveLength(1);
    await until(() => aside(root).length === 0);
    expect(existsSync(join(root, 'home'))).toBe(true);
  });

  test('a leftover a cut-short purge left is never moved into, and goes with the next purge', async () => {
    const root = runtimeRoot();
    // The shell's pid names the aside tree, and a restarted container's
    // PID 1 meets its predecessor's leftover under the same name.
    expect(
      run(
        `set_aside_exec_temp '${root}'; mkdir '${root}/tmp'; echo 2 > '${root}/tmp/second'; set_aside_exec_temp '${root}'`,
      ).status,
    ).toBe(0);
    const names = aside(root).sort();
    expect(names).toHaveLength(2);
    const [first = '', second = ''] = names;
    expect(second).toBe(`${first}.x`);
    expect(readdirSync(join(root, first)).sort()).toEqual([
      'pip-staging',
      'runnerd-spool',
    ]);
    expect(readdirSync(join(root, second))).toEqual(['second']);
    expect(run(`purge_old_exec_temp '${root}' 0`).status).toBe(0);
    await until(() => aside(root).length === 0);
  });

  test('a symbolic link is renamed and removed itself, never what it names', async () => {
    const root = join(scratch, `runtime-${++sequence}`);
    mkdirSync(root);
    const elsewhere = join(scratch, `elsewhere-${sequence}`);
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, 'data.txt'), 'not yours');
    symlinkSync(elsewhere, join(root, 'tmp'));

    expect(run(`set_aside_exec_temp '${root}'`).status).toBe(0);
    const [old] = aside(root);
    expect(lstatSync(join(root, old ?? '')).isSymbolicLink()).toBe(true);
    expect(run(`purge_old_exec_temp '${root}' 0`).status).toBe(0);
    await until(() => aside(root).length === 0);
    expect(readFileSync(join(elsewhere, 'data.txt'), 'utf8')).toBe('not yours');
  });

  test('no exec temp is nothing to do', () => {
    const root = join(scratch, `runtime-${++sequence}`);
    mkdirSync(root);
    expect(run(`set_aside_exec_temp '${root}'`)).toEqual({
      status: 0,
      stderr: '',
    });
    expect(readdirSync(root)).toEqual([]);
  });

  test('the session start sets the temp aside and starts the purge before PATH names the workspace', () => {
    const daemon = entrypoint.slice(
      entrypoint.indexOf('if [ "$1" = "daemon" ]; then'),
    );
    // Nothing deletes the temp inline before runnerd any more.
    expect(daemon).not.toContain('rm -rf /agent/.runtime/tmp');
    const setAside = daemon.indexOf('set_aside_exec_temp /agent/.runtime');
    const purge = daemon.indexOf('purge_old_exec_temp /agent/.runtime');
    const skeleton = daemon.indexOf('$DROP mkdir -p');
    const workspacePath = daemon.indexOf(
      'export PATH=/agent/.runtime/deps/python/bin',
    );
    expect(setAside).toBeGreaterThan(-1);
    expect(setAside).toBeLessThan(purge);
    // The new temp is made after the old one is out of the way, and the
    // background job inherits the image's PATH only.
    expect(purge).toBeLessThan(skeleton);
    expect(purge).toBeLessThan(workspacePath);
  });
});
