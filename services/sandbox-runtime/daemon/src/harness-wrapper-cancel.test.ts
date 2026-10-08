// The qwen wrapper stages settings and a context file on disk before its CLI
// starts and waits on the CLI as a child, so it must remove them however the
// exec ends — runnerd ends a cancelled, timed-out or exited exec with a
// SIGTERM to its process group, and Python's default SIGTERM runs no
// `finally`. A second signal must not cut that cleanup short either. These
// drive the real wrapper against a fake CLI on PATH that only waits to be
// signalled. (The gemini and pi wrappers become their CLI instead; see
// harness-wrapper-exec.test.ts.)

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const hasPython = spawnSync('python3', ['-V']).status === 0;
const pyTest = hasPython ? test : test.skip;

const WRAPPERS = [
  { name: 'tale-qwen-run', cli: 'qwen', home: '.qwen' },
] as const;

const FAKE_CLI = `#!/bin/sh
touch "$FAKE_STARTED"
sleep 30
`;

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'tale-wrapper-cancel-')));
  for (const dir of ['workspace', 'bin', 'home', 'tmp']) {
    mkdirSync(join(root, dir), { recursive: true });
  }
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Start a wrapper as runnerd does (a group of its own), wait until its CLI
 * runs, send `signals` to the group back to back, and return the exit. */
async function cancelMidRun(
  wrapper: (typeof WRAPPERS)[number],
  signals: NodeJS.Signals[],
): Promise<number | null> {
  const fake = join(root, 'bin', wrapper.cli);
  writeFileSync(fake, FAKE_CLI);
  chmodSync(fake, 0o755);
  const startedPath = join(root, 'started');
  const wrapperPath = resolve(import.meta.dir, '../..', wrapper.name);
  const child = spawn(
    'python3',
    [wrapperPath, '--workdir', join(root, 'workspace')],
    {
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
      env: {
        ...process.env,
        PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
        HOME: join(root, 'home'),
        TMPDIR: join(root, 'tmp'),
        FAKE_STARTED: startedPath,
      },
    },
  );
  child.stdin?.end(JSON.stringify({ prompt: 'p', system_prompt: 'be brief' }));
  const exited = new Promise<number | null>((r) =>
    child.on('exit', (code) => r(code)),
  );
  const started = Date.now();
  while (!existsSync(startedPath) && Date.now() - started < 10_000) {
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(existsSync(startedPath)).toBe(true);
  // Staged before the CLI started.
  expect(leftBehind(wrapper).length).toBeGreaterThan(0);
  const group = child.pid;
  if (group === undefined) throw new Error('the wrapper never started');
  for (const signal of signals) process.kill(-group, signal);
  return exited;
}

/** What a wrapper staged that is still on disk. */
function leftBehind(wrapper: (typeof WRAPPERS)[number]): string[] {
  const home = join(root, 'home', wrapper.home);
  return [
    ...readdirSync(join(root, 'tmp')),
    ...(existsSync(home)
      ? readdirSync(home).filter((name) => name.startsWith('tale-'))
      : []),
  ];
}

for (const wrapper of WRAPPERS) {
  describe(`${wrapper.name} cancel`, () => {
    pyTest(
      'a process-group SIGTERM mid-run removes what the wrapper staged',
      async () => {
        expect(await cancelMidRun(wrapper, ['SIGTERM'])).toBe(128 + 15);
        expect(leftBehind(wrapper)).toEqual([]);
      },
      20_000,
    );

    pyTest(
      'a second signal does not cut the cleanup short',
      async () => {
        const code = await cancelMidRun(wrapper, ['SIGTERM', 'SIGINT']);
        expect([128 + 2, 128 + 15]).toContain(code ?? -1);
        expect(leftBehind(wrapper)).toEqual([]);
      },
      20_000,
    );
  });
}
