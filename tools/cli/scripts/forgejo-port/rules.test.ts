import { describe, expect, test } from 'bun:test';

import { portWorkflow } from './port';
import { emptyReport } from './workflow';

/** Port a workflow with the default rules and return the text and the report. */
function port(source: string, file = 'w.yml') {
  const report = emptyReport();
  const result = portWorkflow(source, file, report);
  return { ...result, report };
}

const RUNS = `    runs-on: ubuntu-latest\n`;

describe('fullScope', () => {
  const E2E = `name: E2E
on:
  merge_group:
  pull_request:
    branches: [main]
jobs:
  pr-scope:
    name: PR scope
    if: github.event_name == 'pull_request'
${RUNS}    outputs:
      run: \${{ steps.scope.outputs.run }}
      full: \${{ steps.scope.outputs.full }}
      platform: \${{ steps.scope.outputs.platform }}
      web: \${{ steps.scope.outputs.web }}
      changes: \${{ steps.scope.outputs.changes }}
    steps:
      - uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
        with:
          sparse-checkout: |
            /.github/actions/ci-scope/action.yml
      - id: scope
        uses: ./.github/actions/ci-scope
        with:
          filter: e2e
  scope:
    needs: [pr-scope]
    name: E2E scope
    if: >-
      !cancelled() &&
      (github.event_name != 'pull_request' ||
      (needs.pr-scope.result == 'success' && needs.pr-scope.outputs.run == 'true'))
${RUNS}    steps:
      - name: Decide
        env:
          PLATFORM: \${{ needs.pr-scope.outputs.platform }}
          WEB: \${{ needs.pr-scope.outputs.web }}
          CHANGES: \${{ needs.pr-scope.outputs.changes }}
        run: echo "$PLATFORM $WEB"
`;

  test('removes a job that only asks for the scope and answers "everything" to its readers', () => {
    const { text, jobs, removed } = port(E2E);
    expect(jobs).toEqual(['scope']);
    expect(removed.get('pr-scope')).toContain('full scope');
    expect(text).not.toContain('pr-scope');
    expect(text).toContain('PLATFORM: "true"');
    expect(text).toContain('WEB: "true"');
    expect(text).toContain("CHANGES: ''");
    // the condition no longer depends on the removed job
    expect(text).toContain('if: "!cancelled()"');
    expect(text).not.toContain('needs:');
  });

  test('removes the scope steps of a job that does other work too, and makes its other branch general', () => {
    const { text } = port(`name: Checks
on:
  merge_group:
  pull_request:
jobs:
  integration-scope:
${RUNS}    outputs:
      run: \${{ steps.complete.outputs.run || steps.decide.outputs.run }}
    steps:
      - name: Require complete integration
        if: github.event_name != 'pull_request'
        id: complete
        run: echo 'run=true' >> "$GITHUB_OUTPUT"
      - name: Checkout
        if: github.event_name == 'pull_request'
        uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
        with:
          sparse-checkout: |
            /.github/actions/ci-scope/action.yml
            /.github/ci-scope.yml
      - name: Decide
        id: decide
        if: github.event_name == 'pull_request'
        uses: ./.github/actions/ci-scope
        with:
          filter: integration
          queue-only: 'true'
`);
    expect(text).toContain('Require complete integration');
    expect(text).not.toContain('ci-scope');
    expect(text).not.toContain('if: github.event_name');
    expect(text).not.toContain('Checkout');
  });

  test('leaves a step that only skips an upload for pull requests alone', () => {
    const { text } = port(`name: CLI
on:
  merge_group:
  pull_request:
jobs:
  build:
${RUNS}    steps:
      - name: Upload artifact
        if: github.event_name != 'pull_request'
        run: echo upload
`);
    expect(text).toContain("if: github.event_name != 'pull_request'");
  });
});

describe('queueOnlyJobs', () => {
  const CHECKS = (file: string) =>
    port(
      `name: Checks
on:
  merge_group:
  pull_request:
jobs:
  build:
    if: >-
      github.event_name != 'pull_request' &&
      !cancelled() &&
      needs.x.result == 'success'
${RUNS}    steps:
      - run: echo build
  lint:
    if: github.event_name != 'pull_request'
${RUNS}    steps:
      - run: echo lint
`,
      file,
    );

  test('lets a pull request run the suites the merge queue alone ran', () => {
    const { text } = CHECKS('checks.yml');
    expect(text).toContain(
      'if: "!cancelled() && needs.x.result == \'success\'"',
    );
  });

  test('touches only the jobs Tale lists as queue-only, and only in checks.yml', () => {
    expect(CHECKS('checks.yml').text).toContain(
      "if: github.event_name != 'pull_request'",
    );
    const other = CHECKS('build.yml').text;
    expect(other).toContain("github.event_name != 'pull_request' &&");
  });
});

describe('servicesToDockerRun', () => {
  const JOB = (services: string) => `name: W
on:
  pull_request:
jobs:
  test:
${RUNS}    services:
${services}
    steps:
      - name: Checkout
        uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`;

  test('starts a service with docker run on the loopback address, before the checkout', () => {
    const { text, report } = port(
      JOB(`      bgutil:
        image: mirror.gcr.io/brainicism/bgutil-ytdlp-pot-provider:1.3.1
        ports:
          - 4416:4416`),
    );
    expect(text).not.toContain('services:');
    expect(text.indexOf('Start the bgutil service')).toBeLessThan(
      text.indexOf('Checkout'),
    );
    expect(text).toContain("docker run -d --name 'service-bgutil'");
    expect(text).toContain('-p 127.0.0.1:4416:4416');
    expect(text).toContain(
      "'docker.io/brainicism/bgutil-ytdlp-pot-provider:1.3.1'",
    );
    expect(text).not.toContain('docker inspect');
    expect(report.changes.some((change) => change.rule === 'services')).toBe(
      true,
    );
  });

  test('waits for the health check the options define, and passes env by name', () => {
    const { text } = port(
      JOB(`      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: tale
          POSTGRES_PASSWORD: \${{ secrets.DB_PASSWORD }}
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U tale -d tale_app"
          --health-interval 10s`),
    );
    expect(text).toContain('POSTGRES_PASSWORD: ${{ secrets.DB_PASSWORD }}');
    expect(text).toContain('-e POSTGRES_USER');
    expect(text).toContain(
      '--health-cmd "pg_isready -U tale -d tale_app" --health-interval 10s',
    );
    expect(text).toContain(
      "docker inspect --format '{{.State.Health.Status}}'",
    );
    expect(text).not.toMatch(/-e POSTGRES_USER=/);
  });

  test('says when a port has no fixed host port, and when credentials are not carried over', () => {
    const { text, report } = port(
      JOB(`      db:
        image: postgres:16
        ports:
          - 5432
        credentials:
          username: x
          password: y`),
    );
    expect(text).not.toContain('-p ');
    expect(report.warnings.map((warning) => warning.rule).sort()).toEqual([
      'service-credentials',
      'service-port',
    ]);
  });
});

describe('matrixTotals', () => {
  test('writes the size of a plain matrix where the job asks the runner for it', () => {
    const { text } = port(`name: E2E
on:
  pull_request:
jobs:
  e2e:
${RUNS}    strategy:
      matrix:
        shard: [1, 2, 3, 4]
    steps:
      - run: bunx playwright test --shard=\${{ matrix.shard }}/\${{ strategy.job-total }}
`);
    expect(text).toContain('--shard=${{ matrix.shard }}/4');
  });

  test('leaves a matrix that something decides at run time', () => {
    const { text } = port(`name: B
on:
  pull_request:
jobs:
  scan:
${RUNS}    strategy:
      matrix:
        service: \${{ fromJSON(needs.changes.outputs.services) }}
    steps:
      - run: echo \${{ strategy.job-total }}
`);
    expect(text).toContain('${{ strategy.job-total }}');
  });
});

describe('dropEnvironments', () => {
  test('removes an environment and says so', () => {
    const { text, report } = port(`name: S
on:
  pull_request:
jobs:
  scan:
    environment: production
${RUNS}    steps:
      - run: scan
`);
    expect(text).not.toContain('environment');
    expect(report.changes.map((change) => change.rule)).toContain(
      'environment',
    );
  });
});

describe('the pipeline', () => {
  test('folds what an empty job output decides', () => {
    const { text } = port(`name: Build
on:
  merge_group:
  repository_dispatch:
    types: [release-candidate]
  pull_request:
jobs:
  candidate-source:
    if: github.event_name == 'repository_dispatch'
    uses: ./.github/workflows/release-candidate-source.yml
  changes:
    needs: candidate-source
    if: needs.candidate-source.result == 'skipped'
${RUNS}    outputs:
      candidate_sha: \${{ needs.candidate-source.outputs.candidate_sha }}
    steps:
      - run: echo changes
  build:
    needs: changes
${RUNS}    steps:
      - uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
        with:
          ref: \${{ needs.changes.outputs.candidate_sha }}
          persist-credentials: false
      - name: Candidate only
        if: needs.changes.outputs.candidate_sha != ''
        run: echo candidate
  candidate-gate:
    needs: [changes, build]
    if: always() && needs.changes.outputs.candidate_sha != ''
${RUNS}    steps:
      - run: echo gate
`);
    expect(text).not.toContain('candidate-source');
    expect(text).not.toContain('candidate-gate');
    expect(text).not.toContain('Candidate only');
    expect(text).not.toContain('ref:');
    expect(text).toContain('persist-credentials: false');
  });

  test('is the identity on a workflow with nothing to port', () => {
    const source = `name: Plain

on:
  schedule:
    - cron: '0 3 * * 2'
  workflow_dispatch:

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - run: echo scan
`;
    const { text, report } = port(source);
    expect(report.changes).toEqual([]);
    expect(text).toBe(source);
  });
});
