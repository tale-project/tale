import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

import { z } from 'zod';

import { CI_CONTEXTS } from './ci-ready';
import { exclusiveJournal } from './ci-retire-tail';
import { runSchema } from './ci-tail-policy';

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
  | { kind: 'cancel'; id: number };
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
};

/** Fixed read operations and ordinary cancellation only; never force-cancel. */
export function boundedMergeGroupGithub(): Api {
  const started = performance.now();
  let requests = 0;
  return (request) => {
    const remaining = 60_000 - (performance.now() - started);
    if (++requests > 20 || remaining < 1)
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
      ['api', '--hostname', 'github.com', '--include', ...args],
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
): unknown {
  const response =
    /^HTTP\/[\d.]+ (\d{3})[^\n]*\r?\n[\s\S]*?\r?\n\r?\n([\s\S]*)$/.exec(output);
  if (!response) throw new Error('Merge-group response unavailable.');
  const status = Number(response[1]);
  if (kind === 'ref') {
    if (status === 404 && exitCode === 1) return { missing: true };
    if (status === 200 && exitCode === 0) return { missing: false };
  } else if (kind === 'cancel') {
    if (status === 202 && exitCode === 0) return { accepted: true };
  } else if (status === 200 && exitCode === 0) {
    return JSON.parse(response[2] ?? '');
  }
  throw new Error('Merge-group request refused; verify existing access.');
}

function identity(run: MergeRun) {
  const { status: _status, conclusion: _conclusion, ...source } = run;
  return JSON.stringify(source);
}

function observe(id: number, { api, now }: Dependencies): Observation {
  const observedAt = now();
  const before = mergeRunSchema.parse(api({ kind: 'run', id }));
  if (before.id !== id) throw new Error('Wrong native run returned.');
  const queue = queueSchema.parse(api({ kind: 'queue' }));
  const ref = z
    .object({ missing: z.boolean() })
    .parse(api({ kind: 'ref', branch: before.head_branch }));
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
  if (!Object.hasOwn(CI_CONTEXTS, workflow))
    return { action: 'preserve', reason: 'unknown_workflow' } as const;
  if (
    run.name !==
      CI_CONTEXTS[workflow as keyof typeof CI_CONTEXTS].slice(10, -1) ||
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

/** One explicit obsolete revision, two native observations and at most one POST.
 * Ordinary cancellation may stop live validation for this deleted revision. */
export function reconcileMergeGroup(
  input: { run: number; apply?: boolean },
  dependencies: Dependencies,
) {
  let journal: Journal | undefined;
  let dispatched = false;
  try {
    const options = z
      .object({ run: runId, apply: z.boolean().default(false) })
      .parse(input);
    const initial = observe(options.run, dependencies);
    const decision = decideMergeGroup(initial, dependencies.now());
    const manifest = {
      version: 1,
      repository: 'tale-project/tale',
      run: initial.run.id,
      attempt: initial.run.run_attempt,
      head: initial.run.head_sha,
      branch: initial.run.head_branch,
      observedAt: initial.observedAt,
      decision,
    };
    if (!options.apply || decision.action !== 'retire')
      return { ...manifest, outcome: 'read_only' };
    if (!dependencies.journal) throw new Error('Exclusive receipt required.');
    const fresh = observe(options.run, dependencies);
    if (
      identity(initial.run) !== identity(fresh.run) ||
      decideMergeGroup(fresh, dependencies.now()).action !== 'retire'
    )
      return {
        ...manifest,
        outcome: 'preserved',
        reason: 'changed_before_action',
      };
    journal = dependencies.journal({ ...manifest, phase: 'prepared' });
    journal.append({ phase: 'dispatching', at: dependencies.now() });
    if (decideMergeGroup(fresh, dependencies.now()).action !== 'retire')
      throw new Error('Merge-group observation expired before dispatch.');
    dispatched = true;
    z.object({ accepted: z.literal(true) }).parse(
      dependencies.api({ kind: 'cancel', id: options.run }),
    );
    journal.append({ phase: 'accepted', at: dependencies.now() });
    const after = mergeRunSchema.parse(
      dependencies.api({ kind: 'run', id: options.run }),
    );
    if (identity(after) !== identity(fresh.run))
      throw new Error('Merge-group readback identity changed.');
    const outcome =
      after.status === 'completed' && after.conclusion === 'cancelled'
        ? 'cancelled'
        : 'accepted_pending_readback';
    journal.append({ phase: 'readback', at: dependencies.now(), outcome });
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
      },
    });
    const result = reconcileMergeGroup(
      { run: Number(values.run), apply: values.apply },
      {
        api: boundedMergeGroupGithub(),
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
