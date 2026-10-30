import { describe, expect, test } from 'bun:test';

import { BUILD_SERVICES, CI_JOBS, COMPOSE_SERVICES } from '../ci-ready';
import {
  judgeReadiness,
  parseRemoved,
  readInput,
  renderVerdict,
  type JobResult,
  type ReadyInput,
} from './ready';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

type Workflow = keyof typeof CI_JOBS;
type Job = { result: string; outputs: Record<string, string> };

const skipped: Job = { result: 'skipped', outputs: {} };
/** A job the port took out that a pull request would not have run. */
const neverRan: JobResult = { result: 'skipped', outputs: {} };

/** The workflows whose scope job a pull request answers from its paths; this one touches them all. */
const SCOPED = new Set<Workflow>([
  'build',
  'e2e',
  'cli',
  'security',
  'sandbox-incus-e2e',
]);

/** What the port took out of each workflow, and what each job would have said to a pull request. */
function removedFor(workflow: Workflow): Record<string, JobResult> {
  const gone: Record<string, JobResult> = {
    'candidate-source': neverRan,
    'candidate-gate': neverRan,
  };
  if (workflow === 'cli') gone.release = neverRan;
  if (SCOPED.has(workflow))
    gone['pr-scope'] = {
      result: 'success',
      outputs: { run: 'true', full: 'true' },
    };
  return gone;
}

/** A fully green pull request of one workflow, as `toJSON(needs)` of its ready job on Forgejo. */
function greenNeeds(workflow: Workflow): Record<string, Job> {
  const needs: Record<string, Job> = {};
  for (const id of CI_JOBS[workflow]) {
    if (id in removedFor(workflow)) continue;
    needs[id] = { result: 'success', outputs: {} };
  }
  if (needs['integration-scope'])
    needs['integration-scope'].outputs = { run: 'true' };
  if (workflow === 'e2e')
    needs.scope = {
      result: 'success',
      outputs: { platform: 'true', static_services: '["web","docs"]' },
    };
  if (workflow === 'build') {
    needs['smoke-test-fork'] = skipped;
    needs['image-validate-fork'] = skipped;
    needs.changes = {
      result: 'success',
      outputs: {
        services: JSON.stringify(BUILD_SERVICES),
        scannable_services: JSON.stringify(COMPOSE_SERVICES),
        ci_tests: 'true',
        stack: 'true',
        storybook: 'true',
      },
    };
  }
  return needs;
}

function pullRequest(overrides: Record<string, unknown> = {}) {
  return {
    pull_request: {
      title: 'feat(cli): something',
      base: { sha: A },
      head: { sha: B, repo: { fork: false } },
      changed_files: 3,
      ...overrides,
    },
  };
}

function onPullRequest(
  workflow: Workflow,
  extra: Partial<ReadyInput> = {},
): ReadyInput {
  return {
    workflow,
    needs: greenNeeds(workflow),
    removed: removedFor(workflow),
    event: 'pull_request',
    payload: pullRequest(),
    sha: B,
    ...extra,
  };
}

const WORKFLOWS = Object.keys(CI_JOBS) as Workflow[];

describe('judgeReadiness', () => {
  for (const workflow of WORKFLOWS) {
    test(`${workflow}: a green pull request is ready`, () => {
      const verdict = judgeReadiness(onPullRequest(workflow));
      expect(verdict.reasons).toEqual([]);
      expect(verdict.passed).toBe(true);
    });

    test(`${workflow}: a pull request that did not finish a job it owes is held`, () => {
      for (const id of Object.keys(greenNeeds(workflow))) {
        const needs = greenNeeds(workflow);
        const job = needs[id];
        if (!job || job.result === 'skipped') continue;
        for (const result of ['failure', 'cancelled', 'skipped', '']) {
          job.result = result;
          expect(
            judgeReadiness(onPullRequest(workflow, { needs })).passed,
            `${id}/${result}`,
          ).toBe(false);
        }
      }
    });

    test(`${workflow}: a job that is neither there nor removed by the port holds it`, () => {
      for (const id of Object.keys(greenNeeds(workflow))) {
        const needs = greenNeeds(workflow);
        delete needs[id];
        expect(
          judgeReadiness(onPullRequest(workflow, { needs })).passed,
          `missing ${id}`,
        ).toBe(false);
      }
    });

    test(`${workflow}: a job nobody classified holds it`, () => {
      const needs = greenNeeds(workflow);
      needs['new-unclassified-proof'] = { result: 'success', outputs: {} };
      expect(judgeReadiness(onPullRequest(workflow, { needs })).passed).toBe(
        false,
      );
    });
  }

  test('a pull request owes the whole suite: a scope that lost a service holds it', () => {
    const e2e = greenNeeds('e2e');
    e2e.scope = {
      result: 'success',
      outputs: { platform: 'true', static_services: '["web"]' },
    };
    expect(
      judgeReadiness(onPullRequest('e2e', { needs: e2e })).reasons,
    ).toEqual(['Full E2E scope lost service coverage']);
    const build = greenNeeds('build');
    build.changes!.outputs.services = '["platform"]';
    build.changes!.outputs.scannable_services = '["platform"]';
    expect(
      judgeReadiness(onPullRequest('build', { needs: build })).reasons,
    ).toEqual(['Full Build scope lost service coverage']);
  });

  test('a pull request that failed a lane it owes is held', () => {
    const needs = greenNeeds('checks');
    needs.lint = { result: 'failure', outputs: {} };
    expect(judgeReadiness(onPullRequest('checks', { needs })).passed).toBe(
      false,
    );
  });

  test('does not hold a work-in-progress pull request: Forgejo refuses to merge one', () => {
    for (const title of ['WIP: x', '[WIP] x']) {
      expect(
        judgeReadiness(
          onPullRequest('commitlint', {
            payload: pullRequest({ title, draft: true }),
          }),
        ).passed,
      ).toBe(true);
    }
  });

  test('a pull request from a fork is held with the way out', () => {
    const verdict = judgeReadiness(
      onPullRequest('commitlint', {
        payload: pullRequest({ head: { sha: B, repo: { fork: true } } }),
      }),
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons[0]).toContain('a maintainer pushes the branch');
  });

  test('an event that is not a pull request is held, and so is a pull request with no commits named', () => {
    for (const event of ['push', 'schedule', 'workflow_dispatch'])
      expect(judgeReadiness(onPullRequest('sast', { event })).reasons).toEqual([
        'Readiness is only defined for pull_request',
      ]);
    expect(
      judgeReadiness(
        onPullRequest('sast', { payload: { pull_request: { title: 'x' } } }),
      ).passed,
    ).toBe(false);
    expect(judgeReadiness(onPullRequest('sast', { needs: [] })).passed).toBe(
      false,
    );
  });

  test('does not hand a job the port never removed to the policy as skipped', () => {
    const needs = greenNeeds('cli');
    delete needs.build;
    const verdict = judgeReadiness(
      onPullRequest('cli', {
        needs,
        removed: {
          ...removedFor('cli'),
          build: neverRan,
        },
      }),
    );
    // `build` is a job the policy wants to have succeeded: skipping it is a refusal, not a pass
    expect(verdict.passed).toBe(false);
  });
});

describe('parseRemoved', () => {
  const one = JSON.stringify({
    'pr-scope': { result: 'success', outputs: { run: 'true' } },
  });

  test('reads what the generator recorded', () => {
    expect(parseRemoved(one)).toEqual({
      'pr-scope': { result: 'success', outputs: { run: 'true' } },
    });
    expect(parseRemoved('')).toEqual({});
  });

  test('refuses what is not a result', () => {
    expect(() => parseRemoved('[]')).toThrow('not an object');
    expect(() => parseRemoved('{"x":{}}')).toThrow(
      'CI_PORT_REMOVED.x is not a job result',
    );
    expect(() =>
      parseRemoved('{"x":{"result":"failure","outputs":{}}}'),
    ).toThrow('not a job result');
    expect(() =>
      parseRemoved('{"x":{"result":"success","outputs":{"a":1}}}'),
    ).toThrow('not a job result');
    // A result for each kind of run, as the port once recorded it, is not one result.
    expect(() =>
      parseRemoved(
        '{"x":{"pull_request":{"result":"success","outputs":{}},"push":{"result":"skipped","outputs":{}}}}',
      ),
    ).toThrow('not a job result');
  });
});

describe('readInput', () => {
  const env = {
    CI_WORKFLOW: 'sast',
    CI_NEEDS: '{"sast":{"result":"success","outputs":{}}}',
    CI_PORT_REMOVED: '{}',
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: '/tmp/event.json',
    GITHUB_SHA: B,
  };

  test('takes the job environment and the runner event file', () => {
    const read = (path: string) =>
      path === '/tmp/event.json' ? '{"pull_request":{"number":7}}' : '';
    expect(readInput(env, read)).toEqual({
      workflow: 'sast',
      needs: { sast: { result: 'success', outputs: {} } },
      removed: {},
      event: 'pull_request',
      payload: { pull_request: { number: 7 } },
      sha: B,
    });
  });

  test('names what is missing', () => {
    expect(() =>
      readInput({ ...env, CI_NEEDS: undefined }, () => '{}'),
    ).toThrow('CI_NEEDS is not set');
    expect(() => readInput({ ...env, GITHUB_SHA: '' }, () => '{}')).toThrow(
      'GITHUB_SHA is not set',
    );
  });

  test('has no removed jobs when the port removed none', () => {
    expect(
      readInput({ ...env, CI_PORT_REMOVED: undefined }, () => '{}').removed,
    ).toEqual({});
  });
});

describe('renderVerdict', () => {
  test('prints a table, and the reasons when held', () => {
    const held = renderVerdict({
      passed: false,
      reasons: ['sast: expected success, got failure'],
      jobs: [{ job: 'sast', result: 'failure', policy: 'required' }],
    });
    expect(held).toContain('CI readiness: held');
    expect(held).toContain('sast');
    expect(held).toContain('  - sast: expected success, got failure');
    expect(renderVerdict({ passed: true, reasons: [], jobs: [] })).toBe(
      'CI readiness: passed',
    );
  });
});
