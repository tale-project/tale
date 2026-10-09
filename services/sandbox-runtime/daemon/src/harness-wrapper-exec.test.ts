// The gemini and pi wrappers stage per-exec files, then become their CLI
// (exec, same pid) instead of waiting on it as a child, so no Python process
// stays resident for the turn. The CLI is then the exec's process: its exit
// status and signals are the exec's own, and the prompt reaches it on stdin.
// What a wrapper staged outlives its exec; it carries the exec's pid, and the
// next wrapper to start removes it once that pid has ended. These drive each
// real wrapper against a fake CLI on PATH.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  geminiPayload,
  installGeminiWrapper,
} from './gemini-settings-test-helper';

const python = spawnSync(
  'python3',
  ['-c', 'import sys; print(sys.executable)'],
  { encoding: 'utf8' },
);
const PYTHON = python.status === 0 ? python.stdout.trim() : null;
const pyTest = PYTHON === null ? test.skip : test;

const WRAPPERS = [
  {
    name: 'tale-gemini-run',
    cli: 'gemini',
    /** Where the wrapper stages what outlives the exec, and the name of
     * what it stages there for an exec with this pid. */
    staged: (root: string) => join(root, 'home', '.gemini'),
    owned: (pid: number) =>
      new RegExp(`^tale-context-${pid}-[0-9a-f]{32}\\.md$`),
  },
  {
    name: 'tale-pi-run',
    cli: 'pi',
    staged: (root: string) => join(root, 'tmp'),
    owned: (pid: number) => new RegExp(`^tale-pi-${pid}-[a-z0-9_]+$`),
  },
] as const;
type Wrapper = (typeof WRAPPERS)[number];

// Records what the exec's process sees, then waits to be signalled (as the
// same process: no fork for a group signal to race) or exits with the status
// it is given.
const FAKE_CLI = `#!/bin/sh
echo "$$" > "$FAKE_RECORD.pid"
pwd > "$FAKE_RECORD.cwd"
cat > "$FAKE_RECORD.stdin"
touch "$FAKE_RECORD.started"
if [ -n "$FAKE_WAIT" ]; then exec sleep 30; fi
exit "\${FAKE_EXIT:-0}"
`;

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'tale-wrapper-exec-')));
  for (const dir of ['workspace', 'bin', 'cli', 'home', 'tmp', 'records']) {
    mkdirSync(join(root, dir), { recursive: true });
  }
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function wrapperPath(wrapper: Wrapper): string {
  return wrapper.cli === 'gemini'
    ? installGeminiWrapper(root)
    : resolve(import.meta.dir, '../..', wrapper.name);
}

function payload(wrapper: Wrapper, prompt: string): string {
  return wrapper.cli === 'gemini'
    ? geminiPayload(root, { prompt })
    : JSON.stringify({ prompt, system_prompt: 'be brief' });
}

function installCli(wrapper: Wrapper): void {
  const fake = join(root, 'cli', wrapper.cli);
  writeFileSync(fake, FAKE_CLI);
  chmodSync(fake, 0o755);
}

/** Start a wrapper as runnerd does: a process group of its own. */
function start(
  wrapper: Wrapper,
  run: string,
  options: { wait?: boolean; exit?: number; prompt?: string } = {},
) {
  if (PYTHON === null) throw new Error('python3 is missing');
  const child = spawn(
    PYTHON,
    [wrapperPath(wrapper), '--workdir', join(root, 'workspace')],
    {
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // The fake CLI and the shell tools it uses; no real CLI.
        PATH: `${join(root, 'cli')}:/usr/bin:/bin`,
        HOME: join(root, 'home'),
        TMPDIR: join(root, 'tmp'),
        FAKE_RECORD: join(root, 'records', run),
        FAKE_WAIT: options.wait === true ? '1' : '',
        FAKE_EXIT: String(options.exit ?? 0),
      },
    },
  );
  let stdout = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  child.stdin?.end(payload(wrapper, options.prompt ?? 'p'));
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
  }>((done) =>
    child.on('close', (code, signal) => done({ code, signal, stdout })),
  );
  const pid = child.pid;
  if (pid === undefined) throw new Error('the wrapper never started');
  return { pid, exited };
}

async function startedCli(run: string): Promise<void> {
  const started = join(root, 'records', `${run}.started`);
  const since = Date.now();
  while (!existsSync(started) && Date.now() - since < 10_000) {
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(existsSync(started)).toBe(true);
}

function record(run: string, what: 'pid' | 'cwd' | 'stdin'): string {
  return readFileSync(join(root, 'records', `${run}.${what}`), 'utf8');
}

/** What the wrapper staged that is still on disk, by name. */
function staged(wrapper: Wrapper): string[] {
  const dir = wrapper.staged(root);
  return existsSync(dir)
    ? readdirSync(dir).filter((name) => name.startsWith('tale-'))
    : [];
}

for (const wrapper of WRAPPERS) {
  describe(`${wrapper.name} becomes its CLI`, () => {
    pyTest(
      'the CLI runs as the exec itself, reads the prompt on stdin in the workdir, and its exit status is the exec’s',
      async () => {
        installCli(wrapper);
        const prompt = `-a leading dash, ünïcödé, and more than a pipe holds: ${'x'.repeat(200_000)}`;
        const run = start(wrapper, 'a', { exit: 7, prompt });
        const { code, signal } = await run.exited;
        expect({ code, signal }).toEqual({ code: 7, signal: null });
        // Same pid: the wrapper replaced itself, nothing waits beside the CLI.
        expect(Number(record('a', 'pid'))).toBe(run.pid);
        expect(record('a', 'stdin')).toBe(prompt);
        expect(record('a', 'cwd').trim()).toBe(join(root, 'workspace'));
        // The prompt rode an anonymous file: nothing of it is left in TMPDIR.
        expect(
          readdirSync(join(root, 'tmp')).filter(
            (name) => !wrapper.owned(run.pid).test(name),
          ),
        ).toEqual([]);
      },
      20_000,
    );

    pyTest(
      'a process-group SIGTERM ends the CLI by that signal, as runnerd sends it',
      async () => {
        installCli(wrapper);
        const run = start(wrapper, 'a', { wait: true });
        await startedCli('a');
        process.kill(-run.pid, 'SIGTERM');
        // runnerd reports a signalled exit as 128 + the signal (143), the
        // status the wrapper itself used to exit with.
        expect(await run.exited).toMatchObject({
          code: null,
          signal: 'SIGTERM',
        });
      },
      20_000,
    );

    pyTest(
      'what an exec staged stays while it runs, and the next wrapper removes it once the exec has ended',
      async () => {
        installCli(wrapper);
        const runs = new Map<string, number>();
        const run = (name: string, options: { wait?: boolean } = {}) => {
          const started = start(wrapper, name, options);
          runs.set(name, started.pid);
          return started;
        };
        // The exec each staged file or dir belongs to, by run name.
        const owners = () =>
          staged(wrapper)
            .map(
              (file) =>
                [...runs].find(([, pid]) =>
                  wrapper.owned(pid).test(file),
                )?.[0] ?? file,
            )
            .sort();

        const live = run('live', { wait: true });
        await startedCli('live');
        const ended = run('ended');
        expect((await ended.exited).code).toBe(0);
        expect(owners()).toEqual(['ended', 'live']);

        // The exec that ended goes; the one still running keeps its files.
        const next = run('next');
        expect((await next.exited).code).toBe(0);
        expect(owners()).toEqual(['live', 'next']);

        process.kill(-live.pid, 'SIGTERM');
        await live.exited;
        const last = run('last');
        expect((await last.exited).code).toBe(0);
        expect(owners()).toEqual(['last']);
      },
      30_000,
    );

    pyTest(
      'a CLI that cannot start fails the exec and leaves nothing staged',
      async () => {
        const run = start(wrapper, 'a');
        const { code, stdout } = await run.exited;
        expect(code).toBe(1);
        expect(stdout).toContain('not installed');
        expect(staged(wrapper)).toEqual([]);
        expect(readdirSync(join(root, 'tmp'))).toEqual([]);
      },
      20_000,
    );
  });
}
