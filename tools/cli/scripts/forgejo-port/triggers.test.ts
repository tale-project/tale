import { describe, expect, test } from 'bun:test';

import { rewriteTriggers } from './triggers';
import { emptyReport, readWorkflow, writeWorkflow } from './workflow';

function rewrite(
  on: string,
  options: { dropEvents?: { name: string; why: string }[] } = {},
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
  test('drops what Forgejo never fires and keeps the rest as GitHub has it, as for commitlint.yml', () => {
    const { result, written } = rewrite(`on:
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
    expect(written).not.toContain('repository_dispatch');
    expect(written).not.toContain('ready_for_review');
    expect(written).toContain('types: [opened, synchronize, reopened]');
    expect(written).toMatch(/push:\n {4}branches:\n {6}- main\n/);
  });

  test('adds no push to a workflow that has none, as e2e.yml', () => {
    const { result, written } = rewrite(`on:
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
    ]);
    expect(written).not.toContain('push');
    expect(written).toContain("cron: '30 2 * * *'");
  });

  test('keeps the paths of a push to main, which has the commit before it to compare with', () => {
    const { result, written } = rewrite(`on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
    paths:
      - 'services/**'
      - 'bun.lock'
`);
    expect(result.events).toEqual(['pull_request', 'push']);
    expect(written).toMatch(
      /push:\n {4}branches: \[main\]\n {4}paths:\n {6}- 'services\/\*\*'\n {6}- 'bun\.lock'\n/,
    );
  });

  test('removes a workflow_dispatch that exists for release candidates, as build.yml', () => {
    const { result, written } = rewrite(`on:
  push:
    branches: [main]
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
  workflow_dispatch:
    inputs:
      profile:
        type: string
`);
    expect(result.events).toEqual(['workflow_dispatch']);
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
    expect(result.events).toEqual(['push', 'workflow_dispatch']);
    expect(written).toContain("paths: ['packages/ui/**']");
  });

  test('reads the scalar and list forms of on', () => {
    expect(rewrite('on: push').result.events).toEqual(['push']);
    expect(rewrite('on: [push, pull_request]').result.events).toEqual([
      'push',
      'pull_request',
    ]);
    expect(
      rewrite('on: [repository_dispatch, pull_request]').result.events,
    ).toEqual(['pull_request']);
  });

  test('says what it did', () => {
    const { report } = rewrite(`on:
  workflow_run:
  repository_dispatch:
  pull_request:
    types: [opened, ready_for_review]
`);
    expect(report.changes.map((change) => change.rule)).toEqual([
      'trigger-dead',
      'trigger-dead',
      'trigger-type',
    ]);
  });
});
