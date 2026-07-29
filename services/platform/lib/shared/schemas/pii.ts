/**
 * PII governance-policy schema — the shape of `governance/pii-config.json`
 * (the org's `pii_config` policy) and the admin-UI form contract.
 *
 * Lives with the other org-config Zod schemas (Layer A: V8-safe, no `node:*`)
 * because it is imported on both client (admin form validation) and server
 * (policy write + config-cache sync). The PII *engine* that consumes this
 * config is the `pii` library (`lib/pii`, rebuilt in the config-system phase);
 * pattern/locale DEFINITIONS live in `configs/platform/system/pii/` — this
 * file only validates which of them an org turns on and how.
 *
 * Custom regexes pass two gates before they can be saved:
 *  1. they must compile (`new RegExp` throws on structural failure), and
 *  2. `safe-regex2` static analysis must accept them — it rejects
 *     ReDoS-prone shapes (nested quantifiers, star-height >1 alternations)
 *     while allowing bounded `{N,M}` quantifiers. The runtime exec budget
 *     only checks the wall clock BETWEEN `exec()` calls, so a single
 *     catastrophic regex would hang every guardrail-protected message —
 *     this gate is the only pre-emption.
 *
 * Both object schemas are `.strict()`: an admin-UI typo (`enable` vs
 * `enabled`) must fail validation, not silently save an always-off config.
 */

import safe from 'safe-regex2';
import { z } from 'zod/v4';

/**
 * The built-in pattern names an org may enable. Values appear verbatim in
 * existing org `pii-config.json` files — extend, never rename.
 */
export const BUILT_IN_PII_PATTERN_NAMES = [
  'email',
  'phone',
  'creditCard',
  'cvc',
  'iban',
  'ipAddress',
  'macAddress',
  'jwt',
  'ssn',
  'dateOfBirth',
  'address',
  'nationalId',
] as const;
export type BuiltInPiiPatternName = (typeof BUILT_IN_PII_PATTERN_NAMES)[number];

const builtInPatternNameSchema = z.enum(BUILT_IN_PII_PATTERN_NAMES);

export const piiCustomPatternSchema = z
  .object({
    name: z.string().min(1).max(64),
    regex: z
      .string()
      .min(1)
      .max(500)
      .refine((value) => {
        try {
          return Boolean(new RegExp(value));
        } catch (error) {
          console.warn(
            `[pii] custom pattern regex failed to compile: ${error instanceof Error ? error.name : 'unknown'}`,
          );
          return false;
        }
      }, 'Invalid regex pattern')
      .refine((value) => {
        try {
          return safe(value);
        } catch (error) {
          console.warn(
            `[pii] safe-regex2 analysis threw: ${error instanceof Error ? error.name : 'unknown'}`,
          );
          return false;
        }
      }, 'Pattern is unsafe — likely catastrophic backtracking'),
    replacement: z.string().min(1).max(64),
  })
  .strict();
export type PiiCustomPattern = z.infer<typeof piiCustomPatternSchema>;

export const piiConfigSchema = z
  .object({
    enabled: z.boolean(),
    /**
     * Behaviour on detection:
     *  - `mask`     — splice generic tokens (`[EMAIL]`); one-way.
     *  - `block`    — reject the message entirely.
     *  - `tokenize` — splice indexed tokens (`[EMAIL_1]`) with a per-message
     *                 restore map, so model output detokenizes back to the
     *                 user's original details.
     */
    mode: z.enum(['mask', 'block', 'tokenize']),
    /**
     * Pattern names to enable. A union of the built-in names (autocomplete)
     * with an open string fallback so library-supplied registry entries pass
     * validation; the engine logs and skips names it doesn't know rather than
     * throwing, so a stale admin config never bricks the pipeline.
     */
    enabledPatterns: z.array(
      z.union([builtInPatternNameSchema, z.string().min(1)]),
    ),
    /** Admin-supplied additional patterns (regex-safety gated above). */
    customPatterns: z.array(piiCustomPatternSchema).optional(),
    /**
     * Locale datasets to load for the locale-parameterized composites
     * (address / nationalId). Absent ⇒ every available locale. Optional so
     * pre-existing config files without the field still parse.
     */
    locales: z.array(z.string().min(2)).optional(),
  })
  .strict();
export type PiiConfig = z.infer<typeof piiConfigSchema>;
