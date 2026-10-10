/**
 * Every budget refusal's sentence begins with this
 * (`backend/domains/governance/budget-refusal.ts`), whichever lane refused —
 * so a surface that only has the stored text, such as a failed
 * transcription's error, still recognises a reached usage limit and can say
 * it in the reader's language.
 */
export const USAGE_LIMIT_REFUSAL_PREFIX = 'Usage limit reached.';

/** Whether a stored failure sentence is a budget refusal. */
export function isUsageLimitRefusal(text: string | null | undefined): boolean {
  return (
    typeof text === 'string' && text.startsWith(USAGE_LIMIT_REFUSAL_PREFIX)
  );
}
