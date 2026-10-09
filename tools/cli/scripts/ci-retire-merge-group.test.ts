import { expect, test } from 'bun:test';

import {
  boundedMergeGroupGithub,
  decodeMergeGroupResponse,
  reconcileMergeGroup,
} from './ci-retire-merge-group';

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
  const state = { now: start, missing: true, run, queue };
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
        case 'cancel':
          run.status = 'completed';
          run.conclusion = 'cancelled';
          return { accepted: true };
      }
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
  expect(h.events.map((e) => (e as { phase: string }).phase)).toEqual([
    'prepared',
    'dispatching',
    'accepted',
    'readback',
  ]);
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
      h.state.queue.data.repository.mergeQueue.entries.nodes[1]!.pullRequest.headRefOid =
        head;
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
      h.state.queue.data.repository.mergeQueue.entries.nodes[0]!.headCommit = {
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
          h.state.queue.data.repository.mergeQueue.entries.nodes[0]!.headCommit =
            { oid: head };
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
    `HTTP/2.0 ${code} Status\r\nContent-Type: application/json\r\n\r\n{"message":"Not Found"}`;
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
