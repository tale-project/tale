import { z } from 'zod';

import { CI_CONTEXTS } from './ci-ready';

const id = z.number().int().positive();
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const repository = z.object({ full_name: z.literal('tale-project/tale') });
const source = z.object({ sha, ref: z.string().min(1), repo: repository });
export const pullSchema = z.object({
  number: id,
  state: z.literal('open'),
  draft: z.literal(false),
  merged: z.literal(false),
  head: source,
  base: source,
});
export const runSchema = z.object({
  id,
  workflow_id: id,
  run_number: id,
  run_attempt: id,
  name: z.string(),
  path: z.string(),
  event: z.literal('pull_request'),
  head_sha: sha,
  head_branch: z.string().min(1),
  repository,
  head_repository: repository,
  created_at: z.iso.datetime(),
  status: z.string(),
  conclusion: z.string().nullable(),
  pull_requests: z.array(
    z.object({ number: id, head: z.object({ sha }), base: z.object({ sha }) }),
  ),
});
export const jobSchema = z.object({
  id,
  name: z.string().min(1),
  run_id: id,
  run_attempt: id,
  head_sha: sha,
  status: z.string(),
  conclusion: z.string().nullable(),
  runner_id: z.number().int().nonnegative().nullable(),
});
export const jobsPageSchema = z.object({
  total_count: z.number().int().min(0).max(500),
  jobs: z.array(jobSchema).max(100),
});
export type NativeRun = z.infer<typeof runSchema>;
export type NativeJob = z.infer<typeof jobSchema>;
export type TailSnapshot = {
  pull: z.infer<typeof pullSchema>;
  older: NativeRun;
  replacement: NativeRun;
  olderJobs: NativeJob[];
  replacementJobs: NativeJob[];
  observedAt: number;
};
export type TailDecision =
  | { action: 'preserve'; reason: string }
  | {
      action: 'retire';
      olderRun: number;
      replacementRun: number;
      tailJob: number;
    };

/** Only the exact same source may replace an already-cancelled native run.
 * Cross-head/PR composition needs its own reviewed source-containment proof. */
export function decideTail(snapshot: TailSnapshot, now: number): TailDecision {
  const preserve = (reason: string): TailDecision => ({
    action: 'preserve',
    reason,
  });
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(snapshot.observedAt) ||
    now < snapshot.observedAt ||
    now - snapshot.observedAt > 30_000
  )
    return preserve('stale_observation');
  const { pull, older, replacement, olderJobs, replacementJobs } = snapshot;
  const workflow = older.name.toLowerCase();
  if (!Object.hasOwn(CI_CONTEXTS, workflow))
    return preserve('unknown_workflow');
  const context = CI_CONTEXTS[workflow as keyof typeof CI_CONTEXTS];
  if (
    older.name !== context.slice(10, -1) ||
    older.path !== `.github/workflows/${workflow}.yml` ||
    replacement.name !== older.name ||
    replacement.path !== older.path ||
    replacement.workflow_id !== older.workflow_id
  )
    return preserve('workflow_mismatch');
  if (
    older.id === replacement.id ||
    replacement.run_number <= older.run_number ||
    replacement.created_at < older.created_at
  )
    return preserve('replacement_not_newer');
  if (
    older.head_sha !== pull.head.sha ||
    replacement.head_sha !== pull.head.sha ||
    older.head_branch !== pull.head.ref ||
    replacement.head_branch !== pull.head.ref
  )
    return preserve('source_mismatch');
  for (const run of [older, replacement]) {
    if (
      run.pull_requests.length !== 1 ||
      run.pull_requests[0]?.number !== pull.number ||
      run.pull_requests[0]?.head.sha !== pull.head.sha ||
      run.pull_requests[0]?.base.sha !== pull.base.sha
    )
      return preserve('pull_identity_mismatch');
  }
  if (
    !['queued', 'in_progress'].includes(older.status) ||
    older.conclusion !== null ||
    replacement.status !== 'pending' ||
    replacement.conclusion !== null ||
    replacementJobs.length !== 0
  )
    return preserve('pair_progressed');
  if (
    new Set(olderJobs.map((job) => job.id)).size !== olderJobs.length ||
    olderJobs.some(
      (job) =>
        job.run_id !== older.id ||
        job.run_attempt !== older.run_attempt ||
        job.head_sha !== older.head_sha,
    )
  )
    return preserve('job_identity_mismatch');
  const tails = olderJobs.filter((job) => job.name === context);
  const real = olderJobs.filter((job) => job.name !== context);
  const tail = tails[0];
  if (
    tails.length !== 1 ||
    !tail ||
    tail.status !== 'queued' ||
    tail.conclusion !== null ||
    (tail.runner_id !== 0 && tail.runner_id !== null)
  )
    return preserve('tail_not_unallocated_queued');
  if (
    real.length === 0 ||
    real.some(
      (job) =>
        job.name.startsWith('CI ready (') ||
        job.status !== 'completed' ||
        !['success', 'cancelled', 'skipped'].includes(job.conclusion ?? ''),
    )
  )
    return preserve('actual_work_not_safely_terminal');
  if (!real.some((job) => job.conclusion === 'cancelled'))
    return preserve('no_cancelled_actual_work');
  return {
    action: 'retire',
    olderRun: older.id,
    replacementRun: replacement.id,
    tailJob: tail.id,
  };
}

/** Re-observation may advance statuses, but must not silently change the graph. */
export function sameTailIdentity(a: TailSnapshot, b: TailSnapshot): boolean {
  const identity = (snapshot: TailSnapshot) => ({
    pull: snapshot.pull,
    runs: [snapshot.older, snapshot.replacement].map(
      ({ status: _status, conclusion: _conclusion, ...run }) => run,
    ),
    jobs: snapshot.olderJobs
      .map(
        ({
          status: _status,
          conclusion: _conclusion,
          runner_id: _runner,
          ...job
        }) => job,
      )
      .sort((left, right) => left.id - right.id),
  });
  return JSON.stringify(identity(a)) === JSON.stringify(identity(b));
}
