import { describe, expect, test } from 'bun:test';

import { generate } from './generate';
import type { Manifest } from './manifest';

const SHA = 'a'.repeat(40);

const SCRIPT = '.github/scripts/pull.sh';

/** A manifest of its own, so that no rule of the port is held back by what the real one names. */
const MANIFEST: Manifest = {
  tier: 'full',
  registry: { host: 'git.example.test', tokenSecret: 'CI_PACKAGES_TOKEN' },
  githubApiTokenSecret: 'CI_GITHUB_TOKEN',
  labels: ['ubuntu-latest'],
  composites: ['setup-turbo'],
  scripts: [{ from: SCRIPT, to: '.forgejo/scripts/pull.sh', edits: [] }],
  workflows: {},
  githubEdits: [],
};

const COMPOSITE = `name: Setup turbo
runs:
  using: composite
  steps:
    - run: echo turbo
      shell: bash
`;

/** One job on a runner the pool serves, with the steps given. */
const job = (id: string, steps: string, more = ''): string => `
  ${id}:
    runs-on: ubuntu-latest
${more}    steps:
${steps}`;

const workflow = (jobs: string, more = ''): string =>
  `name: W
on:
  pull_request:
${more}jobs:${jobs}`;

interface Row {
  /** The rules that must have changed something, by the name they report. */
  readonly rules: readonly string[];
  /** Text the generated workflow must hold, for a rule that reports nothing. */
  readonly text?: readonly string[];
  readonly file?: string;
  readonly source: string;
  readonly manifest?: Partial<Manifest>;
}

/**
 * A workflow in which each rule of the port has something to change. A rule that is dropped
 * from the generator changes nothing, says nothing and warns of nothing, so the only thing
 * that shows it is gone is that its change is missing from the report.
 */
const ROWS: Record<string, Row> = {
  dropJobs: {
    rules: ['job-dropped'],
    source: workflow(
      job('keep', '      - run: echo keep\n') +
        job('gone', '      - run: echo gone\n'),
    ),
    manifest: {
      workflows: {
        'w.yml': {
          kind: 'port',
          dropJobs: [{ id: 'gone', why: 'the node cannot run it' }],
        },
      },
    },
  },
  services: {
    rules: ['services'],
    source: workflow(
      job(
        'db',
        '      - run: echo db\n',
        '    services:\n      postgres:\n        image: postgres:18\n        ports:\n          - 5432:5432\n',
      ),
    ),
  },
  environment: {
    rules: ['environment'],
    source: workflow(
      job(
        'deploy',
        '      - run: echo deploy\n',
        '    environment: production\n',
      ),
    ),
  },
  matrixTotals: {
    rules: [],
    text: ['--shard=${{ matrix.shard }}/3'],
    source: workflow(
      job(
        'test',
        '      - run: bun test --shard=${{ matrix.shard }}/${{ strategy.job-total }}\n',
        '    strategy:\n      matrix:\n        shard: [1, 2, 3]\n',
      ),
    ),
  },
  ciScope: {
    rules: ['scope-job'],
    source: `name: E2E
on:
  merge_group:
  pull_request:
jobs:
  pr-scope:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    outputs:
      run: \${{ steps.scope.outputs.run }}
    steps:
      - uses: actions/checkout@${SHA}
        with:
          sparse-checkout: |
            /.github/actions/ci-scope/action.yml
      - id: scope
        uses: ./.github/actions/ci-scope
        with:
          filter: e2e
          queue-only: 'true'
  suite:
    needs: [pr-scope]
    if: needs.pr-scope.outputs.run == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: echo suite
`,
  },
  queueOnlyJobs: {
    rules: ['queue-only'],
    file: 'checks.yml',
    source: `name: Checks
on:
  merge_group:
  pull_request:
jobs:
  build:
    if: github.event_name != 'pull_request' && !cancelled()
    runs-on: ubuntu-latest
    steps:
      - run: echo build
`,
  },
  dropForeignRows: {
    rules: ['matrix-row'],
    source: workflow(`
  build:
    runs-on: \${{ matrix.os }}
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
          - os: macos-latest
    steps:
      - run: echo build
`),
  },
  readyJob: {
    rules: ['ready'],
    source: workflow(
      job('lint', '      - run: echo lint\n') +
        `
  ci-ready:
    name: CI ready (W)
    needs: [lint]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${SHA}
`,
    ),
  },
  rewriteActions: {
    rules: ['action-replaced'],
    source: workflow(
      job('upload', `      - uses: actions/upload-artifact@${SHA}\n`),
    ),
  },
  buildCache: {
    rules: ['build-cache'],
    source: workflow(
      job(
        'image',
        `      - uses: docker/build-push-action@${SHA}\n        with:\n          cache-from: type=gha,scope=web\n`,
      ),
    ),
  },
  registryLogin: {
    rules: ['registry-login', 'registry-host'],
    source: workflow(
      job(
        'login',
        `      - uses: docker/login-action@${SHA}\n        with:\n          registry: \${{ env.REGISTRY }}\n`,
      ),
      'env:\n  REGISTRY: ghcr.io\n',
    ),
  },
  rewriteLocalActions: {
    rules: ['local-action'],
    source: workflow(
      job('setup', '      - uses: ./.github/actions/setup-turbo\n'),
    ),
  },
  movePaths: {
    rules: ['path'],
    source: workflow(job('pull', `      - run: ${SCRIPT}\n`)),
  },
  runUrls: {
    rules: ['run-url'],
    source: workflow(
      job(
        'link',
        '      - run: echo ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}\n',
      ),
    ),
  },
  batchEvent: {
    rules: ['batch-event'],
    file: 'build.yml',
    source: workflow(
      job(
        'changes',
        '      - run: |\n          if [ "$EVENT_NAME" = merge_group ]; then\n            echo all\n          fi\n',
      ),
    ),
  },
  commitlintBatch: {
    rules: ['commitlint-batch'],
    file: 'commitlint.yml',
    source: workflow(
      job('commitlint', '      - run: bunx commitlint --last --verbose\n'),
    ),
  },
  lintLinksBase: {
    rules: ['lint-links-base'],
    file: 'checks.yml',
    source: workflow(
      job(
        'format',
        `      - uses: actions/checkout@${SHA}\n        with:\n          fetch-depth: 2\n      - run: bun run lint:links\n`,
      ),
    ),
  },
  publishRemote: {
    rules: ['publish-remote'],
    file: 'publish-packages.yml',
    source: workflow(
      job(
        'publish',
        '      - run: |\n          REMOTE="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"\n          echo "github:${GITHUB_REPOSITORY}#dist/ui"\n',
      ),
    ),
  },
  publishOnTag: {
    rules: ['publish-on-tag'],
    file: 'publish-packages.yml',
    source: `name: Publish packages
on:
  push:
    branches:
      - main
  workflow_dispatch:
    inputs:
      release_tag:
        required: false
        type: string
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@${SHA}
      - name: Resolve snapshot tag
        id: tag
        env:
          REF: \${{ github.ref }}
          RELEASE_TAG: \${{ inputs.release_tag }}
          SOURCE_SHA: \${{ inputs.source_sha }}
        run: echo "$REF"
`,
  },
  githubApiToken: {
    rules: ['github-api-token'],
    source: workflow(
      job(
        'build',
        '      - run: bunx turbo run build\n        env:\n          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n',
      ),
    ),
  },
  ownPath: {
    rules: ['own-path'],
    source: workflow(
      job('lint', '      - run: echo lint\n'),
      "    paths:\n      - '.github/workflows/w.yml'\n",
    ),
  },
};

describe('the rules a workflow is ported by', () => {
  for (const [name, row] of Object.entries(ROWS))
    test(`${name} is run by the generator`, () => {
      const file = row.file ?? 'w.yml';
      const generated = generate(
        {
          workflows: new Map([[file, row.source]]),
          actions: new Map([['setup-turbo', COMPOSITE]]),
          files: new Map([[SCRIPT, '#!/bin/sh\n']]),
        },
        { ...MANIFEST, ...row.manifest },
      );
      const changed = generated.report.changes.map((change) => change.rule);
      for (const rule of row.rules) expect(changed, rule).toContain(rule);
      const text = generated.files.get(`.forgejo/workflows/${file}`) ?? '';
      for (const fragment of row.text ?? [])
        expect(text, fragment).toContain(fragment);
    });
});
