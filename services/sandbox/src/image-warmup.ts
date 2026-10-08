import { reportSandboxError } from './error-reporting.ts';
import { jsonResponse } from './http-util.ts';

/** Where the runtime image stands on this host: never checked (warmup
 * skipped), being pulled, present, or absent after a failed pull and waiting
 * for the next attempt. */
export type RuntimeImageState = 'unchecked' | 'pulling' | 'ready' | 'missing';

export interface RuntimeImageStatus {
  state: RuntimeImageState;
  /** Why the last attempt failed; null once the image is present. */
  lastError: string | null;
  /** When the next pull starts while the image is missing (epoch ms). */
  nextAttemptAtMs: number | null;
}

/** Waits between pulls while the image stays absent, the last one repeated:
 * a host cut off from its registry is asked again every ten minutes, and one
 * that just lost the image (an `image prune` on an idle host) gets it back
 * within the first. */
export const IMAGE_RETRY_DELAYS_MS: readonly number[] = [
  30_000, 60_000, 120_000, 300_000, 600_000,
];

interface ImageWarmupOptions {
  delaysMs?: readonly number[];
  now?: () => number;
}

/** A cold image pull must not hold the control API or session adoption behind
 * a registry transfer. Only creation waits; existing compute keeps serving.
 *
 * A failed pull is not the end of it: while the image is absent every create
 * would fail, so creates keep getting `429 runtime_image` and the pull is
 * tried again with backoff. A create that finds the image gone after it was
 * ready (`restart`) starts the same cycle. */
export class ImageWarmup {
  private inFlight: Promise<void> | null = null;
  private state: RuntimeImageState = 'unchecked';
  private lastError: string | null = null;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private nextAttemptAtMs: number | null = null;
  private readonly delaysMs: readonly number[];
  private readonly now: () => number;

  /** @param warm Makes the image present; throws when it could not. */
  constructor(
    private readonly warm: () => Promise<void>,
    opts: ImageWarmupOptions = {},
  ) {
    this.delaysMs = opts.delaysMs ?? IMAGE_RETRY_DELAYS_MS;
    this.now = opts.now ?? Date.now;
  }

  /** Whether creates must wait: the image is being pulled, or is absent. */
  pending(): boolean {
    return this.state === 'pulling' || this.state === 'missing';
  }

  status(): RuntimeImageStatus {
    return {
      state: this.state,
      lastError: this.lastError,
      nextAttemptAtMs: this.state === 'missing' ? this.nextAttemptAtMs : null,
    };
  }

  /** The answer a create gets while {@link pending}, else null. */
  refusal(): Response | null {
    if (!this.pending()) return null;
    if (this.state === 'missing') {
      const waitMs = (this.nextAttemptAtMs ?? this.now()) - this.now();
      return jsonResponse(
        {
          error: 'runtime_image',
          message:
            'the sandbox runtime image is not on this host and could not be pulled; the spawner keeps trying',
          detail: this.lastError,
        },
        429,
        {
          'retry-after': String(
            Math.min(60, Math.max(5, Math.ceil(waitMs / 1000))),
          ),
        },
      );
    }
    return jsonResponse(
      {
        error: 'runtime_image',
        message: 'the sandbox runtime image is being prepared; retry shortly',
      },
      429,
      { 'retry-after': '5' },
    );
  }

  start(): Promise<void> {
    if (this.inFlight !== null) return this.inFlight;
    this.clearRetry();
    this.state = 'pulling';
    const run = this.attempt().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  private async attempt(): Promise<void> {
    // Off the caller's tick, so a create's refusal check never waits on it.
    await Promise.resolve();
    try {
      await this.warm();
    } catch (error) {
      this.failed(error);
      return;
    }
    if (this.failures > 0) {
      console.log('[sandbox] runtime image is present again');
    }
    this.state = 'ready';
    this.lastError = null;
    this.failures = 0;
  }

  /** A create found the image missing. Pull it again unless a pull is under
   * way or one is already scheduled (the backoff stands). */
  restart(detail: string): Promise<void> {
    if (this.inFlight !== null) return this.inFlight;
    if (this.state === 'missing' && this.retryTimer !== null) {
      return Promise.resolve();
    }
    console.warn(
      `[sandbox] a session create found the runtime image missing; pulling it again: ${detail}`,
    );
    return this.start();
  }

  /** Stop the scheduled retry (shutdown, tests). */
  stop(): void {
    this.clearRetry();
  }

  private failed(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const delayMs =
      this.delaysMs[Math.min(this.failures, this.delaysMs.length - 1)] ??
      600_000;
    this.failures += 1;
    this.state = 'missing';
    this.lastError = message;
    this.nextAttemptAtMs = this.now() + delayMs;
    console.warn(
      `[sandbox] runtime image unavailable (attempt ${this.failures}); creates wait, next pull in ${Math.round(delayMs / 1000)} s:`,
      message,
    );
    // Once per outage, not once per retry: a host cut off from its
    // registry would otherwise report every ten minutes.
    if (this.failures === 1) reportSandboxError(error, 'image-warmup');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.start();
    }, delayMs);
    this.retryTimer.unref?.();
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.nextAttemptAtMs = null;
  }
}
