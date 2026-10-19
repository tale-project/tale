import { describe, expect, test } from 'bun:test';

import type { Facts } from './expression';
import {
  emptyReport,
  foldCondition,
  foldWorkflow,
  jobIds,
  jobOf,
  needsOf,
  readWorkflow,
  removeJobs,
  setNeeds,
  stepsOf,
  writeWorkflow,
  WorkflowError,
} from './workflow';

/** Tale's commitlint.yml as it is today, trimmed to the shapes the port meets. */
const COMMITLINT = `name: Commitlint

run-name: \${{ github.event_name == 'repository_dispatch' && format('Release candidate {0}', github.event.client_payload.candidate_sha) || '' }}

on:
  merge_group:
    types: [checks_requested]
  repository_dispatch:
    types: [release-candidate]
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
    branches:
      - main

concurrency:
  group: \${{ github.workflow }}-\${{ github.event_name == 'repository_dispatch' && format('candidate-{0}', github.event.client_payload.candidate_sha) || github.ref }}
  cancel-in-progress: \${{ github.event_name != 'repository_dispatch' }}

jobs:
  # Only candidates need remote source validation; ordinary jobs keep their event SHA.
  candidate-source:
    if: >-
      github.event_name == 'repository_dispatch'
    name: Candidate source
    uses: ./.github/workflows/release-candidate-source.yml
    with:
      candidate: \${{ github.event_name == 'repository_dispatch' }}
      candidate_sha: \${{ github.event.client_payload.candidate_sha }}

  commitlint:
    needs: candidate-source
    name: Lint commits
    if: >-
      !cancelled() &&
      (((github.event_name == 'repository_dispatch') &&
      needs.candidate-source.result == 'success') ||
      ((github.event_name != 'repository_dispatch') &&
      needs.candidate-source.result == 'skipped')) &&
      (github.event.pull_request.draft != true)
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
        with:
          ref: \${{ needs.candidate-source.outputs.candidate_sha }}
          fetch-depth: \${{ github.event_name == 'repository_dispatch' && 1 || 0 }}
          filter: blob:none
      - name: Run commitlint
        env:
          EVENT_NAME: \${{ github.event_name }}
          CANDIDATE_SHA: \${{ needs.candidate-source.outputs.candidate_sha }}
        run: |
          if [ "$EVENT_NAME" = "repository_dispatch" ]; then
            echo candidate
          fi
`;

const facts: Facts = {
  values: new Map([['needs.candidate-source.result', 'skipped']]),
  absent: ['github.event.client_payload', 'needs.candidate-source.outputs'],
  oneOf: new Map([['github.event_name', ['pull_request', 'push']]]),
};

function fold(source: string, folding: Facts = facts) {
  const doc = readWorkflow(source, 'commitlint.yml');
  const report = emptyReport();
  const dead = foldWorkflow(doc, {
    file: 'commitlint.yml',
    facts: folding,
    report,
  });
  return { doc, report, dead };
}

describe('readWorkflow and writeWorkflow', () => {
  test('refuse what is not a workflow', () => {
    expect(() => readWorkflow('a: [', 'x.yml')).toThrow(WorkflowError);
    expect(() => readWorkflow('- a\n- b\n', 'x.yml')).toThrow('not a mapping');
    expect(() => readWorkflow('name: x\n', 'x.yml').toString()).not.toThrow();
  });

  test('expand an anchor that another job uses, so removing the first job is safe', () => {
    const source = `jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - name: Reclaim
        run: &reclaim |
          df -h /
  b:
    runs-on: ubuntu-latest
    steps:
      - name: Reclaim
        run: *reclaim
`;
    const doc = readWorkflow(source, 'x.yml');
    removeJobs(doc, ['a']);
    const written = writeWorkflow(doc);
    expect(written).not.toContain('&reclaim');
    expect(written).not.toContain('*reclaim');
    expect(written).toContain('df -h /');
    expect(jobIds(doc)).toEqual(['b']);
  });

  test('drop the inputs of an action that came to nothing, and the `with` that held them', () => {
    const { doc } = fold(`jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd
        with:
          ref: \${{ needs.candidate-source.outputs.candidate_sha }}
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd
        with:
          ref: \${{ needs.candidate-source.outputs.candidate_sha }}
          fetch-depth: 0
`);
    expect(writeWorkflow(doc)).toBe(`jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd
        with:
          fetch-depth: 0
`);
  });

  test('leave no blank line after `jobs:` when the first job is removed', () => {
    const doc = readWorkflow(
      `jobs:
  a:
    runs-on: ubuntu-latest

  # about b
  b:
    runs-on: ubuntu-latest
`,
      'x.yml',
    );
    removeJobs(doc, ['a']);
    expect(writeWorkflow(doc)).toBe(
      `jobs:
  # about b
  b:
    runs-on: ubuntu-latest
`,
    );
  });

  test('hand the comment above a removed run-name to the key that follows', () => {
    const { doc } = fold(`name: X

# What this workflow is for.
run-name: \${{ github.event_name == 'repository_dispatch' && 'candidate' || '' }}

on:
  push:
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: echo
`);
    expect(writeWorkflow(doc)).toBe(`name: X

# What this workflow is for.
on:
  push:
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: echo
`);
  });

  test('keep comments and the style of text it does not change', () => {
    const { doc } = fold(COMMITLINT);
    const written = writeWorkflow(doc);
    expect(written).toContain('# v6');
    expect(written).toContain(
      'if [ "$EVENT_NAME" = "repository_dispatch" ]; then',
    );
    expect(written).toContain('run: |');
  });
});

describe('needs', () => {
  test('read one name or a list, and write a list back', () => {
    const doc = readWorkflow(
      `jobs:
  a: { runs-on: x }
  b: { needs: a, runs-on: x }
  c: { needs: [a, b], runs-on: x }
`,
      'x.yml',
    );
    const [b, c] = [jobOf(doc, 'b'), jobOf(doc, 'c')];
    expect(b && needsOf(b)).toEqual(['a']);
    expect(c && needsOf(c)).toEqual(['a', 'b']);
    if (c) setNeeds(c, ['b']);
    removeJobs(doc, ['a']);
    expect(writeWorkflow(doc)).not.toContain('needs: a');
    expect(b && needsOf(b)).toEqual([]);
    expect(c && needsOf(c)).toEqual(['b']);
  });
});

describe('foldCondition', () => {
  test('decides, simplifies, or leaves a condition alone', () => {
    expect(foldCondition("github.event_name == 'merge_group'", facts)).toEqual({
      kind: 'never',
    });
    expect(foldCondition("github.event_name != 'merge_group'", facts)).toEqual({
      kind: 'always',
    });
    expect(
      foldCondition("always() && github.event_name == 'pull_request'", facts),
    ).toEqual({
      kind: 'unchanged',
    });
    expect(
      foldCondition(
        "${{ !cancelled() && github.event_name != 'merge_group' }}",
        facts,
      ),
    ).toEqual({
      kind: 'text',
      text: '${{ !cancelled() }}',
    });
  });

  test('decides a condition that is the same for every event the workflow has', () => {
    // facts: a workflow with pull requests and pushes only
    expect(
      foldCondition(
        "github.event_name != 'pull_request' && github.event_name != 'push' && needs.x.result == 'success'",
        facts,
      ),
    ).toEqual({ kind: 'never' });
    expect(
      foldCondition(
        "github.event_name == 'pull_request' || github.event_name == 'push'",
        facts,
      ),
    ).toEqual({ kind: 'always' });
    // one that depends on the event stays
    expect(
      foldCondition(
        "github.event_name != 'pull_request' && needs.x.result == 'success'",
        facts,
      ),
    ).toEqual({ kind: 'unchanged' });
  });

  test('keeps the status function a fold would drop, as an `if:` without one waits for success', () => {
    const always = { kind: 'text', text: 'always()' } as const;
    for (const source of [
      "always() || github.event_name != 'merge_group'",
      "!cancelled() || github.event_name != 'merge_group'",
      "failure() || github.event_name != 'merge_group'",
      "github.event_name != 'merge_group' || always()",
      "!(always() && github.event_name == 'merge_group')",
    ])
      expect(foldCondition(source, facts), source).toEqual(always);
    expect(
      foldCondition(
        "${{ always() || github.event_name != 'merge_group' }}",
        facts,
      ),
    ).toEqual({ kind: 'text', text: '${{ always() }}' });
    expect(
      foldCondition(
        "(always() || github.event_name != 'merge_group') && github.event.pull_request.draft != true",
        facts,
      ),
    ).toEqual({
      kind: 'text',
      text: 'always() && github.event.pull_request.draft != true',
    });
    // a condition that holds for each of the workflow's events, not for one comparison alone, keeps it too
    for (const source of [
      "always() || github.event_name == 'push' || github.event_name == 'pull_request'",
      "failure() || (github.event_name == 'push' || github.event_name == 'pull_request')",
    ])
      expect(foldCondition(source, facts), source).toEqual(always);
    expect(
      foldCondition(
        "${{ always() || github.event_name == 'push' || github.event_name == 'pull_request' }}",
        facts,
      ),
    ).toEqual({ kind: 'text', text: '${{ always() }}' });
    // a condition that is false is false whatever the status, and one with no status function has none to keep
    expect(
      foldCondition("always() && github.event_name == 'merge_group'", facts),
    ).toEqual({ kind: 'never' });
    expect(
      foldCondition("github.event_name != 'merge_group' || x.y", facts),
    ).toEqual({ kind: 'always' });
    expect(
      foldCondition(
        "github.event_name == 'push' || github.event_name == 'pull_request'",
        facts,
      ),
    ).toEqual({ kind: 'always' });
  });

  test('refuse a wrapped condition with text around it', () => {
    expect(() => foldCondition('${{ a }} and ${{ b }}', facts)).toThrow(
      'one expression',
    );
  });
});

describe('foldWorkflow', () => {
  test('reports the jobs that can never run on Forgejo', () => {
    const { dead, report } = fold(COMMITLINT);
    expect(dead).toEqual(['candidate-source']);
    expect(report.changes.map((change) => change.rule)).toContain(
      'condition-never',
    );
  });

  test('decides the long candidate condition once the candidate job is a known skip', () => {
    const { doc } = fold(COMMITLINT);
    const job = jobOf(doc, 'commitlint');
    expect(job?.get('if')).toBe(
      '!cancelled() && github.event.pull_request.draft != true',
    );
  });

  test('keeps the status function of a job condition that folds to true', () => {
    const { doc } = fold(`name: x
on:
  push:
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: echo a
  b:
    needs: a
    if: always() || github.event_name != 'merge_group'
    runs-on: ubuntu-latest
    steps:
      - run: echo b
`);
    expect(jobOf(doc, 'b')?.get('if')).toBe('always()');
  });

  test('drops an action input that comes to nothing, and types a constant', () => {
    const { doc } = fold(COMMITLINT);
    const checkout = stepsOf(jobOf(doc, 'commitlint') ?? ({} as never))
      ?.items[0];
    const written = writeWorkflow(doc);
    expect(checkout).toBeDefined();
    expect(written).not.toContain('ref:');
    expect(written).toContain('fetch-depth: 0');
    expect(written).toContain('filter: blob:none');
  });

  test('writes an env value that folds to nothing as an empty string, not as a missing key', () => {
    const { doc } = fold(COMMITLINT);
    expect(writeWorkflow(doc)).toMatch(/CANDIDATE_SHA: ''/);
  });

  test('drops run-name when it comes to nothing and settles the concurrency group', () => {
    const { doc } = fold(COMMITLINT);
    const written = writeWorkflow(doc);
    expect(written).not.toContain('run-name');
    expect(written).toContain(
      'group: ${{ github.workflow }}-${{ github.ref }}',
    );
    expect(written).toContain('cancel-in-progress: true');
  });

  test('removes a step that can never run and keeps the others in order', () => {
    const source = `jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: one
      - if: github.event_name == 'merge_group'
        run: two
      - run: three
      - if: github.event_name != 'merge_group'
        run: four
`;
    const { doc, report } = fold(source);
    const written = writeWorkflow(doc);
    expect(written).toContain('run: one');
    expect(written).not.toContain('run: two');
    expect(written).toContain('run: three');
    expect(written).toContain('run: four');
    expect(written).not.toContain('if:');
    expect(
      report.changes.some((change) => change.at === 'jobs.a.steps[1]'),
    ).toBe(true);
  });

  test('warns, and keeps the text, when an expression does not parse', () => {
    const { doc, report } = fold(`jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: echo \${{ a @ b }}
`);
    expect(report.warnings).toHaveLength(1);
    expect(writeWorkflow(doc)).toContain('echo ${{ a @ b }}');
  });

  test('changes nothing in a workflow that has nothing to decide', () => {
    const source = `name: Plain

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - run: echo \${{ github.sha }}
`;
    const { doc, report, dead } = fold(source);
    expect(dead).toEqual([]);
    expect(report.changes).toEqual([]);
    expect(writeWorkflow(doc)).toBe(source);
  });
});
