/**
 * Zod schemas for runtime PII configuration.
 *
 * These are the validators every admin-supplied input passes through
 * before reaching `createScrubber`. They live here (not next to the
 * scrubber) because they are imported on both client (admin UI form
 * validation) and server (Convex mutation `upsertPolicy`), and a shared
 * package keeps the contract single-source-of-truth.
 *
 * Two checks per custom regex:
 *   1. It compiles. `new RegExp(v)` throws on a structural failure.
 *   2. `safe-regex2` static AST analysis rejects nested-quantifier shapes
 *      (`(a+)+b`, `(a|aa)+`, `(a|a?)+`) that exhibit catastrophic
 *      backtracking. Without this, an admin can save a pattern that hangs
 *      every guardrail-protected message — `execWithBudget` checks the
 *      wall clock only between `exec()` calls and cannot pre-empt a
 *      single pathological exec.
 */

import safe from 'safe-regex2';
import { z } from 'zod';

import { BUILT_IN_PATTERN_NAMES } from '../patterns';

/** Catch-all enum so future built-ins automatically appear in the schema. */
const builtInPatternNameSchema = z.enum(BUILT_IN_PATTERN_NAMES);

export const piiCustomPatternSchema = z.object({
  name: z.string().min(1).max(80),
  regex: z
    .string()
    .min(1)
    .max(500)
    .refine((v) => {
      try {
        // Construct just to validate syntax; result is unused.
        return Boolean(new RegExp(v));
      } catch {
        return false;
      }
    }, 'Invalid regex pattern')
    .refine((v) => {
      try {
        return safe(v);
      } catch {
        return false;
      }
    }, 'Pattern is unsafe — likely catastrophic backtracking'),
  replacement: z.string().min(1).max(64),
});
export type PiiCustomPattern = z.infer<typeof piiCustomPatternSchema>;

/**
 * The legacy "flat" configuration shape — `enabledPatterns: string[]`
 * lists the built-ins to turn on; address / nationalId loaded against
 * every available locale.
 *
 * This is the shape the existing Convex `governancePolicies.pii_config`
 * documents are stored in. The Convex consumer's adapter translates this
 * into `ScrubberOptions` at scrubber-build time so existing data
 * deserializes without migration.
 */
export const piiConfigSchema = z.object({
  enabled: z.boolean(),
  /**
   * Three behaviours when PII is detected:
   *   - `mask`     — splice generic tokens (`[EMAIL]`) into the text.
   *                  One-way; the original is lost. Recommended for
   *                  audit logs and stored chat history.
   *   - `block`    — reject the message entirely. Recommended when
   *                  the org's policy forbids any PII upstream at all.
   *   - `tokenize` — splice indexed tokens (`[EMAIL_1]`) and keep a
   *                  per-message restore mapping so the LLM's response
   *                  can be detokenized back to the user's original
   *                  details. Recommended for the most natural UX —
   *                  the user sees their own data flow through.
   */
  mode: z.enum(['mask', 'block', 'tokenize']),
  /** Subset of `BUILT_IN_PATTERN_NAMES` to enable. */
  enabledPatterns: z.array(z.string()),
  /** Admin-supplied custom patterns. */
  customPatterns: z.array(piiCustomPatternSchema).optional(),
  /**
   * Optional explicit locale codes for locale-aware patterns. When
   * omitted, every available locale is loaded (`'*'`). Kept optional so
   * the existing DB documents (which don't carry this field) still parse.
   */
  locales: z.array(z.string().min(2)).optional(),
});
export type PiiConfig = z.infer<typeof piiConfigSchema>;

/** Re-export so consumers can iterate the canonical list. */
export { BUILT_IN_PATTERN_NAMES, builtInPatternNameSchema };
