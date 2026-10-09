import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import {
  decodeFinishSource,
  FINISH_SOURCE,
  parseOrdinaryReceipt,
} from './ci-merge-group-finish';
import {
  boundedMergeGroupGithub,
  readOrdinaryReceiptFile,
  decodeMergeGroupResponse,
  reconcileMergeGroup,
} from './ci-retire-merge-group';
import type { NativeJob } from './ci-tail-policy';

function item<T>(values: T[], index: number): T {
  const value = values.at(index);
  if (value === undefined) throw new Error('Missing fixture item.');
  return value;
}
const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const start = Date.parse('2026-10-09T04:00:00Z');
function harness() {
  const run = {
    id: 11,
    workflow_id: 9,
    run_number: 33,
    run_attempt: 1,
    name: 'Checks',
    path: '.github/workflows/checks.yml',
    event: 'merge_group',
    head_sha: head,
    head_branch: `gh-readonly-queue/main/pr-7-${base}`,
    repository: { full_name: 'tale-project/tale' },
    head_repository: { full_name: 'tale-project/tale' },
    created_at: '2026-10-09T03:00:00Z',
    status: 'queued',
    conclusion: null as string | null,
    pull_requests: [],
  };
  const queue = {
    data: {
      repository: {
        nameWithOwner: 'tale-project/tale',
        defaultBranchRef: { name: 'main', target: { oid: base } },
        mergeQueue: {
          entries: {
            pageInfo: { hasNextPage: false },
            nodes: [
              {
                headCommit: { oid: 'c'.repeat(40) },
                pullRequest: { headRefOid: 'd'.repeat(40) },
              },
              { headCommit: null, pullRequest: { headRefOid: 'e'.repeat(40) } },
            ],
          },
        },
      },
    },
  };
  const requests: string[] = [];
  const events: object[] = [];
  const source = {
    '.github/workflows/checks.yml': readFileSync(
      new URL(
        './fixtures/ci-orphan-checks-6ad49e4/checks.yml.txt',
        import.meta.url,
      ),
      'utf8',
    ),
    '.github/actions/ci-ready/action.yml': readFileSync(
      new URL(
        './fixtures/ci-orphan-checks-6ad49e4/action.yml.txt',
        import.meta.url,
      ),
      'utf8',
    ),
    'tools/cli/scripts/ci-ready.ts': readFileSync(
      new URL(
        './fixtures/ci-orphan-checks-6ad49e4/ci-ready.ts.txt',
        import.meta.url,
      ),
      'utf8',
    ),
  };
  const jobs: NativeJob[] = [
    'Format',
    'Lint',
    'Type check',
    'Build',
    'Unit (platform 1/2)',
    'Unit (platform 2/2)',
    'Unit (workspaces)',
    'UI (platform 1/4)',
    'UI (platform 2/4)',
    'UI (platform 3/4)',
    'UI (platform 4/4)',
    'Performance',
    'Knip',
    'Browser',
    'Integration scope',
    'Backend integration',
    'Candidate source',
    'Unit',
    'UI',
  ].map((name, index) => ({
    id: 100 + index,
    name,
    run_id: run.id,
    run_attempt: run.run_attempt,
    head_sha: head,
    status: ['Unit', 'UI'].includes(name) ? 'queued' : 'completed',
    conclusion: ['Unit', 'UI'].includes(name)
      ? null
      : name === 'Candidate source'
        ? 'skipped'
        : 'cancelled',
    runner_id: 0,
  }));
  const state = { now: start, missing: true, run, queue, source, jobs };
  let hook: (kind: string) => unknown = () => undefined;
  const deps = {
    now: () => state.now,
    api: (
      request: Parameters<ReturnType<typeof boundedMergeGroupGithub>>[0],
    ): unknown => {
      requests.push(request.kind);
      const override = hook(request.kind);
      if (override !== undefined) return structuredClone(override);
      switch (request.kind) {
        case 'run':
          return structuredClone(run);
        case 'queue':
          return structuredClone(queue);
        case 'ref':
          return { missing: state.missing };
        case 'source': {
          const bytes = Buffer.from(state.source[request.path]);
          return {
            type: 'file',
            path: request.path,
            size: bytes.length,
            encoding: 'base64',
            sha: createHash('sha1')
              .update(`blob ${bytes.length}\0`)
              .update(bytes)
              .digest('hex'),
            content: bytes.toString('base64'),
          };
        }
        case 'jobs':
          return {
            total_count: state.jobs.length,
            jobs: structuredClone(state.jobs),
          };
        case 'force':
          for (const job of state.jobs) {
            job.status = 'completed';
            job.conclusion ??= 'cancelled';
          }
          run.status = 'completed';
          run.conclusion = 'cancelled';
          return { accepted: true };
        case 'cancel':
          run.status = 'completed';
          run.conclusion = 'cancelled';
          return { accepted: true };
      }
      return undefined;
    },
    journal: (prepared: object) => {
      events.push(prepared);
      return {
        append: (event: object) => {
          events.push(event);
        },
        close: () => {},
      };
    },
  };
  return {
    state,
    deps,
    requests,
    events,
    hook: (value: typeof hook) => {
      hook = value;
    },
    posts: () => requests.filter((x) => x === 'cancel').length,
  };
}

test('deleted historical queue head is eligible by default without cancelling live jobs', () => {
  const h = harness();
  expect(reconcileMergeGroup({ run: 11 }, h.deps)).toMatchObject({
    outcome: 'read_only',
    decision: { action: 'retire' },
  });
  expect(h.posts()).toBe(0);
  expect(h.events).toEqual([]);
});

test('ordinary cancellation of an obsolete live validation uses two observations and one durable intent', () => {
  const h = harness();
  h.state.run.status = 'in_progress';
  expect(reconcileMergeGroup({ run: 11, apply: true }, h.deps).outcome).toBe(
    'cancelled',
  );
  expect(h.requests).toEqual([
    'run',
    'queue',
    'ref',
    'run',
    'run',
    'queue',
    'ref',
    'run',
    'cancel',
    'run',
  ]);
  expect(h.posts()).toBe(1);
  expect(
    h.events.map((e) => z.object({ phase: z.string() }).parse(e).phase),
  ).toEqual(['prepared', 'dispatching', 'accepted', 'readback']);
});

const refused: [string, (h: ReturnType<typeof harness>) => void][] = [
  [
    'current main with empty queue',
    (h) => {
      h.state.queue.data.repository.defaultBranchRef.target.oid = head;
      h.state.queue.data.repository.mergeQueue.entries.nodes = [];
    },
  ],
  [
    'current PR source',
    (h) => {
      item(
        h.state.queue.data.repository.mergeQueue.entries.nodes,
        1,
      ).pullRequest.headRefOid = head;
    },
  ],
  [
    'wrong queue repository',
    (h) => {
      h.state.queue.data.repository.nameWithOwner = 'foreign/repository';
    },
  ],
  [
    'current queue head',
    (h) => {
      item(
        h.state.queue.data.repository.mergeQueue.entries.nodes,
        0,
      ).headCommit = {
        oid: head,
      };
    },
  ],
  [
    'existing ref',
    (h) => {
      h.state.missing = false;
    },
  ],
  [
    'incomplete queue',
    (h) => {
      h.state.queue.data.repository.mergeQueue.entries.pageInfo.hasNextPage = true;
    },
  ],
  [
    'newly requested group',
    (h) => {
      h.state.run.created_at = new Date(start - 59_999).toISOString();
    },
  ],
  [
    'future run',
    (h) => {
      h.state.run.created_at = new Date(start + 1).toISOString();
    },
  ],
  [
    'completed run',
    (h) => {
      h.state.run.status = 'completed';
      h.state.run.conclusion = 'success';
    },
  ],
  [
    'release workflow',
    (h) => {
      h.state.run.name = 'Release';
      h.state.run.path = '.github/workflows/release.yml';
    },
  ],
  [
    'wrong workflow path',
    (h) => {
      h.state.run.path = '.github/workflows/build.yml';
    },
  ],
  [
    'wrong workflow case',
    (h) => {
      h.state.run.name = 'checks';
    },
  ],
  [
    'main push',
    (h) => {
      h.state.run.event = 'push';
      h.state.run.head_branch = 'main';
    },
  ],
  [
    'PR validation',
    (h) => {
      h.state.run.event = 'pull_request';
    },
  ],
  [
    'release candidate',
    (h) => {
      h.state.run.event = 'repository_dispatch';
    },
  ],
  [
    'another base branch',
    (h) => {
      h.state.run.head_branch = `gh-readonly-queue/release/pr-7-${base}`;
    },
  ],
  [
    'malformed ref',
    (h) => {
      h.state.run.head_branch += '?evil';
    },
  ],
  [
    'foreign repository',
    (h) => {
      h.state.run.repository.full_name = 'foreign/repo';
    },
  ],
  [
    'foreign source repository',
    (h) => {
      h.state.run.head_repository.full_name = 'foreign/repo';
    },
  ],
  [
    'wrong requested identity',
    (h) => {
      h.state.run.id++;
    },
  ],
  [
    'queue unavailable',
    (h) => {
      h.hook((kind) =>
        kind === 'queue'
          ? { data: { repository: { mergeQueue: null } } }
          : undefined,
      );
    },
  ],
  [
    'partial GraphQL error',
    (h) => {
      h.hook((kind) =>
        kind === 'queue'
          ? { ...h.state.queue, errors: [{ message: 'PRIVATE' }] }
          : undefined,
      );
    },
  ],
  [
    'unreadable default branch',
    (h) => {
      h.hook((kind) =>
        kind === 'queue'
          ? {
              data: {
                repository: {
                  ...h.state.queue.data.repository,
                  defaultBranchRef: null,
                },
              },
            }
          : undefined,
      );
    },
  ],
  [
    'nonfinite clock',
    (h) => {
      h.state.now = Number.NaN;
    },
  ],
];
for (const [name, change] of refused)
  test(`preserves ${name}`, () => {
    const h = harness();
    change(h);
    const result = reconcileMergeGroup({ run: 11, apply: true }, h.deps);
    expect(result.outcome).not.toBe('cancelled');
    expect(h.posts()).toBe(0);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

for (const change of ['head', 'attempt', 'ref', 'queue', 'slow-read'])
  test(`preserves ${change} changing before action`, () => {
    const h = harness();
    let reads = 0;
    h.hook((kind) => {
      if (kind === 'run' && ++reads === 3) {
        if (change === 'head') h.state.run.head_sha = 'd'.repeat(40);
        if (change === 'attempt') h.state.run.run_attempt++;
        if (change === 'ref') h.state.missing = false;
        if (change === 'queue')
          item(
            h.state.queue.data.repository.mergeQueue.entries.nodes,
            0,
          ).headCommit = { oid: head };
      }
      if (kind === 'ref' && change === 'slow-read') h.state.now += 30_001;
    });
    expect(
      reconcileMergeGroup({ run: 11, apply: true }, h.deps).outcome,
    ).not.toBe('cancelled');
    expect(h.posts()).toBe(0);
  });

test('apply requires a receipt and a slow receipt cannot authorize a stale write', () => {
  const h = harness();
  expect(
    reconcileMergeGroup(
      { run: 11, apply: true },
      { api: h.deps.api, now: h.deps.now },
    ).outcome,
  ).toBe('preserved');
  h.deps.journal = () => {
    h.state.now += 30_001;
    return { append: () => {}, close: () => {} };
  };
  expect(reconcileMergeGroup({ run: 11, apply: true }, h.deps).outcome).toBe(
    'preserved',
  );
  expect(h.posts()).toBe(0);
});

for (const failure of ['cancel', 'readback', 'identity'])
  test(`lost ${failure} never retries or claims success`, () => {
    const h = harness();
    h.hook((kind) => {
      if (failure === 'cancel' && kind === 'cancel') throw new Error('PRIVATE');
      if (failure === 'readback' && kind === 'run' && h.posts())
        throw new Error('PRIVATE');
      if (failure === 'identity' && kind === 'run' && h.posts())
        h.state.run.run_attempt++;
    });
    const result = reconcileMergeGroup({ run: 11, apply: true }, h.deps);
    expect(result.outcome).toBe('mutation_outcome_unknown');
    expect(h.posts()).toBe(1);
    expect(JSON.stringify({ result, events: h.events })).not.toContain(
      'PRIVATE',
    );
  });

test('accepted asynchronous cancellation remains pending readback', () => {
  const h = harness();
  h.hook((kind) => (kind === 'cancel' ? { accepted: true } : undefined));
  expect(reconcileMergeGroup({ run: 11, apply: true }, h.deps).outcome).toBe(
    'accepted_pending_readback',
  );
  expect(h.posts()).toBe(1);
});

test('only a real HTTP404 ref response establishes deletion', () => {
  const response = (code: number) =>
    `HTTP/2.0 ${code} Status\r\nContent-Type: application/json\r\nDate: ${new Date().toUTCString()}\r\n\r\n{"message":"Not Found"}`;
  expect(decodeMergeGroupResponse('ref', 1, response(404))).toEqual({
    missing: true,
  });
  expect(decodeMergeGroupResponse('ref', 0, response(200))).toEqual({
    missing: false,
  });
  for (const code of [401, 403, 422, 429, 500, 503])
    expect(() => decodeMergeGroupResponse('ref', 1, response(code))).toThrow();
  for (const status of [0, null, 2])
    expect(() =>
      decodeMergeGroupResponse('ref', status, response(404)),
    ).toThrow();
  expect(() => decodeMergeGroupResponse('ref', 1, '{"status":404}')).toThrow();
  expect(() => decodeMergeGroupResponse('run', 1, response(404))).toThrow();
  expect(() => decodeMergeGroupResponse('cancel', 1, response(404))).toThrow();
  expect(decodeMergeGroupResponse('cancel', 0, response(202))).toEqual({
    accepted: true,
  });
});

test('transport refuses unsafe ref and run arguments before executing gh', () => {
  const api = boundedMergeGroupGithub();
  expect(() => api({ kind: 'ref', branch: 'main' })).toThrow();
  expect(() =>
    api({ kind: 'ref', branch: `gh-readonly-queue/main/pr-7-${base}?x` }),
  ).toThrow();
  expect(() => api({ kind: 'cancel', id: Number.NaN })).toThrow();
});

function ordinary(h: ReturnType<typeof harness>) {
  return (
    [
      {
        version: 1,
        repository: 'tale-project/tale',
        run: 11,
        attempt: 1,
        head,
        branch: h.state.run.head_branch,
        observedAt: start - 600_000,
        phase: 'prepared',
        decision: { action: 'retire', reason: 'deleted_ref_absent_from_queue' },
      },
      { phase: 'dispatching', at: start - 599_000 },
      { phase: 'accepted', at: start - 598_000 },
      {
        phase: 'readback',
        at: start - 597_000,
        outcome: 'accepted_pending_readback',
      },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n') + '\n'
  );
}
function finish(
  h: ReturnType<typeof harness>,
  apply = true,
  receipt = ordinary(h),
) {
  return reconcileMergeGroup(
    { run: 11, apply, finish: true, ordinaryReceipt: receipt },
    h.deps,
  );
}
const forces = (h: ReturnType<typeof harness>) =>
  h.requests.filter((kind) => kind === 'force').length;

test('explicit finishing defaults to a manifest, with exact real workflow and verdict closure', () => {
  const h = harness();
  expect(finish(h, false)).toMatchObject({
    outcome: 'read_only',
    mode: 'finish',
    decision: { action: 'retire', reason: 'cancelled_orphan_verdicts_only' },
    profile: FINISH_SOURCE,
  });
  expect(forces(h)).toBe(0);
  expect(h.events).toEqual([]);
});
for (const scenario of ['Unit and UI', 'CI ready alone', 'nullable runner'])
  test(`finishes ${scenario} after accepted ordinary cancellation and preserves failed conclusions`, () => {
    const h = harness();
    item(h.state.jobs, 0).conclusion = 'failure';
    if (scenario === 'CI ready alone') {
      for (const job of h.state.jobs)
        if (job.status === 'queued') {
          job.status = 'completed';
          job.conclusion = 'failure';
        }
      h.state.jobs.push({
        ...item(h.state.jobs, 0),
        id: 900,
        name: 'CI ready (Checks)',
        status: 'queued',
        conclusion: null,
      });
    }
    if (scenario === 'nullable runner')
      for (const job of h.state.jobs) job.runner_id = null;
    expect(finish(h).outcome).toBe('cancelled');
    expect(forces(h)).toBe(1);
    expect(h.posts()).toBe(0);
    expect(h.events[0]).toMatchObject({
      jobs: expect.arrayContaining([
        expect.objectContaining({ name: 'Format', conclusion: 'failure' }),
      ]),
    });
    expect(h.events).toMatchObject([
      { phase: 'prepared' },
      { phase: 'dispatching' },
      { phase: 'accepted' },
      { phase: 'readback', outcome: 'cancelled' },
    ]);
  });

const finishRefusals: [string, (h: ReturnType<typeof harness>) => void][] = [
  [
    'assigned verdict',
    (h) => {
      item(h.state.jobs, -1).runner_id = 42;
    },
  ],
  [
    'running verdict',
    (h) => {
      item(h.state.jobs, -1).status = 'in_progress';
    },
  ],
  [
    'waiting verdict',
    (h) => {
      item(h.state.jobs, -1).status = 'waiting';
    },
  ],
  [
    'queued real shard',
    (h) => {
      item(h.state.jobs, 4).status = 'queued';
      item(h.state.jobs, 4).conclusion = null;
    },
  ],
  [
    'not yet materialized backend',
    (h) => {
      h.state.jobs = h.state.jobs.filter(
        (job) => job.name !== 'Backend integration',
      );
    },
  ],
  [
    'missing matrix shard',
    (h) => {
      h.state.jobs.splice(4, 1);
    },
  ],
  [
    'duplicate names',
    (h) => {
      item(h.state.jobs, 0).name = item(h.state.jobs, 1).name;
    },
  ],
  [
    'unknown future job',
    (h) => {
      h.state.jobs.push({
        ...item(h.state.jobs, 0),
        id: 900,
        name: 'Publish',
        status: 'queued',
        conclusion: null,
      });
    },
  ],
  [
    'candidate job unexpectedly active',
    (h) => {
      item(h.state.jobs, 16).status = 'queued';
      item(h.state.jobs, 16).conclusion = null;
    },
  ],
  [
    'terminal without conclusion',
    (h) => {
      item(h.state.jobs, 0).conclusion = null;
    },
  ],
  [
    'unknown conclusion',
    (h) => {
      item(h.state.jobs, 0).conclusion = 'invented';
    },
  ],
  [
    'job from another attempt',
    (h) => {
      item(h.state.jobs, 0).run_attempt++;
    },
  ],
  [
    'job from another run',
    (h) => {
      item(h.state.jobs, 0).run_id++;
    },
  ],
  [
    'job from another source',
    (h) => {
      item(h.state.jobs, 0).head_sha = base;
    },
  ],
  [
    'duplicate job ID',
    (h) => {
      item(h.state.jobs, 0).id = item(h.state.jobs, 1).id;
    },
  ],
  [
    'repurposed Unit source',
    (h) => {
      h.state.source['.github/workflows/checks.yml'] += '\n# changed\n';
    },
  ],
  [
    'changed action closure',
    (h) => {
      h.state.source['.github/actions/ci-ready/action.yml'] += '\n';
    },
  ],
  [
    'changed verdict script',
    (h) => {
      h.state.source['tools/cli/scripts/ci-ready.ts'] += '\n';
    },
  ],
  [
    'current queue head',
    (h) => {
      h.state.queue.data.repository.defaultBranchRef.target.oid = head;
    },
  ],
  [
    'ref reappeared',
    (h) => {
      h.state.missing = false;
    },
  ],
  [
    'incomplete queue',
    (h) => {
      h.state.queue.data.repository.mergeQueue.entries.pageInfo.hasNextPage = true;
    },
  ],
  [
    'another workflow',
    (h) => {
      h.state.run.name = 'Build';
      h.state.run.path = '.github/workflows/build.yml';
    },
  ],
  [
    'incomplete job page',
    (h) => {
      h.hook((kind) =>
        kind === 'jobs' ? { total_count: 20, jobs: h.state.jobs } : undefined,
      );
    },
  ],
];
for (const [name, change] of finishRefusals)
  test(`finishing preserves ${name}`, () => {
    const h = harness();
    change(h);
    expect(finish(h).outcome).not.toBe('cancelled');
    expect(forces(h)).toBe(0);
  });
for (const stage of [
  'assigned',
  'identity',
  'attempt',
  'source',
  'slow',
  'ref',
])
  test(`finishing refuses ${stage} changing at the second observation`, () => {
    const h = harness();
    let runs = 0;
    h.hook((kind) => {
      if (kind !== 'run' || ++runs !== 3) return;
      if (stage === 'assigned') item(h.state.jobs, -1).runner_id = 19;
      if (stage === 'identity') item(h.state.jobs, 0).id++;
      if (stage === 'attempt') h.state.run.run_attempt++;
      if (stage === 'source')
        h.state.source['tools/cli/scripts/ci-ready.ts'] += '\n';
      if (stage === 'slow') h.state.now += 30_001;
      if (stage === 'ref') h.state.missing = false;
    });
    // A slow individual read is tested separately; advancing the clock between
    // observations is safe while the new observation is itself fresh.
    if (stage === 'slow')
      h.hook((kind) => {
        if (kind === 'source') h.state.now += 11_000;
      });
    expect(finish(h).outcome).not.toBe('cancelled');
    expect(forces(h)).toBe(0);
  });
for (const invalid of [
  'missing accepted',
  'wrong head',
  'wrong attempt',
  'wrong run',
  'force receipt',
  'unknown',
  'too recent',
  'future',
  'truncated',
])
  test(`finishing refuses ordinary receipt: ${invalid}`, () => {
    const h = harness();
    let receipt = ordinary(h);
    if (invalid === 'missing accepted')
      receipt = receipt.replace('"phase":"accepted"', '"phase":"unconfirmed"');
    if (invalid === 'wrong head') receipt = receipt.replace(head, base);
    if (invalid === 'wrong attempt')
      receipt = receipt.replace('"attempt":1', '"attempt":2');
    if (invalid === 'wrong run')
      receipt = receipt.replace('"run":11', '"run":12');
    if (invalid === 'force receipt')
      receipt = receipt.replace(
        '"phase":"prepared"',
        '"phase":"prepared","mode":"finish"',
      );
    if (invalid === 'unknown')
      receipt = receipt.replace(
        'accepted_pending_readback',
        'mutation_outcome_unknown',
      );
    if (invalid === 'too recent') h.state.now = start - 597_000;
    if (invalid === 'future') h.state.now = start - 700_000;
    if (invalid === 'truncated') receipt = receipt.trimEnd();
    expect(finish(h, true, receipt).outcome).not.toBe('cancelled');
    expect(forces(h)).toBe(0);
  });
for (const kind of ['force', 'readback'])
  test(`finishing retains unknown ${kind} without replay`, () => {
    const h = harness();
    h.hook((request) => {
      if (
        (kind === 'force' && request === 'force') ||
        (kind === 'readback' && request === 'jobs' && forces(h))
      )
        throw new Error('PRIVATE');
    });
    expect(finish(h)).toMatchObject({ outcome: 'mutation_outcome_unknown' });
    expect(forces(h)).toBe(1);
    expect(JSON.stringify(h.events)).not.toContain('PRIVATE');
  });
test('force accepted is pending until both run and every native job are terminal', () => {
  const h = harness();
  h.hook((kind) => {
    if (kind === 'force') {
      h.state.run.status = 'completed';
      h.state.run.conclusion = 'cancelled';
      return { accepted: true };
    }
    return undefined;
  });
  expect(finish(h).outcome).toBe('accepted_pending_readback');
});
test('existing force intent or failed durable journal blocks dispatch', () => {
  const h = harness();
  h.deps.journal = () => {
    throw new Error('exclusive receipt exists or directory fsync failed');
  };
  expect(finish(h).outcome).toBe('preserved');
  expect(forces(h)).toBe(0);
});
test('ordinary evidence is required even for read-only finishing; flags never silently escalate', () => {
  const h = harness();
  expect(reconcileMergeGroup({ run: 11, finish: true }, h.deps).outcome).toBe(
    'preserved',
  );
  expect(
    reconcileMergeGroup(
      { run: 11, ordinaryReceipt: ordinary(h), apply: true },
      h.deps,
    ).outcome,
  ).toBe('preserved');
  expect(() => parseOrdinaryReceipt('x'.repeat(65_537))).toThrow();
  expect(forces(h)).toBe(0);
  expect(h.posts()).toBe(0);
  expect(() => boundedMergeGroupGithub()({ kind: 'force', id: 11 })).toThrow();
});

test('metadata requires fresh unambiguous HTTP Date/Age, independent of cache-control policy', () => {
  const response = (headers: string) =>
    `HTTP/2.0 200 OK\r\n${headers}\r\n\r\n{}`;
  const date = new Date(start).toUTCString();
  expect(
    decodeMergeGroupResponse(
      'run',
      0,
      response(`Date: ${date}\r\nAge: 0\r\nCache-Control: private, max-age=60`),
      start,
    ),
  ).toEqual({});
  for (const headers of [
    'Age: 0',
    `Date: ${date}\r\nAge: 31`,
    `Date: ${date}\r\nAge: -1`,
    `Date: ${date}\r\nAge: NaN`,
    `Date: ${date}\r\nDate: ${date}`,
    `Date: ${date}\r\nAge: 0\r\nAge: 0`,
    'Date: invalid',
    `Date: ${new Date(start - 31_000).toUTCString()}`,
    `Date: ${new Date(start + 6000).toUTCString()}`,
  ])
    expect(() =>
      decodeMergeGroupResponse('run', 0, response(headers), start),
    ).toThrow();
});

test('regular bounded ordinary receipt reads refuse directories, symlinks and oversized files', () => {
  const h = harness();
  const directory = mkdtempSync(join(tmpdir(), 'tale-ordinary-receipt-'));
  try {
    const file = join(directory, 'ordinary.jsonl');
    writeFileSync(file, ordinary(h), { mode: 0o600 });
    expect(readOrdinaryReceiptFile(file)).toBe(ordinary(h));
    const link = join(directory, 'link');
    symlinkSync(file, link);
    expect(() => readOrdinaryReceiptFile(link)).toThrow();
    expect(() => readOrdinaryReceiptFile(directory)).toThrow();
    writeFileSync(file, 'x'.repeat(65_537));
    expect(() => readOrdinaryReceiptFile(file)).toThrow();
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('finishing validates the exact native Git blob and source envelope', () => {
  const h = harness();
  const path = '.github/workflows/checks.yml';
  const bytes = Buffer.from(h.state.source[path]);
  const native = {
    type: 'file',
    path,
    size: bytes.length,
    encoding: 'base64',
    sha: createHash('sha1')
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest('hex'),
    content: bytes.toString('base64'),
  };
  expect(decodeFinishSource(path, native)).toBe(bytes.toString());
  for (const change of [
    { type: 'symlink' },
    { path: 'foreign.yml' },
    { size: bytes.length - 1 },
    { sha: base },
    { content: native.content + '?' },
    { encoding: 'none' },
    { content: Buffer.from('replacement').toString('base64'), size: 11 },
  ])
    expect(() => decodeFinishSource(path, { ...native, ...change })).toThrow();
});

test('new ordinary journal workflow identity is checked as well as immutable legacy run identity', () => {
  const h = harness();
  const legacy = ordinary(h);
  const wrong = legacy.replace(
    '"phase":"prepared"',
    '"phase":"prepared","mode":"ordinary","workflow":{"id":99,"name":"Checks","path":".github/workflows/checks.yml"}',
  );
  expect(finish(h, true, wrong).outcome).not.toBe('cancelled');
  expect(forces(h)).toBe(0);
});

test('an empty or changed final inventory cannot masquerade as confirmed retirement', () => {
  for (const change of ['empty', 'new ID']) {
    const h = harness();
    h.hook((kind) => {
      if (kind === 'jobs' && forces(h)) {
        const jobs = structuredClone(h.state.jobs);
        if (change === 'new ID') item(jobs, 0).id += 1000;
        return change === 'empty'
          ? { total_count: 0, jobs: [] }
          : { total_count: jobs.length, jobs };
      }
      return undefined;
    });
    expect(finish(h).outcome).toBe('accepted_pending_readback');
    expect(forces(h)).toBe(1);
  }
});
