/**
 * Prompt caching, reported the way OpenAI reports it.
 *
 * A provider that has just served a conversation keeps its prefix warm: the
 * next turn (the same messages plus the reply plus a new question), a tool
 * round's follow-up, or a regenerate of the last answer re-reads that prefix
 * from cache and bills it cheaper. The mock keeps a bounded LRU of prompt
 * prefix hashes — every request remembers its whole prompt and its prompt
 * minus the last message — and a request reports, as `cached_tokens`, the
 * longest remembered prefix of its own messages (all but the last one),
 * rounded down to a multiple of 128 and only from 1024 tokens on, as
 * OpenAI does.
 */

import { createHash, type Hash } from 'node:crypto';

/** OpenAI caches prompts from this many tokens on. */
export const CACHE_MIN_TOKENS = 1024;
/** Cache hits come in increments of this many tokens. */
export const CACHE_BLOCK_TOKENS = 128;

/** The cached share of a prefix of `prefixTokens` tokens. */
export function cachedTokensFor(prefixTokens: number): number {
  if (prefixTokens < CACHE_MIN_TOKENS) return 0;
  return Math.floor(prefixTokens / CACHE_BLOCK_TOKENS) * CACHE_BLOCK_TOKENS;
}

/**
 * Rolling prefix hashes of a prompt: after each message, the hash of
 * everything up to and including it. The seed (model and tool definitions)
 * is part of every prefix, as it is of a provider's cache key.
 */
export class PrefixHasher {
  private readonly hash: Hash;
  readonly hashes: string[] = [];

  constructor(seed: string) {
    this.hash = createHash('sha1');
    this.hash.update(seed);
  }

  /** Feed part of the current message. */
  add(part: string): void {
    this.hash.update(part);
    // A separator, so ["ab", "c"] and ["a", "bc"] hash apart.
    this.hash.update('\u0000');
  }

  /** Close the current message: record the hash of the prefix so far. */
  commit(): void {
    this.hash.update('\u0001');
    this.hashes.push(this.hash.copy().digest('base64'));
  }
}

/** A bounded LRU of prompt-prefix hashes and their token counts. */
export class PromptCache {
  private readonly capacity: number;
  private readonly entries = new Map<string, number>();

  constructor(capacity: number) {
    this.capacity = Math.max(0, Math.floor(capacity));
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * The cached tokens of a prompt whose rolling hashes are `hashes` (with
   * `tokens[i]` the tokens up to message `i`), then remember it. Only
   * prefixes that leave out at least the last message can hit.
   */
  lookupAndRemember(
    hashes: readonly string[],
    tokens: readonly number[],
  ): number {
    if (this.capacity === 0 || hashes.length === 0) return 0;
    let hit = 0;
    for (let i = hashes.length - 2; i >= 0; i--) {
      const hash = hashes[i];
      if (hash !== undefined && this.entries.has(hash)) {
        hit = tokens[i] ?? 0;
        // Refresh: a prefix in use stays warm.
        this.entries.delete(hash);
        this.entries.set(hash, hit);
        break;
      }
    }
    const last = hashes.length - 1;
    this.remember(hashes[last], tokens[last]);
    if (last > 0) this.remember(hashes[last - 1], tokens[last - 1]);
    return cachedTokensFor(hit);
  }

  private remember(hash: string | undefined, tokens: number | undefined): void {
    if (hash === undefined || tokens === undefined) return;
    this.entries.delete(hash);
    this.entries.set(hash, tokens);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }
}
