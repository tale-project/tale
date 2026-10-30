import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parse } from 'yaml';

import { buildCache } from './cache';
import type { Rule } from './context';
import { portWorkflow } from './port';
import { emptyReport } from './workflow';
import {
  dropForeignRows,
  dropJobs,
  githubApiToken,
  lintLinksBase,
  movePaths,
  ownPath,
  publishOnTag,
  publishRemote,
  readyJob,
  recordRemoved,
  runUrls,
} from './workflow-rules';

const SHA = 'a'.repeat(40);

function run(
  source: string,
  rules: readonly Rule[],
  file = 'w.yml',
  after: readonly Rule[] = [],
) {
  const report = emptyReport();
  const result = portWorkflow(source, file, report, { rules, after });
  return { ...result, report };
}

describe('readyJob', () => {
  const SOURCE = `name: Checks
on:
  push:
  pull_request:
jobs:
  candidate-source:
    if: github.event_name == 'repository_dispatch'
    uses: ./.github/workflows/release-candidate-source.yml
  lint:
    needs: candidate-source
    runs-on: ubuntu-latest
    steps:
      - run: echo lint
  ci-ready:
    name: CI ready (Checks)
    if: always() && github.event_name == 'pull_request'
    needs: [candidate-source, lint]
    runs-on: ubuntu-latest
    timeout-minutes: 3
    permissions:
      contents: read
    steps:
      - name: Checkout verdict policy
        uses: actions/checkout@${SHA} # v6
        with:
          persist-credentials: false
          sparse-checkout: |
            /.github/actions/ci-ready/action.yml
            /tools/cli/scripts/ci-ready.ts
          sparse-checkout-cone-mode: false
      - name: Evaluate native workflow
        uses: ./.github/actions/ci-ready
        with:
          workflow: checks
          jobs: \${{ toJSON(needs) }}
`;

  test("judges a pull request's needs with Tale's policy", () => {
    const { text, jobs } = run(SOURCE, [readyJob], 'checks.yml', [
      recordRemoved,
    ]);
    expect(jobs).toEqual(['lint', 'ci-ready']);
    expect(text).toContain(
      "if: always() && github.event_name == 'pull_request'",
    );
    expect(text).toContain('needs: [lint]');
    expect(text).toContain('CI_WORKFLOW: checks');
    expect(text).not.toContain('CI_TIER');
    expect(text).toContain('CI_NEEDS: ${{ toJSON(needs) }}');
    expect(text).toContain('run: bun tools/cli/scripts/forgejo-port/ready.ts');
    expect(text).toContain(`uses: actions/checkout@${SHA} # v6`);
    expect(text).not.toContain('permissions');
    expect(text).not.toContain('ci-ready/action.yml');
  });

  test('says which jobs of the GitHub workflow are gone, and what each would have reported to a pull request', () => {
    const { text } = run(SOURCE, [readyJob], 'checks.yml', [recordRemoved]);
    const recorded = /CI_PORT_REMOVED: \|\n([\s\S]*?)\n\s*run:/.exec(text);
    expect(JSON.parse(recorded?.[1] ?? 'null')).toEqual({
      'candidate-source': { result: 'skipped', outputs: {} },
    });
  });

  test('leaves a job it does not recognise alone, and says when it cannot rewrite', () => {
    const odd = `name: X
on:
  pull_request:
jobs:
  ci-ready:
    name: Something else
    runs-on: ubuntu-latest
    steps:
      - run: echo
`;
    expect(run(odd, [readyJob]).text).toContain('Something else');
    const noCheckout = SOURCE.replace(
      / {6}- name: Checkout verdict policy[\s\S]*?cone-mode: false\n/,
      '',
    );
    expect(
      run(noCheckout, [readyJob], 'checks.yml').report.warnings.map(
        (w) => w.rule,
      ),
    ).toEqual(['ready']);
  });
});

describe('dropJobs', () => {
  test('removes a job the port cannot run and lets the jobs that needed it see it skipped', () => {
    const { text, removed } = run(
      `name: CLI
on:
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo build
  release:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: gh release upload
  after:
    needs: [build, release]
    if: always() && needs.release.result == 'skipped'
    runs-on: ubuntu-latest
    steps:
      - run: echo after
`,
      [dropJobs([{ id: 'release', why: 'uses gh' }])],
    );
    expect(text).not.toContain('gh release');
    expect(text).toContain('needs: [build]');
    expect(text).toContain('if: always()');
    expect(removed.get('release')).toBe('uses gh');
  });
});

describe('dropForeignRows', () => {
  const CLI = `name: CLI
on:
  pull_request:
jobs:
  build:
    runs-on: \${{ matrix.os }}
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            platform: linux
          - os: macos-latest
            platform: macos
          - os: windows-latest
            platform: windows
          - os: ubuntu-latest
            platform: linux-arm64
    steps:
      - run: echo \${{ matrix.platform }}
`;

  test('removes the rows whose runner the pool does not have', () => {
    const { text, report } = run(CLI, [
      dropForeignRows(['ubuntu-latest', 'ubuntu-24.04']),
    ]);
    expect(text).toContain('platform: linux');
    expect(text).toContain('platform: linux-arm64');
    expect(text).not.toContain('macos');
    expect(text).not.toContain('windows');
    expect(
      report.changes.filter((change) => change.rule === 'matrix-row'),
    ).toHaveLength(2);
  });

  test('leaves a job with a plain label alone', () => {
    const { report } = run(CLI.replace('${{ matrix.os }}', 'ubuntu-latest'), [
      dropForeignRows(['ubuntu-latest']),
    ]);
    expect(report.changes).toEqual([]);
  });
});

describe('lintLinksBase', () => {
  const SOURCE = `name: Checks
on:
  pull_request:
jobs:
  format:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@${SHA} # v6
        with:
          persist-credentials: false
          # lint:links compares a change with HEAD^1 (a pull request's merge
          # commit has the base branch as its first parent).
          fetch-depth: 2
      - name: Refuse links that do not land
        run: bun run lint:links
`;

  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0))
      rmSync(root, { recursive: true, force: true });
  });

  /** A repository with the commits a Forgejo run sees: main, and a branch of two commits off it. */
  function repository() {
    const root = mkdtempSync(join(tmpdir(), 'forgejo-port-links-'));
    roots.push(root);
    const config = join(root, 'gitconfig');
    writeFileSync(config, '');
    const env = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => !name.startsWith('GIT_'),
        ),
      ),
      GIT_CONFIG_GLOBAL: config,
      GIT_CONFIG_NOSYSTEM: '1',
    };
    const work = join(root, 'work');
    const git = (...args: string[]): string => {
      const result = spawnSync(
        'git',
        [
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=f@example.invalid',
          ...args,
        ],
        { cwd: work, env, encoding: 'utf8' },
      );
      if (result.status !== 0)
        throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
      return result.stdout.trim();
    };
    spawnSync('git', ['init', '--quiet', '--initial-branch', 'main', work], {
      env,
    });
    const commit = (name: string): string => {
      writeFileSync(join(work, name), `${name}\n`);
      git('add', '--all');
      git('commit', '--quiet', '-m', name);
      return git('rev-parse', 'HEAD');
    };
    return { work, env, git, commit };
  }

  test('compares a pull request with the merge base with main, with the history to find it', () => {
    const { text, report } = run(SOURCE, [lintLinksBase], 'checks.yml');
    expect(text).toContain('fetch-depth: 0');
    expect(text).not.toContain('fetch-depth: 2');
    expect(text).not.toContain('compares a change with HEAD^1');
    expect(text).toContain('if [ "$GITHUB_EVENT_NAME" = pull_request ]; then');
    expect(text).toContain('LINT_LINKS_BASE="$base" bun run lint:links');
    expect(report.changes.map((change) => change.rule)).toEqual([
      'lint-links-base',
    ]);
  });

  /** What the step runs, with lint:links itself replaced by what it would be given. */
  function probe(): string {
    const { text } = run(SOURCE, [lintLinksBase], 'checks.yml');
    const steps = (
      parse(text) as { jobs: { format: { steps: { run?: string }[] } } }
    ).jobs.format.steps;
    const script = steps[1]?.run ?? '';
    const probed = script.replace(
      'bun run lint:links',
      `sh -c 'printf %s "$LINT_LINKS_BASE"'`,
    );
    expect(probed).not.toBe(script);
    return probed;
  }

  test('gives a pull request of two commits the commit it branched from', () => {
    const { work, env, git, commit } = repository();
    const main = commit('main.txt');
    git('update-ref', 'refs/remotes/origin/main', main);
    git('checkout', '--quiet', '-b', 'change');
    const first = commit('first.txt');
    commit('second.txt');
    const result = spawnSync('bash', ['-e', '-c', probe()], {
      cwd: work,
      env: {
        ...env,
        GITHUB_ACTIONS: 'true',
        GITHUB_EVENT_NAME: 'pull_request',
      },
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    // `HEAD^1` is the first commit, which hides what that commit retired.
    expect(git('rev-parse', 'HEAD^1')).toBe(first);
    expect(result.stdout).toBe(main);
  });

  test('gives a push to main the commit before it, as GitHub does', () => {
    const { work, env, git, commit } = repository();
    const before = commit('main.txt');
    const pushed = commit('retires-a-page.txt');
    git('update-ref', 'refs/remotes/origin/main', pushed);
    const result = spawnSync('bash', ['-e', '-c', probe()], {
      cwd: work,
      env: { ...env, GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    // The merge base of main with itself is the pushed commit, which retires nothing.
    expect(git('merge-base', 'HEAD', 'origin/main')).toBe(pushed);
    expect(result.stdout).toBe(before);
  });

  test('fails the step when there is no base to compare with', () => {
    const { text } = run(SOURCE, [lintLinksBase], 'checks.yml');
    const script =
      (parse(text) as { jobs: { format: { steps: { run?: string }[] } } }).jobs
        .format.steps[1]?.run ?? '';
    const { work, env, commit } = repository();
    commit('main.txt');
    // A pull request without main to branch from, and a push without a commit before it.
    for (const event of ['pull_request', 'push']) {
      const result = spawnSync(
        'bash',
        ['-e', '-c', script.replace('bun run lint:links', 'echo ran')],
        {
          cwd: work,
          env: { ...env, GITHUB_EVENT_NAME: event },
          encoding: 'utf8',
        },
      );
      expect(result.status, event).not.toBe(0);
      expect(result.stdout, event).not.toContain('ran');
    }
  });

  test('adds the history and the base where the checkout has no inputs, and says when the step is gone', () => {
    const bare = run(
      SOURCE.replace(/ {8}with:[\s\S]*?fetch-depth: 2\n/, ''),
      [lintLinksBase],
      'checks.yml',
    );
    expect(bare.text).toContain('fetch-depth: 0');
    const gone = run(
      SOURCE.replace('bun run lint:links', 'bun run lint:conflicts'),
      [lintLinksBase],
      'checks.yml',
    );
    expect(gone.report.warnings.map((warning) => warning.rule)).toEqual([
      'anchor',
    ]);
    expect(run(SOURCE, [lintLinksBase], 'other.yml').text).toContain(
      'fetch-depth: 2',
    );
  });
});

describe('publishRemote', () => {
  test('pushes to the Forgejo repository and prints the GitHub spec', () => {
    const { text } = run(
      `name: Publish
on:
  workflow_dispatch:
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: |
          REMOTE="https://x-access-token:\${GITHUB_TOKEN}@github.com/\${GITHUB_REPOSITORY}.git"
          echo "github:\${GITHUB_REPOSITORY}#dist/ui"
`,
      [publishRemote],
      'publish-packages.yml',
    );
    expect(text).toContain(
      '@${GITHUB_SERVER_URL#https://}/${GITHUB_REPOSITORY}.git',
    );
    expect(text).toContain('github:tale-project/tale#dist/ui');
    expect(text).not.toContain('github.com');
  });

  test('warns twice when both anchors are gone', () => {
    const { report } = run(
      `name: P\non:\n  push:\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n`,
      [publishRemote],
      'publish-packages.yml',
    );
    expect(report.warnings).toHaveLength(2);
  });
});

describe('publishOnTag', () => {
  const PUBLISH = `name: Publish packages
on:
  push:
    branches:
      - main
    paths:
      - 'packages/ui/**'
  workflow_dispatch:
    inputs:
      release_tag:
        required: false
        type: string
jobs:
  publish:
    name: Publish
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@${SHA}
        with:
          persist-credentials: false
      - name: Resolve snapshot tag
        id: tag
        env:
          REF: \${{ github.ref }}
          RELEASE_TAG: \${{ inputs.release_tag }}
          SOURCE_SHA: \${{ inputs.source_sha }}
        run: echo "$REF"
`;

  test("a release tag pins the snapshots from main's tooling and the tag's commit", () => {
    const { text, report } = run(
      PUBLISH,
      [publishOnTag],
      'publish-packages.yml',
    );
    // the branch and path filters still hold for main; a tag is matched on its own
    expect(text).toContain("tags: ['v*.*.*']");
    expect(text).toContain(
      '# A release tag pins the snapshot of its own commit.',
    );
    expect(text).toContain(
      "ref: ${{ startsWith(github.ref, 'refs/tags/') && 'main' || '' }}",
    );
    expect(text).toContain(
      "REF: ${{ startsWith(github.ref, 'refs/tags/') && 'refs/heads/main' || github.ref }}",
    );
    expect(text).toContain(
      "RELEASE_TAG: ${{ inputs.release_tag || startsWith(github.ref, 'refs/tags/') && github.ref_name || '' }}",
    );
    expect(text).toContain(
      "SOURCE_SHA: ${{ inputs.source_sha || startsWith(github.ref, 'refs/tags/') && github.sha || '' }}",
    );
    expect(report.changes.map((change) => change.rule)).toEqual([
      'publish-on-tag',
    ]);
  });

  test('says when the publisher is not the one it knows, and leaves it alone', () => {
    const odd = PUBLISH.replace(
      'REF: ${{ github.ref }}',
      'REF: refs/heads/main',
    );
    const { text, report } = run(odd, [publishOnTag], 'publish-packages.yml');
    expect(text).not.toContain('tags:');
    expect(report.warnings.map((warning) => warning.rule)).toEqual(['anchor']);
    expect(run(PUBLISH, [publishOnTag], 'other.yml').text).not.toContain(
      'tags:',
    );
  });
});

describe('small text rules', () => {
  test('run URLs use the run number', () => {
    const { text } = run(
      `name: B\non:\n  push:\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}\n`,
      [runUrls],
    );
    expect(text).toContain('/actions/runs/${{ github.run_number }}');
  });

  test('a build that feeds the release feed takes a GitHub token, a publisher keeps the job token', () => {
    const source = `name: B
on:
  push:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: bunx turbo run build
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
      - run: bun publish.ts
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;
    const { text } = run(source, [githubApiToken('CI_GITHUB_TOKEN')]);
    expect(text).toContain('GITHUB_TOKEN: ${{ secrets.CI_GITHUB_TOKEN }}');
    expect(text.match(/secrets\.GITHUB_TOKEN/g)).toHaveLength(1);
  });

  test('a workflow names its own copy, and moved paths are written once', () => {
    const { text } = run(
      `name: P\non:\n  push:\n    paths:\n      - '.github/workflows/w.yml'\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bash .github/scripts/x.sh\n`,
      [
        ownPath,
        movePaths([
          { from: '.github/scripts/x.sh', to: '.forgejo/scripts/x.sh' },
        ]),
      ],
    );
    expect(text).toContain("'.forgejo/workflows/w.yml'");
    expect(text).toContain('bash .forgejo/scripts/x.sh');
  });
});

describe('buildCache', () => {
  const BUILD = `name: Build
on:
  push:
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: docker/build-push-action@${SHA}
        with:
          cache-from: |
            type=gha,scope=\${{ matrix.service }}
            type=registry,ref=\${{ env.REGISTRY }}/\${{ github.repository }}/tale-\${{ matrix.service }}-buildcache:amd64
          cache-to: \${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && format('type=gha,scope={0},mode=max,ghtoken={1},repository={2}', matrix.service, secrets.GITHUB_TOKEN, github.repository) || '' }}
      - uses: docker/bake-action@${SHA}
        with:
          set: |
            *.cache-from=type=gha,scope=web
            \${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && format('*.cache-to=type=gha,scope=web,mode=max,ghtoken={0},repository={1}', secrets.GITHUB_TOKEN, github.repository) || '' }}
          provenance: false
      - uses: docker/build-push-action@${SHA}
        with:
          cache-from: type=gha,scope=db
`;

  test('keeps the registry cache the build already reads and writes it from main only', () => {
    const { text } = run(BUILD, [buildCache]);
    expect(text).not.toContain('type=gha');
    expect(text).toContain(
      'type=registry,ref=${{ env.REGISTRY }}/${{ github.repository }}/tale-${{ matrix.service }}-buildcache:amd64',
    );
    expect(text).toContain(
      "cache-to: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && format('type=registry,ref={0}/{1}/tale-{2}-buildcache:amd64,mode=max,ignore-error=true,compression=zstd', env.REGISTRY, github.repository, matrix.service) || '' }}",
    );
  });

  test('builds the site images and the database image without a layer cache', () => {
    const { text } = run(BUILD, [buildCache]);
    expect(text).not.toContain('scope=web');
    expect(text).not.toContain('scope=db');
    expect(text).toContain('provenance: false');
    expect(text).not.toMatch(/set:\s*\n\s*\n/);
  });
});
