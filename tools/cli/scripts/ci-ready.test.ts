import { describe, expect, test } from 'bun:test';

import {
  BUILD_SERVICES,
  BUILD_FILTERS,
  buildScope,
  CI_JOBS,
  COMPOSE_SERVICES,
  evaluateReadiness,
  requiresFullScope,
  scopeBoolean,
  validateScope,
} from './ci-ready';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const pr = () => ({
  base: { sha: A },
  head: { sha: B, repo: { fork: false } },
  changed_files: 2,
  draft: false,
});
type Job = { result: string; outputs: Record<string, string> };
function fixture(workflow: keyof typeof CI_JOBS, event = 'pull_request') {
  const needs: Record<string, Job> = Object.fromEntries(
    CI_JOBS[workflow].map((id) => [id, { result: 'success', outputs: {} }]),
  );
  needs['candidate-source']!.result = 'skipped';
  needs['candidate-gate']!.result = 'skipped';
  if (needs.release) needs.release.result = 'skipped';
  if (needs['pr-scope']) {
    needs['pr-scope'].result = event === 'pull_request' ? 'success' : 'skipped';
    needs['pr-scope'].outputs = { run: 'true', full: 'false' };
  }
  if (needs['integration-scope'])
    needs['integration-scope'].outputs = { run: 'true' };
  if (workflow === 'build') {
    needs['smoke-test-fork']!.result = 'skipped';
    needs['image-validate-fork']!.result = 'skipped';
    needs.changes!.outputs = {
      services: JSON.stringify(BUILD_SERVICES),
      scannable_services: JSON.stringify(COMPOSE_SERVICES),
      ci_tests: 'true',
      storybook: 'true',
    };
  }
  return {
    workflow,
    event,
    payload: { pull_request: pr(), merge_group: { base_sha: A, head_sha: C } },
    source: C,
    needs,
  };
}

describe('native CI readiness', () => {
  for (const workflow of Object.keys(CI_JOBS) as (keyof typeof CI_JOBS)[]) {
    test(`${workflow}: ordinary, ready and full merge-group success`, () => {
      for (const event of ['pull_request', 'merge_group']) {
        const input = fixture(workflow, event);
        const verdict = evaluateReadiness(input);
        expect(verdict.reasons).toEqual([]);
        expect(verdict.passed).toBe(true);
        expect(verdict.jobs.map((job) => job.job).toSorted()).toEqual(
          [...CI_JOBS[workflow]].toSorted(),
        );
      }
      const input = fixture(workflow);
      input.payload.pull_request.draft = true;
      expect(evaluateReadiness(input).passed).toBe(false);
      input.payload.pull_request.draft = false;
      expect(evaluateReadiness(input).passed).toBe(true);
    });

    test(`${workflow}: failures, cancellations, missing and unexpected skips fail closed`, () => {
      for (const id of CI_JOBS[workflow]) {
        for (const result of [
          'failure',
          'cancelled',
          'skipped',
          '',
          'neutral',
          'timed_out',
        ]) {
          const input = fixture(workflow);
          const original = input.needs[id]!.result;
          if (
            result === original ||
            (id === 'vulnerability-scan' && result === 'failure')
          )
            continue;
          input.needs[id]!.result = result;
          expect(evaluateReadiness(input).passed, `${id}/${result}`).toBe(
            false,
          );
        }
        const missing = fixture(workflow);
        delete missing.needs[id];
        expect(evaluateReadiness(missing).passed, `missing ${id}`).toBe(false);
      }
      const extra = fixture(workflow);
      extra.needs['new-unclassified-proof'] = {
        result: 'success',
        outputs: {},
      };
      expect(evaluateReadiness(extra).passed).toBe(false);
    });

    test(`${workflow}: a newer native failed rerun cannot borrow a prior success`, () => {
      const input = fixture(workflow);
      expect(evaluateReadiness(input).passed).toBe(true);
      const id = evaluateReadiness(input).jobs.find(
        (job) => job.policy === 'required',
      )!.job;
      input.needs[id]!.result = 'failure';
      expect(evaluateReadiness(input).passed).toBe(false);
      input.needs[id]!.result = 'cancelled';
      expect(evaluateReadiness(input).passed).toBe(false);
      input.needs[id]!.result = 'success';
      expect(evaluateReadiness(input).passed).toBe(true);
    });
  }

  test.each(['build', 'e2e', 'cli', 'security'] as const)(
    '%s: an explicit irrelevant scope permits only the corresponding skips',
    (workflow) => {
      const input = fixture(workflow);
      for (const [id, job] of Object.entries(input.needs)) {
        if (id !== 'pr-scope') job.result = 'skipped';
      }
      input.needs['pr-scope']!.outputs = { run: 'false', full: 'false' };
      expect(evaluateReadiness(input).passed).toBe(true);
      for (const value of ['', 'False', '0', 'null', 'yes']) {
        input.needs['pr-scope']!.outputs.run = value;
        expect(evaluateReadiness(input).passed).toBe(false);
      }
      input.needs['pr-scope']!.outputs = { run: 'false', full: 'true' };
      expect(evaluateReadiness(input).passed).toBe(false);
      input.needs['pr-scope']!.result = 'failure';
      input.needs['pr-scope']!.outputs = { run: 'false', full: 'false' };
      expect(evaluateReadiness(input).passed).toBe(false);
    },
  );

  test('backend integration skips require a successful explicit PR decision', () => {
    const input = fixture('checks');
    input.needs['integration-scope']!.outputs.run = 'false';
    input.needs['backend-integration']!.result = 'skipped';
    expect(evaluateReadiness(input).passed).toBe(true);
    input.event = 'merge_group';
    expect(evaluateReadiness(input).passed).toBe(false);
    input.event = 'pull_request';
    input.needs['integration-scope']!.outputs.run = '';
    expect(evaluateReadiness(input).passed).toBe(false);
    input.needs['integration-scope']!.outputs.run = 'false';
    input.needs['integration-scope']!.result = 'failure';
    expect(evaluateReadiness(input).passed).toBe(false);
  });

  test('fork image builds require both native local alternatives and no publication-dependent check', () => {
    const input = fixture('build');
    input.payload.pull_request.head.repo.fork = true;
    for (const id of ['smoke-test', 'image-validate']) {
      input.needs[id]!.result = 'skipped';
      input.needs[`${id}-fork`]!.result = 'success';
    }
    input.needs['vulnerability-scan']!.result = 'skipped';
    expect(evaluateReadiness(input).passed).toBe(true);
    input.needs['image-validate-fork']!.result = 'failure';
    expect(evaluateReadiness(input).passed).toBe(false);
  });

  test('Build distinguishes outer applicability from its per-service matrix', () => {
    const input = fixture('build');
    input.needs.changes!.outputs = {
      services: '["web"]',
      scannable_services: '[]',
      ci_tests: 'false',
      storybook: 'false',
    };
    for (const id of [
      'docs-test',
      'ui-docs-test',
      'ai-gateway-test',
      'vulnerability-scan',
      'storybook',
    ])
      input.needs[id]!.result = 'skipped';
    expect(evaluateReadiness(input).passed).toBe(true);
    // The existing compose predicate still owes all fixed image legs for web.
    input.needs.build!.result = 'skipped';
    expect(evaluateReadiness(input).passed).toBe(false);
    input.needs.build!.result = 'success';
    input.needs['pr-scope']!.outputs.full = 'true';
    expect(evaluateReadiness(input).passed).toBe(false);
  });

  test('Build allows only its existing image-scan advisory failure without claiming scanner success', () => {
    const input = fixture('build');
    input.needs['vulnerability-scan']!.result = 'failure';
    const verdict = evaluateReadiness(input);
    expect(verdict.passed).toBe(true);
    expect(
      verdict.jobs.find((job) => job.job === 'vulnerability-scan')?.policy,
    ).toContain('advisory');
    for (const result of ['skipped', 'cancelled', 'unknown']) {
      input.needs['vulnerability-scan']!.result = result;
      expect(evaluateReadiness(input).passed).toBe(false);
    }
  });

  test('malformed and incomplete Build scope never means no work', () => {
    for (const key of [
      'services',
      'scannable_services',
      'ci_tests',
      'storybook',
    ]) {
      for (const value of ['', 'null', '{}', '["unknown"]']) {
        const input = fixture('build');
        input.needs.changes!.outputs[key] = value;
        expect(evaluateReadiness(input).passed, `${key}/${value}`).toBe(false);
      }
    }
    const input = fixture('build');
    input.needs.changes!.outputs.scannable_services = '[]';
    expect(evaluateReadiness(input).passed).toBe(false);
  });

  test('source identities, unknown events and candidate lanes are not ordinary readiness', () => {
    for (const event of [
      'push',
      'repository_dispatch',
      'workflow_dispatch',
      '',
    ])
      expect(evaluateReadiness(fixture('checks', event)).passed).toBe(false);
    const input = fixture('checks', 'merge_group');
    input.payload.merge_group.head_sha = B;
    expect(evaluateReadiness(input).passed).toBe(false);
    input.payload.merge_group.head_sha = C;
    input.payload.merge_group.base_sha = '';
    expect(evaluateReadiness(input).passed).toBe(false);
    expect(
      evaluateReadiness({ ...fixture('checks'), needs: null }).passed,
    ).toBe(false);
    expect(
      evaluateReadiness({ ...fixture('checks'), workflow: 'unknown' }).passed,
    ).toBe(false);
  });
});

describe('complete frozen PR scope', () => {
  const scope = () => ({
    frozen: pr(),
    before: pr(),
    after: pr(),
    touched: 'false',
    guard: 'false',
    counted: '2',
    files: '["README.md","LICENSE"]',
    added: 'false',
    deleted: 'false',
  });
  test('literal decisions and rename expansion preserve applicability', () => {
    expect(validateScope(scope())).toEqual({ run: false, full: false });
    expect(validateScope({ ...scope(), touched: 'true' })).toEqual({
      run: true,
      full: false,
    });
    // Two expected API rows, but only one unrelated rename returned: its two
    // expanded paths must never mask the missing security-relevant row.
    expect(
      validateScope({ ...scope(), added: 'true', deleted: 'true' }),
    ).toEqual({ run: true, full: true });
    expect(validateScope({ ...scope(), guard: 'true' })).toEqual({
      run: true,
      full: true,
    });
  });
  test('source/count drift before or after discovery requires full coverage', () => {
    for (const phase of ['before', 'after'] as const) {
      for (const key of ['base', 'head'] as const) {
        const input = scope();
        input[phase][key].sha = C;
        expect(validateScope(input)).toEqual({ run: true, full: true });
      }
      const input = scope();
      input[phase].changed_files = 3;
      expect(validateScope(input).full).toBe(true);
    }
  });
  test('the API truncation boundary is conservative, including exactly 3000', () => {
    for (const count of [3000, 3001, 10000]) {
      const frozen = { ...pr(), changed_files: count };
      expect(requiresFullScope(frozen, frozen)).toBe(true);
    }
    const frozen = { ...pr(), changed_files: 2999 };
    expect(requiresFullScope(frozen, frozen)).toBe(false);
  });
  test('missing/malformed API identity and incomplete discovery fail closed', () => {
    for (const value of ['', null, undefined, true, 'False', '0'])
      expect(() => scopeBoolean(value)).toThrow();
    for (const current of [
      null,
      {},
      { ...pr(), changed_files: -1 },
      { ...pr(), changed_files: '2' },
      { ...pr(), base: { sha: 'main' } },
    ])
      expect(() => requiresFullScope(pr(), current)).toThrow();
    for (const counted of ['', '1', '5', '-1', 'NaN', '9007199254740992'])
      expect(() => validateScope({ ...scope(), counted })).toThrow();
    for (const files of [
      'null',
      '{}',
      '["x","x"]',
      '["../x","y"]',
      '["/x","y"]',
      '["x",2]',
    ])
      expect(() => validateScope({ ...scope(), files })).toThrow();
    expect(() => validateScope({ ...scope(), added: '' })).toThrow();
    expect(() => validateScope({ ...scope(), touched: '' })).toThrow();
    expect(() => validateScope({ ...scope(), guard: '' })).toThrow();
  });

  test('the immutable Build decision contains only validated service and pseudo-filter IDs', () => {
    const filters = Object.fromEntries(
      BUILD_FILTERS.map((name) => [
        name,
        name === 'platform' || name === 'ci_tests' ? 'true' : 'false',
      ]),
    );
    expect(buildScope(filters, false)).toEqual({
      changes: '["platform","ci_tests"]',
      ci_tests: 'true',
      storybook: 'false',
    });
    expect(JSON.parse(buildScope(filters, true).changes)).toEqual(
      BUILD_FILTERS,
    );
    expect(() => buildScope({ ...filters, platform: '' }, false)).toThrow();
    expect(() => buildScope({ ...filters, guard: 'true' }, false)).toThrow();
    delete filters.platform;
    expect(() => buildScope(filters, false)).toThrow();
  });
});
