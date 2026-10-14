/**
 * The verdict a ported workflow's `CI ready (…)` job gives.
 *
 * On GitHub that job evaluates the workflow's `needs` with Tale's own policy
 * (`../ci-ready.ts`) in a `github-script` step, against a pull request or a merge
 * group. On Forgejo there is neither the API nor the merge group: a pull request
 * and a batch of the merge train both run the full suite, so both are judged as
 * what the policy calls a merge group, which is "everything ran at full scope".
 * The policy itself is not copied or changed: this only describes the Forgejo run
 * in the words it knows, and hands it the jobs the port left out as skipped, which
 * is what they are.
 *
 * Run as a script it reads the job's environment and the runner's event file, so
 * the generated job is a checkout and one command.
 */

import { readFileSync } from 'node:fs';

import { CI_JOBS, evaluateReadiness } from '../ci-ready';

const ZEROS = '0'.repeat(40);
const SHA = /^[a-f0-9]{40}$/;

export interface ReadyInput {
  /** The workflow's stem: `checks`. */
  readonly workflow: string;
  /** `toJSON(needs)` of the ready job. */
  readonly needs: unknown;
  /** The jobs of the GitHub workflow the port left out: they did not run and cannot have. */
  readonly removed: readonly string[];
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

/** What a pull request or a batch is, in the policy's words: a base, a head and the commit checked out. */
function describe(
  event: string,
  payload: unknown,
  sha: string,
): { base: string; head: string; source: string } | Verdict {
  const body = record(payload);
  if (event === 'pull_request') {
    const pull = record(body?.pull_request);
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
    return { base: baseSha, head: headSha, source: headSha };
  }
  if (event === 'push') {
    const after = typeof body?.after === 'string' ? body.after : sha;
    const before = typeof body?.before === 'string' ? body.before : ZEROS;
    return {
      base: SHA.test(before) ? before : ZEROS,
      head: after,
      source: sha,
    };
  }
  return held('Readiness is only defined for pull_request and push');
}

export function judgeReadiness(input: ReadyInput): Verdict {
  const what = describe(input.event, input.payload, input.sha);
  if ('passed' in what) return what;
  const needs = record(input.needs);
  if (!needs) return held('Native needs must be an object');
  const known: readonly string[] = Object.hasOwn(CI_JOBS, input.workflow)
    ? CI_JOBS[input.workflow as keyof typeof CI_JOBS]
    : [];
  const filled: Record<string, unknown> = { ...needs };
  for (const id of input.removed) {
    if (known.includes(id) && !(id in filled))
      filled[id] = { result: 'skipped', outputs: {} };
  }
  return evaluateReadiness({
    workflow: input.workflow,
    event: 'merge_group',
    payload: { merge_group: { base_sha: what.base, head_sha: what.head } },
    needs: filled,
    source: what.source,
  });
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
  const removed = (env.CI_PORT_REMOVED ?? '')
    .split(',')
    .filter((id) => id !== '');
  return {
    workflow: required('CI_WORKFLOW'),
    needs: JSON.parse(required('CI_NEEDS')) as unknown,
    removed,
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
