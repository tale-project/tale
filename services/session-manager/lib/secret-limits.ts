// The limits a secret is held to. The server enforces them
// (`backend/domains/secrets/vault.ts`) and the form checks them first
// (`app/features/secrets`), so a refusal from the server is the exception: one
// definition, which both import.

export const MAX_TITLE = 120;
export const MAX_FIELDS = 40;
export const MAX_LABEL = 60;
export const MAX_VALUE = 20_000;

/**
 * Whether `text` has more than `limit` characters, counted as a person counts
 * them (an emoji is one), not as UTF-16 code units. A character is one or two
 * code units: at most `limit` units are at most `limit` characters, more than
 * twice that are more than `limit` characters, and only a text in between is
 * walked.
 */
export function longerThan(text: string, limit: number): boolean {
  if (text.length > limit * 2) return true;
  return text.length > limit && Array.from(text).length > limit;
}
