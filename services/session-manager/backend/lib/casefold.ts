/**
 * Case-insensitive the way a person means it: full case folding, so the German
 * "Straße" and "STRASSE" are one name. The one rule for the names of sessions
 * (what makes two names the same) and for the lookups by name and by label.
 */
export function casefold(text: string): string {
  return text.toUpperCase().toLowerCase();
}
