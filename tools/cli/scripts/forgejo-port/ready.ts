/**
 * The verdict a ported workflow's `CI ready (…)` job gives.
 *
 * On GitHub that job evaluates the workflow's `needs` with Tale's own policy
 * (`../ci-ready.ts`) in a `github-script` step, against the pull request. Forgejo does
 * not have the API that step uses. The policy itself is not copied or changed:
 * this describes the Forgejo pull request in the words it knows, and hands it the jobs
 * the port left out as what they would have reported to a pull request, which the
 * generator recorded.
 *
 * Run as a script it reads the job's environment and the runner's event file, so
 * the generated job is a checkout and one command.
 */

import { readFileSync } from 'node:fs';

import { CI_JOBS, evaluateReadiness } from '../ci-ready';

/** What a job reports to the jobs that need it. */
export interface JobResult {
  readonly result: 'success' | 'skipped';
  readonly outputs: Readonly<Record<string, string>>;
}

export interface ReadyInput {
  /** The workflow's stem: `checks`. */
  readonly workflow: string;
  /** `toJSON(needs)` of the ready job. */
  readonly needs: unknown;
  /** What the jobs of the GitHub workflow the port left out would have reported to a pull request, by id. */
  readonly removed: Readonly<Record<string, JobResult>>;
  /** `github.event_name`. */
  readonly event: string;
  /** The runner's event payload. */
  readonly payload: unknown;
  /** `github.sha`. */
  readonly sha: string;
}

export interface Verdict {
  readonly passed: boolean;
  readonly reasons: readonly string[];
  readonly jobs: readonly { job: string; result: string; policy: string }[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

function held(reason: string): Verdict {
  return { passed: false, reasons: [reason], jobs: [] };
}

interface Described {
  readonly base: string;
  readonly head: string;
  readonly changed: number;
}

/** The pull request, in the policy's words: its base, its head and how many files it changes. */
function describe(event: string, payload: unknown): Described | Verdict {
  if (event !== 'pull_request')
    return held('Readiness is only defined for pull_request');
  const pull = record(record(payload)?.pull_request);
  const head = record(pull?.head);
  const base = record(pull?.base);
  if (record(head?.repo)?.fork === true)
    return held(
      'A pull request from a fork is not validated here: a maintainer pushes the branch to the repository',
    );
  const headSha = head?.sha;
  const baseSha = base?.sha;
  if (typeof headSha !== 'string' || typeof baseSha !== 'string')
    return held('The pull request event names no base and head commit');
  const changed = pull?.changed_files;
  return {
    base: baseSha,
    head: headSha,
    changed:
      typeof changed === 'number' && Number.isSafeInteger(changed)
        ? changed
        : 0,
  };
}

export function judgeReadiness(input: ReadyInput): Verdict {
  const what = describe(input.event, input.payload);
  if ('passed' in what) return what;
  const needs = record(input.needs);
  if (!needs) return held('Native needs must be an object');
  const known: readonly string[] = Object.hasOwn(CI_JOBS, input.workflow)
    ? CI_JOBS[input.workflow as keyof typeof CI_JOBS]
    : [];
  const filled: Record<string, unknown> = { ...needs };
  for (const [id, removed] of Object.entries(input.removed)) {
    if (known.includes(id) && !(id in filled)) filled[id] = removed;
  }
  // A work in progress is not held here: Forgejo raises no event when one is marked
  // ready, so a hold would stay on a pull request that is ready. Forgejo itself refuses
  // to merge a work in progress.
  return evaluateReadiness({
    workflow: input.workflow,
    event: 'pull_request',
    payload: {
      pull_request: {
        base: { sha: what.base },
        head: { sha: what.head, repo: { fork: false } },
        changed_files: what.changed,
        draft: false,
      },
    },
    needs: filled,
    source: input.sha,
  });
}

function jobResult(value: unknown, where: string): JobResult {
  const job = record(value);
  const outputs = record(job?.outputs);
  if (
    !job ||
    !outputs ||
    (job.result !== 'success' && job.result !== 'skipped') ||
    Object.values(outputs).some((output) => typeof output !== 'string')
  )
    throw new Error(`${where} is not a job result`);
  return {
    result: job.result,
    outputs: Object.fromEntries(
      Object.entries(outputs).map(([name, output]) => [name, String(output)]),
    ),
  };
}

/** `CI_PORT_REMOVED`: what the jobs the port left out would have reported to a pull request, as the generator recorded it. */
export function parseRemoved(text: string): Record<string, JobResult> {
  const parsed: unknown = text === '' ? {} : JSON.parse(text);
  const jobs = record(parsed);
  if (!jobs) throw new Error('CI_PORT_REMOVED is not an object');
  return Object.fromEntries(
    Object.entries(jobs).map(([id, value]) => [
      id,
      jobResult(value, `CI_PORT_REMOVED.${id}`),
    ]),
  );
}

/** The job's environment and the runner's files, as `judgeReadiness` wants them. */
export function readInput(
  env: Readonly<Record<string, string | undefined>>,
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): ReadyInput {
  const required = (name: string): string => {
    const value = env[name];
    if (value === undefined || value === '')
      throw new Error(`${name} is not set`);
    return value;
  };
  return {
    workflow: required('CI_WORKFLOW'),
    needs: JSON.parse(required('CI_NEEDS')) as unknown,
    removed: parseRemoved((env.CI_PORT_REMOVED ?? '').trim()),
    event: required('GITHUB_EVENT_NAME'),
    payload: JSON.parse(read(required('GITHUB_EVENT_PATH'))) as unknown,
    sha: required('GITHUB_SHA'),
  };
}

/** Print the verdict as the GitHub version does: a table and, when held, the reasons. */
export function renderVerdict(verdict: Verdict): string {
  const rows = verdict.jobs.map(
    (job) => `${job.job.padEnd(24)} ${job.result.padEnd(10)} ${job.policy}`,
  );
  const head = verdict.passed ? 'CI readiness: passed' : 'CI readiness: held';
  return [
    head,
    ...rows,
    ...verdict.reasons.map((reason) => `  - ${reason}`),
  ].join('\n');
}

if (import.meta.main) {
  const verdict = judgeReadiness(readInput(process.env));
  console.log(renderVerdict(verdict));
  if (!verdict.passed) {
    console.log(`::error::${verdict.reasons.join('; ')}`);
    process.exit(1);
  }
}
