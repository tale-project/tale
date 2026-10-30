import { afterEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import {
  DECLARED_CHECKS,
  README,
  compare,
  declaredChecksText,
  describe as describeGenerated,
  main,
  mirrorProblems,
  readDeclaredChecks,
  readSources,
  runnerCheck,
  writeGenerated,
  type Io,
} from './forgejo-port';
import { generate } from './forgejo-port/generate';
import { planGithubEdits } from './forgejo-port/github-edits';
import { MANIFEST, type Manifest } from './forgejo-port/manifest';
import { pinnedRunner } from './forgejo-port/runner';
import type { Problem } from './forgejo-port/validate';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SHA = 'a'.repeat(40);

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), 'forgejo-port-test-'));
  temporary.push(directory);
  return directory;
}

function put(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** A workflow the runner reads: the second job needs the first. */
const PROBE = `name: Probe
on:
  push:
jobs:
  first:
    runs-on: ubuntu-latest
    steps:
      - run: echo first
  second:
    needs: [first]
    runs-on: ubuntu-latest
    steps:
      - run: echo second
`;

const CHECKS = `name: Checks
on:
  push:
  pull_request:
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: echo lint
  format:
    name: Format
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@${SHA}
        with:
          persist-credentials: false
          fetch-depth: 2
      - name: Refuse links that do not land
        run: bun run lint:links
  ci-ready:
    name: CI ready (Checks)
    needs: [lint, format]
    if: always() && github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - name: Checkout verdict policy
        uses: actions/checkout@${SHA}
      - name: Evaluate native workflow
        uses: ./.github/actions/ci-ready
`;

const PUBLISH = `name: Publish packages
on:
  workflow_dispatch:
jobs:
  publish:
    name: Publish \${{ matrix.package }}
    runs-on: ubuntu-latest
    steps:
      - run: echo publish
`;

const SMALL: Manifest = {
  registry: { host: 'git.example.test', tokenSecret: 'CI_PACKAGES_TOKEN' },
  githubApiTokenSecret: 'CI_GITHUB_TOKEN',
  labels: ['ubuntu-latest'],
  composites: [],
  scripts: [],
  workflows: { 'publish-packages.yml': { kind: 'github', why: 'stays' } },
  githubEdits: [
    {
      file: 'publish-packages.yml',
      find: '  publish:\n    name: Publish ${{ matrix.package }}\n',
      replace:
        "  publish:\n    name: Publish ${{ matrix.package }}\n    if: vars.TALE_SOURCE != 'forgejo'\n",
      why: 'it publishes nothing once Forgejo is the source',
    },
  ],
};

function repository(): string {
  const root = scratch();
  put(root, '.github/workflows/checks.yml', CHECKS);
  put(root, '.github/workflows/publish-packages.yml', PUBLISH);
  put(root, README, '| Mirrors | `actions/checkout` |\n');
  return root;
}

function run(root: string, ...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    cwd: root,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  };
  const code = main(['--root', root, ...argv], io, SMALL);
  return { code, out, err };
}

describe('readSources', () => {
  test('reads the workflows, the composite actions and the files the manifest names', () => {
    const root = repository();
    put(root, '.github/actions/setup-turbo/action.yml', 'name: x\n');
    put(root, '.github/actions/notes.md', 'not an action\n');
    put(root, '.github/workflows/readme.md', 'not a workflow\n');
    put(root, '.github/scripts/pull.sh', '#!/bin/sh\n');
    const sources = readSources(root, {
      ...SMALL,
      scripts: [{ from: '.github/scripts/pull.sh', to: 'x', edits: [] }],
    });
    expect([...sources.workflows.keys()].toSorted()).toEqual([
      'checks.yml',
      'publish-packages.yml',
    ]);
    expect([...sources.actions.keys()]).toEqual(['setup-turbo']);
    expect([...sources.files.keys()]).toEqual(['.github/scripts/pull.sh']);
  });

  test('reads nothing from a repository that has no .github', () => {
    const sources = readSources(scratch(), SMALL);
    expect(sources.workflows.size).toBe(0);
    expect(sources.actions.size).toBe(0);
  });
});

describe('describe, compare and writeGenerated', () => {
  test('say what the port did, and what is on disk against it', () => {
    const root = repository();
    const generated = generate(readSources(root, SMALL), SMALL);
    const lines = describeGenerated(generated);
    expect(lines.join('\n')).toContain(
      'checks.yml: ported; on push, pull_request; 3 jobs',
    );
    expect(lines.join('\n')).toContain('publish-packages.yml: github; stays');
    expect(lines).toContain('  Checks / CI ready (Checks)');
    expect(lines).toContain('Problems: 0');

    expect([...compare(root, generated).files]).toEqual([
      ['.forgejo/workflows/checks.yml', 'new'],
    ]);
    writeGenerated(root, generated);
    expect(
      compare(root, generated).files.get('.forgejo/workflows/checks.yml'),
    ).toBe('same');
    put(root, '.forgejo/workflows/checks.yml', 'name: edited\n');
    put(root, '.forgejo/workflows/old.yml', 'name: old\n');
    const after = compare(root, generated);
    expect(after.files.get('.forgejo/workflows/checks.yml')).toBe('changed');
    expect(after.stale).toEqual(['.forgejo/workflows/old.yml']);
    writeGenerated(root, generated, after.stale);
    expect(existsSync(join(root, '.forgejo/workflows/old.yml'))).toBe(false);
  });
});

describe('the command line', () => {
  test('report prints the plan and succeeds', () => {
    const { code, out } = run(repository(), 'report');
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('checks.yml: ported');
  });

  test('checks prints the declared checks, and writes them on request', () => {
    const root = repository();
    expect(run(root, 'checks').out.join('\n')).toContain(
      'Checks / CI ready (Checks)',
    );
    expect(run(root, 'checks', '--write').out).toEqual([
      `wrote ${DECLARED_CHECKS}`,
    ]);
    expect(readDeclaredChecks(root)).toEqual(['Checks / CI ready (Checks)']);
    expect(readFileSync(join(root, DECLARED_CHECKS), 'utf8')).toBe(
      declaredChecksText(['Checks / CI ready (Checks)']),
    );
  });

  test('check fails until the declared checks are the generated ones', () => {
    const root = repository();
    const missing = run(root, 'check');
    expect(missing.code).toBe(1);
    expect(missing.err.join('\n')).toContain('is not what the port generates');
    run(root, 'checks', '--write');
    const fine = run(root, 'check');
    expect(fine.code).toBe(0);
    expect(fine.out).toEqual(['ok: 1 files, 1 checks']);
    put(root, DECLARED_CHECKS, '- Something else\n');
    expect(run(root, 'check').code).toBe(1);
  });

  test('check also fails on a declared-checks.yml whose header has drifted, not only its list', () => {
    const root = repository();
    run(root, 'checks', '--write');
    const text = readFileSync(join(root, DECLARED_CHECKS), 'utf8');
    expect(text).toContain("the checks Forgejo's protection of main requires");
    put(root, DECLARED_CHECKS, text.replace('of main', 'of trunk'));
    const drifted = run(root, 'check');
    expect(drifted.code).toBe(1);
    expect(drifted.err.join('\n')).toContain('is not what the port generates');
  });

  test('check fails on an action the README does not list among the mirrors', () => {
    const root = repository();
    run(root, 'checks', '--write');
    expect(run(root, 'check').code).toBe(0);
    put(root, README, '| Mirrors | `actions/setup-node` |\n');
    const unlisted = run(root, 'check');
    expect(unlisted.code).toBe(1);
    expect(unlisted.err.join('\n')).toContain(
      'does not list `actions/checkout`',
    );
    rmSync(join(root, README));
    expect(run(root, 'check').err.join('\n')).toContain('is missing');
  });

  test('check says when an edit of a workflow that stays has lost its place', () => {
    const root = repository();
    run(root, 'checks', '--write');
    put(
      root,
      '.github/workflows/publish-packages.yml',
      'name: Publish packages\non:\n  push:\njobs: {}\n',
    );
    const { code, err } = run(root, 'check');
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('holds the lines of the edit nowhere');
  });

  test('generate compares the link check with the merge base with the branch a pull request targets, and check fails when its step is no longer the one the rule finds', () => {
    const root = repository();
    const generated = generate(readSources(root, SMALL), SMALL);
    const text = generated.files.get('.forgejo/workflows/checks.yml') ?? '';
    expect(text).toContain('LINT_LINKS_BASE="$base" bun run lint:links');
    expect(text).toContain('git merge-base HEAD "origin/$GITHUB_BASE_REF"');
    expect(text).toContain('fetch-depth: 0');
    expect(text).not.toContain('fetch-depth: 2');
    run(root, 'checks', '--write');
    expect(run(root, 'check').code).toBe(0);

    // the step is edited, so the rule finds nothing to change: the file would keep `HEAD^1` and a shallow checkout
    put(
      root,
      '.github/workflows/checks.yml',
      CHECKS.replace(
        'run: bun run lint:links',
        'run: bun run lint:links --verbose',
      ),
    );
    const lost = run(root, 'check');
    expect(lost.code).toBe(1);
    expect(lost.err.join('\n')).toContain(
      'the step `run: bun run lint:links` after a checkout is gone',
    );
    expect(
      generate(readSources(root, SMALL), SMALL).files.get(
        '.forgejo/workflows/checks.yml',
      ),
    ).toContain('fetch-depth: 2');
    expect(run(root, 'report').code).toBe(0);
  });

  test('check fails on a local action the port leaves as the GitHub copy, and says which', () => {
    const root = repository();
    run(root, 'checks', '--write');
    expect(run(root, 'check').code).toBe(0);
    put(
      root,
      '.github/workflows/checks.yml',
      CHECKS.replace(
        '      - run: echo lint\n',
        '      - uses: ./.github/actions/brand-new\n',
      ),
    );
    const unported = run(root, 'check');
    expect(unported.code).toBe(1);
    expect(unported.err.join('\n')).toContain(
      '`./.github/actions/brand-new` is not ported',
    );
    expect(run(root, 'report').code).toBe(0);
  });

  test('generate is a dry run until --write, and refuses a port with problems', () => {
    const root = repository();
    const dry = run(root, 'generate');
    expect(dry.code).toBe(0);
    expect(dry.out).toContain('new     .forgejo/workflows/checks.yml');
    expect(dry.out.at(-1)).toContain('dry run');
    expect(existsSync(join(root, '.forgejo'))).toBe(false);

    const out = scratch();
    expect(run(root, 'generate', '--write', '--out', out).code).toBe(0);
    expect(existsSync(join(out, '.forgejo/workflows/checks.yml'))).toBe(true);
    expect(existsSync(join(root, '.forgejo'))).toBe(false);

    put(
      root,
      '.github/workflows/checks.yml',
      CHECKS.replace('ubuntu-latest', 'macos-latest'),
    );
    const refused = run(root, 'generate', '--write');
    expect(refused.code).toBe(1);
    expect(refused.err.join('\n')).toContain('not generating');
  });

  test('generate --write refuses to overwrite or delete what it may not have made, unless forced', () => {
    const root = repository();
    const out = scratch();
    const path = '.forgejo/workflows/checks.yml';
    expect(run(root, 'generate', '--write', '--out', out).code).toBe(0);
    expect(run(root, 'generate', '--write', '--out', out).code).toBe(0);

    put(out, path, 'name: edited by hand\n');
    put(out, '.forgejo/workflows/renovate.yml', 'name: renovate\n');
    const refused = run(root, 'generate', '--write', '--out', out);
    expect(refused.code).toBe(1);
    expect(refused.out).toContain(`changed ${path}`);
    expect(refused.out).toContain('stale   .forgejo/workflows/renovate.yml');
    expect(refused.err.join('\n')).toContain('pass --force');
    expect(readFileSync(join(out, path), 'utf8')).toBe(
      'name: edited by hand\n',
    );
    expect(existsSync(join(out, '.forgejo/workflows/renovate.yml'))).toBe(true);
    expect(run(root, 'generate', '--out', out).code).toBe(0);

    const forced = run(root, 'generate', '--write', '--force', '--out', out);
    expect(forced.code).toBe(0);
    expect(readFileSync(join(out, path), 'utf8')).toContain('name: Checks');
    expect(existsSync(join(out, '.forgejo/workflows/renovate.yml'))).toBe(
      false,
    );
  });

  test('github shows the edit and makes it, once', () => {
    const root = repository();
    const dry = run(root, 'github');
    expect(dry.out[0]).toContain(
      'pending .github/workflows/publish-packages.yml',
    );
    expect(
      readFileSync(
        join(root, '.github/workflows/publish-packages.yml'),
        'utf8',
      ),
    ).toBe(PUBLISH);
    expect(run(root, 'github', '--write').out.at(-1)).toBe('wrote 1 files');
    expect(
      readFileSync(
        join(root, '.github/workflows/publish-packages.yml'),
        'utf8',
      ),
    ).toContain("    if: vars.TALE_SOURCE != 'forgejo'\n");
    const again = run(root, 'github', '--write');
    expect(again.out[0]).toContain('applied');
    expect(again.out.at(-1)).toBe('wrote 0 files');
  });

  test('has no tier to choose: every pull request owes the whole suite', () => {
    const root = repository();
    const tier = run(root, 'report', '--tier', 'full');
    expect(tier.code).toBe(2);
    expect(tier.err.join('\n')).toContain('--tier');
  });

  test('refuses what it does not know', () => {
    const root = repository();
    expect(run(root, 'nonsense').code).toBe(2);
    expect(run(root, 'report', 'extra').code).toBe(2);
    const bad = run(root, '--no-such-flag');
    expect(bad.code).toBe(2);
    expect(bad.err.length).toBe(1);
  });
});

describe("Tale's own workflows", () => {
  const sources = readSources(ROOT);

  test('are ported without the port failing, and the checks a pull request waits for are the ones listed', () => {
    const generated = generate(sources);
    expect(generated.checks.length).toBeGreaterThan(0);
    expect(
      generated.checks,
      'declared-checks.yml is stale: run `bun tools/cli/scripts/forgejo-port.ts checks --write`',
    ).toEqual(readDeclaredChecks(ROOT) ?? []);
    for (const path of generated.files.keys())
      expect(path.startsWith('.forgejo/')).toBe(true);
  });

  test('land each pull request on its own: a push is one to main, a verdict is for a pull request', () => {
    const generated = generate(sources);
    const ready: string[] = [];
    for (const [path, text] of generated.files) {
      if (!path.startsWith('.forgejo/workflows/')) continue;
      const doc = parse(text) as {
        on?: { push?: { branches?: string[] } | null };
        jobs?: Record<
          string,
          { if?: string; steps?: { env?: Record<string, unknown> }[] }
        >;
      };
      const branches = doc.on?.push?.branches;
      if (branches !== undefined) expect(branches, path).toEqual(['main']);
      const job = doc.jobs?.['ci-ready'];
      if (!job) continue;
      ready.push(path);
      expect(job.if, path).toBe(
        "always() && github.event_name == 'pull_request'",
      );
      for (const step of job.steps ?? [])
        expect(Object.keys(step.env ?? {}), path).not.toContain('CI_TIER');
    }
    expect(ready.length).toBe(generated.checks.length);
  });

  test('say what Forgejo would refuse, without holding a workflow edited today to a port applied at the cut-over', () => {
    const generated = generate(sources);
    const edits = planGithubEdits(sources.workflows, MANIFEST);
    for (const problem of [...generated.problems, ...edits.problems])
      console.warn(
        `forgejo-port: ${problem.file} ${problem.at}: ${problem.message}`,
      );
    for (const warning of generated.report.warnings)
      console.warn(
        `forgejo-port: ${warning.file} ${warning.at}: ${warning.detail}`,
      );
    expect(generated.outcomes.length).toBe(sources.workflows.size);
  });

  test('are described in the README, one row for each that does not move', () => {
    const readme = readFileSync(
      join(ROOT, 'tools/cli/scripts/forgejo-port/README.md'),
      'utf8',
    );
    for (const file of Object.keys(MANIFEST.workflows))
      expect(readme, file).toContain(`\`${file}\``);
    for (const edit of MANIFEST.githubEdits)
      expect(readme, edit.file).toContain(`\`${edit.file}\``);
  });

  test('say which actions the README does not list among the mirrors, without holding a workflow edited today to it', () => {
    for (const problem of mirrorProblems(ROOT, generate(sources)))
      console.warn(
        `forgejo-port: ${problem.file} ${problem.at}: ${problem.message}`,
      );
    expect(existsSync(join(ROOT, README))).toBe(true);
  });

  test('is either ported or given a reason, and the files the manifest names exist', () => {
    const generated = generate(sources);
    expect(
      generated.outcomes.map((outcome) => outcome.file).toSorted(),
    ).toEqual([...sources.workflows.keys()].toSorted());
    for (const outcome of generated.outcomes) {
      if (outcome.plan.kind === 'port') continue;
      expect(outcome.plan.why.length).toBeGreaterThan(20);
      expect(generated.files.has(`.forgejo/workflows/${outcome.file}`)).toBe(
        false,
      );
    }
    for (const name of MANIFEST.composites)
      expect(sources.actions.has(name)).toBe(true);
    for (const script of MANIFEST.scripts)
      expect(sources.files.has(script.from)).toBe(true);
  });

  test('are read by the pinned forgejo-runner, and a broken file is not', async () => {
    const runner =
      process.env.FORGEJO_RUNNER ??
      (await pinnedRunner(
        join(tmpdir(), `forgejo-port-runner-${process.getuid?.() ?? 'user'}`),
      ));
    if (runner === undefined) {
      console.warn(
        'forgejo-port: no forgejo-runner to check against (set FORGEJO_RUNNER, or run on linux/amd64)',
      );
      return;
    }
    const generated = generate(sources);
    for (const problem of runnerCheck(runner, generated))
      console.warn(
        `forgejo-port: the pinned runner: ${problem.at}: ${problem.message}`,
      );

    // The instrument can fail: a key the schema does not know, and a job that needs a job that is
    // not there. The probes are a workflow of their own, so that no edit of a workflow under
    // `.github/` changes what they prove.
    const probe = '.forgejo/workflows/probe.yml';
    const planned = (text: string): Problem[] =>
      runnerCheck(runner, {
        ...generated,
        files: new Map([[probe, text]]),
      }).filter((problem) => problem.at === probe);
    expect(planned(PROBE)).toEqual([]);
    expect(planned(PROBE.replace('runs-on:', 'runs-onn:'))).not.toEqual([]);
    expect(
      planned(PROBE.replace('needs: [first]', 'needs: [nowhere]')),
    ).not.toEqual([]);
  }, 120_000);
});
