import { describe, expect, test } from 'bun:test';

import { BUILD_SERVICES, CI_JOBS, COMPOSE_SERVICES } from '../ci-ready';
import {
  judgeReadiness,
  readInput,
  renderVerdict,
  type ReadyInput,
} from './ready';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

type Job = { result: string; outputs: Record<string, string> };

/** The jobs a Forgejo workflow does not have: the port took them out. */
const REMOVED = ['candidate-source', 'candidate-gate', 'pr-scope', 'release'];

/** A fully green run of one workflow, as `toJSON(needs)` of its ready job on Forgejo. */
function green(workflow: keyof typeof CI_JOBS): Record<string, Job> {
  const needs: Record<string, Job> = {};
  for (const id of CI_JOBS[workflow]) {
    if (REMOVED.includes(id)) continue;
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
    needs['smoke-test-fork'] = { result: 'skipped', outputs: {} };
    needs['image-validate-fork'] = { result: 'skipped', outputs: {} };
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
      ...overrides,
    },
  };
}

function input(
  workflow: keyof typeof CI_JOBS,
  extra: Partial<ReadyInput> = {},
): ReadyInput {
  return {
    workflow,
    needs: green(workflow),
    removed: REMOVED,
    event: 'pull_request',
    payload: pullRequest(),
    sha: B,
    ...extra,
  };
}

describe('judgeReadiness', () => {
  for (const workflow of Object.keys(CI_JOBS) as (keyof typeof CI_JOBS)[]) {
    test(`${workflow}: a green pull request and a green batch are ready`, () => {
      expect(judgeReadiness(input(workflow)).reasons).toEqual([]);
      const batch = judgeReadiness(
        input(workflow, {
          event: 'push',
          payload: { before: '0'.repeat(40), after: B },
        }),
      );
      expect(batch.reasons).toEqual([]);
      expect(batch.passed).toBe(true);
    });

    test(`${workflow}: a job that failed, was cancelled or was skipped holds it`, () => {
      for (const id of Object.keys(green(workflow))) {
        for (const result of ['failure', 'cancelled', 'skipped', '']) {
          const needs = green(workflow);
          const job = needs[id];
          if (!job || job.result === result) continue;
          if (id === 'vulnerability-scan' && result === 'failure') continue;
          job.result = result;
          expect(
            judgeReadiness(input(workflow, { needs })).passed,
            `${id}/${result}`,
          ).toBe(false);
        }
      }
    });

    test(`${workflow}: a job that is neither there nor removed by the port holds it`, () => {
      for (const id of Object.keys(green(workflow))) {
        const needs = green(workflow);
        delete needs[id];
        expect(
          judgeReadiness(input(workflow, { needs })).passed,
          `missing ${id}`,
        ).toBe(false);
      }
    });

    test(`${workflow}: a job nobody classified holds it`, () => {
      const needs = green(workflow);
      needs['new-unclassified-proof'] = { result: 'success', outputs: {} };
      expect(judgeReadiness(input(workflow, { needs })).passed).toBe(false);
    });
  }

  test('does not hold a work-in-progress pull request: the merge train does', () => {
    for (const title of ['WIP: x', '[WIP] x']) {
      expect(
        judgeReadiness(input('commitlint', { payload: pullRequest({ title }) }))
          .passed,
      ).toBe(true);
    }
  });

  test('a pull request from a fork is held with the way out', () => {
    const verdict = judgeReadiness(
      input('commitlint', {
        payload: pullRequest({ head: { sha: B, repo: { fork: true } } }),
      }),
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons[0]).toContain('a maintainer pushes the branch');
  });

  test('an event it cannot describe is held, and so is a pull request with no commits named', () => {
    expect(
      judgeReadiness(input('sast', { event: 'schedule' })).reasons[0],
    ).toContain('only defined for');
    expect(
      judgeReadiness(
        input('sast', { payload: { pull_request: { title: 'x' } } }),
      ).passed,
    ).toBe(false);
    expect(judgeReadiness(input('sast', { needs: [] })).passed).toBe(false);
  });

  test('a batch that is not the commit checked out is held', () => {
    const verdict = judgeReadiness(
      input('sast', {
        event: 'push',
        payload: { before: A, after: B },
        sha: A,
      }),
    );
    expect(verdict.passed).toBe(false);
  });

  test('does not hand a job the port never removed to the policy as skipped', () => {
    const needs = green('cli');
    delete needs.build;
    const verdict = judgeReadiness(
      input('cli', { needs, removed: [...REMOVED, 'build'] }),
    );
    // `build` is a job the policy wants to have succeeded: skipping it is a refusal, not a pass
    expect(verdict.passed).toBe(false);
  });
});

describe('readInput', () => {
  const env = {
    CI_WORKFLOW: 'sast',
    CI_NEEDS: '{"sast":{"result":"success","outputs":{}}}',
    CI_PORT_REMOVED: 'candidate-source,candidate-gate',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_EVENT_PATH: '/tmp/event.json',
    GITHUB_SHA: B,
  };

  test('takes the job environment and the runner event file', () => {
    const read = (path: string) =>
      path === '/tmp/event.json' ? '{"before":"x","after":"y"}' : '';
    expect(readInput(env, read)).toEqual({
      workflow: 'sast',
      needs: { sast: { result: 'success', outputs: {} } },
      removed: ['candidate-source', 'candidate-gate'],
      event: 'push',
      payload: { before: 'x', after: 'y' },
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
    ).toEqual([]);
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
