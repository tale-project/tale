import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { parse } from 'yaml';
import { z } from 'zod';

import {
  decodeFinishSource,
  finishJobsSafe,
  finishProfile,
} from './ci-merge-group-finish';
import {
  FINISH_PROFILES,
  FINISH_WORKFLOWS,
  finishPaths,
  isFinishPath,
  type FinishSource,
} from './ci-merge-group-profiles';
import { reconcileMergeGroup } from './ci-retire-merge-group';
import type { NativeJob } from './ci-tail-policy';

const fixture = (name: string) =>
  readFileSync(
    new URL(`./fixtures/ci-orphan-seven/${name}`, import.meta.url),
    'utf8',
  );
const observed = z
  .array(
    z.object({
      workflow: z.enum([
        'Checks',
        'CLI',
        'Build',
        'E2E',
        'SAST',
        'Security',
        'Commitlint',
      ]),
      jobs: z.array(
        z.object({
          name: z.string(),
          status: z.string(),
          conclusion: z.string().nullable(),
          runner_id: z.number().nullable(),
        }),
      ),
    }),
  )
  .parse(JSON.parse(fixture('jobs.json')));
function sample(name: string) {
  const row = observed.find((value) => value.workflow === name);
  if (!row) throw new Error('Unknown fixture.');
  const path = FINISH_WORKFLOWS[row.workflow];
  const source: FinishSource = {
    [path]: fixture(row.workflow.toLowerCase() + '.yml.txt'),
    '.github/actions/ci-ready/action.yml': fixture('action.yml.txt'),
    'tools/cli/scripts/ci-ready.ts': fixture('ci-ready.ts.txt'),
  };
  const jobs: NativeJob[] = row.jobs.map((job, index) =>
    Object.assign({}, job, {
      id: index + 1,
      run_id: 11,
      run_attempt: 1,
      head_sha: 'a'.repeat(40),
    }),
  );
  return { path, source, jobs };
}
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing fixture value.');
  return value;
}
function item<T>(values: T[], predicate: (value: T) => boolean): T {
  const value = values.find(predicate);
  if (!value) throw new Error('Missing fixture node.');
  return value;
}
function blob(path: string, text: string) {
  const bytes = Buffer.from(text);
  return {
    type: 'file',
    path,
    encoding: 'base64',
    size: bytes.length,
    sha: createHash('sha1')
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest('hex'),
    content: bytes.toString('base64'),
  };
}
for (const { workflow } of observed) {
  test(`${workflow}: exact observed cancelled graph admits only the reviewed unallocated verdicts`, () => {
    const { source, jobs } = sample(workflow);
    expect(finishJobsSafe(source, jobs)).toBe(true);
    for (const [path, text] of Object.entries(source)) {
      if (!isFinishPath(path)) throw new Error('Unexpected source path.');
      expect(decodeFinishSource(path, blob(path, text))).toBe(text);
    }
  });
  test(`${workflow}: every substantive row, name and identity is required`, () => {
    const { source, jobs } = sample(workflow);
    const profile = finishProfile(source)!;
    const nodes = z
      .object({ jobs: z.record(z.string(), z.object({ name: z.string() })) })
      .parse(parse(source[FINISH_WORKFLOWS[workflow]]!)).jobs;
    const optional = new Set(
      [...profile.verdicts, ...profile.absent].map(
        (id) => must(nodes[id]).name,
      ),
    );
    for (const job of jobs.filter((value) => !optional.has(value.name))) {
      expect(
        finishJobsSafe(
          source,
          jobs.filter((value) => value.id !== job.id),
        ),
      ).toBe(false);
      expect(
        finishJobsSafe(
          source,
          jobs.map((value) =>
            value.id === job.id
              ? { ...value, status: 'in_progress', conclusion: null }
              : value,
          ),
        ),
      ).toBe(false);
    }
    expect(
      finishJobsSafe(source, [
        ...jobs,
        { ...must(jobs[0]), id: 999, name: 'Unknown future substantive job' },
      ]),
    ).toBe(false);
    expect(
      finishJobsSafe(source, [...jobs, { ...must(jobs[0]), id: 999 }]),
    ).toBe(false);
    expect(
      finishJobsSafe(source, [
        ...jobs,
        { ...must(jobs[0]), name: 'Duplicate ID' },
      ]),
    ).toBe(false);
  });
  test(`${workflow}: unknown source or assigned/live verdict never permits finishing`, () => {
    const { source, jobs } = sample(workflow);
    for (const path of Object.keys(source)) {
      if (!isFinishPath(path)) throw new Error('Unexpected source path.');
      expect(
        finishJobsSafe({ ...source, [path]: source[path] + '\n' }, jobs),
      ).toBe(false);
      const missing = { ...source };
      delete missing[path];
      expect(finishJobsSafe(missing, jobs)).toBe(false);
      expect(() =>
        decodeFinishSource(path, blob(path, source[path] + '\n')),
      ).toThrow();
    }
    for (const job of jobs.filter((value) => value.status === 'queued')) {
      for (const replacement of [
        { ...job, runner_id: 9 },
        { ...job, status: 'in_progress' },
        { ...job, conclusion: 'success' },
      ])
        expect(
          finishJobsSafe(
            source,
            jobs.map((value) => (value.id === job.id ? replacement : value)),
          ),
        ).toBe(false);
    }
    const selected = finishProfile(source)!;
    const nodes = z
      .object({ jobs: z.record(z.string(), z.object({ name: z.string() })) })
      .parse(parse(source[FINISH_WORKFLOWS[workflow]]!)).jobs;
    for (const id of selected.absent) {
      const name = must(nodes[id]).name;
      const others = jobs.filter((job) => job.name !== name);
      expect(
        finishJobsSafe(source, [
          ...others,
          {
            ...must(jobs[0]),
            id: 9999,
            name,
            status: 'in_progress',
            conclusion: null,
          },
        ]),
      ).toBe(false);
    }
    expect(
      finishJobsSafe(
        source,
        jobs.map((job) =>
          Object.assign({}, job, {
            status: 'completed',
            conclusion: 'cancelled',
          }),
        ),
      ),
    ).toBe(false);
  });
  test(`${workflow}: full maintained path observes twice, writes one force intent, and reads actual terminal jobs`, () => {
    const { path, source, jobs } = sample(workflow);
    const now = Date.parse('2026-10-09T09:00:00Z');
    const head = 'a'.repeat(40);
    const base = 'b'.repeat(40);
    const run = {
      id: 11,
      workflow_id: 9,
      run_number: 1,
      run_attempt: 1,
      name: workflow,
      path,
      event: 'merge_group',
      head_sha: head,
      head_branch: `gh-readonly-queue/main/pr-7-${base}`,
      created_at: new Date(now - 3600_000).toISOString(),
      status: 'queued',
      conclusion: null as string | null,
      repository: { full_name: 'tale-project/tale' },
      head_repository: { full_name: 'tale-project/tale' },
      pull_requests: [],
    };
    const ordinary =
      [
        {
          version: 1,
          repository: 'tale-project/tale',
          run: 11,
          attempt: 1,
          head,
          branch: run.head_branch,
          observedAt: now - 601_000,
          phase: 'prepared',
          decision: {
            action: 'retire',
            reason: 'deleted_ref_absent_from_queue',
          },
          workflow: { id: 9, name: workflow, path },
        },
        { phase: 'dispatching', at: now - 600_000 },
        { phase: 'accepted', at: now - 599_000 },
      ]
        .map((row) => JSON.stringify(row))
        .join('\n') + '\n';
    const requests: string[] = [];
    const events: object[] = [];
    const result = reconcileMergeGroup(
      { run: 11, finish: true, apply: true, ordinaryReceipt: ordinary },
      {
        now: () => now,
        api: (request) => {
          requests.push(request.kind);
          if (request.kind === 'run') return structuredClone(run);
          if (request.kind === 'queue')
            return {
              data: {
                repository: {
                  nameWithOwner: 'tale-project/tale',
                  defaultBranchRef: { name: 'main', target: { oid: base } },
                  mergeQueue: {
                    entries: { pageInfo: { hasNextPage: false }, nodes: [] },
                  },
                },
              },
            };
          if (request.kind === 'ref') return { missing: true };
          if (request.kind === 'source')
            return blob(request.path, source[request.path]!);
          if (request.kind === 'jobs')
            return { total_count: jobs.length, jobs: structuredClone(jobs) };
          if (request.kind === 'force') {
            expect(events.length).toBe(2);
            run.status = 'completed';
            run.conclusion = 'cancelled';
            for (const job of jobs) {
              job.status = 'completed';
              job.conclusion ??= 'cancelled';
            }
            return { accepted: true };
          }
          throw new Error('Ordinary cancellation is not finishing.');
        },
        journal: (prepared) => {
          events.push(prepared);
          return {
            append: (row) => {
              events.push(row);
            },
            close: () => {},
          };
        },
      },
    );
    expect(result.outcome).toBe('cancelled');
    expect(requests.filter((kind) => kind === 'source')).toHaveLength(6);
    expect(requests.filter((kind) => kind === 'force')).toHaveLength(1);
    expect(requests.filter((kind) => kind === 'cancel')).toHaveLength(0);
    expect(requests.filter((kind) => kind === 'jobs')).toHaveLength(3);
  });
}

for (const workflow of ['CLI', 'Build', 'E2E'])
  test(`${workflow}: collapsed matrices require a false pinned success prerequisite and no expanded child`, () => {
    const { source, jobs } = sample(workflow);
    const profile = finishProfile(source)!;
    const nodes = z
      .object({ jobs: z.record(z.string(), z.object({ name: z.string() })) })
      .parse(parse(source[FINISH_WORKFLOWS[profile.workflow]]!)).jobs;
    for (const [id, matrix] of Object.entries(profile.matrices)) {
      const node = must(nodes[id]);
      const placeholder = jobs.find((job) => job.name === node.name);
      if (!placeholder) continue;
      const prerequisite = item(
        jobs,
        (job) => job.name === must(nodes[must(matrix.requiresSuccess)]).name,
      );
      expect(
        finishJobsSafe(
          source,
          jobs.map((job) =>
            job.id === prerequisite.id
              ? { ...job, conclusion: 'success' }
              : job,
          ),
        ),
      ).toBe(false);
      expect(
        finishJobsSafe(
          source,
          jobs.map((job) =>
            job.id === placeholder.id ? { ...job, conclusion: 'success' } : job,
          ),
        ),
      ).toBe(false);
      const expanded = matrix.values.map((value, index) =>
        Object.assign({}, placeholder, {
          id: 1000 + index,
          name: node.name.replace(
            '${{ matrix.' + matrix.variable + ' }}',
            String(value),
          ),
        }),
      );
      expect(finishJobsSafe(source, [...jobs, must(expanded[0])])).toBe(false);
      const others = jobs.filter((job) => job.id !== placeholder.id);
      expect(finishJobsSafe(source, [...others, ...expanded])).toBe(true);
      expect(finishJobsSafe(source, [...others, ...expanded.slice(1)])).toBe(
        false,
      );
      expect(
        finishJobsSafe(source, [
          ...others,
          ...expanded,
          { ...placeholder, id: 9999, name: 'Unknown matrix member' },
        ]),
      ).toBe(false);
      expect(
        finishJobsSafe(source, [
          ...others,
          ...expanded.map((job, index) =>
            index === 0
              ? Object.assign({}, job, { status: 'queued', conclusion: null })
              : job,
          ),
        ]),
      ).toBe(false);
    }
  });

test('current seven workflows and verdict closure require an explicit reviewed profile on every source change', () => {
  for (const [name, path] of Object.entries(FINISH_WORKFLOWS)) {
    const source: FinishSource = {};
    for (const file of finishPaths(name, path))
      source[file] = readFileSync(
        new URL(`../../../${file}`, import.meta.url),
        'utf8',
      );
    expect(String(finishProfile(source)?.workflow)).toBe(name);
  }
});
test('profile paths and helper combinations are fixed; current Build remains graph-equivalent to its retained source', () => {
  const { source, jobs } = sample('Build');
  expect(
    finishJobsSafe(
      {
        ...source,
        '.github/workflows/build.yml': fixture('build-current.yml.txt'),
      },
      jobs,
    ),
  ).toBe(true);
  const historic = z
    .object({ jobs: z.record(z.string(), z.unknown()) })
    .parse(parse(source['.github/workflows/build.yml']!));
  const current = z
    .object({ jobs: z.record(z.string(), z.unknown()) })
    .parse(parse(fixture('build-current.yml.txt')));
  const shape = z.object({
    name: z.string(),
    if: z.string(),
    needs: z.union([z.string(), z.array(z.string())]).optional(),
    strategy: z.unknown().optional(),
  });
  expect(
    Object.fromEntries(
      Object.entries(current.jobs).map(([id, node]) => [id, shape.parse(node)]),
    ),
  ).toEqual(
    Object.fromEntries(
      Object.entries(historic.jobs).map(([id, node]) => [
        id,
        shape.parse(node),
      ]),
    ),
  );
  for (const profile of FINISH_PROFILES)
    expect(Object.keys(profile.hashes)).toHaveLength(3);
  expect(() => finishPaths('Checks', FINISH_WORKFLOWS.Build)).toThrow();
  expect(() =>
    finishPaths('Release', '.github/workflows/release.yml'),
  ).toThrow();
});

test('current CLI path scope preserves the retained graph and every finishing refusal', () => {
  const { source: historic, jobs } = sample('CLI');
  const path = FINISH_WORKFLOWS.CLI;
  const current = {
    ...historic,
    [path]: readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'),
  };
  const graph = z.object({ jobs: z.record(z.string(), z.unknown()) });
  expect(graph.parse(parse(current[path])).jobs).toEqual(
    graph.parse(parse(historic[path]!)).jobs,
  );
  expect(finishJobsSafe(historic, jobs)).toBe(true);
  expect(finishJobsSafe(current, jobs)).toBe(true);
  for (const file of Object.keys(current)) {
    if (!isFinishPath(file)) throw new Error('Unexpected source path.');
    expect(
      finishJobsSafe({ ...current, [file]: current[file] + '\n' }, jobs),
    ).toBe(false);
    const missing = { ...current };
    delete missing[file];
    expect(finishJobsSafe(missing, jobs)).toBe(false);
  }
  for (const job of jobs) {
    if (job.status === 'queued') {
      for (const update of [
        { runner_id: 9 },
        { status: 'in_progress' },
        { conclusion: 'success' },
      ])
        expect(
          finishJobsSafe(
            current,
            jobs.map((value) =>
              value.id === job.id ? { ...value, ...update } : value,
            ),
          ),
        ).toBe(false);
    } else if (job.status === 'completed' && job.conclusion !== 'skipped') {
      expect(
        finishJobsSafe(
          current,
          jobs.map((value) =>
            value.id === job.id
              ? Object.assign({}, value, { status: 'queued', conclusion: null })
              : value,
          ),
        ),
      ).toBe(false);
    }
  }
});
