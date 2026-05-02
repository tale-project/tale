'use node';

import { createHash } from 'node:crypto';

/**
 * Produce a non-reversible digest of a sensitive payload (e.g. a system
 * prompt, a user prompt) suitable for `debugLog`. Preserves cache-key-style
 * correlation and a length sanity check without ever shipping plaintext to
 * the log stream.
 *
 * @example
 *   debugLog('PRE_LLM_CALL', {
 *     system: summarizeForLog(systemPrompt),
 *     prompt: summarizeForLog(userPrompt),
 *   });
 */
export function summarizeForLog(payload: unknown): {
  sha256: string;
  len: number;
} {
  const s = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return {
    sha256: createHash('sha256').update(s).digest('hex').slice(0, 12),
    len: s.length,
  };
}
