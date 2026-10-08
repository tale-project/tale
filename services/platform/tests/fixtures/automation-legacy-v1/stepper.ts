import type {
  NodeCheckpoint,
  NodeCursor,
} from '../../../backend/core/automations/checkpoints.ts';
/** Exact b493 declarations; tests guard every body against the retained raw source.
 * Adapter only projects PG rows and omits realtime hints; it adds no fencing.
 * Historical fixture only; .dockerignore excludes services/platform/tests. */
import type { ActionCtx } from '../../../backend/core/lib/ctx.ts';
import { internal } from '../../../backend/core/lib/handler_names.ts';
import type { Id } from '../../../backend/core/lib/rows.ts';

interface RunSink {
  /** Persist one finished node, or just the in-node cursor. Returns the run's
   * status so cancellation stops the walk at the next node boundary. */
  commit(args: {
    nodeId?: string;
    checkpoint?: NodeCheckpoint;
    cursor?: NodeCursor;
    executions: number;
  }): Promise<'running' | 'cancelled'>;
  /** Park the run. `continue` means the caller should loop in place instead —
   * what an inline sub-run does, matching the in-memory executor. */
  wait(args: {
    detail: string;
    cursor?: NodeCursor;
    executions: number;
    resumeInMs: number;
  }): Promise<'suspended' | 'continue' | 'cancelled'>;
  /** Whether this turn should stop and let a fresh invocation continue. */
  shouldHandOff(): boolean;
  /** Hand the run to the scheduler. */
  handOff(): Promise<void>;
  /** Whether `wait` can actually park the run. False for the inline sink: a
   * step that would have to park (an agent turn, an approval) refuses BEFORE
   * it spends anything, instead of discovering `continue` after the kick. */
  canPark: boolean;
}

function durableSink(
  ctx: ActionCtx,
  organizationId: string,
  runId: Id<'automationRuns'>,
  deadline: number,
  epoch: number,
): RunSink {
  return {
    async commit(args) {
      const result = await ctx.runMutation(
        internal.automations.mutations.recordProgress,
        {
          organizationId,
          runId,
          epoch,
          ...(args.nodeId !== undefined && { nodeId: args.nodeId }),
          ...(args.checkpoint !== undefined && {
            checkpoint: args.checkpoint,
          }),
          ...(args.cursor !== undefined && { cursor: args.cursor }),
          executions: args.executions,
        },
      );
      return result.status === 'cancelled' || result.status === 'stale'
        ? 'cancelled'
        : 'running';
    },
    async wait(args) {
      const result = await ctx.runMutation(
        internal.automations.mutations.suspendRun,
        {
          organizationId,
          runId,
          epoch,
          detail: args.detail,
          ...(args.cursor !== undefined && { cursor: args.cursor }),
          executions: args.executions,
          resumeInMs: args.resumeInMs,
        },
      );
      return result.suspended ? 'suspended' : 'cancelled';
    },
    shouldHandOff() {
      return Date.now() >= deadline;
    },
    canPark: true,
    async handOff() {
      await ctx.runMutation(internal.automations.mutations.continueRun, {
        organizationId,
        runId,
        epoch,
        resumeInMs: 0,
      });
    },
  };
}
export { durableSink };
