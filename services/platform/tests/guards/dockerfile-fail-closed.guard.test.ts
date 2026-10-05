// @vitest-environment node

import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

/**
 * A RUN that chains a required step and an optional cleanup into one sh
 * AND-OR list fails open when the cleanup's `|| true` is not braced: sh
 * groups `&&` and `||` left to right, so `install && swap && cleanup || true`
 * exits 0 when the install fails. The platform image shipped that way:
 * the pruner's production install printed Bun's "lockfile had changes, but
 * lockfile is frozen", its cleanup's `|| true` swallowed the exit, and the
 * runtime image carried the builder's full dev node_modules (#3996).
 *
 * This guard runs each such RUN's own text through /bin/sh, as BuildKit's
 * shell form does, with every command it calls replaced by a recording
 * double on a private PATH. A failed required step must fail the RUN; a
 * failed optional step must not. It also pins the pruner's manifests to
 * stage 1's: the one stage 1 copied and the pruner did not (tools/opengrep's)
 * was the lockfile change Bun refused.
 */

const PLATFORM_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const REPO_ROOT = path.resolve(PLATFORM_ROOT, '../..');
const PLATFORM_DOCKERFILE = path.join(PLATFORM_ROOT, 'Dockerfile');
const SANDBOX_RUNTIME_DOCKERFILE = path.join(
  REPO_ROOT,
  'services/sandbox-runtime/Dockerfile',
);

interface Instruction {
  stage: string;
  keyword: string;
  args: string;
}

/**
 * Every instruction of a Dockerfile, joined as BuildKit joins them: a
 * trailing `\` continues the line, and full-line comments and blank lines
 * inside a continuation are dropped. `stage` is the `AS` name of the
 * enclosing FROM, or '' for an unnamed one.
 */
function parseInstructions(source: string): Instruction[] {
  const result: Instruction[] = [];
  let stage = '';
  let pending = '';
  for (const line of source.split('\n')) {
    if (/^\s*(#|$)/.test(line)) continue;
    pending += line.replace(/\\\s*$/, '');
    if (/\\\s*$/.test(line)) continue;
    const [, word = '', args = ''] = /^\s*(\S+)\s*(.*)$/s.exec(pending) ?? [];
    pending = '';
    const keyword = word.toUpperCase();
    if (keyword === 'FROM') stage = /\sAS\s+(\S+)/i.exec(args)?.[1] ?? '';
    result.push({ stage, keyword, args });
  }
  return result;
}

function instructions(file: string): Instruction[] {
  return parseInstructions(readFileSync(file, 'utf8'));
}

/** All context files reachable through a stage's FROM and COPY dependencies. */
function contextInputs(source: string, stage: string): Set<string> {
  const parsed = parseInstructions(source);
  const namedStages = new Set(parsed.map((instruction) => instruction.stage));
  const inputs = new Set<string>();
  const visited = new Set<string>();
  function visit(name: string): void {
    if (visited.has(name)) return;
    visited.add(name);
    for (const instruction of parsed.filter((item) => item.stage === name)) {
      const words = instruction.args.trim().split(/\s+/);
      if (instruction.keyword === 'FROM') {
        const parent = words[0] ?? '';
        if (namedStages.has(parent)) visit(parent);
      } else if (instruction.keyword === 'COPY') {
        const from = words.find((word) => word.startsWith('--from='));
        if (from) {
          const parent = from.slice('--from='.length);
          if (namedStages.has(parent)) visit(parent);
        } else {
          for (const input of words
            .filter((word) => !word.startsWith('--'))
            .slice(0, -1)) {
            inputs.add(input);
          }
        }
      }
    }
  }
  visit(stage);
  return inputs;
}

/**
 * The sh command of the one RUN in `stage` that mentions `marker`, without
 * its `--mount` flags.
 */
function runCommand(file: string, stage: string, marker: string): string {
  const runs = instructions(file).filter(
    (instruction) =>
      instruction.stage === stage &&
      instruction.keyword === 'RUN' &&
      instruction.args.includes(marker),
  );
  if (runs.length !== 1) {
    throw new Error(
      `expected one RUN mentioning "${marker}" in stage "${stage}" of ${path.relative(REPO_ROOT, file)}, found ${runs.length} — update this guard alongside the Dockerfile`,
    );
  }
  return (runs[0]?.args ?? '').replace(/^(\s*--\S+)+\s+/, '').trim();
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Run `command` through /bin/sh with a PATH holding only recording doubles
 * for `commands`: each appends `<name> <args>` to the call log, then exits 1
 * when that line matches one of the sh `case` patterns in `failing`, else 0.
 * Builtins stay the shell's own, so nothing is installed, moved or deleted;
 * redirections into absolute paths (other than /dev/null) are pointed into
 * the scratch directory first.
 */
function runWithDoubles(
  command: string,
  commands: string[],
  failing: string[] = [],
) {
  const dir = mkdtempSync(path.join(tmpdir(), 'dockerfile-fail-closed-'));
  tempDirs.push(dir);
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  const log = path.join(dir, 'calls.log');
  writeFileSync(log, '');
  for (const name of commands) {
    writeFileSync(
      path.join(bin, name),
      [
        '#!/bin/sh',
        `printf '%s\\n' "${name} $*" >> "$CALL_LOG"`,
        `case "${name} $*" in`,
        ...failing.map((pattern) => `  ${pattern}) exit 1 ;;`),
        'esac',
        'exit 0',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
  }
  let redirects = 0;
  const contained = command.replace(
    /(>>?)\s*(\/(?!dev\/null\b)\S+)/g,
    (_match, operator: string) =>
      `${operator} ${path.join(dir, `redirect-${++redirects}`)}`,
  );
  const result = spawnSync('/bin/sh', ['-c', contained], {
    cwd: dir,
    env: { PATH: bin, CALL_LOG: log },
    encoding: 'utf8',
    timeout: 10_000,
  });
  return {
    error: result.error,
    status: result.status,
    stderr: result.stderr,
    calls: readFileSync(log, 'utf8').split('\n').filter(Boolean),
  };
}

describe('platform pruner: the production install fails closed', () => {
  const command = runCommand(
    PLATFORM_DOCKERFILE,
    'pruner',
    'bun install --production',
  );
  const commands = ['bun', 'rm', 'mv', 'find'];
  const INSTALL = 'bun install --production';
  const SWAP = [
    'rm -rf /app/node_modules',
    'mv /tmp/workspace/node_modules /app/node_modules',
  ];
  const isCleanup = (call: string) =>
    call.startsWith('rm -rf /app/node_modules/') ||
    call.startsWith('find /app/node_modules ');

  it('installs, swaps the tree in, then cleans it', () => {
    const result = runWithDoubles(command, commands);
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.calls.slice(0, 3)).toEqual([INSTALL, ...SWAP]);
    const cleanup = result.calls.slice(3);
    expect(cleanup.length).toBeGreaterThan(1);
    expect(cleanup.every(isCleanup)).toBe(true);
  });

  it('fails the build when the production install fails', () => {
    // Bun's frozen-lockfile refusal exits 1; nothing may be swapped or cleaned.
    const result = runWithDoubles(command, commands, [`"${INSTALL}"`]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.calls).toEqual([INSTALL]);
  });

  it.each(SWAP)('fails the build when `%s` fails', (step) => {
    const result = runWithDoubles(command, commands, [`"${step}"`]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.calls.at(-1)).toBe(step);
    expect(result.calls.some(isCleanup)).toBe(false);
  });

  it('tolerates every cleanup step failing', () => {
    const passing = runWithDoubles(command, commands);
    const result = runWithDoubles(command, commands, [
      '"rm -rf /app/node_modules/"*',
      '"find "*',
    ]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    // Each cleanup step still ran after the one before it failed.
    expect(result.calls).toEqual(passing.calls);
  });
});

describe('platform pruner manifests', () => {
  it('keeps production dependencies independent of every source and build stage', () => {
    const source = readFileSync(PLATFORM_DOCKERFILE, 'utf8');
    const production = contextInputs(source, 'pruner');
    const development = contextInputs(source, 'workspace-deps');
    expect(production.has('bun.lock')).toBe(true);
    expect(production.has('patches/')).toBe(true);
    expect(production.size).toBeGreaterThanOrEqual(10);
    expect([...production].sort()).toEqual([...development].sort());

    // Lock the prior regression: inheriting builder makes source-only edits
    // reinstall dependencies, even when the manifests themselves are unchanged.
    const regressed = source.replace(
      /FROM \S+ AS pruner/,
      'FROM builder AS pruner',
    );
    const changed = contextInputs(regressed, 'pruner');
    expect(changed.has('services/platform/app')).toBe(true);
    expect([...changed].sort()).not.toEqual([...development].sort());

    // Only the installed dependency tree comes from this manifest-only stage.
    const copies = instructions(PLATFORM_DOCKERFILE).filter(
      (instruction) =>
        instruction.stage === 'runner' &&
        instruction.keyword === 'COPY' &&
        instruction.args.includes('--from=pruner'),
    );
    expect(copies.map((instruction) => instruction.args)).toEqual([
      '--from=pruner --chown=app:app /app/node_modules ./node_modules',
    ]);
  });

  /**
   * Install-root-relative paths of the files a stage's COPYs (with exactly
   * the given `--from`, '' for the build context) place under `root`, each
   * checked to come from the same relative path under `sourceRoot`.
   */
  function manifests(
    stage: string,
    from: string,
    sourceRoot: string,
    root: string,
  ): Set<string> {
    const placed = new Set<string>();
    for (const instruction of instructions(PLATFORM_DOCKERFILE)) {
      if (instruction.stage !== stage || instruction.keyword !== 'COPY') {
        continue;
      }
      const words = instruction.args.trim().split(/\s+/);
      const fromFlag = words.find((word) => word.startsWith('--from=')) ?? '';
      if (fromFlag !== from) continue;
      const [destination = '', ...sources] = words
        .filter((word) => !word.startsWith('--'))
        .reverse();
      expect(destination.startsWith(root)).toBe(true);
      for (const source of sources) {
        // A directory source (`patches/ ./patches/`) lands as the directory.
        const file = source.endsWith('/')
          ? destination.slice(root.length)
          : path.posix.join(
              destination.slice(root.length),
              path.posix.basename(source),
            );
        expect(source).toBe(`${sourceRoot}${file}`);
        placed.add(file);
      }
    }
    return placed;
  }

  it('gives the production install every manifest stage 1 installed from', () => {
    const stage1 = manifests('workspace-deps', '', '', './');
    const pruner = manifests(
      'pruner',
      '--from=workspace-deps',
      '/app/',
      '/tmp/workspace/',
    );
    // Sanity: the parser saw both lists.
    expect(stage1.has('bun.lock')).toBe(true);
    expect(stage1.size).toBeGreaterThanOrEqual(10);
    // A manifest stage 1 installed from but the pruner lacks changes the
    // workspace graph, and --production refuses the lockfile stage 1 wrote.
    expect([...pruner].sort()).toEqual([...stage1].sort());
  });
});

describe('platform runner: system packages fail closed', () => {
  const command = runCommand(PLATFORM_DOCKERFILE, 'runner', 'groupadd');
  const commands = [
    'apt-get',
    'curl',
    'dpkg',
    'chmod',
    'mkdir',
    'groupadd',
    'useradd',
    'rm',
  ];

  it('installs, fetches SOPS, creates the app user, then cleans up', () => {
    const result = runWithDoubles(command, commands);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.calls.map((call) => call.split(' ')[0])).toEqual([
      'apt-get',
      'apt-get',
      'dpkg',
      'curl',
      'chmod',
      'mkdir',
      'chmod',
      'groupadd',
      'useradd',
      'mkdir',
      'chmod',
      'rm',
    ]);
  });

  it.each([
    ['the package install', '"apt-get install "*'],
    ['the SOPS download', '"curl "*'],
  ])('fails the build when %s fails', (_step, pattern) => {
    const result = runWithDoubles(command, commands, [pattern]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.calls.some((call) => call.startsWith('groupadd'))).toBe(
      false,
    );
  });

  it('tolerates the app group and user already existing', () => {
    const passing = runWithDoubles(command, commands);
    const result = runWithDoubles(command, commands, [
      '"groupadd "*',
      '"useradd "*',
    ]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.calls).toEqual(passing.calls);
  });
});

describe('sandbox-runtime: the container engine install fails closed', () => {
  const command = runCommand(SANDBOX_RUNTIME_DOCKERFILE, '', 'docker-ce');
  const commands = ['install', 'curl', 'chmod', 'dpkg', 'apt-get', 'rm'];
  const STRIP =
    'rm -f /etc/systemd/system/multi-user.target.wants/docker.service';

  it('installs the engine, then strips its auto-start unit', () => {
    const result = runWithDoubles(command, commands);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(
      result.calls.some((call) => call.startsWith('apt-get install')),
    ).toBe(true);
    expect(result.calls.at(-1)).toBe(STRIP);
  });

  it.each([
    ['the signing key download', '"curl "*'],
    ['the package index update', '"apt-get update"'],
    ['the engine install', '"apt-get install "*'],
  ])('fails the build when %s fails', (_step, pattern) => {
    const result = runWithDoubles(command, commands, [pattern]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.calls).not.toContain(STRIP);
  });

  it('tolerates the auto-start unit strip failing', () => {
    const result = runWithDoubles(command, commands, [`"${STRIP}"`]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.calls.at(-1)).toBe(STRIP);
  });
});
