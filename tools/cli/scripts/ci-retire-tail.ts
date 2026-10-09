import { execFileSync } from 'node:child_process';
import { closeSync, fsyncSync, openSync, writeSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';

import { z } from 'zod';

import {
  decideTail,
  jobsPageSchema,
  pullSchema,
  runSchema,
  sameTailIdentity,
  type NativeJob,
  type NativeRun,
  type TailSnapshot,
} from './ci-tail-policy';

const repository = 'repos/tale-project/tale';
const positiveId = z.number().int().positive();
const optionsSchema = z
  .object({
    pull: positiveId,
    olderRun: positiveId,
    replacementRun: positiveId,
    apply: z.boolean().default(false),
  })
  .refine((value) => value.olderRun !== value.replacementRun);
type Options = z.input<typeof optionsSchema>;
type Api = (method: 'GET' | 'POST', path: string) => unknown;
type Journal = { append: (event: object) => void; close: () => void };
type Dependencies = {
  api: Api;
  now: () => number;
  journal?: (prepared: object) => Journal;
};

/** Existing gh authentication only. Errors never include GitHub bodies or stderr. */
export function boundedGithub(): Api {
  const started = performance.now();
  let requests = 0;
  return (method, path) => {
    const remaining = 60_000 - (performance.now() - started);
    const allowed =
      method === 'GET'
        ? /^repos\/tale-project\/tale\/(?:pulls\/[1-9]\d*|actions\/runs\/[1-9]\d*(?:\/attempts\/[1-9]\d*\/jobs\?per_page=100&page=[1-5])?)$/.test(
            path,
          )
        : /^repos\/tale-project\/tale\/actions\/runs\/[1-9]\d*\/force-cancel$/.test(
            path,
          );
    if (++requests > 40 || remaining < 1 || !allowed)
      throw new Error('CI metadata request budget exceeded.');
    try {
      const output = execFileSync(
        'gh',
        [
          'api',
          '--hostname',
          'github.com',
          '--method',
          method,
          ...(method === 'POST' ? ['--include'] : []),
          path,
        ],
        {
          encoding: 'utf8',
          timeout: Math.min(10_000, remaining),
          maxBuffer: 2 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      if (method === 'POST') {
        if (!/^HTTP\/[\d.]+ 202(?: |\r?$)/m.test(output))
          throw new Error('Cancellation acknowledgement unavailable.');
        return { accepted: true };
      }
      return JSON.parse(output);
    } catch {
      throw new Error(
        'GitHub CI request unavailable; verify existing authentication and Actions permissions.',
      );
    }
  };
}

function readJobs(run: NativeRun, api: Api): NativeJob[] {
  const jobs: NativeJob[] = [];
  let expected: number | undefined;
  for (let page = 1; page <= 5; page++) {
    const response = jobsPageSchema.parse(
      api(
        'GET',
        `${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`,
      ),
    );
    expected ??= response.total_count;
    if (expected !== response.total_count)
      throw new Error('CI job inventory changed during pagination.');
    jobs.push(...response.jobs);
    if (
      jobs.length > expected ||
      new Set(jobs.map((job) => job.id)).size !== jobs.length ||
      jobs.some(
        (job) =>
          job.run_id !== run.id ||
          job.run_attempt !== run.run_attempt ||
          job.head_sha !== run.head_sha,
      )
    )
      throw new Error('CI job identity refused.');
    if (jobs.length === expected) return jobs;
    if (response.jobs.length !== 100)
      throw new Error('Incomplete CI job inventory.');
  }
  throw new Error('CI job inventory exceeds its bounded page budget.');
}

function snapshot(options: Options, { api, now }: Dependencies): TailSnapshot {
  const started = now();
  const pullPath = `${repository}/pulls/${options.pull}`;
  const olderPath = `${repository}/actions/runs/${options.olderRun}`;
  const replacementPath = `${repository}/actions/runs/${options.replacementRun}`;
  const pull = pullSchema.parse(api('GET', pullPath));
  const older = runSchema.parse(api('GET', olderPath));
  const replacement = runSchema.parse(api('GET', replacementPath));
  if (
    pull.number !== options.pull ||
    older.id !== options.olderRun ||
    replacement.id !== options.replacementRun
  )
    throw new Error('Requested CI identity was not returned.');
  const olderJobs = readJobs(older, api);
  const replacementJobs = readJobs(replacement, api);
  const after = [
    runSchema.parse(api('GET', olderPath)),
    runSchema.parse(api('GET', replacementPath)),
    pullSchema.parse(api('GET', pullPath)),
  ];
  if (
    JSON.stringify([older, replacement, pull]) !== JSON.stringify(after) ||
    now() < started ||
    now() - started > 30_000
  )
    throw new Error('CI identity changed during observation.');
  return {
    pull,
    older,
    replacement,
    olderJobs,
    replacementJobs,
    observedAt: started,
  };
}

/** One explicit pair and at most one POST. Default is a read-only decision.
 * A lost response is journalled as unknown; it is never retried here. */
export function reconcileTail(input: Options, dependencies: Dependencies) {
  let journal: Journal | undefined;
  let dispatched = false;
  try {
    const options = optionsSchema.parse(input);
    const initial = snapshot(options, dependencies);
    const decision = decideTail(initial, dependencies.now());
    const manifest = {
      version: 1,
      repository: 'tale-project/tale',
      pull: options.pull,
      head: initial.pull.head.sha,
      base: initial.pull.base.sha,
      olderRun: initial.older.id,
      olderAttempt: initial.older.run_attempt,
      replacementRun: initial.replacement.id,
      replacementAttempt: initial.replacement.run_attempt,
      observedAt: initial.observedAt,
      decision,
    };
    if (!options.apply || decision.action === 'preserve')
      return { ...manifest, outcome: 'read_only' as const };
    if (!dependencies.journal)
      throw new Error('An exclusive cancellation receipt is required.');
    const fresh = snapshot(options, dependencies);
    const freshDecision = decideTail(fresh, dependencies.now());
    if (
      !sameTailIdentity(initial, fresh) ||
      JSON.stringify(decision) !== JSON.stringify(freshDecision)
    )
      return {
        ...manifest,
        decision: { action: 'preserve', reason: 'changed_before_action' },
        outcome: 'read_only' as const,
      };
    journal = dependencies.journal({ ...manifest, phase: 'prepared' });
    journal.append({ phase: 'dispatching', at: dependencies.now() });
    if (
      JSON.stringify(decideTail(fresh, dependencies.now())) !==
      JSON.stringify(decision)
    )
      throw new Error('CI observation expired before dispatch.');
    dispatched = true;
    const response = dependencies.api(
      'POST',
      `${repository}/actions/runs/${decision.olderRun}/force-cancel`,
    );
    z.object({ accepted: z.literal(true) }).parse(response);
    journal.append({ phase: 'accepted', at: dependencies.now() });
    const after = snapshot(options, dependencies);
    const tail = after.olderJobs.find((job) => job.id === decision.tailJob);
    const confirmed =
      after.older.id === decision.olderRun &&
      after.older.status === 'completed' &&
      after.older.conclusion === 'cancelled' &&
      tail?.status === 'completed' &&
      tail.conclusion === 'cancelled';
    const result = {
      ...manifest,
      outcome: confirmed
        ? ('cancelled' as const)
        : ('accepted_pending_readback' as const),
      replacementStatus: after.replacement.status,
    };
    journal.append({ ...result, phase: 'readback', at: dependencies.now() });
    return result;
  } catch {
    const result = {
      outcome: dispatched
        ? ('mutation_outcome_unknown' as const)
        : ('preserved' as const),
      reason: dispatched
        ? 'readback_required_no_retry'
        : 'input_or_observation_unavailable',
    };
    try {
      journal?.append({
        ...result,
        phase: 'unconfirmed',
        at: dependencies.now(),
      });
    } catch {
      /* The create-once prepared receipt still prevents replay. */
    }
    return result;
  } finally {
    try {
      journal?.close();
    } catch {
      /* Every event was flushed before this close. */
    }
  }
}

const durability = {
  file: fsyncSync,
  directory(path: string) {
    const parent = openSync(path, 'r');
    try {
      fsyncSync(parent);
    } finally {
      closeSync(parent);
    }
  },
};

export function exclusiveJournal(
  path: string,
  flush = durability,
): (prepared: object) => Journal {
  if (!isAbsolute(path))
    throw new Error('Use an absolute cancellation receipt path.');
  return (prepared) => {
    if (process.platform === 'win32')
      throw new Error('Cancellation receipts require a POSIX filesystem.');
    const fd = openSync(path, 'wx', 0o600);
    const append = (event: object) => {
      const bytes = Buffer.from(`${JSON.stringify(event)}\n`);
      let offset = 0;
      while (offset < bytes.length)
        offset += writeSync(fd, bytes, offset, bytes.length - offset);
      flush.file(fd);
    };
    try {
      append(prepared);
      // File sync alone does not persist the new directory entry after a crash.
      flush.directory(dirname(path));
    } catch (error) {
      closeSync(fd);
      throw error;
    }
    return { append, close: () => closeSync(fd) };
  };
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: {
        pr: { type: 'string' },
        'older-run': { type: 'string' },
        'replacement-run': { type: 'string' },
        apply: { type: 'boolean', default: false },
        receipt: { type: 'string' },
      },
    });
    const result = reconcileTail(
      {
        pull: Number(values.pr),
        olderRun: Number(values['older-run']),
        replacementRun: Number(values['replacement-run']),
        apply: values.apply,
      },
      {
        api: boundedGithub(),
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
      'CI tail recovery refused its arguments or receipt; no retry was attempted.',
    );
    process.exitCode = 1;
  }
}
