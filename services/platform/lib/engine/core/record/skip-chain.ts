/**
 * Why a step produced no output, followed back to where it started: a step
 * skipped because it reads a skipped step names that step, which names the
 * one it read, until a step that was skipped for a reason of its own — its
 * condition was false, its alternative ran, or it failed and the run went on.
 *
 * Derived when a run is read, from the stored records alone. Pure and
 * browser-safe: the app, the API and the agent tools serve the same chain.
 */

import type { Decision, NodeRunRecord, StepFailure } from './types';

/** One link of a skip chain; `path` is the step's address in the run (its
 * id at the top level, `parent[item:pass]/id` inside a subautomation). */
export type SkipCause =
  /** Its own condition was false. */
  | {
      kind: 'when';
      nodeId: string;
      path: string;
      decision?: Extract<Decision, { kind: 'when' }>;
    }
  /** It is the alternative of `partner`, which was not skipped by its own
   * condition. When the partner was skipped for another reason, the chain
   * goes on with the partner. */
  | { kind: 'else'; nodeId: string; path: string; partner: string }
  /** It failed, and `onError: continue` let the run go on without it. */
  | { kind: 'error'; nodeId: string; path: string; failure?: StepFailure }
  /** It reads `via`, which was skipped; the chain goes on with `via`. */
  | { kind: 'upstream'; nodeId: string; path: string; via: string }
  /** The run ended before it got here: it failed at, or was stopped at,
   * `stoppedAt`. */
  | {
      kind: 'not_run';
      nodeId: string;
      path: string;
      stoppedAt?: string;
      runStatus: 'failed' | 'cancelled';
    };

/** What the run as a whole says, for a step that has no record. */
export interface SkipChainRun {
  status: string;
  finished: boolean;
  /** The step the run failed at, or was stopped at. */
  failedNode?: string;
}

/** The node id at the end of a step's path. */
export function nodeIdOfPath(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The path of node `id` beside the step at `path`: the same subautomation
 * walk, or the top level. */
export function siblingPath(path: string, id: string): string {
  return `${path.slice(0, path.lastIndexOf('/') + 1)}${id}`;
}

/** Whether a record says its step failed and the run went on without it. */
export function failedAndContinued(record: NodeRunRecord): boolean {
  return (
    record.skip?.reason === 'error' ||
    (record.status === 'failed' &&
      record.decisions.some((d) => d.kind === 'onError'))
  );
}

function decisionOf<K extends Decision['kind']>(
  record: NodeRunRecord,
  kind: K,
): Extract<Decision, { kind: K }> | undefined {
  // The record keeps one decision per kind; the latest stands.
  return record.decisions.findLast(
    (d): d is Extract<Decision, { kind: K }> => d.kind === kind,
  );
}

/** A step a reference names: a path when it holds one, else an id beside
 * `from`. */
function pathOfRef(from: string, ref: string): string {
  return ref.includes('/') ? ref : siblingPath(from, ref);
}

/**
 * The chain of causes that left the step at `path` without output, nearest
 * first. `records` holds each step's own record (not its items or passes)
 * by path.
 *
 * Empty when the step ran, or when its record does not say why it was
 * skipped. A step with no record in a run that failed or was stopped
 * answers one `not_run` cause, naming where the run ended. The walk visits
 * each step at most once, so a malformed record that loops ends the chain.
 */
export function skipChain(
  records: ReadonlyMap<string, NodeRunRecord>,
  path: string,
  run?: SkipChainRun,
): SkipCause[] {
  const chain: SkipCause[] = [];
  const seen = new Set<string>();
  let at: string | undefined = path;
  while (at !== undefined && !seen.has(at) && seen.size <= records.size) {
    seen.add(at);
    const here: string = at;
    at = undefined;
    const record = records.get(here);
    if (record === undefined) {
      if (here === path) {
        const notRun = notRunCause(here, run);
        if (notRun !== undefined) chain.push(notRun);
      }
      break;
    }
    const nodeId = record.nodeId;
    if (failedAndContinued(record)) {
      chain.push({
        kind: 'error',
        nodeId,
        path: here,
        ...(record.failure !== undefined && { failure: record.failure }),
      });
      break;
    }
    if (record.status !== 'skipped') break;
    switch (record.skip?.reason) {
      case 'when': {
        const decision = decisionOf(record, 'when');
        chain.push({
          kind: 'when',
          nodeId,
          path: here,
          ...(decision !== undefined && { decision }),
        });
        break;
      }
      case 'else': {
        const partner =
          decisionOf(record, 'else')?.partner ?? record.skip.via?.[0];
        if (partner === undefined) break;
        chain.push({ kind: 'else', nodeId, path: here, partner });
        // The alternative is skipped when its partner was not skipped by
        // its condition: the partner ran (that is the cause), or was
        // skipped for a reason of its own, which the chain follows.
        const partnerRecord = records.get(pathOfRef(here, partner));
        if (
          partnerRecord !== undefined &&
          partnerRecord.status === 'skipped' &&
          partnerRecord.skip?.reason !== 'when' &&
          partnerRecord.skip?.reason !== 'error'
        ) {
          at = pathOfRef(here, partner);
        }
        break;
      }
      case 'upstream': {
        // The first skipped data reference in reading order: what the
        // executor names first, and what the flow analysis follows.
        const via =
          record.skip.via?.[0] ?? decisionOf(record, 'upstream')?.skipped[0];
        if (via === undefined) break;
        chain.push({ kind: 'upstream', nodeId, path: here, via });
        at = pathOfRef(here, via);
        break;
      }
      default:
        break;
    }
  }
  return chain;
}

function notRunCause(
  path: string,
  run: SkipChainRun | undefined,
): SkipCause | undefined {
  if (run === undefined || !run.finished) return undefined;
  // An in-process run that failed says `error`.
  const status = run.status === 'error' ? 'failed' : run.status;
  if (status !== 'failed' && status !== 'cancelled') return undefined;
  // The run ended at this very step: it was reached, so it is no step the
  // run never got to.
  if (run.failedNode === path) return undefined;
  return {
    kind: 'not_run',
    nodeId: nodeIdOfPath(path),
    path,
    ...(run.failedNode !== undefined && { stoppedAt: run.failedNode }),
    runStatus: status,
  };
}
