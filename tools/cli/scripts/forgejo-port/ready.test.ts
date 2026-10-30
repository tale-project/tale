import { describe, expect, test } from 'bun:test';

import { BUILD_SERVICES, CI_JOBS, COMPOSE_SERVICES } from '../ci-ready';
import {
  judgeReadiness,
  parseRemoved,
  readInput,
  renderVerdict,
  type JobResult,
  type ReadyInput,
  type RemovedJob,
} from './ready';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

type Workflow = keyof typeof CI_JOBS;
type Job = { result: string; outputs: Record<string, string> };

const skipped: Job = { result: 'skipped', outputs: {} };
const wasSkipped: JobResult = { result: 'skipped', outputs: {} };
/** A job the port took out that neither kind of run would have run. */
const neverRan: RemovedJob = { pull_request: wasSkipped, push: wasSkipped };

/** The workflows whose scope job a pull request answers from its paths; this one touches them all. */
const SCOPED = new Set<Workflow>([
  'build',
  'e2e',
  'cli',
  'security',
  'sandbox-incus-e2e',
]);

/** What the port took out of each workflow, and what each job would have said. */
function removedFor(workflow: Workflow): Record<string, RemovedJob> {
  const gone: Record<string, RemovedJob> = {
    'candidate-source': neverRan,
    'candidate-gate': neverRan,
  };
  if (workflow === 'cli') gone.release = neverRan;
  if (SCOPED.has(workflow))
    gone['pr-scope'] = {
      pull_request: {
        result: 'success',
        outputs: { run: 'true', full: 'true' },
      },
      push: wasSkipped,
    };
  return gone;
}

/** A fully green batch of one workflow, as `toJSON(needs)` of its ready job on Forgejo. */
function greenBatch(workflow: Workflow): Record<string, Job> {
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
    needs: greenBatch(workflow),
    tier: 'fast',
    removed: removedFor(workflow),
    event: 'pull_request',
    payload: pullRequest(),
    sha: B,
    ...extra,
  };
}

function onBatch(
  workflow: Workflow,
  extra: Partial<ReadyInput> = {},
): ReadyInput {
  return {
    workflow,
    needs: greenBatch(workflow),
    tier: 'fast',
    removed: removedFor(workflow),
    event: 'push',
    payload: { before: '0'.repeat(40), after: B },
    sha: B,
    ...extra,
  };
}

const WORKFLOWS = Object.keys(CI_JOBS) as Workflow[];

describe('judgeReadiness', () => {
  for (const workflow of WORKFLOWS) {
    test(`${workflow}: a green pull request is ready at its own tier`, () => {
      const verdict = judgeReadiness(onPullRequest(workflow));
      expect(verdict.reasons).toEqual([]);
      expect(verdict.passed).toBe(true);
    });

    test(`${workflow}: a green batch is ready at full scope`, () => {
      const verdict = judgeReadiness(onBatch(workflow));
      expect(verdict.reasons).toEqual([]);
      expect(verdict.passed).toBe(true);
    });

    test(`${workflow}: a batch that skipped a job it owes is held`, () => {
      for (const id of Object.keys(greenBatch(workflow))) {
        const needs = greenBatch(workflow);
        const job = needs[id];
        if (!job || job.result === 'skipped') continue;
        for (const result of ['failure', 'cancelled', 'skipped', '']) {
          job.result = result;
          expect(
            judgeReadiness(onBatch(workflow, { needs })).passed,
            `${id}/${result}`,
          ).toBe(false);
        }
      }
    });

    test(`${workflow}: a job that is neither there nor removed by the port holds it`, () => {
      for (const id of Object.keys(greenBatch(workflow))) {
        const needs = greenBatch(workflow);
        delete needs[id];
        expect(
          judgeReadiness(onBatch(workflow, { needs })).passed,
          `missing ${id}`,
        ).toBe(false);
      }
    });

    test(`${workflow}: a job nobody classified holds it`, () => {
      const needs = greenBatch(workflow);
      needs['new-unclassified-proof'] = { result: 'success', outputs: {} };
      expect(judgeReadiness(onBatch(workflow, { needs })).passed).toBe(false);
    });
  }

  for (const workflow of WORKFLOWS) {
    test(`${workflow}: a pull request of the full tier owes what a batch owes`, () => {
      const verdict = judgeReadiness(
        onPullRequest(workflow, { tier: 'full', needs: greenBatch(workflow) }),
      );
      expect(verdict.reasons).toEqual([]);
      expect(verdict.passed).toBe(true);
    });

    test(`${workflow}: a pull request of the full tier is held for a job a batch would not skip`, () => {
      for (const id of Object.keys(greenBatch(workflow))) {
        const needs = greenBatch(workflow);
        const job = needs[id];
        if (!job || job.result === 'skipped') continue;
        job.result = 'skipped';
        expect(
          judgeReadiness(onPullRequest(workflow, { tier: 'full', needs }))
            .passed,
          `${id}`,
        ).toBe(false);
      }
    });
  }

  test('a pull request of either tier is held for a suite it skipped', () => {
    for (const tier of ['fast', 'full'] as const) {
      const needs = greenBatch('checks');
      needs.build = skipped;
      expect(
        judgeReadiness(onPullRequest('checks', { tier, needs })).passed,
        tier,
      ).toBe(false);
    }
  });

  test('a pull request that failed a lane it owes is held', () => {
    const needs = greenBatch('checks');
    needs.lint = { result: 'failure', outputs: {} };
    expect(judgeReadiness(onPullRequest('checks', { needs })).passed).toBe(
      false,
    );
  });

  test('does not hold a work-in-progress pull request: the merge train does', () => {
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

  test('an event it cannot describe is held, and so is a pull request with no commits named', () => {
    expect(
      judgeReadiness(onBatch('sast', { event: 'schedule' })).reasons[0],
    ).toContain('only defined for');
    expect(
      judgeReadiness(
        onPullRequest('sast', { payload: { pull_request: { title: 'x' } } }),
      ).passed,
    ).toBe(false);
    expect(judgeReadiness(onBatch('sast', { needs: [] })).passed).toBe(false);
  });

  test('a batch that is not the commit checked out is held', () => {
    const verdict = judgeReadiness(
      onBatch('sast', { payload: { before: A, after: B }, sha: A }),
    );
    expect(verdict.passed).toBe(false);
  });

  test('does not hand a job the port never removed to the policy as skipped', () => {
    const needs = greenBatch('cli');
    delete needs.build;
    const verdict = judgeReadiness(
      onBatch('cli', {
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
    'pr-scope': {
      pull_request: { result: 'success', outputs: { run: 'false' } },
      push: { result: 'skipped', outputs: {} },
    },
  });

  test('reads what the generator recorded', () => {
    expect(parseRemoved(one)).toEqual({
      'pr-scope': {
        pull_request: { result: 'success', outputs: { run: 'false' } },
        push: { result: 'skipped', outputs: {} },
      },
    });
    expect(parseRemoved('')).toEqual({});
  });

  test('refuses what is not a result', () => {
    expect(() => parseRemoved('[]')).toThrow('not an object');
    expect(() => parseRemoved('{"x":{}}')).toThrow(
      'CI_PORT_REMOVED.x.pull_request is not a job result',
    );
    expect(() =>
      parseRemoved(
        '{"x":{"pull_request":{"result":"failure","outputs":{}},"push":{"result":"skipped","outputs":{}}}}',
      ),
    ).toThrow('not a job result');
    expect(() =>
      parseRemoved(
        '{"x":{"pull_request":{"result":"success","outputs":{"a":1}},"push":{"result":"skipped","outputs":{}}}}',
      ),
    ).toThrow('not a job result');
  });
});

describe('readInput', () => {
  const env = {
    CI_WORKFLOW: 'sast',
    CI_TIER: 'fast',
    CI_NEEDS: '{"sast":{"result":"success","outputs":{}}}',
    CI_PORT_REMOVED: '{}',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_EVENT_PATH: '/tmp/event.json',
    GITHUB_SHA: B,
  };

  test('takes the job environment and the runner event file', () => {
    const read = (path: string) =>
      path === '/tmp/event.json' ? '{"before":"x","after":"y"}' : '';
    expect(readInput(env, read)).toEqual({
      workflow: 'sast',
      tier: 'fast',
      needs: { sast: { result: 'success', outputs: {} } },
      removed: {},
      event: 'push',
      payload: { before: 'x', after: 'y' },
      sha: B,
    });
  });

  test('refuses a tier it does not know', () => {
    expect(() => readInput({ ...env, CI_TIER: 'half' }, () => '{}')).toThrow(
      'CI_TIER is neither fast nor full',
    );
    expect(() => readInput({ ...env, CI_TIER: undefined }, () => '{}')).toThrow(
      'CI_TIER is not set',
    );
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
