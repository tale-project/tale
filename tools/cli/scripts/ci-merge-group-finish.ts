import { createHash } from 'node:crypto';

import { parse } from 'yaml';
import { z } from 'zod';

import type { NativeJob } from './ci-tail-policy';

/** Reviewed 6ad49e4714cd895c5c1cc79e12b6987a0fecbec5 Checks graph.
 * Whole-file pins include every future job, matrix and verdict dependency.
 * New variants need their own source review; names alone never admit them. */
export const FINISH_SOURCE = {
  '.github/workflows/checks.yml':
    'a0937203f1b3095b0d8b4cc8560eeb947b7c07a9acf5c430850fbb42fa22e497',
  '.github/actions/ci-ready/action.yml':
    '8f65cea1dd5980711da087140a68264b382ff1cb0d6347d8ef034c71ddbaf7c5',
  'tools/cli/scripts/ci-ready.ts':
    '4e4adbbcf43c835800f6eb4a92db7f0a98db7432a50e3cd320aa75312294fdf8',
} as const;
export const FINISH_PATHS = [
  '.github/workflows/checks.yml',
  '.github/actions/ci-ready/action.yml',
  'tools/cli/scripts/ci-ready.ts',
] as const;
export type FinishPath = keyof typeof FINISH_SOURCE;
export type FinishSource = Record<FinishPath, string>;
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
    createHash('sha256').update(bytes).digest('hex') !== FINISH_SOURCE[path]
  )
    throw new Error('Unreviewed workflow source.');
  return bytes.toString('utf8');
}

const verdicts = new Set(['Unit', 'UI', 'CI ready (Checks)']);
const inapplicable = new Set(['candidate-source', 'candidate-gate']);
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
      strategy: z
        .object({ matrix: z.object({ shard: z.array(integer) }) })
        .optional(),
    }),
  ),
});

/** With the complete source pinned, only three verdict nodes may still materialize.
 * Candidate-only reusable jobs are inapplicable to this merge_group event. */
export function finishJobsSafe(
  source: FinishSource,
  jobs: NativeJob[],
): boolean {
  for (const path of FINISH_PATHS)
    if (
      createHash('sha256').update(source[path]).digest('hex') !==
      FINISH_SOURCE[path]
    )
      return false;
  const workflow = workflowSchema.parse(
    parse(source['.github/workflows/checks.yml'], { maxAliasCount: 0 }),
  );
  const required = new Set<string>();
  const excluded = new Set<string>();
  for (const [id, job] of Object.entries(workflow.jobs)) {
    if (inapplicable.has(id)) excluded.add(job.name);
    else if (!verdicts.has(job.name)) {
      if (job.strategy) {
        for (const shard of job.strategy.matrix.shard)
          required.add(job.name.replace('${{ matrix.shard }}', String(shard)));
      } else required.add(job.name);
    }
  }
  if (
    !jobs.length ||
    new Set(jobs.map((job) => job.name)).size !== jobs.length ||
    new Set(jobs.map((job) => job.id)).size !== jobs.length
  )
    return false;
  let queued = 0;
  for (const job of jobs) {
    if (excluded.has(job.name)) {
      if (job.status !== 'completed' || job.conclusion !== 'skipped')
        return false;
    } else if (required.has(job.name)) {
      if (job.status !== 'completed' || !conclusions.has(job.conclusion ?? ''))
        return false;
      required.delete(job.name);
    } else if (verdicts.has(job.name)) {
      if (job.status === 'completed' && conclusions.has(job.conclusion ?? ''))
        continue;
      if (
        job.status !== 'queued' ||
        job.conclusion !== null ||
        (job.runner_id !== 0 && job.runner_id !== null)
      )
        return false;
      queued++;
    } else return false;
  }
  return required.size === 0 && queued > 0;
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
