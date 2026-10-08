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

/** Context and stage inputs reachable through FROM, COPY/ADD and RUN mounts. */
function contextInputs(
  source: string,
  stage: string,
  visited = new Set<string>(),
): Set<string> {
  const parsed = parseInstructions(source);
  const stages = parsed.filter((instruction) => instruction.keyword === 'FROM');
  const namedStages = new Map(
    stages.map((instruction) => [
      instruction.stage.toLowerCase(),
      instruction.stage,
    ]),
  );
  const inputs = new Set<string>();
  function resolve(reference: string): string | undefined {
    return /^\d+$/.test(reference)
      ? stages[Number(reference)]?.stage
      : namedStages.get(reference.toLowerCase());
  }
  function visit(reference: string): void {
    const name = resolve(reference);
    if (name === undefined || visited.has(name)) return;
    visited.add(name);
    for (const instruction of parsed.filter((item) => item.stage === name)) {
      const words = instruction.args.trim().split(/\s+/);
      if (instruction.keyword === 'FROM') {
        visit(words.find((word) => !word.startsWith('--')) ?? '');
      } else if (['COPY', 'ADD'].includes(instruction.keyword)) {
        const from = words.find((word) => word.startsWith('--from='));
        if (from !== undefined) {
          const parent = resolve(from.slice('--from='.length));
          // An external image or an empty reference cannot prove the local graph.
          expect(parent).toBeDefined();
          visit(parent ?? '');
        } else {
          for (const input of words
            .filter((word) => !word.startsWith('--'))
            .slice(0, -1)) {
            inputs.add(input);
          }
        }
      } else if (instruction.keyword === 'RUN') {
        for (const mount of instruction.args.matchAll(
          /(?:^|\s)--mount=(\S+)/g,
        )) {
          const options = mount[1] ?? '';
          const type = /(?:^|,)type=([^,]+)/.exec(options)?.[1] ?? 'bind';
          const from = /(?:^|,)from=([^,]*)/.exec(options)?.[1];
          expect(['bind', 'cache', 'tmpfs', 'secret', 'ssh']).toContain(type);
          if (type === 'bind' || from !== undefined) {
            // Bind is the default mount type and omitted from reads the context.
            expect(from).toBeTruthy();
            const parent = resolve(from ?? '');
            expect(parent).toBeDefined();
            visit(parent ?? '');
          }
        }
      }
    }
  }
  visit(stage);
  return inputs;
}

const isDependencyInput = (input: string) =>
  input === 'package.json' ||
  input.endsWith('/package.json') ||
  ['bun.lock', 'bunfig.toml', 'patches/'].includes(input);

function assertPrunerClosure(source: string): void {
  const dependencies = new Set<string>();
  const production = contextInputs(source, 'pruner', dependencies);
  const development = contextInputs(source, 'workspace-deps');
  expect(dependencies.has('pruner')).toBe(true);
  expect(dependencies.has('workspace-deps')).toBe(true);
  expect(dependencies.has('builder')).toBe(false);
  expect(dependencies.has('dev')).toBe(false);
  expect(production.has('bun.lock')).toBe(true);
  expect(production.has('patches/')).toBe(true);
  expect(production.size).toBeGreaterThanOrEqual(10);
  expect([...production].sort()).toEqual([...development].sort());
  expect([...production].every(isDependencyInput)).toBe(true);
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
    assertPrunerClosure(source);
    const production = contextInputs(source, 'pruner');
    const development = contextInputs(source, 'workspace-deps');
    expect(production.has('bun.lock')).toBe(true);
    expect(production.has('patches/')).toBe(true);
    expect(production.size).toBeGreaterThanOrEqual(10);
    expect([...production].every(isDependencyInput)).toBe(true);
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

  it('detects application source shared by both dependency input graphs', () => {
    const source = readFileSync(PLATFORM_DOCKERFILE, 'utf8').replace(
      /(FROM \S+ AS workspace-deps)/,
      '$1\nCOPY services/platform/app /app/unexpected-source/',
    );
    const production = contextInputs(source, 'pruner');
    const development = contextInputs(source, 'workspace-deps');
    // Graph equality alone misses a source copied into their shared parent.
    expect([...production].sort()).toEqual([...development].sort());
    expect(production.has('services/platform/app')).toBe(true);
    expect([...production].every(isDependencyInput)).toBe(false);
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
    config = readFileSync(PLATFORM_DOCKERFILE, 'utf8'),
  ): Set<string> {
    const placed = new Set<string>();
    for (const instruction of parseInstructions(config)) {
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

  it.each(['tools/opengrep/package.json', 'patches/'])(
    'detects a pruner missing %s',
    (missing) => {
      const source = readFileSync(PLATFORM_DOCKERFILE, 'utf8');
      const incomplete = source
        .split('\n')
        .filter(
          (line) =>
            !line.startsWith(`COPY --from=workspace-deps /app/${missing}`),
        )
        .join('\n');
      expect(incomplete).not.toBe(source);
      const stage1 = manifests('workspace-deps', '', '', './', incomplete);
      const pruner = manifests(
        'pruner',
        '--from=workspace-deps',
        '/app/',
        '/tmp/workspace/',
        incomplete,
      );
      expect([...pruner].sort()).not.toEqual([...stage1].sort());
      expect(pruner.has(missing)).toBe(false);
    },
  );

  it('detects a manifest copied to the wrong workspace path', () => {
    const source = readFileSync(PLATFORM_DOCKERFILE, 'utf8').replace(
      '/app/tools/opengrep/package.json /tmp/workspace/tools/opengrep/',
      '/app/tools/opengrep/package.json /tmp/workspace/tools/other/',
    );
    expect(() =>
      manifests(
        'pruner',
        '--from=workspace-deps',
        '/app/',
        '/tmp/workspace/',
        source,
      ),
    ).toThrow();
  });
});

describe('platform production dependency branch', () => {
  const source = readFileSync(PLATFORM_DOCKERFILE, 'utf8');
  const all = parseInstructions(source);

  it.each([
    source.replace('FROM bun-base AS pruner', 'FROM builder AS pruner'),
    source.replace(
      'FROM bun-base AS pruner',
      'FROM builder AS source-alias\nFROM source-alias AS pruner',
    ),
    source.replace(
      'WORKDIR /tmp/workspace',
      'COPY --from=builder /app/services/platform/app /app/leaked\nWORKDIR /tmp/workspace',
    ),
    source.replace(
      'WORKDIR /tmp/workspace',
      'RUN --mount=type=bind,from=builder,target=/tmp/source true\nWORKDIR /tmp/workspace',
    ),
    source.replace(
      'WORKDIR /tmp/workspace',
      'COPY services/platform/app /app/leaked\nWORKDIR /tmp/workspace',
    ),
    source.replace(
      'WORKDIR /tmp/workspace',
      'ADD services/platform/app /app/leaked\nWORKDIR /tmp/workspace',
    ),
    source.replace(
      'WORKDIR /tmp/workspace',
      'RUN --mount=type=bind,target=/tmp/source true\nWORKDIR /tmp/workspace',
    ),
    source.replace(
      'WORKDIR /tmp/workspace',
      'RUN --mount=source=services/platform/app,target=/tmp/source true\nWORKDIR /tmp/workspace',
    ),
    source.replace(
      'WORKDIR /tmp/workspace',
      'RUN --mount=target=/tmp/source true\nWORKDIR /tmp/workspace',
    ),
    source.replace(
      'WORKDIR /tmp/workspace',
      'RUN --mount=type=bind,from=,target=/tmp/source true\nWORKDIR /tmp/workspace',
    ),
    source.replace(
      'WORKDIR /tmp/workspace',
      'COPY --from=4 /app/services/platform/app /app/leaked\nWORKDIR /tmp/workspace',
    ),
    source.replace(
      'WORKDIR /tmp/workspace',
      'RUN --mount=type=cache,from=builder,target=/tmp/source true\nWORKDIR /tmp/workspace',
    ),
    source.replace(
      'WORKDIR /tmp/workspace',
      'RUN --mount=type="bind",target=/tmp/source true\nWORKDIR /tmp/workspace',
    ),
    source.replace(
      'WORKDIR /tmp/workspace',
      'RUN --mount=type=bind,from=external-source,target=/tmp/source true\nWORKDIR /tmp/workspace',
    ),
  ])(
    'rejects source ancestry or source reads in the dependency branch (%#)',
    (mutated) => {
      expect(() => assertPrunerClosure(mutated)).toThrow();
    },
  );

  it('preserves the builder bare toolchain and production install environment', () => {
    for (const stage of ['builder', 'pruner']) {
      expect(
        all.find(
          (instruction) =>
            instruction.stage === stage && instruction.keyword === 'FROM',
        )?.args,
      ).toBe(`bun-base AS ${stage}`);
    }
    expect(
      all
        .filter((instruction) => instruction.stage === 'bun-base')
        .map((instruction) => `${instruction.keyword} ${instruction.args}`),
    ).toEqual([
      'FROM debian:bookworm-slim AS bun-base',
      'COPY --from=bun-bin /usr/local/bin/bun /usr/local/bin/bun',
      'RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx',
      'WORKDIR /app',
    ]);
    for (const stage of ['builder', 'pruner']) {
      expect(
        all
          .filter(
            (instruction) =>
              instruction.stage === stage && instruction.keyword === 'ENV',
          )
          .map((instruction) => instruction.args),
      ).toEqual(['NODE_ENV=production']);
    }
  });

  function assertRunnerClosure(dockerfile: string): void {
    const parsed = parseInstructions(dockerfile);
    expect(
      parsed
        .filter(
          (instruction) =>
            instruction.stage === 'runner' && instruction.keyword === 'WORKDIR',
        )
        .map((instruction) => instruction.args),
    ).toEqual(['/app']);
    // Runtime workspace symlinks need the full package sources in the builder.
    for (const name of ['shared', 'ui']) {
      expect(
        parsed.some(
          (instruction) =>
            instruction.stage === 'builder' &&
            instruction.keyword === 'COPY' &&
            instruction.args === `packages/${name} ./packages/${name}`,
        ),
      ).toBe(true);
    }
    const expected = [
      ['dist', './dist'],
      ['dist-seo', './dist-seo'],
      ['server.ts', './'],
      ['telemetry.ts', './'],
      ['sla-targets.ts', './'],
      ['status-probe.ts', './'],
      ['lib', './lib'],
      ['backend', './backend'],
      ['messages', './messages'],
      ['package.json', './'],
      ['docker-entrypoint.sh', './'],
      ['env.sh', './'],
    ].map(
      ([file, destination]) =>
        `builder app:app /app/services/platform/${file} ${destination}`,
    );
    expected.push(
      'builder app:app /app/packages ./packages',
      'pruner app:app /app/node_modules ./node_modules',
      'bun-bin - /usr/local/bin/bun /usr/local/bin/bun',
      'node-bin - /usr/local/bin/node /usr/local/bin/node',
      'context app:app services/db/migrations/knowledge-db ./db/migrations/knowledge-db',
      'context app:app configs/platform/system/ /app/system/',
      'context app:app configs/platform/custom/ /app/builtin/',
    );
    const actual = parsed
      .filter(
        (instruction) =>
          instruction.stage === 'runner' &&
          ['COPY', 'ADD'].includes(instruction.keyword),
      )
      .flatMap((instruction) => {
        const words = instruction.args.split(/\s+/);
        const from = words
          .find((word) => word.startsWith('--from='))
          ?.slice('--from='.length);
        const owner = words
          .find((word) => word.startsWith('--chown='))
          ?.slice('--chown='.length);
        const paths = words.filter((word) => !word.startsWith('--'));
        const destination = paths.at(-1);
        return paths
          .slice(0, -1)
          .map(
            (file) =>
              `${from ?? 'context'} ${owner ?? '-'} ${file} ${destination}`,
          );
      });
    expect(actual.sort()).toEqual(expected.sort());
  }

  it('ships complete builder sources and packages with only pruned production dependencies', () => {
    assertRunnerClosure(source);
  });

  it.each([
    source.replace(
      'FROM debian:bookworm-slim AS runner',
      'FROM debian:bookworm-slim AS runner\nWORKDIR /tmp/runtime',
    ),
    source.replace(
      '--from=builder --chown=app:app /app/packages',
      '--from=pruner --chown=app:app /app/packages',
    ),
    source.replace(
      '--from=pruner --chown=app:app /app/node_modules',
      '--from=builder --chown=app:app /app/node_modules',
    ),
    source.replace(
      '--from=builder --chown=app:app /app/services/platform/lib',
      '--from=builder /app/services/platform/lib',
    ),
    source.replace(
      'COPY packages/shared ./packages/shared',
      'COPY packages/shared/package.json ./packages/shared/',
    ),
    source.replace(
      'RUN chmod +x ./docker-entrypoint.sh',
      'COPY services/platform/lib ./lib\nRUN chmod +x ./docker-entrypoint.sh',
    ),
  ])('rejects incomplete or unowned runtime copies (%#)', (mutated) => {
    expect(() => assertRunnerClosure(mutated)).toThrow();
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

describe('sandbox-runtime: independently cached toolchains', () => {
  const source = instructions(SANDBOX_RUNTIME_DOCKERFILE);
  const pins = [
    ['claude-build', 'CLAUDE_CODE_VERSION'],
    ['opencode-build', 'OPENCODE_VERSION'],
    ['cursor-build', 'CURSOR_AGENT_VERSION'],
    ['hermes-build', 'HERMES_AGENT_VERSION'],
    ['gemini-build', 'GEMINI_CLI_VERSION'],
    ['codex-build', 'CODEX_VERSION'],
    ['pi-build', 'PI_CODING_AGENT_VERSION'],
    ['openclaw-build', 'OPENCLAW_VERSION'],
    ['qwen-build', 'QWEN_CODE_VERSION'],
    ['playwright-build', 'PLAYWRIGHT_MCP_VERSION'],
    ['gh-build', 'GH_VERSION'],
    ['vision-build', 'PILLOW_VERSION'],
  ];
  const base = source.filter((item) => item.stage === 'tooling-base');
  const stageNames = new Set(
    source.filter((item) => item.keyword === 'FROM').map((item) => item.stage),
  );

  /**
   * Every stage of this Dockerfile that `stage` builds on: its FROM chain and
   * the stages it copies or mounts from. External images are leaves.
   */
  function reachedStages(stage: string, reached = new Set<string>()) {
    if (!stageNames.has(stage) || reached.has(stage)) return reached;
    reached.add(stage);
    for (const item of source.filter((entry) => entry.stage === stage)) {
      const words = item.args.trim().split(/\s+/);
      if (item.keyword === 'FROM') {
        reachedStages(
          words.find((word) => !word.startsWith('--')) ?? '',
          reached,
        );
      }
      for (const word of words) {
        const from = /(?:^--from=|[,=]from=)([^,\s]+)/.exec(word)?.[1];
        if (from !== undefined) reachedStages(from, reached);
      }
    }
    return reached;
  }

  /** The runtime stage's COPYs of what `stage` built. */
  function runtimeCopies(stage: string): Instruction[] {
    return source.filter(
      (item) =>
        item.stage === 'runtime' &&
        item.keyword === 'COPY' &&
        item.args.includes(`--from=${stage} `),
    );
  }

  it('keeps version pins out of the shared OS and document layers', () => {
    expect(base.some((item) => item.keyword === 'FROM')).toBe(true);
    expect(
      base.filter((item) => item.keyword === 'ARG').map((item) => item.args),
    ).toEqual(['TARGETARCH']);
    for (const tool of ['libreoffice-writer', 'texlive-xetex', 'docker-ce']) {
      expect(
        base.some((item) => item.keyword === 'RUN' && item.args.includes(tool)),
      ).toBe(true);
    }
    expect(
      source.find((item) => item.stage === 'runtime' && item.keyword === 'FROM')
        ?.args,
    ).toBe('tooling-base AS runtime');
  });

  // An ENV changes the cache key of every RUN after it: one in the OS chain
  // rebuilt every apt set below it and every stage built on them.
  it('keeps environment variables out of the OS chain', () => {
    expect(base.filter((item) => item.keyword === 'ENV')).toEqual([]);
  });

  it('runs the apt sets from the stablest to the most often extended', () => {
    const installs = base.filter(
      (item) => item.keyword === 'RUN' && item.args.includes('apt-get install'),
    );
    const position = (pkg: string) =>
      installs.findIndex((item) => item.args.includes(` ${pkg} `));
    const order = [
      'fonts-noto-cjk',
      'libreoffice-writer',
      'texlive-xetex',
      'docker-ce',
      'openssh-client',
    ].map(position);
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(new Set(order).size).toBe(order.length);
    expect(order.at(-1)).toBe(installs.length - 1);
  });

  it.each(pins)(
    'isolates %s from every other version pin and from the OS chain',
    (stage, pin) => {
      expect(
        source
          .filter(
            (item) => item.keyword === 'ARG' && item.args.startsWith(`${pin}=`),
          )
          .map((item) => item.stage),
      ).toEqual([stage]);
      expect(reachedStages(stage).has('tooling-base')).toBe(false);
      const copies = runtimeCopies(stage);
      expect(copies.length).toBeGreaterThan(0);
      expect(copies.every((item) => item.args.startsWith('--link '))).toBe(
        true,
      );
    },
  );

  it.each(['document-python-build', 'document-node-build'])(
    'installs %s outside the OS chain, as layers of their own',
    (stage) => {
      expect(reachedStages(stage).has('tooling-base')).toBe(false);
      const copies = runtimeCopies(stage);
      expect(copies.length).toBeGreaterThan(0);
      expect(copies.every((item) => item.args.startsWith('--link '))).toBe(
        true,
      );
    },
  );

  it('reaches the OS chain from nothing but the runtime stage', () => {
    const builtOnBase = [...stageNames].filter(
      (stage) =>
        stage !== 'tooling-base' && reachedStages(stage).has('tooling-base'),
    );
    expect(builtOnBase).toEqual(['runtime']);
  });

  it('exports the complete private Hermes prefix, including wheel data files', () => {
    expect(runtimeCopies('hermes-build').map((item) => item.args)).toEqual([
      '--link --from=hermes-build /opt/tale-hermes/ /usr/local/',
    ]);
  });
});

describe('sandbox-runtime: the container engine install fails closed', () => {
  const command = runCommand(
    SANDBOX_RUNTIME_DOCKERFILE,
    'tooling-base',
    'docker-ce',
  );
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
