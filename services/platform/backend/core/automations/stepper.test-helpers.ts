// A stand-in for everything the stepper reaches through its ctx — the run
// row, its fenced writes, the effect ledger, the saved automations and the
// connector door — for the stepper suites that walk a run across several
// turns. It keeps the run's checkpoints the way the store merges them, and
// answers the ledger the way `domains/automations/node-attempts.ts` does, so
// a suite can stop a run between two turns, change what the ledger holds,
// and step it again. Test-only: never imported by shipped code.

import type { Automation } from '../../../lib/engine/core/types';
import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import type { BeginAttempt } from './ledger';

/** One row of the stand-in effect ledger. */
export interface FakeAttempt {
  id: string;
  nodeId: string;
  itemIndex: number;
  pass: number;
  attempt: number;
  kind: 'connector' | 'llm';
  status: 'started' | 'done' | 'failed';
  output?: unknown;
  error?: string;
  failureCode?: string | null;
  resolution?: 'retry' | 'skip' | 'fail' | null;
  input?: unknown;
}

/** A saved automation the run's subautomation nodes can reach. */
export interface FakeSaved {
  versions: Record<number, Automation>;
  deployed: number;
}

export interface FakeWorld {
  /** The ctx to hand `stepRunImpl`, typed for its parameter. */
  ctx: never;
  /** The run row as the store would hold it. */
  run: {
    status: string;
    epoch: number;
    checkpoints: Record<string, unknown>;
    detail?: string;
  };
  ledger: Map<string, FakeAttempt>;
  saved: Record<string, FakeSaved>;
  /** Every connector call the run made, in order. */
  connectorCalls: Array<Record<string, unknown>>;
  /** Every ledger begin the stepper asked for, in order. */
  begins: Array<Record<string, unknown>>;
  suspended: Array<Record<string, unknown>>;
  /** Every hand-off to the next turn, in order. */
  continued: Array<Record<string, unknown>>;
  finished: Array<Record<string, unknown>>;
  progress: Array<Record<string, unknown>>;
  /** Every saved-automation lookup, in order. */
  lookups: Array<Record<string, unknown>>;
  /** Answers the next `recordProgress` with this status instead of the
   * run's, once. */
  answerNextProgress?: string;
  /** Runs right after a claim is granted — where a suite lets another
   * walker take the run over. */
  afterClaim?: () => void;
}

export function ledgerKey(
  nodeId: string,
  itemIndex: number,
  pass: number,
): string {
  return `${nodeId}|${itemIndex}|${pass}`;
}

/** A handler argument as text, the way the store would read it. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function clone<T>(value: T): T {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a JSON round trip keeps the shape
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * A run of `document`, in `mode`, with nothing recorded yet. `connector`
 * answers each connector call (the door's `{ status, output, effects }`); by
 * default every call succeeds as a write and echoes its input.
 */
export function fakeStepperWorld(options: {
  document: Automation;
  mode?: 'mock' | 'live';
  input?: unknown;
  checkpoints?: Record<string, unknown>;
  saved?: Record<string, FakeSaved>;
  connector?: (args: Record<string, unknown>) => Promise<unknown>;
}): FakeWorld {
  const world: Omit<FakeWorld, 'ctx'> = {
    run: {
      status: 'queued',
      epoch: 0,
      checkpoints: options.checkpoints ?? { nodes: {}, executions: 0 },
    },
    ledger: new Map(),
    saved: options.saved ?? {},
    connectorCalls: [],
    begins: [],
    suspended: [],
    continued: [],
    finished: [],
    progress: [],
    lookups: [],
  };
  let nextAttemptId = 1;

  const begin = (args: Record<string, unknown>): BeginAttempt => {
    world.begins.push(args);
    if (args.epoch !== world.run.epoch || world.run.status !== 'running') {
      return { kind: 'stale' };
    }
    const nodeId = text(args.nodeId);
    const itemIndex = Number(args.itemIndex);
    const pass = Number(args.pass);
    const key = ledgerKey(nodeId, itemIndex, pass);
    const row = world.ledger.get(key);
    if (!row) {
      world.ledger.set(key, {
        id: `attempt-${nextAttemptId++}`,
        nodeId,
        itemIndex,
        pass,
        attempt: 1,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stepper passes one of the two kinds
        kind: args.kind as FakeAttempt['kind'],
        status: 'started',
        input: args.input,
      });
      return { kind: 'go', attempt: 1 };
    }
    if (row.status === 'done') return { kind: 'done', output: row.output };
    if (row.status === 'failed') {
      return {
        kind: 'failed',
        error: row.error ?? 'the step failed',
        failureCode: row.failureCode ?? null,
      };
    }
    if (row.resolution === 'skip') {
      row.status = 'done';
      row.output = null;
      return { kind: 'skip' };
    }
    if (row.resolution === 'fail') return { kind: 'fail', resolvedBy: 'ada' };
    if (row.resolution === 'retry' || args.recallable === true) {
      row.attempt += 1;
      row.resolution = null;
      row.input = args.input;
      return { kind: 'go', attempt: row.attempt };
    }
    return { kind: 'in_doubt', attemptId: row.id, attempt: row.attempt };
  };

  const finishAttempt = (args: Record<string, unknown>) => {
    const row = world.ledger.get(
      ledgerKey(text(args.nodeId), Number(args.itemIndex), Number(args.pass)),
    );
    if (!row || row.attempt !== args.attempt || row.status !== 'started') {
      return { recorded: false };
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stepper passes one of the two ends
    row.status = args.status as 'done' | 'failed';
    row.output = args.output;
    if (typeof args.error === 'string') row.error = args.error;
    if (typeof args.failureCode === 'string') {
      row.failureCode = args.failureCode;
    }
    return { recorded: true };
  };

  const lookup = (args: Record<string, unknown>) => {
    world.lookups.push(args);
    const saved = world.saved[text(args.name)];
    if (!saved) return null;
    const version =
      typeof args.version === 'number' ? args.version : saved.deployed;
    const document = saved.versions[version];
    return document === undefined ? null : { version, document };
  };

  const ctx = {
    runQuery: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      if (name.endsWith(':loadRunForStep')) {
        return {
          run: {
            name: options.document.name,
            mode: options.mode ?? 'live',
            input: options.input ?? {},
            checkpoints: clone(world.run.checkpoints),
          },
          document: options.document,
        };
      }
      if (name.endsWith(':loadAutomationDocument')) return lookup(args);
      if (name.endsWith(':probeCredentialUsableInternal')) {
        return { usable: true };
      }
      if (name.endsWith(':loadLiveAgentOpForRun')) return null;
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      if (name.endsWith(':claimRun')) {
        world.run.epoch += 1;
        world.run.status = 'running';
        const epoch = world.run.epoch;
        world.afterClaim?.();
        return { claimed: true, epoch };
      }
      if (name.endsWith(':heartbeatRun')) return { alive: true };
      if (name.endsWith(':evaluateApprovalGate')) return { decision: 'allow' };
      if (name.endsWith(':beginNodeAttempt')) return begin(args);
      if (name.endsWith(':finishNodeAttempt')) return finishAttempt(args);
      if (name.endsWith(':recordProgress')) {
        world.progress.push(clone(args));
        const answer = world.answerNextProgress;
        if (answer !== undefined) {
          delete world.answerNextProgress;
          return { status: answer };
        }
        const checkpoints = world.run.checkpoints;
        const nodes =
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stand-in keeps the store's shape
          (checkpoints.nodes as Record<string, unknown> | undefined) ?? {};
        if (args.nodeId !== undefined && args.checkpoint !== undefined) {
          nodes[text(args.nodeId)] = clone(args.checkpoint);
        }
        world.run.checkpoints = {
          nodes,
          executions: args.executions,
          ...(args.cursor !== undefined && { cursor: clone(args.cursor) }),
        };
        return { status: world.run.status };
      }
      if (name.endsWith(':suspendRun')) {
        world.suspended.push(clone(args));
        world.run.status = 'waiting';
        world.run.detail = text(args.detail);
        world.run.checkpoints = {
          nodes: world.run.checkpoints.nodes ?? {},
          executions: args.executions,
          ...(args.cursor !== undefined && { cursor: clone(args.cursor) }),
        };
        return { suspended: true };
      }
      if (name.endsWith(':continueRun')) {
        world.continued.push(clone(args));
        world.run.status = 'queued';
        return { scheduled: true };
      }
      if (name.endsWith(':finishRun')) {
        world.finished.push(clone(args));
        world.run.status = text(args.status);
        return { status: args.status };
      }
      throw new Error(`unexpected mutation ${name}`);
    },
    runAction: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      if (!name.endsWith(':runConnectorAction')) {
        throw new Error(`unexpected action ${name}`);
      }
      world.connectorCalls.push(clone(args));
      return options.connector !== undefined
        ? await options.connector(args)
        : { status: 'ok', output: { sent: args.input }, effects: 'write' };
    },
  };
  // The same object the handlers above read, so a suite's changes reach them.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stand-in answers every handler a stepper turn calls
  return Object.assign(world, { ctx: ctx as never });
}
