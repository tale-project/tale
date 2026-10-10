/**
 * Pacing a reply onto the wire like a model produces it.
 *
 * The first token leaves at the planned time to first token (counted from
 * the request's arrival); each later chunk leaves when the planned token
 * rate says its tokens exist. Deadlines are absolute, so timer jitter never
 * accumulates over a long reply. The pacer also injects the stream-level
 * faults: a stall right after the first chunk (the client has seen life,
 * then silence), or a mid-stream error halfway through the content.
 */

import type { ResponseStream } from './http.ts';
import type { MockMetrics } from './metrics.ts';
import type { ReplyPlan } from './reply.ts';

/** Waits shorter than this are not worth a timer; the chunk goes now. */
const MIN_WAIT_MS = 1;

export interface PacerSetup {
  readonly stream: ResponseStream;
  readonly plan: ReplyPlan;
  readonly metrics: MockMetrics;
  /** `performance.now()` when the request arrived. */
  readonly arrivedAt: number;
  /** Token-bearing chunks the reply will send (positions the mid-stream fault). */
  readonly totalChunks: number;
  /** The provider's in-stream error event, sent on a mid-stream fault. */
  readonly errorFrame: string;
}

export class Pacer {
  private readonly setup: PacerSetup;
  private origin = 0;
  private shift = 0;
  private sent = 0;
  private pacedTokens = 0;
  private ttftObserved = false;
  /** Tokens actually written to the client. */
  emittedTokens = 0;
  /** Reasoning tokens actually written. */
  emittedReasoningTokens = 0;
  /** True once a mid-stream fault ended the stream. */
  failed = false;

  constructor(setup: PacerSetup) {
    this.setup = setup;
  }

  private get midstreamAt(): number {
    return Math.max(1, Math.floor(this.setup.totalChunks / 2));
  }

  /** Wait out the time to first token. False when the client left. */
  async begin(): Promise<boolean> {
    const { stream, plan, arrivedAt } = this.setup;
    await stream.sleep(plan.ttftMs - (performance.now() - arrivedAt));
    this.origin = performance.now();
    if (stream.closed) return false;
    if (this.setup.totalChunks === 0) {
      if (plan.fault.kind === 'stall') await this.stall(plan.fault.ms);
      if (plan.fault.kind === 'midstream') return this.fail();
    }
    return !stream.closed;
  }

  /** A frame that carries no tokens (a block start, a call header). */
  async control(frame: string): Promise<boolean> {
    return this.setup.stream.write(frame);
  }

  /**
   * A frame carrying `tokens` tokens, sent when the rate says they exist.
   * False when the stream is over (client gone or fault injected).
   */
  async chunk(
    frame: string,
    tokens: number,
    reasoning = false,
  ): Promise<boolean> {
    const { stream, plan, metrics } = this.setup;
    if (stream.closed) return false;
    if (this.sent > 0) {
      const due =
        this.origin +
        this.shift +
        (this.pacedTokens / plan.tokensPerSecond) * 1000;
      const wait = due - performance.now();
      if (wait >= MIN_WAIT_MS) await stream.sleep(wait);
      if (stream.closed) return false;
    }
    if (!this.ttftObserved) {
      this.ttftObserved = true;
      metrics.observeTtft((performance.now() - this.setup.arrivedAt) / 1000);
    }
    if (!(await stream.write(frame))) return false;
    this.sent += 1;
    this.pacedTokens += tokens;
    this.emittedTokens += tokens;
    if (reasoning) this.emittedReasoningTokens += tokens;
    if (plan.fault.kind === 'stall' && this.sent === 1) {
      await this.stall(plan.fault.ms);
      if (stream.closed) return false;
    }
    if (plan.fault.kind === 'midstream' && this.sent >= this.midstreamAt) {
      return this.fail();
    }
    return true;
  }

  private async stall(ms: number): Promise<void> {
    const before = performance.now();
    await this.setup.stream.sleep(ms);
    this.shift += performance.now() - before;
  }

  private async fail(): Promise<boolean> {
    const { stream, errorFrame } = this.setup;
    this.failed = true;
    await stream.write(errorFrame);
    stream.end();
    return false;
  }
}
