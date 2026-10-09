import { afterEach, expect, test } from 'bun:test';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CI_CONTEXTS } from './ci-ready';
import {
  boundedGithub,
  exclusiveJournal,
  reconcileTail,
} from './ci-retire-tail';
import { decideTail, type TailSnapshot } from './ci-tail-policy';

const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const now = 1_000_000;
const repository = { full_name: 'tale-project/tale' as const };
const options = { pull: 7, olderRun: 10, replacementRun: 11 };
function fixture(): TailSnapshot {
  const run = {
    id: 10,
    workflow_id: 99,
    run_number: 20,
    run_attempt: 1,
    name: 'SAST',
    path: '.github/workflows/sast.yml',
    event: 'pull_request' as const,
    head_sha: head,
    head_branch: 'fix/example',
    repository,
    head_repository: repository,
    created_at: '2026-10-08T12:00:00Z',
    status: 'queued',
    conclusion: null,
    pull_requests: [{ number: 7, head: { sha: head }, base: { sha: base } }],
  };
  const job = {
    id: 100,
    name: 'Opengrep',
    run_id: 10,
    run_attempt: 1,
    head_sha: head,
    status: 'completed',
    conclusion: 'cancelled',
    runner_id: 0,
  };
  return {
    pull: {
      number: 7,
      state: 'open',
      draft: false,
      merged: false,
      head: { sha: head, ref: 'fix/example', repo: repository },
      base: { sha: base, ref: 'main', repo: repository },
    },
    older: structuredClone(run),
    replacement: {
      ...structuredClone(run),
      id: 11,
      run_number: 21,
      status: 'pending',
    },
    olderJobs: [
      job,
      {
        ...job,
        id: 101,
        name: 'CI ready (SAST)',
        status: 'queued',
        conclusion: null,
      },
    ],
    replacementJobs: [],
    observedAt: now,
  };
}

test('cancelled useful work and a sole queued final check can release a newer duplicate', () => {
  expect(decideTail(fixture(), now)).toEqual({
    action: 'retire',
    olderRun: 10,
    replacementRun: 11,
    tailJob: 101,
  });
});

const changes: [string, (value: TailSnapshot) => void][] = [
  [
    'stale read',
    (s) => {
      s.observedAt -= 30_001;
    },
  ],
  [
    'future read',
    (s) => {
      s.observedAt++;
    },
  ],
  [
    'unknown workflow',
    (s) => {
      s.older.name = 'Other';
    },
  ],
  [
    'wrong workflow case',
    (s) => {
      s.older.name = 'sast';
    },
  ],
  [
    'wrong path',
    (s) => {
      s.older.path = '.github/workflows/other.yml';
    },
  ],
  [
    'different workflow id',
    (s) => {
      s.replacement.workflow_id++;
    },
  ],
  [
    'same run',
    (s) => {
      s.replacement.id = s.older.id;
    },
  ],
  [
    'older replacement',
    (s) => {
      s.replacement.run_number--;
    },
  ],
  [
    'older dispatch time',
    (s) => {
      s.replacement.created_at = '2026-10-07T12:00:00Z';
    },
  ],
  [
    'old head',
    (s) => {
      s.older.head_sha = 'c'.repeat(40);
    },
  ],
  [
    'new head',
    (s) => {
      s.replacement.head_sha = 'c'.repeat(40);
    },
  ],
  [
    'old branch',
    (s) => {
      s.older.head_branch = 'fix/another';
    },
  ],
  [
    'new branch',
    (s) => {
      s.replacement.head_branch = 'fix/another';
    },
  ],
  [
    'wrong pull',
    (s) => {
      s.older.pull_requests[0]!.number++;
    },
  ],
  [
    'wrong merge base',
    (s) => {
      s.replacement.pull_requests[0]!.base.sha = 'c'.repeat(40);
    },
  ],
  [
    'missing pull binding',
    (s) => {
      s.older.pull_requests = [];
    },
  ],
  [
    'multiple pull bindings',
    (s) => {
      s.older.pull_requests.push(structuredClone(s.older.pull_requests[0]!));
    },
  ],
  [
    'terminal predecessor',
    (s) => {
      s.older.status = 'completed';
    },
  ],
  [
    'concluded predecessor',
    (s) => {
      s.older.conclusion = 'failure';
    },
  ],
  [
    'started replacement',
    (s) => {
      s.replacement.status = 'in_progress';
    },
  ],
  [
    'replacement jobs',
    (s) => {
      s.replacementJobs = [{ ...s.olderJobs[0]!, run_id: 11 }];
    },
  ],
  [
    'duplicate job id',
    (s) => {
      s.olderJobs[1]!.id = 100;
    },
  ],
  [
    'wrong job run',
    (s) => {
      s.olderJobs[0]!.run_id = 11;
    },
  ],
  [
    'wrong job attempt',
    (s) => {
      s.olderJobs[0]!.run_attempt++;
    },
  ],
  [
    'wrong job source',
    (s) => {
      s.olderJobs[0]!.head_sha = 'c'.repeat(40);
    },
  ],
  [
    'missing tail',
    (s) => {
      s.olderJobs.pop();
    },
  ],
  [
    'duplicate tail',
    (s) => {
      s.olderJobs.push({ ...s.olderJobs[1]!, id: 102 });
    },
  ],
  [
    'allocated tail',
    (s) => {
      s.olderJobs[1]!.runner_id = 23;
    },
  ],
  [
    'running tail',
    (s) => {
      s.olderJobs[1]!.status = 'in_progress';
    },
  ],
  [
    'completed tail',
    (s) => {
      s.olderJobs[1]!.status = 'completed';
      s.olderJobs[1]!.conclusion = 'success';
    },
  ],
  [
    'queued real work',
    (s) => {
      s.olderJobs[0]!.status = 'queued';
      s.olderJobs[0]!.conclusion = null;
    },
  ],
  [
    'running real work',
    (s) => {
      s.olderJobs[0]!.status = 'in_progress';
      s.olderJobs[0]!.conclusion = null;
    },
  ],
  [
    'failed real work',
    (s) => {
      s.olderJobs[0]!.conclusion = 'failure';
    },
  ],
  [
    'timed out real work',
    (s) => {
      s.olderJobs[0]!.conclusion = 'timed_out';
    },
  ],
  [
    'missing cancellation',
    (s) => {
      s.olderJobs[0]!.conclusion = 'success';
    },
  ],
  [
    'only a tail',
    (s) => {
      s.olderJobs.shift();
    },
  ],
  [
    'another workflow tail',
    (s) => {
      s.olderJobs[0]!.name = 'CI ready (Checks)';
    },
  ],
];
for (const [name, change] of changes)
  test(`preserves ${name}`, () => {
    const state = fixture();
    change(state);
    expect(decideTail(state, now).action).toBe('preserve');
  });
for (const [workflow, context] of Object.entries(CI_CONTEXTS))
  test(`recognizes only the native ${workflow} final context`, () => {
    const state = fixture();
    for (const run of [state.older, state.replacement]) {
      run.name = context.slice(10, -1);
      run.path = `.github/workflows/${workflow}.yml`;
    }
    state.olderJobs[1]!.name = context;
    expect(decideTail(state, now).action).toBe('retire');
  });

function harness() {
  const state = fixture();
  const requests: { method: string; path: string }[] = [];
  const events: object[] = [];
  let hook: ((method: string, path: string) => unknown) | undefined;
  let clock = now;
  const api = (method: 'GET' | 'POST', path: string): unknown => {
    requests.push({ method, path });
    const override = hook?.(method, path);
    if (override !== undefined) return override;
    if (method === 'POST') {
      expect(path).toBe('repos/tale-project/tale/actions/runs/10/force-cancel');
      state.older.status = 'completed';
      state.older.conclusion = 'cancelled';
      state.olderJobs[1]!.status = 'completed';
      state.olderJobs[1]!.conclusion = 'cancelled';
      state.replacement.status = 'queued';
      return { accepted: true };
    }
    if (path.endsWith('/pulls/7')) return structuredClone(state.pull);
    if (path.endsWith('/runs/10')) return structuredClone(state.older);
    if (path.endsWith('/runs/11')) return structuredClone(state.replacement);
    const match =
      /\/runs\/(10|11)\/attempts\/1\/jobs\?per_page=100&page=([1-5])$/.exec(
        path,
      );
    if (!match) throw new Error('Unexpected fixture request');
    const jobs = match[1] === '10' ? state.olderJobs : state.replacementJobs;
    const start = (Number(match[2]) - 1) * 100;
    return structuredClone({
      total_count: jobs.length,
      jobs: jobs.slice(start, start + 100),
    });
  };
  return {
    state,
    requests,
    events,
    setHook: (value: typeof hook) => {
      hook = value;
    },
    advance: (value: number) => {
      clock += value;
    },
    deps: {
      api,
      now: () => clock,
      journal: (prepared: object) => {
        events.push(prepared);
        return {
          append: (event: object) => {
            events.push(event);
          },
          close: () => {},
        };
      },
    },
    posts: () => requests.filter((request) => request.method === 'POST'),
  };
}

test('default is read-only even when retirement is eligible', () => {
  const h = harness();
  expect(reconcileTail(options, h.deps)).toMatchObject({
    outcome: 'read_only',
    decision: { action: 'retire' },
  });
  expect(h.posts()).toHaveLength(0);
  expect(h.events).toHaveLength(0);
});
test('explicit apply journals one cancellation and observes its actual result', () => {
  const h = harness();
  expect(reconcileTail({ ...options, apply: true }, h.deps)).toMatchObject({
    outcome: 'cancelled',
    replacementStatus: 'queued',
  });
  expect(h.posts()).toHaveLength(1);
  expect(h.events.map((event) => (event as { phase: string }).phase)).toEqual([
    'prepared',
    'dispatching',
    'accepted',
    'readback',
  ]);
});
test('apply without an exclusive journal cannot mutate', () => {
  const h = harness();
  expect(
    reconcileTail(
      { ...options, apply: true },
      { api: h.deps.api, now: h.deps.now },
    ).outcome,
  ).toBe('preserved');
  expect(h.posts()).toHaveLength(0);
});
test('source changes during observation preserve every run', () => {
  const h = harness();
  let reads = 0;
  h.setHook((_method, path) => {
    if (path.endsWith('/pulls/7') && ++reads === 2)
      h.state.pull.base.sha = 'c'.repeat(40);
  });
  expect(reconcileTail({ ...options, apply: true }, h.deps).outcome).toBe(
    'preserved',
  );
  expect(h.posts()).toHaveLength(0);
});
test('new job topology between discovery and final admission is preserved', () => {
  const h = harness();
  let reads = 0;
  h.setHook((_method, path) => {
    if (path.includes('/runs/10/attempts/') && ++reads === 2)
      h.state.olderJobs.push({ ...h.state.olderJobs[0]!, id: 102 });
  });
  expect(reconcileTail({ ...options, apply: true }, h.deps)).toMatchObject({
    outcome: 'read_only',
    decision: { reason: 'changed_before_action' },
  });
  expect(h.posts()).toHaveLength(0);
});
test('a slow receipt cannot turn a stale observation into a write', () => {
  const h = harness();
  const journal = h.deps.journal;
  h.deps.journal = (prepared) => {
    h.advance(30_001);
    return journal(prepared);
  };
  expect(reconcileTail({ ...options, apply: true }, h.deps).outcome).toBe(
    'preserved',
  );
  expect(h.posts()).toHaveLength(0);
});
test('lost cancellation response stays unknown and is never retried', () => {
  const h = harness();
  h.setHook((method) => {
    if (method === 'POST') throw new Error('PRIVATE_ERROR_CANARY');
  });
  const result = reconcileTail({ ...options, apply: true }, h.deps);
  expect(result.outcome).toBe('mutation_outcome_unknown');
  expect(h.posts()).toHaveLength(1);
  expect(JSON.stringify({ result, events: h.events })).not.toContain(
    'PRIVATE_ERROR_CANARY',
  );
});
test('403 or unreadable metadata preserves work and does not invent telemetry', () => {
  const h = harness();
  h.setHook(() => {
    throw new Error('403 PRIVATE_TOKEN_CANARY');
  });
  const result = reconcileTail({ ...options, apply: true }, h.deps);
  expect(result.outcome).toBe('preserved');
  expect(h.posts()).toHaveLength(0);
  expect(JSON.stringify(result)).not.toContain('PRIVATE_TOKEN_CANARY');
});
test('incomplete page and wrong repository payload are refused', () => {
  for (const bad of ['page', 'repository']) {
    const h = harness();
    h.setHook((_method, path) => {
      if (bad === 'page' && path.includes('/jobs?'))
        return { total_count: 3, jobs: h.state.olderJobs };
      if (bad === 'repository' && path.endsWith('/runs/10'))
        return {
          ...h.state.older,
          repository: { full_name: 'another/private' },
        };
      return undefined;
    });
    expect(reconcileTail({ ...options, apply: true }, h.deps).outcome).toBe(
      'preserved',
    );
    expect(h.posts()).toHaveLength(0);
  }
});
test('a complete second job page is inspected before retirement', () => {
  const h = harness();
  for (let id = 102; id < 202; id++)
    h.state.olderJobs.push({ ...h.state.olderJobs[0]!, id });
  expect(reconcileTail(options, h.deps)).toMatchObject({
    decision: { action: 'retire' },
  });
  expect(h.requests.some((request) => request.path.endsWith('page=2'))).toBe(
    true,
  );
  h.state.olderJobs[101]!.status = 'in_progress';
  h.state.olderJobs[101]!.conclusion = null;
  expect(reconcileTail(options, h.deps)).toMatchObject({
    decision: { action: 'preserve' },
  });
});

const owned: string[] = [];
afterEach(() => {
  for (const path of owned.splice(0))
    rmSync(path, { recursive: true, force: true });
});
test.skipIf(process.platform === 'win32')(
  'exclusive owner-only receipt refuses replay and preserves an existing file',
  () => {
    const directory = mkdtempSync(join(tmpdir(), 'tale-ci-tail-test-'));
    owned.push(directory);
    const path = join(directory, 'receipt.jsonl');
    const h = harness();
    expect(
      reconcileTail(
        { ...options, apply: true },
        { ...h.deps, journal: exclusiveJournal(path) },
      ).outcome,
    ).toBe('cancelled');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const before = readFileSync(path, 'utf8');
    const second = harness();
    expect(
      reconcileTail(
        { ...options, apply: true },
        { ...second.deps, journal: exclusiveJournal(path) },
      ).outcome,
    ).toBe('preserved');
    expect(second.posts()).toHaveLength(0);
    expect(readFileSync(path, 'utf8')).toBe(before);
    writeFileSync(join(directory, 'unrelated'), 'retained');
  },
);
test('transport rejects off-scope and non-cancellation writes before starting gh', () => {
  const api = boundedGithub();
  for (const path of [
    'repos/other/private/actions/runs/1/force-cancel',
    'repos/tale-project/tale/issues/1',
    'repos/tale-project/tale/actions/runs/1/rerun',
  ])
    expect(() => api('POST', path)).toThrow('budget');
});

test('a cancellation accepted before asynchronous completion stays pending readback', () => {
  const h = harness();
  h.setHook((method) => (method === 'POST' ? { accepted: true } : undefined));
  expect(reconcileTail({ ...options, apply: true }, h.deps).outcome).toBe(
    'accepted_pending_readback',
  );
  expect(h.posts()).toHaveLength(1);
});

test('readback loss after dispatch preserves the unknown outcome without another POST', () => {
  const h = harness();
  h.setHook((method) => {
    if (method === 'GET' && h.posts().length > 0)
      throw new Error('PRIVATE_READBACK_CANARY');
  });
  const result = reconcileTail({ ...options, apply: true }, h.deps);
  expect(result.outcome).toBe('mutation_outcome_unknown');
  expect(h.posts()).toHaveLength(1);
  expect(JSON.stringify({ result, events: h.events })).not.toContain(
    'PRIVATE_READBACK_CANARY',
  );
});

test('receipt close failure does not replace a flushed terminal result', () => {
  const h = harness();
  const journal = h.deps.journal;
  h.deps.journal = (prepared) => ({
    ...journal(prepared),
    close: () => {
      throw new Error('PRIVATE_CLOSE_CANARY');
    },
  });
  expect(reconcileTail({ ...options, apply: true }, h.deps).outcome).toBe(
    'cancelled',
  );
  expect(h.posts()).toHaveLength(1);
});

test('duplicate second-page IDs and changing page totals refuse cancellation', () => {
  for (const kind of ['duplicate', 'changed-total']) {
    const h = harness();
    for (let id = 102; id < 202; id++)
      h.state.olderJobs.push({ ...h.state.olderJobs[0]!, id });
    h.setHook((_method, path) => {
      if (path.endsWith('page=2'))
        return {
          total_count: kind === 'changed-total' ? 101 : 102,
          jobs:
            kind === 'duplicate'
              ? [h.state.olderJobs[0]!, h.state.olderJobs[1]!]
              : h.state.olderJobs.slice(100),
        };
      return undefined;
    });
    expect(reconcileTail({ ...options, apply: true }, h.deps).outcome).toBe(
      'preserved',
    );
    expect(h.posts()).toHaveLength(0);
  }
});

test('network boundaries reject foreign heads, events, attempts and closed PRs', () => {
  for (const kind of [
    'foreign',
    'event',
    'attempt',
    'closed',
    'draft',
    'invalid-id',
  ]) {
    const h = harness();
    h.setHook((_method, path) => {
      if (path.endsWith('/runs/10')) {
        if (kind === 'foreign')
          return {
            ...h.state.older,
            head_repository: { full_name: 'another/private' },
          };
        if (kind === 'event')
          return { ...h.state.older, event: 'workflow_dispatch' };
        if (kind === 'attempt') return { ...h.state.older, run_attempt: 2 };
        if (kind === 'invalid-id') return { ...h.state.older, id: 10.1 };
      }
      if (path.endsWith('/pulls/7')) {
        if (kind === 'closed') return { ...h.state.pull, state: 'closed' };
        if (kind === 'draft') return { ...h.state.pull, draft: true };
      }
      return undefined;
    });
    expect(reconcileTail({ ...options, apply: true }, h.deps).outcome).toBe(
      'preserved',
    );
    expect(h.posts()).toHaveLength(0);
  }
});

test.skipIf(process.platform === 'win32')(
  'receipt file and directory flush precede cancellation dispatch',
  () => {
    const directory = mkdtempSync(join(tmpdir(), 'tale-ci-tail-durable-'));
    owned.push(directory);
    const phases: string[] = [];
    const h = harness();
    h.setHook((method) => {
      if (method === 'POST') phases.push('post');
    });
    const journal = exclusiveJournal(join(directory, 'receipt.jsonl'), {
      file: () => {
        phases.push('file');
      },
      directory: (path) => {
        expect(path).toBe(directory);
        phases.push('directory');
      },
    });
    expect(
      reconcileTail({ ...options, apply: true }, { ...h.deps, journal })
        .outcome,
    ).toBe('cancelled');
    expect(phases.slice(0, 4)).toEqual(['file', 'directory', 'file', 'post']);
  },
);

test.skipIf(process.platform === 'win32')(
  'a directory flush failure retains intent and prevents dispatch',
  () => {
    const directory = mkdtempSync(join(tmpdir(), 'tale-ci-tail-refusal-'));
    owned.push(directory);
    const path = join(directory, 'receipt.jsonl');
    const h = harness();
    const journal = exclusiveJournal(path, {
      file: () => {},
      directory: () => {
        throw new Error('PRIVATE_DIRECTORY_CANARY');
      },
    });
    const result = reconcileTail(
      { ...options, apply: true },
      { ...h.deps, journal },
    );
    expect(result.outcome).toBe('preserved');
    expect(h.posts()).toHaveLength(0);
    expect(JSON.parse(readFileSync(path, 'utf8')).phase).toBe('prepared');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_DIRECTORY_CANARY');
  },
);

test('terminal canceled or skipped jobs may have no assigned GitHub runner', () => {
  const h = harness();
  h.state.olderJobs[0]!.runner_id = null;
  h.state.olderJobs.push({
    ...h.state.olderJobs[0]!,
    id: 102,
    conclusion: 'skipped',
  });
  expect(reconcileTail(options, h.deps)).toMatchObject({
    outcome: 'read_only',
    decision: { action: 'retire' },
  });
  expect(h.posts()).toHaveLength(0);
});

test('a queued final check with the REST null runner representation is eligible', () => {
  const h = harness();
  h.state.olderJobs[1]!.runner_id = null;
  expect(reconcileTail(options, h.deps)).toMatchObject({
    outcome: 'read_only',
    decision: { action: 'retire' },
  });
  expect(h.posts()).toHaveLength(0);
});

test('an unassigned null-runner tail permits only the guarded single cancellation', () => {
  const h = harness();
  h.state.olderJobs[1]!.runner_id = null;
  expect(reconcileTail({ ...options, apply: true }, h.deps)).toMatchObject({
    outcome: 'cancelled',
    decision: { action: 'retire' },
  });
  expect(h.posts()).toHaveLength(1);
});

test('missing runner metadata is not treated as an unassigned null runner', () => {
  const h = harness();
  Reflect.deleteProperty(h.state.olderJobs[1]!, 'runner_id');
  expect(reconcileTail({ ...options, apply: true }, h.deps)).toMatchObject({
    outcome: 'preserved',
  });
  expect(h.posts()).toHaveLength(0);
});
