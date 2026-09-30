import { expect, spyOn, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { fixture, temporary } from './tests/fixture';
import {
  FIXTURE_GIT_BOUND_MS,
  FIXTURE_GIT_PROBE_MS,
  fixtureGit,
  runtime,
  stepOutcome,
} from './tests/fixture-git';

/** A stand-in for Git, run by this Bun: it answers `--version` at once and
 * runs `body` for every other step, whose `args` start with `-C <root>`. */
function syntheticGit(body: string): string[] {
  const script = path.join(temporary(), 'git.mjs');
  writeFileSync(
    script,
    `const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('git version 0.0.0.synthetic');
  process.exit(0);
}
${body}
`,
  );
  return [process.execPath, script];
}

function failure(step: () => unknown): string {
  try {
    step();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('the step did not fail');
}

test('healthy fixture Git steps keep their output and report nothing', () => {
  const f = fixture();
  const direct = (...args: string[]) =>
    execFileSync('git', ['-C', f.root, ...args], { encoding: 'utf8' }).trim();
  expect(f.git('rev-parse', 'HEAD')).toBe(f.options.sourceCommit);
  expect(f.git('rev-parse', 'HEAD')).toBe(direct('rev-parse', 'HEAD'));
  expect(f.git('log', '-1', '--format=%s')).toBe('fixture');
  expect(f.git('status', '--porcelain=v1', '--untracked-files=all')).toBe('');
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(
      fixtureGit(f.root, { slowMs: 60_000 })('cat-file', '-t', 'HEAD'),
    ).toBe('commit');
    expect(warn).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
}, 30_000);

test('a stalled Git step is stopped at its bound and names its operation, timing and evidence', () => {
  const git = fixtureGit(temporary(), {
    boundMs: 3_000,
    // Says the commit began, then stops progressing: the shape of the Windows
    // commits that ran into the 30 s test budget with empty output (#4015).
    command: syntheticGit(`if (args.includes('commit')) {
  process.stderr.write('synthetic commit started\\n');
  setTimeout(() => {}, 60_000);
}`),
  });
  expect(git('init', '--quiet')).toBe('');
  process.env.TALE_FIXTURE_GIT_CANARY = 'canary-environment-value';
  const started = performance.now();
  let message: string;
  try {
    message = failure(() =>
      git('-c', 'user.name=Test', 'commit', '--quiet', '-m', 'canary-message'),
    );
  } finally {
    delete process.env.TALE_FIXTURE_GIT_CANARY;
  }
  const elapsed = performance.now() - started;
  // Its own bound stopped it, the probe answered, and the budget was far off.
  expect(elapsed).toBeGreaterThanOrEqual(3_000);
  expect(elapsed).toBeLessThan(3_000 + FIXTURE_GIT_PROBE_MS + 5_000);
  expect(message).toMatch(
    /^Fixture git commit \(step 2, \+\d+ ms\) was stopped at its 3000 ms bound after \d+ ms\.$/m,
  );
  expect(message).toContain(
    'output: stdout 0 B; stderr 25 B ending "synthetic commit started\\n"',
  );
  expect(message).toMatch(/earlier steps: init \d+ ms at \+\d+ ms$/m);
  expect(message).toMatch(
    /probe: git --version answered in \d+ ms: "git version 0\.0\.0\.synthetic"$/m,
  );
  expect(message).toContain(`runtime: ${runtime()}`);
  expect(message).not.toContain('canary');
  expect(message).not.toContain('user.name');
  expect(message.length).toBeLessThan(1_000);
}, 30_000);

test('a failed Git step reports its status, output, earlier steps and a real probe', () => {
  const f = fixture();
  const message = failure(() =>
    f.git('rev-parse', '--verify', 'refs/heads/absent'),
  );
  expect(message).toMatch(
    /^Fixture git rev-parse \(step 6, \+\d+ ms\) exited with status 128 after \d+ ms\.$/m,
  );
  expect(message).toMatch(
    /stderr \d+ B ending "fatal: Needed a single revision\\n"$/m,
  );
  expect(message).toMatch(
    /earlier steps: init \d+ ms at \+\d+ ms, add \d+ ms at \+\d+ ms, update-index \d+ ms at \+\d+ ms, commit \d+ ms at \+\d+ ms, rev-parse \d+ ms at \+\d+ ms$/m,
  );
  expect(message).toMatch(
    /probe: git --version answered in \d+ ms: "git version /,
  );
}, 30_000);

test('a failed step shows only an escaped end of its output, the fixture root shortened', () => {
  const root = temporary();
  const git = fixtureGit(root, {
    command: syntheticGit(`process.stderr.write(
  'x'.repeat(100_000) +
    '\\n::error::planted annotation\\n\\u001b[31mfatal: cannot lock ' +
    args[1] +
    '/.git/index.lock\\n',
);
process.exit(1);`),
  });
  const message = failure(() => git('commit', '--quiet', '-m', 'flood'));
  expect(message).toMatch(/\) exited with status 1 after \d+ ms\.$/m);
  expect(message).toMatch(
    /stderr 100\d{3} B ending "x+\\n::error::planted annotation\\n\\u001b\[31mfatal: cannot lock <fixture>\/\.git\/index\.lock\\n"$/m,
  );
  expect(message).not.toContain(root);
  expect(message.split('\n').some((line) => line.startsWith('::'))).toBe(false);
  expect(message.length).toBeLessThan(1_000);
}, 30_000);

test('a slow step that succeeds is reported once, as it ends', () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(fixtureGit(temporary(), { slowMs: 0 })('init', '--quiet')).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(
      /^Fixture git init \(step 1, \+\d+ ms\) took \d+ ms of its 15000 ms bound\.$/,
    );
  } finally {
    warn.mockRestore();
  }
}, 30_000);

test('a report names what ended a step, and only a plain runner image', () => {
  expect(stepOutcome({ signal: 'SIGTERM', status: null }, 15_000)).toBe(
    'was stopped by SIGTERM from outside, before its 15000 ms bound,',
  );
  expect(stepOutcome({ code: 'ETIMEDOUT', status: 0 }, 15_000)).toBe(
    'exited with status 0 but held its output open until its 15000 ms bound',
  );
  expect(
    stepOutcome({ code: 'ETIMEDOUT', signal: 'SIGKILL', status: 1 }, 15_000),
  ).toBe('was stopped at its 15000 ms bound');
  expect(stepOutcome({ code: 'ENOENT', status: null }, 15_000)).toBe(
    'could not complete (ENOENT)',
  );
  expect(stepOutcome({ code: 'no\ncode' }, 15_000)).toBe(
    'could not complete (an unrecognized code)',
  );
  const platform = `Bun ${Bun.version} on ${process.platform} ${process.arch}`;
  expect(runtime({})).toBe(platform);
  expect(runtime({ ImageOS: 'win25', ImageVersion: '20260925.250.1' })).toBe(
    `${platform}, runner image win25 20260925.250.1`,
  );
  expect(runtime({ ImageOS: 'win25', ImageVersion: '1\nTOKEN=x' })).toBe(
    `${platform}, runner image win25`,
  );
});

test('a stalled step is stopped and probed inside the per-test budget', () => {
  const manifest = readFileSync(
    new URL('../../../../package.json', import.meta.url),
    'utf8',
  );
  const budget = Number(
    /"test": "bun test --timeout (\d+)"/.exec(manifest)?.[1],
  );
  expect(FIXTURE_GIT_BOUND_MS + FIXTURE_GIT_PROBE_MS).toBeLessThan(budget);
});
