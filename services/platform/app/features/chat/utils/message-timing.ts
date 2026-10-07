/**
 * How a reply's time divides up, for the message-info panel.
 *
 * Every server anchor the turn pipeline stamps is measured from the moment
 * the server began the reply (`lib/chat/turn.ts` `timings`): setup ends when
 * the first model call goes out, the model starts thinking at its first
 * reasoning delta, writes its first answer token at TTFT, and the reply
 * settles at `durationMs`. Read in that order they are consecutive phases,
 * which the panel draws as one bar.
 *
 * A turn stamps only what its lane measured, so every phase is optional and
 * a phase whose bounds are missing or out of order is left out rather than
 * guessed. Pure: no React, no clock.
 */

import type { ChatMessageUsage } from '../types';

export type ReplyPhaseKind = 'preparing' | 'waiting' | 'thinking' | 'writing';

export interface ReplyPhase {
  readonly kind: ReplyPhaseKind;
  readonly startMs: number;
  readonly durationMs: number;
}

/** A finite, non-negative number from the free-form usage blob, or
 * undefined — the blob is JSON the client never validated. */
function anchor(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/**
 * The reply's phases, in order. Preparing runs from the reply's start to
 * the first model call; waiting from there to the model's first output —
 * a reasoning delta when it thought first, else its first answer token;
 * thinking from the first reasoning delta to the first answer token; writing
 * from the first answer token to the settle. A turn that never wrote an
 * answer token (a tool-only or empty reply) waits, or thinks, until it
 * settles.
 */
export function replyPhases(usage: ChatMessageUsage): ReplyPhase[] {
  const setup = anchor(usage.setupMs);
  const firstReasoning = anchor(usage.timeToFirstReasoningMs);
  const firstToken = anchor(usage.timeToFirstTokenMs);
  const done = anchor(usage.durationMs);
  if (done === undefined && firstToken === undefined) return [];

  const phases: ReplyPhase[] = [];
  let cursor = 0;
  const push = (kind: ReplyPhaseKind, endMs: number | undefined): void => {
    if (endMs === undefined || endMs <= cursor) return;
    phases.push({ kind, startMs: cursor, durationMs: endMs - cursor });
    cursor = endMs;
  };

  push('preparing', setup);
  const thoughtFirst =
    firstReasoning !== undefined &&
    (firstToken === undefined || firstReasoning < firstToken);
  if (thoughtFirst) {
    push('waiting', firstReasoning);
    push('thinking', firstToken ?? done);
  } else {
    push('waiting', firstToken ?? done);
  }
  if (firstToken !== undefined) push('writing', done);
  return phases;
}

/**
 * Output tokens per second while the model was producing them: from its
 * first output (a reasoning delta, else the first answer token) to the
 * settle. The whole duration would count setup and the wait for the first
 * byte as generation time; reasoning tokens are part of the output count,
 * so the window starts where they did. Undefined when the window or the
 * count is missing or empty.
 */
export function outputTokensPerSecond(
  usage: ChatMessageUsage,
): number | undefined {
  const output = anchor(usage.outputTokens);
  const done = anchor(usage.durationMs);
  const starts = [
    anchor(usage.timeToFirstReasoningMs),
    anchor(usage.timeToFirstTokenMs),
  ].filter((value) => value !== undefined);
  const start = starts.length > 0 ? Math.min(...starts) : undefined;
  if (output === undefined || output <= 0) return undefined;
  if (done === undefined || start === undefined) return undefined;
  const windowMs = done - start;
  if (windowMs <= 0) return undefined;
  return output / (windowMs / 1000);
}
