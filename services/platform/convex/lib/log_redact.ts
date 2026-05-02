import { fnv1aHash } from './fnv1a';

/**
 * Produce a non-reversible digest of a sensitive payload (e.g. a system
 * prompt, a user prompt) suitable for `debugLog`. Preserves cache-key-style
 * correlation and a length sanity check without ever shipping plaintext to
 * the log stream.
 *
 * Uses a pure-JS FNV-1a hash so this module can run in the Convex V8
 * runtime without a `'use node'` directive.
 *
 * @example
 *   debugLog('PRE_LLM_CALL', {
 *     system: summarizeForLog(systemPrompt),
 *     prompt: summarizeForLog(userPrompt),
 *   });
 */
export function summarizeForLog(payload: unknown): {
  digest: string;
  len: number;
} {
  const s = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return {
    digest: fnv1aHash(s),
    len: s.length,
  };
}
