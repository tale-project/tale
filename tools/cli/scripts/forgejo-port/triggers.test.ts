import { describe, expect, test } from 'bun:test';

import { rewriteTriggers } from './triggers';
import { emptyReport, readWorkflow, writeWorkflow } from './workflow';

function rewrite(
  on: string,
  options: {
    keepMainPush?: boolean;
    dropEvents?: { name: string; why: string }[];
  } = {},
) {
  const doc = readWorkflow(
    `name: W\n${on}\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: x\n`,
    'w.yml',
  );
  const report = emptyReport();
  const result = rewriteTriggers(doc, { file: 'w.yml', ...options }, report);
  const written = writeWorkflow(doc);
  return { result, report, written };
}

describe('rewriteTriggers', () => {
  test('drops what Forgejo never fires and adds the train, as for commitlint.yml', () => {
    const { result, written } = rewrite(`on:
  merge_group:
    types: [checks_requested]
  repository_dispatch:
    types: [release-candidate]
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
    branches:
      - main
  push:
    branches:
      - main
`);
    expect(result.events).toEqual(['pull_request', 'push']);
    expect(result.validatedInQueue).toBe(true);
    expect(written).not.toContain('merge_group');
    expect(written).not.toContain('repository_dispatch');
    expect(written).not.toContain('ready_for_review');
    expect(written).toContain('types: [opened, synchronize, reopened]');
    expect(written).toMatch(/push:\n {4}branches: \['mq\/\*\*'\]/);
    expect(written).toContain('- main');
  });

  test('adds a push for the train to a workflow that had only the merge queue, as e2e.yml', () => {
    const { result, written } = rewrite(`on:
  merge_group:
    types: [checks_requested]
  repository_dispatch:
    types: [release-candidate]
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  schedule:
    - cron: '30 2 * * *'
  workflow_dispatch:
`);
    expect(result.events).toEqual([
      'pull_request',
      'schedule',
      'workflow_dispatch',
      'push',
    ]);
    expect(written).toContain("branches: ['mq/**']");
    expect(written).toContain("cron: '30 2 * * *'");
  });

  test('takes the paths off a push, since a new branch has no files to compare', () => {
    const { written } = rewrite(`on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
    paths:
      - 'services/**'
      - 'bun.lock'
  merge_group:
`);
    expect(written).not.toContain('paths');
    expect(written).not.toContain('services/**');
    expect(written).toContain("branches: ['mq/**']");
  });

  test('removes a workflow_dispatch that exists for release candidates, as build.yml', () => {
    const { result, written } = rewrite(`on:
  merge_group:
  workflow_dispatch:
    inputs:
      candidate_sha:
        description: 'Release candidate'
        required: true
        type: string
  repository_dispatch:
    types: [release-candidate]
`);
    expect(result.events).toEqual(['push']);
    expect(written).not.toContain('workflow_dispatch');
    expect(written).not.toContain('candidate_sha');
  });

  test('drops an event the plan says makes no sense here, and says why', () => {
    const { result, written, report } = rewrite(
      `on:
  workflow_dispatch:
    inputs:
      release_tag:
        required: true
  pull_request:
`,
      {
        dropEvents: [
          {
            name: 'workflow_dispatch',
            why: 'it attaches binaries to a release',
          },
        ],
      },
    );
    expect(result.events).toEqual(['pull_request']);
    expect(written).not.toContain('workflow_dispatch');
    expect(report.changes.map((change) => change.rule)).toContain(
      'trigger-dropped',
    );
    expect(
      report.changes.find((change) => change.rule === 'trigger-dropped')
        ?.detail,
    ).toContain('it attaches binaries to a release');
  });

  test('keeps a manual dispatch with other inputs', () => {
    const { result } = rewrite(`on:
  merge_group:
  workflow_dispatch:
    inputs:
      profile:
        type: string
`);
    expect(result.events).toEqual(['workflow_dispatch', 'push']);
  });

  test('leaves a publisher alone: a push to main is what it is for', () => {
    const { result, written } = rewrite(`on:
  push:
    branches: [main]
    paths: ['packages/ui/**']
  workflow_dispatch:
    inputs:
      release_tag:
        required: false
`);
    expect(result.validatedInQueue).toBe(false);
    expect(result.events).toEqual(['push', 'workflow_dispatch']);
    expect(written).toContain("paths: ['packages/ui/**']");
    expect(written).not.toContain('mq/');
  });

  test('keeps the default branch too when the workflow publishes after a merge', () => {
    const { written } = rewrite(
      `on:
  push:
    branches: [main]
  merge_group:
`,
      { keepMainPush: true },
    );
    expect(written).toContain("branches: [main, 'mq/**']");
  });

  test('reads the scalar and list forms of on', () => {
    expect(rewrite('on: push').result.events).toEqual(['push']);
    expect(rewrite('on: [push, pull_request]').result.events).toEqual([
      'push',
      'pull_request',
    ]);
    expect(rewrite('on: [merge_group, pull_request]').result.events).toEqual([
      'pull_request',
      'push',
    ]);
  });

  test('says what it did', () => {
    const { report } = rewrite(`on:
  merge_group:
  repository_dispatch:
  pull_request:
    types: [opened, ready_for_review]
`);
    expect(report.changes.map((change) => change.rule)).toEqual([
      'trigger-dead',
      'trigger-dead',
      'trigger-type',
      'trigger-train',
    ]);
  });
});
