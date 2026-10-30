import { describe, expect, test } from 'bun:test';

import { BUILD_FILTERS } from '../ci-ready';
import { portWorkflow } from './port';
import { emptyReport } from './workflow';

function port(source: string, file = 'w.yml') {
  const report = emptyReport();
  const result = portWorkflow(source, file, report);
  return { ...result, report };
}

const RUNS = `    runs-on: ubuntu-latest\n`;
const SHA = 'a'.repeat(40);

/** The pure job a path-scoped workflow starts with, as Tale writes it. */
const scopeJob = (
  filter: string,
  outputs: string[],
  condition: string | null = "github.event_name == 'pull_request'",
) => `
  pr-scope:
    name: PR scope
${condition === null ? '' : `    if: ${condition}\n`}${RUNS}    outputs:
${outputs.map((name) => `      ${name}: \${{ steps.scope.outputs.${name} }}`).join('\n')}
    steps:
      - uses: actions/checkout@${SHA}
        with:
          sparse-checkout: |
            /.github/actions/ci-scope/action.yml
      - id: scope
        uses: ./.github/actions/ci-scope
        with:
          filter: ${filter}
`;

describe('a job that only asks for the scope', () => {
  const E2E = `name: E2E
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:
jobs:${scopeJob('e2e', ['run', 'full', 'platform', 'web', 'changes'])}
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
          FULL: \${{ needs.pr-scope.outputs.full }}
          CHANGES: \${{ needs.pr-scope.outputs.changes }}
        run: echo "$PLATFORM $WEB"
`;

  test('is removed, and what reads it asks about the event instead', () => {
    const { text, jobs, removed } = port(E2E);
    expect(jobs).toEqual(['scope']);
    expect(removed.get('pr-scope')).toContain('scope');
    expect(text).not.toContain('pr-scope');
    // a pull request owes the whole suite, as a push and a dispatch do
    expect(text).toContain('if: "!cancelled()"');
    // the job runs for pull requests only, so its outputs are empty for every other run
    expect(text).toContain(
      "FULL: ${{ github.event_name == 'pull_request' && 'true' || '' }}",
    );
    expect(text).toContain(
      "PLATFORM: ${{ github.event_name == 'pull_request' && 'true' || '' }}",
    );
    // and what the scope never sets is empty for pull requests too
    expect(text).toContain("CHANGES: ''");
    expect(text).not.toContain('needs:');
  });

  test('hands the readiness policy what the job would have said to a pull request', () => {
    const report = emptyReport();
    const context: { results?: Map<string, unknown> } = {};
    const ported = portWorkflow(E2E, 'e2e.yml', report, {
      after: [
        (_doc, ctx) => {
          context.results = ctx.results;
        },
      ],
    });
    expect(ported.removed.has('pr-scope')).toBe(true);
    expect(context.results?.get('pr-scope')).toEqual({
      result: 'success',
      outputs: {
        run: 'true',
        full: 'true',
        platform: 'true',
        web: 'true',
        changes: '',
      },
    });
  });

  test('a Build scope that runs for every event names every service', () => {
    const { text } = port(`name: Build
on:
  push:
  pull_request:
jobs:${scopeJob('build', ['changes', 'ci_tests'], null)}
  changes:
    needs: [pr-scope]
${RUNS}    steps:
      - env:
          PR_CHANGES: \${{ needs.pr-scope.outputs.changes }}
          PR_CI_TESTS: \${{ needs.pr-scope.outputs.ci_tests }}
        run: echo "$PR_CHANGES"
`);
    const all = JSON.stringify(
      BUILD_FILTERS.filter((name) => name !== 'image_inputs'),
    );
    expect(text).toContain(`PR_CHANGES: '${all}'`);
    expect(text).toContain('PR_CI_TESTS: "true"');
  });

  test('what a pull request scope gates runs on every event', () => {
    const { text, removed } = port(`name: Security
on:
  push:
  pull_request:
jobs:${scopeJob('security', ['run', 'full'])}
  scan:
    needs: [pr-scope]
    if: >-
      github.event_name != 'pull_request' ||
      (needs.pr-scope.result == 'success' && needs.pr-scope.outputs.run == 'true')
${RUNS}    steps:
      - run: echo scan
`);
    expect(removed.has('pr-scope')).toBe(true);
    expect(text).not.toContain('if:');
    expect(text).not.toContain('needs:');
  });
});

describe('a scope step in a job that does other work', () => {
  const INTEGRATION = `name: Checks
on:
  push:
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
        uses: actions/checkout@${SHA}
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
`;

  test('is removed with the checkout that fetched it, and the job output says what it said', () => {
    const { text, jobs, report } = port(INTEGRATION);
    expect(jobs).toEqual(['integration-scope']);
    expect(text).toContain('Require complete integration');
    expect(text).not.toContain('ci-scope');
    expect(text).not.toContain('Checkout');
    // a pull request reports 'true', anything else the other step's 'true'
    expect(text).toContain(
      "run: ${{ steps.complete.outputs.run || (github.event_name == 'pull_request' && 'true' || '') }}",
    );
    expect(report.changes.filter((c) => c.rule === 'scope-step')).toHaveLength(
      2,
    );
  });

  test('leaves a step that only skips an upload for pull requests alone', () => {
    const { text } = port(`name: CLI
on:
  push:
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

describe('a scope step the port cannot read', () => {
  test('is left, with a warning, when something other than the event decides whether it runs', () => {
    const { text, report } = port(`name: W
on:
  pull_request:
jobs:
  scope:
${RUNS}    steps:
      - id: decide
        if: github.event_name == 'pull_request' && inputs.go
        uses: ./.github/actions/ci-scope
        with:
          filter: build
`);
    expect(text).toContain('./.github/actions/ci-scope');
    expect(report.warnings.some((warning) => warning.rule === 'scope')).toBe(
      true,
    );
  });

  test('is left, with a warning, when it has no id to read its outputs by', () => {
    const { text, report } = port(`name: W
on:
  pull_request:
jobs:
  scope:
${RUNS}    steps:
      - uses: ./.github/actions/ci-scope
        with:
          filter: build
`);
    expect(text).toContain('./.github/actions/ci-scope');
    expect(report.warnings).toHaveLength(1);
  });
});
