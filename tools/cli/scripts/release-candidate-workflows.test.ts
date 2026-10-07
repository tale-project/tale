import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import picomatch from 'picomatch';
import { parse } from 'yaml';

import releaseContract from '../../../.github/release-candidate-contract.json';
import { fixtureGit } from '../src/lib/config/releases/tests/fixture-git';
import {
  admissionAssertions,
  refreshContract,
} from './release-candidate-contract';
import {
  ALWAYS_PUSH_WORKFLOWS,
  CANDIDATE_JOBS,
  FILTERED_PUSH_WORKFLOWS,
} from './release-candidate-gate';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});
type Step = {
  id?: string;
  name?: string;
  run?: string;
  env?: Record<string, string>;
  uses?: string;
  if?: string;
  with?: Record<string, unknown>;
};
type Job = {
  name?: string;
  outputs?: Record<string, string>;
  needs?: string | string[];
  uses?: string;
  if?: string;
  with?: Record<string, unknown>;
  steps?: Step[];
  strategy?: {
    matrix: {
      include?: Record<string, string>[];
      shard?: number[];
      service?: string[] | string;
    };
  };
};
type Workflow = {
  on: Record<string, unknown>;
  'run-name'?: string;
  concurrency?: { group: string; 'cancel-in-progress': string | boolean };
  jobs: Record<string, Job>;
};
const workflow = async (stem: string) =>
  parse(
    await readFile(join(root, '.github/workflows', `${stem}.yml`), 'utf8'),
  ) as Workflow;
const sourceWorkflows = [
  'checks',
  'sast',
  'commitlint',
  'e2e',
  'cli',
  'security',
];
const C = 'c'.repeat(40);
const H = 'd'.repeat(40);

type Result = 'success' | 'failure' | 'cancelled' | 'skipped' | '';
type Admission = {
  github: {
    event_name: string;
    sha: string;
    event: {
      pull_request: {
        draft: boolean;
        head: { repo: { fork: boolean }; sha: string };
      };
    };
  };
  needs: Record<string, { result: Result; outputs: Record<string, string> }>;
  cancelled: boolean;
};
const callers = ['build', ...sourceWorkflows];
const candidateEvent = (stem: string, event: string) =>
  event === 'repository_dispatch' ||
  (stem === 'build' && event === 'workflow_dispatch');
const admission = (file: Workflow, stem: string, event: string): Admission => ({
  github: {
    event_name: event,
    sha: H,
    event: {
      pull_request: {
        draft: false,
        head: { repo: { fork: false }, sha: 'a'.repeat(40) },
      },
    },
  },
  needs: Object.fromEntries(
    Object.keys(file.jobs).map((id) => [
      id,
      {
        result:
          id === 'candidate-source' && !candidateEvent(stem, event)
            ? 'skipped'
            : 'success',
        outputs: {
          services: '["platform","web","docs","ui-docs","ai-gateway"]',
          scannable_services: candidateEvent(stem, event)
            ? '[]'
            : '["platform"]',
          ci_tests: 'true',
          storybook: 'true',
          run: 'true',
          stack: 'true',
          platform: 'true',
          static_services: '["web","docs"]',
          sha: candidateEvent(stem, event) ? C : '',
          candidate_sha: candidateEvent(stem, event) ? C : '',
          source_sha:
            event === 'workflow_dispatch' && stem === 'cli'
              ? 'e'.repeat(40)
              : H,
        },
      },
    ]),
  ),
  cancelled: false,
});

/** Deliberately limited to the boolean/string job predicates below. The
 * fixtures use lowercase strings and booleans, so equality/truthiness match
 * Actions here. This is not an Actions interpreter. Fixtures use empty strings
 * for missing results/outputs and exercise the default skipped-ancestor rule.
 * Reject unsupported syntax instead of silently guessing its semantics. */
function expressionValue(source: string, state: Admission): unknown {
  const expression = source
    .replace(/^\$\{\{\s*|\s*\}\}$/g, '')
    .replace(/\bfromJSON\b/g, 'fromJson')
    .trim();
  const remaining = expression
    .replace(/'(?:[^']|'')*'/g, 'STRING')
    .replace(
      /\b(?:github(?:\.[A-Za-z_][\w-]*)+|needs\.[\w-]+\.(?:result|outputs\.[\w-]+))\b/g,
      'VALUE',
    )
    .replace(
      /\b(?:STRING|VALUE|true|false|always|cancelled|contains|fromJson)\b/g,
      '',
    )
    .replace(/==|!=|&&|\|\||[\s(),!]/g, '');
  if (remaining) throw new Error(`Unsupported admission expression: ${source}`);
  return runInNewContext(
    expression.replace(/needs\.([\w-]+)/g, "needs['$1']"),
    {
      github: state.github,
      needs: state.needs,
      cancelled: () => state.cancelled,
      always: () => true,
      contains: (values: string[], value: string) => values.includes(value),
      fromJson: (value: string) => JSON.parse(value) as unknown,
    },
    { timeout: 100 },
  );
}
function admitted(
  job: Job,
  state: Admission,
  skippedAncestor = false,
): boolean {
  const condition = job.if ?? 'true';
  // Actions adds success() unless the predicate contains a status function.
  if (!/\b(?:always|cancelled|success|failure)\s*\(/.test(condition)) {
    if (
      state.cancelled ||
      skippedAncestor ||
      [job.needs ?? []]
        .flat()
        .some((id) => state.needs[id]?.result !== 'success')
    )
      return false;
  }
  return Boolean(expressionValue(condition, state));
}

describe('ordinary CI source admission', () => {
  test('terminal jobs still execute for failed, cancelled and skipped predecessors on PRs and merge groups', async () => {
    for (const stem of callers) {
      const file = await workflow(stem);
      for (const event of ['pull_request', 'merge_group']) {
        const state = admission(file, stem, event);
        for (const result of ['failure', 'cancelled', 'skipped', ''] as const) {
          for (const job of Object.values(state.needs)) job.result = result;
          state.cancelled = result === 'cancelled';
          expect(
            admitted(file.jobs['ci-ready']!, state, true),
            `${stem}/${event}/${result}`,
          ).toBe(true);
        }
      }
      expect(
        admitted(
          file.jobs['ci-ready']!,
          admission(file, stem, 'repository_dispatch'),
          true,
        ),
      ).toBe(false);
    }
  });

  test('new PR scope must explicitly admit each formerly workflow-filtered root', async () => {
    const roots = {
      build: ['changes'],
      e2e: ['scope'],
      cli: ['prepare', 'build'],
      security: ['bun-audit', 'trivy-fs'],
    };
    for (const [stem, ids] of Object.entries(roots)) {
      const file = await workflow(stem);
      for (const id of ids) {
        const state = admission(file, stem, 'pull_request');
        for (const value of ['', 'false', 'true']) {
          state.needs['pr-scope']!.outputs.run = value;
          expect(
            admitted(file.jobs[id]!, state, true),
            `${stem}/${id}/${value}`,
          ).toBe(value === 'true');
        }
        for (const result of ['failure', 'cancelled', 'skipped', ''] as const) {
          state.needs['pr-scope']!.result = result;
          expect(admitted(file.jobs[id]!, state, true)).toBe(false);
        }
        for (const event of ['merge_group', 'repository_dispatch']) {
          const complete = admission(file, stem, event);
          complete.needs['pr-scope']!.result = 'skipped';
          complete.needs['pr-scope']!.outputs = {};
          expect(admitted(file.jobs[id]!, complete, true)).toBe(true);
        }
      }
    }
  });

  test('E2E consumers inherit the native scope and platform build admission', async () => {
    const file = await workflow('e2e');
    expect(file.jobs.scope!.needs).toEqual(['candidate-source', 'pr-scope']);
    expect(file.jobs.build!.needs).toEqual(['candidate-source', 'scope']);
    expect(file.jobs['static-sites']!.needs).toEqual([
      'candidate-source',
      'scope',
    ]);
    expect(file.jobs.e2e!.needs).toEqual(['candidate-source', 'build']);
    for (const event of [
      'pull_request',
      'merge_group',
      'repository_dispatch',
    ]) {
      for (const result of ['failure', 'cancelled', 'skipped', ''] as const) {
        const state = admission(file, 'e2e', event);
        state.needs.scope!.result = result;
        state.needs.scope!.outputs = {};
        for (const id of ['build', 'static-sites'])
          expect(
            admitted(file.jobs[id]!, state, true),
            `${event}/${id}/${result}`,
          ).toBe(false);
        // An unadmitted platform build is skipped; shards consume its result,
        // not a second PR-discovery decision or an artificial successful scope.
        state.needs.build!.result = 'skipped';
        expect(admitted(file.jobs.e2e!, state, true)).toBe(false);
        const build = admission(file, 'e2e', event);
        build.needs.build!.result = result;
        expect(
          admitted(file.jobs.e2e!, build, true),
          `${event}/build/${result}`,
        ).toBe(false);
      }
    }
    const unaffected = admission(file, 'e2e', 'pull_request');
    unaffected.needs.scope!.outputs = {
      platform: 'false',
      static_services: '[]',
    };
    expect(admitted(file.jobs.build!, unaffected, true)).toBe(false);
    expect(admitted(file.jobs['static-sites']!, unaffected, true)).toBe(false);
  });

  test('the limited evaluator keeps default skip propagation and rejects unsupported syntax', async () => {
    const file = await workflow('checks');
    const state = admission(file, 'checks', 'pull_request');
    expect(admitted({ needs: 'candidate-source' }, state)).toBe(false);
    expect(admitted({ needs: 'build', if: 'true' }, state, true)).toBe(false);
    expect(admitted({ needs: 'build', if: '!cancelled()' }, state, true)).toBe(
      true,
    );
    state.cancelled = true;
    expect(admitted({ needs: 'build', if: '!cancelled()' }, state, true)).toBe(
      false,
    );
    for (const source of [
      "github.event_name = 'push'",
      'success()',
      "startsWith(github.sha, 'c')",
    ])
      expect(() => expressionValue(source, state)).toThrow(
        'Unsupported admission expression',
      );
  });
  test.each(callers)(
    '%s requests a resolver runner only for candidate events',
    async (stem) => {
      const file = await workflow(stem);
      const resolver = file.jobs['candidate-source']!;
      for (const event of Object.keys(file.on)) {
        const state = admission(file, stem, event);
        expect(admitted(resolver, state), `${stem}/${event}`).toBe(
          candidateEvent(stem, event),
        );
        expect(expressionValue(String(resolver.with?.candidate), state)).toBe(
          candidateEvent(stem, event),
        );
        state.cancelled = true;
        expect(admitted(resolver, state)).toBe(false);
      }
    },
  );

  test('all ordinary job definitions survive an intentionally skipped ancestor', async () => {
    let count = 0;
    for (const stem of callers) {
      const file = await workflow(stem);
      for (const [id, job] of Object.entries(file.jobs)) {
        if (
          [
            'candidate-source',
            'candidate-gate',
            'ci-ready',
            'pr-scope',
          ].includes(id)
        )
          continue;
        count++;
        for (const event of Object.keys(file.on)) {
          const state = admission(file, stem, event);
          state.github.event.pull_request.head.repo.fork = id.endsWith('-fork');
          const expected =
            !(id.endsWith('-fork') && candidateEvent(stem, event)) &&
            !(
              stem === 'build' &&
              id === 'vulnerability-scan' &&
              candidateEvent(stem, event)
            ) &&
            !(
              stem === 'cli' &&
              id === 'release' &&
              event !== 'workflow_dispatch'
            );
          if (candidateEvent(stem, event))
            state.github.event.pull_request.head.repo.fork = false;
          expect(
            admitted(job, state, !candidateEvent(stem, event)),
            `${stem}/${id}/${event}`,
          ).toBe(expected);
          state.cancelled = true;
          expect(admitted(job, state, true), `${stem}/${id} cancelled`).toBe(
            stem === 'checks' && ['test', 'test-ui'].includes(id),
          );
        }
      }
    }
    expect(count).toBe(37);
  });

  test('direct source disposition and every other required predecessor fail closed', async () => {
    for (const stem of callers) {
      const file = await workflow(stem);
      for (const [id, job] of Object.entries(file.jobs)) {
        if (
          [
            'candidate-source',
            'candidate-gate',
            'ci-ready',
            'pr-scope',
          ].includes(id)
        )
          continue;
        const dependencies = [job.needs ?? []].flat();
        for (const event of [
          'pull_request',
          'repository_dispatch',
          'workflow_dispatch',
        ]) {
          for (const dependency of dependencies) {
            for (const result of [
              'success',
              'failure',
              'cancelled',
              'skipped',
              '',
            ] as const) {
              const state = admission(file, stem, event);
              state.github.event.pull_request.head.repo.fork =
                id.endsWith('-fork') && !candidateEvent(stem, event);
              state.needs[dependency]!.result = result;
              if (result !== 'success')
                for (const key of Object.keys(state.needs[dependency]!.outputs))
                  state.needs[dependency]!.outputs[key] = '';
              const publication =
                stem !== 'cli' ||
                id !== 'release' ||
                event === 'workflow_dispatch';
              const valid =
                dependency === 'candidate-source'
                  ? result ===
                    (candidateEvent(stem, event) ? 'success' : 'skipped')
                  : dependency === 'pr-scope'
                    ? event !== 'pull_request' || result === 'success'
                    : dependency === 'integration-scope' ||
                      (stem === 'checks' &&
                        id === 'test-ui' &&
                        dependency === 'test-ui-shards') ||
                      (stem === 'checks' &&
                        id === 'test' &&
                        ['test-platform-shards', 'test-workspaces'].includes(
                          dependency,
                        )) ||
                      result === 'success';
              expect(
                admitted(job, state, true),
                `${stem}/${id}/${event}/${dependency}/${result}`,
              ).toBe(
                valid &&
                  publication &&
                  !(id.endsWith('-fork') && candidateEvent(stem, event)) &&
                  !(
                    stem === 'build' &&
                    id === 'vulnerability-scan' &&
                    candidateEvent(stem, event)
                  ),
              );
            }
          }
        }
      }
    }
  });

  test('draft, fork, path and integration-scope decisions remain effective', async () => {
    for (const stem of callers) {
      const file = await workflow(stem);
      const state = admission(file, stem, 'pull_request');
      state.github.event.pull_request.draft = true;
      for (const [id, job] of Object.entries(file.jobs)) {
        if (
          [
            'candidate-source',
            'candidate-gate',
            'ci-ready',
            'pr-scope',
          ].includes(id)
        )
          continue;
        const draftRuns =
          stem === 'cli'
            ? id !== 'release'
            : stem === 'checks'
              ? ![
                  'test-ui',
                  'test-ui-shards',
                  'test-browser',
                  'backend-integration',
                ].includes(id)
              : stem === 'build' &&
                ['changes', 'vulnerability-scan'].includes(id);
        expect(admitted(job, state, true), `${stem}/${id} draft`).toBe(
          draftRuns,
        );
      }
    }
    const build = await workflow('build');
    const state = admission(build, 'build', 'pull_request');
    for (const fork of [false, true]) {
      state.github.event.pull_request.head.repo.fork = fork;
      expect(admitted(build.jobs.build!, state, true)).toBe(!fork);
      for (const id of ['smoke-test', 'image-validate']) {
        expect(admitted(build.jobs[id]!, state, true)).toBe(!fork);
        expect(admitted(build.jobs[`${id}-fork`]!, state, true)).toBe(fork);
      }
      expect(admitted(build.jobs['vulnerability-scan']!, state, true)).toBe(
        !fork,
      );
    }
    state.needs.changes!.outputs = {
      ...state.needs.changes!.outputs,
      services: '[]',
      scannable_services: '[]',
      ci_tests: 'false',
      storybook: 'false',
      stack: 'false',
    };
    for (const [id, job] of Object.entries(build.jobs)) {
      if (
        ![
          'candidate-source',
          'candidate-gate',
          'changes',
          'ci-ready',
          'pr-scope',
        ].includes(id)
      )
        expect(admitted(job, state, true), `unchanged ${id}`).toBe(false);
    }
    const checks = await workflow('checks');
    const scope = admission(checks, 'checks', 'pull_request');
    scope.needs['integration-scope']!.outputs.run = 'false';
    expect(admitted(checks.jobs['backend-integration']!, scope, true)).toBe(
      false,
    );
    scope.needs['integration-scope']!.result = 'failure';
    // Admission is deliberate: the existing first step reports the failed
    // scope and fails the job, rather than recording a successful skip.
    expect(admitted(checks.jobs['backend-integration']!, scope, true)).toBe(
      true,
    );
  });

  test('Build uses the event merge SHA and CLI keeps its resolved publication tag', async () => {
    const build = await workflow('build');
    for (const event of [
      'push',
      'pull_request',
      'merge_group',
      'repository_dispatch',
      'workflow_dispatch',
    ]) {
      const state = admission(build, 'build', event);
      expect(
        expressionValue(build.jobs.changes!.outputs!.source_sha!, state),
      ).toBe(candidateEvent('build', event) ? C : H);
      expect(
        expressionValue(build.jobs.changes!.outputs!.candidate_sha!, state),
      ).toBe(candidateEvent('build', event) ? C : '');
    }
    const cli = await workflow('cli');
    const ref = String(
      cli.jobs.build!.steps!.find((entry) => entry.name === 'Checkout')!.with!
        .ref,
    );
    for (const event of [
      'pull_request',
      'repository_dispatch',
      'workflow_dispatch',
    ]) {
      expect(expressionValue(ref, admission(cli, 'cli', event))).toBe(
        event === 'repository_dispatch'
          ? C
          : event === 'workflow_dispatch'
            ? 'e'.repeat(40)
            : H,
      );
    }
  });
});

describe('push workflows used to detect contradictory arrival evidence', () => {
  const pushTrigger = async (path: string) =>
    (
      await workflow(
        path
          .split('/')
          .at(-1)!
          .replace(/\.yml$/, ''),
      )
    ).on.push as
      | { branches?: string[]; paths?: string[]; 'paths-ignore'?: string[] }
      | undefined;

  test.each([...ALWAYS_PUSH_WORKFLOWS])(
    'GitHub runs %s for every push to main: no path filter',
    async (path) => {
      const push = await pushTrigger(path);
      expect(push?.branches).toContain('main');
      expect(push?.paths).toBeUndefined();
      expect(push?.['paths-ignore']).toBeUndefined();
    },
  );

  test.each([...FILTERED_PUSH_WORKFLOWS])(
    '%s runs for a push to main only as its path filter decides',
    async (path) => {
      const push = await pushTrigger(path);
      expect(push?.branches).toContain('main');
      expect(push?.paths?.length).toBeGreaterThan(0);
    },
  );
});

describe('one candidate event reuses the complete existing validation', () => {
  for (const stem of sourceWorkflows) {
    test(`${stem} accepts the existing event, pins every checkout and keeps candidate concurrency separate`, async () => {
      const file = await workflow(stem);
      expect(file.on.repository_dispatch).toEqual({
        types: ['release-candidate'],
      });
      expect(file['run-name']).toContain("format('Release candidate {0}'");
      expect(file.concurrency?.group).toContain("format('candidate-{0}'");
      expect(file.concurrency?.['cancel-in-progress']).toContain(
        "github.event_name != 'repository_dispatch'",
      );
      expect(file.jobs['candidate-source']?.uses).toBe(
        './.github/workflows/release-candidate-source.yml',
      );
      expect(file.jobs['candidate-source']?.with?.candidate_sha).toBe(
        '${{ github.event.client_payload.candidate_sha }}',
      );
      for (const [id, job] of Object.entries(file.jobs)) {
        if (['ci-ready', 'pr-scope'].includes(id)) continue;
        for (const step of job.steps ?? []) {
          if (step.uses?.startsWith('actions/checkout@')) {
            expect(step.with?.ref).toContain(
              'needs.candidate-source.outputs.candidate_sha',
            );
            expect([job.needs].flat()).toContain('candidate-source');
          }
        }
      }
      const receipt = file.jobs['candidate-gate']!;
      expect(receipt.uses).toBe(
        './.github/workflows/release-candidate-receipt.yml',
      );
      expect(receipt.if).toBe(
        "always() && github.event_name == 'repository_dispatch'",
      );
      expect(receipt.with?.workflow).toBe(`.github/workflows/${stem}.yml`);
      const upstream = Object.keys(file.jobs).filter(
        (id) =>
          !['candidate-gate', 'ci-ready', 'pr-scope'].includes(id) &&
          !(stem === 'cli' && id === 'release'),
      );
      expect([receipt.needs].flat().toSorted()).toEqual(upstream.toSorted());
      expect([receipt.needs].flat().toSorted()).toEqual(
        CANDIDATE_JOBS[stem]!.ids.toSorted(),
      );
      expect(receipt.with?.jobs).toBe('${{ toJSON(needs) }}');
    });
  }

  test('required receipt job names match every existing matrix leg and reusable job', async () => {
    for (const stem of sourceWorkflows) {
      const file = await workflow(stem);
      const names: string[] = [];
      for (const [id, job] of Object.entries(file.jobs)) {
        if (
          ['ci-ready', 'pr-scope'].includes(id) ||
          (stem === 'cli' && id === 'release')
        )
          continue;
        if (job.uses) {
          const called = await workflow(
            job.uses.split('/').at(-1)!.replace('.yml', ''),
          );
          for (const nested of Object.values(called.jobs))
            names.push(`${job.name} / ${nested.name}`);
        } else if (job.strategy) {
          const matrix = job.strategy.matrix;
          const services =
            typeof matrix.service === 'string'
              ? (expressionValue(
                  matrix.service,
                  admission(file, stem, 'repository_dispatch'),
                ) as string[])
              : matrix.service;
          const entries =
            matrix.include ??
            matrix.shard?.map((shard) => ({ shard })) ??
            services!.map((service) => ({ service }));
          for (const entry of entries)
            names.push(
              job.name!.replace(
                /\$\{\{ matrix\.(\w+) \}\}/g,
                (_match, key: string) =>
                  String(entry[key as keyof typeof entry]),
              ),
            );
        } else names.push(job.name!);
      }
      expect(names.toSorted(), stem).toEqual(
        CANDIDATE_JOBS[stem]!.names.toSorted(),
      );
    }
  });

  test('normal events and publication remain separate from candidate validation', async () => {
    for (const stem of sourceWorkflows)
      expect((await workflow(stem)).on.pull_request).toBeDefined();
    for (const stem of ['checks', 'sast', 'commitlint', 'cli', 'security'])
      expect((await workflow(stem)).on.push).toBeDefined();
    for (const stem of ['sast', 'e2e', 'security']) {
      expect((await workflow(stem)).on.schedule).toBeDefined();
      expect(
        Object.hasOwn((await workflow(stem)).on, 'workflow_dispatch'),
      ).toBe(true);
    }
    const cli = await workflow('cli');
    expect(cli.jobs.release?.if).toContain(
      "github.event_name == 'workflow_dispatch'",
    );
    expect(cli.jobs.release?.if).toContain("needs.build.result == 'success'");
    expect(
      cli.jobs.build?.steps?.find((step) => step.name === 'Checkout')?.with
        ?.ref,
    ).toBe(
      '${{ needs.candidate-source.outputs.candidate_sha || needs.prepare.outputs.source_sha || github.sha }}',
    );
    expect(cli.jobs.prepare?.outputs?.source_sha).toBe(
      '${{ steps.version.outputs.source_sha }}',
    );
  });

  test('candidate scans remain blocking without uploading SARIF against moving main', async () => {
    for (const stem of ['sast', 'security']) {
      const file = await workflow(stem);
      const uploads = Object.values(file.jobs)
        .flatMap((job) => job.steps ?? [])
        .filter((step) =>
          step.uses?.startsWith('github/codeql-action/upload-sarif@'),
        );
      expect(uploads.length).toBeGreaterThan(0);
      for (const step of uploads)
        expect(step.if).toContain("github.event_name != 'repository_dispatch'");
    }
    const security = await workflow('security');
    expect(
      security.jobs['trivy-fs']?.steps?.find(
        (step) => step.name === 'Trivy vulnerability gate (HIGH/CRITICAL)',
      )?.with?.['exit-code'],
    ).toBe('1');
    expect(
      security.jobs['bun-audit']?.steps?.find(
        (step) => step.name === 'Gate on high/critical advisories',
      )?.run,
    ).toContain('exit 1');
    expect(
      (await workflow('sast')).jobs.sast?.steps?.find(
        (step) => step.name === 'Run Opengrep',
      )?.run,
    ).toContain('bash tools/opengrep/run.sh');
    const sast = await workflow('sast');
    const report = sast.jobs.sast!.steps!.find(
      (step) => step.name === 'Run Opengrep',
    )!.env!.OPENGREP_SARIF_OUTPUT!;
    for (const event of ['push', 'pull_request', 'repository_dispatch']) {
      expect(expressionValue(report, admission(sast, 'sast', event))).toBe(
        event === 'repository_dispatch' ? '' : 'opengrep.sarif',
      );
    }
  });
});

test('the Build receipt contract covers its complete existing graph too', async () => {
  const file = await workflow('build');
  expect([file.jobs['candidate-gate']!.needs].flat().toSorted()).toEqual(
    CANDIDATE_JOBS.build!.ids.toSorted(),
  );
});

async function execute(script: string, environment: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), 'tale-candidate-workflow-'));
  temporary.push(directory);
  const output = join(directory, 'output');
  const summary = join(directory, 'summary');
  await writeFile(output, '');
  await writeFile(summary, '');
  await writeFile(
    join(directory, 'gh'),
    '#!/bin/sh\nprintf "%s\\n" "$COMPARE_STATUS"\n',
    { mode: 0o755 },
  );
  await writeFile(
    join(directory, 'bunx'),
    '#!/bin/sh\nprintf "args=%s\\n" "$*" >> "$GITHUB_OUTPUT"\nif [ "$*" = "commitlint --verbose" ]; then cat >> "$GITHUB_OUTPUT"; fi\n',
    { mode: 0o755 },
  );
  const process = Bun.spawn(['/bin/bash', '-c', script], {
    cwd: directory,
    env: {
      ...globalThis.process.env,
      PATH: `${directory}:${globalThis.process.env.PATH}`,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      ...environment,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return {
    code,
    stdout,
    stderr,
    output: await readFile(output, 'utf8'),
    directory,
  };
}

test.skipIf(process.platform === 'win32')(
  'candidate C predating the PR scope helper still owes backend integration from workflow H',
  async () => {
    const job = (await workflow('checks')).jobs['integration-scope']!;
    const complete = job.steps?.find((step) => step.id === 'complete');
    expect(complete?.if).toBe("github.event_name != 'pull_request'");
    expect(job.outputs?.run).toBe(
      '${{ steps.complete.outputs.run || steps.decide.outputs.run }}',
    );
    for (const step of job.steps ?? []) {
      if (step.uses)
        expect(step.if).toBe("github.event_name == 'pull_request'");
    }
    // execute() starts in an empty temporary checkout with no local helpers.
    const result = await execute(complete!.run!, {
      EVENT_NAME: 'repository_dispatch',
    });
    expect(result.code, result.stderr).toBe(0);
    expect(result.output).toBe('run=true\n');
  },
);

test.skipIf(process.platform === 'win32')(
  'source helper pins C while normal events keep H; malformed/foreign sources fail before jobs',
  async () => {
    const step = (
      await workflow('release-candidate-source')
    ).jobs.source?.steps?.find((entry) => entry.name === 'Resolve source');
    expect(step?.run).toBeDefined();
    for (const [candidate, sha, status, expected] of [
      ['true', C, 'ahead', 0],
      ['true', C, 'identical', 0],
      ['true', C, 'behind', 1],
      ['true', C, 'diverged', 1],
      ['true', '', 'ahead', 1],
      ['true', 'main', 'ahead', 1],
      ['true', `${C}\n`, 'ahead', 1],
      ['false', '', '', 0],
    ] as const) {
      const result = await execute(step!.run!, {
        IS_CANDIDATE: candidate,
        CANDIDATE_SHA: sha,
        COMPARE_STATUS: status,
        GITHUB_SHA: H,
        REPOSITORY: 'synthetic/tale',
      });
      expect(result.code, result.stdout + result.stderr).toBe(expected);
      expect(result.output).toBe(
        expected
          ? ''
          : `sha=${candidate === 'true' ? C : H}\ncandidate_sha=${candidate === 'true' ? C : ''}\n`,
      );
    }
  },
);

test.skipIf(process.platform === 'win32')(
  'receipt records exact attempt and refuses every failed, skipped, cancelled or missing dependency',
  async () => {
    const step = (
      await workflow('release-candidate-receipt')
    ).jobs.receipt?.steps?.find((entry) => entry.name === 'Record receipt');
    expect(step?.run).toBeDefined();
    for (const result of ['success', 'failure', 'skipped', 'cancelled', '']) {
      const execution = await execute(step!.run!, {
        CANDIDATE_SHA: C,
        WORKFLOW: '.github/workflows/checks.yml',
        WORKFLOW_SHA: H,
        NEEDS: JSON.stringify({
          'candidate-source': { result: 'success' },
          format: { result },
        }),
        RUN_ID: '77',
        RUN_ATTEMPT: '2',
        RUN_URL: 'https://github.com/synthetic/tale/actions/runs/77',
        EVENT_NAME: 'repository_dispatch',
        DISPATCH_REF: 'refs/heads/main',
        DISPATCH_SHA: H,
      });
      expect(execution.code).toBe(result === 'success' ? 0 : 1);
      const receipt = JSON.parse(
        await readFile(
          join(execution.directory, 'release-candidate.json'),
          'utf8',
        ),
      );
      expect(receipt).toMatchObject({
        schemaVersion: 1,
        workflow: '.github/workflows/checks.yml',
        candidate: C,
        verdict: result === 'success' ? 'passed' : 'failed',
        run: { id: '77', attempt: '2', workflowSha: H, sha: H },
        jobs: { format: result },
      });
    }
  },
);

test.skipIf(process.platform === 'win32')(
  'candidate commitlint reads C even when workflow head H and push metadata differ',
  async () => {
    const step = (await workflow('commitlint')).jobs.commitlint?.steps?.find(
      (entry) => entry.name === 'Run commitlint',
    );
    expect(step?.env?.CANDIDATE_SHA).toBe(
      '${{ needs.candidate-source.outputs.candidate_sha }}',
    );
    const setup = `set -euo pipefail
git init -q
git -c user.name='Synthetic test' -c user.email='test@example.invalid' commit -q --allow-empty -m 'fix: candidate source message'
CANDIDATE_SHA=$(git rev-parse HEAD)
git -c user.name='Synthetic test' -c user.email='test@example.invalid' commit -q --allow-empty -m 'chore: unrelated workflow head message'
PUSH_SHA=$(git rev-parse HEAD)
PUSH_BEFORE="$PUSH_SHA"
`;
    const result = await execute(setup + step!.run!, {
      EVENT_NAME: 'repository_dispatch',
    });
    expect(result.code, result.stderr).toBe(0);
    expect(result.output).toBe(
      'args=commitlint --verbose\nfix: candidate source message\n\n',
    );
    expect(result.output).not.toContain('unrelated workflow');
    const missing = await execute(step!.run!, {
      EVENT_NAME: 'repository_dispatch',
      CANDIDATE_SHA: C,
    });
    expect(missing.code).not.toBe(0);
  },
);

test.skipIf(process.platform === 'win32')(
  'merge-group commitlint validates its actual source range, never a synthetic last commit',
  async () => {
    const step = (await workflow('commitlint')).jobs.commitlint?.steps?.find(
      (entry) => entry.name === 'Run commitlint',
    );
    expect(step?.env?.GROUP_BASE).toBe(
      '${{ github.event.merge_group.base_sha }}',
    );
    expect(step?.env?.GROUP_HEAD).toBe(
      '${{ github.event.merge_group.head_sha }}',
    );
    const environment = {
      EVENT_NAME: 'merge_group',
      GROUP_BASE: C,
      GROUP_HEAD: H,
      PUSH_SHA: H,
    };
    const valid = await execute(step!.run!, environment);
    expect(valid.code, valid.stderr).toBe(0);
    expect(valid.output).toBe(
      `args=commitlint --from ${C} --to ${H} --verbose\n`,
    );
    for (const override of [
      { GROUP_BASE: '' },
      { GROUP_HEAD: '' },
      { GROUP_HEAD: 'main' },
      { PUSH_SHA: C },
    ]) {
      const result = await execute(step!.run!, { ...environment, ...override });
      expect(result.code).not.toBe(0);
      expect(result.output).toBe('');
    }
  },
);

test.skipIf(process.platform === 'win32')(
  'commitlint retains normal PR, push and history-less push ranges',
  async () => {
    const step = (await workflow('commitlint')).jobs.commitlint?.steps?.find(
      (entry) => entry.name === 'Run commitlint',
    );
    for (const [event, before, expected] of [
      ['pull_request', '', 'commitlint --from base --to head --verbose'],
      [
        'push',
        'before',
        'commitlint --from before --to workflow-head --verbose',
      ],
      ['push', '', 'commitlint --last --verbose'],
      ['push', '0'.repeat(40), 'commitlint --last --verbose'],
    ]) {
      const result = await execute(step!.run!, {
        EVENT_NAME: event!,
        PUSH_BEFORE: before!,
        PUSH_SHA: 'workflow-head',
        PR_BASE: 'base',
        PR_HEAD: 'head',
      });
      expect(result.code, result.stderr).toBe(0);
      expect(result.output).toBe(`args=${expected}\n`);
    }
  },
);

test.skipIf(process.platform === 'win32').each(['lightweight', 'annotated'])(
  'CLI tag publication binds the exact %s tag to the workflow commit before building',
  async (kind) => {
    const step = (await workflow('cli')).jobs.prepare?.steps?.find(
      (entry) => entry.name === 'Resolve version',
    );
    const setup = `set -euo pipefail
git init -q
git -c user.name='Synthetic test' -c user.email='test@example.invalid' commit -q --allow-empty -m 'fix: release source'
GITHUB_SHA=$(git rev-parse HEAD)
printf '%s' "$GITHUB_SHA" > expected-source
${kind === 'annotated' ? "git -c user.name='Synthetic test' -c user.email='test@example.invalid' tag -a v0.5.64 -m release" : 'git tag v0.5.64'}
git -c user.name='Synthetic test' -c user.email='test@example.invalid' commit -q --allow-empty -m 'fix: different source'
git tag v0.5.65
cat > gh <<'GH'
#!/bin/sh
[ "$1" = api ] && [ "$2" = 'repos/synthetic/tale/commits/refs%2Ftags%2Fv0.5.64' ] && [ "$3" = --jq ] && [ "$4" = .sha ] || exit 1
git rev-parse 'refs/tags/v0.5.64^{commit}'
GH
chmod +x gh
`;
    for (const [ref, tag, suffix, expected] of [
      ['refs/tags/v0.5.64', 'v0.5.64', '', 0],
      ['refs/tags/v0.5.64', 'v0.5.65', '', 1],
      ['refs/tags/v0.5.64', 'v0.5.64', 'GITHUB_SHA=$(git rev-parse HEAD)\n', 1],
      ['refs/heads/main', 'v0.5.64', '', 0],
      ['refs/heads/manual-recovery', 'v0.5.64', '', 0],
    ] as const) {
      const result = await execute(
        setup +
          suffix +
          step!.run! +
          (expected === 0
            ? `
publication_source=$(sed -n 's/^source_sha=//p' "$GITHUB_OUTPUT")
# Only this test's synthetic repository changes; the prepared source stays C.
git tag -f v0.5.64 HEAD > /dev/null
git checkout -q --detach "$publication_source"
[ "$(git rev-parse HEAD)" = "$(cat expected-source)" ]
`
            : ''),
        {
          EVENT_NAME: 'workflow_dispatch',
          RELEASE_TAG: tag,
          GITHUB_REF: ref,
          REPOSITORY: 'synthetic/tale',
        },
      );
      expect(result.code, `${ref}/${tag}: ${result.stderr}`).toBe(expected);
      const source = await readFile(
        join(result.directory, 'expected-source'),
        'utf8',
      );
      expect(result.output).toBe(
        expected ? '' : `version=0.5.64\nsource_sha=${source}\n`,
      );
    }
  },
);

test('admission assertions close field shapes and bind inherited execution selectors', () => {
  const source = {
    name: 'Presentation',
    on: { push: { branches: ['main'] } },
    defaults: { run: { shell: 'bash', 'working-directory': 'tools/cli' } },
    permissions: { contents: 'read' },
    jobs: {
      check: {
        name: 'Required check',
        'runs-on': 'ubuntu-latest',
        defaults: { run: { shell: 'bash -e {0}' } },
        permissions: { contents: 'read' },
        'timeout-minutes': 10,
        container: { image: 'pinned-image' },
        services: { db: { image: 'pinned-db' } },
        environment: 'validation',
        steps: [
          {
            name: 'Presentation',
            run: 'check',
            shell: 'bash',
            'working-directory': '.',
          },
        ],
      },
      reusable: { uses: './.github/workflows/required.yml' },
    },
  };
  const assertions = admissionAssertions(source);
  expect(assertions).toContainEqual({
    path: [],
    kind: 'keys',
    expected: ['defaults', 'jobs', 'name', 'on', 'permissions'],
  });
  expect(assertions).toContainEqual({
    path: ['defaults'],
    kind: 'value',
    expected: source.defaults,
  });
  expect(assertions).toContainEqual({
    path: ['jobs', 'check', 'defaults'],
    kind: 'value',
    expected: source.jobs.check.defaults,
  });
  expect(assertions).toContainEqual({
    path: ['jobs', 'check', 'steps', 0],
    kind: 'keys',
    expected: ['name', 'run', 'shell', 'working-directory'],
  });
  expect(assertions).toContainEqual({
    path: ['jobs', 'check', 'steps', 0, 'shell'],
    kind: 'value',
    expected: 'bash',
  });
  expect(assertions).toContainEqual({
    path: ['jobs', 'check', 'steps', 0, 'working-directory'],
    kind: 'value',
    expected: '.',
  });
  expect(assertions).toContainEqual({
    path: ['jobs', 'reusable'],
    kind: 'keys',
    expected: ['uses'],
  });
  const edited = structuredClone(source);
  edited.name = 'Reviewed presentation';
  edited.jobs.check.steps[0]!.name = 'Reviewed step presentation';
  edited.jobs.check.steps[0]!.run = "check && printf 'reviewed body marker\\n'";
  expect(admissionAssertions(edited)).toEqual(assertions);
  edited.defaults.run.shell = 'echo {0}';
  expect(admissionAssertions(edited)).not.toEqual(assertions);
  const jobDefault = structuredClone(source);
  jobDefault.jobs.check.defaults.run.shell = 'echo {0}';
  expect(admissionAssertions(jobDefault)).not.toEqual(assertions);
  const stepShell = structuredClone(source);
  stepShell.jobs.check.steps[0]!.shell = 'echo {0}';
  expect(admissionAssertions(stepShell)).not.toEqual(assertions);
  const stepDirectory = structuredClone(source);
  stepDirectory.jobs.check.steps[0]!['working-directory'] = '/tmp';
  expect(admissionAssertions(stepDirectory)).not.toEqual(assertions);
});

test('the shared source descriptor binds the full admission graph and event-specific jobs', async () => {
  expect(releaseContract.schemaVersion).toBe(1);
  expect(await refreshContract(root)).toEqual(releaseContract);
  expect(releaseContract.requiredWorkflows.toSorted()).toEqual(
    sourceWorkflows.map((stem) => `.github/workflows/${stem}.yml`).toSorted(),
  );
  expect(Object.keys(releaseContract.sourceWorkflows).toSorted()).toEqual(
    sourceWorkflows.map((stem) => `${stem}.yml`).toSorted(),
  );
  for (const stem of sourceWorkflows) {
    const file = await workflow(stem);
    const contract =
      releaseContract.sourceWorkflows[
        `${stem}.yml` as keyof typeof releaseContract.sourceWorkflows
      ];
    expect<ReturnType<typeof admissionAssertions>>(
      contract.assertions,
      stem,
    ).toEqual(admissionAssertions(file as unknown as Record<string, unknown>));
    const prOnly = ['pr-scope', 'ci-ready']
      .filter((id) => file.jobs[id])
      .map((id) => file.jobs[id]!.name!);
    const skipped = [
      ...prOnly,
      ...(stem === 'cli' ? ['Attach to release'] : []),
    ];
    expect(contract.candidateSkipped, stem).toEqual(skipped);
    expect(contract.normal, stem).toEqual({
      success: CANDIDATE_JOBS[stem]!.names.filter(
        (name) =>
          ![
            'Candidate source / Resolve source',
            'Candidate gate / Record receipt',
          ].includes(name),
      ),
      skipped: ['Candidate source', 'Candidate gate', ...skipped],
    });
    expect(contract.events, stem).toEqual(
      ['push', 'schedule', 'workflow_dispatch'].filter(
        (event) =>
          Object.hasOwn(file.on, event) &&
          !(stem === 'cli' && event === 'workflow_dispatch'),
      ),
    );
  }
  const cli = releaseContract.sourceWorkflows['cli.yml'];
  expect(cli.publication).toEqual({
    success: [...cli.normal.success, 'Attach to release'],
    skipped: cli.normal.skipped.filter((name) => name !== 'Attach to release'),
  });
  for (const [path, digest] of Object.entries(releaseContract.helpers))
    expect(
      createHash('sha256')
        .update(await readFile(join(root, path)))
        .digest('hex'),
      path,
    ).toBe(digest);
});

test('helper hashes survive an autocrlf checkout only with the repository attributes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'release-helper-eol-'));
  temporary.push(directory);
  const globalAttributes = join(directory, 'empty-global-attributes');
  await writeFile(globalAttributes, '');
  const git = fixtureGit(directory, {
    command: [
      'git',
      '-c',
      'core.autocrlf=true',
      '-c',
      'core.safecrlf=false',
      '-c',
      `core.attributesFile=${globalAttributes}`,
    ],
  });
  git('init', '--quiet');
  const attributes = await readFile(join(root, '.gitattributes'));
  await writeFile(join(directory, '.gitattributes'), attributes);
  const paths = Object.keys(releaseContract.helpers);
  for (const path of paths) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), await readFile(join(root, path)));
  }
  git('add', '--', '.gitattributes', ...paths);
  for (const withAttributes of [true, false]) {
    // Checkout reads attributes from the index first, so change only that
    // entry for the negative control. Both helper blobs remain identical.
    await writeFile(
      join(directory, '.gitattributes'),
      withAttributes ? attributes : '',
    );
    git('add', '--', '.gitattributes');
    for (const path of paths) await rm(join(directory, path));
    git('checkout-index', '--force', '--', ...paths);
    for (const [path, digest] of Object.entries(releaseContract.helpers)) {
      const bytes = await readFile(join(directory, path));
      const actual = createHash('sha256').update(bytes).digest('hex');
      expect(bytes.includes('\r\n'), path).toBe(!withAttributes);
      if (withAttributes) expect(actual, path).toBe(digest);
      else expect(actual, path).not.toBe(digest);
    }
  }
});

test('source contract edits trigger native CI and invalidate CLI caches', async () => {
  const filters = parse(
    await readFile(join(root, '.github/ci-scope.yml'), 'utf8'),
  ) as Record<string, string[]>;
  const build = await workflow('build');
  const cli = await workflow('cli');
  const matches = (patterns: string[], path: string) =>
    picomatch(patterns, { dot: true })(path);
  const files = [
    '.github/release-candidate-contract.json',
    'tools/cli/scripts/release-candidate-contract.ts',
    'tools/cli/scripts/release-candidate-gate.ts',
    'tools/cli/scripts/release-candidate-workflows.test.ts',
  ];
  for (const path of files) {
    for (const category of ['guard', 'build', 'build_ci_tests', 'cli'])
      expect(matches(filters[category]!, path), `${category}: ${path}`).toBe(
        true,
      );
    for (const [name, file] of [
      ['build', build],
      ['cli', cli],
    ] as const)
      expect(
        matches((file.on.push as { paths: string[] }).paths, path),
        `${name} push: ${path}`,
      ).toBe(true);
    // These sources govern evidence, not image contexts; keep the existing
    // positive platform/ci_tests extglob and image-input discovery untouched.
    expect(matches(filters.build_image_inputs!, path), path).toBe(false);
  }
  const turbo = JSON.parse(
    await readFile(join(root, 'tools/cli/turbo.json'), 'utf8'),
  );
  expect(matches(filters.cli!, '.gitattributes')).toBe(true);
  expect(
    matches((cli.on.push as { paths: string[] }).paths, '.gitattributes'),
  ).toBe(true);
  expect(turbo.tasks.test.inputs).toContain('$TURBO_ROOT$/.gitattributes');
  for (const task of ['transit', 'test'])
    expect(turbo.tasks[task].inputs).toContain(
      '$TURBO_ROOT$/.github/release-candidate-contract.json',
    );
});
