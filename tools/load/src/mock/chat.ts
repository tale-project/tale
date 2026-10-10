/**
 * Serving one chat request, whichever dialect it speaks: admission against
 * the stream limit, the plan, an HTTP-level fault, then either a buffered
 * answer after the whole generation time or a paced stream.
 */

import type { ServerResponse } from 'node:http';

import type { MockContext } from './context.ts';
import { errorReply, faultLabel, type Dialect } from './faults.ts';
import { ResponseStream, SSE_HEADERS, sendJson } from './http.ts';
import { Pacer } from './pacer.ts';
import {
  bufferedLatencyMs,
  planReply,
  type ChatTurnInput,
  type ReplyPlan,
} from './reply.ts';

/** How a dialect puts a plan on the wire. */
export interface ChatRenderer {
  readonly dialect: Dialect;
  /** Response headers of every answer (request ids and the like). */
  readonly headers: Readonly<Record<string, string>>;
  /** The provider's in-stream error event, as a complete SSE frame. */
  readonly errorFrame: string;
  /** Token-bearing chunks a stream of `plan` sends. */
  totalChunks(plan: ReplyPlan): number;
  /** Write the whole stream through `pacer` (headers are already sent). */
  stream(pacer: Pacer, stream: ResponseStream, plan: ReplyPlan): Promise<void>;
  /** The buffered answer's JSON body. */
  buffered(plan: ReplyPlan): unknown;
}

/** A 5xx is answered after at most this long (a provider failing fast). */
const SERVER_ERROR_MAX_DELAY_MS = 2000;

export async function serveChat(
  ctx: MockContext,
  res: ServerResponse,
  input: ChatTurnInput,
  renderer: ChatRenderer,
  arrivedAt: number,
): Promise<void> {
  const { metrics, options } = ctx;
  if (input.stream && !ctx.tryOpenStream()) {
    metrics.recordFault('capacity');
    const reply = errorReply(
      renderer.dialect,
      429,
      options.retryAfterSeconds,
      'The model is at capacity. Please retry shortly.',
    );
    sendJson(res, reply.status, reply.body, reply.headers);
    return;
  }
  try {
    const plan = planReply(ctx.requestRandom(), input, options, ctx.cache);
    const label = faultLabel(plan.fault);
    if (label !== null) metrics.recordFault(label);
    const stream = new ResponseStream(res);
    const elapsed = (): number => performance.now() - arrivedAt;

    if (plan.fault.kind === 'http') {
      if (plan.fault.status >= 500) {
        await stream.sleep(
          Math.min(plan.ttftMs, SERVER_ERROR_MAX_DELAY_MS) - elapsed(),
        );
      }
      const reply = errorReply(
        renderer.dialect,
        plan.fault.status,
        options.retryAfterSeconds,
      );
      sendJson(res, reply.status, reply.body, {
        ...renderer.headers,
        ...reply.headers,
      });
      return;
    }

    metrics.addPromptTokens(plan.promptTokens, plan.cachedTokens);
    if (!input.stream) {
      await stream.sleep(bufferedLatencyMs(plan) - elapsed());
      if (stream.closed) return;
      metrics.addOutputTokens(plan.completionTokens, plan.reasoningTokens);
      sendJson(res, 200, renderer.buffered(plan), renderer.headers);
      return;
    }

    stream.open(200, { ...SSE_HEADERS, ...renderer.headers });
    const pacer = new Pacer({
      stream,
      plan,
      metrics,
      arrivedAt,
      totalChunks: renderer.totalChunks(plan),
      errorFrame: renderer.errorFrame,
    });
    try {
      await renderer.stream(pacer, stream, plan);
    } finally {
      metrics.addOutputTokens(
        pacer.emittedTokens,
        pacer.emittedReasoningTokens,
      );
      if (stream.aborted && !pacer.failed) metrics.recordAbort();
    }
  } finally {
    if (input.stream) ctx.closeStream();
  }
}
