/**
 * What every handler of one mock server shares: its options, metrics,
 * prompt cache, random stream and stream admission.
 */

import { randomInt as cryptoRandomInt } from 'node:crypto';

import type { MockOptions } from './config.ts';
import type { MockMetrics } from './metrics.ts';
import { PromptCache } from './prompt-cache.ts';
import { createRandom, type Random } from './random.ts';

export class MockContext {
  readonly options: MockOptions;
  readonly metrics: MockMetrics;
  readonly cache: PromptCache;
  /** The seed this server runs on (the configured one, or a drawn one). */
  readonly seed: number;
  private readonly seeds: Random;
  private openStreams = 0;

  constructor(options: MockOptions, metrics: MockMetrics) {
    this.options = options;
    this.metrics = metrics;
    this.cache = new PromptCache(options.promptCacheEntries);
    this.seed = options.seed ?? cryptoRandomInt(0, 2 ** 31);
    this.seeds = createRandom(this.seed);
  }

  /**
   * A generator for one request. Requests draw their seeds from the server's
   * stream in arrival order, so a seeded run replays request by request.
   */
  requestRandom(): Random {
    return createRandom(Math.floor(this.seeds() * 4_294_967_296));
  }

  /** Admit one more stream, or refuse when at `maxConcurrentStreams`. */
  tryOpenStream(): boolean {
    const max = this.options.maxConcurrentStreams;
    if (max > 0 && this.openStreams >= max) return false;
    this.openStreams += 1;
    this.metrics.streamOpened();
    return true;
  }

  closeStream(): void {
    if (this.openStreams === 0) return;
    this.openStreams -= 1;
    this.metrics.streamClosed();
  }
}
