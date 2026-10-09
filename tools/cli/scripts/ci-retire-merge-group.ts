import { spawnSync } from 'node:child_process';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { z } from 'zod';

import {
  decodeFinishSource,
  FINISH_SOURCE,
  finishJobsSafe,
  parseOrdinaryReceipt,
  sameFinishJobs,
  type FinishPath,
  type FinishSource,
  type OrdinaryReceipt,
} from './ci-merge-group-finish';
import { CI_CONTEXTS } from './ci-ready';
import { exclusiveJournal, readNativeJobs } from './ci-retire-tail';
import { runSchema, type NativeJob } from './ci-tail-policy';

const repository = 'repos/tale-project/tale';
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const runId = z.number().int().positive();
const queueBranch = /^gh-readonly-queue\/main\/pr-[1-9]\d*-[a-f0-9]{40}$/;
const mergeRunSchema = runSchema.extend({
  event: z.literal('merge_group'),
  head_branch: z.string().regex(queueBranch),
});
const queueQuery = `query {
  repository(owner: "tale-project", name: "tale") {
    nameWithOwner
    defaultBranchRef { name target { oid } }
    mergeQueue(branch: "main") {
      entries(first: 100) {
        pageInfo { hasNextPage }
        nodes { headCommit { oid } pullRequest { headRefOid } }
      }
    }
  }
}`;
const queueSchema = z.object({
  data: z.object({
    repository: z.object({
      nameWithOwner: z.literal('tale-project/tale'),
      defaultBranchRef: z.object({
        name: z.literal('main'),
        target: z.object({ oid: sha }),
      }),
      mergeQueue: z.object({
        entries: z.object({
          pageInfo: z.object({ hasNextPage: z.literal(false) }),
          nodes: z
            .array(
              z.object({
                headCommit: z.object({ oid: sha }).nullable(),
                pullRequest: z.object({ headRefOid: sha }),
              }),
            )
            .max(100),
        }),
      }),
    }),
  }),
  errors: z.never().optional(),
});
type MergeRun = z.infer<typeof mergeRunSchema>;
type Request =
  | { kind: 'run'; id: number }
  | { kind: 'queue' }
  | { kind: 'ref'; branch: string }
  | { kind: 'cancel' | 'force'; id: number }
  | { kind: 'jobs'; id: number; attempt: number; page: number }
  | { kind: 'source'; head: string; path: FinishPath };
type Api = (request: Request) => unknown;
type Journal = ReturnType<ReturnType<typeof exclusiveJournal>>;
type Dependencies = {
  api: Api;
  now: () => number;
  journal?: (prepared: object) => Journal;
};
type Observation = {
  run: MergeRun;
  activeHeads: string[];
  refMissing: boolean;
  observedAt: number;
  finish?: { source: FinishSource; jobs: NativeJob[] };
};

/** Finishing transport must be explicitly selected; no automatic escalation. */
export function boundedMergeGroupGithub(finish = false): Api {
  const started = performance.now();
  let requests = 0;
  return (request) => {
    const remaining = 60_000 - (performance.now() - started);
    if (++requests > (finish ? 40 : 20) || remaining < 1)
      throw new Error('Merge-group metadata budget exceeded.');
    let args: string[];
    switch (request.kind) {
      case 'queue':
        args = ['graphql', '-f', `query=${queueQuery}`];
        break;
      case 'ref':
        if (!queueBranch.test(request.branch))
          throw new Error('Merge-group ref refused.');
        args = [`${repository}/git/ref/heads/${request.branch}`];
        break;
      case 'run':
        args = [`${repository}/actions/runs/${runId.parse(request.id)}`];
        break;
      case 'jobs':
        if (!finish) throw new Error('Finishing mode required.');
        args = [
          `${repository}/actions/runs/${runId.parse(request.id)}/attempts/${runId.parse(request.attempt)}/jobs?per_page=100&page=${z.number().int().min(1).max(5).parse(request.page)}`,
        ];
        break;
      case 'source':
        if (!finish || !Object.hasOwn(FINISH_SOURCE, request.path))
          throw new Error('Finishing source refused.');
        args = [
          `${repository}/contents/${request.path}?ref=${sha.parse(request.head)}`,
        ];
        break;
      case 'force':
        if (!finish) throw new Error('Finishing mode required.');
        args = [
          '--method',
          'POST',
          `${repository}/actions/runs/${runId.parse(request.id)}/force-cancel`,
        ];
        break;
      case 'cancel':
        args = [
          '--method',
          'POST',
          `${repository}/actions/runs/${runId.parse(request.id)}/cancel`,
        ];
        break;
    }
    const result = spawnSync(
      'gh',
      [
        'api',
        '--hostname',
        'github.com',
        '--include',
        '-H',
        'Cache-Control: no-cache',
        ...args,
      ],
      {
        encoding: 'utf8',
        timeout: Math.min(10_000, remaining),
        maxBuffer: 2 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    if (result.error || result.signal)
      throw new Error('Merge-group request unavailable.');
    return decodeMergeGroupResponse(request.kind, result.status, result.stdout);
  };
}

export function decodeMergeGroupResponse(
  kind: Request['kind'],
  exitCode: number | null,
  output: string,
  now = Date.now(),
): unknown {
  const response =
    /^HTTP\/[\d.]+ (\d{3})[^\n]*\r?\n([\s\S]*?)\r?\n\r?\n([\s\S]*)$/.exec(
      output,
    );
  if (!response) throw new Error('Merge-group response unavailable.');
  const headers = new Map<string, string>();
  for (const line of (response[2] ?? '').split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 1) throw new Error('Merge-group response headers refused.');
    const key = line.slice(0, separator).toLowerCase();
    if (['date', 'age'].includes(key) && headers.has(key))
      throw new Error('Merge-group response headers ambiguous.');
    headers.set(key, line.slice(separator + 1).trim());
  }
  const date = headers.get('date') ?? '';
  const age = headers.get('age') ?? '0';
  const serverAge = now - Date.parse(date);
  const elapsed = serverAge + Number(age) * 1000;
  if (
    !/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      date,
    ) ||
    !/^\d+$/.test(age) ||
    !Number.isFinite(now) ||
    !Number.isFinite(elapsed) ||
    serverAge < -5000 ||
    elapsed > 30_000
  )
    throw new Error('Merge-group response is stale.');
  const status = Number(response[1]);
  if (kind === 'ref') {
    if (status === 404 && exitCode === 1) return { missing: true };
    if (status === 200 && exitCode === 0) return { missing: false };
  } else if (kind === 'cancel' || kind === 'force') {
    if (status === 202 && exitCode === 0) return { accepted: true };
  } else if (status === 200 && exitCode === 0) {
    return JSON.parse(response[3] ?? '');
  }
  throw new Error('Merge-group request refused; verify existing access.');
}

function identity(run: MergeRun) {
  const { status: _status, conclusion: _conclusion, ...source } = run;
  return JSON.stringify(source);
}

function observe(
  id: number,
  { api, now }: Dependencies,
  finish = false,
): Observation {
  const observedAt = now();
  const before = mergeRunSchema.parse(api({ kind: 'run', id }));
  if (before.id !== id) throw new Error('Wrong native run returned.');
  const queue = queueSchema.parse(api({ kind: 'queue' }));
  const ref = z
    .object({ missing: z.boolean() })
    .parse(api({ kind: 'ref', branch: before.head_branch }));
  let finishing: Observation['finish'];
  if (finish) {
    if (
      before.name !== 'Checks' ||
      before.path !== '.github/workflows/checks.yml'
    )
      throw new Error('No reviewed finishing profile.');
    const readSource = (path: FinishPath) =>
      decodeFinishSource(
        path,
        api({ kind: 'source', head: before.head_sha, path }),
      );
    const source: FinishSource = {
      '.github/workflows/checks.yml': readSource(
        '.github/workflows/checks.yml',
      ),
      '.github/actions/ci-ready/action.yml': readSource(
        '.github/actions/ci-ready/action.yml',
      ),
      'tools/cli/scripts/ci-ready.ts': readSource(
        'tools/cli/scripts/ci-ready.ts',
      ),
    };
    const jobs = readNativeJobs(before, (_method, path) => {
      const page = Number(/&page=([1-5])$/.exec(path)?.[1]);
      return api({ kind: 'jobs', id, attempt: before.run_attempt, page });
    });
    finishing = { source, jobs };
  }
  const after = mergeRunSchema.parse(api({ kind: 'run', id }));
  if (identity(before) !== identity(after))
    throw new Error('Merge-group identity changed during observation.');
  return {
    run: after,
    activeHeads: [
      queue.data.repository.defaultBranchRef.target.oid,
      ...queue.data.repository.mergeQueue.entries.nodes.flatMap((entry) =>
        entry.headCommit
          ? [entry.pullRequest.headRefOid, entry.headCommit.oid]
          : [entry.pullRequest.headRefOid],
      ),
    ],
    refMissing: ref.missing,
    observedAt,
    ...(finishing ? { finish: finishing } : {}),
  };
}

export function decideMergeGroup(observation: Observation, now: number) {
  const { run, observedAt, activeHeads, refMissing } = observation;
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(observedAt) ||
    now < observedAt ||
    now - observedAt > 30_000
  )
    return { action: 'preserve', reason: 'stale_observation' } as const;
  const workflow = run.name.toLowerCase();
  const context = Object.entries(CI_CONTEXTS).find(
    ([key]) => key === workflow,
  )?.[1];
  if (!context)
    return { action: 'preserve', reason: 'unknown_workflow' } as const;
  if (
    run.name !== context.slice(10, -1) ||
    run.path !== `.github/workflows/${workflow}.yml`
  )
    return { action: 'preserve', reason: 'workflow_mismatch' } as const;
  if (
    !['queued', 'pending', 'in_progress', 'waiting', 'requested'].includes(
      run.status,
    ) ||
    run.conclusion !== null
  )
    return { action: 'preserve', reason: 'already_terminal' } as const;
  if (now - Date.parse(run.created_at) < 60_000)
    return { action: 'preserve', reason: 'new_group' } as const;
  if (!refMissing || activeHeads.includes(run.head_sha))
    return { action: 'preserve', reason: 'group_still_current' } as const;
  return { action: 'retire', reason: 'deleted_ref_absent_from_queue' } as const;
}

function finishingDecision(
  observation: Observation,
  now: number,
  ordinary?: OrdinaryReceipt,
) {
  const decision = decideMergeGroup(observation, now);
  if (decision.action !== 'retire' || !ordinary) return decision;
  const run = observation.run;
  if (
    ordinary.run !== run.id ||
    ordinary.attempt !== run.run_attempt ||
    ordinary.head !== run.head_sha ||
    ordinary.branch !== run.head_branch ||
    (ordinary.workflow &&
      (ordinary.workflow.id !== run.workflow_id ||
        ordinary.workflow.name !== run.name ||
        ordinary.workflow.path !== run.path)) ||
    now - ordinary.acceptedAt < 300_000
  )
    return {
      action: 'preserve',
      reason: 'ordinary_cancellation_not_settled',
    } as const;
  if (
    !observation.finish ||
    !finishJobsSafe(observation.finish.source, observation.finish.jobs)
  )
    return {
      action: 'preserve',
      reason: 'remaining_graph_not_verdict_only',
    } as const;
  return {
    action: 'retire',
    reason: 'cancelled_orphan_verdicts_only',
  } as const;
}

export function readOrdinaryReceiptFile(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 65_536)
      throw new Error('Ordinary receipt file refused.');
    const bytes = Buffer.alloc(65_537);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset > 65_536) throw new Error('Ordinary receipt exceeds its bound.');
    return bytes.subarray(0, offset).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/** One explicit obsolete revision, two native observations and at most one POST.
 * Ordinary cancellation may stop live validation for this deleted revision. */
export function reconcileMergeGroup(
  input: {
    run: number;
    apply?: boolean;
    finish?: boolean;
    ordinaryReceipt?: string;
  },
  dependencies: Dependencies,
) {
  let journal: Journal | undefined;
  let dispatched = false;
  try {
    const options = z
      .object({
        run: runId,
        apply: z.boolean().default(false),
        finish: z.boolean().default(false),
        ordinaryReceipt: z.string().max(65_536).optional(),
      })
      .refine((value) => value.finish === (value.ordinaryReceipt !== undefined))
      .parse(input);
    const ordinary =
      options.ordinaryReceipt === undefined
        ? undefined
        : parseOrdinaryReceipt(options.ordinaryReceipt);
    const initial = observe(options.run, dependencies, options.finish);
    const decide = (snapshot: Observation) =>
      finishingDecision(snapshot, dependencies.now(), ordinary);
    const decision = decide(initial);
    const manifest = {
      version: 1,
      repository: 'tale-project/tale',
      run: initial.run.id,
      attempt: initial.run.run_attempt,
      head: initial.run.head_sha,
      branch: initial.run.head_branch,
      observedAt: initial.observedAt,
      decision,
      mode: options.finish ? 'finish' : 'ordinary',
      workflow: {
        id: initial.run.workflow_id,
        name: initial.run.name,
        path: initial.run.path,
      },
      ...(ordinary
        ? {
            ordinaryReceiptSha256: ordinary.sha256,
            ordinaryAcceptedAt: ordinary.acceptedAt,
          }
        : {}),
      ...(initial.finish
        ? { profile: FINISH_SOURCE, jobs: initial.finish.jobs }
        : {}),
    };
    if (!options.apply || decision.action !== 'retire')
      return { ...manifest, outcome: 'read_only' };
    if (!dependencies.journal) throw new Error('Exclusive receipt required.');
    const fresh = observe(options.run, dependencies, options.finish);
    if (
      identity(initial.run) !== identity(fresh.run) ||
      (initial.finish &&
        (!fresh.finish ||
          !sameFinishJobs(initial.finish.jobs, fresh.finish.jobs))) ||
      decide(fresh).action !== 'retire'
    )
      return {
        ...manifest,
        outcome: 'preserved',
        reason: 'changed_before_action',
      };
    journal = dependencies.journal({ ...manifest, phase: 'prepared' });
    journal.append({ phase: 'dispatching', at: dependencies.now() });
    if (decide(fresh).action !== 'retire')
      throw new Error('Merge-group observation expired before dispatch.');
    dispatched = true;
    z.object({ accepted: z.literal(true) }).parse(
      dependencies.api({
        kind: options.finish ? 'force' : 'cancel',
        id: options.run,
      }),
    );
    journal.append({ phase: 'accepted', at: dependencies.now() });
    const after = mergeRunSchema.parse(
      dependencies.api({ kind: 'run', id: options.run }),
    );
    if (identity(after) !== identity(fresh.run))
      throw new Error('Merge-group readback identity changed.');
    const afterJobs = options.finish
      ? readNativeJobs(after, (_method, path) =>
          dependencies.api({
            kind: 'jobs',
            id: after.id,
            attempt: after.run_attempt,
            page: Number(/&page=([1-5])$/.exec(path)?.[1]),
          }),
        )
      : undefined;
    const outcome =
      (!afterJobs ||
        (fresh.finish &&
          sameFinishJobs(fresh.finish.jobs, afterJobs) &&
          afterJobs.every(
            (job) => job.status === 'completed' && job.conclusion !== null,
          ))) &&
      after.status === 'completed' &&
      after.conclusion === 'cancelled'
        ? 'cancelled'
        : 'accepted_pending_readback';
    journal.append({
      phase: 'readback',
      at: dependencies.now(),
      outcome,
      ...(afterJobs ? { jobs: afterJobs } : {}),
    });
    return { ...manifest, outcome };
  } catch {
    const outcome = dispatched ? 'mutation_outcome_unknown' : 'preserved';
    try {
      journal?.append({
        phase: 'unconfirmed',
        at: dependencies.now(),
        outcome,
      });
    } catch {
      // The exclusive prepared receipt still prevents replay.
    }
    return {
      outcome,
      reason: dispatched
        ? 'readback_required_no_retry'
        : 'input_or_observation_unavailable',
    };
  } finally {
    try {
      journal?.close();
    } catch {
      // Every recorded event was flushed before closing.
    }
  }
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: {
        run: { type: 'string' },
        apply: { type: 'boolean', default: false },
        receipt: { type: 'string' },
        finish: { type: 'boolean', default: false },
        'ordinary-receipt': { type: 'string' },
      },
    });
    const result = reconcileMergeGroup(
      {
        run: Number(values.run),
        apply: values.apply,
        finish: values.finish,
        ...(values['ordinary-receipt']
          ? {
              ordinaryReceipt: readOrdinaryReceiptFile(
                values['ordinary-receipt'],
              ),
            }
          : {}),
      },
      {
        api: boundedMergeGroupGithub(values.finish),
        now: Date.now,
        ...(values.receipt
          ? { journal: exclusiveJournal(values.receipt) }
          : {}),
      },
    );
    console.log(JSON.stringify(result));
    if (['preserved', 'mutation_outcome_unknown'].includes(result.outcome))
      process.exitCode = 1;
  } catch {
    console.error(
      'Merge-group recovery refused its arguments or receipt; no retry was attempted.',
    );
    process.exitCode = 1;
  }
}
