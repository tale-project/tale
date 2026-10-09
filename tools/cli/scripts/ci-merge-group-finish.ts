import { createHash } from 'node:crypto';

import { parse } from 'yaml';
import { z } from 'zod';

import {
  FINISH_PROFILES,
  FINISH_WORKFLOWS,
  isFinishPath,
  type FinishPath,
  type FinishSource,
} from './ci-merge-group-profiles';
import type { NativeJob } from './ci-tail-policy';
export {
  FINISH_SOURCE,
  FINISH_PATHS,
  finishPaths,
  isFinishPath,
} from './ci-merge-group-profiles';
export type { FinishPath, FinishSource } from './ci-merge-group-profiles';

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const integer = z.number().int().positive();
const ordinaryPrepared = z.object({
  version: z.literal(1),
  repository: z.literal('tale-project/tale'),
  run: integer,
  attempt: integer,
  head: sha,
  branch: z.string(),
  observedAt: z.number().finite(),
  phase: z.literal('prepared'),
  mode: z.literal('ordinary').optional(),
  workflow: z
    .object({ id: integer, name: z.string(), path: z.string() })
    .optional(),
  decision: z.object({
    action: z.literal('retire'),
    reason: z.literal('deleted_ref_absent_from_queue'),
  }),
});
const timed = z.object({ at: z.number().finite() });
export type OrdinaryReceipt = ReturnType<typeof parseOrdinaryReceipt>;

/** Retain accepted ordinary evidence; never treat an uncertain POST as acceptance.
 * The immutable run ID binds legacy receipts to their native workflow identity. */
export function parseOrdinaryReceipt(text: string) {
  if (Buffer.byteLength(text) > 65_536 || !text.endsWith('\n'))
    throw new Error('Ordinary receipt is incomplete.');
  const rows: unknown[] = text
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line));
  if (rows.length < 3 || rows.length > 4)
    throw new Error('Ordinary receipt shape refused.');
  const prepared = ordinaryPrepared.parse(rows[0]);
  const dispatch = timed
    .extend({ phase: z.literal('dispatching') })
    .parse(rows[1]);
  const accepted = timed
    .extend({ phase: z.literal('accepted') })
    .parse(rows[2]);
  if (prepared.observedAt > dispatch.at || dispatch.at > accepted.at)
    throw new Error('Ordinary receipt chronology refused.');
  if (rows.length === 4) {
    const readback = timed
      .extend({
        phase: z.literal('readback'),
        outcome: z.enum(['cancelled', 'accepted_pending_readback']),
      })
      .parse(rows[3]);
    if (readback.at < accepted.at)
      throw new Error('Ordinary receipt chronology refused.');
  }
  return {
    ...prepared,
    acceptedAt: accepted.at,
    sha256: createHash('sha256').update(text).digest('hex'),
  };
}

/** Contents API must return the requested regular blob, not a symlink/submodule. */
export function decodeFinishSource(path: FinishPath, value: unknown): string {
  const file = z
    .object({
      type: z.literal('file'),
      path: z.literal(path),
      sha,
      encoding: z.literal('base64'),
      size: z.number().int().positive().max(65_536),
      content: z.string().max(100_000),
    })
    .parse(value);
  const encoded = file.content.replace(/\n/g, '');
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    )
  )
    throw new Error('Workflow source encoding refused.');
  const bytes = Buffer.from(encoded, 'base64');
  const blob = createHash('sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
  if (
    bytes.length !== file.size ||
    blob !== file.sha ||
    !FINISH_PROFILES.some(
      (profile) =>
        profile.hashes[path] ===
        createHash('sha256').update(bytes).digest('hex'),
    )
  )
    throw new Error('Unreviewed workflow source.');
  return bytes.toString('utf8');
}

const conclusions = new Set([
  'success',
  'failure',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
  'neutral',
  'startup_failure',
  'stale',
]);
const workflowSchema = z.object({
  jobs: z.record(
    z.string(),
    z.object({
      name: z.string(),
      if: z.string().optional(),
      strategy: z.unknown().optional(),
    }),
  ),
});

/** Require the exact whole closure, including no extraneous/missing source file.
 * Matching helpers from different historical profiles cannot create a new one. */
export function finishProfile(source: FinishSource) {
  return FINISH_PROFILES.find(
    (profile) =>
      Object.keys(source).length === Object.keys(profile.hashes).length &&
      Object.entries(profile.hashes).every(([path, hash]) => {
        const text = isFinishPath(path) ? source[path] : undefined;
        return (
          text !== undefined &&
          createHash('sha256').update(text).digest('hex') === hash
        );
      }),
  );
}
function terminal(job: NativeJob | undefined): boolean {
  return job?.status === 'completed' && conclusions.has(job.conclusion ?? '');
}

/** The entire future graph is source-pinned. Every substantive node must already
 * be terminal. Only known verdicts and event-inapplicable nodes may be absent. */
export function finishJobsSafe(
  source: FinishSource,
  jobs: NativeJob[],
): boolean {
  const profile = finishProfile(source);
  if (
    !profile ||
    !jobs.length ||
    new Set(jobs.map((job) => job.name)).size !== jobs.length ||
    new Set(jobs.map((job) => job.id)).size !== jobs.length
  )
    return false;
  const text = source[FINISH_WORKFLOWS[profile.workflow]];
  if (!text) return false;
  const workflow = workflowSchema.parse(
    parse(text, { maxAliasCount: profile.workflow === 'Build' ? 100 : 0 }),
  );
  const remaining = new Map(jobs.map((job) => [job.name, job]));
  const all = new Map(remaining);
  let queued = 0;
  for (const [id, node] of Object.entries(workflow.jobs)) {
    const job = remaining.get(node.name);
    if (profile.absent.includes(id)) {
      if (
        job &&
        (!terminal(job) ||
          (job.conclusion !== 'skipped' &&
            (profile.legacy || job.conclusion !== 'cancelled')))
      )
        return false;
      remaining.delete(node.name);
    } else if (profile.verdicts.includes(id)) {
      if (!job) continue;
      if (!terminal(job)) {
        if (
          job.status !== 'queued' ||
          job.conclusion !== null ||
          (job.runner_id !== 0 && job.runner_id !== null)
        )
          return false;
        queued++;
      }
      remaining.delete(node.name);
    } else if (node.strategy !== undefined) {
      const matrix = profile.matrices[id];
      if (!matrix) return false;
      const names = matrix.values.map((value) =>
        node.name.replace(
          '${{ matrix.' + matrix.variable + ' }}',
          String(value),
        ),
      );
      if (
        names.some((name) => name === node.name) ||
        new Set(names).size !== names.length
      )
        return false;
      if (job) {
        // A cancelled pre-expansion placeholder is not proof by itself. Its
        // exact required-success predecessor must have terminated unsuccessfully.
        const predecessor =
          matrix.requiresSuccess && workflow.jobs[matrix.requiresSuccess];
        const previous = predecessor ? all.get(predecessor.name) : undefined;
        if (
          !terminal(job) ||
          !['cancelled', 'skipped'].includes(job.conclusion ?? '') ||
          names.some((name) => all.has(name)) ||
          !previous ||
          !terminal(previous) ||
          previous.conclusion === 'success' ||
          !node.if?.includes(
            'needs.' + matrix.requiresSuccess + ".result == 'success'",
          )
        )
          return false;
        remaining.delete(node.name);
      } else {
        for (const name of names) {
          if (!terminal(remaining.get(name))) return false;
          remaining.delete(name);
        }
      }
    } else {
      if (!terminal(job)) return false;
      remaining.delete(node.name);
    }
  }
  return remaining.size === 0 && queued > 0;
}

export function sameFinishJobs(a: NativeJob[], b: NativeJob[]): boolean {
  const identities = (jobs: NativeJob[]) =>
    jobs
      .map(({ id, name, run_id, run_attempt, head_sha }) => ({
        id,
        name,
        run_id,
        run_attempt,
        head_sha,
      }))
      .sort((left, right) => left.id - right.id);
  return JSON.stringify(identities(a)) === JSON.stringify(identities(b));
}
