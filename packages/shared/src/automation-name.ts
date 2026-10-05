/**
 * The automation name grammar — ONE rule for every surface that mints or
 * checks a name: the document validator, the subautomation reference parser,
 * the platform's automation store, and the URL codec that carries a name
 * inside a single path segment (`lib/automations/slug.ts`).
 *
 * A name is a "/"-separated path of lowercase slug segments —
 * `billing/dunning-reminder` — where `/` groups related automations into
 * folders. Inside a segment `-` and `_` separate words, and every separator is
 * single and sits between alphanumerics: `a__b`, `a-`, `-a` and `a//b` are all
 * invalid. The single-underscore rule is what keeps the URL codec lossless
 * (`billing/dunning` travels as `billing__dunning`, and a doubled underscore
 * can never occur in a valid name), so widening it here would break every
 * automation address.
 */

export const AUTOMATION_NAME_RE =
  /^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\/[a-z0-9]+(?:[-_][a-z0-9]+)*)*$/;

/** The longest name any surface accepts — the platform store's cap. */
export const AUTOMATION_NAME_MAX_LENGTH = 200;

/** The rule as a caller reads it in a refusal. */
export const AUTOMATION_NAME_RULE =
  'lowercase slug segments separated by "/" (e.g. "billing/dunning-reminder")';

export function isValidAutomationName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length <= AUTOMATION_NAME_MAX_LENGTH &&
    AUTOMATION_NAME_RE.test(name)
  );
}
